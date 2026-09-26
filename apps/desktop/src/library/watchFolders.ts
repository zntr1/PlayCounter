import type { Game } from "@playcounter/shared";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { currentPlatform } from "../platform";
import { useAppStore } from "../store";
import {
  adoptFolderGame,
  lookupFolderExecutables,
  noteFolderExecutable,
} from "../tracker";
import { importExeCandidates } from "./exeCandidates";
import type { ScannedExecutable } from "./types";
import {
  addWatchFolder,
  isInsideFolder,
  readWatchFolders,
  updateWatchFolders,
  type DismissedFolder,
  type PendingFolderFind,
  type SeenFolder,
  type WatchFolderRecord,
} from "./watchFolderState";

type GameFolder = { watchFolder: string; path: string; name: string };
type WatchFolderListing = { gameFolders: GameFolder[]; readable: string[] };
type GameFolderScan = { executables: ScannedExecutable[]; capped: boolean };
type Candidate = { exeName: string; exePath: string };

/**
 * A game folder gets another look when it is new, or when the game file found
 * there lost its launch path (deleted and reinstalled, or renamed by an
 * update). Empty folders and finds still waiting in Discovered do not.
 */
function needsLook(entry: SeenFolder | undefined, record: WatchFolderRecord) {
  if (!entry) return true;
  if (entry.kind === "empty") return false;
  const key = entry.exeName.toLowerCase();
  if (useAppStore.getState().launchTargets.has(key)) return false;
  return entry.kind === "game" || !record.pending[key];
}

/**
 * Forgets game folders that are gone from a watched folder that could be
 * read, so a game reinstalled into the same folder counts as new.
 */
function forgetVanishedFolders(listing: WatchFolderListing) {
  const listed = new Set(
    listing.gameFolders.map((folder) => folder.path.toLowerCase()),
  );
  const vanished = (path: string) =>
    !listed.has(path.toLowerCase()) &&
    listing.readable.some((folder) => isInsideFolder(path, folder));
  return updateWatchFolders((record) => ({
    ...record,
    seen: Object.fromEntries(
      Object.entries(record.seen).filter(([path]) => !vanished(path)),
    ),
    pending: Object.fromEntries(
      Object.entries(record.pending).filter(
        ([, find]) => !vanished(find.folderPath),
      ),
    ),
  }));
}

const SCAN_THROTTLE_MS = 60_000;
/** A first scan of a big games folder continues on the next focus. */
const MAX_FOLDERS_PER_RUN = 20;
/** Enough to find the game's own file among helpers and tools. */
const MAX_CANDIDATES_PER_FOLDER = 5;

let scanInFlight: Promise<number> | undefined;
let lastScanAt = 0;

/**
 * Looks at game folders inside the watched folders that PlayCounter has not
 * seen yet. A folder whose files name exactly one game is added with a saved
 * launch file; anything unclear waits in Discovered. Returns how many games
 * were added.
 */
export function scanWatchFolders(reason: string): Promise<number> {
  if (scanInFlight) return scanInFlight;
  scanInFlight = runScan(reason)
    .catch((error) => {
      log(
        `watched folders scan failed reason=${reason}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return 0;
    })
    .finally(() => {
      scanInFlight = undefined;
      lastScanAt = Date.now();
    });
  return scanInFlight;
}

export function scanWatchFoldersThrottled(reason: string): Promise<number> {
  if (scanInFlight) return scanInFlight;
  if (Date.now() - lastScanAt < SCAN_THROTTLE_MS) return Promise.resolve(0);
  return scanWatchFolders(reason);
}

/** Asks for a folder to watch and looks at it right away. */
export async function chooseWatchFolder() {
  const selected = await open({ directory: true, multiple: false });
  if (typeof selected !== "string") return null;
  const record = addWatchFolder(selected);
  void scanWatchFolders("folder added");
  return record;
}

/** Test hook: forget throttling between runs. */
export function resetWatchFolderScan() {
  scanInFlight = undefined;
  lastScanAt = 0;
}

async function runScan(reason: string): Promise<number> {
  const state = useAppStore.getState();
  // Found games are only useful with their launch file.
  if (state.settings.rememberLaunchPaths === false) return 0;
  if (currentPlatform() !== "windows") return 0;
  const record = readWatchFolders();
  if (record.folders.length === 0) return 0;

  const listing = await invoke<WatchFolderListing>(
    "watch_folder_game_folders",
    { folders: record.folders },
  );
  const current = forgetVanishedFolders(listing);
  const dismissed = new Set(
    current.dismissed.map((item) => item.folderPath.toLowerCase()),
  );
  const launcherInstalls = [...state.libraryInstalls.values()].map((install) =>
    install.installPath.toLowerCase().replaceAll("/", "\\"),
  );
  const fresh = listing.gameFolders
    .filter((folder) => {
      const key = folder.path.toLowerCase();
      return (
        !dismissed.has(key) &&
        !launcherInstalls.some(
          (install) => install === key || install.startsWith(`${key}\\`),
        ) &&
        needsLook(current.seen[key], current)
      );
    })
    .slice(0, MAX_FOLDERS_PER_RUN);
  if (fresh.length === 0) return 0;

  const seen: Record<string, SeenFolder> = {};
  const candidatesByFolder = new Map<GameFolder, Candidate[]>();
  for (const folder of fresh) {
    let scan: GameFolderScan;
    try {
      scan = await invoke<GameFolderScan>("watch_folder_scan", {
        path: folder.path,
      });
    } catch {
      continue;
    }
    const candidates = importExeCandidates(
      scan.executables,
      [],
      folder.name,
      useAppStore.getState().ignoredProcesses,
    )
      .slice(0, MAX_CANDIDATES_PER_FOLDER)
      .map((executable) => ({
        exeName: executable.fileName,
        exePath: `${folder.path}\\${executable.relativePath.replaceAll("/", "\\")}`,
      }));
    if (candidates.length > 0) candidatesByFolder.set(folder, candidates);
    // A walk cut short gets another chance; an empty folder does not.
    else if (!scan.capped) seen[folder.path.toLowerCase()] = { kind: "empty" };
  }

  const results = await lookupFolderExecutables(
    [...candidatesByFolder.values()].flat(),
  );
  const pending: Record<string, PendingFolderFind> = {};
  let added = 0;
  for (const [folder, candidates] of candidatesByFolder) {
    const folderKey = folder.path.toLowerCase();
    const confident = confidentFind(candidates, results);
    if (confident) {
      adoptFolderGame(confident.exeName, confident.exePath, confident.game);
      seen[folderKey] = { kind: "game", exeName: confident.exeName };
      added += 1;
      continue;
    }
    const top = candidates[0];
    const key = top.exeName.toLowerCase();
    const known = useAppStore.getState().exeCache.get(key);
    // The file already names a game: only its launch file was missing.
    if (known?.state === "matched" && known.gameId !== undefined) {
      if (!useAppStore.getState().launchTargets.has(key)) {
        useAppStore.getState().setLaunchTarget({
          exeName: top.exeName,
          path: top.exePath,
          owner: { gameId: known.gameId, source: known.source ?? null },
        });
      }
      seen[folderKey] = { kind: "game", exeName: top.exeName };
      continue;
    }
    seen[folderKey] = { kind: "discovered", exeName: top.exeName };
    // Another folder already waits in Discovered with this file.
    if (pending[key] || current.pending[key]) continue;
    noteFolderExecutable(top.exeName);
    pending[key] = {
      exePath: top.exePath,
      folderPath: folder.path,
      folderName: folder.name,
    };
  }

  updateWatchFolders((latest) => ({
    ...latest,
    seen: { ...latest.seen, ...seen },
    pending: { ...latest.pending, ...pending },
  }));
  log(
    `watched folders scanned reason=${reason} folders=${fresh.length} added=${added} discovered=${Object.keys(pending).length}`,
  );
  if (added > 0) {
    useAppStore.getState().addToast({
      tone: "success",
      title: `${added} ${added === 1 ? "game" : "games"} found in your folders`,
      detail: "They are in My Games, ready to play.",
    });
  }
  return added;
}

/**
 * Exactly one game across the folder's executables, named by at least one of
 * them on its own (not a shared or flagged file name).
 */
function confidentFind(
  candidates: readonly Candidate[],
  results: Awaited<ReturnType<typeof lookupFolderExecutables>>,
): (Candidate & { game: Game }) | null {
  const games = new Map<string, Game>();
  let confident: (Candidate & { game: Game }) | null = null;
  for (const candidate of candidates) {
    const result = results.get(candidate.exeName.toLowerCase());
    if (!result) continue;
    const named =
      result.game && result.game.source !== "custom" ? result.game : null;
    for (const game of [
      ...(named ? [named] : []),
      ...(result.ambiguousGames ?? []),
    ]) {
      games.set(`${game.source}:${game.id}`, game);
    }
    if (
      named &&
      !confident &&
      !result.flaggedIdentifier &&
      !result.ambiguousGames?.length
    ) {
      confident = { ...candidate, game: named };
    }
  }
  return confident && games.size === 1 ? confident : null;
}

/**
 * Once a Discovered find is matched to a game, however the user did it, its
 * folder's file becomes the game's launch file. Ignoring it dismisses the
 * folder for good.
 */
export function startWatchFolderLinks() {
  return useAppStore.subscribe((state, previous) => {
    if (
      state.exeCache === previous.exeCache &&
      state.userIgnoredProcesses === previous.userIgnoredProcesses
    ) {
      return;
    }
    const record = readWatchFolders();
    const resolved: string[] = [];
    const matched: Record<string, SeenFolder> = {};
    const dismissed: DismissedFolder[] = [];
    for (const [key, find] of Object.entries(record.pending)) {
      const entry = state.exeCache.get(key);
      if (entry?.state === "matched" && entry.gameId !== undefined) {
        if (!state.launchTargets.has(key)) {
          state.setLaunchTarget({
            exeName: entry.exeName,
            path: find.exePath,
            owner: { gameId: entry.gameId, source: entry.source ?? null },
          });
        }
        matched[find.folderPath.toLowerCase()] = {
          kind: "game",
          exeName: entry.exeName,
        };
        resolved.push(key);
      } else if (
        state.userIgnoredProcesses.has(key) &&
        !previous.userIgnoredProcesses.has(key)
      ) {
        dismissed.push({
          folderPath: find.folderPath,
          exeName: state.exeCache.get(key)?.exeName ?? key,
        });
        resolved.push(key);
      }
    }
    if (resolved.length === 0) return;
    updateWatchFolders((current) => ({
      ...current,
      seen: { ...current.seen, ...matched },
      pending: Object.fromEntries(
        Object.entries(current.pending).filter(
          ([key]) => !resolved.includes(key),
        ),
      ),
      dismissed: [
        ...current.dismissed,
        ...dismissed.filter(
          (item) =>
            !current.dismissed.some(
              (existing) => existing.folderPath === item.folderPath,
            ),
        ),
      ],
    }));
  });
}

function log(message: string) {
  useAppStore.getState().addRuntimeLogEntry(message);
}
