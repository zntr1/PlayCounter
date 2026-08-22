import type {
  CommunityGameAlias,
  Contribution,
  ContributionCounts,
  ContributionStatus,
  ContributionsResponse,
  EmulatorLaunchContext,
  EmulatorContentSuggestionResponse,
  EmulatorResolveResponse,
  Game,
  GameMetadataResponse,
  IdentifierFlagReason,
  IdentifierReportPayload,
  IdentifierReportResponse,
  IgnoredProcessReportPayload,
  IgnoredProcessReportResponse,
  IgnoredProcessReportStatus,
  MatchProcessesResponse,
  Platform,
  ProcessIdentifier,
  Session,
  Settings,
} from "@playcounter/shared";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import {
  useAppStore,
  BUILD_STAGE,
  DEFAULT_API_ENDPOINT,
  canonicalGameKey,
  autoDetectionKeys,
  createGameIdentityResolver,
  gameMetadataConflictsWithRef,
  gameMetadataKey,
  isOfflineStatus,
  resolvedCanonicalGameKey,
  type ActiveSession,
  type AmbiguousProcessMatch,
  type ExeCacheEntry,
  type GameMetadata,
  type ProcessSnapshot,
} from "./store";
import { countNeedsReview } from "./discoveredReview";
import {
  DISCOVERED_REVIEW_REMINDER_ID,
  DISCOVERED_REVIEW_REMINDER_THRESHOLD,
  discoveredReviewReminderText,
  evaluateDiscoveredReviewReminder,
  sanitizeDiscoveredReviewReminder,
} from "./discoveredReminder";
import { matchesProcessPatternSet } from "./ignoredProcessPatterns";
import { currentPlatform } from "./platform";
import {
  evaluateMilestones,
  milestoneMetrics,
  migrateAwardedMilestones,
  parseMilestoneId,
} from "./milestones";
import {
  contributionKey,
  contributionNotification,
  emulatorContributionKey,
  emulatorContributionNotification,
  notificationEmoji,
  seedEmulatorSeenStatus,
  shouldNotifyContributionTransition,
  type AppNotification,
} from "./notifications";
import {
  gameSecondsKey,
  gameSecondsKeys,
  sanitizeGameSecondsRecord,
} from "./gameSeconds";
import { nextAdjustmentSeconds } from "./playtimeAdjustments";
import {
  persistAppState,
  readPersistedRecord,
  STORAGE_KEY,
} from "./persistence";
import { normalizeCollapsedSections } from "./sectionCollapse";
import { normalizeSessions } from "./sessionPersistence";
import { normalizeAccentColor } from "./theme";
import { TOURS } from "./ui/tour/tourDefinitions";
import { normalizeTourProgress } from "./ui/tour/tourState";
import {
  armDesktopOverlays,
  disposeDesktopOverlays,
  emitOverlayEvent,
  initializeDesktopOverlays,
  noteDiscoveredExecutable,
} from "./desktopOverlayBridge";
import { milestoneMetricLabel, pickTopMilestone } from "./desktopOverlays";
import { adapterFor } from "./emulators/registry";
import {
  accumulateObservationRuntime,
  creditableSeconds,
  reconcileEmulatorReadings,
} from "./emulators/resolve";
import {
  GENERIC_IDENTITY_DENYLIST,
  isShareableToken,
} from "./emulators/signals";
import {
  isShareableEmulatorMapping,
  type EmulatorShareContext,
} from "./emulators/share";
import { toPublicSnapshots } from "./emulators/publicProjection";
import type {
  EmulatorContentObservation,
  EmulatorMapping,
  EmulatorMappingShare,
  EmulatorObservation,
  EmulatorRuntimeState,
  KnownEmulator,
  RawEmulatorSignals,
} from "./emulators/types";

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
  contributionOwnerUuid?: string;
  settings?: Partial<Settings>;
  exeCache?: ExeCacheEntry[];
  gameMetadata?: GameMetadata[];
  ambiguousMatches?: AmbiguousProcessMatch[];
  emulatorMappings?: EmulatorMapping[];
  emulatorObservations?: EmulatorObservation[];
  knownEmulators?: KnownEmulator[];
  sessions?: Session[];
  activeSession?: ActiveSession;
  activeSessions?: ActiveSession[];
  blacklist?: string[];
  notifications?: AppNotification[];
  discoveredReviewReminder?: unknown;
  seenContributionStatus?: Record<string, ContributionStatus>;
  contributionCounts?: ContributionCounts;
  emulatorContributionCounts?: ContributionCounts;
  awardedMilestones?: unknown;
  awardedMilestoneIds?: unknown;
  milestonesInitializedAt?: string;
  archivedSeconds?: number;
  archivedGameSeconds?: Record<string, number>;
  playtimeAdjustments?: Record<string, number>;
  collapsedSections?: unknown;
  tours?: unknown;
  lastSeenReleaseNotesVersion?: unknown;
  autoDetectedGameKeys?: string[];
  suppressStartupNotificationsOnce?: boolean;
  suppressContributionNotificationsOnce?: boolean;
};

type ProcessMatch = {
  process: ProcessSnapshot;
  game: Game;
  startedAt?: string;
  emulator?: EmulatorLaunchContext;
};

export type GameAliasRef = {
  gameId: number;
  source: Game["source"] | null;
};

export type GameMatchLookup = {
  games: Game[];
  pendingCommunityGameIds?: number[];
  flaggedIdentifier?: { reason: IdentifierFlagReason };
};

export type NegativeReportOutcome = {
  localBlockApplied: boolean;
  ignoreFileUpdated: boolean;
  report: IdentifierReportResponse["status"] | "failed" | "skipped";
};

export type LocalProcessIgnoreOutcome = Pick<
  NegativeReportOutcome,
  "localBlockApplied" | "ignoreFileUpdated"
>;

export type IgnoredProcessSuggestionResult =
  | {
      kind: "suggested";
      status: IgnoredProcessReportStatus;
    }
  | { kind: "disabled" }
  | { kind: "not_eligible"; reason: "matched_game" | "ambiguous_picker" }
  | { kind: "skipped"; reason: "offline" | "no_install_uuid" }
  | { kind: "failed" };

export type IgnoredProcessSuggestionOutcome = LocalProcessIgnoreOutcome & {
  suggestion: IgnoredProcessSuggestionResult;
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
const ignoredProcessSuggestionRequests = new Map<
  string,
  Promise<IgnoredProcessSuggestionOutcome>
>();

let initialized = false;
let backendHealthTimer: number | undefined;
let contributionsTimer: number | undefined;
let processTimer: number | undefined;
let trayTimer: number | undefined;
let unsubscribeTraySync: (() => void) | undefined;
let nextSessionSequence = 0;
let scanInFlight: Promise<void> | undefined;
let scanQueued = false;
let canonicalBackfillDone = false;
let canonicalBackfillInFlight: Promise<boolean> | undefined;
const canonicalMetadataCheckedIds = new Set<number>();
const metadataHydrationRequests = new Map<string, Promise<boolean>>();
let emulatorRuntime = new Map<string, EmulatorRuntimeState>();
let emulatorPrivacy = { userName: "", homeDirName: "" };
let emulatorPrivacyReady = false;
let emulatorLookupUnavailableUntil = 0;
let emulatorSharingUnavailableUntil = 0;
let lastEmulatorRunningKeys = new Set<string>();

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
  initializeDesktopOverlays();
  syncTrayNowPlaying();
  scheduleTraySync();
  unsubscribeTraySync = useAppStore.subscribe((state, previousState) => {
    if (state.activeSessions !== previousState.activeSessions) {
      syncTrayNowPlaying();
      scheduleTraySync();
    }
    if (
      state.backendHealth.status === "online" &&
      previousState.backendHealth.status !== "online" &&
      !canonicalBackfillDone
    ) {
      void backfillCanonicalGameIds();
    }
  });
  logRuntime("tracker state hydrated");

  window.setTimeout(() => {
    void finishTrackerStartup();
  }, 1_000);
}

async function finishTrackerStartup() {
  logRuntime("tracker deferred startup started");
  await loadEmulatorPrivacyContext();
  await loadIgnoredProcesses();
  scheduleProcessPolling(
    useAppStore.getState().settings.pollingIntervalSeconds,
  );
  logRuntime("tracker process polling scheduled");

  let identityResolved = false;
  try {
    const installUuid = await getInstallUuid();
    useAppStore.getState().adoptInstallIdentity(installUuid);
    persist();
    identityResolved = true;
    logRuntime("install UUID loaded");
  } catch (error) {
    logRuntime(`install UUID failed: ${formatError(error)}`);
    useAppStore
      .getState()
      .setRuntimeError(`Tauri command failed: ${formatError(error)}`);
  }

  await backfillCanonicalGameIds();

  void closeStaleSession();
  scheduleBackendHealthChecks();

  logRuntime("process listener skipped; polling is active");

  useAppStore.getState().setCleanup(() => {
    logRuntime("tracker cleanup running");
    if (backendHealthTimer) window.clearInterval(backendHealthTimer);
    backendHealthTimer = undefined;
    if (contributionsTimer) window.clearInterval(contributionsTimer);
    contributionsTimer = undefined;
    if (processTimer) window.clearInterval(processTimer);
    processTimer = undefined;
    if (trayTimer) window.clearInterval(trayTimer);
    trayTimer = undefined;
    unsubscribeTraySync?.();
    unsubscribeTraySync = undefined;
    canonicalBackfillDone = false;
    canonicalBackfillInFlight = undefined;
    canonicalMetadataCheckedIds.clear();
    metadataHydrationRequests.clear();
    emulatorRuntime.clear();
    lastEmulatorRunningKeys.clear();
    disposeDesktopOverlays();
    initialized = false;
  });

  window.setTimeout(() => {
    void (async () => {
      const suppressStartupNotifications =
        useAppStore.getState().suppressStartupNotificationsOnce;
      if (identityResolved) {
        await pollContributions("startup", {
          suppressNotifications: suppressStartupNotifications,
        });
      }
      evaluateAndStoreMilestones({
        suppressNotifications: suppressStartupNotifications,
      });
      await recheckPendingCommunityApprovals("startup");
      await requestProcessScan("startup");
      if (suppressStartupNotifications) {
        baselineDiscoveredReviewReminder();
        useAppStore.setState({ suppressStartupNotificationsOnce: false });
        persist();
        logRuntime("post-import notification baseline completed");
      }
      armDesktopOverlays();
    })();
  }, 1_500);
  if (identityResolved) {
    contributionsTimer = window.setInterval(
      () => void pollContributions("interval"),
      30 * 60 * 1000,
    );
  }
}

// The API target belongs to the build mode, not to imported or stale local
// settings. Dev Tools can still override it for the current run, but every
// launch starts from the endpoint compiled for local/test/prod.
function applyBuildApiEndpoint(settings: Settings): Settings {
  const current = settings.apiEndpoint?.replace(/\/+$/, "");
  const configured = DEFAULT_API_ENDPOINT.replace(/\/+$/, "");
  if (current && current !== configured) {
    logRuntime(
      `resetting ${BUILD_STAGE} API endpoint ${current} -> ${DEFAULT_API_ENDPOINT}`,
    );
  }
  return { ...settings, apiEndpoint: DEFAULT_API_ENDPOINT };
}

function hydrate() {
  const hadPersistedStateOnStartup = localStorage.getItem(STORAGE_KEY) !== null;
  const persisted = readPersisted();
  let shouldPersistAchievementMigration =
    (!Array.isArray(persisted.awardedMilestones) &&
      Array.isArray(persisted.awardedMilestoneIds) &&
      persisted.awardedMilestoneIds.length > 0) ||
    (Array.isArray(persisted.awardedMilestones) &&
      persisted.awardedMilestones.some(
        (value) =>
          value !== null &&
          typeof value === "object" &&
          (value as Record<string, unknown>).backfilled === true,
      )) ||
    !Array.isArray(persisted.autoDetectedGameKeys);
  const settings = applyBuildApiEndpoint({
    ...useAppStore.getState().settings,
    ...persisted.settings,
    accentColor: normalizeAccentColor(persisted.settings?.accentColor),
    ignoredEmulatorIds: [
      ...new Set(
        (persisted.settings?.ignoredEmulatorIds ?? [])
          .filter((id): id is string => typeof id === "string")
          .map((id) => id.trim().toLowerCase())
          .filter(Boolean),
      ),
    ],
  });
  const blacklist = persisted.blacklist ?? [];
  const exeCache = persisted.exeCache ?? [];
  const exeCacheMap = new Map(
    exeCache.map((entry) => {
      const { runningSince: _runningSince, ...rest } = entry;
      return [
        entry.exeName.toLowerCase(),
        inferSuggestionStatus(rest),
      ] as const;
    }),
  );
  const gameMetadataMap = new Map(
    (persisted.gameMetadata ?? []).map((game) => [gameMetadataKey(game), game]),
  );
  const hydratedSessions = normalizeSessions(
    (persisted.sessions ?? []).map(inferSuggestionStatus),
  );
  const autoDetectedGameKeys = (() => {
    if (Array.isArray(persisted.autoDetectedGameKeys)) {
      return [
        ...new Set(
          persisted.autoDetectedGameKeys.filter(
            (key): key is string => typeof key === "string" && Boolean(key),
          ),
        ),
      ];
    }
    const keys = new Set<string>();
    const resolver = createGameIdentityResolver(gameMetadataMap, exeCacheMap);
    for (const session of hydratedSessions) {
      for (const key of autoDetectionKeys(session, resolver)) keys.add(key);
    }
    for (const entry of exeCacheMap.values()) {
      if (entry.state !== "matched" || entry.gameId === undefined) continue;
      for (const key of autoDetectionKeys(
        {
          gameId: entry.gameId,
          source: entry.source,
          igdbId: entry.igdbId,
          gameName: entry.gameName,
          coverUrl: entry.coverUrl,
        },
        resolver,
      )) {
        keys.add(key);
      }
    }
    for (const key of Object.keys(persisted.archivedGameSeconds ?? {})) {
      keys.add(key);
    }
    for (const key of Object.keys(persisted.playtimeAdjustments ?? {})) {
      keys.add(key);
    }
    return [...keys];
  })();
  const knownEmulators = new Map(
    (persisted.knownEmulators ?? []).map((emulator) => [
      emulator.emulatorId,
      emulator,
    ]),
  );
  for (const mapping of persisted.emulatorMappings ?? []) {
    if (knownEmulators.has(mapping.emulatorId)) continue;
    knownEmulators.set(mapping.emulatorId, {
      emulatorId: mapping.emulatorId,
      label: mapping.label,
      firstSeenAt: mapping.decidedAt,
      lastSeenAt: mapping.lastSeenAt,
      hostExeNames: [],
    });
  }
  const emulatorMappings = new Map(
    (persisted.emulatorMappings ?? []).map((mapping) => {
      const rawShare = mapping.share as
        | (EmulatorMappingShare & { reviewNote?: unknown })
        | undefined;
      const validStatus =
        rawShare?.status === "pending" ||
        rawShare?.status === "verified" ||
        rawShare?.status === "rejected" ||
        rawShare?.status === "already_curated";
      const share =
        validStatus &&
        typeof rawShare?.gameId === "number" &&
        rawShare.gameId > 0 &&
        typeof rawShare.submittedAt === "string"
          ? {
              status: rawShare.status,
              gameId: rawShare.gameId,
              submittedAt: rawShare.submittedAt,
              ...(typeof rawShare.curatedGameName === "string"
                ? { curatedGameName: rawShare.curatedGameName }
                : {}),
            }
          : undefined;
      if (rawShare && (!share || "reviewNote" in rawShare)) {
        shouldPersistAchievementMigration = true;
      }
      return [mapping.contentKey, { ...mapping, share }] as const;
    }),
  );
  const persistedSeenContributionStatus =
    persisted.seenContributionStatus ?? {};
  const seededSeenContributionStatus = seedEmulatorSeenStatus(
    persistedSeenContributionStatus,
    emulatorMappings.values(),
  );
  if (seededSeenContributionStatus) shouldPersistAchievementMigration = true;
  logRuntime(
    `hydrate loaded cache=${exeCache.length}, blacklist=${blacklist.length}, sessions=${persisted.sessions?.length ?? 0}`,
  );
  useAppStore.setState({
    installUuid: persisted.installUuid ?? null,
    contributionOwnerUuid: persisted.contributionOwnerUuid ?? null,
    settings,
    // Open running windows were removed while constructing exeCacheMap above;
    // runtime while the app was closed must never be credited.
    exeCache: exeCacheMap,
    gameMetadata: gameMetadataMap,
    recentSessions: hydratedSessions,
    activeSessions: normalizePersistedActiveSessions(persisted),
    ambiguousMatches: persisted.ambiguousMatches ?? [],
    emulatorMappings,
    knownEmulators,
    emulatorObservations: (persisted.emulatorObservations ?? []).map(
      (observation) => {
        if (observation.kind !== "content") return observation;
        const { runningSince: _runningSince, ...rest } = observation;
        return rest;
      },
    ),
    blacklist: new Set(blacklist.map((exe) => exe.toLowerCase())),
    notifications: persisted.notifications ?? [],
    discoveredReviewReminder: sanitizeDiscoveredReviewReminder(
      persisted.discoveredReviewReminder,
    ),
    seenContributionStatus:
      seededSeenContributionStatus ?? persistedSeenContributionStatus,
    contributionCounts: persisted.contributionCounts ?? {
      suggested: 0,
      verified: 0,
      pending: 0,
      rejected: 0,
    },
    emulatorContributionCounts: persisted.emulatorContributionCounts ?? {
      suggested: 0,
      verified: 0,
      pending: 0,
      rejected: 0,
    },
    awardedMilestones: migrateAwardedMilestones(persisted),
    milestonesInitializedAt: persisted.milestonesInitializedAt ?? null,
    archivedSeconds: Math.max(0, persisted.archivedSeconds ?? 0),
    archivedGameSeconds: sanitizeGameSecondsRecord(
      persisted.archivedGameSeconds,
      { signed: false },
    ),
    playtimeAdjustments: sanitizeGameSecondsRecord(
      persisted.playtimeAdjustments,
      { signed: true },
    ),
    collapsedSections: normalizeCollapsedSections(persisted.collapsedSections),
    autoDetectedGameKeys,
    tourProgress: normalizeTourProgress(
      persisted.tours,
      TOURS.map((tour) => tour.id),
    ),
    lastSeenReleaseNotesVersion:
      typeof persisted.lastSeenReleaseNotesVersion === "string" &&
      persisted.lastSeenReleaseNotesVersion.trim()
        ? persisted.lastSeenReleaseNotesVersion.trim()
        : null,
    hadPersistedStateOnStartup,
    suppressStartupNotificationsOnce:
      persisted.suppressStartupNotificationsOnce === true,
    suppressContributionNotificationsOnce:
      persisted.suppressContributionNotificationsOnce === true,
  });
  if (shouldPersistAchievementMigration) persist();
}

async function loadEmulatorPrivacyContext() {
  try {
    const context = await invoke<{ userName?: string; homeDirName?: string }>(
      "privacy_context",
    );
    emulatorPrivacy = {
      userName: context.userName ?? "",
      homeDirName: context.homeDirName ?? "",
    };
    emulatorPrivacyReady = true;
    logRuntime("emulator privacy context loaded");
  } catch (error) {
    emulatorPrivacy = { userName: "", homeDirName: "" };
    emulatorPrivacyReady = false;
    logRuntime(`emulator privacy context unavailable: ${formatError(error)}`);
  }
}

async function getInstallUuid() {
  const persisted = readPersisted();
  logRuntime("install UUID requesting durable Tauri identity");
  try {
    return await invoke<string>("install_uuid", {
      existing: persisted.installUuid ?? null,
    });
  } catch (error) {
    if (persisted.installUuid) {
      logRuntime("install UUID file unavailable; using persisted value");
      return persisted.installUuid;
    }
    if (typeof crypto.randomUUID === "function") {
      logRuntime("install UUID file unavailable; using local fallback");
      return crypto.randomUUID();
    }
    throw error;
  }
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

function matchesGameAlias(
  value: { gameId: number; source?: Game["source"] },
  aliases: GameAliasRef[],
) {
  return aliases.some(
    (alias) =>
      value.gameId === alias.gameId && (value.source ?? null) === alias.source,
  );
}

export async function doNotTrackGame(
  gameId: number,
  source: Game["source"] | null,
  exeNames: string[] = [],
  removeHistory = false,
  aliases: GameAliasRef[] = [{ gameId, source }],
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
              aliases.some(
                (alias) =>
                  entry.gameId === alias.gameId &&
                  (entry.source ?? null) === alias.source,
              ),
          )
          .map((entry) => entry.exeName),
      ].filter((exeName) => exeName.trim().length > 0),
    ),
  ];

  for (const exeName of matchingExeNames) {
    await setUserIgnoredProcess(exeName, true);
  }
  untrackGameInternal(gameId, source, removeHistory, aliases, "ignore");
}

export async function openUserIgnoredProcessesFolder() {
  logRuntime("user ignored processes folder open requested");
  await invoke("open_user_ignored_processes_folder");
}

async function handleProcessSnapshot(processes: ProcessSnapshot[]) {
  const startedAt = Date.now();
  const normalized = uniqueProcesses(processes);
  const detectionEnabled =
    useAppStore.getState().settings.emulatorDetection !== false;
  const ignoredEmulatorIds = new Set(
    (useAppStore.getState().settings.ignoredEmulatorIds ?? []).map((id) =>
      id.toLowerCase(),
    ),
  );
  const hostProcesses = detectionEnabled
    ? normalized.filter(
        (process) =>
          Boolean(process.emulatorId) &&
          !ignoredEmulatorIds.has(process.emulatorId!.toLowerCase()),
      )
    : [];
  const normalProcesses = normalized.filter((process) => !process.emulatorId);
  const emulatorMatches = detectionEnabled
    ? await applyEmulatorReadings(hostProcesses)
    : disableEmulatorDetectionForScan();
  useAppStore.getState().setProcesses(toPublicSnapshots(normalized));

  const state = useAppStore.getState();
  const ignored = normalProcesses.filter((process) =>
    isIgnoredProcess(process.exeName, state),
  );
  const candidates = normalProcesses.filter(
    (process) => !isIgnoredProcess(process.exeName, state),
  );
  logRuntime(
    `scan handling total=${processes.length}, unique=${normalized.length}, ignored=${ignored.length}, candidates=${candidates.length}`,
  );
  verboseRuntime(`scan ignored: ${formatExeSample(ignored)}`);
  const matches = [...(await resolveProcesses(candidates)), ...emulatorMatches];
  logRuntime(`scan resolved matches=${matches.length}`);

  const currentSessions = collapseDuplicateActiveSessions();
  const currentAmbiguous = useAppStore.getState().ambiguousMatches;
  // A game can run under several executables at once (launcher, anti-cheat
  // wrapper, client). They all resolve to the same game and share one session:
  // the first one seen starts it, and it only ends once none of them is left.
  const matchesByGame = new Map<
    string,
    { primary: ProcessMatch; targetPids: number[] }
  >();
  for (const match of matches) {
    const key = activeSessionKey(
      match.game.id,
      match.game.source,
      match.game.igdbId,
    );
    const pid = match.process.pid;
    const grouped = matchesByGame.get(key);
    if (!grouped) {
      matchesByGame.set(key, {
        primary: match,
        targetPids: pid === undefined ? [] : [pid],
      });
    } else if (pid !== undefined && !grouped.targetPids.includes(pid)) {
      grouped.targetPids.push(pid);
    }
  }
  const nextKeys = new Set(matchesByGame.keys());
  const runningProcessKeys = new Set(
    candidates.map((process) => process.exeName.toLowerCase()),
  );

  for (const current of currentSessions) {
    const continuingGroup = matchesByGame.get(sessionIdentityKey(current));
    if (continuingGroup) {
      reconcileSessionProvenance(current, continuingGroup.primary);
      checkpointActiveSessionIfDue(current);
      verboseRuntime(
        `scan active session unchanged ${current.gameName} (${current.exeName})`,
      );
      continue;
    }

    logRuntime(
      `scan match ended; ending active session ${current.gameName} (${current.exeName})`,
    );
    await endSession(
      current,
      recoveredSessionEndAt(current),
      current.recoveredFromCheckpoint
        ? "recovered-checkpoint"
        : "process-ended",
    );
  }

  for (const ambiguous of currentAmbiguous) {
    const cached = useAppStore
      .getState()
      .exeCache.get(ambiguous.exeName.toLowerCase());
    if (cached?.state === "matched") {
      // The exe got matched elsewhere (e.g. added as a custom game); the
      // picker is obsolete.
      useAppStore.getState().removeAmbiguousMatch(ambiguous.exeName);
      logRuntime(
        `stale ambiguity dropped for matched exe ${ambiguous.exeName}`,
      );
      continue;
    }
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

  for (const [key, group] of matchesByGame) {
    if (!activeKeys.has(key)) {
      const match = group.primary;
      startSession(match.process, match.game, {
        startedAt: match.startedAt,
        emulator: match.emulator,
        origin: "automatic",
        targetPids: group.targetPids,
      });
    }
  }

  if (matches.length === 0 && currentSessions.length === 0) {
    logRuntime("scan no match; app remains idle");
  }

  accumulateUnmatchedRuntime(runningProcessKeys);
  syncDiscoveredReviewReminder();

  persist();
  logRuntime(`scan complete durationMs=${Date.now() - startedAt}`);
}

function syncDiscoveredReviewReminder() {
  const state = useAppStore.getState();
  const count = countNeedsReview(state);
  if (state.suppressStartupNotificationsOnce) {
    baselineDiscoveredReviewReminder(count);
    return;
  }
  const card = state.notifications.find(
    (notification) => notification.id === DISCOVERED_REVIEW_REMINDER_ID,
  );
  const decision = evaluateDiscoveredReviewReminder({
    count,
    reminder: state.discoveredReviewReminder,
    cardState: !card ? "absent" : card.readAt ? "read" : "unread",
    canFire: !isOfflineStatus(state.backendHealth.status),
  });

  if (decision.removeNotificationId) {
    state.dismissNotification(decision.removeNotificationId);
  }
  if (decision.notification) {
    const text = discoveredReviewReminderText(count);
    state.addNotification(decision.notification);
    state.addToast({
      tone: "info",
      emoji: notificationEmoji("discovered-review"),
      title: text.title,
      detail: text.body,
    });
    logRuntime(`discovered review reminder fired count=${count}`);
  }
  if (decision.reminderChanged) {
    state.setDiscoveredReviewReminder(decision.reminder);
  }
}

function baselineDiscoveredReviewReminder(
  count = countNeedsReview(useAppStore.getState()),
) {
  useAppStore.setState({
    discoveredReviewReminder:
      count >= DISCOVERED_REVIEW_REMINDER_THRESHOLD
        ? {
            notifiedAt: new Date().toISOString(),
            notifiedCount: count,
          }
        : null,
  });
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

function disableEmulatorDetectionForScan(): ProcessMatch[] {
  if (
    useAppStore.getState().emulatorObservations.length > 0 ||
    emulatorRuntime.size > 0
  ) {
    useAppStore.setState({ emulatorObservations: [] });
    emulatorRuntime.clear();
    lastEmulatorRunningKeys.clear();
  }
  return [];
}

function readEmulatorSignals(hosts: ProcessSnapshot[]) {
  const privateTokens = [emulatorPrivacy.userName, emulatorPrivacy.homeDirName];
  return hosts.flatMap((process) => {
    const adapter = adapterFor(process.emulatorId);
    if (!adapter || !process.emulatorId || process.pid === undefined) return [];
    const signals: RawEmulatorSignals = {
      emulatorId: process.emulatorId,
      exeName: process.exeName,
      pid: process.pid,
      startedAtUnix: process.startedAtUnix ?? 0,
      args: process.commandLine ?? [],
      windowTitle: process.windowTitle ?? null,
    };
    const reading = adapter.read(signals, {
      denylist: GENERIC_IDENTITY_DENYLIST,
      privateTokens,
    });
    return [
      {
        pid: signals.pid,
        startedAtUnix: signals.startedAtUnix,
        exeName: signals.exeName,
        emulatorId: signals.emulatorId,
        label: adapter.label,
        reading,
      },
    ];
  });
}

async function applyEmulatorReadings(
  hosts: ProcessSnapshot[],
): Promise<ProcessMatch[]> {
  const state = useAppStore.getState();
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  for (const host of hosts) {
    const adapter = adapterFor(host.emulatorId);
    if (!adapter || !host.emulatorId) continue;
    state.setKnownEmulator({
      emulatorId: host.emulatorId,
      label: adapter.label,
      firstSeenAt: nowIso,
      lastSeenAt: nowIso,
      hostExeNames: [host.exeName],
    });
  }
  const lookupEnabled =
    state.settings.emulatorContentLookup !== false &&
    !isOfflineStatus(state.backendHealth.status) &&
    now >= emulatorLookupUnavailableUntil;
  const reconciled = reconcileEmulatorReadings({
    readings: readEmulatorSignals(hosts),
    observations: state.emulatorObservations,
    mappings: state.emulatorMappings,
    runtime: emulatorRuntime,
    now,
    lookupEnabled,
    retryMs: PENDING_COMMUNITY_RETRY_MS,
  });
  lastEmulatorRunningKeys = reconciled.runningKeys;
  useAppStore
    .getState()
    .setEmulatorObservations(
      accumulateObservationRuntime(
        reconciled.observations,
        reconciled.runningKeys,
        now,
        SESSION_CHECKPOINT_INTERVAL_MS,
      ),
    );

  const matches: ProcessMatch[] = [];
  for (const intent of reconciled.intents) {
    if (intent.type !== "match") continue;
    const refreshed = {
      ...intent.mapping,
      lastSeenAt: nowIso,
    };
    useAppStore.getState().setEmulatorMapping(refreshed);
    const match = emulatorMappingToMatch(refreshed);
    if (match) matches.push(match);
  }

  const resolveIntent = reconciled.intents.find(
    (intent) => intent.type === "resolve",
  );
  if (resolveIntent?.type !== "resolve" || !lookupEnabled) return matches;

  try {
    const response = await fetchWithTimeout(
      `${state.settings.apiEndpoint}/api/emulator/resolve`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        timeoutMs: API_REQUEST_TIMEOUT_MS,
        body: JSON.stringify({ items: resolveIntent.items }),
      },
    );
    if (!response.ok) {
      if (response.status === 404 || response.status === 501) {
        emulatorLookupUnavailableUntil = Date.now() + 30 * 60_000;
      }
      throw new Error(`${response.status} ${response.statusText}`);
    }
    const body = (await response.json()) as EmulatorResolveResponse;
    const results = new Map(body.results.map((result) => [result.key, result]));
    for (const item of resolveIntent.items) {
      const result = results.get(item.key);
      const observation = useAppStore
        .getState()
        .emulatorObservations.find(
          (candidate): candidate is EmulatorContentObservation =>
            candidate.kind === "content" && candidate.key === item.key,
        );
      if (!observation) continue;
      if (
        result?.game &&
        (result.confidence === "curated" || result.confidence === "probable") &&
        observation.autoResolve !== false
      ) {
        const match = applyEmulatorResolution(
          observation.key,
          result.game,
          result.confidence,
          observation.trust,
        );
        if (match) matches.push(match);
        continue;
      }
      useAppStore.getState().setEmulatorObservation({
        ...observation,
        state: result?.candidates?.length ? "ambiguous" : "unknown",
        candidates: result?.candidates,
      });
    }
  } catch (error) {
    for (const item of resolveIntent.items) {
      const observation = useAppStore
        .getState()
        .emulatorObservations.find(
          (candidate): candidate is EmulatorContentObservation =>
            candidate.kind === "content" && candidate.key === item.key,
        );
      if (observation) {
        useAppStore.getState().setEmulatorObservation({
          ...observation,
          state: "unknown",
          candidates: undefined,
        });
      }
    }
    state.addApiRequestLogEntry({
      endpoint: `${state.settings.apiEndpoint}/api/emulator/resolve`,
      exeName: `Emulator: ${resolveIntent.items.length} content token(s)`,
      status: "error",
      detail: formatError(error),
    });
    verboseRuntime(`emulator resolve unavailable: ${formatError(error)}`);
  }
  return matches;
}

function applyEmulatorResolution(
  contentKey: string,
  game: Game,
  confidence: EmulatorMapping["confidence"],
  trust: EmulatorMapping["trust"],
) {
  const state = useAppStore.getState();
  const observation = state.emulatorObservations.find(
    (candidate): candidate is EmulatorContentObservation =>
      candidate.kind === "content" && candidate.key === contentKey,
  );
  if (!observation) return null;

  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const accumulated = creditableSeconds(observation, now);
  const emulator = observationLaunchContext(observation);
  if (
    accumulated > 0 &&
    (observation.endedAt || accumulated >= MIN_BACKFILL_SECONDS)
  ) {
    const endedAt = observation.endedAt ?? nowIso;
    useAppStore.getState().addSession({
      id: createSessionId(),
      gameId: game.id,
      igdbId: game.igdbId,
      gameName: game.name,
      coverUrl: game.coverUrl,
      source: game.source,
      exeName: "",
      startedAt: new Date(
        Date.parse(endedAt) - accumulated * 1000,
      ).toISOString(),
      endedAt,
      durationSeconds: accumulated,
      emulator,
    });
  }

  const mapping: EmulatorMapping = {
    contentKey,
    emulatorId: observation.emulatorId,
    label: observation.label,
    contentKind: observation.contentKind,
    contentValue: observation.contentValue,
    display: observation.display,
    trust,
    detectionSource: observation.detectionSource,
    decision: "game",
    gameId: game.id,
    igdbId: game.igdbId,
    gameName: game.name,
    coverUrl: game.coverUrl,
    source: game.source,
    confidence,
    needsConfirmation: confidence === "probable" || trust === "weak",
    shareable: observation.shareable,
    decidedAt: nowIso,
    lastSeenAt: nowIso,
  };
  state.setEmulatorMapping(mapping);
  state.removeEmulatorObservation(contentKey);
  logRuntime(
    `emulator mapped ${observation.label} ${observation.display} -> ${game.name}`,
  );
  return observation.endedAt ? null : emulatorMappingToMatch(mapping, nowIso);
}

function emulatorMappingToMatch(
  mapping: EmulatorMapping,
  startedAt?: string,
): ProcessMatch | null {
  if (
    mapping.decision !== "game" ||
    mapping.gameId === undefined ||
    !mapping.gameName
  ) {
    return null;
  }
  return {
    process: {
      exeName: "",
      exePath: null,
      emulatorId: mapping.emulatorId,
    },
    game: {
      id: mapping.gameId,
      igdbId: mapping.igdbId,
      name: mapping.gameName,
      coverUrl: mapping.coverUrl ?? "",
      source: mapping.source ?? "igdb",
    },
    startedAt,
    emulator: mappingLaunchContext(mapping),
  };
}

function mappingLaunchContext(mapping: EmulatorMapping): EmulatorLaunchContext {
  return {
    emulatorId: mapping.emulatorId,
    label: mapping.label,
    contentKey: mapping.contentKey,
    display: mapping.display,
    trust: mapping.trust,
  };
}

function observationLaunchContext(
  observation: EmulatorContentObservation,
): EmulatorLaunchContext {
  return {
    emulatorId: observation.emulatorId,
    label: observation.label,
    contentKey: observation.key,
    display: observation.display,
    trust: observation.trust,
  };
}

function reconcileSessionProvenance(
  session: ActiveSession,
  match: ProcessMatch,
) {
  if (match.emulator) {
    if (session.emulator?.contentKey !== match.emulator.contentKey) {
      updateActiveSession({ ...session, emulator: match.emulator });
    }
    return;
  }
  if (session.emulator) {
    const { emulator: _emulator, ...native } = session;
    updateActiveSession({ ...native, exeName: match.process.exeName });
  }
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
  const communityCheckProcesses: ProcessSnapshot[] = [];
  const ambiguousByKey = new Map(
    state.ambiguousMatches.map((match) => [match.exeName.toLowerCase(), match]),
  );
  let cacheMatchedCount = 0;
  let cacheSkippedCount = 0;

  for (const process of processes) {
    const existing = state.exeCache.get(process.exeName.toLowerCase());
    // Custom games are checked for a database match; community games are
    // checked because their id can change on the server when two entries for
    // one game are merged, and a matched entry is otherwise cached forever.
    if (
      existing?.state === "matched" &&
      (existing.source === "custom" || existing.source === "community") &&
      now - (communityUpgradeCheckedAt.get(processCacheKey(process)) ?? 0) >=
        PENDING_COMMUNITY_RETRY_MS
    ) {
      communityCheckProcesses.push(process);
    }
    if (options.forceQueryKeys?.has(processCacheKey(process))) {
      queryProcesses.push(process);
      continue;
    }
    // An unresolved ambiguity has no exe cache entry and would otherwise be
    // re-queried on every scan; the stored candidates keep driving the UI. A
    // matched cache entry always wins - the ambiguity is stale then (e.g. the
    // exe was added as a custom game while the picker was open) and gets
    // dropped so the picker disappears and the match tracks normally.
    const ambiguous = ambiguousByKey.get(processCacheKey(process));
    if (ambiguous && existing?.state === "matched") {
      state.removeAmbiguousMatch(process.exeName);
      logRuntime(`stale ambiguity dropped for matched exe ${process.exeName}`);
    } else if (
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

  if (communityCheckProcesses.length > 0) {
    void checkCommunityUpgrades(communityCheckProcesses);
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
        cacheAmbiguousMatch(
          process,
          result.ambiguousGames,
          result.flaggedIdentifier?.reason,
        );
        continue;
      }
      const game = result?.game ?? null;
      if (game) {
        cacheMatchResult(process.exeName, game);
        matches.push({ process, game });
        continue;
      }
      const pendingCommunityGame =
        result?.pendingCommunityGame ?? result?.pendingCommunityGames?.[0];
      if (pendingCommunityGame) {
        cachePendingCommunityMatch(process.exeName, pendingCommunityGame);
        continue;
      }

      cacheMatchResult(process.exeName, game);
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
      const aliases = result.communityGameAliases;
      // The surviving game can be the match or one of the picker candidates -
      // an exe that IGDB and the community both map is ambiguous by design.
      const communityGames = [
        result.game,
        ...(result.ambiguousGames ?? []),
      ].filter((game): game is Game => game?.source === "community");

      if (applyMergedCommunityGame(result.key, communityGames, aliases)) {
        continue;
      }

      const pendingCommunityGames =
        result.pendingCommunityGames ??
        (result.pendingCommunityGame ? [result.pendingCommunityGame] : []);
      const suggestionOutcome = applyCommunitySuggestionOutcome(
        result.key,
        communityGames,
        pendingCommunityGames,
        result.pendingCommunityGames !== undefined,
        Boolean(result.game || result.ambiguousGames?.length),
        aliases,
      );
      if (suggestionOutcome === "pending" || suggestionOutcome === "approved") {
        continue;
      }
      if (result.game && result.game.source !== "custom") {
        setCommunityUpgrade(result.key, result.game, aliases);
        continue;
      }
    }
  } catch (error) {
    verboseRuntime(`community upgrade check failed: ${formatError(error)}`);
  }
}

// Two community entries for one game get merged into one on the server, which
// retires one of the ids. A client still holding the retired id would keep it
// forever (a matched entry is never re-queried) and run a second session next
// to the executable that already uses the surviving id. The server names the
// retired ids for the game it just matched, so this only moves entries the
// server itself declared to be the same game - a different game that happens
// to share the title stays an upgrade offer for the user to decide.
function applyMergedCommunityGame(
  exeName: string,
  communityGames: Game[],
  aliases: CommunityGameAlias[] | undefined,
) {
  const existing = useAppStore.getState().exeCache.get(exeName.toLowerCase());
  if (
    existing?.state !== "matched" ||
    existing.source !== "community" ||
    existing.gameId === undefined
  ) {
    return false;
  }

  const survivor = survivorOfRetiredGame(existing.gameId, aliases);
  if (survivor === undefined || survivor === existing.gameId) return false;
  const game = communityGames.find((candidate) => candidate.id === survivor);
  if (!game) return false;

  logRuntime(
    `community game merged ${exeName}: ${existing.gameId} -> ${game.id} (${game.name})`,
  );
  const ownSuggestion = isOwnCommunitySuggestion(existing, game, aliases);
  applyGameMatch(exeName, game);
  // applyGameMatch drops a suggestion marker that does not name the new game;
  // here it named the retired one, so it carries over to the survivor.
  if (ownSuggestion) {
    const merged = useAppStore.getState().exeCache.get(exeName.toLowerCase());
    if (merged?.state === "matched") {
      useAppStore.getState().setExeCacheEntry({
        ...merged,
        communitySuggestionId: game.id,
        communitySuggestionVerified: true,
        communitySuggestionStatus: "verified",
        communitySuggestionNote: undefined,
      });
    }
  }
  return true;
}

// The community game a retired id was merged into, if the server declared one.
function survivorOfRetiredGame(
  gameId: number,
  aliases: CommunityGameAlias[] | undefined,
) {
  return aliases?.find((alias) => alias.mergedFromGameIds.includes(gameId))
    ?.gameId;
}

// Whether a community game is the one this entry suggested itself - directly,
// or because the suggestion's id was retired when that game absorbed it.
function isOwnCommunitySuggestion(
  entry: ExeCacheEntry,
  game: Game,
  aliases: CommunityGameAlias[] | undefined,
) {
  if (
    game.source !== "community" ||
    entry.communitySuggestionId === undefined
  ) {
    return false;
  }
  return (
    entry.communitySuggestionId === game.id ||
    survivorOfRetiredGame(entry.communitySuggestionId, aliases) === game.id
  );
}

// Every executable of one pending suggestion has to share a single local game
// while it waits for approval. Executables added before their shared
// suggestion id was known still carry their own per-exe id and would each run
// their own session; this folds them onto one and moves what was recorded
// under the others.
function canonicalizeSharedCustomGames(communitySuggestionId: number) {
  const gameIds = [...useAppStore.getState().exeCache.values()]
    .filter(
      (entry) =>
        entry.state === "matched" &&
        entry.source === "custom" &&
        entry.communitySuggestionId === communitySuggestionId &&
        entry.gameId !== undefined,
    )
    .map((entry) => entry.gameId as number);
  if (gameIds.length < 2) return;

  const canonicalId = Math.min(...gameIds);
  const staleIds = new Set(gameIds.filter((gameId) => gameId !== canonicalId));
  if (staleIds.size === 0) return;

  const isStaleCustom = (session: Pick<Session, "gameId" | "source">) =>
    session.source === "custom" && staleIds.has(session.gameId);

  useAppStore.setState((state) => {
    const exeCache = new Map(state.exeCache);
    for (const [key, entry] of exeCache) {
      if (
        entry.state === "matched" &&
        entry.source === "custom" &&
        entry.communitySuggestionId === communitySuggestionId &&
        entry.gameId !== undefined &&
        staleIds.has(entry.gameId)
      ) {
        exeCache.set(key, { ...entry, gameId: canonicalId });
      }
    }

    return {
      exeCache,
      activeSessions: dedupeSessionsByGame(
        state.activeSessions.map((session) =>
          isStaleCustom(session)
            ? { ...session, gameId: canonicalId }
            : session,
        ),
      ),
      recentSessions: state.recentSessions.map((session) =>
        isStaleCustom(session) ? { ...session, gameId: canonicalId } : session,
      ),
    };
  });
  for (const staleId of staleIds) {
    useAppStore
      .getState()
      .rekeyGameSeconds(`custom:${staleId}`, `custom:${canonicalId}`);
    useAppStore
      .getState()
      .carryAutoDetectedGameKey(`custom:${staleId}`, `custom:${canonicalId}`);
  }

  logRuntime(
    `shared suggestion ${communitySuggestionId}: merged local games ${[...staleIds].join(", ")} into ${canonicalId}`,
  );
  persist();
}

// Reconciles the local suggestion marker with the authoritative community
// result. It stays pending while its unverified row exists, becomes approved
// while the game remains custom when its verified row appears, and is removed
// when neither row exists because moderators rejected it.
export function applyCommunitySuggestionOutcome(
  exeName: string,
  communityGames: Game[],
  pendingCommunityGames: Game[],
  pendingGamesAreAuthoritative: boolean,
  responseHasOtherMatches: boolean,
  aliases?: CommunityGameAlias[],
) {
  const existing = useAppStore.getState().exeCache.get(exeName.toLowerCase());
  if (
    existing?.state !== "matched" ||
    existing.source !== "custom" ||
    !existing.communitySuggestionId ||
    existing.communitySuggestionStatus === "verified" ||
    (existing.communitySuggestionStatus === undefined &&
      existing.communitySuggestionVerified)
  ) {
    return "not-applicable" as const;
  }

  const approved = communityGames.find((game) =>
    isOwnCommunitySuggestion(existing, game, aliases),
  );
  if (approved) {
    setCommunitySuggestionApproved(exeName, approved);
    return "approved" as const;
  }

  const pending = pendingCommunityGames.find((game) =>
    isOwnCommunitySuggestion(existing, game, aliases),
  );
  if (pending) {
    setCommunitySuggestionMarker(exeName, pending, false);
    return "pending" as const;
  }

  // Older servers did not report pending suggestions beside another stored
  // match. Treat that response as inconclusive instead of falsely declaring a
  // rejection. New servers always include pendingCommunityGames, even empty.
  if (!pendingGamesAreAuthoritative && responseHasOtherMatches) {
    return "inconclusive" as const;
  }
  if (existing.communitySuggestionStatus !== "rejected") {
    setCommunitySuggestionRejected(exeName, existing.communitySuggestionNote);
  }
  return "rejected" as const;
}

function setCommunitySuggestionRejected(exeName: string, note?: string) {
  const key = exeName.toLowerCase();
  useAppStore.setState((state) => {
    const existing = state.exeCache.get(key);
    if (existing?.state !== "matched" || existing.source !== "custom") {
      return {};
    }

    const exeCache = new Map(state.exeCache);
    exeCache.set(key, {
      ...existing,
      pendingCommunityGame: undefined,
      communitySuggestionVerified: false,
      communitySuggestionStatus: "rejected",
      communitySuggestionNote: note,
    });
    return {
      exeCache,
      activeSessions: state.activeSessions.map((session) =>
        session.exeName.toLowerCase() === key && session.source === "custom"
          ? {
              ...session,
              communitySuggestionVerified: false,
              communitySuggestionStatus: "rejected" as const,
              communitySuggestionNote: note,
            }
          : session,
      ),
      recentSessions: state.recentSessions.map((session) =>
        session.exeName.toLowerCase() === key && session.source === "custom"
          ? {
              ...session,
              communitySuggestionVerified: false,
              communitySuggestionStatus: "rejected" as const,
              communitySuggestionNote: note,
            }
          : session,
      ),
    };
  });
  logRuntime(`community suggestion rejected ${exeName}`);
  persist();
}

export function markCommunitySuggestionRejected(
  exeName: string,
  note?: string,
) {
  setCommunitySuggestionRejected(exeName, note);
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
      igdbId: game.igdbId ?? existing.igdbId,
      pendingCommunityGame: verified ? undefined : game,
      communitySuggestionId: game.id,
      communitySuggestionVerified: verified,
      communitySuggestionStatus: verified ? "verified" : "pending",
      communitySuggestionNote: undefined,
    });
    return {
      exeCache,
      activeSessions: state.activeSessions.map((session) =>
        session.exeName.toLowerCase() === key && session.source === "custom"
          ? {
              ...session,
              igdbId: game.igdbId ?? session.igdbId ?? existing.igdbId,
              communitySuggestionId: game.id,
              communitySuggestionVerified: verified,
              communitySuggestionStatus: verified ? "verified" : "pending",
              communitySuggestionNote: undefined,
            }
          : session,
      ),
      recentSessions: state.recentSessions.map((session) =>
        session.exeName.toLowerCase() === key && session.source === "custom"
          ? {
              ...session,
              igdbId: game.igdbId ?? session.igdbId ?? existing.igdbId,
              communitySuggestionId: game.id,
              communitySuggestionVerified: verified,
              communitySuggestionStatus: verified ? "verified" : "pending",
              communitySuggestionNote: undefined,
            }
          : session,
      ),
    };
  });

  // The server may have filed this exe under a suggestion another of the
  // game's executables already uses; both then have to share one local game.
  canonicalizeSharedCustomGames(game.id);
}

function setCommunitySuggestionApproved(exeName: string, game: Game) {
  setCommunitySuggestionMarker(exeName, game, true);
  logRuntime(`community suggestion approved ${exeName} -> ${game.name}`);
  persist();
}

// A dismissal recorded before igdb upgrades existed has no source; those were
// always community games.
function isDismissedUpgrade(entry: ExeCacheEntry, game: Game) {
  return (
    entry.dismissedCommunityUpgradeGameId === game.id &&
    (entry.dismissedCommunityUpgradeSource ?? "community") === game.source
  );
}

// Records a database match found for a custom game. Approval of the user's own
// suggestion is only marked here; switching its source to community remains a
// deliberate user action. Other matches become upgrade offers.
function setCommunityUpgrade(
  exeName: string,
  game: Game,
  aliases?: CommunityGameAlias[],
) {
  const current = useAppStore.getState().exeCache.get(exeName.toLowerCase());
  if (
    current?.state === "matched" &&
    current.source === "custom" &&
    isOwnCommunitySuggestion(current, game, aliases)
  ) {
    setCommunitySuggestionApproved(exeName, game);
    return;
  }

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
    // A verified match submitted by somebody else is an available upgrade,
    // not an approval of this user's suggestion. Keep those states separate so
    // the approval badge can only follow an actual pending suggestion.
    exeCache.set(key, { ...existing, communityUpgradeGame: game });
    return { exeCache };
  });
}

export function acceptCommunityUpgrade(exeName: string) {
  const existing = useAppStore.getState().exeCache.get(exeName.toLowerCase());
  const game = existing?.communityUpgradeGame;
  if (!game) return;
  applyGameMatch(exeName, game);
}

// Switches an exe's matched game (custom, igdb, or community) over to another
// database game, used by the automatic upgrade offer and the manual "check
// for matches" dialog. Rewrites the cache entry and the sessions recorded
// under the previous game.
export function applyGameMatch(exeName: string, game: Game) {
  const state = useAppStore.getState();
  const key = exeName.toLowerCase();
  const existing = state.exeCache.get(key);
  if (existing?.state !== "matched") return;
  const igdbId = game.igdbId ?? existing.igdbId;
  if (
    existing.source === game.source &&
    existing.gameId === game.id &&
    existing.igdbId === igdbId
  ) {
    return;
  }

  const oldGameId = existing.gameId;
  const suggestionId =
    game.source === "community" && existing.communitySuggestionId === game.id
      ? existing.communitySuggestionId
      : undefined;
  const suggestionVerified = suggestionId ? true : undefined;
  const suggestionStatus = suggestionId ? "verified" : undefined;
  state.setExeCacheEntry({
    exeName: existing.exeName,
    state: "matched",
    gameId: game.id,
    igdbId,
    gameName: game.name,
    coverUrl: game.coverUrl,
    source: game.source,
    communitySuggestionId: suggestionId,
    communitySuggestionVerified: suggestionVerified,
    communitySuggestionStatus: suggestionStatus,
    communitySuggestionNote: undefined,
    lastCheckedAt: new Date().toISOString(),
  });

  useAppStore.setState((current) => ({
    activeSessions: current.activeSessions.map((session) =>
      session.exeName.toLowerCase() === key && session.gameId === oldGameId
        ? {
            ...session,
            gameId: game.id,
            igdbId,
            gameName: game.name,
            coverUrl: game.coverUrl,
            source: game.source,
            communitySuggestionId: suggestionId,
            communitySuggestionVerified: suggestionVerified,
            communitySuggestionStatus: suggestionStatus,
            communitySuggestionNote: undefined,
          }
        : session,
    ),
    recentSessions: current.recentSessions.map((session) =>
      session.exeName.toLowerCase() === key && session.gameId === oldGameId
        ? {
            ...session,
            gameId: game.id,
            igdbId,
            gameName: game.name,
            coverUrl: game.coverUrl,
            source: game.source,
            communitySuggestionId: suggestionId,
            communitySuggestionVerified: suggestionVerified,
            communitySuggestionStatus: suggestionStatus,
            communitySuggestionNote: undefined,
          }
        : session,
    ),
  }));

  if (oldGameId !== undefined) {
    const from = `${existing.source ?? "unknown"}:${oldGameId}`;
    const to = `${game.source}:${game.id}`;
    state.rekeyGameSeconds(from, to);
    state.carryAutoDetectedGameKey(from, to);
  }

  logRuntime(`game match applied ${existing.exeName} -> ${game.name}`);
  persist();
  void requestProcessScan("after game match applied");
}

// Applies a database game directly to an exe - used when a community
// suggestion turned out to be an already-known IGDB match. Handles both
// unmatched exes (Discovered) and already matched ones (library).
export function applyKnownGameMatch(exeName: string, game: Game) {
  const existing = useAppStore.getState().exeCache.get(exeName.toLowerCase());
  if (existing?.state === "matched") {
    applyGameMatch(exeName, game);
    return;
  }
  cacheMatchResult(exeName, game);
  persist();
  void requestProcessScan("after known game match applied");
}

// Manual "check for matches": runs the exe through the normal match pipeline
// and returns every database candidate found. Pending community identifiers are
// included because this is an explicit user choice, and because an earlier
// community match can otherwise become impossible to restore after the user
// submits a different-game correction for the same executable. The custom
// entry's own current suggestion is not an alternative, though: offering it
// here would present the in-review correction as a normal community match.
export async function findGameMatches(
  exeName: string,
): Promise<GameMatchLookup> {
  const state = useAppStore.getState();
  const process: ProcessSnapshot = { exeName, exePath: null };
  const response = await fetchWithTimeout(
    `${state.settings.apiEndpoint}/api/match-processes`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      timeoutMs: API_REQUEST_TIMEOUT_MS,
      body: JSON.stringify({
        processes: [
          {
            key: processCacheKey(process),
            identifiers: processIdentifiers(process),
          },
        ],
      }),
    },
  );
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }

  const body = (await response.json()) as MatchProcessesResponse;
  const result = body.matches.find(
    (match) => match.key.toLowerCase() === processCacheKey(process),
  );
  if (!result) return { games: [] };

  const resolvedGames = [
    ...(result.game && result.game.source !== "custom" ? [result.game] : []),
    ...(result.ambiguousGames ?? []),
  ];
  const pendingCommunityGames =
    result.pendingCommunityGames ??
    (result.pendingCommunityGame ? [result.pendingCommunityGame] : []);
  const current = state.exeCache.get(exeName.toLowerCase());
  const currentSuggestionId =
    current?.state === "matched" && current.source === "custom"
      ? current.communitySuggestionId
      : undefined;
  const gamesByIdentity = new Map<string, Game>();
  for (const game of [...resolvedGames, ...pendingCommunityGames]) {
    if (
      game.source === "community" &&
      currentSuggestionId !== undefined &&
      game.id === currentSuggestionId
    ) {
      continue;
    }
    gamesByIdentity.set(`${game.source}:${game.id}`, game);
  }
  const pendingCommunityGameIds = [
    ...new Set(
      pendingCommunityGames
        .filter((game) => game.id !== currentSuggestionId)
        .map((game) => game.id),
    ),
  ];

  return {
    games: [...gamesByIdentity.values()],
    ...(pendingCommunityGameIds.length > 0 ? { pendingCommunityGameIds } : {}),
    flaggedIdentifier: result.flaggedIdentifier,
  };
}

export async function searchEmulatorGames(
  emulatorId: string,
  query: string,
): Promise<Game[]> {
  const value = query.trim();
  if (!value) return [];
  const endpoint = useAppStore
    .getState()
    .settings.apiEndpoint.replace(/\/+$/, "");
  const response = await fetchWithTimeout(
    `${endpoint}/api/emulator/games/search?emulatorId=${encodeURIComponent(emulatorId)}&query=${encodeURIComponent(value)}`,
    { timeoutMs: API_REQUEST_TIMEOUT_MS },
  );
  if (!response.ok)
    throw new Error(`${response.status} ${response.statusText}`);
  return ((await response.json()) as GameMetadataResponse).games.map(
    (game) => ({
      ...game,
      source: game.source ?? "igdb",
    }),
  );
}

export type EmulatorShareOutcome =
  | { kind: "shared"; share: EmulatorMappingShare }
  | {
      kind: "skipped";
      reason: "not-shareable" | "offline" | "no-install-id";
    }
  | { kind: "unavailable" }
  | { kind: "failed"; error: string };

export function emulatorShareRuntimeContext(): EmulatorShareContext {
  const state = useAppStore.getState();
  return {
    privateTokens: [emulatorPrivacy.userName, emulatorPrivacy.homeDirName],
    privacyReady: emulatorPrivacyReady,
    installUuid: state.installUuid,
    offline: isOfflineStatus(state.backendHealth.status),
    serverUnavailable: Date.now() < emulatorSharingUnavailableUntil,
  };
}

export async function shareEmulatorMapping(
  contentKey: string,
): Promise<EmulatorShareOutcome> {
  const state = useAppStore.getState();
  const mapping = state.emulatorMappings.get(contentKey);
  const context = emulatorShareRuntimeContext();
  if (!mapping || !isShareableEmulatorMapping(mapping, context)) {
    return { kind: "skipped", reason: "not-shareable" };
  }
  if (context.offline) return { kind: "skipped", reason: "offline" };
  if (!context.installUuid) {
    return { kind: "skipped", reason: "no-install-id" };
  }
  if (context.serverUnavailable) return { kind: "unavailable" };
  const existingShare =
    mapping.share?.gameId === mapping.gameId ? mapping.share : undefined;
  if (existingShare?.status === "rejected") {
    return { kind: "shared", share: existingShare };
  }

  const endpoint = `${state.settings.apiEndpoint.replace(/\/+$/, "")}/api/emulator/suggestions`;
  try {
    const response = await fetchWithTimeout(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      timeoutMs: API_REQUEST_TIMEOUT_MS,
      body: JSON.stringify({
        emulatorId: mapping.emulatorId,
        contentKind: mapping.contentKind,
        contentValue: mapping.contentValue,
        gameId: mapping.gameId,
        installUuid: context.installUuid,
      }),
    });
    if (response.status === 404 || response.status === 501) {
      emulatorSharingUnavailableUntil = Date.now() + 30 * 60_000;
      return { kind: "unavailable" };
    }
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }
    const body = (await response.json()) as EmulatorContentSuggestionResponse;
    if (
      body.status !== "pending" &&
      body.status !== "rejected" &&
      body.status !== "already_curated"
    ) {
      throw new Error("Invalid emulator suggestion response.");
    }
    const share: EmulatorMappingShare = {
      status: body.status,
      gameId: mapping.gameId!,
      submittedAt: new Date().toISOString(),
      curatedGameName: body.game?.name,
    };
    useAppStore.getState().setEmulatorMapping({ ...mapping, share });
    if (share.status !== "already_curated") {
      const seenStatus: ContributionStatus = share.status;
      const key = emulatorContributionKey({
        emulatorId: mapping.emulatorId,
        contentKind: mapping.contentKind,
        contentValue: mapping.contentValue,
        gameId: share.gameId,
      });
      useAppStore.setState((current) => ({
        seenContributionStatus: {
          ...current.seenContributionStatus,
          [key]: seenStatus,
        },
      }));
      if (share.status === "rejected") {
        const notification = emulatorContributionNotification(
          {
            emulatorId: mapping.emulatorId,
            contentKind: mapping.contentKind,
            contentValue: mapping.contentValue,
            gameId: share.gameId,
            gameName: mapping.gameName ?? "Emulator game",
            coverUrl: mapping.coverUrl ?? "",
            status: "rejected",
            reviewNote: body.reviewNote,
            createdAt: share.submittedAt,
          },
          mapping.label,
        );
        if (notification) {
          useAppStore.getState().addNotification(notification);
          useAppStore.getState().addToast({
            tone: "info",
            emoji: notificationEmoji(notification.kind),
            title: notification.title,
            detail: notification.body,
          });
        }
      }
    }
    persist();
    state.addApiRequestLogEntry({
      endpoint,
      exeName: `Emulator: ${mapping.emulatorId} ${mapping.contentKind}`,
      status: "matched",
      detail: body.status,
    });
    return { kind: "shared", share };
  } catch (error) {
    const detail = formatError(error);
    state.addApiRequestLogEntry({
      endpoint,
      exeName: `Emulator: ${mapping.emulatorId} ${mapping.contentKind}`,
      status: "error",
      detail,
    });
    return { kind: "failed", error: detail };
  }
}

export async function selectEmulatorGame(contentKey: string, game: Game) {
  const state = useAppStore.getState();
  const existingMapping = state.emulatorMappings.get(contentKey);
  if (existingMapping) {
    const nowIso = new Date().toISOString();
    const updateSession = <T extends ActiveSession | Session>(session: T): T =>
      session.emulator?.contentKey === contentKey
        ? {
            ...session,
            gameId: game.id,
            igdbId: game.igdbId,
            gameName: game.name,
            coverUrl: game.coverUrl,
            source: game.source,
            communitySuggestionId: undefined,
            communitySuggestionVerified: undefined,
            communitySuggestionStatus: undefined,
            communitySuggestionNote: undefined,
          }
        : session;

    useAppStore.setState((current) => {
      const emulatorMappings = new Map(current.emulatorMappings);
      emulatorMappings.set(contentKey, {
        ...existingMapping,
        decision: "game",
        gameId: game.id,
        igdbId: game.igdbId,
        gameName: game.name,
        coverUrl: game.coverUrl,
        source: game.source,
        confidence: "user",
        needsConfirmation: existingMapping.trust === "weak",
        share:
          existingMapping.share?.gameId === game.id
            ? existingMapping.share
            : undefined,
        decidedAt: nowIso,
        lastSeenAt: nowIso,
      });
      return {
        emulatorMappings,
        activeSessions: dedupeSessionsByGame(
          current.activeSessions.map(updateSession),
        ),
        recentSessions: current.recentSessions.map(updateSession),
        emulatorObservations: current.emulatorObservations.filter(
          (item) => item.key !== contentKey,
        ),
      };
    });
    logRuntime(
      `emulator remapped ${existingMapping.label} ${existingMapping.display} -> ${game.name}; linked sessions reassigned`,
    );
    persist();
    void requestProcessScan("after emulator game replaced");
    return;
  }
  const observation = useAppStore
    .getState()
    .emulatorObservations.find(
      (item): item is EmulatorContentObservation =>
        item.kind === "content" && item.key === contentKey,
    );
  const match = applyEmulatorResolution(
    contentKey,
    game,
    "user",
    observation?.trust ?? "weak",
  );
  if (match) {
    startSession(match.process, match.game, {
      startedAt: match.startedAt,
      emulator: match.emulator,
      origin: "manual",
    });
  }
  persist();
  void requestProcessScan("after emulator game selected");
}

export async function addCustomEmulatorGame(contentKey: string, name: string) {
  const gameName = name.trim();
  if (!gameName) return;
  await selectEmulatorGame(contentKey, {
    id: customGameId(contentKey),
    name: gameName,
    coverUrl: "",
    source: "custom",
  });
}

export async function ignoreEmulatorContent(contentKey: string) {
  const state = useAppStore.getState();
  const mapping = state.emulatorMappings.get(contentKey);
  const observation = state.emulatorObservations.find(
    (item): item is EmulatorContentObservation =>
      item.kind === "content" && item.key === contentKey,
  );
  if (!mapping && !observation) return;
  await endActiveEmulatorRoute(contentKey);
  const now = new Date().toISOString();
  state.setEmulatorMapping({
    contentKey,
    emulatorId: mapping?.emulatorId ?? observation!.emulatorId,
    label: mapping?.label ?? observation!.label,
    contentKind: mapping?.contentKind ?? observation!.contentKind,
    contentValue: mapping?.contentValue ?? observation!.contentValue,
    display: mapping?.display ?? observation!.display,
    trust: mapping?.trust ?? observation!.trust,
    detectionSource: mapping?.detectionSource ?? observation?.detectionSource,
    shareable: mapping?.shareable ?? observation?.shareable,
    decision: "ignored",
    confidence: "user",
    decidedAt: now,
    lastSeenAt: mapping?.lastSeenAt ?? now,
  });
  state.removeEmulatorObservation(contentKey);
  persist();
  void requestProcessScan("after emulator content ignored");
}

export async function forgetEmulatorMapping(contentKey: string) {
  const state = useAppStore.getState();
  const mapping = state.emulatorMappings.get(contentKey);
  if (!mapping) return;
  await endActiveEmulatorRoute(contentKey);
  state.removeEmulatorMapping(contentKey);
  if (lastEmulatorRunningKeys.has(contentKey)) {
    state.setEmulatorObservation(observationFromMapping(mapping));
  }
  persist();
  void requestProcessScan("after emulator mapping forgotten");
}

export function confirmEmulatorMapping(contentKey: string) {
  const state = useAppStore.getState();
  const mapping = state.emulatorMappings.get(contentKey);
  if (!mapping || mapping.decision !== "game") return;
  state.setEmulatorMapping({ ...mapping, needsConfirmation: false });
  persist();
}

export function restoreEmulatorContent(contentKey: string) {
  const state = useAppStore.getState();
  const mapping = state.emulatorMappings.get(contentKey);
  if (!mapping || mapping.decision !== "ignored") return;
  state.removeEmulatorMapping(contentKey);
  persist();
  void requestProcessScan("after emulator content restored");
}

export async function setEmulatorIgnored(emulatorId: string, ignored: boolean) {
  const key = emulatorId.trim().toLowerCase();
  if (!key) return;
  const state = useAppStore.getState();
  state.setEmulatorIgnoredSetting(key, ignored);

  if (ignored) {
    state.setEmulatorObservations(
      state.emulatorObservations.filter(
        (observation) => observation.emulatorId.toLowerCase() !== key,
      ),
    );
    for (const runtimeKey of [...emulatorRuntime.keys()]) {
      if (runtimeKey.startsWith(`${key}:`)) emulatorRuntime.delete(runtimeKey);
    }
    lastEmulatorRunningKeys = new Set(
      [...lastEmulatorRunningKeys].filter(
        (contentKey) => !contentKey.startsWith(`${key}:`),
      ),
    );
    const activeSessions = state.activeSessions.filter(
      (session) => session.emulator?.emulatorId.toLowerCase() === key,
    );
    for (const session of activeSessions) {
      await endSession(session, undefined, "settings-change");
    }
    logRuntime(`emulator ignored ${key}`);
  } else {
    logRuntime(`emulator restored ${key}`);
  }

  persist();
  void requestProcessScan(`after emulator ${ignored ? "ignore" : "restore"}`);
}

export function dismissEmulatorHostNotice(key: string) {
  const state = useAppStore.getState();
  const notice = state.emulatorObservations.find(
    (item) => item.kind === "host-notice" && item.key === key,
  );
  if (!notice || notice.kind !== "host-notice") return;
  state.setEmulatorObservation({
    ...notice,
    dismissedAt: new Date().toISOString(),
  });
  persist();
}

async function endActiveEmulatorRoute(contentKey: string) {
  const active = useAppStore
    .getState()
    .activeSessions.find(
      (session) => session.emulator?.contentKey === contentKey,
    );
  if (active) await endSession(active, undefined, "route-change");
}

function observationFromMapping(
  mapping: EmulatorMapping,
): EmulatorContentObservation {
  const now = new Date().toISOString();
  return {
    kind: "content",
    key: mapping.contentKey,
    emulatorId: mapping.emulatorId,
    label: mapping.label,
    hostExeName: "",
    contentKind: mapping.contentKind,
    contentValue: mapping.contentValue,
    display: mapping.display,
    trust: mapping.trust,
    detectionSource: mapping.detectionSource,
    shareable:
      mapping.shareable === false ||
      (mapping.shareable === undefined && !emulatorPrivacyReady)
        ? false
        : isShareableToken({
            value: mapping.contentValue,
            kind: mapping.contentKind,
            trust: mapping.trust,
            privateTokens: [
              emulatorPrivacy.userName,
              emulatorPrivacy.homeDirName,
            ],
          }),
    searchHint: mapping.display,
    state: "unknown",
    detectedAt: now,
    runningSince: lastEmulatorRunningKeys.has(mapping.contentKey)
      ? now
      : undefined,
  };
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
    igdbId: existing.igdbId,
    name: existing.gameName ?? exeName,
    coverUrl: existing.coverUrl ?? "",
    source: "community",
  };

  state.setExeCacheEntry({
    exeName: existing.exeName,
    state: "matched",
    gameId: communityGame.id,
    igdbId: communityGame.igdbId,
    gameName: communityGame.name,
    coverUrl: communityGame.coverUrl,
    source: "community",
    communitySuggestionId: existing.communitySuggestionId,
    communitySuggestionVerified: true,
    communitySuggestionStatus: "verified",
    communitySuggestionNote: undefined,
    lastCheckedAt: new Date().toISOString(),
  });

  useAppStore.setState((current) => ({
    activeSessions: current.activeSessions.map((session) =>
      session.exeName.toLowerCase() === key && session.source === "custom"
        ? {
            ...session,
            gameId: communityGame.id,
            igdbId: communityGame.igdbId,
            gameName: communityGame.name,
            coverUrl: communityGame.coverUrl,
            source: "community",
            communitySuggestionId: existing.communitySuggestionId,
            communitySuggestionVerified: true,
            communitySuggestionStatus: "verified",
            communitySuggestionNote: undefined,
          }
        : session,
    ),
    recentSessions: current.recentSessions.map((session) =>
      session.exeName.toLowerCase() === key && session.gameId === oldGameId
        ? {
            ...session,
            gameId: communityGame.id,
            igdbId: communityGame.igdbId,
            gameName: communityGame.name,
            coverUrl: communityGame.coverUrl,
            source: "community",
            communitySuggestionId: existing.communitySuggestionId,
            communitySuggestionVerified: true,
            communitySuggestionStatus: "verified",
            communitySuggestionNote: undefined,
          }
        : session,
    ),
  }));
  if (oldGameId !== undefined) {
    const from = `custom:${oldGameId}`;
    const to = `community:${communityGame.id}`;
    state.rekeyGameSeconds(from, to);
    state.carryAutoDetectedGameKey(from, to);
  }

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

function cacheAmbiguousMatch(
  process: ProcessSnapshot,
  candidates: Game[],
  flagReason?: IdentifierFlagReason,
) {
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
    flagReason,
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
        igdbId: cached.igdbId,
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
    igdbId: game.igdbId,
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
    if (!existing) noteDiscoveredExecutable(exeName);
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
  // A resolved match supersedes any pending ambiguity picker for this exe.
  state.removeAmbiguousMatch(exeName);
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
    igdbId: game.igdbId,
    gameName: game.name,
    coverUrl: game.coverUrl,
    source: game.source,
    lastCheckedAt: checkedAt,
  });
}

type StartSessionOptions = {
  startedAt?: string;
  emulator?: EmulatorLaunchContext;
  origin: "automatic" | "manual";
  targetPids?: number[];
};

function startSession(
  process: ProcessSnapshot,
  game: Game,
  options: StartSessionOptions,
): ActiveSession | null {
  const sessionKey = activeSessionKey(game.id, game.source, game.igdbId);
  const alreadyRunning = useAppStore
    .getState()
    .activeSessions.some(
      (session) => sessionIdentityKey(session) === sessionKey,
    );
  if (alreadyRunning) {
    verboseRuntime(
      `session already open for ${game.name}; ${process.exeName} joins it`,
    );
    return null;
  }

  logRuntime(`session starting ${game.name} (${process.exeName})`);
  const startedAt = options.startedAt ?? new Date().toISOString();
  const cacheEntry = useAppStore
    .getState()
    .exeCache.get(process.exeName.toLowerCase());
  const session: ActiveSession = {
    id: createSessionId(),
    gameId: game.id,
    igdbId: game.igdbId,
    gameName: game.name,
    exeName: process.exeName,
    coverUrl: game.coverUrl,
    source: game.source,
    communitySuggestionId: cacheEntry?.communitySuggestionId,
    communitySuggestionVerified: cacheEntry?.communitySuggestionVerified,
    communitySuggestionStatus: cacheEntry?.communitySuggestionStatus,
    communitySuggestionNote: cacheEntry?.communitySuggestionNote,
    startedAt,
    checkpointedAt: startedAt,
    emulator: options.emulator,
  };
  useAppStore.setState((state) => ({
    activeSessions: [...state.activeSessions, session],
  }));
  if (options.origin === "automatic") {
    const state = useAppStore.getState();
    const resolver = createGameIdentityResolver(
      state.gameMetadata,
      state.exeCache,
    );
    const firstAutoDetection = state.recordAutomaticDetection(
      autoDetectionKeys(
        {
          gameId: game.id,
          source: game.source,
          igdbId: game.igdbId,
          gameName: game.name,
          coverUrl: game.coverUrl,
        },
        resolver,
      ),
    );
    emitOverlayEvent({
      type: "session-started",
      gameName: game.name,
      coverUrl: game.coverUrl,
      firstAutoDetection,
      targetPids:
        options.targetPids ??
        (process.pid === undefined ? undefined : [process.pid]),
    });
  }
  return session;
}

export function selectAmbiguousMatch(exeName: string, game: Game) {
  const state = useAppStore.getState();
  const ambiguous = state.ambiguousMatches.find(
    (match) => match.exeName.toLowerCase() === exeName.toLowerCase(),
  );
  if (!ambiguous) return;

  cacheMatchResult(ambiguous.exeName, game);
  state.removeAmbiguousMatch(ambiguous.exeName);
  // The picked game may already be tracked through one of its other
  // executables; then this exe joins that session instead of adding a second.
  const sessionKey = activeSessionKey(game.id, game.source, game.igdbId);
  const active = useAppStore
    .getState()
    .activeSessions.some(
      (session) => sessionIdentityKey(session) === sessionKey,
    );
  if (!active) {
    if (ambiguous.endedAt) {
      addCompletedAmbiguousSession(ambiguous, game);
    } else {
      startSession(
        { exeName: ambiguous.exeName, exePath: ambiguous.exePath },
        game,
        { startedAt: ambiguous.detectedAt, origin: "manual" },
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
    igdbId: game.igdbId,
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

async function submitIdentifierReport(
  exeName: string,
  gameIdentity?: Pick<IdentifierReportPayload, "gameId" | "gameSource">,
): Promise<NegativeReportOutcome["report"]> {
  const state = useAppStore.getState();
  if (!state.installUuid) return "skipped";

  const endpoint = `${state.settings.apiEndpoint}/api/community/identifier-reports`;
  try {
    const payload: IdentifierReportPayload = {
      exeName,
      reason: "not_a_game",
      installUuid: state.installUuid,
      ...gameIdentity,
    };
    const response = await fetchWithTimeout(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      timeoutMs: API_REQUEST_TIMEOUT_MS,
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }
    const result = (await response.json()) as IdentifierReportResponse;
    state.addApiRequestLogEntry({
      endpoint,
      exeName,
      status: "unmatched",
      detail: `Negative match report ${result.status}`,
    });
    return result.status;
  } catch (error) {
    state.addApiRequestLogEntry({
      endpoint,
      exeName,
      status: "error",
      detail: formatError(error),
    });
    logRuntime(
      `negative match report failed ${exeName}: ${formatError(error)}`,
    );
    return "failed";
  }
}

export async function reportNegativeMatch(
  exeName: string,
): Promise<NegativeReportOutcome> {
  const key = exeName.toLowerCase();
  const state = useAppStore.getState();
  const existing = state.exeCache.get(key);
  const existingSource =
    existing?.state === "matched" ? (existing.source ?? "igdb") : undefined;
  const gameIdentity =
    existing?.state === "matched" &&
    existing.gameId !== undefined &&
    (existingSource === "igdb" || existingSource === "community")
      ? { gameId: existing.gameId, gameSource: existingSource }
      : undefined;

  const localOutcome = await ignoreProcessLocally(exeName);
  const report = await submitIdentifierReport(exeName, gameIdentity);
  void requestProcessScan("after negative match report");
  logRuntime(`negative match handled ${exeName}`);
  return { ...localOutcome, report };
}

async function ignoreProcessLocally(
  exeName: string,
): Promise<LocalProcessIgnoreOutcome> {
  const key = exeName.toLowerCase();
  const state = useAppStore.getState();
  // The in-app block is synchronous and is deliberately kept even when the
  // user-ignore file update succeeds. It prevents a running process from
  // racing the async IPC call and being matched again on the next scan.
  state.toggleBlacklist(exeName, true);
  for (const session of state.activeSessions.filter(
    (candidate) => candidate.exeName.toLowerCase() === key,
  )) {
    removeActiveSession(session);
  }
  state.removeExeCacheEntry(exeName);
  state.removeAmbiguousMatch(exeName);
  persist();

  let ignoreFileUpdated = false;
  try {
    await setUserIgnoredProcess(exeName, true);
    ignoreFileUpdated = true;
  } catch (error) {
    logRuntime(
      `local process ignore-file update failed ${exeName}: ${formatError(error)}`,
    );
  }
  return {
    localBlockApplied: useAppStore.getState().blacklist.has(key),
    ignoreFileUpdated,
  };
}

export async function ignoreDiscoveredProcess(
  exeName: string,
): Promise<IgnoredProcessSuggestionOutcome> {
  if (useAppStore.getState().settings.autoShareIgnoredProcesses) {
    return suggestIgnoredProcess(exeName);
  }

  const local = await ignoreProcessLocally(exeName);
  void requestProcessScan("after process ignored");
  logRuntime(`process ignored locally ${exeName}`);
  return { ...local, suggestion: { kind: "disabled" } };
}

export function suggestIgnoredProcess(
  exeName: string,
): Promise<IgnoredProcessSuggestionOutcome> {
  const key = exeName.toLowerCase();
  const existing = ignoredProcessSuggestionRequests.get(key);
  if (existing) return existing;
  const request = runIgnoredProcessSuggestion(exeName, key).finally(() => {
    ignoredProcessSuggestionRequests.delete(key);
  });
  ignoredProcessSuggestionRequests.set(key, request);
  return request;
}

async function runIgnoredProcessSuggestion(
  exeName: string,
  key: string,
): Promise<IgnoredProcessSuggestionOutcome> {
  const state = useAppStore.getState();
  const cached = state.exeCache.get(key);
  const hasPicker = state.ambiguousMatches.some(
    (match) => match.exeName.toLowerCase() === key,
  );
  const blocked: IgnoredProcessSuggestionResult | null =
    cached?.state === "matched"
      ? { kind: "not_eligible", reason: "matched_game" }
      : hasPicker
        ? { kind: "not_eligible", reason: "ambiguous_picker" }
        : isOfflineStatus(state.backendHealth.status)
          ? { kind: "skipped", reason: "offline" }
          : !state.installUuid
            ? { kind: "skipped", reason: "no_install_uuid" }
            : null;

  const local = await ignoreProcessLocally(exeName);
  void requestProcessScan("after ignored process suggestion");
  const suggestion =
    blocked ??
    (await submitIgnoredProcessReport(exeName, state.installUuid as string));
  logRuntime(
    `ignored process suggestion handled ${exeName} result=${suggestion.kind}`,
  );
  return { ...local, suggestion };
}

async function submitIgnoredProcessReport(
  exeName: string,
  installUuid: string,
): Promise<IgnoredProcessSuggestionResult> {
  const state = useAppStore.getState();
  const endpoint = `${state.settings.apiEndpoint}/api/community/ignored-processes`;
  try {
    const payload: IgnoredProcessReportPayload = {
      exeName,
      platform: currentPlatform(),
      installUuid,
    };
    const response = await fetchWithTimeout(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      timeoutMs: API_REQUEST_TIMEOUT_MS,
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }
    const result = (await response.json()) as IgnoredProcessReportResponse;
    state.addApiRequestLogEntry({
      endpoint,
      exeName,
      status: "unmatched",
      detail: `Ignored process suggestion ${result.status}`,
    });
    return {
      kind: "suggested",
      status: result.status,
    };
  } catch (error) {
    state.addApiRequestLogEntry({
      endpoint,
      exeName,
      status: "error",
      detail: formatError(error),
    });
    logRuntime(
      `ignored process suggestion failed ${exeName}: ${formatError(error)}`,
    );
    return { kind: "failed" };
  }
}

export async function dismissAmbiguousMatch(exeName: string) {
  const outcome = await ignoreProcessLocally(exeName);
  void requestProcessScan("after ambiguous match dismissed");
  logRuntime(`ambiguous match dismissed and ignored locally ${exeName}`);
  return outcome;
}

type SessionEndReason =
  | "process-ended"
  | "recovered-checkpoint"
  | "stale-timeout"
  | "settings-change"
  | "route-change";

async function endSession(
  session: ActiveSession,
  endedAtOverride?: string,
  reason: SessionEndReason = "process-ended",
) {
  logRuntime(`session ending ${session.gameName} (${session.exeName})`);
  const endedAt = endedAtOverride ?? new Date().toISOString();
  const durationSeconds = Math.max(
    1,
    Math.round((Date.parse(endedAt) - Date.parse(session.startedAt)) / 1000),
  );
  useAppStore.getState().addSession({
    id: session.id,
    gameId: session.gameId,
    igdbId: session.igdbId,
    gameName: session.gameName,
    coverUrl: session.coverUrl,
    source: session.source,
    communitySuggestionId: session.communitySuggestionId,
    communitySuggestionVerified: session.communitySuggestionVerified,
    communitySuggestionStatus: session.communitySuggestionStatus,
    communitySuggestionNote: session.communitySuggestionNote,
    exeName: session.exeName,
    startedAt: session.startedAt,
    endedAt,
    durationSeconds,
    emulator: session.emulator,
  });
  removeActiveSession(session);
  const freshMilestones = evaluateAndStoreMilestones();
  if (reason === "process-ended") {
    const top = pickTopMilestone(freshMilestones);
    emitOverlayEvent({
      type: "session-ended",
      gameName: session.gameName,
      coverUrl: session.coverUrl,
      durationSeconds,
      totalSeconds: currentGameTotalSeconds(session),
      milestoneTitle: top?.title,
      milestoneMetric: top ? milestoneMetricLabel(top.id) : undefined,
      milestoneGameScoped:
        top !== null && parseMilestoneId(top.id)?.category === "game",
    });
  }
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
      await endSession(active, active.checkpointedAt, "stale-timeout");
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
  const result = persistAppState(state);
  if (result.status !== "failed") {
    useAppStore.setState((current) => {
      const recentSessions = sameArrayItems(
        current.recentSessions,
        result.sessions,
      )
        ? current.recentSessions
        : result.sessions;
      const notifications = sameArrayItems(
        current.notifications,
        result.notifications,
      )
        ? current.notifications
        : result.notifications;
      const archivedGameSeconds = sameNumberRecord(
        current.archivedGameSeconds,
        result.archivedGameSeconds,
      )
        ? current.archivedGameSeconds
        : result.archivedGameSeconds;
      if (
        recentSessions === current.recentSessions &&
        notifications === current.notifications &&
        result.archivedSeconds === current.archivedSeconds &&
        archivedGameSeconds === current.archivedGameSeconds
      ) {
        return current;
      }
      return {
        recentSessions,
        notifications,
        archivedSeconds: result.archivedSeconds,
        archivedGameSeconds,
      };
    });
  }
  if (result.status === "trimmed") {
    const oldest = result.removed.at(-1)?.startedAt;
    if (result.removed.length > 0) {
      logRuntime(
        `storage quota reached; removed ${result.removed.length} oldest sessions`,
      );
      state.addToast({
        tone: "error",
        title: "History storage was full",
        detail: `${result.removed.length} oldest sessions${oldest ? `, ending around ${new Date(oldest).toLocaleDateString()}` : ""}, were archived so new data could be saved.`,
      });
    }
  } else if (result.status === "failed") {
    logRuntime("local persistence failed after retry");
    state.addToast({
      tone: "error",
      title: "Changes could not be saved",
      detail:
        "Local storage is unavailable or full. Your in-memory history was kept.",
    });
  }
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

export async function pollContributions(
  reason: string,
  options: { suppressNotifications?: boolean } = {},
) {
  const state = useAppStore.getState();
  const suppressNotifications =
    options.suppressNotifications ||
    state.suppressContributionNotificationsOnce;
  const installUuid = state.installUuid;
  if (!installUuid) return;
  if (
    state.backendHealth.status === "offline" ||
    state.backendHealth.status === "reconnecting"
  ) {
    verboseRuntime(`contributions poll ${reason} skipped while offline`);
    return;
  }

  try {
    const pollStartedAt = Date.now();
    const params = new URLSearchParams({ installUuid });
    const response = await fetchWithTimeout(
      `${state.settings.apiEndpoint}/api/community/contributions?${params}`,
      { timeoutMs: API_REQUEST_TIMEOUT_MS },
    );
    if (!response.ok)
      throw new Error(`${response.status} ${response.statusText}`);
    const body = (await response.json()) as ContributionsResponse;
    const previous = useAppStore.getState().seenContributionStatus;
    const arrived: AppNotification[] = [];
    const seenContributionStatus = { ...previous };
    for (const contribution of body.items) {
      const key = contributionKey(contribution);
      if (
        shouldNotifyContributionTransition(previous[key], contribution.status)
      ) {
        const notification = contributionNotification(contribution);
        if (notification) arrived.push(notification);
      }
      seenContributionStatus[key] = contribution.status;
    }
    const emulator = body.emulator;
    if (emulator) {
      for (const contribution of emulator.items) {
        const key = emulatorContributionKey(contribution);
        if (
          shouldNotifyContributionTransition(previous[key], contribution.status)
        ) {
          const notification = emulatorContributionNotification(
            contribution,
            adapterFor(contribution.emulatorId)?.label ??
              contribution.emulatorId,
          );
          if (notification) arrived.push(notification);
        }
        seenContributionStatus[key] = contribution.status;
      }
    }

    const delivered = suppressNotifications ? [] : arrived;
    useAppStore.setState((current) => {
      const exeCache = applyContributionMarkers(current.exeCache, body.items);
      const updateSession = <T extends ActiveSession | Session>(
        session: T,
      ): T => {
        const contribution = body.items.find(
          (item) =>
            item.value.toLowerCase() === session.exeName.toLowerCase() &&
            item.gameId === session.communitySuggestionId,
        );
        if (!contribution) {
          return session;
        }
        return {
          ...session,
          communitySuggestionVerified: contribution.status === "verified",
          communitySuggestionStatus: contribution.status,
          communitySuggestionNote: contribution.reviewNote,
        };
      };
      const notifications = [...delivered, ...current.notifications].filter(
        (notification, index, all) =>
          all.findIndex((candidate) => candidate.id === notification.id) ===
          index,
      );
      let emulatorMappings = current.emulatorMappings;
      if (emulator) {
        emulatorMappings = new Map(current.emulatorMappings);
        const serverItems = new Map(
          emulator.items.map((item) => [emulatorContributionKey(item), item]),
        );
        for (const [key, mapping] of emulatorMappings) {
          const share =
            mapping.share?.gameId === mapping.gameId
              ? mapping.share
              : undefined;
          const serverKey =
            mapping.gameId === undefined
              ? null
              : emulatorContributionKey({
                  emulatorId: mapping.emulatorId,
                  contentKind: mapping.contentKind,
                  contentValue: mapping.contentValue,
                  gameId: mapping.gameId,
                });
          const contribution = serverKey
            ? serverItems.get(serverKey)
            : undefined;
          if (contribution) {
            emulatorMappings.set(key, {
              ...mapping,
              share: {
                status: contribution.status,
                gameId: contribution.gameId,
                submittedAt: share?.submittedAt ?? contribution.createdAt,
              },
            });
          } else if (
            share &&
            share.status !== "already_curated" &&
            Date.parse(share.submittedAt) < pollStartedAt
          ) {
            emulatorMappings.set(key, { ...mapping, share: undefined });
          }
        }
      }
      return {
        exeCache,
        activeSessions: current.activeSessions.map(updateSession),
        recentSessions: current.recentSessions.map(updateSession),
        emulatorMappings,
        seenContributionStatus: {
          ...current.seenContributionStatus,
          ...seenContributionStatus,
        },
        contributionCounts: body.counts,
        emulatorContributionCounts: emulator
          ? emulator.counts
          : current.emulatorContributionCounts,
        notifications: notifications.slice(0, 100),
        suppressContributionNotificationsOnce: false,
      };
    });

    for (const notification of delivered) {
      useAppStore.getState().addToast({
        tone: notification.kind === "suggestion-verified" ? "success" : "info",
        emoji: notificationEmoji(notification.kind),
        title: notification.title,
        detail: notification.body,
      });
    }
    evaluateAndStoreMilestones({
      verifiedContributionsAuthoritative: true,
      emulatorContributionsAuthoritative: Boolean(emulator),
      suppressNotifications,
    });
    logRuntime(
      `contributions poll ${reason} items=${body.items.length} emulator=${emulator?.items.length ?? "unknown"}`,
    );
  } catch (error) {
    verboseRuntime(
      `contributions poll ${reason} failed: ${formatError(error)}`,
    );
  }
}

function sameArrayItems<T>(left: readonly T[], right: readonly T[]) {
  return (
    left.length === right.length &&
    left.every((item, index) => item === right[index])
  );
}

function sameNumberRecord(
  left: Readonly<Record<string, number>>,
  right: Readonly<Record<string, number>>,
) {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every((key) => left[key] === right[key])
  );
}

export function evaluateAndStoreMilestones(
  options: {
    now?: Date;
    verifiedContributionsAuthoritative?: boolean;
    emulatorContributionsAuthoritative?: boolean;
    suppressNotifications?: boolean;
  } = {},
) {
  const now = options.now ?? new Date();
  const state = useAppStore.getState();
  const resolveIgdbId = createGameIdentityResolver(
    state.gameMetadata,
    state.exeCache,
  );
  const result = evaluateMilestones({
    sessions: state.recentSessions,
    archivedSeconds: state.archivedSeconds,
    archivedGameSeconds: state.archivedGameSeconds,
    playtimeAdjustments: state.playtimeAdjustments,
    verifiedContributions: state.contributionCounts.verified,
    verifiedEmulatorContributions: state.emulatorContributionCounts.verified,
    awardedMilestones: state.awardedMilestones,
    milestonesInitializedAt: state.milestonesInitializedAt,
    verifiedContributionsAuthoritative:
      options.verifiedContributionsAuthoritative,
    emulatorContributionsAuthoritative:
      options.emulatorContributionsAuthoritative,
    resolveIgdbId,
    now,
  });
  const revoked = new Set(result.revokedMilestoneIds);
  const delivered = options.suppressNotifications ? [] : result.notifications;
  useAppStore.setState((current) => ({
    awardedMilestones: result.awardedMilestones,
    milestonesInitializedAt: result.milestonesInitializedAt,
    notifications: [...delivered, ...current.notifications]
      .filter((notification) => !revoked.has(notification.id))
      .filter(
        (notification, index, all) =>
          all.findIndex((candidate) => candidate.id === notification.id) ===
          index,
      )
      .slice(0, 100),
  }));
  for (const notification of delivered) {
    state.addToast({
      tone: "success",
      emoji: notificationEmoji(notification.kind),
      title: notification.title,
      detail: notification.body,
    });
  }
  if (result.revokedMilestoneIds.length > 0) {
    logRuntime(`milestones revoked ${result.revokedMilestoneIds.join(", ")}`);
  }
  persist();
  return delivered;
}

function currentGameTotalSeconds(session: ActiveSession) {
  const state = useAppStore.getState();
  const resolver = createGameIdentityResolver(
    state.gameMetadata,
    state.exeCache,
  );
  const metrics = milestoneMetrics({
    sessions: state.recentSessions,
    archivedSeconds: state.archivedSeconds,
    archivedGameSeconds: state.archivedGameSeconds,
    playtimeAdjustments: state.playtimeAdjustments,
    verifiedContributions: state.contributionCounts.verified,
    resolveIgdbId: resolver,
  });
  const key = resolvedCanonicalGameKey(session, resolver);
  return Math.round((metrics.games.get(key)?.hours ?? 0) * 3_600);
}

export function applyContributionMarkers(
  current: Map<string, ExeCacheEntry>,
  contributions: Contribution[],
) {
  const exeCache = new Map(current);
  const byExe = new Map<string, Contribution[]>();
  for (const contribution of contributions) {
    const key = contribution.value.toLowerCase();
    byExe.set(key, [...(byExe.get(key) ?? []), contribution]);
  }

  for (const [exeKey, candidates] of byExe) {
    const entry = exeCache.get(exeKey);
    if (entry?.state !== "matched" || entry.source !== "custom") continue;

    let contribution = candidates.find(
      (candidate) => candidate.gameId === entry.communitySuggestionId,
    );
    if (!contribution && entry.communitySuggestionId === undefined) {
      const viable = candidates.filter((candidate) => {
        const namesMatch =
          candidate.gameName.trim().toLowerCase() ===
          (entry.gameName ?? "").trim().toLowerCase();
        const coversMatch =
          !candidate.coverUrl ||
          !entry.coverUrl ||
          candidate.coverUrl === entry.coverUrl;
        return namesMatch && coversMatch;
      });
      if (viable.length === 1) contribution = viable[0];
    }
    if (!contribution) continue;

    exeCache.set(exeKey, {
      ...entry,
      pendingCommunityGame:
        contribution.status === "pending"
          ? {
              id: contribution.gameId,
              name: contribution.gameName,
              coverUrl: contribution.coverUrl,
              source: "community",
            }
          : undefined,
      communitySuggestionId: contribution.gameId,
      communitySuggestionVerified: contribution.status === "verified",
      communitySuggestionStatus: contribution.status,
      communitySuggestionNote: contribution.reviewNote,
    });
  }
  return exeCache;
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
  // A pending ambiguity picker for this exe is obsolete now.
  state.removeAmbiguousMatch(exeName);
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
  igdbId?: number,
) {
  const normalizedGameName = gameName.trim();
  if (!normalizedGameName) return null;

  const game: Game = {
    // Every executable suggested for the same game shares the suggestion id,
    // so they share one local game while the suggestion is pending. Without
    // this the second exe would get its own local id and run a second session
    // next to the first one until approval merges them.
    id: sharedCustomGameId(exeName, communitySuggestionId),
    igdbId,
    name: normalizedGameName,
    coverUrl,
    source: "custom",
  };
  backfillTrackedRuntime(exeName, game);
  useAppStore.getState().setExeCacheEntry({
    exeName,
    state: "matched",
    gameId: game.id,
    igdbId: game.igdbId,
    gameName: game.name,
    coverUrl,
    source: "custom",
    pendingCommunityGame: communitySuggestionVerified
      ? undefined
      : {
          id: communitySuggestionId,
          igdbId,
          name: game.name,
          coverUrl,
          source: "community",
        },
    communitySuggestionId,
    communitySuggestionVerified,
    communitySuggestionStatus: communitySuggestionVerified
      ? "verified"
      : "pending",
    communitySuggestionNote: undefined,
    lastCheckedAt: new Date().toISOString(),
  });
  logRuntime(
    `shared custom game added ${exeName} -> ${game.name} suggestion=${communitySuggestionId}`,
  );
  persist();
  void requestProcessScan("after shared custom game add");
  return game;
}

// Shares an already tracked custom game as a community suggestion: the entry
// takes the suggested metadata plus the "awaiting approval" marker (same as
// Discovered's "Add & Share"), and recorded sessions follow the new name and
// cover so the library card matches the suggestion.
export function shareTrackedCustomGame(
  exeName: string,
  gameName: string,
  coverUrl: string,
  communitySuggestionId: number,
  communitySuggestionVerified: boolean,
  igdbId?: number,
) {
  const key = exeName.toLowerCase();
  const existing = useAppStore.getState().exeCache.get(key);
  if (existing?.state !== "matched" || existing.source !== "custom") {
    return null;
  }

  const oldGameId = existing.gameId;
  const game = addSharedCustomGame(
    exeName,
    gameName,
    coverUrl,
    communitySuggestionId,
    communitySuggestionVerified,
    igdbId,
  );
  if (!game) return null;

  useAppStore.setState((current) => ({
    activeSessions: current.activeSessions.map((session) =>
      session.exeName.toLowerCase() === key && session.gameId === oldGameId
        ? {
            ...session,
            gameId: game.id,
            igdbId: game.igdbId,
            gameName: game.name,
            coverUrl: game.coverUrl,
            communitySuggestionId,
            communitySuggestionVerified,
            communitySuggestionStatus: communitySuggestionVerified
              ? "verified"
              : "pending",
            communitySuggestionNote: undefined,
          }
        : session,
    ),
    recentSessions: current.recentSessions.map((session) =>
      session.exeName.toLowerCase() === key && session.gameId === oldGameId
        ? {
            ...session,
            gameId: game.id,
            igdbId: game.igdbId,
            gameName: game.name,
            coverUrl: game.coverUrl,
            communitySuggestionId,
            communitySuggestionVerified,
            communitySuggestionStatus: communitySuggestionVerified
              ? "verified"
              : "pending",
            communitySuggestionNote: undefined,
          }
        : session,
    ),
  }));
  logRuntime(
    `tracked custom game shared ${exeName} -> ${game.name} suggestion=${communitySuggestionId}`,
  );
  persist();
  return game;
}

// Demotes a wrongly matched igdb/community game to a local custom game - the
// escape hatch when the real game exists in no database (e.g. an own tool or
// unlisted title). Purely local; the shared mapping stays untouched.
export function convertToCustomGame(exeName: string, gameName: string) {
  const normalizedGameName = gameName.trim();
  if (!normalizedGameName) return;
  const existing = useAppStore.getState().exeCache.get(exeName.toLowerCase());
  if (existing?.state !== "matched" || existing.source === "custom") return;
  applyGameMatch(exeName, {
    id: customGameId(exeName),
    name: normalizedGameName,
    coverUrl: existing.coverUrl ?? "",
    source: "custom",
  });
  logRuntime(`converted to custom game ${exeName} -> ${normalizedGameName}`);
}

// Suggests the correct game for a tracked exe to the community. Custom games
// are shared as-is; for igdb/community games this is the "report wrong match"
// path - the exe is retagged locally as a shared custom game carrying the
// suggested metadata and the awaiting-approval marker.
export function suggestTrackedGameToCommunity(
  exeName: string,
  gameName: string,
  coverUrl: string,
  communitySuggestionId: number,
  communitySuggestionVerified: boolean,
  igdbId?: number,
) {
  const existing = useAppStore.getState().exeCache.get(exeName.toLowerCase());
  if (existing?.state !== "matched") return null;
  if (existing.source === "custom") {
    return shareTrackedCustomGame(
      exeName,
      gameName,
      coverUrl,
      communitySuggestionId,
      communitySuggestionVerified,
      igdbId,
    );
  }

  const customGame: Game = {
    id: customGameId(exeName),
    igdbId,
    name: gameName.trim(),
    coverUrl,
    source: "custom",
  };
  if (!customGame.name) return null;
  applyGameMatch(exeName, customGame);
  setCommunitySuggestionMarker(
    exeName,
    {
      id: communitySuggestionId,
      igdbId,
      name: customGame.name,
      coverUrl,
      source: "community",
    },
    communitySuggestionVerified,
  );
  logRuntime(
    `wrong match reported ${exeName} -> ${customGame.name} suggestion=${communitySuggestionId}`,
  );
  persist();
  return customGame;
}

// Resolves an ambiguity picker with a locally created custom game - the
// offline-friendly escape hatch when none of the candidates fit and the
// community search is not available or not wanted. Runs through the regular
// ambiguous selection so the runtime since detection is credited.
export function selectAmbiguousCustomGame(exeName: string, gameName: string) {
  const normalizedGameName = gameName.trim();
  if (!normalizedGameName) return;
  selectAmbiguousMatch(exeName, {
    id: customGameId(exeName),
    name: normalizedGameName,
    coverUrl: "",
    source: "custom",
  });
}

export function selectAmbiguousCommunitySuggestion(
  exeName: string,
  gameName: string,
  coverUrl: string,
  communitySuggestionId: number,
  communitySuggestionVerified: boolean,
  igdbId?: number,
) {
  const game = addSharedCustomGame(
    exeName,
    gameName,
    coverUrl,
    communitySuggestionId,
    communitySuggestionVerified,
    igdbId,
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
  aliases: GameAliasRef[] = [{ gameId, source }],
) {
  untrackGameInternal(gameId, source, removeHistory, aliases, "remove");
}

function untrackGameInternal(
  gameId: number,
  source: Game["source"] | null,
  removeHistory: boolean,
  aliases: GameAliasRef[],
  emulatorDisposition: "remove" | "ignore",
) {
  const state = useAppStore.getState();
  const matchingExeNames = [...state.exeCache.values()]
    .filter(
      (entry) =>
        entry.state === "matched" &&
        aliases.some(
          (alias) =>
            entry.gameId === alias.gameId &&
            (entry.source ?? null) === alias.source,
        ),
    )
    .map((entry) => entry.exeName);

  for (const session of state.activeSessions) {
    if (!matchesGameAlias(session, aliases)) continue;
    removeActiveSession(session);
  }

  for (const exeName of matchingExeNames) {
    state.removeExeCacheEntry(exeName);
  }

  for (const mapping of state.emulatorMappings.values()) {
    if (
      mapping.gameId === undefined ||
      !matchesGameAlias(
        {
          gameId: mapping.gameId,
          source: mapping.source,
        },
        aliases,
      )
    )
      continue;
    state.removeEmulatorObservation(mapping.contentKey);
    if (emulatorDisposition === "remove") {
      state.removeEmulatorMapping(mapping.contentKey);
      continue;
    }
    state.setEmulatorMapping({
      contentKey: mapping.contentKey,
      emulatorId: mapping.emulatorId,
      label: mapping.label,
      contentKind: mapping.contentKind,
      contentValue: mapping.contentValue,
      display: mapping.display,
      trust: mapping.trust,
      detectionSource: mapping.detectionSource,
      decision: "ignored",
      confidence: "user",
      decidedAt: new Date().toISOString(),
      lastSeenAt: mapping.lastSeenAt,
    });
  }

  if (removeHistory) {
    useAppStore.setState((current) => ({
      recentSessions: current.recentSessions.filter((session) => {
        return !matchesGameAlias(session, aliases);
      }),
    }));
    state.clearGameSeconds(gameSecondsKeys(aliases));
  }

  logRuntime(
    `game untracked gameId=${gameId} source=${source ?? "unknown"} exes=${matchingExeNames.length} emulatorDisposition=${emulatorDisposition} removeHistory=${removeHistory}`,
  );
  evaluateAndStoreMilestones();
  persist();
  void requestProcessScan("after game untrack");
}

// Adds a manually entered play session for a game already in the library. The
// caller supplies the game identity (from its existing sessions/cache) so the
// entry aggregates onto the same library card. endedAt defaults to now; the
// start is derived so the session spans the given duration.
export function addManualSession(params: {
  gameId: number;
  igdbId?: number;
  gameName: string;
  coverUrl: string;
  source: Game["source"] | null;
  exeName: string;
  durationSeconds: number;
  endedAt: string;
  communitySuggestionId?: number;
  communitySuggestionVerified?: boolean;
  communitySuggestionStatus?: ContributionStatus;
  communitySuggestionNote?: string;
}) {
  const durationSeconds = Math.round(params.durationSeconds);
  if (!Number.isFinite(durationSeconds) || durationSeconds < 1) return;

  const endedAtMs = Date.parse(params.endedAt);
  if (!Number.isFinite(endedAtMs)) {
    throw new Error("Manual sessions require a valid date and time");
  }
  const endedAt = new Date(endedAtMs).toISOString();
  const startedAt = new Date(
    Date.parse(endedAt) - durationSeconds * 1000,
  ).toISOString();

  useAppStore.getState().addSession({
    id: createSessionId(),
    gameId: params.gameId,
    igdbId: params.igdbId,
    gameName: params.gameName,
    coverUrl: params.coverUrl,
    source: params.source ?? undefined,
    communitySuggestionId: params.communitySuggestionId,
    communitySuggestionVerified: params.communitySuggestionVerified,
    communitySuggestionStatus: params.communitySuggestionStatus,
    communitySuggestionNote: params.communitySuggestionNote,
    exeName: params.exeName,
    startedAt,
    endedAt,
    durationSeconds,
    origin: "manual",
  });
  logRuntime(
    `manual session added ${params.gameName} (${params.exeName}) seconds=${durationSeconds}`,
  );
  evaluateAndStoreMilestones();
}

export function setGamePlaytime(params: {
  gameId: number;
  igdbId?: number;
  gameName: string;
  coverUrl: string;
  source: Game["source"] | null;
  exeName: string;
  targetSeconds: number;
  communitySuggestionId?: number;
  communitySuggestionVerified?: boolean;
  communitySuggestionStatus?: ContributionStatus;
  communitySuggestionNote?: string;
  aliases?: GameAliasRef[];
}) {
  if (!Number.isFinite(params.targetSeconds)) {
    throw new Error("Playtime must be a finite number");
  }
  const targetSeconds = Math.max(0, Math.round(params.targetSeconds));
  if (targetSeconds > 0 && targetSeconds < 60) {
    throw new Error("Playtime must be zero or at least one minute");
  }

  const aliases = params.aliases ?? [
    { gameId: params.gameId, source: params.source },
  ];
  const matchesGame = (session: { gameId: number; source?: Game["source"] }) =>
    matchesGameAlias(session, aliases);
  const state = useAppStore.getState();

  if (state.activeSessions.some(matchesGame)) {
    throw new Error("Stop the active session before adjusting playtime");
  }

  const keys = gameSecondsKeys(aliases);
  const retainedSeconds = state.recentSessions
    .filter(matchesGame)
    .reduce(
      (total, session) => total + Math.max(0, session.durationSeconds ?? 0),
      0,
    );
  const archivedSeconds = keys.reduce(
    (total, key) => total + Math.max(0, state.archivedGameSeconds[key] ?? 0),
    0,
  );
  const recordedSeconds = retainedSeconds + archivedSeconds;
  const adjustmentSeconds = nextAdjustmentSeconds(
    recordedSeconds,
    targetSeconds,
  );
  state.setPlaytimeAdjustment(
    gameSecondsKey({ gameId: params.gameId, source: params.source }),
    adjustmentSeconds,
    keys,
  );
  logRuntime(
    `game playtime adjustment set gameId=${params.gameId} source=${params.source ?? "unknown"} recorded=${recordedSeconds} target=${targetSeconds} offset=${adjustmentSeconds}`,
  );
  evaluateAndStoreMilestones();
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
  evaluateAndStoreMilestones();
}

export function removeGameHistory(
  gameId: number,
  aliases: GameAliasRef[] = [{ gameId, source: null }],
) {
  const previousCount = useAppStore.getState().recentSessions.length;
  useAppStore.setState((state) => ({
    recentSessions: state.recentSessions.filter(
      (session) => !matchesGameAlias(session, aliases),
    ),
  }));
  useAppStore.getState().clearGameSeconds(gameSecondsKeys(aliases));
  const removedCount =
    previousCount - useAppStore.getState().recentSessions.length;
  if (removedCount > 0)
    logRuntime(
      `game history removed gameId=${gameId} sessions=${removedCount}`,
    );
  evaluateAndStoreMilestones();
}

export function removeGameHistoryBySource(
  gameId: number,
  source: Game["source"] | null,
  aliases: GameAliasRef[] = [{ gameId, source }],
) {
  const previousCount = useAppStore.getState().recentSessions.length;
  useAppStore.setState((state) => ({
    recentSessions: state.recentSessions.filter((session) => {
      return !matchesGameAlias(session, aliases);
    }),
  }));
  useAppStore.getState().clearGameSeconds(gameSecondsKeys(aliases));
  const removedCount =
    previousCount - useAppStore.getState().recentSessions.length;
  if (removedCount > 0)
    logRuntime(
      `game history removed gameId=${gameId} source=${source ?? "unknown"} sessions=${removedCount}`,
    );
  evaluateAndStoreMilestones();
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
  let randomState = 0x5eed1234;
  const random = () => {
    randomState = (randomState * 1664525 + 1013904223) >>> 0;
    return randomState / 0x1_0000_0000;
  };
  const fakeSessions: Session[] = [];
  let sequence = 0;
  for (let daysAgo = 0; daysAgo < 365; daysAgo += 1) {
    const day = new Date(now);
    day.setHours(0, 0, 0, 0);
    day.setDate(day.getDate() - daysAgo);
    const weekend = day.getDay() === 0 || day.getDay() === 6;
    if (random() > (weekend ? 0.68 : 0.38)) continue;
    const count = random() < (weekend ? 0.3 : 0.12) ? 2 : 1;
    for (let index = 0; index < count; index += 1) {
      const gameIndex = Math.floor(random() * fakeHistoryGames.length);
      const game = fakeHistoryGames[gameIndex];
      const durationHours =
        game.durationsHours[Math.floor(random() * game.durationsHours.length)];
      const crossesMidnight = sequence % 29 === 0;
      const start = new Date(day);
      start.setHours(
        crossesMidnight
          ? 23
          : weekend
            ? 12 + Math.floor(random() * 9)
            : 18 + Math.floor(random() * 5),
        Math.floor(random() * 4) * 15,
        0,
        0,
      );
      const durationSeconds = Math.round(
        (crossesMidnight ? Math.max(2.5, durationHours) : durationHours) *
          60 *
          60,
      );
      const endedAtMs = start.getTime() + durationSeconds * 1000;
      if (endedAtMs > now) continue;
      fakeSessions.push({
        id: FAKE_HISTORY_SESSION_ID_BASE - sequence,
        gameId: game.id,
        gameName: game.name,
        coverUrl: game.coverUrl,
        source: "custom",
        exeName: game.exeName,
        startedAt: start.toISOString(),
        endedAt: new Date(endedAtMs).toISOString(),
        durationSeconds,
      });
      sequence += 1;
    }
  }
  const nowDate = new Date(now);
  const transitionYear =
    nowDate.getMonth() < 2 ? nowDate.getFullYear() - 1 : nowDate.getFullYear();
  const springTransition = new Date(transitionYear, 2, 31, 0, 30, 0, 0);
  springTransition.setDate(31 - springTransition.getDay());
  const transitionDurationSeconds = 4 * 60 * 60;
  const transitionEndMs =
    springTransition.getTime() + transitionDurationSeconds * 1000;
  const transitionGame = fakeHistoryGames[0];
  fakeSessions.push({
    id: FAKE_HISTORY_SESSION_ID_BASE - sequence,
    gameId: transitionGame.id,
    gameName: transitionGame.name,
    coverUrl: transitionGame.coverUrl,
    source: "custom",
    exeName: transitionGame.exeName,
    startedAt: springTransition.toISOString(),
    endedAt: new Date(transitionEndMs).toISOString(),
    durationSeconds: transitionDurationSeconds,
  });

  useAppStore.setState((state) => ({
    recentSessions: normalizeSessions([
      ...fakeSessions,
      ...state.recentSessions.filter(
        (session) => !isFakeHistorySession(session),
      ),
    ]),
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

// Developer-only reset for testing an empty installation's library without
// changing app preferences, install identity, contribution state, or ignored
// processes. Active sessions are intentionally discarded instead of being
// finalized so a reset cannot immediately recreate cards through History.
export function clearLocalLibrary() {
  const state = useAppStore.getState();
  const cleared = {
    matches: state.exeCache.size,
    sessions: state.recentSessions.length,
    activeSessions: state.activeSessions.length,
    emulatorMappings: state.emulatorMappings.size,
  };

  useAppStore.setState({
    activeSessions: [],
    ambiguousMatches: [],
    emulatorObservations: [],
    emulatorMappings: new Map(),
    recentSessions: [],
    gameMetadata: new Map(),
    exeCache: new Map(),
    archivedSeconds: 0,
    archivedGameSeconds: {},
    playtimeAdjustments: {},
    autoDetectedGameKeys: [],
  });

  logRuntime(
    `local library cleared matches=${cleared.matches} sessions=${cleared.sessions} active=${cleared.activeSessions} emulatorMappings=${cleared.emulatorMappings}`,
  );
  evaluateAndStoreMilestones({ suppressNotifications: true });
  return cleared;
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
  gameRefs: Array<{
    gameId: number;
    source?: Game["source"];
    gameName?: string;
    coverUrl?: string;
  }>,
) {
  let state = useAppStore.getState();
  // Repair contradictory persisted metadata before checking connectivity. A
  // local test database may have been reset while the app was closed, and the
  // stale canonical id must not merge games even when startup is offline.
  stampCanonicalIdsFromMetadata([]);
  state = useAppStore.getState();
  if (
    state.backendHealth.status === "offline" ||
    state.backendHealth.status === "reconnecting"
  ) {
    verboseRuntime("game metadata hydration skipped; backend offline");
    return false;
  }

  const refs = gameRefs.filter(
    (ref) => ref.gameId > 0 && ref.source !== "custom",
  );
  for (const entry of state.exeCache.values()) {
    if (entry.state !== "matched" || entry.igdbId !== undefined) continue;
    if (
      (entry.source === "igdb" || entry.source === "community") &&
      entry.gameId !== undefined &&
      entry.gameId > 0
    ) {
      refs.push({ gameId: entry.gameId, source: entry.source });
    } else if (
      entry.source === "custom" &&
      entry.communitySuggestionId !== undefined &&
      entry.communitySuggestionId > 0
    ) {
      refs.push({
        gameId: entry.communitySuggestionId,
        source: "community",
      });
    }
  }
  const missingIds = [
    ...new Set(
      refs
        .filter((ref) => {
          if (ref.source === "custom") return false;
          if (!ref.source) {
            return (
              state.gameMetadata.get(`igdb:${ref.gameId}`)?.igdbId ===
                undefined &&
              state.gameMetadata.get(`community:${ref.gameId}`)?.igdbId ===
                undefined &&
              !canonicalMetadataCheckedIds.has(ref.gameId)
            );
          }
          const metadata = state.gameMetadata.get(
            gameMetadataKey({ id: ref.gameId, source: ref.source }),
          );
          return (
            metadataConflictsWithLocalCache(
              ref.gameId,
              ref.source,
              metadata,
              state.exeCache,
            ) ||
            (metadata?.igdbId === undefined &&
              !canonicalMetadataCheckedIds.has(ref.gameId))
          );
        })
        .map((ref) => ref.gameId),
    ),
  ];
  if (missingIds.length === 0) {
    collapseDuplicateActiveSessions();
    return true;
  }

  missingIds.sort((left, right) => left - right);
  const requestKey = missingIds.join(",");
  const existingRequest = metadataHydrationRequests.get(requestKey);
  if (existingRequest) return existingRequest;

  const request = (async () => {
    try {
      const response = await fetchWithTimeout(
        `${state.settings.apiEndpoint}/api/games/metadata?ids=${missingIds.join(",")}`,
        { timeoutMs: API_REQUEST_TIMEOUT_MS },
      );
      if (!response.ok)
        throw new Error(`${response.status} ${response.statusText}`);

      const body = (await response.json()) as GameMetadataResponse;
      const games = body.games.filter(
        (game): game is GameMetadata =>
          game.source === "igdb" || game.source === "community",
      );
      for (const id of missingIds) canonicalMetadataCheckedIds.add(id);
      const checkedRefs = refs.filter((ref) => missingIds.includes(ref.gameId));
      stampCanonicalIdsFromMetadata(games, checkedRefs);
      collapseDuplicateActiveSessions();
      logRuntime(`game metadata hydrated count=${body.games.length}`);
      persist();
      return true;
    } catch (error) {
      logRuntime(`game metadata hydration failed: ${formatError(error)}`);
      return false;
    }
  })();
  metadataHydrationRequests.set(requestKey, request);
  try {
    return await request;
  } finally {
    if (metadataHydrationRequests.get(requestKey) === request) {
      metadataHydrationRequests.delete(requestKey);
    }
  }
}

function metadataConflictsWithLocalCache(
  gameId: number,
  source: Game["source"] | undefined,
  metadata: GameMetadata | undefined,
  exeCache: ReadonlyMap<string, ExeCacheEntry>,
) {
  if (!metadata || !source) return false;
  return [...exeCache.values()].some((entry) => {
    if (entry.state !== "matched") return false;
    const referencesMetadata =
      entry.source === source && entry.gameId === gameId
        ? true
        : source === "community" &&
          entry.source === "custom" &&
          entry.communitySuggestionId === gameId;
    return (
      referencesMetadata &&
      gameMetadataConflictsWithRef(metadata, {
        gameName: entry.gameName,
        coverUrl: entry.coverUrl,
      })
    );
  });
}

function stampCanonicalIdsFromMetadata(
  games: GameMetadata[],
  authoritativeRefs: Array<{
    gameId: number;
    source?: Game["source"];
  }> = [],
) {
  useAppStore.setState((state) => {
    const gameMetadata = new Map(state.gameMetadata);
    let changed = false;
    for (const ref of authoritativeRefs) {
      if (ref.source !== "igdb" && ref.source !== "community") continue;
      const key = gameMetadataKey({ id: ref.gameId, source: ref.source });
      const returned = games.some(
        (game) => game.id === ref.gameId && game.source === ref.source,
      );
      if (!returned && gameMetadata.delete(key)) changed = true;
    }
    for (const game of games) {
      const key = gameMetadataKey(game);
      const existing = gameMetadata.get(key);
      if (
        existing?.id === game.id &&
        existing.source === game.source &&
        existing.name === game.name &&
        existing.coverUrl === game.coverUrl &&
        existing.igdbId === game.igdbId
      ) {
        continue;
      }
      gameMetadata.set(key, game);
      changed = true;
    }

    const exeCache = new Map(state.exeCache);
    for (const [key, entry] of exeCache) {
      if (entry.state !== "matched") continue;
      const metadata =
        entry.source === "custom" && entry.communitySuggestionId !== undefined
          ? gameMetadata.get(`community:${entry.communitySuggestionId}`)
          : entry.gameId !== undefined &&
              (entry.source === "igdb" || entry.source === "community")
            ? gameMetadata.get(
                gameMetadataKey({ id: entry.gameId, source: entry.source }),
              )
            : undefined;
      if (
        metadata &&
        gameMetadataConflictsWithRef(metadata, {
          gameName: entry.gameName,
          coverUrl: entry.coverUrl,
        })
      ) {
        if (entry.igdbId !== undefined) {
          const { igdbId: _staleIgdbId, ...repaired } = entry;
          exeCache.set(key, repaired);
          changed = true;
        }
      } else if (entry.igdbId === undefined && metadata?.igdbId !== undefined) {
        exeCache.set(key, { ...entry, igdbId: metadata.igdbId });
        changed = true;
      }
    }

    const resolveIgdbId = createGameIdentityResolver(gameMetadata, exeCache);
    let activeSessionsChanged = false;
    const repairedActiveSessions = state.activeSessions.map((session) => {
      const resolvedIgdbId = resolveIgdbId(
        session.gameId,
        session.source,
        session.gameName,
      );
      const igdbId =
        resolvedIgdbId === null
          ? undefined
          : (session.igdbId ?? resolvedIgdbId ?? undefined);
      if (igdbId === session.igdbId) return session;
      changed = true;
      activeSessionsChanged = true;
      return { ...session, igdbId };
    });
    const activeSessions = activeSessionsChanged
      ? repairedActiveSessions
      : state.activeSessions;
    let recentSessionsChanged = false;
    const repairedRecentSessions = state.recentSessions.map((session) => {
      if (session.igdbId === undefined) return session;
      const resolvedIgdbId = resolveIgdbId(
        session.gameId,
        session.source,
        session.gameName,
      );
      if (resolvedIgdbId !== null) return session;
      changed = true;
      recentSessionsChanged = true;
      const { igdbId: _staleIgdbId, ...repaired } = session;
      return repaired;
    });
    const recentSessions = recentSessionsChanged
      ? repairedRecentSessions
      : state.recentSessions;
    if (!changed) return state;
    return { gameMetadata, exeCache, activeSessions, recentSessions };
  });
}

async function backfillCanonicalGameIds() {
  if (canonicalBackfillDone) return true;
  if (canonicalBackfillInFlight) return canonicalBackfillInFlight;
  canonicalBackfillInFlight = hydrateGameMetadata([]).then((succeeded) => {
    if (succeeded) canonicalBackfillDone = true;
    return succeeded;
  });
  try {
    return await canonicalBackfillInFlight;
  } finally {
    canonicalBackfillInFlight = undefined;
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
  return readPersistedRecord(() =>
    logRuntime("persisted state parse failed; using empty state"),
  ) as PersistedState;
}

function normalizePersistedActiveSessions(persisted: PersistedState) {
  const sessions = persisted.activeSessions ?? [];
  if (persisted.activeSession) sessions.push(persisted.activeSession);

  // Earlier versions kept one session per executable, so a game with several
  // executables was counted twice.
  return dedupeSessionsByGame(
    sessions.map((session) => ({
      ...inferSuggestionStatus(session),
      checkpointedAt: session.checkpointedAt ?? session.startedAt,
      recoveredFromCheckpoint: true,
    })),
  );
}

function inferSuggestionStatus<
  T extends {
    communitySuggestionId?: number;
    communitySuggestionVerified?: boolean;
    communitySuggestionStatus?: ContributionStatus;
  },
>(value: T): T {
  if (
    value.communitySuggestionId === undefined ||
    value.communitySuggestionStatus !== undefined
  ) {
    return value;
  }
  return {
    ...value,
    communitySuggestionStatus: value.communitySuggestionVerified
      ? "verified"
      : "pending",
  };
}

// One game, one session - regardless of how many of its executables run. Of
// several sessions on the same game the earliest wins; the others cover the
// same playtime and would double-count it.
function dedupeSessionsByGame(sessions: ActiveSession[]) {
  const byGame = new Map<string, ActiveSession>();
  for (const session of sessions) {
    const key = sessionIdentityKey(session);
    const existing = byGame.get(key);
    if (
      existing &&
      Date.parse(existing.startedAt) <= Date.parse(session.startedAt)
    ) {
      continue;
    }
    byGame.set(key, session);
  }
  return [...byGame.values()];
}

// Two executables of one game can each end up with a session, e.g. when a
// community suggestion for the second exe gets approved and both exes start
// pointing at the same game.
function collapseDuplicateActiveSessions() {
  const sessions = useAppStore.getState().activeSessions;
  const deduped = dedupeSessionsByGame(sessions);
  if (deduped.length === sessions.length) return sessions;

  useAppStore.setState({ activeSessions: deduped });
  logRuntime(
    `merged ${sessions.length - deduped.length} duplicate active session(s) into one per game`,
  );
  return deduped;
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

function isCustomSession(session: Pick<ActiveSession, "source" | "gameId">) {
  return session.source === "custom" || session.gameId < 0;
}

// A session belongs to a game, not to an executable: a game started through
// several executables is one session, and its `exeName` is only the executable
// that opened it.
function activeSessionKey(
  gameId: number,
  source: ActiveSession["source"],
  igdbId?: number,
) {
  return canonicalGameKey({ gameId, source, igdbId });
}

function sessionIdentityKey(
  session: Pick<ActiveSession, "gameId" | "source" | "igdbId">,
) {
  return activeSessionKey(session.gameId, session.source, session.igdbId);
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

// Local id for an executable that was shared as a community suggestion: the id
// already used by another executable of the same suggestion, or a fresh one.
function sharedCustomGameId(exeName: string, communitySuggestionId: number) {
  const sibling = [...useAppStore.getState().exeCache.values()].find(
    (entry) =>
      entry.state === "matched" &&
      entry.source === "custom" &&
      entry.communitySuggestionId === communitySuggestionId &&
      entry.exeName.toLowerCase() !== exeName.toLowerCase() &&
      entry.gameId !== undefined,
  );
  return sibling?.gameId ?? customGameId(exeName);
}

function customGameId(exeName: string) {
  let hash = 0;
  for (const char of exeName.toLowerCase()) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return CUSTOM_GAME_ID_BASE - (hash % 900_000_000);
}

export function renameCustomGame(gameId: number, gameName: string) {
  const name = gameName.trim();
  if (!name) return;
  useAppStore.setState((state) => {
    const exeCache = new Map(state.exeCache);
    const emulatorMappings = new Map(state.emulatorMappings);

    for (const [key, entry] of exeCache) {
      if (
        entry.state === "matched" &&
        entry.source === "custom" &&
        entry.gameId === gameId
      ) {
        exeCache.set(key, { ...entry, gameName: name });
      }
    }

    for (const [key, mapping] of emulatorMappings) {
      if (
        mapping.decision === "game" &&
        mapping.source === "custom" &&
        mapping.gameId === gameId
      ) {
        emulatorMappings.set(key, { ...mapping, gameName: name });
      }
    }

    return {
      exeCache,
      emulatorMappings,
      activeSessions: state.activeSessions.map((session) =>
        session.gameId === gameId && isCustomSession(session)
          ? { ...session, gameName: name }
          : session,
      ),
      recentSessions: state.recentSessions.map((session) =>
        session.gameId === gameId && isCustomSession(session)
          ? { ...session, gameName: name }
          : session,
      ),
    };
  });
  logRuntime(`custom game renamed gameId=${gameId} -> ${name}`);
  persist();
}

function updateCustomGameCover(gameId: number, coverUrl: string) {
  useAppStore.setState((state) => {
    const exeCache = new Map(state.exeCache);
    const emulatorMappings = new Map(state.emulatorMappings);

    for (const [key, entry] of exeCache) {
      if (
        entry.state === "matched" &&
        entry.source === "custom" &&
        entry.gameId === gameId
      ) {
        exeCache.set(key, { ...entry, coverUrl });
      }
    }

    for (const [key, mapping] of emulatorMappings) {
      if (
        mapping.decision === "game" &&
        mapping.source === "custom" &&
        mapping.gameId === gameId
      ) {
        emulatorMappings.set(key, { ...mapping, coverUrl });
      }
    }

    return {
      exeCache,
      emulatorMappings,
      activeSessions: state.activeSessions.map((session) =>
        session.gameId === gameId && isCustomSession(session)
          ? { ...session, coverUrl }
          : session,
      ),
      // Recorded sessions drive the library card's cover, so they must
      // follow too - otherwise a cleared/changed cover keeps showing.
      recentSessions: state.recentSessions.map((session) =>
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
      processes.map((process) => [
        process.emulatorId
          ? `${process.exeName.toLowerCase()}#${process.pid ?? 0}`
          : process.exeName.toLowerCase(),
        process,
      ]),
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
