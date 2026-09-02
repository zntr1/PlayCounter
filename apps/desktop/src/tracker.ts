import type {
  CommunityGameAlias,
  CommunityGameSuggestionResponse,
  CommunitySuggestionCancelPayload,
  CommunitySuggestionCancelResponse,
  Contribution,
  ContributionCounts,
  ContributionStatus,
  ContributionsResponse,
  EmulatorLaunchContext,
  EmulatorContentSuggestionResponse,
  EmulatorResolveResponse,
  Game,
  GameSource,
  GameMetadataResponse,
  IdentifierFlagReason,
  IdentifierReportPayload,
  IdentifierReportResponse,
  IgnoredProcessReportPayload,
  IgnoredProcessReportResponse,
  IgnoredProcessReportStatus,
  InstallPresencePayload,
  MatchProcessesResponse,
  Platform,
  ProcessIdentifier,
  Session,
  Settings,
} from "@playcounter/shared";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  useAppStore,
  BUILD_STAGE,
  DEFAULT_API_ENDPOINT,
  canonicalGameKey,
  canCancelCommunitySuggestion,
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
  type LaunchTarget,
  type LaunchTargetOwner,
  type ProcessSnapshot,
} from "./store";
import {
  isVolatileLaunchPath,
  isWindowsExecutablePath,
  launchErrorKind,
  launchFileBaseName,
  manualLaunchTargetKey,
  shouldForgetLaunchTarget,
  shouldForgetOnLaunchError,
  type LaunchOutcome,
  type LaunchPathReport,
} from "./gameLaunch";
import {
  emulatorTargetCompatibility,
  isValidEmulatorBinaryPath,
  isValidEmulatorContentPath,
  resolveEmulatorBinary,
  resolveEmulatorLaunchTarget,
  shouldForgetEmulatorOnLaunchError,
  shouldForgetEmulatorPath,
  type EmulatorBinaryEntry,
  type EmulatorLaunchCandidate,
  type EmulatorLaunchOutcome,
  type EmulatorLaunchTarget,
} from "./emulatorLaunch";
import { countNeedsReview } from "./discoveredReview";
import {
  DISCOVERED_REVIEW_REMINDER_ID,
  DISCOVERED_REVIEW_REMINDER_THRESHOLD,
  discoveredReviewReminderText,
  evaluateDiscoveredReviewReminder,
  sanitizeDiscoveredReviewReminder,
} from "./discoveredReminder";
import { matchesProcessPatternSet } from "./ignoredProcessPatterns";
import {
  reportInstallPresence,
  sanitizeInstallPresenceMarker,
} from "./installPresence";
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
import { resolveMyGamesPresentationSettings } from "./ui/myGamesPresentation";
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
import {
  armControllerBridge,
  disposeControllerBridge,
  initializeControllerBridge,
} from "./controllerBridge";
import { adapterFor } from "./emulators/registry";
import {
  accumulateObservationRuntime,
  creditableSeconds,
  reconcileEmulatorReadings,
} from "./emulators/resolve";
import {
  contentKey,
  GENERIC_IDENTITY_DENYLIST,
  isShareableToken,
} from "./emulators/signals";
import {
  isShareableEmulatorMapping,
  type EmulatorShareContext,
} from "./emulators/share";
import { toPublicSnapshots } from "./emulators/publicProjection";
import { customLocalGameId } from "./library/localGameIds";
import type {
  LibraryImportEntry,
  LibraryInstallEntry,
  ScopedExeLink,
} from "./library/types";
import { libraryEntryKey } from "./library/types";
import { providerFloors } from "./library/playtimeFloor";
import {
  normalizeWindowsDir,
  resolveScopedLink,
  scopedExeLinkKey,
} from "./library/scopedLinks";
import {
  findLocalLink,
  findLocalLinksByExe,
  listLocalLinks,
  writeLocalLink,
  type LocalLink,
  type LocalLinkRef,
} from "./localLinks";
import type {
  EmulatorContentObservation,
  EmulatorContentSignal,
  EmulatorMapping,
  EmulatorMappingShare,
  EmulatorObservation,
  EmulatorRuntimeState,
  KnownEmulator,
  RawEmulatorSignals,
} from "./emulators/types";

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
  installPresenceMarker?: unknown;
  contributionOwnerUuid?: string;
  settings?: Partial<Settings>;
  exeCache?: ExeCacheEntry[];
  launchTargets?: LaunchTarget[];
  manualLaunchTargets?: LaunchTarget[];
  emulatorAutoBinaries?: EmulatorBinaryEntry[];
  emulatorManualBinaries?: EmulatorBinaryEntry[];
  emulatorAutoLaunchTargets?: EmulatorLaunchTarget[];
  emulatorManualLaunchTargets?: EmulatorLaunchTarget[];
  emulatorLaunchCandidates?: EmulatorLaunchCandidate[];
  gameMetadata?: GameMetadata[];
  libraryImports?: LibraryImportEntry[];
  libraryInstalls?: LibraryInstallEntry[];
  scopedExeLinks?: ScopedExeLink[];
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
let installPresencePingInFlight: Promise<void> | undefined;
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
let communityCancelUnavailableUntil = 0;
const communitySuggestionCancelGuard = new Map<
  string,
  { ref: LocalLinkRef; exeName: string; gameId: number }
>();
let lastEmulatorRunningKeys = new Set<string>();
const launchInFlight = new Map<string, number>();
const emulatorLaunchInFlight = new Map<string, number>();
let launchVerificationInFlight: Promise<number> | undefined;
let lastLaunchVerificationAt = 0;
const LAUNCH_REENTRY_GUARD_MS = 3_000;
const LAUNCH_VERIFICATION_THROTTLE_MS = 5 * 60 * 1_000;

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
  initializeControllerBridge();
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
    launchInFlight.clear();
    emulatorLaunchInFlight.clear();
    launchVerificationInFlight = undefined;
    installPresencePingInFlight = undefined;
    lastLaunchVerificationAt = 0;
    disposeDesktopOverlays();
    disposeControllerBridge();
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
      await verifyLaunchTargets("startup");
      if (suppressStartupNotifications) {
        baselineDiscoveredReviewReminder();
        useAppStore.setState({ suppressStartupNotificationsOnce: false });
        persist();
        logRuntime("post-import notification baseline completed");
      }
      armDesktopOverlays();
      armControllerBridge();
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

const positiveInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value > 0;

const validExternalId = (value: unknown): value is string =>
  typeof value === "string" && /^[1-9][0-9]{0,9}$/.test(value);

export function normalizePersistedLibraryImport(
  value: unknown,
): LibraryImportEntry | null {
  if (!value || typeof value !== "object") return null;
  const entry = value as Partial<LibraryImportEntry>;
  if (
    (entry.provider !== "steam" && entry.provider !== "xbox") ||
    !validExternalId(entry.externalId) ||
    !positiveInteger(entry.igdbId) ||
    !positiveInteger(entry.gameId) ||
    (entry.source !== "igdb" && entry.source !== "community") ||
    typeof entry.name !== "string" ||
    typeof entry.coverUrl !== "string" ||
    typeof entry.importedAt !== "string" ||
    typeof entry.lastReadAt !== "string" ||
    (entry.providerSeconds !== null &&
      (typeof entry.providerSeconds !== "number" ||
        !Number.isFinite(entry.providerSeconds) ||
        entry.providerSeconds < 0)) ||
    !Array.isArray(entry.linkedExeNames) ||
    (entry.linkedExeSources !== undefined &&
      !Array.isArray(entry.linkedExeSources))
  ) {
    return null;
  }
  const linkedExeNames = entry.linkedExeNames
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.toLowerCase());
  const linkedExeSources = Array.isArray(entry.linkedExeSources)
    ? entry.linkedExeSources.filter(
        (item): item is GameSource =>
          item === "igdb" || item === "community" || item === "custom",
      )
    : [];
  if (linkedExeNames.length > 0 && linkedExeSources.length === 0) {
    linkedExeSources.push(entry.source);
  }
  return {
    ...entry,
    providerSeconds:
      entry.providerSeconds === null
        ? null
        : Math.round(entry.providerSeconds as number),
    linkedExeNames,
    linkedExeSources: [...new Set(linkedExeSources)],
  } as LibraryImportEntry;
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
  const loadedSettings = applyBuildApiEndpoint({
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
    ...resolveMyGamesPresentationSettings(persisted.settings),
  });
  const settings: Settings =
    loadedSettings.rememberLaunchPaths === false
      ? {
          ...loadedSettings,
          rememberLaunchPaths: false,
          gameLaunchingEnabled: false,
          controllerNavigationEnabled: false,
        }
      : loadedSettings.gameLaunchingEnabled === true
        ? loadedSettings
        : { ...loadedSettings, controllerNavigationEnabled: false };
  const rememberLaunchPaths = settings.rememberLaunchPaths !== false;
  const shouldPersistLaunchPathOptOut =
    !rememberLaunchPaths &&
    [
      persisted.launchTargets,
      persisted.manualLaunchTargets,
      persisted.emulatorAutoBinaries,
      persisted.emulatorManualBinaries,
      persisted.emulatorAutoLaunchTargets,
      persisted.emulatorManualLaunchTargets,
      persisted.emulatorLaunchCandidates,
    ].some((values) => Array.isArray(values) && values.length > 0);
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
  function persistedLaunchTarget(value: unknown): LaunchTarget | null {
    if (!value || typeof value !== "object") return null;
    const target = value as Partial<LaunchTarget>;
    const owner = target.owner as Partial<LaunchTargetOwner> | undefined;
    const source = owner?.source;
    if (
      typeof target.exeName !== "string" ||
      !target.exeName.trim() ||
      !isWindowsExecutablePath(target.path) ||
      typeof owner?.gameId !== "number" ||
      !Number.isFinite(owner.gameId) ||
      (source !== undefined &&
        source !== null &&
        source !== "igdb" &&
        source !== "community" &&
        source !== "custom")
    ) {
      return null;
    }
    return {
      exeName: target.exeName,
      path: target.path,
      owner: { gameId: owner.gameId, source: source ?? null },
    };
  }
  const launchTargets = new Map<string, LaunchTarget>();
  if (rememberLaunchPaths) {
    for (const value of persisted.launchTargets ?? []) {
      const target = persistedLaunchTarget(value);
      if (target) launchTargets.set(target.exeName.toLowerCase(), target);
    }
  }
  const manualLaunchTargets = new Map<string, LaunchTarget>();
  if (rememberLaunchPaths) {
    for (const value of persisted.manualLaunchTargets ?? []) {
      const target = persistedLaunchTarget(value);
      if (target) {
        manualLaunchTargets.set(manualLaunchTargetKey(target.owner), target);
      }
    }
  }
  function persistedEmulatorBinary(value: unknown): EmulatorBinaryEntry | null {
    if (!value || typeof value !== "object") return null;
    const entry = value as Partial<EmulatorBinaryEntry>;
    if (
      typeof entry.emulatorId !== "string" ||
      !adapterFor(entry.emulatorId)?.launch ||
      !isValidEmulatorBinaryPath(entry.emulatorId, entry.exePath) ||
      typeof entry.setAt !== "string"
    ) {
      return null;
    }
    return {
      emulatorId: entry.emulatorId,
      exePath: entry.exePath,
      setAt: entry.setAt,
    };
  }
  function persistedEmulatorTarget(
    value: unknown,
  ): EmulatorLaunchTarget | null {
    if (!value || typeof value !== "object") return null;
    const target = value as Partial<EmulatorLaunchTarget>;
    if (
      typeof target.contentKey !== "string" ||
      !target.contentKey.startsWith(`${target.emulatorId}:`) ||
      typeof target.emulatorId !== "string" ||
      !isValidEmulatorContentPath(target.emulatorId, target.filePath) ||
      typeof target.setAt !== "string"
    ) {
      return null;
    }
    return {
      contentKey: target.contentKey,
      emulatorId: target.emulatorId,
      filePath: target.filePath,
      setAt: target.setAt,
    };
  }
  const hydrateMap = <T>(
    values: unknown[] | undefined,
    parse: (value: unknown) => T | null,
    key: (value: T) => string,
  ) => {
    const result = new Map<string, T>();
    for (const value of values ?? []) {
      const parsed = parse(value);
      if (parsed) result.set(key(parsed), parsed);
    }
    return result;
  };
  const emulatorAutoBinaries = hydrateMap(
    rememberLaunchPaths ? persisted.emulatorAutoBinaries : undefined,
    persistedEmulatorBinary,
    (entry) => entry.emulatorId,
  );
  const emulatorManualBinaries = hydrateMap(
    rememberLaunchPaths ? persisted.emulatorManualBinaries : undefined,
    persistedEmulatorBinary,
    (entry) => entry.emulatorId,
  );
  const emulatorAutoLaunchTargets = hydrateMap(
    rememberLaunchPaths ? persisted.emulatorAutoLaunchTargets : undefined,
    persistedEmulatorTarget,
    (target) => target.contentKey,
  );
  const emulatorManualLaunchTargets = hydrateMap(
    rememberLaunchPaths ? persisted.emulatorManualLaunchTargets : undefined,
    persistedEmulatorTarget,
    (target) => target.contentKey,
  );
  const emulatorLaunchCandidates = hydrateMap(
    rememberLaunchPaths ? persisted.emulatorLaunchCandidates : undefined,
    (value) => {
      const target = persistedEmulatorTarget(value);
      if (!target || !value || typeof value !== "object") return null;
      const displayName = (value as Partial<EmulatorLaunchCandidate>)
        .displayName;
      if (
        typeof displayName !== "string" ||
        !displayName.trim() ||
        displayName !== launchFileBaseName(target.filePath)
      ) {
        return null;
      }
      return { ...target, displayName };
    },
    (candidate) => candidate.contentKey,
  );
  const persistedLibraryInstall = (
    value: unknown,
  ): LibraryInstallEntry | null => {
    if (!value || typeof value !== "object") return null;
    const entry = value as Partial<LibraryInstallEntry>;
    if (
      entry.provider !== "steam" ||
      !validExternalId(entry.externalId) ||
      typeof entry.installPath !== "string" ||
      !normalizeWindowsDir(entry.installPath) ||
      typeof entry.scannedAt !== "string"
    ) {
      return null;
    }
    return entry as LibraryInstallEntry;
  };
  const persistedScopedExeLink = (value: unknown): ScopedExeLink | null => {
    if (!value || typeof value !== "object") return null;
    const entry = value as Partial<ScopedExeLink>;
    if (
      entry.provider !== "steam" ||
      !validExternalId(entry.externalId) ||
      !positiveInteger(entry.igdbId) ||
      typeof entry.gameId !== "number" ||
      !Number.isFinite(entry.gameId) ||
      !entry.exeName ||
      typeof entry.pathPrefix !== "string" ||
      !normalizeWindowsDir(entry.pathPrefix) ||
      (entry.source !== "igdb" &&
        entry.source !== "community" &&
        entry.source !== "custom") ||
      typeof entry.gameName !== "string" ||
      typeof entry.coverUrl !== "string" ||
      typeof entry.setAt !== "string"
    ) {
      return null;
    }
    return entry as ScopedExeLink;
  };
  const libraryImports = hydrateMap(
    persisted.libraryImports,
    normalizePersistedLibraryImport,
    (entry) => libraryEntryKey(entry.provider, entry.externalId),
  );
  const libraryInstalls = hydrateMap(
    persisted.libraryInstalls,
    persistedLibraryInstall,
    (entry) => libraryEntryKey(entry.provider, entry.externalId),
  );
  const scopedExeLinks = hydrateMap(
    persisted.scopedExeLinks,
    persistedScopedExeLink,
    (entry) => scopedExeLinkKey(entry.exeName, entry.pathPrefix)!,
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
    const resolver = createGameIdentityResolver(
      gameMetadataMap,
      exeCacheMap,
      libraryImports,
    );
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
  for (const [key, candidate] of [...emulatorLaunchCandidates]) {
    const mapping = emulatorMappings.get(key);
    if (!mapping || mapping.decision !== "game") continue;
    const compatibility = emulatorTargetCompatibility(
      mapping,
      candidate.filePath,
    );
    if (!compatibility.valid || compatibility.association !== "proven") {
      continue;
    }
    if (
      !emulatorAutoLaunchTargets.has(key) &&
      !emulatorManualLaunchTargets.has(key)
    ) {
      emulatorAutoLaunchTargets.set(key, {
        contentKey: candidate.contentKey,
        emulatorId: candidate.emulatorId,
        filePath: candidate.filePath,
        setAt: candidate.setAt,
      });
    }
    emulatorLaunchCandidates.delete(key);
    shouldPersistAchievementMigration = true;
  }
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
    installPresenceMarker: sanitizeInstallPresenceMarker(
      persisted.installPresenceMarker,
    ),
    contributionOwnerUuid: persisted.contributionOwnerUuid ?? null,
    settings,
    // Open running windows were removed while constructing exeCacheMap above;
    // runtime while the app was closed must never be credited.
    exeCache: exeCacheMap,
    launchTargets,
    manualLaunchTargets,
    emulatorAutoBinaries,
    emulatorManualBinaries,
    emulatorAutoLaunchTargets,
    emulatorManualLaunchTargets,
    emulatorLaunchCandidates,
    gameMetadata: gameMetadataMap,
    libraryImports,
    libraryInstalls,
    scopedExeLinks,
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
  if (shouldPersistAchievementMigration || shouldPersistLaunchPathOptOut) {
    persist();
  }
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

function recordLaunchTargets(matches: ProcessMatch[]) {
  if (useAppStore.getState().settings.rememberLaunchPaths === false) return;
  for (const { process, game } of matches) {
    if (
      !process.exeName ||
      !isWindowsExecutablePath(process.exePath) ||
      isVolatileLaunchPath(process.exePath)
    ) {
      continue;
    }
    const owner: LaunchTargetOwner = {
      gameId: game.id,
      source: game.source ?? null,
    };
    const state = useAppStore.getState();
    const existing = state.launchTargets.get(process.exeName.toLowerCase());
    if (
      existing?.path === process.exePath &&
      existing.owner.gameId === owner.gameId &&
      existing.owner.source === owner.source
    ) {
      continue;
    }
    state.setLaunchTarget({
      exeName: process.exeName,
      path: process.exePath,
      owner,
    });
  }
}

export async function launchGame(
  target: Pick<LaunchTarget, "exeName" | "path" | "owner">,
): Promise<LaunchOutcome> {
  if (useAppStore.getState().settings.gameLaunchingEnabled !== true) {
    throw new Error("Enable 'Launch games directly' in Settings first.");
  }
  const key = target.path.toLowerCase();
  const now = Date.now();
  const guardedUntil = launchInFlight.get(key);
  if (guardedUntil !== undefined && guardedUntil > now) return "busy";
  launchInFlight.set(key, Number.POSITIVE_INFINITY);
  logRuntime(`game launch requested ${target.exeName}`);
  try {
    await invoke("launch_executable", { path: target.path });
    logRuntime(`game launch started ${target.exeName}`);
    launchInFlight.set(key, Date.now() + LAUNCH_REENTRY_GUARD_MS);
    return "launched";
  } catch (error) {
    launchInFlight.delete(key);
    if (shouldForgetOnLaunchError(launchErrorKind(error))) {
      const state = useAppStore.getState();
      const exeKey = target.exeName.toLowerCase();
      const manual = state.manualLaunchTargets.get(
        manualLaunchTargetKey(target.owner),
      );
      if (
        manual?.path === target.path &&
        manual.exeName.toLowerCase() === exeKey
      ) {
        state.removeManualLaunchTarget(target.owner);
        persist();
      } else {
        const current = state.launchTargets.get(exeKey);
        if (current?.path === target.path) {
          state.removeLaunchTarget(target.exeName);
          persist();
        }
      }
    }
    logRuntime(`game launch failed ${target.exeName}: ${formatError(error)}`);
    throw error;
  }
}

export async function revealGameExecutable(
  target: Pick<LaunchTarget, "exeName" | "path">,
) {
  logRuntime(`game file reveal requested ${target.exeName}`);
  await invoke("reveal_executable", { path: target.path });
}

export async function verifyLaunchTargets(reason: string): Promise<number> {
  if (useAppStore.getState().settings.rememberLaunchPaths === false) return 0;
  try {
    if (currentPlatform() !== "windows") return 0;
  } catch {
    return 0;
  }
  if (launchVerificationInFlight) return launchVerificationInFlight;
  const state = useAppStore.getState();
  const normalTargets = [
    ...state.launchTargets.values(),
    ...state.manualLaunchTargets.values(),
  ];
  const binaryTargets = [
    ...state.emulatorAutoBinaries.values(),
    ...state.emulatorManualBinaries.values(),
  ];
  const contentTargets = [
    ...state.emulatorAutoLaunchTargets.values(),
    ...state.emulatorManualLaunchTargets.values(),
    ...state.emulatorLaunchCandidates.values(),
  ];
  if (
    normalTargets.length === 0 &&
    binaryTargets.length === 0 &&
    contentTargets.length === 0
  ) {
    return 0;
  }

  launchVerificationInFlight = (async () => {
    const executablePaths = [
      ...normalTargets.map((target) => target.path),
      ...binaryTargets.map((target) => target.exePath),
    ];
    const executableReports = executablePaths.length
      ? await invoke<LaunchPathReport[]>("verify_launch_paths", {
          paths: [...new Set(executablePaths)],
        })
      : [];
    const contentReports = contentTargets.length
      ? await invoke<LaunchPathReport[]>("verify_emulator_content_paths", {
          targets: [
            ...new Map(
              contentTargets.map((target) => [
                `${target.emulatorId}:${target.filePath.toLowerCase()}`,
                { emulatorId: target.emulatorId, path: target.filePath },
              ]),
            ).values(),
          ],
        })
      : [];
    const staleExecutablePaths = new Set(
      executableReports
        .filter((report) => shouldForgetLaunchTarget(report.status))
        .map((report) => report.path.toLowerCase()),
    );
    const staleContentPaths = new Set(
      contentReports
        .filter((report) => shouldForgetEmulatorPath(report.status))
        .map((report) => report.path.toLowerCase()),
    );
    let pruned = 0;
    for (const target of [...useAppStore.getState().launchTargets.values()]) {
      if (!staleExecutablePaths.has(target.path.toLowerCase())) continue;
      useAppStore.getState().removeLaunchTarget(target.exeName);
      pruned += 1;
    }
    for (const target of [
      ...useAppStore.getState().manualLaunchTargets.values(),
    ]) {
      if (!staleExecutablePaths.has(target.path.toLowerCase())) continue;
      useAppStore.getState().removeManualLaunchTarget(target.owner);
      pruned += 1;
    }
    for (const target of [
      ...useAppStore.getState().emulatorAutoBinaries.values(),
    ]) {
      if (!staleExecutablePaths.has(target.exePath.toLowerCase())) continue;
      useAppStore.getState().removeEmulatorAutoBinary(target.emulatorId);
      pruned += 1;
    }
    for (const target of [
      ...useAppStore.getState().emulatorManualBinaries.values(),
    ]) {
      if (!staleExecutablePaths.has(target.exePath.toLowerCase())) continue;
      useAppStore.getState().removeEmulatorManualBinary(target.emulatorId);
      pruned += 1;
    }
    for (const target of [
      ...useAppStore.getState().emulatorAutoLaunchTargets.values(),
    ]) {
      if (!staleContentPaths.has(target.filePath.toLowerCase())) continue;
      useAppStore.getState().removeEmulatorAutoLaunchTarget(target.contentKey);
      pruned += 1;
    }
    for (const target of [
      ...useAppStore.getState().emulatorManualLaunchTargets.values(),
    ]) {
      if (!staleContentPaths.has(target.filePath.toLowerCase())) continue;
      useAppStore
        .getState()
        .removeEmulatorManualLaunchTarget(target.contentKey);
      pruned += 1;
    }
    const currentCandidates = [
      ...useAppStore.getState().emulatorLaunchCandidates.values(),
    ];
    const validCandidates = currentCandidates.filter(
      (candidate) => !staleContentPaths.has(candidate.filePath.toLowerCase()),
    );
    if (validCandidates.length !== currentCandidates.length) {
      useAppStore.getState().setEmulatorLaunchCandidates(validCandidates);
      pruned += currentCandidates.length - validCandidates.length;
    }
    if (pruned > 0) persist();
    lastLaunchVerificationAt = Date.now();
    logRuntime(
      `launch targets verified reason=${reason} checked=${normalTargets.length + binaryTargets.length + contentTargets.length} pruned=${pruned}`,
    );
    return pruned;
  })();
  try {
    return await launchVerificationInFlight;
  } catch (error) {
    logRuntime(`launch target verification failed: ${formatError(error)}`);
    return 0;
  } finally {
    launchVerificationInFlight = undefined;
  }
}

export function verifyLaunchTargetsThrottled(reason = "my-games") {
  if (
    Date.now() - lastLaunchVerificationAt < LAUNCH_VERIFICATION_THROTTLE_MS ||
    launchVerificationInFlight
  ) {
    return launchVerificationInFlight ?? Promise.resolve(0);
  }
  return verifyLaunchTargets(reason);
}

export function forgetLaunchTarget(exeName: string) {
  useAppStore.getState().removeLaunchTarget(exeName);
  logRuntime(`launch target forgotten ${exeName}`);
  persist();
}

export function forgetManualLaunchTarget(owner: LaunchTargetOwner) {
  useAppStore.getState().removeManualLaunchTarget(owner);
  logRuntime(
    `manual launch target forgotten gameId=${owner.gameId} source=${owner.source ?? "unknown"}`,
  );
  persist();
}

export async function chooseLaunchTarget(
  exeNames: string[],
  owner: LaunchTargetOwner,
  aliases: readonly LaunchTargetOwner[] = [owner],
): Promise<LaunchTarget | null> {
  const selected = await open({
    multiple: false,
    directory: false,
    filters: [{ name: "Program", extensions: ["exe"] }],
  });
  if (typeof selected !== "string") return null;
  if (!isWindowsExecutablePath(selected)) {
    throw new Error("Pick an .exe file with a full Windows path.");
  }
  const baseName = launchFileBaseName(selected);
  const exeName =
    exeNames.find(
      (candidate) => candidate.toLowerCase() === baseName.toLowerCase(),
    ) ?? baseName;
  const target = { exeName, path: selected, owner };
  useAppStore.getState().setManualLaunchTarget(target, aliases);
  logRuntime(`launch target selected ${exeName}`);
  persist();
  if (isVolatileLaunchPath(selected)) {
    useAppStore.getState().addToast({
      tone: "info",
      title: "Temporary launch file",
      detail:
        "This file is in a temporary folder and may disappear. Choose an installed copy if one is available.",
    });
  }
  return target;
}

export async function chooseEmulatorBinary(
  emulatorId: string,
): Promise<EmulatorBinaryEntry | null> {
  const adapter = adapterFor(emulatorId);
  if (!adapter?.launch) throw new Error("This emulator is not launchable yet.");
  const selected = await open({
    multiple: false,
    directory: false,
    filters: [{ name: adapter.label, extensions: ["exe", "com"] }],
  });
  if (typeof selected !== "string") return null;
  if (!isValidEmulatorBinaryPath(emulatorId, selected)) {
    throw new Error(
      `Pick a supported ${adapter.label} program with a full Windows path.`,
    );
  }
  const entry = {
    emulatorId,
    exePath: selected,
    setAt: new Date().toISOString(),
  };
  useAppStore.getState().setEmulatorManualBinary(entry);
  logRuntime(`manual emulator binary selected emulator=${emulatorId}`);
  return entry;
}

export function forgetEmulatorManualBinary(emulatorId: string) {
  useAppStore.getState().removeEmulatorManualBinary(emulatorId);
  logRuntime(`manual emulator binary forgotten emulator=${emulatorId}`);
}

export async function chooseEmulatorLaunchFile(
  mapping: EmulatorMapping,
): Promise<EmulatorLaunchTarget | null> {
  const adapter = adapterFor(mapping.emulatorId);
  if (!adapter?.launch) throw new Error("This emulator is not launchable yet.");
  const selected = await open({
    multiple: false,
    directory: false,
    filters: [
      {
        name: `${adapter.label} content`,
        extensions: [...adapter.launch.fileExtensions],
      },
    ],
  });
  if (typeof selected !== "string") return null;
  if (!isValidEmulatorContentPath(mapping.emulatorId, selected)) {
    throw new Error(
      `Pick a supported ${adapter.label} game file with a full Windows path.`,
    );
  }
  const compatibility = emulatorTargetCompatibility(mapping, selected);
  if (!compatibility.valid) {
    throw new Error(
      compatibility.reason === "content-name-mismatch"
        ? `This file does not match the content PlayCounter recognized as ${mapping.display}.`
        : `This file is not supported by ${adapter.label}.`,
    );
  }
  const target = {
    contentKey: mapping.contentKey,
    emulatorId: mapping.emulatorId,
    filePath: selected,
    setAt: new Date().toISOString(),
  };
  useAppStore.getState().setEmulatorManualLaunchTarget(target);
  useAppStore
    .getState()
    .setEmulatorLaunchCandidates(
      [...useAppStore.getState().emulatorLaunchCandidates.values()].filter(
        (candidate) => candidate.contentKey !== mapping.contentKey,
      ),
    );
  logRuntime(
    `manual emulator launch target selected emulator=${mapping.emulatorId} contentKey=${mapping.contentKey}`,
  );
  return target;
}

export function confirmEmulatorLaunchCandidate(contentKeyValue: string) {
  const state = useAppStore.getState();
  const candidate = state.emulatorLaunchCandidates.get(contentKeyValue);
  const mapping = state.emulatorMappings.get(contentKeyValue);
  if (!candidate || !mapping || mapping.decision !== "game") return null;
  const compatibility = emulatorTargetCompatibility(
    mapping,
    candidate.filePath,
  );
  if (!compatibility.valid) return null;
  const target: EmulatorLaunchTarget = {
    contentKey: candidate.contentKey,
    emulatorId: candidate.emulatorId,
    filePath: candidate.filePath,
    setAt: new Date().toISOString(),
  };
  state.setEmulatorManualLaunchTarget(target);
  state.setEmulatorLaunchCandidates(
    [...state.emulatorLaunchCandidates.values()].filter(
      (item) => item.contentKey !== contentKeyValue,
    ),
  );
  logRuntime(
    `detected emulator launch target confirmed emulator=${mapping.emulatorId} contentKey=${mapping.contentKey}`,
  );
  return target;
}

export function forgetEmulatorLaunchTarget(contentKeyValue: string) {
  const state = useAppStore.getState();
  state.removeEmulatorManualLaunchTarget(contentKeyValue);
  state.removeEmulatorAutoLaunchTarget(contentKeyValue);
  state.setEmulatorLaunchCandidates(
    [...state.emulatorLaunchCandidates.values()].filter(
      (candidate) => candidate.contentKey !== contentKeyValue,
    ),
  );
  logRuntime(`emulator launch target forgotten contentKey=${contentKeyValue}`);
}

function isEmulatorLaunchGuarded(emulatorId: string) {
  const guardedUntil = emulatorLaunchInFlight.get(emulatorId);
  return guardedUntil !== undefined && guardedUntil > Date.now();
}

export function resetEmulatorLaunchGuardForTests() {
  emulatorLaunchInFlight.clear();
}

async function dispatchEmulatorLaunch(
  emulatorId: string,
  request: { emulatorId: string; exePath: string; contentPath: string },
  logContext?: string,
): Promise<EmulatorLaunchOutcome> {
  if (isEmulatorLaunchGuarded(emulatorId)) return { kind: "busy" };
  emulatorLaunchInFlight.set(emulatorId, Number.POSITIVE_INFINITY);
  const suffix = logContext ? ` ${logContext}` : "";
  logRuntime(`emulator launch requested emulator=${emulatorId}${suffix}`);
  try {
    const outcome = await invoke<EmulatorLaunchOutcome>(
      "launch_emulator_content",
      { request },
    );
    if (outcome.kind === "spawned") {
      emulatorLaunchInFlight.set(
        emulatorId,
        Date.now() + LAUNCH_REENTRY_GUARD_MS,
      );
      logRuntime(`emulator launch started emulator=${emulatorId}${suffix}`);
    } else {
      emulatorLaunchInFlight.delete(emulatorId);
      logRuntime(
        `emulator launch outcome=${outcome.kind} emulator=${emulatorId}${suffix}`,
      );
    }
    return outcome;
  } catch (error) {
    emulatorLaunchInFlight.delete(emulatorId);
    if (shouldForgetEmulatorOnLaunchError(error)) {
      void verifyLaunchTargets("emulator-launch-error");
    }
    logRuntime(
      `emulator launch failed emulator=${emulatorId}${suffix}: ${formatError(error)}`,
    );
    throw error;
  }
}

export async function launchEmulatorGame(
  mapping: EmulatorMapping,
): Promise<EmulatorLaunchOutcome> {
  const state = useAppStore.getState();
  if (state.settings.gameLaunchingEnabled !== true) {
    throw new Error("Enable 'Launch games directly' in Settings first.");
  }
  const binary = resolveEmulatorBinary(
    mapping.emulatorId,
    state.emulatorAutoBinaries,
    state.emulatorManualBinaries,
  );
  const target = resolveEmulatorLaunchTarget(
    mapping.contentKey,
    state.emulatorAutoLaunchTargets,
    state.emulatorManualLaunchTargets,
  );
  if (!binary)
    throw new Error(`Set the ${mapping.label} program in Settings first.`);
  if (!target) throw new Error("Set this emulator game's launch file first.");

  return dispatchEmulatorLaunch(
    mapping.emulatorId,
    {
      emulatorId: mapping.emulatorId,
      exePath: binary.exePath,
      contentPath: target.filePath,
    },
    `contentKey=${mapping.contentKey}`,
  );
}

export async function startEmulatorGame(
  emulatorId: string,
): Promise<EmulatorLaunchOutcome | null> {
  const state = useAppStore.getState();
  if (state.settings.gameLaunchingEnabled !== true) {
    throw new Error("Enable 'Launch games directly' in Settings first.");
  }
  const adapter = adapterFor(emulatorId);
  if (!adapter?.launch) throw new Error("This emulator is not launchable yet.");
  const binary = resolveEmulatorBinary(
    emulatorId,
    state.emulatorAutoBinaries,
    state.emulatorManualBinaries,
  );
  if (!binary) {
    throw new Error(
      `Start ${adapter.label} once so PlayCounter can find its program automatically, or set its program in Settings.`,
    );
  }
  if (isEmulatorLaunchGuarded(emulatorId)) return { kind: "busy" };

  const selected = await open({
    multiple: false,
    directory: false,
    filters: [
      {
        name: `${adapter.label} content`,
        extensions: [...adapter.launch.fileExtensions],
      },
    ],
  });
  if (typeof selected !== "string") return null;
  if (!isValidEmulatorContentPath(emulatorId, selected)) {
    throw new Error(
      `Pick a supported ${adapter.label} game file with a full Windows path.`,
    );
  }

  return dispatchEmulatorLaunch(emulatorId, {
    emulatorId,
    exePath: binary.exePath,
    contentPath: selected,
  });
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
  recordLaunchTargets(matches);
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
    useAppStore.getState().setEmulatorLaunchCandidates([]);
    emulatorRuntime.clear();
    lastEmulatorRunningKeys.clear();
  }
  return [];
}

function rawEmulatorSignals(
  process: ProcessSnapshot,
): RawEmulatorSignals | null {
  if (!process.emulatorId || process.pid === undefined) return null;
  return {
    emulatorId: process.emulatorId,
    exeName: process.exeName,
    exePath: process.exePath,
    pid: process.pid,
    startedAtUnix: process.startedAtUnix ?? 0,
    args: process.commandLine ?? [],
    workingDirectory: process.workingDirectory ?? null,
    windowTitle: process.windowTitle ?? null,
    openFiles: process.openFiles ?? [],
  };
}

type KnownTargetAssociations = {
  byPath: Map<string, EmulatorMapping | null>;
  byAlias: Map<string, EmulatorMapping | null>;
};

function uniqueMappingSet(
  values: Map<string, EmulatorMapping | null>,
  key: string,
  mapping: EmulatorMapping,
) {
  if (!values.has(key)) {
    values.set(key, mapping);
    return;
  }
  const existing = values.get(key);
  if (existing?.contentKey !== mapping.contentKey) values.set(key, null);
}

function knownTargetAssociations(
  privateTokens: readonly string[],
): KnownTargetAssociations {
  const state = useAppStore.getState();
  const context = {
    denylist: GENERIC_IDENTITY_DENYLIST,
    privateTokens,
  };
  const byPath = new Map<string, EmulatorMapping | null>();
  const byAlias = new Map<string, EmulatorMapping | null>();
  for (const mapping of state.emulatorMappings.values()) {
    if (mapping.decision !== "game") continue;
    const adapter = adapterFor(mapping.emulatorId);
    const target = resolveEmulatorLaunchTarget(
      mapping.contentKey,
      state.emulatorAutoLaunchTargets,
      state.emulatorManualLaunchTargets,
    );
    if (!adapter?.launch || !target) continue;
    const pathKey = `${mapping.emulatorId}:${target.filePath.toLowerCase()}`;
    uniqueMappingSet(byPath, pathKey, mapping);
    const identity = adapter.launch.identifyTarget(
      { kind: "file", filePath: target.filePath },
      context,
    );
    if (!identity) continue;
    const alias = contentKey({
      emulatorId: mapping.emulatorId,
      contentKind: identity.kind,
      contentValue: identity.value,
    });
    if (alias !== mapping.contentKey) uniqueMappingSet(byAlias, alias, mapping);
  }
  return { byPath, byAlias };
}

function mappedTargetSignal(
  mapping: EmulatorMapping,
  fallback: EmulatorContentSignal | undefined,
): EmulatorContentSignal {
  return {
    kind: mapping.contentKind,
    value: mapping.contentValue,
    display: mapping.display,
    trust: mapping.trust,
    shareable:
      mapping.shareable ??
      (mapping.trust === "recognized" && mapping.contentKind !== "folder"),
    volatile: fallback?.volatile ?? false,
    detectionSource: mapping.detectionSource ?? fallback?.detectionSource,
    searchHint: fallback?.searchHint,
    shareableSearchHint: fallback?.shareableSearchHint,
  };
}

function readEmulatorSignals(
  hosts: ProcessSnapshot[],
  associations: KnownTargetAssociations,
) {
  const privateTokens = [emulatorPrivacy.userName, emulatorPrivacy.homeDirName];
  return hosts.flatMap((process) => {
    const adapter = adapterFor(process.emulatorId);
    const signals = rawEmulatorSignals(process);
    if (!adapter || !signals) return [];
    const rawReading = adapter.read(signals, {
      denylist: GENERIC_IDENTITY_DENYLIST,
      privateTokens,
    });
    const discovery = adapter.launch?.discoverTarget(signals);
    const mapping = discovery
      ? associations.byPath.get(
          `${signals.emulatorId}:${discovery.target.filePath.toLowerCase()}`,
        )
      : undefined;
    const reading = mapping
      ? {
          state: "content" as const,
          content: mappedTargetSignal(
            mapping,
            rawReading.state === "content" ? rawReading.content : undefined,
          ),
        }
      : rawReading;
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

async function learnEmulatorContentTargets(
  hosts: ProcessSnapshot[],
  nowIso: string,
) {
  if (useAppStore.getState().settings.rememberLaunchPaths === false) return;
  const discoveries: Array<{
    candidate: EmulatorLaunchCandidate;
    association: "proven" | "requires_confirmation";
  }> = [];

  for (const host of hosts) {
    const adapter = adapterFor(host.emulatorId);
    const signals = rawEmulatorSignals(host);
    if (!adapter?.launch || !signals) continue;
    const discovery = adapter.launch.discoverTarget(signals);
    if (
      !discovery ||
      !isValidEmulatorContentPath(signals.emulatorId, discovery.target.filePath)
    ) {
      continue;
    }
    const reading = adapter.read(signals, {
      denylist: GENERIC_IDENTITY_DENYLIST,
      privateTokens: [emulatorPrivacy.userName, emulatorPrivacy.homeDirName],
    });
    if (reading.state !== "content") continue;
    const key = contentKey({
      emulatorId: signals.emulatorId,
      contentKind: reading.content.kind,
      contentValue: reading.content.value,
    });
    const state = useAppStore.getState();
    const mapping = state.emulatorMappings.get(key);
    if (!mapping || mapping.decision !== "game") continue;
    if (
      resolveEmulatorLaunchTarget(
        key,
        state.emulatorAutoLaunchTargets,
        state.emulatorManualLaunchTargets,
      )
    ) {
      continue;
    }
    const compatibility = emulatorTargetCompatibility(
      mapping,
      discovery.target.filePath,
    );
    if (!compatibility.valid) continue;
    discoveries.push({
      association: compatibility.association,
      candidate: {
        contentKey: key,
        emulatorId: signals.emulatorId,
        filePath: discovery.target.filePath,
        displayName: launchFileBaseName(discovery.target.filePath),
        setAt: nowIso,
      },
    });
  }

  if (discoveries.length === 0) {
    return;
  }
  const reports = await invoke<LaunchPathReport[]>(
    "verify_emulator_content_paths",
    {
      targets: [
        ...new Map(
          discoveries.map(({ candidate }) => [
            `${candidate.emulatorId}:${candidate.filePath.toLowerCase()}`,
            { emulatorId: candidate.emulatorId, path: candidate.filePath },
          ]),
        ).values(),
      ],
    },
  ).catch(() => []);
  const validPaths = new Set(
    reports
      .filter((report) => report.status === "ok")
      .map((report) => report.path.toLowerCase()),
  );
  const candidates = new Map(useAppStore.getState().emulatorLaunchCandidates);
  for (const discovery of discoveries) {
    if (!validPaths.has(discovery.candidate.filePath.toLowerCase())) continue;
    if (discovery.association === "proven") {
      useAppStore.getState().setEmulatorAutoLaunchTarget({
        contentKey: discovery.candidate.contentKey,
        emulatorId: discovery.candidate.emulatorId,
        filePath: discovery.candidate.filePath,
        setAt: discovery.candidate.setAt,
      });
      logRuntime(
        `emulator launch target learned emulator=${discovery.candidate.emulatorId} contentKey=${discovery.candidate.contentKey}`,
      );
      candidates.delete(discovery.candidate.contentKey);
    } else {
      const existing = candidates.get(discovery.candidate.contentKey);
      candidates.set(
        discovery.candidate.contentKey,
        existing?.filePath.toLowerCase() ===
          discovery.candidate.filePath.toLowerCase()
          ? existing
          : discovery.candidate,
      );
    }
  }
  useAppStore.getState().setEmulatorLaunchCandidates([...candidates.values()]);
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
    if (
      adapter.launch &&
      state.settings.rememberLaunchPaths !== false &&
      !state.emulatorAutoBinaries.has(host.emulatorId) &&
      isValidEmulatorBinaryPath(host.emulatorId, host.exePath) &&
      !isVolatileLaunchPath(host.exePath)
    ) {
      state.setEmulatorAutoBinary({
        emulatorId: host.emulatorId,
        exePath: host.exePath,
        setAt: nowIso,
      });
      logRuntime(`emulator binary learned emulator=${host.emulatorId}`);
    }
  }
  const lookupEnabled =
    state.settings.emulatorContentLookup !== false &&
    !isOfflineStatus(state.backendHealth.status) &&
    now >= emulatorLookupUnavailableUntil;
  const privateTokens = [emulatorPrivacy.userName, emulatorPrivacy.homeDirName];
  const associations = knownTargetAssociations(privateTokens);
  for (const runtime of emulatorRuntime.values()) {
    if (!runtime.lastContentKey) continue;
    const mapped = associations.byAlias.get(runtime.lastContentKey);
    if (mapped) runtime.lastContentKey = mapped.contentKey;
  }
  const reconciled = reconcileEmulatorReadings({
    readings: readEmulatorSignals(hosts, associations),
    observations: state.emulatorObservations.filter(
      (observation) => !associations.byAlias.get(observation.key),
    ),
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
  if (resolveIntent?.type !== "resolve" || !lookupEnabled) {
    await learnEmulatorContentTargets(hosts, nowIso);
    return matches;
  }

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
  await learnEmulatorContentTargets(hosts, nowIso);
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
  | { state: "matched"; game: Game; via: "cache" | "scoped" }
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
  const scopedResolvedKeys = new Set<string>();
  const unscopedSeenKeys = new Set<string>();

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
    const cached = resolveCachedProcess(
      process,
      state.exeCache,
      state.scopedExeLinks,
      now,
      ttlMs,
    );
    if (cached.state === "matched") {
      // A global basename decision makes the old picker stale. A scoped
      // decision deliberately leaves it available for another running copy of
      // the same basename outside the linked install directory.
      if (cached.via === "cache") {
        state.removeAmbiguousMatch(process.exeName);
      } else {
        scopedResolvedKeys.add(processCacheKey(process));
      }
      matches.push({ process, game: cached.game });
      cacheMatchedCount += 1;
      continue;
    }
    unscopedSeenKeys.add(processCacheKey(process));
    // An unresolved ambiguity has no global exe cache entry and would
    // otherwise be re-queried on every scan. Exact scoped evidence was already
    // given first refusal above.
    const ambiguous = ambiguousByKey.get(processCacheKey(process));
    if (
      ambiguous &&
      now - Date.parse(ambiguous.lastCheckedAt ?? ambiguous.detectedAt) <
        PENDING_COMMUNITY_RETRY_MS
    ) {
      cacheSkippedCount += 1;
      continue;
    }
    if (cached.state === "query") {
      queryProcesses.push(process);
    } else {
      cacheSkippedCount += 1;
    }
  }

  for (const key of scopedResolvedKeys) {
    if (!unscopedSeenKeys.has(key)) state.removeAmbiguousMatch(key);
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
  entry: Pick<LocalLink, "communitySuggestionId">,
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
  const current = useAppStore.getState();
  const gameIds = listLocalLinks(current.exeCache, current.scopedExeLinks)
    .filter(
      (entry) =>
        entry.source === "custom" &&
        entry.communitySuggestionId === communitySuggestionId &&
        entry.gameId !== undefined,
    )
    .map((entry) => entry.gameId);
  if (gameIds.length < 2) return;

  const canonicalId = Math.min(...gameIds);
  const staleIds = new Set(gameIds.filter((gameId) => gameId !== canonicalId));
  if (staleIds.size === 0) return;

  const isStaleCustom = (session: Pick<Session, "gameId" | "source">) =>
    session.source === "custom" && staleIds.has(session.gameId);

  useAppStore.setState((state) => {
    const exeCache = new Map(state.exeCache);
    const scopedExeLinks = new Map(state.scopedExeLinks);
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
    for (const [key, entry] of scopedExeLinks) {
      if (
        entry.source === "custom" &&
        entry.communitySuggestionId === communitySuggestionId &&
        staleIds.has(entry.gameId)
      ) {
        scopedExeLinks.set(key, { ...entry, gameId: canonicalId });
      }
    }

    return {
      exeCache,
      scopedExeLinks,
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
  target: string | LocalLinkRef,
  communityGames: Game[],
  pendingCommunityGames: Game[],
  pendingGamesAreAuthoritative: boolean,
  responseHasOtherMatches: boolean,
  aliases?: CommunityGameAlias[],
) {
  const state = useAppStore.getState();
  const ref = localLinkRef(target);
  const existing = findLocalLink(ref, state.exeCache, state.scopedExeLinks);
  if (
    existing?.source !== "custom" ||
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
    setCommunitySuggestionApproved(ref, approved);
    return "approved" as const;
  }

  const pending = pendingCommunityGames.find((game) =>
    isOwnCommunitySuggestion(existing, game, aliases),
  );
  if (pending) {
    setCommunitySuggestionMarker(ref, pending, false);
    return "pending" as const;
  }

  // Older servers did not report pending suggestions beside another stored
  // match. Treat that response as inconclusive instead of falsely declaring a
  // rejection. New servers always include pendingCommunityGames, even empty.
  if (!pendingGamesAreAuthoritative && responseHasOtherMatches) {
    return "inconclusive" as const;
  }
  if (existing.communitySuggestionStatus !== "rejected") {
    setCommunitySuggestionRejected(ref, existing.communitySuggestionNote);
  }
  return "rejected" as const;
}

function localLinkRef(target: string | LocalLinkRef): LocalLinkRef {
  return typeof target === "string"
    ? { kind: "exe", key: target.toLowerCase() }
    : target;
}

function sessionMatchesLocalLink(
  session: Pick<Session, "exeName" | "gameId" | "source">,
  link: LocalLink,
) {
  return (
    session.exeName.toLowerCase() === link.exeName.toLowerCase() &&
    session.source === "custom" &&
    (link.ref.kind === "exe" || session.gameId === link.gameId)
  );
}

function setCommunitySuggestionRejected(
  target: string | LocalLinkRef,
  note?: string,
) {
  const ref = localLinkRef(target);
  useAppStore.setState((state) => {
    const existing = findLocalLink(ref, state.exeCache, state.scopedExeLinks);
    if (existing?.source !== "custom") {
      return {};
    }

    const maps = writeLocalLink(state, ref, {
      pendingCommunityGame: undefined,
      communitySuggestionVerified: false,
      communitySuggestionStatus: "rejected",
      communitySuggestionNote: note,
    });
    return {
      ...maps,
      activeSessions: state.activeSessions.map((session) =>
        sessionMatchesLocalLink(session, existing)
          ? {
              ...session,
              communitySuggestionVerified: false,
              communitySuggestionStatus: "rejected" as const,
              communitySuggestionNote: note,
            }
          : session,
      ),
      recentSessions: state.recentSessions.map((session) =>
        sessionMatchesLocalLink(session, existing)
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
  const link = findLocalLink(
    ref,
    useAppStore.getState().exeCache,
    useAppStore.getState().scopedExeLinks,
  );
  logRuntime(`community suggestion rejected ${link?.exeName ?? ref.key}`);
  persist();
}

function communitySuggestionIdentityKey(ref: LocalLinkRef, gameId: number) {
  return `${ref.kind}:${ref.key}:${gameId}`;
}

function clearCommunitySuggestionMarker(ref: LocalLinkRef, gameId: number) {
  useAppStore.setState((state) => {
    const existing = findLocalLink(ref, state.exeCache, state.scopedExeLinks);
    if (
      existing?.source !== "custom" ||
      existing.communitySuggestionId !== gameId
    ) {
      return {};
    }

    const maps = writeLocalLink(state, ref, {
      pendingCommunityGame: undefined,
      communitySuggestionId: undefined,
      communitySuggestionVerified: undefined,
      communitySuggestionStatus: undefined,
      communitySuggestionNote: undefined,
    });
    const clearSession = <T extends ActiveSession | Session>(session: T): T =>
      sessionMatchesLocalLink(session, existing) &&
      session.communitySuggestionId === gameId
        ? {
            ...session,
            communitySuggestionId: undefined,
            communitySuggestionVerified: undefined,
            communitySuggestionStatus: undefined,
            communitySuggestionNote: undefined,
          }
        : session;
    return {
      ...maps,
      activeSessions: state.activeSessions.map(clearSession),
      recentSessions: state.recentSessions.map(clearSession),
    };
  });
}

export function markCommunitySuggestionRejected(
  target: string | LocalLinkRef,
  note?: string,
) {
  setCommunitySuggestionRejected(target, note);
}

function setCommunitySuggestionMarker(
  target: string | LocalLinkRef,
  game: Game,
  verified: boolean,
) {
  const ref = localLinkRef(target);
  useAppStore.setState((state) => {
    const existing = findLocalLink(ref, state.exeCache, state.scopedExeLinks);
    if (existing?.source !== "custom") {
      return {};
    }

    const maps = writeLocalLink(state, ref, {
      igdbId: game.igdbId ?? existing.igdbId,
      pendingCommunityGame: verified ? undefined : game,
      communitySuggestionId: game.id,
      communitySuggestionVerified: verified,
      communitySuggestionStatus: verified ? "verified" : "pending",
      communitySuggestionNote: undefined,
      shareState: undefined,
    });
    return {
      ...maps,
      activeSessions: state.activeSessions.map((session) =>
        sessionMatchesLocalLink(session, existing)
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
        sessionMatchesLocalLink(session, existing)
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

function setCommunitySuggestionApproved(
  target: string | LocalLinkRef,
  game: Game,
) {
  const ref = localLinkRef(target);
  const state = useAppStore.getState();
  const link = findLocalLink(ref, state.exeCache, state.scopedExeLinks);
  setCommunitySuggestionMarker(ref, game, true);
  logRuntime(
    `community suggestion approved ${link?.exeName ?? ref.key} -> ${game.name}`,
  );
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

// Applies a verified server identity without widening a path-scoped choice to
// a global basename claim.
export function applyLocalLinkGameMatch(
  target: string | LocalLinkRef,
  game: Game,
) {
  const ref = localLinkRef(target);
  if (ref.kind === "exe") {
    applyGameMatch(ref.key, game);
    return;
  }
  useAppStore.setState((state) => {
    const existing = findLocalLink(ref, state.exeCache, state.scopedExeLinks);
    if (!existing) return {};
    const maps = writeLocalLink(state, ref, {
      gameId: game.id,
      igdbId: game.igdbId ?? existing.igdbId,
      gameName: game.name,
      coverUrl: game.coverUrl,
      source: game.source,
      pendingCommunityGame: undefined,
      shareState: undefined,
    });
    const updateSession = <T extends ActiveSession | Session>(session: T): T =>
      sessionMatchesLocalLink(session, existing)
        ? {
            ...session,
            gameId: game.id,
            igdbId: game.igdbId ?? existing.igdbId,
            gameName: game.name,
            coverUrl: game.coverUrl,
            source: game.source,
          }
        : session;
    return {
      ...maps,
      activeSessions: state.activeSessions.map(updateSession),
      recentSessions: state.recentSessions.map(updateSession),
    };
  });
  persist();
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
  const existing = findLocalLinksByExe(
    exeName,
    state.exeCache,
    state.scopedExeLinks,
  ).find(
    (link) =>
      link.source === "custom" &&
      link.communitySuggestionId !== undefined &&
      link.communitySuggestionVerified === true,
  );
  if (
    !existing ||
    existing.communitySuggestionId === undefined ||
    existing.communitySuggestionVerified !== true
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

  const lastCheckedAt = new Date().toISOString();
  const maps = writeLocalLink(
    {
      exeCache: state.exeCache,
      scopedExeLinks: state.scopedExeLinks,
    },
    existing.ref,
    {
      gameId: communityGame.id,
      igdbId: communityGame.igdbId,
      gameName: communityGame.name,
      coverUrl: communityGame.coverUrl,
      source: "community",
      communitySuggestionId: existing.communitySuggestionId,
      communitySuggestionVerified: true,
      communitySuggestionStatus: "verified",
      communitySuggestionNote: undefined,
    },
  );
  if (existing.ref.kind === "exe") {
    const cacheEntry = maps.exeCache.get(existing.ref.key);
    if (cacheEntry) {
      maps.exeCache.set(existing.ref.key, { ...cacheEntry, lastCheckedAt });
    }
  }

  useAppStore.setState((current) => ({
    ...maps,
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
  if (!existing) {
    emitOverlayEvent({
      type: "choice-required",
      exeName: process.exeName,
      candidateCount: candidates.length,
      targetPids: process.pid ? [process.pid] : undefined,
    });
  }
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

export function resolveCachedProcess(
  process: ProcessSnapshot,
  exeCache: Map<string, ExeCacheEntry>,
  scopedExeLinks: Map<string, ScopedExeLink>,
  now: number,
  ttlMs: number,
): CachedResolution {
  const exeKey = process.exeName.toLowerCase();
  const cached = exeCache.get(exeKey);

  if (cached?.state === "blacklisted") return { state: "skipped" };
  const scoped = resolveScopedLink(process, scopedExeLinks);
  if (scoped) {
    return {
      state: "matched",
      via: "scoped",
      game: {
        id: scoped.gameId,
        igdbId: scoped.igdbId,
        name: scoped.gameName,
        coverUrl: scoped.coverUrl,
        source: scoped.source,
      },
    };
  }
  if (cached?.state === "matched" && cached.gameId && cached.gameName) {
    return {
      state: "matched",
      via: "cache",
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
      state.libraryImports,
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
  if (
    state.settings.rememberLaunchPaths !== false &&
    isWindowsExecutablePath(ambiguous.exePath) &&
    !isVolatileLaunchPath(ambiguous.exePath)
  ) {
    state.setLaunchTarget({
      exeName: ambiguous.exeName,
      path: ambiguous.exePath,
      owner: { gameId: game.id, source: game.source ?? null },
    });
  }
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
  state.removeLaunchTarget(exeName);
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

export async function checkBackendHealth() {
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
    await sendInstallPresenceIfDue();
  } catch (error) {
    const detail =
      error instanceof DOMException && error.name === "AbortError"
        ? "Health check timed out"
        : formatError(error);
    setBackendHealth("offline", detail);
  }
}

async function sendInstallPresenceIfDue() {
  if (installPresencePingInFlight) return installPresencePingInFlight;

  installPresencePingInFlight = (async () => {
    const state = useAppStore.getState();
    const marker = await reportInstallPresence({
      installUuid: state.installUuid,
      apiEndpoint: state.settings.apiEndpoint,
      marker: state.installPresenceMarker,
      request: async (endpoint, payload) => {
        const response = await fetchWithTimeout(
          `${endpoint}/api/install-presence`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload satisfies InstallPresencePayload),
            timeoutMs: API_REQUEST_TIMEOUT_MS,
          },
        );
        return { ok: response.ok, status: response.status };
      },
    });
    if (marker && marker !== state.installPresenceMarker) {
      useAppStore.getState().setInstallPresenceMarker(marker);
      persist();
      logRuntime(`install presence marker updated kind=${marker.kind}`);
    }
  })();

  try {
    await installPresencePingInFlight;
  } finally {
    installPresencePingInFlight = undefined;
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
      let localLinks = applyContributionMarkers(
        {
          exeCache: current.exeCache,
          scopedExeLinks: current.scopedExeLinks,
        },
        body.items,
      );
      for (const [identityKey, guard] of communitySuggestionCancelGuard) {
        const exeKey = guard.exeName.toLowerCase();
        const stillPending = body.items.some(
          (item) =>
            item.value.toLowerCase() === exeKey &&
            item.gameId === guard.gameId &&
            item.status === "pending",
        );
        if (!stillPending) {
          communitySuggestionCancelGuard.delete(identityKey);
          continue;
        }

        const entry = findLocalLink(
          guard.ref,
          localLinks.exeCache,
          localLinks.scopedExeLinks,
        );
        if (
          entry?.source === "custom" &&
          entry.communitySuggestionId === guard.gameId
        ) {
          localLinks = writeLocalLink(localLinks, guard.ref, {
            pendingCommunityGame: undefined,
            communitySuggestionId: undefined,
            communitySuggestionVerified: undefined,
            communitySuggestionStatus: undefined,
            communitySuggestionNote: undefined,
          });
        }
      }
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
        ...localLinks,
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
    state.libraryImports,
  );
  const result = evaluateMilestones({
    sessions: state.recentSessions,
    archivedSeconds: state.archivedSeconds,
    archivedGameSeconds: state.archivedGameSeconds,
    playtimeAdjustments: state.playtimeAdjustments,
    providerFloors: providerFloors(state.libraryImports.values()),
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
    state.libraryImports,
  );
  const metrics = milestoneMetrics({
    sessions: state.recentSessions,
    archivedSeconds: state.archivedSeconds,
    archivedGameSeconds: state.archivedGameSeconds,
    playtimeAdjustments: state.playtimeAdjustments,
    providerFloors: providerFloors(state.libraryImports.values()),
    verifiedContributions: state.contributionCounts.verified,
    resolveIgdbId: resolver,
  });
  const key = resolvedCanonicalGameKey(session, resolver);
  return Math.round((metrics.games.get(key)?.hours ?? 0) * 3_600);
}

export function applyContributionMarkers(
  current: Map<string, ExeCacheEntry>,
  contributions: Contribution[],
): Map<string, ExeCacheEntry>;
export function applyContributionMarkers(
  current: {
    exeCache: Map<string, ExeCacheEntry>;
    scopedExeLinks: Map<string, ScopedExeLink>;
  },
  contributions: Contribution[],
): {
  exeCache: Map<string, ExeCacheEntry>;
  scopedExeLinks: Map<string, ScopedExeLink>;
};
export function applyContributionMarkers(
  current:
    | Map<string, ExeCacheEntry>
    | {
        exeCache: Map<string, ExeCacheEntry>;
        scopedExeLinks: Map<string, ScopedExeLink>;
      },
  contributions: Contribution[],
) {
  const legacy = current instanceof Map;
  let maps = legacy
    ? {
        exeCache: new Map(current),
        scopedExeLinks: new Map<string, ScopedExeLink>(),
      }
    : {
        exeCache: new Map(current.exeCache),
        scopedExeLinks: new Map(current.scopedExeLinks),
      };
  const byExe = new Map<string, Contribution[]>();
  for (const contribution of contributions) {
    const key = contribution.value.toLowerCase();
    byExe.set(key, [...(byExe.get(key) ?? []), contribution]);
  }

  for (const [exeKey, candidates] of byExe) {
    const links = findLocalLinksByExe(
      exeKey,
      maps.exeCache,
      maps.scopedExeLinks,
    );
    for (const entry of links) {
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

      maps = writeLocalLink(maps, entry.ref, {
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
        shareState: undefined,
      });
    }
  }
  return legacy ? maps.exeCache : maps;
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

  communitySuggestionCancelGuard.delete(
    communitySuggestionIdentityKey(
      localLinkRef(exeName),
      communitySuggestionId,
    ),
  );

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

export type CommunitySuggestionCancelOutcome =
  | { kind: "cancelled" }
  | { kind: "not-pending" }
  | { kind: "not-owner" }
  | { kind: "offline" }
  | { kind: "unavailable" }
  | { kind: "failed"; error: string };

export async function cancelCommunitySuggestion(
  target: string | LocalLinkRef,
  expectedGameId: number,
): Promise<CommunitySuggestionCancelOutcome> {
  const state = useAppStore.getState();
  const ref = localLinkRef(target);
  const existing = findLocalLink(ref, state.exeCache, state.scopedExeLinks);
  if (
    !existing ||
    existing.communitySuggestionId !== expectedGameId ||
    !canCancelCommunitySuggestion({
      source: existing.source,
      exeName: existing.exeName,
      communitySuggestionId: existing.communitySuggestionId,
      communitySuggestionVerified: existing.communitySuggestionVerified,
      communitySuggestionStatus: existing.communitySuggestionStatus,
    })
  ) {
    return { kind: "not-pending" };
  }
  if (isOfflineStatus(state.backendHealth.status)) {
    return { kind: "offline" };
  }
  if (!state.installUuid) {
    return { kind: "failed", error: "No install identity available." };
  }
  if (Date.now() < communityCancelUnavailableUntil) {
    return { kind: "unavailable" };
  }

  const endpoint = `${state.settings.apiEndpoint.replace(/\/+$/, "")}/api/community/suggestions/cancel`;
  const payload: CommunitySuggestionCancelPayload = {
    exeName: existing.exeName,
    gameId: expectedGameId,
    installUuid: state.installUuid,
  };
  try {
    const response = await fetchWithTimeout(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      timeoutMs: API_REQUEST_TIMEOUT_MS,
      body: JSON.stringify(payload),
    });
    if (response.status === 404 || response.status === 501) {
      communityCancelUnavailableUntil = Date.now() + 30 * 60_000;
      return { kind: "unavailable" };
    }
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }

    const body = (await response.json()) as CommunitySuggestionCancelResponse;
    state.addApiRequestLogEntry({
      endpoint,
      exeName: existing.exeName,
      status: "matched",
      detail: `Suggestion cancel ${body.status}`,
    });
    if (body.status === "cancelled" || body.status === "not_found") {
      communitySuggestionCancelGuard.set(
        communitySuggestionIdentityKey(ref, expectedGameId),
        { ref, exeName: existing.exeName, gameId: expectedGameId },
      );
      clearCommunitySuggestionMarker(ref, expectedGameId);
      logRuntime(
        `community suggestion cancelled ${existing.exeName} -> ${expectedGameId}`,
      );
      persist();
      return { kind: "cancelled" };
    }
    if (body.status === "not_owner") {
      return { kind: "not-owner" };
    }

    void pollContributions("after suggestion cancel not-pending");
    return { kind: "not-pending" };
  } catch (error) {
    const detail = formatError(error);
    state.addApiRequestLogEntry({
      endpoint,
      exeName: existing.exeName,
      status: "error",
      detail,
    });
    logRuntime(
      `community suggestion cancel failed ${existing.exeName}: ${detail}`,
    );
    return { kind: "failed", error: detail };
  }
}

// Suggests the correct game for a tracked exe to the community. Custom games
// are shared as-is; for igdb/community games this is the "report wrong match"
// path - the exe is retagged locally as a shared custom game carrying the
// suggested metadata and the awaiting-approval marker.
export function suggestTrackedGameToCommunity(
  target: string | LocalLinkRef,
  gameName: string,
  coverUrl: string,
  communitySuggestionId: number,
  communitySuggestionVerified: boolean,
  igdbId?: number,
) {
  const ref = localLinkRef(target);
  const current = useAppStore.getState();
  const existing = findLocalLink(ref, current.exeCache, current.scopedExeLinks);
  if (!existing) return null;
  const exeName = existing.exeName;
  if (existing.source === "custom") {
    if (ref.kind === "scoped") {
      const normalizedName = gameName.trim();
      if (!normalizedName) return null;
      useAppStore.setState((state) =>
        writeLocalLink(state, ref, {
          gameName: normalizedName,
          coverUrl,
          igdbId: igdbId ?? existing.igdbId,
        }),
      );
      setCommunitySuggestionMarker(
        ref,
        {
          id: communitySuggestionId,
          igdbId,
          name: normalizedName,
          coverUrl,
          source: "community",
        },
        communitySuggestionVerified,
      );
      persist();
      return {
        id: existing.gameId,
        igdbId: igdbId ?? existing.igdbId,
        name: normalizedName,
        coverUrl,
        source: "custom" as const,
      };
    }
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
  if (ref.kind === "scoped") return null;
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

export type LocalLinkShareOutcome =
  | { kind: "submitted" | "already-known" | "rejected" }
  | { kind: "not-applicable" }
  | { kind: "failed"; error: string };

export async function submitLocalLinkToCommunity(
  ref: LocalLinkRef,
): Promise<LocalLinkShareOutcome> {
  const state = useAppStore.getState();
  const link = findLocalLink(ref, state.exeCache, state.scopedExeLinks);
  if (
    link?.source !== "custom" ||
    link.communitySuggestionId !== undefined ||
    !link.gameName
  ) {
    return { kind: "not-applicable" };
  }
  const endpoint = `${state.settings.apiEndpoint.replace(/\/+$/, "")}/api/community/suggestions`;
  try {
    const response = await fetchWithTimeout(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      timeoutMs: API_REQUEST_TIMEOUT_MS,
      body: JSON.stringify({
        exeName: link.exeName,
        name: link.gameName,
        coverUrl: link.coverUrl,
        igdbId: link.igdbId,
        installUuid: state.installUuid ?? undefined,
      }),
    });
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }
    const result = (await response.json()) as CommunityGameSuggestionResponse;
    if (result.igdbGame) {
      applyLocalLinkGameMatch(ref, result.igdbGame);
      return { kind: "already-known" };
    }
    if (result.id === undefined) throw new Error("Unexpected response");
    suggestTrackedGameToCommunity(
      ref,
      link.gameName,
      link.coverUrl ?? "",
      result.id,
      result.verified ?? false,
      link.igdbId,
    );
    if (result.rejected) {
      markCommunitySuggestionRejected(ref, result.reviewNote);
      return { kind: "rejected" };
    }
    return { kind: "submitted" };
  } catch (error) {
    useAppStore.setState((current) =>
      writeLocalLink(current, ref, { shareState: "failed" }),
    );
    persist();
    return { kind: "failed", error: formatError(error) };
  }
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
  state.removeLaunchTarget(exeName);
  if (existing.gameId !== undefined) {
    state.removeManualLaunchTarget({
      gameId: existing.gameId,
      source: existing.source ?? null,
    });
  }
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

export function forgetImportedLibraryData() {
  const state = useAppStore.getState();
  const exeCache = new Map(state.exeCache);
  const launchTargets = new Map(state.launchTargets);
  for (const [key, entry] of exeCache) {
    if (!entry.libraryProvider) continue;
    exeCache.delete(key);
    launchTargets.delete(key);
  }
  useAppStore.setState({
    exeCache,
    launchTargets,
    libraryImports: new Map(),
    libraryInstalls: new Map(),
    scopedExeLinks: new Map(),
  });
  evaluateAndStoreMilestones({ suppressNotifications: true });
  persist();
  void requestProcessScan("after local library cleared");
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
    state.removeLaunchTarget(exeName);
  }

  for (const alias of aliases) {
    state.removeManualLaunchTarget(alias);
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
    launchTargets: new Map(),
    manualLaunchTargets: new Map(),
    emulatorAutoLaunchTargets: new Map(),
    emulatorManualLaunchTargets: new Map(),
    emulatorLaunchCandidates: new Map(),
    archivedSeconds: 0,
    archivedGameSeconds: {},
    playtimeAdjustments: {},
    autoDetectedGameKeys: [],
    libraryImports: new Map(),
    libraryInstalls: new Map(),
    scopedExeLinks: new Map(),
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

    const resolveIgdbId = createGameIdentityResolver(
      gameMetadata,
      exeCache,
      state.libraryImports,
    );
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
  return customLocalGameId(exeName);
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
