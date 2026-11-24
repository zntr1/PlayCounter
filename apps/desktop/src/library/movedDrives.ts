import { invoke } from "@tauri-apps/api/core";
import { launchErrorKind } from "../gameLaunch";
import { currentPlatform } from "../platform";
import { useAppStore, type AppState, type ProcessSnapshot } from "../store";
import { persist } from "../tracker";
import { isInIgnoredFolder } from "./genericExeLinks";
import {
  isUnderPrefix,
  normalizeWindowsDir,
  resolveScopedLink,
  scopedExeLinkKey,
} from "./scopedLinks";
import type { IgnoredExeFolder, ScopedExeLink } from "./types";
import {
  readWatchFolders,
  writeWatchFolders,
  type SeenFolder,
  type WatchFolderRecord,
} from "./watchFolderState";

/* A disk that got another drive letter (docs/drive-letter-plan.md) ─────────
   Every path PlayCounter stored on that disk is gone. Like Playnite, a gone
   path is tried with every other drive letter, and the first drive that has
   it wins (find_moved_paths in moved_drives.rs). This runs at app start, and
   again when a running file's folder matches a folder link or ignore except
   for the letter: the disk was plugged in while the app ran. Launcher
   installs are left to the launchers, which report their own new paths. */

type MovedPathReport = { path: string; movedTo: string | null };

/** Lowercased old path → the path on its new drive. */
type Moves = ReadonlyMap<string, string>;

type PathState = Pick<
  AppState,
  | "launchTargets"
  | "manualLaunchTargets"
  | "emulatorAutoBinaries"
  | "emulatorManualBinaries"
  | "emulatorAutoLaunchTargets"
  | "emulatorManualLaunchTargets"
  | "emulatorLaunchCandidates"
  | "scopedExeLinks"
  | "ignoredExeFolders"
  | "exeCache"
  | "toolUsage"
>;

const DRIVE_PATH = /^[a-z]:[\\/]/i;

/** Every stored path a new drive letter breaks, each once. */
function storedPaths(state: PathState, watch: WatchFolderRecord) {
  const paths = [
    ...[...state.launchTargets.values()].map((target) => target.path),
    ...[...state.manualLaunchTargets.values()].map((target) => target.path),
    ...[
      ...state.emulatorAutoBinaries.values(),
      ...state.emulatorManualBinaries.values(),
    ].map((binary) => binary.exePath),
    ...[
      ...state.emulatorAutoLaunchTargets.values(),
      ...state.emulatorManualLaunchTargets.values(),
      ...state.emulatorLaunchCandidates.values(),
    ].map((target) => target.filePath),
    ...[...state.scopedExeLinks.values()].flatMap((link) => [
      link.pathPrefix,
      link.exePath,
    ]),
    ...[...state.ignoredExeFolders.values()].map((folder) => folder.pathPrefix),
    ...[...state.exeCache.values()].map((entry) => entry.exePath),
    ...Object.values(state.toolUsage).map((record) => record.exePath),
    ...watch.folders,
    ...Object.keys(watch.seen),
    ...Object.values(watch.pending).flatMap((find) => [
      find.exePath,
      find.folderPath,
    ]),
    ...watch.dismissed.map((item) => item.folderPath),
  ];
  const unique = new Map<string, string>();
  for (const path of paths) {
    if (typeof path !== "string" || !DRIVE_PATH.test(path)) continue;
    if (!unique.has(path.toLowerCase())) unique.set(path.toLowerCase(), path);
  }
  return [...unique.values()];
}

function mover(moves: Moves) {
  return (path: string | null | undefined) =>
    path ? moves.get(path.toLowerCase()) : undefined;
}

/** A map whose keys stay; only the path inside each entry moves. */
function moveValues<K, V>(
  map: ReadonlyMap<K, V>,
  move: (value: V) => V | null,
): Map<K, V> | null {
  let next: Map<K, V> | null = null;
  for (const [key, value] of map) {
    const moved = move(value);
    if (!moved) continue;
    next ??= new Map(map);
    next.set(key, moved);
  }
  return next;
}

/** Folder links and ignores are keyed by their folder. One the new folder
 *  already has stays, and the old entry is left as it is. */
function moveFolderEntries<T extends ScopedExeLink | IgnoredExeFolder>(
  map: ReadonlyMap<string, T>,
  to: ReturnType<typeof mover>,
): Map<string, T> | null {
  let next: Map<string, T> | null = null;
  for (const [key, entry] of map) {
    const pathPrefix = to(entry.pathPrefix);
    const exePath = "exePath" in entry ? to(entry.exePath) : undefined;
    if (!pathPrefix && !exePath) continue;
    const newKey = pathPrefix
      ? scopedExeLinkKey(entry.exeName, pathPrefix)
      : key;
    if (!newKey || (newKey !== key && (next ?? map).has(newKey))) continue;
    next ??= new Map(map);
    next.delete(key);
    next.set(newKey, {
      ...entry,
      ...(pathPrefix ? { pathPrefix } : {}),
      ...(exePath ? { exePath } : {}),
    });
  }
  return next;
}

function movedState(state: PathState, moves: Moves): Partial<PathState> {
  const to = mover(moves);
  const patch: Partial<PathState> = {};
  const launchTargets = moveValues(state.launchTargets, (target) => {
    const path = to(target.path);
    return path ? { ...target, path } : null;
  });
  if (launchTargets) patch.launchTargets = launchTargets;
  const manualLaunchTargets = moveValues(
    state.manualLaunchTargets,
    (target) => {
      const path = to(target.path);
      return path ? { ...target, path } : null;
    },
  );
  if (manualLaunchTargets) patch.manualLaunchTargets = manualLaunchTargets;
  for (const key of [
    "emulatorAutoBinaries",
    "emulatorManualBinaries",
  ] as const) {
    const moved = moveValues(state[key], (binary) => {
      const exePath = to(binary.exePath);
      return exePath ? { ...binary, exePath } : null;
    });
    if (moved) patch[key] = moved;
  }
  for (const key of [
    "emulatorAutoLaunchTargets",
    "emulatorManualLaunchTargets",
  ] as const) {
    const moved = moveValues(state[key], (target) => {
      const filePath = to(target.filePath);
      return filePath ? { ...target, filePath } : null;
    });
    if (moved) patch[key] = moved;
  }
  const emulatorLaunchCandidates = moveValues(
    state.emulatorLaunchCandidates,
    (candidate) => {
      const filePath = to(candidate.filePath);
      return filePath ? { ...candidate, filePath } : null;
    },
  );
  if (emulatorLaunchCandidates) {
    patch.emulatorLaunchCandidates = emulatorLaunchCandidates;
  }
  const scopedExeLinks = moveFolderEntries(state.scopedExeLinks, to);
  if (scopedExeLinks) patch.scopedExeLinks = scopedExeLinks;
  const ignoredExeFolders = moveFolderEntries(state.ignoredExeFolders, to);
  if (ignoredExeFolders) patch.ignoredExeFolders = ignoredExeFolders;
  const exeCache = moveValues(state.exeCache, (entry) => {
    const exePath = to(entry.exePath);
    return exePath ? { ...entry, exePath } : null;
  });
  if (exeCache) patch.exeCache = exeCache;
  let toolUsage: PathState["toolUsage"] | null = null;
  for (const [key, record] of Object.entries(state.toolUsage)) {
    const exePath = to(record.exePath);
    if (!exePath) continue;
    toolUsage ??= { ...state.toolUsage };
    toolUsage[key] = { ...record, exePath };
  }
  if (toolUsage) patch.toolUsage = toolUsage;
  return patch;
}

/** The watch-folder record with its paths moved, or null when none moved.
 *  A game folder already seen in the new place keeps that entry. */
function movedWatchFolders(
  record: WatchFolderRecord,
  moves: Moves,
): WatchFolderRecord | null {
  const to = mover(moves);
  let changed = false;
  const move = (path: string) => {
    const moved = to(path);
    if (!moved) return path;
    changed = true;
    return moved;
  };
  const folders: string[] = [];
  for (const folder of record.folders.map(move)) {
    if (!folders.some((item) => item.toLowerCase() === folder.toLowerCase())) {
      folders.push(folder);
    }
  }
  const seen: Record<string, SeenFolder> = {};
  const movedSeen: Array<[string, string, SeenFolder]> = [];
  for (const [path, entry] of Object.entries(record.seen)) {
    const moved = to(path);
    if (moved) movedSeen.push([path, moved.toLowerCase(), entry]);
    else seen[path] = entry;
  }
  for (const [path, moved, entry] of movedSeen) {
    if (moved in seen) {
      seen[path] = entry;
    } else {
      seen[moved] = entry;
      changed = true;
    }
  }
  const pending = Object.fromEntries(
    Object.entries(record.pending).map(([key, find]) => [
      key,
      {
        ...find,
        exePath: move(find.exePath),
        folderPath: move(find.folderPath),
      },
    ]),
  );
  const dismissed = record.dismissed.map((item) => ({
    ...item,
    folderPath: move(item.folderPath),
  }));
  return changed ? { folders, seen, pending, dismissed } : null;
}

let inFlight: Promise<Moves> | undefined;
/** Running files' folders already looked at since this app start. */
const lookedAtFolders = new Set<string>();

/** A new app start: running files' folders are looked at again. */
export function resetMovedDrives() {
  inFlight = undefined;
  lookedAtFolders.clear();
}

function log(message: string) {
  useAppStore.getState().addRuntimeLogEntry(message);
}

async function lookUp(reason: string, extra: readonly string[]) {
  const moves = new Map<string, string>();
  try {
    const paths = storedPaths(useAppStore.getState(), readWatchFolders());
    const known = new Set(paths.map((path) => path.toLowerCase()));
    for (const path of extra) {
      if (DRIVE_PATH.test(path) && !known.has(path.toLowerCase())) {
        paths.push(path);
      }
    }
    if (paths.length === 0) return moves;
    const reports = await invoke<MovedPathReport[] | undefined>(
      "find_moved_paths",
      { paths },
    );
    for (const report of Array.isArray(reports) ? reports : []) {
      if (typeof report?.movedTo === "string" && report.movedTo) {
        moves.set(report.path.toLowerCase(), report.movedTo);
      }
    }
    if (moves.size > 0) {
      // Read again: a scan may have changed the store while Rust looked.
      useAppStore.setState(movedState(useAppStore.getState(), moves));
      persist();
      const watch = movedWatchFolders(readWatchFolders(), moves);
      if (watch) writeWatchFolders(watch);
    }
    log(
      `moved drives reason=${reason} checked=${paths.length} moved=${moves.size}`,
    );
  } catch (error) {
    log(
      `moved drives failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return moves;
}

/** One look at a time. A look for files of its own (Play) waits for the one
 *  running and then looks again, so its files are surely asked about. */
async function lookForMovedPaths(
  reason: string,
  extra: readonly string[] = [],
): Promise<Moves> {
  try {
    if (currentPlatform() !== "windows") return new Map();
  } catch {
    return new Map();
  }
  if (inFlight && extra.length === 0) return inFlight;
  if (inFlight) await inFlight;
  const look = lookUp(reason, extra);
  inFlight = look;
  try {
    return await look;
  } finally {
    if (inFlight === look) inFlight = undefined;
  }
}

/** Finds stored paths on the drive their disk moved to and saves them there.
 *  Returns how many paths were found elsewhere. Windows only. */
export async function findMovedDrives(reason: string): Promise<number> {
  return (await lookForMovedPaths(reason)).size;
}

/** A start that failed on its file: the file is gone ("notFound"), or its
 *  drive is not there ("unreadable"; Rust can't tell that from a gone file). */
export function failedOnItsFile(error: unknown) {
  const kind = launchErrorKind(error);
  return kind === "notFound" || kind === "unreadable";
}

/**
 * Play found no file: its disk may have come back under a new letter while
 * PlayCounter ran. Looks for every stored path again, these files included,
 * and saves what it finds. Returns where each of `paths` is now, by its
 * lowercased old path; a file no other drive has is not in it.
 */
export function findMovedFiles(
  paths: readonly string[],
  reason: string,
): Promise<Moves> {
  return lookForMovedPaths(reason, paths);
}

/** True when a folder entry would hold this file if the file's drive letter
 *  were the entry's: `E:\Games\X\Game.exe` and a link on `D:\Games\X`. */
function matchesWithOtherLetter(
  path: string,
  exeName: string,
  entry: ScopedExeLink | IgnoredExeFolder,
) {
  if (entry.exeName.toLowerCase() !== exeName.toLowerCase()) return false;
  const prefix = normalizeWindowsDir(entry.pathPrefix);
  return Boolean(
    prefix &&
    DRIVE_PATH.test(prefix) &&
    prefix[0] !== path[0] &&
    isUnderPrefix(path.slice(1), prefix.slice(1)),
  );
}

/**
 * A running file with no folder link, whose folder matches a folder link or
 * ignore except for the drive letter: the disk came back under a new letter
 * while PlayCounter ran. Looks for moved paths again, once per folder per app
 * start, so the scan that called this sorts the file through its link. When
 * the old folder still exists, it is a second copy and nothing moves.
 */
export async function relinkMovedFolders(
  processes: readonly ProcessSnapshot[],
) {
  const state = useAppStore.getState();
  const entries = [
    ...state.scopedExeLinks.values(),
    ...state.ignoredExeFolders.values(),
  ];
  if (entries.length === 0) return;
  let lookAgain = false;
  for (const process of processes) {
    if (!process.exePath) continue;
    const path = normalizeWindowsDir(process.exePath);
    if (!path || !DRIVE_PATH.test(path)) continue;
    const folder = path.replace(/\\[^\\]*$/, "");
    if (lookedAtFolders.has(folder)) continue;
    if (
      resolveScopedLink(process, state.scopedExeLinks) ||
      isInIgnoredFolder(process, state.ignoredExeFolders)
    ) {
      continue;
    }
    if (
      !entries.some((entry) =>
        matchesWithOtherLetter(path, process.exeName, entry),
      )
    ) {
      continue;
    }
    lookedAtFolders.add(folder);
    lookAgain = true;
  }
  if (lookAgain) await findMovedDrives("running-file");
}
