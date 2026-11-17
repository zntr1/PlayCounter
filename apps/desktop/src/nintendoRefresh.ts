import { getT } from "./i18n";
import { currentPlatform } from "./platform";
import { gameMetadataKey, useAppStore } from "./store";
import { commitLibraryImports } from "./library/commit";
import {
  holdsAccount,
  mergeReading,
  readingOf,
} from "./library/accountReadings";
import { librarySearchQuery, searchLibraryGames } from "./library/gameLookup";
import { buildLibraryImportCommit } from "./library/importPlan";
import { useKeptLogins } from "./library/keptLogins";
import {
  isLauncherGameDismissed,
  readLibraryAutoAdd,
} from "./library/libraryAutoAddState";
import { getLoginHealth, recordLoginHealth } from "./library/loginHealth";
import { nameMatch } from "./library/nameMatch";
import {
  nintendoScanResult,
  readSavedNintendoGames,
} from "./library/nintendoAccount";
import {
  libraryEntryKey,
  type LibraryImportCommit,
  type LibraryImportEntry,
  type LibraryScanResult,
  type ScannedLibraryGame,
} from "./library/types";

/*
 * Nintendo's totals refresh by themselves (docs/nintendo-import-plan.md,
 * D3 A and D4 B). While PlayCounter runs with a kept Nintendo sign-in and
 * games from Nintendo in My Games, the play history is read 30 seconds after
 * start and then every hour: imported games take Nintendo's higher totals,
 * and a new game comes in when the name search finds exactly one game of
 * that name. Nintendo shows play up to a day late. There are no live
 * sessions (Nintendo has no presence PlayCounter can read).
 */

const t = getT("import");

export const REFRESH_EVERY_MS = 60 * 60_000;
const FIRST_REFRESH_MS = 30_000;
/** A new game the search couldn't match is searched again after a day. */
const UNKNOWN_GAME_RETRY_MS = 24 * 60 * 60_000;

let refreshTimer: ReturnType<typeof setTimeout> | undefined;
let refreshInFlight: Promise<number> | undefined;
let running = false;
const unknownGameCheckedAt = new Map<string, number>();

export function initializeNintendoRefresh() {
  disposeNintendoRefresh();
  running = true;
  refreshTimer = setTimeout(() => void refreshOnSchedule(), FIRST_REFRESH_MS);
}

export function disposeNintendoRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = undefined;
  running = false;
  refreshInFlight = undefined;
  unknownGameCheckedAt.clear();
}

function signedIn() {
  return (
    useKeptLogins
      .getState()
      .logins.some((login) => login.service === "nintendo") &&
    getLoginHealth("nintendo")?.status !== "needsSignIn"
  );
}

function nintendoImports() {
  return [...useAppStore.getState().libraryImports.values()].filter(
    (entry) => entry.provider === "nintendo",
  );
}

async function refreshOnSchedule() {
  await refreshNintendoGames("schedule");
  if (running) {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => void refreshOnSchedule(), REFRESH_EVERY_MS);
  }
}

/**
 * Reads Nintendo's play history with the kept sign-in: imported games take
 * Nintendo's newer totals, and new games with exactly one game of their name
 * are added, unless the player turned adding new games off or removed that
 * game. Returns how many were added.
 */
export function refreshNintendoGames(reason: string): Promise<number> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = runRefresh(reason)
    .catch((error: unknown) => {
      log(
        `nintendo refresh failed reason=${reason}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return 0;
    })
    .finally(() => {
      refreshInFlight = undefined;
    });
  return refreshInFlight;
}

async function runRefresh(reason: string) {
  if (
    currentPlatform() !== "windows" ||
    !signedIn() ||
    nintendoImports().length === 0
  )
    return 0;
  const read = await readSavedNintendoGames();
  if (read.status === "needsSignIn") {
    recordLoginHealth("nintendo", "needsSignIn");
    return 0;
  }
  if (read.status !== "valid" || !read.value) return 0;
  const scan = nintendoScanResult(read.value);
  const now = new Date().toISOString();
  const state = useAppStore.getState();
  const commits: LibraryImportCommit[] = [];
  const fresh: ScannedLibraryGame[] = [];
  for (const game of scan.games) {
    const existing = state.libraryImports.get(
      libraryEntryKey("nintendo", game.externalId),
    );
    if (!existing) fresh.push(game);
    else {
      const commit = updatedCommit(existing, game, scan, now);
      if (commit) commits.push(commit);
    }
  }
  const added = await newGameCommits(fresh, scan);
  commits.push(...added);
  if (commits.length > 0) commitLibraryImports(commits);
  log(
    `nintendo refresh reason=${reason} games=${scan.games.length} updated=${commits.length - added.length} added=${added.length}`,
  );
  if (added.length > 0) {
    useAppStore.getState().addToast({
      tone: "success",
      title: t("{{count}} games added", { count: added.length }),
      detail: t(
        "New games you play on your Switch now show up in My Games on their own. You can turn this off in Settings under Library import.",
      ),
    });
  }
  return added.length;
}

/** Only what Nintendo changed: a higher total or a later play. The read
 *  updates only the account it read (docs/import-accounts-plan.md), and
 *  only one the game has: another account joins a game through the
 *  importer, or one removed in Details would be back within the hour
 *  (docs/remove-account-hours-plan.md). */
function updatedCommit(
  existing: LibraryImportEntry,
  game: ScannedLibraryGame,
  scan: LibraryScanResult,
  now: string,
): LibraryImportCommit | null {
  if (!holdsAccount(existing, scan.account)) return null;
  const seconds =
    game.playtimeSeconds === null
      ? null
      : Math.max(0, Math.floor(game.playtimeSeconds));
  const lastPlayedAt = game.lastPlayedUnix
    ? new Date(game.lastPlayedUnix * 1000).toISOString()
    : undefined;
  const { accounts: _saved, ...saved } = existing;
  const read: LibraryImportEntry = {
    ...saved,
    providerSeconds: seconds,
    providerHasPlayedEvidence: true,
    providerLastPlayedAt: lastPlayedAt ?? existing.providerLastPlayedAt,
    lastReadAt: now,
  };
  if (scan.account)
    read.accounts = [
      readingOf(scan.account, { ...read, providerLastPlayedAt: lastPlayedAt }),
    ];
  const merged = mergeReading(existing, read, scan.totalsCutShort);
  const grew =
    merged.providerSeconds !== null &&
    (existing.providerSeconds === null ||
      merged.providerSeconds > existing.providerSeconds);
  const playedLater =
    lastPlayedAt !== undefined &&
    (!existing.providerLastPlayedAt ||
      Date.parse(lastPlayedAt) > Date.parse(existing.providerLastPlayedAt));
  const accountsChanged =
    accountNames(merged.accounts) !== accountNames(existing.accounts);
  if (!grew && !playedLater && !accountsChanged) return null;
  const state = useAppStore.getState();
  const metadata = state.gameMetadata.get(
    gameMetadataKey({ id: existing.gameId, source: existing.source }),
  ) ?? {
    id: existing.gameId,
    igdbId: existing.igdbId,
    name: existing.name,
    coverUrl: existing.coverUrl,
    source: existing.source,
  };
  return {
    entry: {
      ...read,
      // A total that didn't grow is not a new read: the time PlayCounter
      // recorded since the last one still counts on top of it.
      providerSeconds: grew ? seconds : null,
      lastReadAt: grew ? now : existing.lastReadAt,
    },
    metadata,
    preserveInstall: true,
    exeCacheEntries: [],
    scopedLinks: [],
  };
}

/** Which accounts a game has, under which names. */
function accountNames(accounts: LibraryImportEntry["accounts"]) {
  return JSON.stringify(accounts?.map(({ key, name }) => [key, name]) ?? null);
}

/** D4 B: a new game is added when the name search finds exactly one game of
 *  that name, the rule that makes a game Ready in the importer. */
async function newGameCommits(
  fresh: ScannedLibraryGame[],
  scan: LibraryScanResult,
) {
  const state = useAppStore.getState();
  if (fresh.length === 0 || state.settings.autoAddInstalledGames === false)
    return [];
  const record = readLibraryAutoAdd();
  const now = Date.now();
  const commits: LibraryImportCommit[] = [];
  for (const game of fresh) {
    if (
      isLauncherGameDismissed(record, {
        provider: "nintendo",
        externalId: game.externalId,
      }) ||
      now - (unknownGameCheckedAt.get(game.externalId) ?? -Infinity) <
        UNKNOWN_GAME_RETRY_MS
    )
      continue;
    unknownGameCheckedAt.set(game.externalId, now);
    const query = librarySearchQuery(game.name ?? "");
    if (query.length < 2) continue;
    let candidates;
    try {
      candidates = await searchLibraryGames(
        useAppStore.getState().settings.apiEndpoint,
        query,
        { mainGamesAndRemastersOnly: false },
      );
    } catch {
      // Searched again after a day.
      continue;
    }
    const named = nameMatch(game.name, candidates);
    if (!named) continue;
    const commit = buildLibraryImportCommit({
      provider: "nintendo",
      scanned: game,
      resolved: {
        key: libraryEntryKey("nintendo", game.externalId),
        status: "resolved",
        game: named,
        executables: [],
        candidates,
      },
      ignoredProcesses: useAppStore.getState().ignoredProcesses,
      account: scan.account,
    });
    if (!commit) continue;
    commits.push(commit);
    unknownGameCheckedAt.delete(game.externalId);
  }
  return commits;
}

function log(message: string) {
  useAppStore.getState().addRuntimeLogEntry(message);
}
