import { invoke } from "@tauri-apps/api/core";
import { currentPlatform } from "../platform";
import { useAppStore } from "../store";
import { commitLibraryImports } from "./commit";
import { buildLibraryImportCommit } from "./importPlan";
import { resolveLibraryGames } from "./resolve";
import { readSteamAutoAdd } from "./steamAutoAddState";
import {
  libraryEntryKey,
  type LibraryImportCommit,
  type LibraryScanResult,
  type LocalLibraryAccount,
} from "./types";

type InstalledSteamApp = { appId: string; installPath: string };

const SYNC_THROTTLE_MS = 60_000;
/** IGDB often links a new release's AppID only days after launch. */
const UNKNOWN_APP_RETRY_MS = 24 * 60 * 60 * 1_000;

const unknownAppsCheckedAt = new Map<string, number>();
let syncInFlight: Promise<number> | undefined;
let lastSyncAt = 0;

/**
 * Keeps imported Steam games in step with Steam on this PC: a reinstalled game
 * gets its install back, and (unless turned off) newly installed games are
 * added. Runs only after the user imported Steam once. Returns how many games
 * were added.
 */
export function syncSteamLibrary(reason: string): Promise<number> {
  if (syncInFlight) return syncInFlight;
  syncInFlight = runSteamSync(reason)
    .catch((error) => {
      log(
        `steam library sync failed reason=${reason}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return 0;
    })
    .finally(() => {
      syncInFlight = undefined;
      lastSyncAt = Date.now();
    });
  return syncInFlight;
}

export function syncSteamLibraryThrottled(reason: string): Promise<number> {
  if (syncInFlight) return syncInFlight;
  if (Date.now() - lastSyncAt < SYNC_THROTTLE_MS) return Promise.resolve(0);
  return syncSteamLibrary(reason);
}

/** Test hook: forget throttling and retry memory between runs. */
export function resetSteamLibrarySync() {
  unknownAppsCheckedAt.clear();
  syncInFlight = undefined;
  lastSyncAt = 0;
}

async function runSteamSync(reason: string): Promise<number> {
  const { settings } = useAppStore.getState();
  const addGames = settings.autoAddSteamGames !== false;
  if (!addGames && settings.gameLaunchingEnabled !== true) return 0;
  if (currentPlatform() !== "windows") return 0;
  if (!hasSteamImports()) return 0;

  const installed = await invoke<InstalledSteamApp[] | null>(
    "library_steam_installed_apps",
  );
  if (!installed) return 0;

  const restored = restoreReinstalledGames(installed);
  const added = addGames ? await addNewGames(installed) : 0;
  log(
    `steam library synced reason=${reason} installed=${installed.length} restored=${restored} added=${added}`,
  );
  return added;
}

function hasSteamImports() {
  for (const entry of useAppStore.getState().libraryImports.values()) {
    if (entry.provider === "steam") return true;
  }
  return false;
}

function restoreReinstalledGames(installed: readonly InstalledSteamApp[]) {
  const state = useAppStore.getState();
  const scannedAt = new Date().toISOString();
  let restored = 0;
  for (const app of installed) {
    const key = libraryEntryKey("steam", app.appId);
    if (!state.libraryImports.has(key) || state.libraryInstalls.has(key)) {
      continue;
    }
    state.setLibraryInstall({
      provider: "steam",
      externalId: app.appId,
      installPath: app.installPath,
      scannedAt,
    });
    restored += 1;
  }
  return restored;
}

async function addNewGames(installed: readonly InstalledSteamApp[]) {
  const record = readSteamAutoAdd();
  const dismissed = new Set(record.dismissedAppIds);
  const now = Date.now();
  const imports = useAppStore.getState().libraryImports;
  const fresh = installed
    .map((app) => app.appId)
    .filter(
      (appId) =>
        !imports.has(libraryEntryKey("steam", appId)) &&
        !dismissed.has(appId) &&
        now - (unknownAppsCheckedAt.get(appId) ?? -Infinity) >=
          UNKNOWN_APP_RETRY_MS,
    );
  if (fresh.length === 0) return 0;

  const accountId = record.accountId ?? (await mostRecentSteamAccount());
  if (accountId === undefined) return 0;

  const scan = await invoke<LibraryScanResult>("library_scan", {
    provider: "steam",
    accountId,
    appIds: fresh,
  });
  const lookup = await resolveLibraryGames(
    useAppStore.getState().settings.apiEndpoint,
    "steam",
    scan.games,
  );
  if (lookup.capability !== "supported") return 0;
  // Apps the catalog cannot place wait a day before the next lookup.
  for (const appId of fresh) unknownAppsCheckedAt.set(appId, now);

  const resolved = new Map(lookup.games.map((game) => [game.key, game]));
  const state = useAppStore.getState();
  const commits: LibraryImportCommit[] = [];
  for (const game of scan.games) {
    const key = libraryEntryKey("steam", game.externalId);
    const match = resolved.get(key);
    // Imported by hand meanwhile, or unknown to the catalog: leave it be.
    if (state.libraryImports.has(key) || !match) continue;
    // No executable is picked here: an unknown .exe is matched later, when
    // the game runs, the same way as for any other game.
    const commit = buildLibraryImportCommit({
      provider: "steam",
      scanned: game,
      resolved: match,
      ignoredProcesses: state.ignoredProcesses,
    });
    if (!commit) continue;
    commits.push(commit);
    unknownAppsCheckedAt.delete(game.externalId);
  }
  if (commits.length === 0) return 0;

  commitLibraryImports(commits);
  useAppStore.getState().addToast({
    tone: "success",
    title: `${commits.length} Steam ${commits.length === 1 ? "game" : "games"} added`,
    detail:
      "Installed Steam games now show up in My Games on their own. You can turn this off in Settings under Library import.",
  });
  return commits.length;
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
