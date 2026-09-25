import type { LibraryProviderId } from "@playcounter/shared";
import { invoke } from "@tauri-apps/api/core";
import { currentPlatform } from "../platform";
import { useAppStore } from "../store";
import { commitLibraryImports } from "./commit";
import { buildLibraryImportCommit } from "./importPlan";
import {
  isLauncherGameDismissed,
  readLibraryAutoAdd,
} from "./libraryAutoAddState";
import { resolveLibraryGames } from "./resolve";
import {
  libraryEntryKey,
  type LibraryImportCommit,
  type LibraryScanResult,
  type LocalLibraryAccount,
  type ScannedLibraryGame,
} from "./types";

type InstalledGame = { externalId: string; installPath: string };

const SYNC_PROVIDERS: readonly LibraryProviderId[] = [
  "steam",
  "xbox",
  "battlenet",
];
const SYNC_THROTTLE_MS = 60_000;
/** The catalog often learns a new release's launcher id days after launch. */
const UNKNOWN_GAME_RETRY_MS = 24 * 60 * 60 * 1_000;

const unknownGamesCheckedAt = new Map<string, number>();
let syncInFlight: Promise<number> | undefined;
let lastSyncAt = 0;

/**
 * Keeps imported launcher games in step with this PC: a reinstalled game gets
 * its install back, and (unless turned off) newly installed Steam and
 * Battle.net games are added. Each launcher takes part only after the user
 * imported from it once. Returns how many games were added.
 */
export function syncLibraryInstalls(reason: string): Promise<number> {
  if (syncInFlight) return syncInFlight;
  syncInFlight = runSync(reason).finally(() => {
    syncInFlight = undefined;
    lastSyncAt = Date.now();
  });
  return syncInFlight;
}

export function syncLibraryInstallsThrottled(reason: string): Promise<number> {
  if (syncInFlight) return syncInFlight;
  if (Date.now() - lastSyncAt < SYNC_THROTTLE_MS) return Promise.resolve(0);
  return syncLibraryInstalls(reason);
}

/** Test hook: forget throttling and retry memory between runs. */
export function resetLibraryInstallSync() {
  unknownGamesCheckedAt.clear();
  syncInFlight = undefined;
  lastSyncAt = 0;
}

async function runSync(reason: string): Promise<number> {
  const { settings } = useAppStore.getState();
  const addGames = settings.autoAddInstalledGames !== false;
  if (!addGames && settings.gameLaunchingEnabled !== true) return 0;
  if (currentPlatform() !== "windows") return 0;

  const imported = new Set(
    [...useAppStore.getState().libraryImports.values()].map(
      (entry) => entry.provider,
    ),
  );
  let added = 0;
  for (const provider of SYNC_PROVIDERS) {
    if (!imported.has(provider)) continue;
    try {
      const installed = await invoke<InstalledGame[] | null>(
        "library_installed_games",
        { provider },
      );
      if (!installed) continue;
      const restored = restoreReinstalledGames(provider, installed);
      // Xbox installs carry no game identity the catalog can resolve.
      const providerAdded =
        addGames && provider !== "xbox"
          ? await addNewGames(provider, installed)
          : 0;
      added += providerAdded;
      log(
        `library sync ${provider} reason=${reason} installed=${installed.length} restored=${restored} added=${providerAdded}`,
      );
    } catch (error) {
      log(
        `library sync ${provider} failed reason=${reason}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  if (added > 0) {
    useAppStore.getState().addToast({
      tone: "success",
      title: `${added} ${added === 1 ? "game" : "games"} added`,
      detail:
        "Games you install in Steam or Battle.net now show up in My Games on their own. You can turn this off in Settings under Library import.",
    });
  }
  return added;
}

function restoreReinstalledGames(
  provider: LibraryProviderId,
  installed: readonly InstalledGame[],
) {
  const state = useAppStore.getState();
  const scannedAt = new Date().toISOString();
  let restored = 0;
  for (const game of installed) {
    const key = libraryEntryKey(provider, game.externalId);
    if (!state.libraryImports.has(key) || state.libraryInstalls.has(key)) {
      continue;
    }
    state.setLibraryInstall({
      provider,
      externalId: game.externalId,
      installPath: game.installPath,
      scannedAt,
    });
    restored += 1;
  }
  return restored;
}

async function addNewGames(
  provider: LibraryProviderId,
  installed: readonly InstalledGame[],
) {
  const record = readLibraryAutoAdd();
  const now = Date.now();
  const imports = useAppStore.getState().libraryImports;
  const fresh = installed
    .map((game) => game.externalId)
    .filter((externalId) => {
      const key = libraryEntryKey(provider, externalId);
      return (
        !imports.has(key) &&
        !isLauncherGameDismissed(record, { provider, externalId }) &&
        now - (unknownGamesCheckedAt.get(key) ?? -Infinity) >=
          UNKNOWN_GAME_RETRY_MS
      );
    });
  if (fresh.length === 0) return 0;

  const games = await scanNewGames(provider, fresh, record.steamAccountId);
  if (games.length === 0) return 0;
  const lookup = await resolveLibraryGames(
    useAppStore.getState().settings.apiEndpoint,
    provider,
    games,
  );
  if (lookup.capability !== "supported") return 0;
  // Games the catalog cannot place wait a day before the next lookup.
  for (const game of games) {
    unknownGamesCheckedAt.set(libraryEntryKey(provider, game.externalId), now);
  }

  const resolved = new Map(lookup.games.map((game) => [game.key, game]));
  const state = useAppStore.getState();
  const commits: LibraryImportCommit[] = [];
  for (const game of games) {
    const key = libraryEntryKey(provider, game.externalId);
    const match = resolved.get(key);
    // Imported by hand meanwhile, or unknown to the catalog: leave it be.
    if (state.libraryImports.has(key) || !match) continue;
    // No executable is picked here: an unknown .exe is matched later, when
    // the game runs, the same way as for any other game.
    const commit = buildLibraryImportCommit({
      provider,
      scanned: game,
      resolved: match,
      ignoredProcesses: state.ignoredProcesses,
    });
    if (!commit) continue;
    commits.push(commit);
    unknownGamesCheckedAt.delete(key);
  }
  if (commits.length === 0) return 0;
  commitLibraryImports(commits);
  return commits.length;
}

/** Full scans (with executables) of only the newly installed games. */
async function scanNewGames(
  provider: LibraryProviderId,
  externalIds: readonly string[],
  steamAccountId: number | undefined,
): Promise<ScannedLibraryGame[]> {
  if (provider === "steam") {
    const accountId = steamAccountId ?? (await mostRecentSteamAccount());
    if (accountId === undefined) return [];
    const scan = await invoke<LibraryScanResult>("library_scan", {
      provider,
      accountId,
      appIds: externalIds,
    });
    return scan.games;
  }
  // Battle.net installs are few; its scan has no per-game filter. A game that
  // is still downloading has no executable yet and is left for a later run.
  const scan = await invoke<LibraryScanResult>("library_scan", {
    provider,
    accountId: 0,
  });
  return scan.games.filter(
    (game) => game.installed && externalIds.includes(game.externalId),
  );
}

/** Steam imports made before PlayCounter remembered the imported account. */
async function mostRecentSteamAccount() {
  const accounts = await invoke<LocalLibraryAccount[]>(
    "library_list_accounts",
    { provider: "steam" },
  );
  return accounts[0]?.accountId;
}

function log(message: string) {
  useAppStore.getState().addRuntimeLogEntry(message);
}
