import type {
  Game,
  GameMetadataResponse,
  MatchProcessesResponse,
  Platform,
  ProcessIdentifier,
  Session,
  Settings,
} from "@playcounter/shared";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import {
  useAppStore,
  DEFAULT_API_ENDPOINT,
  gameMetadataKey,
  type ActiveSession,
  type AmbiguousProcessMatch,
  type ExeCacheEntry,
  type GameMetadata,
  type ProcessSnapshot,
} from "./store";
import { matchesProcessPatternSet } from "./ignoredProcessPatterns";

const STORAGE_KEY = "playcounter:v1";
const CUSTOM_GAME_ID_BASE = -1_000_000_000;
const FAKE_HISTORY_GAME_ID_BASE = -900_000_000;
const FAKE_HISTORY_SESSION_ID_BASE = -900_000_000;
const FAKE_HISTORY_EXE_PREFIX = "playcounter-fake-";
const SESSION_CHECKPOINT_INTERVAL_MS = 60_000;
// Minimum accumulated discovered runtime before it is credited to a game on
// take-over. Avoids polluting history with a few seconds of background noise.
const MIN_BACKFILL_SECONDS = 60;
const BACKEND_HEALTH_INTERVAL_MS = 60_000;
const BACKEND_HEALTH_TIMEOUT_MS = 2_500;
const API_REQUEST_TIMEOUT_MS = 8_000;
export const PENDING_COMMUNITY_RETRY_MS = 5 * 60 * 1000;

type PersistedState = {
  installUuid?: string;
  settings?: Partial<Settings>;
  exeCache?: ExeCacheEntry[];
  gameMetadata?: GameMetadata[];
  ambiguousMatches?: AmbiguousProcessMatch[];
  sessions?: Session[];
  activeSession?: ActiveSession;
  activeSessions?: ActiveSession[];
  blacklist?: string[];
};

type ProcessMatch = {
  process: ProcessSnapshot;
  game: Game;
  startedAt?: string;
};

type IgnoredProcessesResponse = {
  processes: string[];
  userProcesses?: string[];
  userFilePath: string;
};

// Last time each custom game's exe was sent to the community upgrade check.
// Without this the check fires on every process scan (every few seconds) for
// the whole time a custom game is running. Not persisted; a restart re-checks
// once, which is what the startup approval recheck does anyway.
const communityUpgradeCheckedAt = new Map<string, number>();

let initialized = false;
let backendHealthTimer: number | undefined;
let processTimer: number | undefined;
let trayTimer: number | undefined;
let unsubscribeTraySync: (() => void) | undefined;
let nextSessionSequence = 0;
let scanInFlight: Promise<void> | undefined;
let scanQueued = false;

const launcherBlacklist = [
  "epicgameslauncher.exe",
  "steam.exe",
  "battle.net.exe",
  "eadesktop.exe",
  "goggalaxy.exe",
  "ubisoftconnect.exe",
];

export async function initializeTracker() {
  if (initialized) return;
  initialized = true;
  logRuntime("tracker initialize started");

  hydrate();
  syncTrayNowPlaying();
  scheduleTraySync();
  unsubscribeTraySync = useAppStore.subscribe((state, previousState) => {
    if (state.activeSessions !== previousState.activeSessions) {
      syncTrayNowPlaying();
      scheduleTraySync();
    }
  });
  logRuntime("tracker state hydrated");

  window.setTimeout(() => {
    void finishTrackerStartup();
  }, 1_000);
}

async function finishTrackerStartup() {
  logRuntime("tracker deferred startup started");
  await loadIgnoredProcesses();
  scheduleProcessPolling(
    useAppStore.getState().settings.pollingIntervalSeconds,
  );
  logRuntime("tracker process polling scheduled");

  try {
    const installUuid = await getInstallUuid();
    useAppStore.getState().setInstallUuid(installUuid);
    persist();
    logRuntime("install UUID loaded");
  } catch (error) {
    logRuntime(`install UUID failed: ${formatError(error)}`);
    useAppStore
      .getState()
      .setRuntimeError(`Tauri command failed: ${formatError(error)}`);
  }

  void closeStaleSession();
  scheduleBackendHealthChecks();

  logRuntime("process listener skipped; polling is active");

  useAppStore.getState().setCleanup(() => {
    logRuntime("tracker cleanup running");
    if (backendHealthTimer) window.clearInterval(backendHealthTimer);
    backendHealthTimer = undefined;
    if (processTimer) window.clearInterval(processTimer);
    processTimer = undefined;
    if (trayTimer) window.clearInterval(trayTimer);
    trayTimer = undefined;
    unsubscribeTraySync?.();
    unsubscribeTraySync = undefined;
    initialized = false;
  });

  window.setTimeout(() => {
    void (async () => {
      await recheckPendingCommunityApprovals("startup");
      await requestProcessScan("startup");
    })();
  }, 1_500);
}

// Early tester builds shipped with the test API baked in as the default, which
// then got persisted to localStorage. A normal update changes the build-time
// default but not the persisted value, so those clients would keep hitting the
// test API forever. On hydrate we rewrite the known stale test endpoint to the
// current build default. In a test build DEFAULT_API_ENDPOINT is that same test
// URL, so this is a no-op there — only prod builds move testers onto the prod API.
const LEGACY_API_ENDPOINTS = new Set([
  "https://app-playcounter-api-001.azurewebsites.net",
]);

function migrateApiEndpoint(settings: Settings): Settings {
  const current = settings.apiEndpoint?.replace(/\/+$/, "");
  if (current && LEGACY_API_ENDPOINTS.has(current)) {
    logRuntime(
      `migrating stale API endpoint ${current} -> ${DEFAULT_API_ENDPOINT}`,
    );
    return { ...settings, apiEndpoint: DEFAULT_API_ENDPOINT };
  }
  return settings;
}

function hydrate() {
  const persisted = readPersisted();
  const settings = migrateApiEndpoint({
    ...useAppStore.getState().settings,
    ...persisted.settings,
  });
  const blacklist = persisted.blacklist ?? [];
  const exeCache = persisted.exeCache ?? [];
  logRuntime(
    `hydrate loaded cache=${exeCache.length}, blacklist=${blacklist.length}, sessions=${persisted.sessions?.length ?? 0}`,
  );
  useAppStore.setState({
    installUuid: persisted.installUuid ?? null,
    settings,
    exeCache: new Map(
      exeCache.map((entry) => {
        // Drop any open running window: runtime while the app was closed cannot
        // be observed and must not be credited. Accumulated time is kept.
        const { runningSince: _r, ...rest } = entry;
        return [entry.exeName.toLowerCase(), rest];
      }),
    ),
    gameMetadata: new Map(
      (persisted.gameMetadata ?? []).map((game) => [
        gameMetadataKey(game),
        game,
      ]),
    ),
    recentSessions: persisted.sessions ?? [],
    activeSessions: normalizePersistedActiveSessions(persisted),
    ambiguousMatches: persisted.ambiguousMatches ?? [],
    blacklist: new Set(blacklist.map((exe) => exe.toLowerCase())),
  });
}

async function getInstallUuid() {
  const persisted = readPersisted();
  if (persisted.installUuid) {
    verboseRuntime("install UUID using persisted value");
    return persisted.installUuid;
  }
  logRuntime("install UUID requesting Tauri command");
  return invoke<string>("install_uuid");
}

export async function reloadIgnoredProcesses() {
  logRuntime("ignored processes reload requested");
  await loadIgnoredProcesses();
  void requestProcessScan("after ignore reload");
}

async function loadIgnoredProcesses() {
  try {
    logRuntime("ignored process list loading");
    const ignored = await invoke<IgnoredProcessesResponse>("ignored_processes");
    useAppStore
      .getState()
      .setIgnoredProcesses(
        ignored.processes,
        ignored.userFilePath,
        ignored.userProcesses,
      );
    logRuntime(
      `ignored process list loaded entries=${ignored.processes.length}, userFile=${ignored.userFilePath}`,
    );
  } catch (error) {
    useAppStore.getState().setIgnoredProcesses(launcherBlacklist, null);
    logRuntime(`ignored process list failed: ${formatError(error)}`);
    useAppStore
      .getState()
      .setRuntimeError(`Ignored process list failed: ${formatError(error)}`);
  }
}

export async function setUserIgnoredProcess(exeName: string, ignored: boolean) {
  logRuntime(
    `user ignored process ${ignored ? "add" : "remove"} requested ${exeName}`,
  );
  const response = await invoke<IgnoredProcessesResponse>(
    "set_user_ignored_process",
    {
      exeName,
      ignored,
    },
  );
  useAppStore
    .getState()
    .setIgnoredProcesses(
      response.processes,
      response.userFilePath,
      response.userProcesses,
    );
  logRuntime(
    `user ignored process ${ignored ? "added" : "removed"} ${exeName}`,
  );
  void requestProcessScan("after ignored process update");
}

export async function doNotTrackGame(
  gameId: number,
  source: Game["source"] | null,
  exeNames: string[] = [],
  removeHistory = false,
) {
  const state = useAppStore.getState();
  const matchingExeNames = [
    ...new Set(
      [
        ...exeNames,
        ...[...state.exeCache.values()]
          .filter(
            (entry) =>
              entry.state === "matched" &&
              entry.gameId === gameId &&
              (source ? entry.source === source : true),
          )
          .map((entry) => entry.exeName),
      ].filter((exeName) => exeName.trim().length > 0),
    ),
  ];

  for (const exeName of matchingExeNames) {
    await setUserIgnoredProcess(exeName, true);
  }
  untrackGame(gameId, source, removeHistory);
}

export async function openUserIgnoredProcessesFolder() {
  logRuntime("user ignored processes folder open requested");
  await invoke("open_user_ignored_processes_folder");
}

async function handleProcessSnapshot(processes: ProcessSnapshot[]) {
  const startedAt = Date.now();
  const normalized = uniqueProcesses(processes);
  useAppStore.getState().setProcesses(normalized);

  const state = useAppStore.getState();
  const ignored = normalized.filter((process) =>
    isIgnoredProcess(process.exeName, state),
  );
  const candidates = normalized.filter(
    (process) => !isIgnoredProcess(process.exeName, state),
  );
  logRuntime(
    `scan handling total=${processes.length}, unique=${normalized.length}, ignored=${ignored.length}, candidates=${candidates.length}`,
  );
  verboseRuntime(`scan ignored: ${formatExeSample(ignored)}`);
  const matches = await resolveProcesses(candidates);
  logRuntime(`scan resolved matches=${matches.length}`);

  const currentSessions = useAppStore.getState().activeSessions;
  const currentAmbiguous = useAppStore.getState().ambiguousMatches;
  const nextKeys = new Set(
    matches.map((match) =>
      activeSessionKey(match.process.exeName, match.game.id, match.game.source),
    ),
  );
  const runningProcessKeys = new Set(
    candidates.map((process) => process.exeName.toLowerCase()),
  );

  for (const current of currentSessions) {
    if (nextKeys.has(sessionIdentityKey(current))) {
      checkpointActiveSessionIfDue(current);
      verboseRuntime(
        `scan active session unchanged ${current.gameName} (${current.exeName})`,
      );
      continue;
    }

    logRuntime(
      `scan match ended; ending active session ${current.gameName} (${current.exeName})`,
    );
    await endSession(current, recoveredSessionEndAt(current));
  }

  for (const ambiguous of currentAmbiguous) {
    if (!runningProcessKeys.has(ambiguous.exeName.toLowerCase())) {
      useAppStore.getState().setAmbiguousMatch({
        ...ambiguous,
        endedAt: ambiguous.endedAt ?? new Date().toISOString(),
      });
      logRuntime(`ambiguous match stopped running ${ambiguous.exeName}`);
    }
  }

  const activeAfterEnds = useAppStore.getState().activeSessions;
  const activeKeys = new Set(
    activeAfterEnds.map((session) => sessionIdentityKey(session)),
  );

  for (const match of matches) {
    const key = activeSessionKey(
      match.process.exeName,
      match.game.id,
      match.game.source,
    );
    if (!activeKeys.has(key)) {
      startSession(match.process, match.game, match.startedAt);
    }
  }

  if (matches.length === 0 && currentSessions.length === 0) {
    logRuntime("scan no match; app remains idle");
  }

  accumulateUnmatchedRuntime(runningProcessKeys);

  persist();
  logRuntime(`scan complete durationMs=${Date.now() - startedAt}`);
}

function isIgnoredProcess(
  exeName: string,
  state: { blacklist: Set<string>; ignoredProcesses: Set<string> },
) {
  return (
    matchesProcessPatternSet(exeName, state.blacklist) ||
    matchesProcessPatternSet(exeName, state.ignoredProcesses)
  );
}

type CachedResolution =
  | { state: "matched"; game: Game }
  | { state: "skipped" }
  | { state: "query" };

async function resolveProcesses(
  processes: ProcessSnapshot[],
  options: { forceQueryKeys?: Set<string> } = {},
): Promise<ProcessMatch[]> {
  const state = useAppStore.getState();
  const now = Date.now();
  const ttlMs = state.settings.unmatchedRetryDays * 24 * 60 * 60 * 1000;
  const matches: ProcessMatch[] = [];
  const queryProcesses: ProcessSnapshot[] = [];
  const customUpgradeProcesses: ProcessSnapshot[] = [];
  const ambiguousByKey = new Map(
    state.ambiguousMatches.map((match) => [match.exeName.toLowerCase(), match]),
  );
  let cacheMatchedCount = 0;
  let cacheSkippedCount = 0;

  for (const process of processes) {
    const existing = state.exeCache.get(process.exeName.toLowerCase());
    if (
      existing?.state === "matched" &&
      existing.source === "custom" &&
      now - (communityUpgradeCheckedAt.get(processCacheKey(process)) ?? 0) >=
        PENDING_COMMUNITY_RETRY_MS
    ) {
      customUpgradeProcesses.push(process);
    }
    if (options.forceQueryKeys?.has(processCacheKey(process))) {
      queryProcesses.push(process);
      continue;
    }
    // An unresolved ambiguity has no exe cache entry and would otherwise be
    // re-queried on every scan; the stored candidates keep driving the UI.
    const ambiguous = ambiguousByKey.get(processCacheKey(process));
    if (
      ambiguous &&
      now - Date.parse(ambiguous.lastCheckedAt ?? ambiguous.detectedAt) <
        PENDING_COMMUNITY_RETRY_MS
    ) {
      cacheSkippedCount += 1;
      continue;
    }
    const cached = resolveCachedProcess(process, state.exeCache, now, ttlMs);
    if (cached.state === "matched") {
      matches.push({ process, game: cached.game });
      cacheMatchedCount += 1;
    } else if (cached.state === "query") {
      queryProcesses.push(process);
    } else {
      cacheSkippedCount += 1;
    }
  }

  if (customUpgradeProcesses.length > 0) {
    void checkCommunityUpgrades(customUpgradeProcesses);
  }

  logRuntime(
    `match resolve cacheMatched=${cacheMatchedCount}, cacheSkipped=${cacheSkippedCount}, batchQuery=${queryProcesses.length}`,
  );
  verboseRuntime(`match batch query exes: ${formatExeSample(queryProcesses)}`);

  if (queryProcesses.length === 0) {
    logRuntime("match resolve completed without API call");
    return matches;
  }

  try {
    const requestStartedAt = Date.now();
    logRuntime(
      `match API batch request started count=${queryProcesses.length}`,
    );
    const response = await fetchWithTimeout(
      `${state.settings.apiEndpoint}/api/match-processes`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        timeoutMs: API_REQUEST_TIMEOUT_MS,
        body: JSON.stringify({
          processes: queryProcesses.map((process) => ({
            key: processCacheKey(process),
            identifiers: processIdentifiers(process),
          })),
        }),
      },
    );
    if (!response.ok)
      throw new Error(`${response.status} ${response.statusText}`);

    const body = (await response.json()) as MatchProcessesResponse;
    const matchedCount = body.matches.filter((match) => match.game).length;
    logRuntime(
      `match API batch response ok count=${body.matches.length}, matched=${matchedCount}, durationMs=${Date.now() - requestStartedAt}`,
    );
    const resultsByExe = new Map(
      body.matches.map((match) => [match.key.toLowerCase(), match]),
    );

    for (const process of queryProcesses) {
      const result = resultsByExe.get(processCacheKey(process));
      if (result?.ambiguousGames?.length) {
        cacheAmbiguousMatch(process, result.ambiguousGames);
        continue;
      }
      if (result?.pendingCommunityGame) {
        cachePendingCommunityMatch(
          process.exeName,
          result.pendingCommunityGame,
        );
        continue;
      }

      const game = result?.game ?? null;
      cacheMatchResult(process.exeName, game);
      if (game) matches.push({ process, game });
    }
  } catch (error) {
    logRuntime(
      `match API batch failed count=${queryProcesses.length}: ${formatError(error)}`,
    );
    state.addApiRequestLogEntry({
      endpoint: state.settings.apiEndpoint,
      exeName: `${queryProcesses.length} executables`,
      status: "error",
      detail: formatError(error),
    });
    if (
      state.backendHealth.status === "offline" ||
      state.backendHealth.status === "reconnecting"
    ) {
      verboseRuntime(
        "match API unavailable; leaving uncached executables pending",
      );
    } else {
      state.setRuntimeError(`Match API failed: ${formatError(error)}`);
    }
  }

  return matches;
}

async function checkCommunityUpgrades(processes: ProcessSnapshot[]) {
  const state = useAppStore.getState();
  // Recorded before the request so a failing backend is not retried on every
  // scan either; the next attempt waits a full interval.
  const now = Date.now();
  for (const process of processes) {
    communityUpgradeCheckedAt.set(processCacheKey(process), now);
  }
  try {
    const response = await fetchWithTimeout(
      `${state.settings.apiEndpoint}/api/match-processes`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        timeoutMs: API_REQUEST_TIMEOUT_MS,
        body: JSON.stringify({
          processes: processes.map((process) => ({
            key: processCacheKey(process),
            identifiers: processIdentifiers(process),
          })),
        }),
      },
    );
    if (!response.ok)
      throw new Error(`${response.status} ${response.statusText}`);

    const body = (await response.json()) as MatchProcessesResponse;
    for (const result of body.matches) {
      if (result.game && result.game.source !== "custom") {
        setCommunityUpgrade(result.key, result.game);
        continue;
      }
      if (result.pendingCommunityGame) {
        setCommunitySuggestionMarker(
          result.key,
          result.pendingCommunityGame,
          false,
        );
        continue;
      }
      applyCommunitySuggestionOutcome(result.key, result.ambiguousGames);
    }
  } catch (error) {
    verboseRuntime(`community upgrade check failed: ${formatError(error)}`);
  }
}

// A pending suggestion that no longer comes back from the server was rejected:
// rejected suggestions are deleted from the community database, so the game
// falls back to a plain local one. An ambiguous response is inconclusive (the
// server skips the pending check for ambiguous identifiers) — unless the
// user's own suggestion is among the candidates, which means it was approved.
function applyCommunitySuggestionOutcome(
  exeName: string,
  ambiguousGames?: Game[],
) {
  const existing = useAppStore.getState().exeCache.get(exeName.toLowerCase());
  if (
    existing?.state !== "matched" ||
    existing.source !== "custom" ||
    !existing.communitySuggestionId ||
    existing.communitySuggestionVerified
  ) {
    return;
  }

  const approved = ambiguousGames?.find(
    (game) =>
      game.source === "community" &&
      game.id === existing.communitySuggestionId,
  );
  if (approved) {
    setCommunityUpgrade(exeName, approved);
    return;
  }
  if (ambiguousGames?.length) return;

  clearCommunitySuggestionMarker(exeName);
}

function clearCommunitySuggestionMarker(exeName: string) {
  const key = exeName.toLowerCase();
  useAppStore.setState((state) => {
    const existing = state.exeCache.get(key);
    if (existing?.state !== "matched" || existing.source !== "custom") {
      return {};
    }

    const exeCache = new Map(state.exeCache);
    exeCache.set(key, {
      ...existing,
      communitySuggestionId: undefined,
      communitySuggestionVerified: undefined,
    });
    return {
      exeCache,
      activeSessions: state.activeSessions.map((session) =>
        session.exeName.toLowerCase() === key && session.source === "custom"
          ? {
              ...session,
              communitySuggestionId: undefined,
              communitySuggestionVerified: undefined,
            }
          : session,
      ),
      recentSessions: state.recentSessions.map((session) =>
        session.exeName.toLowerCase() === key && session.source === "custom"
          ? {
              ...session,
              communitySuggestionId: undefined,
              communitySuggestionVerified: undefined,
            }
          : session,
      ),
    };
  });
  logRuntime(`community suggestion rejected; now plain local ${exeName}`);
}

function setCommunitySuggestionMarker(
  exeName: string,
  game: Game,
  verified: boolean,
) {
  useAppStore.setState((state) => {
    const key = exeName.toLowerCase();
    const existing = state.exeCache.get(key);
    if (existing?.state !== "matched" || existing.source !== "custom") {
      return {};
    }

    const exeCache = new Map(state.exeCache);
    exeCache.set(key, {
      ...existing,
      communitySuggestionId: game.id,
      communitySuggestionVerified: verified,
    });
    return {
      exeCache,
      activeSessions: state.activeSessions.map((session) =>
        session.exeName.toLowerCase() === key && session.source === "custom"
          ? {
              ...session,
              communitySuggestionId: game.id,
              communitySuggestionVerified: verified,
            }
          : session,
      ),
    };
  });
}

// A dismissal recorded before igdb upgrades existed has no source; those were
// always community games.
function isDismissedUpgrade(entry: ExeCacheEntry, game: Game) {
  return (
    entry.dismissedCommunityUpgradeGameId === game.id &&
    (entry.dismissedCommunityUpgradeSource ?? "community") === game.source
  );
}

// Records a database match found for a custom game. A community game the user
// suggested themselves is applied directly; anything else (someone else's
// community game or an igdb match) becomes an upgrade offer.
function setCommunityUpgrade(exeName: string, game: Game) {
  let promoted = false;
  useAppStore.setState((state) => {
    const key = exeName.toLowerCase();
    const existing = state.exeCache.get(key);
    if (
      existing?.state !== "matched" ||
      existing.source !== "custom" ||
      isDismissedUpgrade(existing, game)
    ) {
      return {};
    }

    const exeCache = new Map(state.exeCache);
    if (
      game.source === "community" &&
      existing.communitySuggestionId === game.id
    ) {
      promoted = true;
      const oldGameId = existing.gameId;
      exeCache.set(key, {
        ...existing,
        gameId: game.id,
        gameName: game.name,
        coverUrl: game.coverUrl,
        source: "community",
        communitySuggestionId: game.id,
        communitySuggestionVerified: true,
        communityUpgradeGame: undefined,
        lastCheckedAt: new Date().toISOString(),
      });
      return {
        exeCache,
        activeSessions: state.activeSessions.map((session) =>
          session.exeName.toLowerCase() === key && session.source === "custom"
            ? {
                ...session,
                gameId: game.id,
                gameName: game.name,
                coverUrl: game.coverUrl,
                source: "community",
                communitySuggestionId: game.id,
                communitySuggestionVerified: true,
              }
            : session,
        ),
        recentSessions: state.recentSessions.map((session) =>
          session.exeName.toLowerCase() === key && session.gameId === oldGameId
            ? {
                ...session,
                gameId: game.id,
                gameName: game.name,
                coverUrl: game.coverUrl,
                source: "community",
                communitySuggestionId: game.id,
                communitySuggestionVerified: true,
              }
            : session,
        ),
      };
    }

    if (game.source !== "community") {
      exeCache.set(key, { ...existing, communityUpgradeGame: game });
      return { exeCache };
    }

    exeCache.set(key, {
      ...existing,
      communitySuggestionId: existing.communitySuggestionId ?? game.id,
      communitySuggestionVerified: true,
      communityUpgradeGame: game,
    });
    return {
      exeCache,
      activeSessions: state.activeSessions.map((session) =>
        session.exeName.toLowerCase() === key && session.source === "custom"
          ? {
              ...session,
              communitySuggestionId: existing.communitySuggestionId ?? game.id,
              communitySuggestionVerified: true,
            }
          : session,
      ),
    };
  });
  if (promoted) {
    logRuntime(`community suggestion approved ${exeName} -> ${game.name}`);
    persist();
  }
}

export function acceptCommunityUpgrade(exeName: string) {
  const state = useAppStore.getState();
  const key = exeName.toLowerCase();
  const existing = state.exeCache.get(key);
  const game = existing?.communityUpgradeGame;
  if (existing?.state !== "matched" || existing.source !== "custom" || !game) {
    return;
  }

  const oldGameId = existing.gameId;
  const suggestionId =
    game.source === "community" ? existing.communitySuggestionId : undefined;
  const suggestionVerified = game.source === "community" ? true : undefined;
  state.setExeCacheEntry({
    exeName: existing.exeName,
    state: "matched",
    gameId: game.id,
    gameName: game.name,
    coverUrl: game.coverUrl,
    source: game.source,
    lastCheckedAt: new Date().toISOString(),
  });

  useAppStore.setState((current) => ({
    activeSessions: current.activeSessions.map((session) =>
      session.exeName.toLowerCase() === key && session.source === "custom"
        ? {
            ...session,
            gameId: game.id,
            gameName: game.name,
            coverUrl: game.coverUrl,
            source: game.source,
            communitySuggestionId: suggestionId,
            communitySuggestionVerified: suggestionVerified,
          }
        : session,
    ),
    recentSessions: current.recentSessions.map((session) =>
      session.exeName.toLowerCase() === key && session.gameId === oldGameId
        ? {
            ...session,
            gameId: game.id,
            gameName: game.name,
            coverUrl: game.coverUrl,
            source: game.source,
            communitySuggestionId: suggestionId,
            communitySuggestionVerified: suggestionVerified,
          }
        : session,
    ),
  }));

  logRuntime(`community upgrade accepted ${existing.exeName} -> ${game.name}`);
  persist();
  void requestProcessScan("after community upgrade accepted");
}

export function convertLocalSuggestionToCommunity(exeName: string) {
  const state = useAppStore.getState();
  const key = exeName.toLowerCase();
  const existing = state.exeCache.get(key);
  if (
    existing?.state !== "matched" ||
    existing.source !== "custom" ||
    !existing.communitySuggestionId ||
    !existing.communitySuggestionVerified
  ) {
    return;
  }

  const oldGameId = existing.gameId;
  const communityGame: Game = {
    id: existing.communitySuggestionId,
    name: existing.gameName ?? exeName,
    coverUrl: existing.coverUrl ?? "",
    source: "community",
  };

  state.setExeCacheEntry({
    exeName: existing.exeName,
    state: "matched",
    gameId: communityGame.id,
    gameName: communityGame.name,
    coverUrl: communityGame.coverUrl,
    source: "community",
    communitySuggestionId: existing.communitySuggestionId,
    communitySuggestionVerified: true,
    lastCheckedAt: new Date().toISOString(),
  });

  useAppStore.setState((current) => ({
    activeSessions: current.activeSessions.map((session) =>
      session.exeName.toLowerCase() === key && session.source === "custom"
        ? {
            ...session,
            gameId: communityGame.id,
            gameName: communityGame.name,
            coverUrl: communityGame.coverUrl,
            source: "community",
            communitySuggestionId: existing.communitySuggestionId,
            communitySuggestionVerified: true,
          }
        : session,
    ),
    recentSessions: current.recentSessions.map((session) =>
      session.exeName.toLowerCase() === key && session.gameId === oldGameId
        ? {
            ...session,
            gameId: communityGame.id,
            gameName: communityGame.name,
            coverUrl: communityGame.coverUrl,
            source: "community",
            communitySuggestionId: existing.communitySuggestionId,
            communitySuggestionVerified: true,
          }
        : session,
    ),
  }));

  logRuntime(`local suggestion converted to community ${exeName}`);
  persist();
  void requestProcessScan("after local suggestion conversion");
}

export function dismissCommunityUpgrade(exeName: string) {
  useAppStore.setState((state) => {
    const key = exeName.toLowerCase();
    const existing = state.exeCache.get(key);
    const game = existing?.communityUpgradeGame;
    if (
      existing?.state !== "matched" ||
      existing.source !== "custom" ||
      !game
    ) {
      return {};
    }

    const exeCache = new Map(state.exeCache);
    exeCache.set(key, {
      ...existing,
      communityUpgradeGame: undefined,
      dismissedCommunityUpgradeGameId: game.id,
      dismissedCommunityUpgradeSource: game.source,
    });
    return { exeCache };
  });
  logRuntime(`community upgrade dismissed ${exeName}`);
  persist();
}

function cachePendingCommunityMatch(exeName: string, game: Game) {
  const state = useAppStore.getState();
  const checkedAt = new Date().toISOString();
  const existing = state.exeCache.get(exeName.toLowerCase());
  state.addApiRequestLogEntry({
    endpoint: state.settings.apiEndpoint,
    exeName,
    status: "unmatched",
    detail: `Awaiting community approval: ${game.name}`,
  });
  state.setExeCacheEntry({
    exeName,
    state: "unmatched",
    pendingCommunityGame: game,
    lastCheckedAt: checkedAt,
    // Keep accumulated discovered runtime while it awaits approval.
    trackedSeconds:
      existing?.state === "unmatched" ? existing.trackedSeconds : undefined,
    runningSince:
      existing?.state === "unmatched" ? existing.runningSince : undefined,
  });
  logRuntime(`match pending community approval ${exeName} -> ${game.name}`);
}

function cacheAmbiguousMatch(process: ProcessSnapshot, candidates: Game[]) {
  const state = useAppStore.getState();
  const existing = state.ambiguousMatches.find(
    (match) => match.exeName.toLowerCase() === process.exeName.toLowerCase(),
  );
  state.setAmbiguousMatch({
    exeName: process.exeName,
    exePath: process.exePath,
    candidates,
    detectedAt: existing?.detectedAt ?? new Date().toISOString(),
    endedAt: undefined,
    lastCheckedAt: new Date().toISOString(),
  });
  state.addApiRequestLogEntry({
    endpoint: state.settings.apiEndpoint,
    exeName: process.exeName,
    status: "unmatched",
    detail: `Ambiguous: ${candidates.map((game) => game.name).join(", ")}`,
  });
  logRuntime(
    `match ambiguous ${process.exeName}: ${candidates.map((game) => game.name).join(", ")}`,
  );
}

function resolveCachedProcess(
  process: ProcessSnapshot,
  exeCache: Map<string, ExeCacheEntry>,
  now: number,
  ttlMs: number,
): CachedResolution {
  const exeKey = process.exeName.toLowerCase();
  const cached = exeCache.get(exeKey);

  if (cached?.state === "blacklisted") return { state: "skipped" };
  if (cached?.state === "matched" && cached.gameId && cached.gameName) {
    return {
      state: "matched",
      game: {
        id: cached.gameId,
        name: cached.gameName,
        coverUrl: cached.coverUrl ?? "",
        source: cached.source ?? "igdb",
      },
    };
  }
  if (cached?.state === "unmatched") {
    const checkedAt = Date.parse(cached.lastCheckedAt);
    const retryMs = cached.pendingCommunityGame
      ? PENDING_COMMUNITY_RETRY_MS
      : ttlMs;
    if (Number.isFinite(checkedAt) && now - checkedAt < retryMs) {
      return { state: "skipped" };
    }
  }

  return { state: "query" };
}

// Folds elapsed runtime for every discovered-but-unmatched executable forward
// on each scan. Running exes accumulate; stopped exes have their open window
// closed; ignored exes have any accumulated time deleted. The accumulated time
// is later credited to a game by backfillTrackedRuntime when the exe is matched.
function accumulateUnmatchedRuntime(runningKeys: Set<string>) {
  const state = useAppStore.getState();
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const exeCache = new Map(state.exeCache);
  let changed = false;

  const isIgnored = (key: string) =>
    matchesProcessPatternSet(key, state.userIgnoredProcesses) ||
    matchesProcessPatternSet(key, state.blacklist) ||
    matchesProcessPatternSet(key, state.ignoredProcesses);

  for (const [key, entry] of exeCache) {
    if (entry.state !== "unmatched") continue;

    if (isIgnored(key)) {
      if (entry.trackedSeconds || entry.runningSince) {
        const { trackedSeconds: _t, runningSince: _r, ...rest } = entry;
        exeCache.set(key, rest);
        changed = true;
      }
      continue;
    }

    const running = runningKeys.has(key);
    if (running) {
      if (!entry.runningSince) {
        // Open a new running window; nothing folded yet.
        exeCache.set(key, { ...entry, runningSince: nowIso });
        changed = true;
      } else {
        const since = Date.parse(entry.runningSince);
        const elapsedMs = Number.isFinite(since) ? now - since : 0;
        // Fold at most once per checkpoint interval to avoid rewriting state on
        // every ~5s scan. The open remainder is added at read time / backfill.
        if (elapsedMs >= SESSION_CHECKPOINT_INTERVAL_MS) {
          exeCache.set(key, {
            ...entry,
            trackedSeconds: (entry.trackedSeconds ?? 0) + elapsedMs / 1000,
            runningSince: nowIso,
          });
          changed = true;
        }
      }
    } else if (entry.runningSince) {
      const since = Date.parse(entry.runningSince);
      const delta = Number.isFinite(since)
        ? Math.max(0, (now - since) / 1000)
        : 0;
      const { runningSince: _r, ...rest } = entry;
      exeCache.set(key, {
        ...rest,
        trackedSeconds: (entry.trackedSeconds ?? 0) + delta,
      });
      changed = true;
    }
  }

  if (changed) useAppStore.setState({ exeCache });
}

// Credits runtime accumulated while an executable was unmatched to the game it
// was just matched to, as a single completed history session. Must be called
// with the still-unmatched cache entry present (before it is overwritten).
function backfillTrackedRuntime(exeName: string, game: Game) {
  const entry = useAppStore.getState().exeCache.get(exeName.toLowerCase());
  if (!entry) return;

  const now = Date.now();
  const openDelta = entry.runningSince
    ? Math.max(0, (now - Date.parse(entry.runningSince)) / 1000)
    : 0;
  const total = Math.round((entry.trackedSeconds ?? 0) + openDelta);
  if (total < MIN_BACKFILL_SECONDS) return;

  useAppStore.getState().addSession({
    id: createSessionId(),
    gameId: game.id,
    gameName: game.name,
    coverUrl: game.coverUrl,
    source: game.source,
    exeName,
    startedAt: new Date(now - total * 1000).toISOString(),
    endedAt: new Date(now).toISOString(),
    durationSeconds: total,
  });
  logRuntime(
    `backfilled discovered runtime ${exeName} -> ${game.name} seconds=${total}`,
  );
}

function cacheMatchResult(exeName: string, game: Game | null) {
  const state = useAppStore.getState();
  const checkedAt = new Date().toISOString();
  const existing = state.exeCache.get(exeName.toLowerCase());

  if (existing?.state === "matched" && existing.source === "custom") {
    verboseRuntime(`match cache preserved custom game ${exeName}`);
    return;
  }

  if (!game) {
    verboseRuntime(`match cache unmatched ${exeName}`);
    state.addApiRequestLogEntry({
      endpoint: state.settings.apiEndpoint,
      exeName,
      status: "unmatched",
      detail: "No game returned",
    });
    state.setExeCacheEntry({
      exeName,
      state: "unmatched",
      lastCheckedAt: checkedAt,
      // Preserve any runtime already accumulated for this discovered exe so a
      // periodic re-check does not reset it.
      trackedSeconds:
        existing?.state === "unmatched" ? existing.trackedSeconds : undefined,
      runningSince:
        existing?.state === "unmatched" ? existing.runningSince : undefined,
    });
    return;
  }

  logRuntime(`match cache matched ${exeName} -> ${game.name}`);
  if (existing?.state === "unmatched") backfillTrackedRuntime(exeName, game);
  state.addApiRequestLogEntry({
    endpoint: state.settings.apiEndpoint,
    exeName,
    status: "matched",
    detail: game.name,
  });
  state.setExeCacheEntry({
    exeName,
    state: "matched",
    gameId: game.id,
    gameName: game.name,
    coverUrl: game.coverUrl,
    source: game.source,
    lastCheckedAt: checkedAt,
  });
}

function startSession(
  process: ProcessSnapshot,
  game: Game,
  startedAtOverride?: string,
) {
  logRuntime(`session starting ${game.name} (${process.exeName})`);
  const startedAt = startedAtOverride ?? new Date().toISOString();
  const cacheEntry = useAppStore
    .getState()
    .exeCache.get(process.exeName.toLowerCase());
  const session: ActiveSession = {
    id: createSessionId(),
    gameId: game.id,
    gameName: game.name,
    exeName: process.exeName,
    coverUrl: game.coverUrl,
    source: game.source,
    communitySuggestionId: cacheEntry?.communitySuggestionId,
    communitySuggestionVerified: cacheEntry?.communitySuggestionVerified,
    startedAt,
    checkpointedAt: startedAt,
  };
  useAppStore.setState((state) => ({
    activeSessions: [...state.activeSessions, session],
  }));
}

export function selectAmbiguousMatch(exeName: string, game: Game) {
  const state = useAppStore.getState();
  const ambiguous = state.ambiguousMatches.find(
    (match) => match.exeName.toLowerCase() === exeName.toLowerCase(),
  );
  if (!ambiguous) return;

  cacheMatchResult(ambiguous.exeName, game);
  state.removeAmbiguousMatch(ambiguous.exeName);
  const active = useAppStore
    .getState()
    .activeSessions.some(
      (session) =>
        session.exeName.toLowerCase() === ambiguous.exeName.toLowerCase() &&
        session.gameId === game.id,
    );
  if (!active) {
    if (ambiguous.endedAt) {
      addCompletedAmbiguousSession(ambiguous, game);
    } else {
      startSession(
        { exeName: ambiguous.exeName, exePath: ambiguous.exePath },
        game,
        ambiguous.detectedAt,
      );
    }
  }
  logRuntime(`ambiguous match selected ${ambiguous.exeName} -> ${game.name}`);
  persist();
}

function addCompletedAmbiguousSession(
  ambiguous: AmbiguousProcessMatch,
  game: Game,
) {
  const endedAt = ambiguous.endedAt ?? new Date().toISOString();
  const durationSeconds = Math.max(
    1,
    Math.round((Date.parse(endedAt) - Date.parse(ambiguous.detectedAt)) / 1000),
  );
  useAppStore.getState().addSession({
    id: createSessionId(),
    gameId: game.id,
    gameName: game.name,
    coverUrl: game.coverUrl,
    source: game.source,
    exeName: ambiguous.exeName,
    startedAt: ambiguous.detectedAt,
    endedAt,
    durationSeconds,
  });
  logRuntime(
    `ambiguous completed session added ${game.name} durationSeconds=${durationSeconds}`,
  );
}

export async function dismissAmbiguousMatch(exeName: string) {
  const state = useAppStore.getState();
  state.removeAmbiguousMatch(exeName);
  await setUserIgnoredProcess(exeName, true);
  logRuntime(`ambiguous match ignored as not a game ${exeName}`);
  persist();
}

async function endSession(session: ActiveSession, endedAtOverride?: string) {
  logRuntime(`session ending ${session.gameName} (${session.exeName})`);
  const endedAt = endedAtOverride ?? new Date().toISOString();
  const durationSeconds = Math.max(
    1,
    Math.round((Date.parse(endedAt) - Date.parse(session.startedAt)) / 1000),
  );
  useAppStore.getState().addSession({
    id: session.id,
    gameId: session.gameId,
    gameName: session.gameName,
    coverUrl: session.coverUrl,
    source: session.source,
    communitySuggestionId: session.communitySuggestionId,
    communitySuggestionVerified: session.communitySuggestionVerified,
    exeName: session.exeName,
    startedAt: session.startedAt,
    endedAt,
    durationSeconds,
  });
  removeActiveSession(session);
  logRuntime(
    `session ended ${session.gameName} durationSeconds=${durationSeconds}`,
  );
}

async function closeStaleSession() {
  const activeSessions = useAppStore.getState().activeSessions;
  if (activeSessions.length === 0) {
    verboseRuntime("stale session check skipped; no active sessions");
    return;
  }
  for (const active of activeSessions) {
    const ageMs = Date.now() - Date.parse(active.startedAt);
    logRuntime(
      `stale session check ${active.gameName} (${active.exeName}) activeAgeMs=${ageMs}`,
    );
    if (ageMs > 4 * 60 * 60 * 1000) {
      await endSession(active, active.checkpointedAt);
    }
  }
}

function scheduleBackendHealthChecks() {
  if (backendHealthTimer) window.clearInterval(backendHealthTimer);
  backendHealthTimer = undefined;
  window.setTimeout(() => void checkBackendHealth(), 1_000);
  backendHealthTimer = window.setInterval(
    () => void checkBackendHealth(),
    BACKEND_HEALTH_INTERVAL_MS,
  );
  logRuntime("backend health checks scheduled");
}

async function checkBackendHealth() {
  const state = useAppStore.getState();
  const endpoint = state.settings.apiEndpoint.replace(/\/+$/, "");
  if (
    state.backendHealth.status === "offline" ||
    state.backendHealth.status === "reconnecting"
  ) {
    setBackendHealth("reconnecting", "Checking backend connection");
  }

  try {
    const response = await fetchWithTimeout(`${endpoint}/health`, {
      cache: "no-store",
      timeoutMs: BACKEND_HEALTH_TIMEOUT_MS,
    });
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }

    const body = (await response.json()) as { ok?: boolean };
    if (body.ok !== true) throw new Error("Health check returned not ok");

    setBackendHealth("online", "Backend health check passed");
  } catch (error) {
    const detail =
      error instanceof DOMException && error.name === "AbortError"
        ? "Health check timed out"
        : formatError(error);
    setBackendHealth("offline", detail);
  }
}

function setBackendHealth(
  status: "checking" | "online" | "offline" | "reconnecting",
  detail: string,
) {
  const state = useAppStore.getState();
  const previousStatus = state.backendHealth.status;
  state.setBackendHealth({
    status,
    detail,
    checkedAt: new Date().toISOString(),
  });

  if (previousStatus !== status) {
    logRuntime(`backend health ${status}: ${detail}`);
  }

  if (status === "online" && state.runtimeError?.includes("API failed")) {
    state.setRuntimeError(null);
  }
}

function scheduleProcessPolling(intervalSeconds: number) {
  if (processTimer) window.clearInterval(processTimer);
  processTimer = undefined;
  processTimer = window.setInterval(
    () => {
      void requestProcessScan("polling");
    },
    Math.max(2, intervalSeconds) * 1000,
  );
  logRuntime(`process polling intervalSeconds=${intervalSeconds}`);
}

export function persist() {
  const state = useAppStore.getState();
  const persisted: PersistedState = {
    installUuid: state.installUuid ?? undefined,
    settings: state.settings,
    exeCache: [...state.exeCache.values()],
    gameMetadata: [...state.gameMetadata.values()],
    sessions: state.recentSessions,
    activeSessions: state.activeSessions,
    ambiguousMatches: state.ambiguousMatches,
    blacklist: [...state.blacklist],
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
  verboseRuntime(
    `persisted state cache=${state.exeCache.size}, sessions=${state.recentSessions.length}, blacklist=${state.blacklist.size}`,
  );
}

export function recheckUnmatched() {
  const state = useAppStore.getState();
  const previousSize = state.exeCache.size;
  const exeCache = new Map(
    [...state.exeCache].filter(([, entry]) => entry.state !== "unmatched"),
  );
  useAppStore.setState({ exeCache });
  logRuntime(
    `unmatched cache recheck requested removed=${previousSize - exeCache.size}`,
  );
  persist();
  void requestProcessScan("after unmatched recheck");
}

async function recheckPendingCommunityApprovals(reason: string) {
  const entries = [...useAppStore.getState().exeCache.values()];
  const pendingProcesses = entries
    .filter(
      (entry) => entry.state === "unmatched" && entry.pendingCommunityGame,
    )
    .map((entry) => ({ exeName: entry.exeName, exePath: null }));

  // Custom games with a not-yet-verified suggestion otherwise only re-check
  // while their exe is running; without this an approval that happened while
  // the game wasn't played would never be applied. Routed through the upgrade
  // check because resolveProcesses would overwrite the custom entry.
  const pendingCustomProcesses = entries
    .filter(
      (entry) =>
        entry.state === "matched" &&
        entry.source === "custom" &&
        entry.communitySuggestionId &&
        !entry.communitySuggestionVerified,
    )
    .map((entry) => ({ exeName: entry.exeName, exePath: null }));

  if (pendingProcesses.length === 0 && pendingCustomProcesses.length === 0) {
    return;
  }

  logRuntime(
    `pending community approval recheck ${reason} unmatched=${pendingProcesses.length}, custom=${pendingCustomProcesses.length}`,
  );
  if (pendingProcesses.length > 0) {
    await resolveProcesses(pendingProcesses, {
      forceQueryKeys: new Set(
        pendingProcesses.map((process) => processCacheKey(process)),
      ),
    });
  }
  if (pendingCustomProcesses.length > 0) {
    await checkCommunityUpgrades(pendingCustomProcesses);
  }
  persist();
}

export async function recheckExecutable(exeName: string) {
  logRuntime(`executable recheck requested ${exeName}`);
  await resolveProcesses([{ exeName, exePath: null }], {
    forceQueryKeys: new Set([exeName.toLowerCase()]),
  });
  persist();
  void requestProcessScan(`after executable recheck ${exeName}`);
}

export function addCustomGame(exeName: string, gameName: string) {
  const state = useAppStore.getState();
  const normalizedGameName = gameName.trim();
  if (!normalizedGameName) return;

  backfillTrackedRuntime(exeName, {
    id: customGameId(exeName),
    name: normalizedGameName,
    coverUrl: "",
    source: "custom",
  });
  state.setExeCacheEntry({
    exeName,
    state: "matched",
    gameId: customGameId(exeName),
    gameName: normalizedGameName,
    coverUrl: "",
    source: "custom",
    lastCheckedAt: new Date().toISOString(),
  });
  logRuntime(`custom game added ${exeName} -> ${normalizedGameName}`);
  persist();
  void requestProcessScan("after custom game add");
}

export function addSharedCustomGame(
  exeName: string,
  gameName: string,
  coverUrl: string,
  communitySuggestionId: number,
  communitySuggestionVerified: boolean,
) {
  const normalizedGameName = gameName.trim();
  if (!normalizedGameName) return null;

  const game: Game = {
    id: customGameId(exeName),
    name: normalizedGameName,
    coverUrl,
    source: "custom",
  };
  backfillTrackedRuntime(exeName, game);
  useAppStore.getState().setExeCacheEntry({
    exeName,
    state: "matched",
    gameId: game.id,
    gameName: game.name,
    coverUrl,
    source: "custom",
    pendingCommunityGame: {
      id: communitySuggestionId,
      name: game.name,
      coverUrl,
      source: "community",
    },
    communitySuggestionId,
    communitySuggestionVerified,
    lastCheckedAt: new Date().toISOString(),
  });
  logRuntime(
    `shared custom game added ${exeName} -> ${game.name} suggestion=${communitySuggestionId}`,
  );
  persist();
  void requestProcessScan("after shared custom game add");
  return game;
}

export function selectAmbiguousCommunitySuggestion(
  exeName: string,
  gameName: string,
  coverUrl: string,
  communitySuggestionId: number,
  communitySuggestionVerified: boolean,
) {
  const game = addSharedCustomGame(
    exeName,
    gameName,
    coverUrl,
    communitySuggestionId,
    communitySuggestionVerified,
  );
  if (!game) return;
  selectAmbiguousMatch(exeName, game);
}

export async function setCustomGameCover(gameId: number, file: File | Blob) {
  const extension = coverExtension(file);
  if (!extension) {
    throw new Error("Cover image must be a PNG, JPG, or WebP file.");
  }

  const bytes = [...new Uint8Array(await file.arrayBuffer())];
  const coverPath = await invoke<string>("save_custom_cover", {
    gameId,
    extension,
    bytes,
  });
  const coverUrl = convertFileSrc(coverPath);
  updateCustomGameCover(gameId, coverUrl);
  logRuntime(`custom game cover updated gameId=${gameId}`);
  persist();
}

export function clearCustomGameCover(gameId: number) {
  updateCustomGameCover(gameId, "");
  logRuntime(`custom game cover cleared gameId=${gameId}`);
  persist();
}

export function untrackCustomGame(exeName: string) {
  const state = useAppStore.getState();
  const key = exeName.toLowerCase();
  const existing = state.exeCache.get(key);
  if (existing?.source !== "custom") return;

  const active = state.activeSessions.find(
    (session) => session.exeName.toLowerCase() === key,
  );
  if (active) {
    removeActiveSession(active);
  }

  state.removeExeCacheEntry(exeName);
  logRuntime(`custom game untracked ${exeName}`);
  persist();
  void requestProcessScan("after custom game untrack");
}

export function untrackGame(
  gameId: number,
  source: Game["source"] | null,
  removeHistory: boolean,
) {
  const state = useAppStore.getState();
  const matchingExeNames = [...state.exeCache.values()]
    .filter(
      (entry) =>
        entry.state === "matched" &&
        entry.gameId === gameId &&
        (source ? entry.source === source : true),
    )
    .map((entry) => entry.exeName);

  for (const session of state.activeSessions) {
    if (session.gameId !== gameId) continue;
    if (source && session.source !== source) continue;
    removeActiveSession(session);
  }

  for (const exeName of matchingExeNames) {
    state.removeExeCacheEntry(exeName);
  }

  if (removeHistory) {
    useAppStore.setState((current) => ({
      recentSessions: current.recentSessions.filter((session) => {
        if (session.gameId !== gameId) return true;
        if (source && session.source !== source) return true;
        return false;
      }),
    }));
  }

  logRuntime(
    `game untracked gameId=${gameId} source=${source ?? "unknown"} exes=${matchingExeNames.length} removeHistory=${removeHistory}`,
  );
  persist();
  void requestProcessScan("after game untrack");
}

// Adds a manually entered play session for a game already in the library. The
// caller supplies the game identity (from its existing sessions/cache) so the
// entry aggregates onto the same library card. endedAt defaults to now; the
// start is derived so the session spans the given duration.
export function addManualSession(params: {
  gameId: number;
  gameName: string;
  coverUrl: string;
  source: Game["source"] | null;
  exeName: string;
  durationSeconds: number;
  endedAt?: string;
  communitySuggestionId?: number;
  communitySuggestionVerified?: boolean;
}) {
  const durationSeconds = Math.round(params.durationSeconds);
  if (durationSeconds < 1) return;

  const endedAt = params.endedAt ?? new Date().toISOString();
  const startedAt = new Date(
    Date.parse(endedAt) - durationSeconds * 1000,
  ).toISOString();

  useAppStore.getState().addSession({
    id: createSessionId(),
    gameId: params.gameId,
    gameName: params.gameName,
    coverUrl: params.coverUrl,
    source: params.source ?? undefined,
    communitySuggestionId: params.communitySuggestionId,
    communitySuggestionVerified: params.communitySuggestionVerified,
    exeName: params.exeName,
    startedAt,
    endedAt,
    durationSeconds,
  });
  logRuntime(
    `manual session added ${params.gameName} (${params.exeName}) seconds=${durationSeconds}`,
  );
  persist();
}

export function removeHistorySession(sessionId: number) {
  const previousCount = useAppStore.getState().recentSessions.length;
  useAppStore.setState((state) => ({
    recentSessions: state.recentSessions.filter(
      (session) => session.id !== sessionId,
    ),
  }));
  const removedCount =
    previousCount - useAppStore.getState().recentSessions.length;
  if (removedCount > 0) logRuntime(`history session removed ${sessionId}`);
  persist();
}

export function removeGameHistory(gameId: number) {
  const previousCount = useAppStore.getState().recentSessions.length;
  useAppStore.setState((state) => ({
    recentSessions: state.recentSessions.filter(
      (session) => session.gameId !== gameId,
    ),
  }));
  const removedCount =
    previousCount - useAppStore.getState().recentSessions.length;
  if (removedCount > 0)
    logRuntime(
      `game history removed gameId=${gameId} sessions=${removedCount}`,
    );
  persist();
}

export function removeGameHistoryBySource(
  gameId: number,
  source: Game["source"] | null,
) {
  const previousCount = useAppStore.getState().recentSessions.length;
  useAppStore.setState((state) => ({
    recentSessions: state.recentSessions.filter((session) => {
      if (session.gameId !== gameId) return true;
      if (source && session.source !== source) return true;
      return false;
    }),
  }));
  const removedCount =
    previousCount - useAppStore.getState().recentSessions.length;
  if (removedCount > 0)
    logRuntime(
      `game history removed gameId=${gameId} source=${source ?? "unknown"} sessions=${removedCount}`,
    );
  persist();
}

type FakeHistoryGame = {
  id: number;
  name: string;
  exeName: string;
  coverUrl: string;
  durationsHours: number[];
};

const fakeHistoryGames: FakeHistoryGame[] = [
  {
    id: FAKE_HISTORY_GAME_ID_BASE - 1,
    name: "Starlight Drifter",
    exeName: `${FAKE_HISTORY_EXE_PREFIX}starlight-drifter.exe`,
    coverUrl:
      "https://images.igdb.com/igdb/image/upload/t_cover_big/co2lbd.jpg",
    durationsHours: [5.2, 3.4, 7.6, 2.8, 6.5, 4.1, 5.9],
  },
  {
    id: FAKE_HISTORY_GAME_ID_BASE - 2,
    name: "Iron Vale",
    exeName: `${FAKE_HISTORY_EXE_PREFIX}iron-vale.exe`,
    coverUrl:
      "https://images.igdb.com/igdb/image/upload/t_cover_big/co1r7f.jpg",
    durationsHours: [1.3, 2.1, 1.8, 3.4, 2.6],
  },
  {
    id: FAKE_HISTORY_GAME_ID_BASE - 3,
    name: "Neon Rally",
    exeName: `${FAKE_HISTORY_EXE_PREFIX}neon-rally.exe`,
    coverUrl:
      "https://images.igdb.com/igdb/image/upload/t_cover_big/co39vc.jpg",
    durationsHours: [0.8, 1.1, 1.5, 0.9, 2.2, 1.4],
  },
  {
    id: FAKE_HISTORY_GAME_ID_BASE - 4,
    name: "Moonbase Orchard",
    exeName: `${FAKE_HISTORY_EXE_PREFIX}moonbase-orchard.exe`,
    coverUrl:
      "https://images.igdb.com/igdb/image/upload/t_cover_big/co1qv8.jpg",
    durationsHours: [4.7, 6.3, 5.1, 8.2, 3.9, 7.5],
  },
  {
    id: FAKE_HISTORY_GAME_ID_BASE - 5,
    name: "Dungeon Courier",
    exeName: `${FAKE_HISTORY_EXE_PREFIX}dungeon-courier.exe`,
    coverUrl:
      "https://images.igdb.com/igdb/image/upload/t_cover_big/co2mli.jpg",
    durationsHours: [2.5, 2.9, 3.2, 1.6],
  },
];

export function seedFakeHistory() {
  const now = Date.now();
  const fakeSessions = fakeHistoryGames.flatMap((game, gameIndex) =>
    game.durationsHours.map((durationHours, sessionIndex) => {
      const durationSeconds = Math.round(durationHours * 60 * 60);
      const endedAtMs =
        now -
        ((gameIndex * 5 + sessionIndex) * 26 + 2 + gameIndex) * 60 * 60 * 1000;
      const startedAtMs = endedAtMs - durationSeconds * 1000;

      return {
        id: FAKE_HISTORY_SESSION_ID_BASE - gameIndex * 100 - sessionIndex,
        gameId: game.id,
        gameName: game.name,
        coverUrl: game.coverUrl,
        source: "custom" as const,
        exeName: game.exeName,
        startedAt: new Date(startedAtMs).toISOString(),
        endedAt: new Date(endedAtMs).toISOString(),
        durationSeconds,
      };
    }),
  );

  useAppStore.setState((state) => ({
    recentSessions: [
      ...fakeSessions,
      ...state.recentSessions.filter(
        (session) => !isFakeHistorySession(session),
      ),
    ]
      .sort(
        (left, right) =>
          Date.parse(right.endedAt ?? right.startedAt) -
          Date.parse(left.endedAt ?? left.startedAt),
      )
      .slice(0, 500),
  }));

  logRuntime(`fake history seeded sessions=${fakeSessions.length}`);
  persist();
}

export function clearFakeHistory() {
  const previousCount = useAppStore.getState().recentSessions.length;
  useAppStore.setState((state) => ({
    recentSessions: state.recentSessions.filter(
      (session) => !isFakeHistorySession(session),
    ),
  }));
  const removedCount =
    previousCount - useAppStore.getState().recentSessions.length;
  if (removedCount > 0)
    logRuntime(`fake history cleared sessions=${removedCount}`);
  persist();
}

function isFakeHistorySession(session: Session) {
  return (
    session.exeName.startsWith(FAKE_HISTORY_EXE_PREFIX) ||
    (session.gameId <= FAKE_HISTORY_GAME_ID_BASE - 1 &&
      session.gameId > FAKE_HISTORY_GAME_ID_BASE - 10) ||
    (session.id <= FAKE_HISTORY_SESSION_ID_BASE &&
      session.id > FAKE_HISTORY_SESSION_ID_BASE - 1_000)
  );
}

export function clearLocalCache() {
  useAppStore.getState().clearCache();
  logRuntime("local cache cleared");
  persist();
}

export async function scanProcessesNow() {
  await requestProcessScan("manual");
}

export async function hydrateGameMetadata(
  gameRefs: Array<{ gameId: number; source?: Game["source"] }>,
) {
  const state = useAppStore.getState();
  if (
    state.backendHealth.status === "offline" ||
    state.backendHealth.status === "reconnecting"
  ) {
    verboseRuntime("game metadata hydration skipped; backend offline");
    return;
  }

  const refs = gameRefs.filter((ref) => ref.gameId > 0);
  const missingIds = [
    ...new Set(
      refs
        .filter((ref) => {
          if (ref.source === "custom") return false;
          if (!ref.source) {
            return (
              !state.gameMetadata.has(`igdb:${ref.gameId}`) &&
              !state.gameMetadata.has(`community:${ref.gameId}`)
            );
          }
          return !state.gameMetadata.has(
            gameMetadataKey({ id: ref.gameId, source: ref.source }),
          );
        })
        .map((ref) => ref.gameId),
    ),
  ];
  if (missingIds.length === 0) return;

  try {
    const response = await fetchWithTimeout(
      `${state.settings.apiEndpoint}/api/games/metadata?ids=${missingIds.join(",")}`,
      { timeoutMs: API_REQUEST_TIMEOUT_MS },
    );
    if (!response.ok)
      throw new Error(`${response.status} ${response.statusText}`);

    const body = (await response.json()) as GameMetadataResponse;
    useAppStore
      .getState()
      .setGameMetadata(
        body.games.filter(
          (game): game is GameMetadata =>
            game.source === "igdb" || game.source === "community",
        ),
      );
    logRuntime(`game metadata hydrated count=${body.games.length}`);
    persist();
  } catch (error) {
    logRuntime(`game metadata hydration failed: ${formatError(error)}`);
  }
}

async function requestProcessScan(reason: string) {
  if (scanInFlight) {
    scanQueued = true;
    logRuntime(`scan ${reason} queued; scan already running`);
    return scanInFlight;
  }

  scanInFlight = runQueuedProcessScans(reason);
  return scanInFlight;
}

async function runQueuedProcessScans(initialReason: string) {
  let reason = initialReason;
  try {
    do {
      scanQueued = false;
      await runProcessScan(reason);
      reason = "queued";
    } while (scanQueued);
  } catch (error) {
    logRuntime(`scan ${reason} failed: ${formatError(error)}`);
    useAppStore.getState().setProcessScanError(formatError(error));
    useAppStore
      .getState()
      .setRuntimeError(`Process scan failed: ${formatError(error)}`);
  } finally {
    scanInFlight = undefined;
  }
}

async function runProcessScan(reason: string) {
  logRuntime(`scan ${reason} requested`);
  const processes = await invoke<ProcessSnapshot[]>("scan_processes");
  logRuntime(`scan ${reason} returned ${processes.length}`);
  await handleProcessSnapshot(processes);
}

function readPersisted(): PersistedState {
  try {
    return JSON.parse(
      localStorage.getItem(STORAGE_KEY) ?? "{}",
    ) as PersistedState;
  } catch {
    logRuntime("persisted state parse failed; using empty state");
    return {};
  }
}

function normalizePersistedActiveSessions(persisted: PersistedState) {
  const sessions = persisted.activeSessions ?? [];
  if (persisted.activeSession) sessions.push(persisted.activeSession);

  return sessions.map((session) => ({
    ...session,
    checkpointedAt: session.checkpointedAt ?? session.startedAt,
    recoveredFromCheckpoint: true,
  }));
}

function checkpointActiveSessionIfDue(session: ActiveSession) {
  if (
    Date.now() - Date.parse(session.checkpointedAt) <
    SESSION_CHECKPOINT_INTERVAL_MS
  ) {
    return;
  }

  const checkpointedAt = new Date().toISOString();
  updateActiveSession({
    ...session,
    checkpointedAt,
    recoveredFromCheckpoint: false,
  });
  verboseRuntime(
    `session checkpoint ${session.gameName} durationSeconds=${Math.max(
      0,
      Math.round(
        (Date.parse(checkpointedAt) - Date.parse(session.startedAt)) / 1000,
      ),
    )}`,
  );
}

function recoveredSessionEndAt(session: ActiveSession) {
  return session.recoveredFromCheckpoint ? session.checkpointedAt : undefined;
}

function isCustomSession(session: ActiveSession) {
  return session.source === "custom" || session.gameId < 0;
}

function activeSessionKey(
  exeName: string,
  gameId: number,
  source: ActiveSession["source"],
) {
  return `${source ?? "unknown"}:${gameId}:${exeName.toLowerCase()}`;
}

function sessionIdentityKey(
  session: Pick<ActiveSession, "exeName" | "gameId" | "source">,
) {
  return activeSessionKey(session.exeName, session.gameId, session.source);
}

function updateActiveSession(session: ActiveSession) {
  const key = sessionIdentityKey(session);
  useAppStore.setState((state) => ({
    activeSessions: state.activeSessions.map((active) =>
      sessionIdentityKey(active) === key ? session : active,
    ),
  }));
}

function removeActiveSession(session: ActiveSession) {
  const key = sessionIdentityKey(session);
  useAppStore.setState((state) => ({
    activeSessions: state.activeSessions.filter(
      (active) => sessionIdentityKey(active) !== key,
    ),
  }));
}

function syncTrayNowPlaying() {
  const sessions = useAppStore.getState().activeSessions.map((session) => ({
    gameName: session.gameName,
    elapsedSeconds: Math.max(
      0,
      Math.floor((Date.now() - Date.parse(session.startedAt)) / 1000),
    ),
  }));
  void invoke("update_tray_now_playing", { sessions }).catch((error) => {
    logRuntime(`tray update failed: ${formatError(error)}`);
  });
}

function scheduleTraySync() {
  if (trayTimer) window.clearInterval(trayTimer);
  trayTimer = undefined;

  if (useAppStore.getState().activeSessions.length === 0) return;

  trayTimer = window.setInterval(() => {
    syncTrayNowPlaying();
  }, 15_000);
}

function customGameId(exeName: string) {
  let hash = 0;
  for (const char of exeName.toLowerCase()) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return CUSTOM_GAME_ID_BASE - (hash % 900_000_000);
}

function updateCustomGameCover(gameId: number, coverUrl: string) {
  useAppStore.setState((state) => {
    const exeCache = new Map(state.exeCache);

    for (const [key, entry] of exeCache) {
      if (
        entry.state === "matched" &&
        entry.source === "custom" &&
        entry.gameId === gameId
      ) {
        exeCache.set(key, { ...entry, coverUrl });
      }
    }

    return {
      exeCache,
      activeSessions: state.activeSessions.map((session) =>
        session.gameId === gameId && isCustomSession(session)
          ? { ...session, coverUrl }
          : session,
      ),
    };
  });
}

function coverExtension(file: File | Blob) {
  const mimeExtension = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
  }[file.type];

  if (mimeExtension) return mimeExtension;
  if (!(file instanceof File)) return null;

  const match = /\.([a-z0-9]+)$/i.exec(file.name);
  const extension = match?.[1]?.toLowerCase();
  if (extension === "jpeg") return "jpg";
  if (extension === "jpg" || extension === "png" || extension === "webp") {
    return extension;
  }

  return null;
}

function createSessionId() {
  nextSessionSequence = (nextSessionSequence + 1) % 1000;
  return Date.now() * 1000 + nextSessionSequence;
}

function uniqueProcesses(processes: ProcessSnapshot[]) {
  return [
    ...new Map(
      processes.map((process) => [process.exeName.toLowerCase(), process]),
    ).values(),
  ].sort((a, b) => a.exeName.localeCompare(b.exeName));
}

function processCacheKey(process: ProcessSnapshot) {
  return process.exeName.toLowerCase();
}

function processIdentifiers(process: ProcessSnapshot): ProcessIdentifier[] {
  const platform = detectProcessPlatform(process);
  const identifiers: ProcessIdentifier[] = [];

  if (platform === "windows") {
    addIdentifier(identifiers, platform, "exe", process.exeName);
    return identifiers;
  }

  if (platform === "macos") {
    const appBundle = macosAppBundleName(process.exePath);
    if (appBundle)
      addIdentifier(identifiers, platform, "app_bundle", appBundle);
    addIdentifier(identifiers, platform, "process_name", process.exeName);
    return identifiers;
  }

  const steamAppId = linuxSteamAppId(process.exePath);
  if (steamAppId)
    addIdentifier(identifiers, platform, "steam_app_id", steamAppId);
  if (/\.exe$/i.test(process.exeName)) {
    addIdentifier(identifiers, platform, "wine_exe", process.exeName);
  }
  if (process.exePath) {
    addIdentifier(
      identifiers,
      platform,
      "executable_path",
      normalizeProcessPath(process.exePath),
    );
  }
  addIdentifier(identifiers, platform, "executable_name", process.exeName);

  return identifiers;
}

function detectProcessPlatform(process: ProcessSnapshot): Platform {
  const path = process.exePath ?? "";
  if (path.includes("\\") || /\.exe$/i.test(process.exeName)) return "windows";
  if (path.includes(".app/Contents/MacOS/")) return "macos";

  const userAgent = navigator.userAgent.toLowerCase();
  const navigatorPlatform = navigator.platform.toLowerCase();
  if (userAgent.includes("mac") || navigatorPlatform.includes("mac")) {
    return "macos";
  }
  return "linux";
}

function addIdentifier(
  identifiers: ProcessIdentifier[],
  platform: Platform,
  kind: ProcessIdentifier["kind"],
  value: string,
) {
  const trimmed = value.trim();
  const normalized = trimmed.toLowerCase();
  if (!trimmed) return;
  if (
    identifiers.some(
      (identifier) =>
        identifier.platform === platform &&
        identifier.kind === kind &&
        identifier.value.toLowerCase() === normalized,
    )
  ) {
    return;
  }
  identifiers.push({ platform, kind, value: trimmed });
}

function macosAppBundleName(path: string | null) {
  if (!path) return null;
  const match = /(^|\/)([^/]+\.app)\/Contents\/MacOS\//i.exec(path);
  return match?.[2] ?? null;
}

function linuxSteamAppId(path: string | null) {
  if (!path) return null;
  const compatMatch = /\/steamapps\/compatdata\/(\d+)\//i.exec(path);
  if (compatMatch?.[1]) return compatMatch[1];

  const appManifestMatch = /\/steamapps\/appmanifest_(\d+)\.acf$/i.exec(path);
  return appManifestMatch?.[1] ?? null;
}

function normalizeProcessPath(path: string) {
  return path.replace(/\\/g, "/").toLowerCase();
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit & { timeoutMs?: number } = {},
) {
  const { timeoutMs = API_REQUEST_TIMEOUT_MS, signal, ...requestInit } = init;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);

  if (signal) {
    if (signal.aborted) controller.abort();
    else
      signal.addEventListener("abort", () => controller.abort(), {
        once: true,
      });
  }

  try {
    return await fetch(input, { ...requestInit, signal: controller.signal });
  } finally {
    window.clearTimeout(timeout);
  }
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function logRuntime(message: string) {
  useAppStore.getState().addRuntimeLogEntry(message);
}

function verboseRuntime(message: string) {
  if (useAppStore.getState().settings.verboseLogs) logRuntime(message);
}

function formatExeSample(processes: ProcessSnapshot[]) {
  if (processes.length === 0) return "none";
  const sample = processes
    .slice(0, 12)
    .map((process) => process.exeName)
    .join(", ");
  return processes.length > 12
    ? `${sample}, +${processes.length - 12} more`
    : sample;
}
