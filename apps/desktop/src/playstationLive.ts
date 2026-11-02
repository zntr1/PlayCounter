import type { Game } from "@playcounter/shared";
import { getT } from "./i18n";
import { currentPlatform } from "./platform";
import { gameMetadataKey, useAppStore, type ActiveSession } from "./store";
import { commitLibraryImports } from "./library/commit";
import { buildLibraryImportCommit } from "./library/importPlan";
import { useKeptLogins } from "./library/keptLogins";
import {
  isLauncherGameDismissed,
  readLibraryAutoAdd,
} from "./library/libraryAutoAddState";
import { getLoginHealth, recordLoginHealth } from "./library/loginHealth";
import {
  playStationScanResult,
  readPlayStationPresence,
  readSavedPlayStationGames,
  type PlayStationLiveGame,
} from "./library/playstationAccount";
import { resolveLibraryGames } from "./library/resolve";
import {
  libraryEntryKey,
  type LibraryImportCommit,
  type LibraryImportEntry,
  type ScannedLibraryGame,
} from "./library/types";

/*
 * Live from PlayStation (docs/psn-import-plan.md, "Live on PS5" and
 * "Auto-update"). While PlayCounter runs with a kept PlayStation sign-in and
 * the switch on, Sony's presence is read every minute. A PS5 or PS4 game of
 * My Games that Sony shows running becomes a session; its last sighting is
 * its end, so a sleeping PC or a lost connection never adds time. Sony's
 * played list is read again at start, every hour and a few minutes after a
 * console session: totals grow, and new games come in like new installs.
 */

const t = getT("import");

export const POLL_MS = 60_000;
/** Without a good answer from Sony this long, the session ends where it was
 *  last seen; a new one starts if the game still runs. */
export const LOST_AFTER_MS = 5 * 60_000;
export const RATE_LIMIT_WAIT_MS = 10 * 60_000;
export const REFRESH_EVERY_MS = 60 * 60_000;
export const REFRESH_AFTER_SESSION_MS = 5 * 60_000;
const FIRST_POLL_MS = 5_000;
const FIRST_REFRESH_MS = 30_000;
/** An unknown title asks Sony's list once in this long. */
const UNKNOWN_TITLE_RETRY_MS = 10 * 60_000;
/** The catalog often learns a new game's id days after its release. */
const UNKNOWN_GAME_RETRY_MS = 24 * 60 * 60_000;

type ConsoleSessions = {
  start: (params: {
    gameId: number;
    igdbId?: number;
    gameName: string;
    coverUrl: string;
    source: Game["source"] | null;
    titleId: string;
    platform: "PS5" | "PS4";
  }) => number | undefined;
  see: (sessionId: number) => void;
  end: (sessionId: number) => Promise<void>;
};

let sessions: ConsoleSessions | null = null;
let pollTimer: ReturnType<typeof setTimeout> | undefined;
let refreshTimer: ReturnType<typeof setTimeout> | undefined;
let afterSessionTimer: ReturnType<typeof setTimeout> | undefined;
let lastGoodPollAt = 0;
let waitUntil = 0;
let refreshInFlight: Promise<number> | undefined;
const unknownTitleCheckedAt = new Map<string, number>();
const unknownGameCheckedAt = new Map<string, number>();

export function initializePlayStationLive(consoleSessions: ConsoleSessions) {
  disposePlayStationLive();
  sessions = consoleSessions;
  // Sessions from before PlayCounter restarted end where Sony last showed
  // them; a game that still runs starts again with the first answer.
  void endConsoleSessions();
  pollTimer = setTimeout(() => void pollPresence(), FIRST_POLL_MS);
  refreshTimer = setTimeout(() => void refreshOnSchedule(), FIRST_REFRESH_MS);
}

export function disposePlayStationLive() {
  clearTimeout(pollTimer);
  clearTimeout(refreshTimer);
  clearTimeout(afterSessionTimer);
  pollTimer = refreshTimer = afterSessionTimer = undefined;
  sessions = null;
  lastGoodPollAt = 0;
  waitUntil = 0;
  refreshInFlight = undefined;
  unknownTitleCheckedAt.clear();
  unknownGameCheckedAt.clear();
}

function signedIn() {
  return (
    useKeptLogins
      .getState()
      .logins.some((login) => login.service === "playstation") &&
    getLoginHealth("playstation")?.status !== "needsSignIn"
  );
}

function liveOn() {
  return useAppStore.getState().settings.playstationLiveOff !== true;
}

function playStationImports() {
  return [...useAppStore.getState().libraryImports.values()].filter(
    (entry) => entry.provider === "playstation",
  );
}

function consoleSessions() {
  return useAppStore
    .getState()
    .activeSessions.filter((session) => session.console);
}

/** The game of My Games whose PlayStation copy this title id is. */
function gameForTitle(titleId: string): LibraryImportEntry | undefined {
  return playStationImports().find((entry) =>
    entry.consoleTitleIds?.includes(titleId),
  );
}

function isSameGame(session: ActiveSession, entry: LibraryImportEntry) {
  return (
    session.gameId === entry.gameId &&
    (session.source ?? "igdb") === entry.source
  );
}

async function endConsoleSessions() {
  for (const session of consoleSessions()) {
    await sessions?.end(session.id);
  }
}

/** One presence read. Exported for tests; the timer calls it every minute. */
export async function pollPresence() {
  try {
    if (
      currentPlatform() !== "windows" ||
      !signedIn() ||
      !liveOn() ||
      playStationImports().length === 0
    ) {
      await endConsoleSessions();
      return;
    }
    if (Date.now() < waitUntil) {
      await endIfLost();
      return;
    }
    const read = await readPlayStationPresence();
    if (read.rateLimited) {
      waitUntil = Date.now() + RATE_LIMIT_WAIT_MS;
      await endIfLost();
      return;
    }
    if (read.status === "needsSignIn") {
      recordLoginHealth("playstation", "needsSignIn");
      await endConsoleSessions();
      return;
    }
    if (read.status !== "valid" || !read.value) {
      await endIfLost();
      return;
    }
    // A sleeping PC or a long outage: what came before ended back then.
    await endIfLost();
    lastGoodPollAt = Date.now();
    await follow(read.value.game);
  } catch (error) {
    log(
      `playstation presence failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    await endIfLost();
  } finally {
    if (sessions) {
      clearTimeout(pollTimer);
      pollTimer = setTimeout(() => void pollPresence(), POLL_MS);
    }
  }
}

async function endIfLost() {
  if (lastGoodPollAt !== 0 && Date.now() - lastGoodPollAt > LOST_AFTER_MS)
    await endConsoleSessions();
}

async function follow(game: PlayStationLiveGame | null) {
  if (!sessions) return;
  const match = game ? gameForTitle(game.titleId) : undefined;
  let running = false;
  for (const session of consoleSessions()) {
    if (match && isSameGame(session, match)) {
      sessions.see(session.id);
      running = true;
    } else {
      await sessions.end(session.id);
      scheduleRefreshAfterSession();
    }
  }
  if (!game || running) return;
  if (!match) {
    // A new game: Sony's list may know it already. Netflix and other apps
    // are never in that list and start nothing.
    const checkedAt = unknownTitleCheckedAt.get(game.titleId) ?? -Infinity;
    if (Date.now() - checkedAt >= UNKNOWN_TITLE_RETRY_MS) {
      unknownTitleCheckedAt.set(game.titleId, Date.now());
      void refreshPlayStationGames("unknown title");
    }
    return;
  }
  sessions.start({
    gameId: match.gameId,
    igdbId: match.igdbId,
    gameName: match.name,
    coverUrl: match.coverUrl,
    source: match.source,
    titleId: game.titleId,
    platform: game.platform,
  });
}

function scheduleRefreshAfterSession() {
  clearTimeout(afterSessionTimer);
  afterSessionTimer = setTimeout(
    () => void refreshPlayStationGames("after a console session"),
    REFRESH_AFTER_SESSION_MS,
  );
}

async function refreshOnSchedule() {
  await refreshPlayStationGames("schedule");
  if (sessions) {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(
      () => void refreshOnSchedule(),
      REFRESH_EVERY_MS,
    );
  }
}

/**
 * Reads Sony's played list with the kept sign-in: imported games take Sony's
 * newer totals, and new games IGDB knows are added, unless the player turned
 * adding new games off or removed that game. Returns how many were added.
 */
export function refreshPlayStationGames(reason: string): Promise<number> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = runRefresh(reason)
    .catch((error: unknown) => {
      log(
        `playstation refresh failed reason=${reason}: ${error instanceof Error ? error.message : String(error)}`,
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
    playStationImports().length === 0
  )
    return 0;
  const read = await readSavedPlayStationGames();
  if (read.status === "needsSignIn") {
    recordLoginHealth("playstation", "needsSignIn");
    return 0;
  }
  if (read.status !== "valid" || !read.value) return 0;
  const scan = playStationScanResult(read.value);
  const now = new Date().toISOString();
  const state = useAppStore.getState();
  const commits: LibraryImportCommit[] = [];
  const fresh: ScannedLibraryGame[] = [];
  for (const game of scan.games) {
    const existing = state.libraryImports.get(
      libraryEntryKey("playstation", game.externalId),
    );
    if (!existing) fresh.push(game);
    else {
      const commit = updatedCommit(existing, game, now);
      if (commit) commits.push(commit);
    }
  }
  const added = await newGameCommits(fresh);
  commits.push(...added);
  if (commits.length > 0) commitLibraryImports(commits);
  log(
    `playstation refresh reason=${reason} games=${scan.games.length} updated=${commits.length - added.length} added=${added.length}`,
  );
  if (added.length > 0) {
    useAppStore.getState().addToast({
      tone: "success",
      title: t("{{count}} games added", { count: added.length }),
      detail: t(
        "New games you play on PlayStation now show up in My Games on their own. You can turn this off in Settings under Library import.",
      ),
    });
  }
  return added.length;
}

/** Only what Sony changed: a higher total, a new copy, a later play. */
function updatedCommit(
  existing: LibraryImportEntry,
  game: ScannedLibraryGame,
  now: string,
): LibraryImportCommit | null {
  const seconds =
    game.playtimeSeconds === null
      ? null
      : Math.max(0, Math.floor(game.playtimeSeconds));
  const titleIds = [
    ...new Set([
      ...(existing.consoleTitleIds ?? []),
      ...(game.consoleTitleIds ?? []),
    ]),
  ];
  const lastPlayedAt = game.lastPlayedUnix
    ? new Date(game.lastPlayedUnix * 1000).toISOString()
    : undefined;
  const grew =
    seconds !== null &&
    (existing.providerSeconds === null || seconds > existing.providerSeconds);
  const newCopy = titleIds.length > (existing.consoleTitleIds?.length ?? 0);
  const playedLater =
    lastPlayedAt !== undefined &&
    (!existing.providerLastPlayedAt ||
      Date.parse(lastPlayedAt) > Date.parse(existing.providerLastPlayedAt));
  if (!grew && !newCopy && !playedLater) return null;
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
      ...existing,
      // A total that didn't grow is not a new read: the console sessions
      // PlayCounter saw since the last one still count on top of it.
      providerSeconds: grew ? seconds : null,
      providerHasPlayedEvidence: true,
      providerLastPlayedAt: lastPlayedAt ?? existing.providerLastPlayedAt,
      lastReadAt: grew ? now : existing.lastReadAt,
      consoleTitleIds: titleIds,
    },
    metadata,
    preserveInstall: true,
    exeCacheEntries: [],
    scopedLinks: [],
  };
}

async function newGameCommits(fresh: ScannedLibraryGame[]) {
  const state = useAppStore.getState();
  if (fresh.length === 0 || state.settings.autoAddInstalledGames === false)
    return [];
  const record = readLibraryAutoAdd();
  const now = Date.now();
  const candidates = fresh.filter(
    (game) =>
      // Someone else may have played it on the account: only the importer,
      // where the player picks it.
      !game.consoleUnknown &&
      !isLauncherGameDismissed(record, {
        provider: "playstation",
        externalId: game.externalId,
      }) &&
      now - (unknownGameCheckedAt.get(game.externalId) ?? -Infinity) >=
        UNKNOWN_GAME_RETRY_MS,
  );
  if (candidates.length === 0) return [];
  const lookup = await resolveLibraryGames(
    state.settings.apiEndpoint,
    "playstation",
    candidates,
  );
  if (lookup.capability !== "supported") return [];
  const resolved = new Map(lookup.games.map((game) => [game.key, game]));
  const commits: LibraryImportCommit[] = [];
  for (const game of candidates) {
    unknownGameCheckedAt.set(game.externalId, now);
    const match = resolved.get(libraryEntryKey("playstation", game.externalId));
    if (!match) continue;
    const commit = buildLibraryImportCommit({
      provider: "playstation",
      scanned: game,
      resolved: match,
      ignoredProcesses: useAppStore.getState().ignoredProcesses,
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
