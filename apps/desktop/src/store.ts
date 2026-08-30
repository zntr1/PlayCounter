import type {
  ContributionCounts,
  ContributionStatus,
  EmulatorLaunchContext,
  Game,
  GameSource,
  IdentifierFlagReason,
  Session,
  Settings,
  Theme,
} from "@playcounter/shared";
import { create } from "zustand";
import { gameSecondsKey } from "./gameSeconds";
import {
  anchorDiscoveredReviewReminder,
  DISCOVERED_REVIEW_REMINDER_ID,
  type DiscoveredReviewReminder,
} from "./discoveredReminder";
import type { AppNotification } from "./notifications";
import type { InstallPresenceMarker } from "./installPresence";
import type { AwardedMilestone } from "./milestones";
import { EMPTY_CONTRIBUTION_COUNTS } from "./notifications";
import { persistAppState } from "./persistence";
import { toggleCollapsedSection } from "./sectionCollapse";
import { splitStoredSessions } from "./sessionPersistence";
import { applyTheme, normalizeAccentColor } from "./theme";
import type {
  EmulatorMapping,
  EmulatorObservation,
  KnownEmulator,
} from "./emulators/types";
import { findTour } from "./ui/tour/tourDefinitions";
import { manualLaunchTargetKey } from "./gameLaunch";
import type {
  EmulatorBinaryEntry,
  EmulatorLaunchCandidate,
  EmulatorLaunchTarget,
} from "./emulatorLaunch";
import { stepView } from "./ui/tour/tourNavigation";
import type {
  LibraryImportEntry,
  LibraryInstallEntry,
  ScopedExeLink,
} from "./library/types";
import { libraryEntryKey } from "./library/types";
import { scopedExeLinkKey } from "./library/scopedLinks";
import type { LocalLinkRef } from "./localLinks";
import {
  defaultTourProgress,
  markTourCompleted,
  markWelcomeSeen,
  type TourProgress,
} from "./ui/tour/tourState";
import {
  DEFAULT_IMPORT_PROVIDER,
  type BuiltinImportProviderId,
} from "./library/importProviders";
import type { LibraryTabId } from "./ui/libraryTabs";
import type { MyGamesCardSize } from "./ui/myGamesPresentation";
import type { MyGamesSortKey } from "./ui/myGamesSort";

export type ViewId =
  | "now"
  | "emulating"
  | "dosbox"
  | "dolphin"
  | "games"
  | "import"
  | "discovered"
  | "history"
  | "achievements"
  | "settings"
  | "dev";

export type ProcessSnapshot = {
  exeName: string;
  exePath: string | null;
  pid?: number;
  startedAtUnix?: number;
  emulatorId?: string | null;
  commandLine?: string[] | null;
  workingDirectory?: string | null;
  windowTitle?: string | null;
  openFiles?: string[] | null;
};

export type ActiveSession = {
  id: number;
  gameId: number;
  igdbId?: number;
  gameName: string;
  exeName: string;
  coverUrl: string;
  source?: GameSource;
  communitySuggestionId?: number;
  communitySuggestionVerified?: boolean;
  communitySuggestionStatus?: ContributionStatus;
  communitySuggestionNote?: string;
  startedAt: string;
  checkpointedAt: string;
  recoveredFromCheckpoint?: boolean;
  emulator?: EmulatorLaunchContext;
};

export type AmbiguousProcessMatch = {
  exeName: string;
  exePath: string | null;
  candidates: Game[];
  detectedAt: string;
  endedAt?: string;
  // When the candidates were last fetched; gates re-querying the match API.
  lastCheckedAt?: string;
  flagReason?: IdentifierFlagReason;
};

export type GameMetadata = {
  id: number;
  igdbId?: number;
  name: string;
  coverUrl: string;
  source: Exclude<GameSource, "custom">;
};

export type ExeCacheEntry = {
  exeName: string;
  state: "matched" | "unmatched" | "blacklisted";
  gameId?: number;
  igdbId?: number;
  gameName?: string;
  coverUrl?: string;
  source?: GameSource;
  /** Provenance of the executable mapping, separate from game identity. */
  identifierSource?: GameSource;
  pendingCommunityGame?: Game;
  communitySuggestionId?: number;
  communitySuggestionVerified?: boolean;
  communitySuggestionStatus?: ContributionStatus;
  communitySuggestionNote?: string;
  shareState?: "unshared" | "failed";
  libraryProvider?: LibraryImportEntry["provider"];
  libraryExternalId?: string;
  communityUpgradeGame?: Game;
  dismissedCommunityUpgradeGameId?: number;
  // IGDB and community ids come from separate sequences and can collide, so a
  // dismissal is only valid together with the source it was recorded for.
  // Entries persisted before this field existed were always community.
  dismissedCommunityUpgradeSource?: GameSource;
  lastCheckedAt: string;
  // Runtime accumulated while this exe is discovered but not yet matched to a
  // game. Folded forward on every scan and credited to the game when the exe is
  // taken over. Deleted when the exe is ignored.
  trackedSeconds?: number;
  // ISO start of the current not-yet-folded running window. The elapsed time
  // since this timestamp is folded into trackedSeconds about once a minute (and
  // added on the fly when read or credited). Cleared on hydrate so time spent
  // while the app was closed is never credited.
  runningSince?: string;
};

export type LaunchTargetOwner = {
  gameId: number;
  source: GameSource | null;
};

export type LaunchTarget = {
  exeName: string;
  path: string;
  owner: LaunchTargetOwner;
};

export function canSwitchApprovedSuggestionToCommunity(value: {
  source?: GameSource | null;
  communitySuggestionId?: number;
  communitySuggestionVerified?: boolean;
}) {
  return (
    value.source === "custom" &&
    value.communitySuggestionId !== undefined &&
    value.communitySuggestionVerified === true
  );
}

export function canSuggestCustomGameToCommunity(value: {
  source?: GameSource | null;
  exeName?: string | null;
  communitySuggestionId?: number;
  communitySuggestionStatus?: ContributionStatus;
}) {
  return (
    value.source === "custom" &&
    Boolean(value.exeName) &&
    (value.communitySuggestionId === undefined ||
      value.communitySuggestionStatus === "rejected")
  );
}

export function canCancelCommunitySuggestion(value: {
  source?: GameSource | null;
  exeName?: string | null;
  communitySuggestionId?: number;
  communitySuggestionVerified?: boolean;
  communitySuggestionStatus?: ContributionStatus;
}) {
  if (
    value.source !== "custom" ||
    !value.exeName ||
    value.communitySuggestionId === undefined
  ) {
    return false;
  }

  const status =
    value.communitySuggestionStatus ??
    (value.communitySuggestionVerified ? "verified" : "pending");
  return status === "pending";
}

export type PendingCommunitySuggestionTarget = {
  ref: LocalLinkRef;
  exeName: string;
  gameId: number;
};

export function findPendingCommunitySuggestionEntry(
  exeNames: readonly string[],
  exeCache: ReadonlyMap<string, ExeCacheEntry>,
  scopedExeLinks: ReadonlyMap<string, ScopedExeLink> = new Map(),
): PendingCommunitySuggestionTarget | null {
  if (exeNames.length === 0) return null;
  const wanted = new Set(exeNames.map((exeName) => exeName.toLowerCase()));
  for (const exeName of exeNames) {
    const key = exeName.toLowerCase();
    const entry = exeCache.get(key);
    if (
      entry?.state === "matched" &&
      canCancelCommunitySuggestion({
        source: entry.source,
        exeName: entry.exeName,
        communitySuggestionId: entry.communitySuggestionId,
        communitySuggestionVerified: entry.communitySuggestionVerified,
        communitySuggestionStatus: entry.communitySuggestionStatus,
      })
    ) {
      return {
        ref: { kind: "exe", key },
        exeName: entry.exeName,
        gameId: entry.communitySuggestionId!,
      };
    }
  }
  for (const [key, entry] of scopedExeLinks) {
    if (
      wanted.has(entry.exeName.toLowerCase()) &&
      canCancelCommunitySuggestion({
        source: entry.source,
        exeName: entry.exeName,
        communitySuggestionId: entry.communitySuggestionId,
        communitySuggestionVerified: entry.communitySuggestionVerified,
        communitySuggestionStatus: entry.communitySuggestionStatus,
      })
    ) {
      return {
        ref: { kind: "scoped", key },
        exeName: entry.exeName,
        gameId: entry.communitySuggestionId!,
      };
    }
  }

  return null;
}

export type ApiRequestLogEntry = {
  id: number;
  at: string;
  endpoint: string;
  exeName: string;
  status: "matched" | "unmatched" | "error";
  detail: string;
};

export type RuntimeLogEntry = {
  id: number;
  at: string;
  message: string;
};

export type BackendHealthStatus =
  | "checking"
  | "online"
  | "offline"
  | "reconnecting";

export type BackendHealth = {
  status: BackendHealthStatus;
  checkedAt: string | null;
  detail: string | null;
};

export type Toast = {
  id: number;
  tone: "success" | "error" | "info";
  emoji?: string;
  title: string;
  detail?: string;
};

export type DesktopOverlaySettingKey =
  | "desktopOverlaysEnabled"
  | "overlayFirstDetections"
  | "overlaySessionStarts"
  | "overlaySessionSummaries"
  | "overlayMilestones"
  | "overlayActionRequired"
  | "overlayDiscoveries";

export type ActiveTour = {
  tourId: string;
  stepIndex: number;
  returnView: ViewId;
  enteredStepAt: number;
};

export type AppState = {
  activeView: ViewId;
  libraryTab: LibraryTabId;
  libraryImportProvider: BuiltinImportProviderId;
  historyQuery: string;
  historyGameKey: string | null;
  installUuid: string | null;
  contributionOwnerUuid: string | null;
  activeSessions: ActiveSession[];
  ambiguousMatches: AmbiguousProcessMatch[];
  emulatorObservations: EmulatorObservation[];
  emulatorMappings: Map<string, EmulatorMapping>;
  knownEmulators: Map<string, KnownEmulator>;
  recentSessions: Session[];
  gameMetadata: Map<string, GameMetadata>;
  processes: ProcessSnapshot[];
  lastProcessScanAt: string | null;
  lastProcessScanError: string | null;
  ignoredProcesses: Set<string>;
  userIgnoredProcesses: Set<string>;
  userIgnoredProcessesPath: string | null;
  exeCache: Map<string, ExeCacheEntry>;
  libraryImports: Map<string, LibraryImportEntry>;
  libraryInstalls: Map<string, LibraryInstallEntry>;
  scopedExeLinks: Map<string, ScopedExeLink>;
  launchTargets: Map<string, LaunchTarget>;
  manualLaunchTargets: Map<string, LaunchTarget>;
  emulatorAutoBinaries: Map<string, EmulatorBinaryEntry>;
  emulatorManualBinaries: Map<string, EmulatorBinaryEntry>;
  emulatorAutoLaunchTargets: Map<string, EmulatorLaunchTarget>;
  emulatorManualLaunchTargets: Map<string, EmulatorLaunchTarget>;
  emulatorLaunchCandidates: Map<string, EmulatorLaunchCandidate>;
  apiRequestLog: ApiRequestLogEntry[];
  runtimeLog: RuntimeLogEntry[];
  blacklist: Set<string>;
  runtimeError: string | null;
  backendHealth: BackendHealth;
  installPresenceMarker: InstallPresenceMarker | null;
  toasts: Toast[];
  notifications: AppNotification[];
  discoveredReviewReminder: DiscoveredReviewReminder;
  seenContributionStatus: Record<string, ContributionStatus>;
  contributionCounts: ContributionCounts;
  emulatorContributionCounts: ContributionCounts;
  awardedMilestones: AwardedMilestone[];
  milestonesInitializedAt: string | null;
  archivedSeconds: number;
  archivedGameSeconds: Record<string, number>;
  playtimeAdjustments: Record<string, number>;
  collapsedSections: string[];
  autoDetectedGameKeys: string[];
  tourProgress: TourProgress;
  lastSeenReleaseNotesVersion: string | null;
  hadPersistedStateOnStartup: boolean;
  currentNotesOpen: boolean;
  suppressStartupNotificationsOnce: boolean;
  suppressContributionNotificationsOnce: boolean;
  activeTour: ActiveTour | null;
  demoResetToken: number;
  helpMenuOpen: boolean;
  cleanup: (() => void) | null;
  settings: Settings;
  setActiveView: (view: ViewId) => void;
  setLibraryTab: (tab: LibraryTabId) => void;
  setLibraryImportProvider: (provider: BuiltinImportProviderId) => void;
  startTour: (tourId: string) => void;
  goToTourStep: (index: number, resetDemo?: boolean) => void;
  endTour: (outcome: "completed" | "dismissed") => void;
  finishTourAndOpenHelp: () => void;
  setHelpMenuOpen: (open: boolean) => void;
  markTourWelcomeSeen: () => void;
  resetTourProgress: () => void;
  markReleaseNotesSeen: (version: string) => void;
  openCurrentReleaseNotes: () => void;
  closeCurrentReleaseNotes: (version: string) => void;
  setHistoryQuery: (query: string) => void;
  setHistoryGameKey: (key: string | null) => void;
  adoptInstallIdentity: (installUuid: string) => void;
  setActiveSessions: (sessions: ActiveSession[]) => void;
  setAmbiguousMatch: (match: AmbiguousProcessMatch) => void;
  removeAmbiguousMatch: (exeName: string) => void;
  setEmulatorObservations: (observations: EmulatorObservation[]) => void;
  setEmulatorObservation: (observation: EmulatorObservation) => void;
  removeEmulatorObservation: (key: string) => void;
  setEmulatorMapping: (mapping: EmulatorMapping) => void;
  removeEmulatorMapping: (contentKey: string) => void;
  setKnownEmulator: (emulator: KnownEmulator) => void;
  addSession: (session: Session) => void;
  setGameMetadata: (games: GameMetadata[]) => void;
  setProcesses: (processes: ProcessSnapshot[]) => void;
  setProcessScanError: (error: string | null) => void;
  setIgnoredProcesses: (
    processes: string[],
    userFilePath: string | null,
    userProcesses?: string[],
  ) => void;
  setExeCacheEntry: (entry: ExeCacheEntry) => void;
  removeExeCacheEntry: (exeName: string) => void;
  setLibraryImport: (entry: LibraryImportEntry) => void;
  removeLibraryImport: (
    provider: LibraryImportEntry["provider"],
    externalId: string,
  ) => void;
  setLibraryInstall: (entry: LibraryInstallEntry) => void;
  removeLibraryInstall: (
    provider: LibraryInstallEntry["provider"],
    externalId: string,
  ) => void;
  setScopedExeLink: (entry: ScopedExeLink) => void;
  removeScopedExeLink: (key: string) => void;
  clearLibraryData: () => void;
  setLaunchTarget: (target: LaunchTarget) => void;
  removeLaunchTarget: (exeName: string) => void;
  setManualLaunchTarget: (
    target: LaunchTarget,
    aliases?: readonly LaunchTargetOwner[],
  ) => void;
  removeManualLaunchTarget: (owner: LaunchTargetOwner) => void;
  setEmulatorAutoBinary: (entry: EmulatorBinaryEntry) => void;
  removeEmulatorAutoBinary: (emulatorId: string) => void;
  setEmulatorManualBinary: (entry: EmulatorBinaryEntry) => void;
  removeEmulatorManualBinary: (emulatorId: string) => void;
  setEmulatorAutoLaunchTarget: (target: EmulatorLaunchTarget) => void;
  removeEmulatorAutoLaunchTarget: (contentKey: string) => void;
  setEmulatorManualLaunchTarget: (target: EmulatorLaunchTarget) => void;
  removeEmulatorManualLaunchTarget: (contentKey: string) => void;
  setEmulatorLaunchCandidates: (candidates: EmulatorLaunchCandidate[]) => void;
  forgetExecutableLaunchTargets: () => void;
  forgetEmulatorLaunchTargets: () => void;
  addApiRequestLogEntry: (entry: Omit<ApiRequestLogEntry, "id" | "at">) => void;
  addRuntimeLogEntry: (message: string) => void;
  setRuntimeError: (error: string | null) => void;
  setBackendHealth: (health: BackendHealth) => void;
  setInstallPresenceMarker: (marker: InstallPresenceMarker) => void;
  addToast: (toast: Omit<Toast, "id">) => void;
  dismissToast: (toastId: number) => void;
  addNotification: (notification: AppNotification) => void;
  setDiscoveredReviewReminder: (reminder: DiscoveredReviewReminder) => void;
  dismissNotification: (notificationId: string) => void;
  clearNotifications: () => void;
  markAllNotificationsRead: () => void;
  rekeyGameSeconds: (from: string, to: string) => void;
  setPlaytimeAdjustment: (
    key: string,
    seconds: number,
    clearKeys?: string[],
  ) => void;
  clearGameSeconds: (keys: string[]) => void;
  toggleSectionCollapsed: (sectionId: string) => void;
  setCleanup: (cleanup: () => void) => void;
  setLaunchOnStartup: (enabled: boolean) => void;
  setShowDurationDays: (enabled: boolean) => void;
  setMyGamesCardSize: (size: MyGamesCardSize) => void;
  setMyGamesSortKey: (key: MyGamesSortKey) => void;
  setMyGamesShowBadges: (enabled: boolean) => void;
  setAutoShareIgnoredProcesses: (enabled: boolean) => void;
  setEmulatorSetting: (
    key: "emulatorDetection" | "emulatorContentLookup",
    enabled: boolean,
  ) => void;
  setDesktopOverlaySetting: (
    key: DesktopOverlaySettingKey,
    enabled: boolean,
  ) => void;
  setLauncherSetting: (
    key:
      | "rememberLaunchPaths"
      | "gameLaunchingEnabled"
      | "controllerNavigationEnabled",
    enabled: boolean,
  ) => void;
  recordAutomaticDetection: (keys: string[]) => boolean;
  carryAutoDetectedGameKey: (from: string, to: string) => void;
  setEmulatorIgnoredSetting: (emulatorId: string, ignored: boolean) => void;
  setDevNumber: (
    key: "pollingIntervalSeconds" | "unmatchedRetryDays",
    value: number,
  ) => void;
  setApiEndpoint: (value: string) => void;
  setTheme: (theme: Theme) => void;
  setAccentColor: (color: string | null) => void;
  toggleVerboseLogs: () => void;
  toggleBlacklist: (exeName: string, enabled: boolean) => void;
  clearCache: () => void;
};

export const DEFAULT_API_ENDPOINT =
  import.meta.env.VITE_PLAYCOUNTER_API_URL ?? "http://localhost:3003";

export type Stage = "local" | "test" | "prod";

export const BUILD_STAGE: Stage =
  (import.meta.env.VITE_PLAYCOUNTER_STAGE as Stage | undefined) ?? "local";

const defaultSettings: Settings = {
  launchOnStartup: true,
  showDurationDays: false,
  libraryCardSize: "grid",
  librarySortKey: "recent",
  libraryShowBadges: true,
  autoShareIgnoredProcesses: false,
  pollingIntervalSeconds: 5,
  unmatchedRetryDays: 30,
  apiEndpoint: DEFAULT_API_ENDPOINT,
  verboseLogs: false,
  theme: "dark",
  accentColor: null,
  emulatorDetection: true,
  emulatorContentLookup: true,
  ignoredEmulatorIds: [],
  desktopOverlaysEnabled: true,
  overlayFirstDetections: true,
  overlaySessionStarts: true,
  overlaySessionSummaries: true,
  overlayMilestones: true,
  overlayActionRequired: true,
  overlayDiscoveries: false,
  rememberLaunchPaths: true,
  gameLaunchingEnabled: false,
  controllerNavigationEnabled: false,
};

let nextRuntimeLogId = 0;
let nextToastId = 0;

function addSessionsToArchive(
  archivedSeconds: number,
  currentGameSeconds: Record<string, number>,
  sessions: Session[],
) {
  const archivedGameSeconds = { ...currentGameSeconds };
  for (const session of sessions) {
    const seconds = Math.max(0, session.durationSeconds ?? 0);
    archivedSeconds += seconds;
    const key = gameSecondsKey(session);
    archivedGameSeconds[key] = (archivedGameSeconds[key] ?? 0) + seconds;
  }
  return { archivedSeconds, archivedGameSeconds };
}

export function foldSessionsIntoArchive(
  archivedSeconds: number,
  archivedGameSeconds: Record<string, number>,
  sessions: Session[],
) {
  return addSessionsToArchive(archivedSeconds, archivedGameSeconds, sessions);
}

function persistSoon() {
  queueMicrotask(() => {
    const state = useAppStore.getState();
    const result = persistAppState(state);
    if (result.status !== "failed") {
      useAppStore.setState({
        recentSessions: result.sessions,
        notifications: result.notifications,
        archivedSeconds: result.archivedSeconds,
        archivedGameSeconds: result.archivedGameSeconds,
      });
    }
    if (result.status === "trimmed") {
      const oldest = result.removed.at(-1)?.startedAt;
      if (result.removed.length > 0) {
        state.addRuntimeLogEntry(
          `storage quota reached; removed ${result.removed.length} oldest sessions`,
        );
        state.addToast({
          tone: "error",
          title: "History storage was full",
          detail: `${result.removed.length} oldest sessions${oldest ? `, ending around ${new Date(oldest).toLocaleDateString()}` : ""}, were archived so new data could be saved.`,
        });
      }
    } else if (result.status === "failed") {
      state.addRuntimeLogEntry("local persistence failed after retry");
      state.addToast({
        tone: "error",
        title: "Changes could not be saved",
        detail:
          "Local storage is unavailable or full. Your in-memory history was kept.",
      });
    }
  });
}

export const useAppStore = create<AppState>((set, get) => ({
  activeView: "now",
  libraryTab: "all",
  libraryImportProvider: DEFAULT_IMPORT_PROVIDER,
  historyQuery: "",
  historyGameKey: null,
  installUuid: null,
  contributionOwnerUuid: null,
  activeSessions: [],
  ambiguousMatches: [],
  emulatorObservations: [],
  emulatorMappings: new Map(),
  knownEmulators: new Map(),
  recentSessions: [],
  gameMetadata: new Map(),
  processes: [],
  lastProcessScanAt: null,
  lastProcessScanError: null,
  ignoredProcesses: new Set(),
  userIgnoredProcesses: new Set(),
  userIgnoredProcessesPath: null,
  exeCache: new Map(),
  libraryImports: new Map(),
  libraryInstalls: new Map(),
  scopedExeLinks: new Map(),
  launchTargets: new Map(),
  manualLaunchTargets: new Map(),
  emulatorAutoBinaries: new Map(),
  emulatorManualBinaries: new Map(),
  emulatorAutoLaunchTargets: new Map(),
  emulatorManualLaunchTargets: new Map(),
  emulatorLaunchCandidates: new Map(),
  apiRequestLog: [],
  runtimeLog: [],
  blacklist: new Set(),
  runtimeError: null,
  backendHealth: { status: "checking", checkedAt: null, detail: null },
  installPresenceMarker: null,
  toasts: [],
  notifications: [],
  discoveredReviewReminder: null,
  seenContributionStatus: {},
  contributionCounts: EMPTY_CONTRIBUTION_COUNTS,
  emulatorContributionCounts: EMPTY_CONTRIBUTION_COUNTS,
  awardedMilestones: [],
  milestonesInitializedAt: null,
  archivedSeconds: 0,
  archivedGameSeconds: {},
  playtimeAdjustments: {},
  collapsedSections: [],
  autoDetectedGameKeys: [],
  tourProgress: defaultTourProgress(),
  lastSeenReleaseNotesVersion: null,
  hadPersistedStateOnStartup: false,
  currentNotesOpen: false,
  suppressStartupNotificationsOnce: false,
  suppressContributionNotificationsOnce: false,
  activeTour: null,
  demoResetToken: 0,
  helpMenuOpen: false,
  cleanup: null,
  settings: defaultSettings,
  setActiveView: (activeView) => set({ activeView }),
  setLibraryTab: (libraryTab) => set({ libraryTab }),
  setLibraryImportProvider: (libraryImportProvider) =>
    set({ libraryImportProvider }),
  startTour: (tourId) => {
    const tour = findTour(tourId);
    if (!tour) return;
    set((state) => {
      const activeTour = {
        tourId,
        stepIndex: 0,
        returnView: state.activeView,
        enteredStepAt: Date.now(),
      };
      return {
        activeTour,
        activeView: stepView(tour.steps[0], state.activeView, state.activeView),
        demoResetToken: state.demoResetToken + 1,
        helpMenuOpen: false,
      };
    });
  },
  goToTourStep: (index, resetDemo = false) =>
    set((state) => {
      if (!state.activeTour) return state;
      const tour = findTour(state.activeTour.tourId);
      const step = tour?.steps[index];
      if (!tour || !step) return state;
      return {
        activeTour: {
          ...state.activeTour,
          stepIndex: index,
          enteredStepAt: Date.now(),
        },
        activeView: stepView(
          step,
          state.activeView,
          state.activeTour.returnView,
        ),
        demoResetToken: state.demoResetToken + (resetDemo ? 1 : 0),
      };
    }),
  endTour: (outcome) => {
    set((state) => {
      if (!state.activeTour) return state;
      const tour = findTour(state.activeTour.tourId);
      return {
        activeView: state.activeTour.returnView,
        activeTour: null,
        demoResetToken: state.demoResetToken + 1,
        helpMenuOpen: false,
        tourProgress:
          outcome === "completed" && tour
            ? markTourCompleted(state.tourProgress, tour.id, tour.version)
            : state.tourProgress,
      };
    });
    persistSoon();
  },
  finishTourAndOpenHelp: () => {
    set((state) => {
      if (!state.activeTour) return state;
      const tour = findTour(state.activeTour.tourId);
      return {
        activeView: state.activeTour.returnView,
        activeTour: null,
        demoResetToken: state.demoResetToken + 1,
        helpMenuOpen: true,
        tourProgress: tour
          ? markTourCompleted(state.tourProgress, tour.id, tour.version)
          : state.tourProgress,
      };
    });
    persistSoon();
  },
  setHelpMenuOpen: (helpMenuOpen) => set({ helpMenuOpen }),
  markTourWelcomeSeen: () => {
    set((state) => ({ tourProgress: markWelcomeSeen(state.tourProgress) }));
    persistSoon();
  },
  resetTourProgress: () => {
    set({ tourProgress: defaultTourProgress(), helpMenuOpen: false });
    persistSoon();
  },
  markReleaseNotesSeen: (version) => {
    if (get().lastSeenReleaseNotesVersion === version) return;
    set({ lastSeenReleaseNotesVersion: version });
    persistSoon();
  },
  openCurrentReleaseNotes: () => set({ currentNotesOpen: true }),
  closeCurrentReleaseNotes: (version) => {
    set({ currentNotesOpen: false });
    get().markReleaseNotesSeen(version);
  },
  setHistoryQuery: (historyQuery) => set({ historyQuery }),
  setHistoryGameKey: (historyGameKey) => set({ historyGameKey }),
  adoptInstallIdentity: (installUuid) =>
    set((state) => {
      if (state.contributionOwnerUuid === installUuid) {
        return { installUuid, contributionOwnerUuid: installUuid };
      }
      const emulatorMappings = new Map(state.emulatorMappings);
      for (const [key, mapping] of emulatorMappings) {
        if (!mapping.share || mapping.share.status === "already_curated") {
          continue;
        }
        emulatorMappings.set(key, { ...mapping, share: undefined });
      }
      return {
        installUuid,
        contributionOwnerUuid: installUuid,
        seenContributionStatus: {},
        contributionCounts: EMPTY_CONTRIBUTION_COUNTS,
        emulatorContributionCounts: EMPTY_CONTRIBUTION_COUNTS,
        emulatorMappings,
        notifications: state.notifications.filter(
          (notification) => !notification.kind.startsWith("suggestion-"),
        ),
      };
    }),
  setActiveSessions: (activeSessions) => set({ activeSessions }),
  setAmbiguousMatch: (match) =>
    set((state) => {
      const key = match.exeName.toLowerCase();
      const existing = state.ambiguousMatches.find(
        (candidate) => candidate.exeName.toLowerCase() === key,
      );
      return {
        ambiguousMatches: existing
          ? state.ambiguousMatches.map((candidate) =>
              candidate.exeName.toLowerCase() === key
                ? { ...match, detectedAt: existing.detectedAt }
                : candidate,
            )
          : [...state.ambiguousMatches, match],
      };
    }),
  removeAmbiguousMatch: (exeName) =>
    set((state) => ({
      ambiguousMatches: state.ambiguousMatches.filter(
        (match) => match.exeName.toLowerCase() !== exeName.toLowerCase(),
      ),
    })),
  setEmulatorObservations: (emulatorObservations) =>
    set({ emulatorObservations }),
  setEmulatorObservation: (observation) =>
    set((state) => {
      const existing = state.emulatorObservations.some(
        (candidate) => candidate.key === observation.key,
      );
      return {
        emulatorObservations: existing
          ? state.emulatorObservations.map((candidate) =>
              candidate.key === observation.key ? observation : candidate,
            )
          : [...state.emulatorObservations, observation],
      };
    }),
  removeEmulatorObservation: (key) =>
    set((state) => ({
      emulatorObservations: state.emulatorObservations.filter(
        (observation) => observation.key !== key,
      ),
    })),
  setEmulatorMapping: (mapping) =>
    set((state) => {
      const emulatorMappings = new Map(state.emulatorMappings);
      emulatorMappings.set(mapping.contentKey, mapping);
      return { emulatorMappings };
    }),
  removeEmulatorMapping: (contentKey) =>
    set((state) => {
      const emulatorMappings = new Map(state.emulatorMappings);
      emulatorMappings.delete(contentKey);
      return { emulatorMappings };
    }),
  setKnownEmulator: (emulator) =>
    set((state) => {
      const knownEmulators = new Map(state.knownEmulators);
      const existing = knownEmulators.get(emulator.emulatorId);
      knownEmulators.set(emulator.emulatorId, {
        ...emulator,
        firstSeenAt: existing?.firstSeenAt ?? emulator.firstSeenAt,
        hostExeNames: [
          ...new Set([
            ...(existing?.hostExeNames ?? []),
            ...emulator.hostExeNames,
          ]),
        ],
      });
      return { knownEmulators };
    }),
  addSession: (session) =>
    set((state) => {
      const { kept, removed } = splitStoredSessions([
        session,
        ...state.recentSessions,
      ]);
      const archive = addSessionsToArchive(
        state.archivedSeconds,
        state.archivedGameSeconds,
        removed,
      );
      return { recentSessions: kept, ...archive };
    }),
  setGameMetadata: (games) =>
    set((state) => {
      const gameMetadata = new Map(state.gameMetadata);
      for (const game of games) gameMetadata.set(gameMetadataKey(game), game);
      return { gameMetadata };
    }),
  setProcesses: (processes) =>
    set({
      processes,
      lastProcessScanAt: new Date().toISOString(),
      lastProcessScanError: null,
    }),
  setProcessScanError: (lastProcessScanError) =>
    set({ lastProcessScanError, lastProcessScanAt: new Date().toISOString() }),
  setIgnoredProcesses: (processes, userIgnoredProcessesPath, userProcesses) =>
    set({
      ignoredProcesses: new Set(
        processes.map((process) => process.toLowerCase()),
      ),
      userIgnoredProcesses: new Set(
        (userProcesses ?? []).map((process) => process.toLowerCase()),
      ),
      userIgnoredProcessesPath,
    }),
  setExeCacheEntry: (entry) =>
    set((state) => {
      const exeCache = new Map(state.exeCache);
      exeCache.set(entry.exeName.toLowerCase(), entry);
      if (entry.state !== "matched") return { exeCache };
      let libraryImports = state.libraryImports;
      for (const [key, imported] of state.libraryImports) {
        const sameGame =
          (entry.igdbId !== undefined && entry.igdbId === imported.igdbId) ||
          (entry.gameId === imported.gameId &&
            entry.source === imported.source);
        if (
          !sameGame ||
          imported.linkedExeNames.some(
            (exeName) => exeName.toLowerCase() === entry.exeName.toLowerCase(),
          )
        ) {
          continue;
        }
        if (libraryImports === state.libraryImports) {
          libraryImports = new Map(state.libraryImports);
        }
        libraryImports.set(key, {
          ...imported,
          linkedExeNames: [...imported.linkedExeNames, entry.exeName],
        });
      }
      return { exeCache, libraryImports };
    }),
  removeExeCacheEntry: (exeName) =>
    set((state) => {
      const exeCache = new Map(state.exeCache);
      exeCache.delete(exeName.toLowerCase());
      return { exeCache };
    }),
  setLibraryImport: (entry) => {
    set((state) => {
      const libraryImports = new Map(state.libraryImports);
      libraryImports.set(
        libraryEntryKey(entry.provider, entry.externalId),
        entry,
      );
      return { libraryImports };
    });
    persistSoon();
  },
  removeLibraryImport: (provider, externalId) => {
    set((state) => {
      const key = libraryEntryKey(provider, externalId);
      const libraryImports = new Map(state.libraryImports);
      const libraryInstalls = new Map(state.libraryInstalls);
      const scopedExeLinks = new Map(state.scopedExeLinks);
      libraryImports.delete(key);
      libraryInstalls.delete(key);
      for (const [linkKey, link] of scopedExeLinks) {
        if (link.provider === provider && link.externalId === externalId) {
          scopedExeLinks.delete(linkKey);
        }
      }
      return { libraryImports, libraryInstalls, scopedExeLinks };
    });
    persistSoon();
  },
  setLibraryInstall: (entry) => {
    set((state) => {
      const libraryInstalls = new Map(state.libraryInstalls);
      libraryInstalls.set(
        libraryEntryKey(entry.provider, entry.externalId),
        entry,
      );
      return { libraryInstalls };
    });
    persistSoon();
  },
  removeLibraryInstall: (provider, externalId) => {
    set((state) => {
      const libraryInstalls = new Map(state.libraryInstalls);
      libraryInstalls.delete(libraryEntryKey(provider, externalId));
      return { libraryInstalls };
    });
    persistSoon();
  },
  setScopedExeLink: (entry) => {
    const key = scopedExeLinkKey(entry.exeName, entry.pathPrefix);
    if (!key) return;
    set((state) => {
      const scopedExeLinks = new Map(state.scopedExeLinks);
      scopedExeLinks.set(key, entry);
      return { scopedExeLinks };
    });
    persistSoon();
  },
  removeScopedExeLink: (key) => {
    set((state) => {
      const scopedExeLinks = new Map(state.scopedExeLinks);
      scopedExeLinks.delete(key);
      return { scopedExeLinks };
    });
    persistSoon();
  },
  clearLibraryData: () => {
    set({
      libraryImports: new Map(),
      libraryInstalls: new Map(),
      scopedExeLinks: new Map(),
    });
    persistSoon();
  },
  setLaunchTarget: (target) =>
    set((state) => {
      if (state.settings.rememberLaunchPaths === false) return state;
      const launchTargets = new Map(state.launchTargets);
      launchTargets.set(target.exeName.toLowerCase(), target);
      return { launchTargets };
    }),
  removeLaunchTarget: (exeName) =>
    set((state) => {
      const launchTargets = new Map(state.launchTargets);
      launchTargets.delete(exeName.toLowerCase());
      return { launchTargets };
    }),
  setManualLaunchTarget: (target, aliases = [target.owner]) =>
    set((state) => {
      if (state.settings.rememberLaunchPaths === false) return state;
      const manualLaunchTargets = new Map(state.manualLaunchTargets);
      for (const alias of aliases) {
        manualLaunchTargets.delete(manualLaunchTargetKey(alias));
      }
      manualLaunchTargets.set(manualLaunchTargetKey(target.owner), target);
      return { manualLaunchTargets };
    }),
  removeManualLaunchTarget: (owner) =>
    set((state) => {
      const manualLaunchTargets = new Map(state.manualLaunchTargets);
      manualLaunchTargets.delete(manualLaunchTargetKey(owner));
      return { manualLaunchTargets };
    }),
  setEmulatorAutoBinary: (entry) => {
    set((state) => {
      if (state.settings.rememberLaunchPaths === false) return state;
      if (state.emulatorAutoBinaries.has(entry.emulatorId)) return state;
      const emulatorAutoBinaries = new Map(state.emulatorAutoBinaries);
      emulatorAutoBinaries.set(entry.emulatorId, entry);
      return { emulatorAutoBinaries };
    });
    persistSoon();
  },
  removeEmulatorAutoBinary: (emulatorId) => {
    set((state) => {
      const emulatorAutoBinaries = new Map(state.emulatorAutoBinaries);
      emulatorAutoBinaries.delete(emulatorId);
      return { emulatorAutoBinaries };
    });
    persistSoon();
  },
  setEmulatorManualBinary: (entry) => {
    set((state) => {
      if (state.settings.rememberLaunchPaths === false) return state;
      const emulatorManualBinaries = new Map(state.emulatorManualBinaries);
      emulatorManualBinaries.set(entry.emulatorId, entry);
      return { emulatorManualBinaries };
    });
    persistSoon();
  },
  removeEmulatorManualBinary: (emulatorId) => {
    set((state) => {
      const emulatorManualBinaries = new Map(state.emulatorManualBinaries);
      emulatorManualBinaries.delete(emulatorId);
      return { emulatorManualBinaries };
    });
    persistSoon();
  },
  setEmulatorAutoLaunchTarget: (target) => {
    set((state) => {
      if (state.settings.rememberLaunchPaths === false) return state;
      if (
        state.emulatorAutoLaunchTargets.has(target.contentKey) ||
        state.emulatorManualLaunchTargets.has(target.contentKey)
      ) {
        return state;
      }
      const emulatorAutoLaunchTargets = new Map(
        state.emulatorAutoLaunchTargets,
      );
      emulatorAutoLaunchTargets.set(target.contentKey, target);
      return { emulatorAutoLaunchTargets };
    });
    persistSoon();
  },
  removeEmulatorAutoLaunchTarget: (contentKey) => {
    set((state) => {
      const emulatorAutoLaunchTargets = new Map(
        state.emulatorAutoLaunchTargets,
      );
      emulatorAutoLaunchTargets.delete(contentKey);
      return { emulatorAutoLaunchTargets };
    });
    persistSoon();
  },
  setEmulatorManualLaunchTarget: (target) => {
    set((state) => {
      if (state.settings.rememberLaunchPaths === false) return state;
      const emulatorManualLaunchTargets = new Map(
        state.emulatorManualLaunchTargets,
      );
      emulatorManualLaunchTargets.set(target.contentKey, target);
      return { emulatorManualLaunchTargets };
    });
    persistSoon();
  },
  removeEmulatorManualLaunchTarget: (contentKey) => {
    set((state) => {
      const emulatorManualLaunchTargets = new Map(
        state.emulatorManualLaunchTargets,
      );
      emulatorManualLaunchTargets.delete(contentKey);
      return { emulatorManualLaunchTargets };
    });
    persistSoon();
  },
  setEmulatorLaunchCandidates: (candidates) => {
    let changed = false;
    set((state) => {
      if (state.settings.rememberLaunchPaths === false) return state;
      const emulatorLaunchCandidates = new Map(
        candidates.map((candidate) => [candidate.contentKey, candidate]),
      );
      if (
        emulatorLaunchCandidates.size === state.emulatorLaunchCandidates.size &&
        [...emulatorLaunchCandidates].every(([key, candidate]) => {
          const current = state.emulatorLaunchCandidates.get(key);
          return (
            current?.emulatorId === candidate.emulatorId &&
            current.filePath === candidate.filePath &&
            current.displayName === candidate.displayName &&
            current.setAt === candidate.setAt
          );
        })
      ) {
        return state;
      }
      changed = true;
      return { emulatorLaunchCandidates };
    });
    if (changed) persistSoon();
  },
  forgetExecutableLaunchTargets: () => {
    set({
      launchTargets: new Map(),
      manualLaunchTargets: new Map(),
    });
    persistSoon();
  },
  forgetEmulatorLaunchTargets: () => {
    set({
      emulatorAutoBinaries: new Map(),
      emulatorManualBinaries: new Map(),
      emulatorAutoLaunchTargets: new Map(),
      emulatorManualLaunchTargets: new Map(),
      emulatorLaunchCandidates: new Map(),
    });
    persistSoon();
  },
  addApiRequestLogEntry: (entry) =>
    set((state) => ({
      apiRequestLog: [
        { ...entry, id: Date.now(), at: new Date().toISOString() },
        ...state.apiRequestLog,
      ].slice(0, 20),
    })),
  addRuntimeLogEntry: (message) =>
    set((state) => ({
      runtimeLog: [
        { id: nextRuntimeLogId++, at: new Date().toISOString(), message },
        ...state.runtimeLog,
      ].slice(0, 300),
    })),
  setRuntimeError: (runtimeError) => set({ runtimeError }),
  setBackendHealth: (backendHealth) => set({ backendHealth }),
  setInstallPresenceMarker: (installPresenceMarker) =>
    set({ installPresenceMarker }),
  addToast: (toast) =>
    set((state) => ({
      toasts: [{ ...toast, id: nextToastId++ }, ...state.toasts].slice(0, 5),
    })),
  dismissToast: (toastId) =>
    set((state) => ({
      toasts: state.toasts.filter((toast) => toast.id !== toastId),
    })),
  addNotification: (notification) => {
    set((state) => ({
      notifications: [
        notification,
        ...state.notifications.filter((item) => item.id !== notification.id),
      ].slice(0, 100),
    }));
    persistSoon();
  },
  setDiscoveredReviewReminder: (discoveredReviewReminder) => {
    set({ discoveredReviewReminder });
    persistSoon();
  },
  dismissNotification: (notificationId) => {
    const now = new Date().toISOString();
    set((state) => {
      const reminderWasPresent =
        notificationId === DISCOVERED_REVIEW_REMINDER_ID &&
        state.notifications.some(
          (notification) => notification.id === DISCOVERED_REVIEW_REMINDER_ID,
        );
      return {
        notifications: state.notifications.filter(
          (notification) => notification.id !== notificationId,
        ),
        discoveredReviewReminder: reminderWasPresent
          ? anchorDiscoveredReviewReminder(state.discoveredReviewReminder, now)
          : state.discoveredReviewReminder,
      };
    });
    persistSoon();
  },
  clearNotifications: () => {
    const now = new Date().toISOString();
    set((state) => {
      const reminderWasPresent = state.notifications.some(
        (notification) => notification.id === DISCOVERED_REVIEW_REMINDER_ID,
      );
      return {
        notifications: [],
        discoveredReviewReminder: reminderWasPresent
          ? anchorDiscoveredReviewReminder(state.discoveredReviewReminder, now)
          : state.discoveredReviewReminder,
      };
    });
    persistSoon();
  },
  markAllNotificationsRead: () => {
    const now = new Date().toISOString();
    set((state) => {
      const reminder = state.notifications.find(
        (notification) => notification.id === DISCOVERED_REVIEW_REMINDER_ID,
      );
      return {
        notifications: state.notifications.map((notification) =>
          notification.readAt ? notification : { ...notification, readAt: now },
        ),
        discoveredReviewReminder:
          reminder && !reminder.readAt
            ? anchorDiscoveredReviewReminder(
                state.discoveredReviewReminder,
                now,
              )
            : state.discoveredReviewReminder,
      };
    });
    persistSoon();
  },
  rekeyGameSeconds: (from, to) =>
    set((state) => {
      if (from === to) return {};
      const archivedGameSeconds = { ...state.archivedGameSeconds };
      const playtimeAdjustments = { ...state.playtimeAdjustments };
      const move = (record: Record<string, number>) => {
        const seconds = record[from];
        if (seconds === undefined) return;
        const merged = (record[to] ?? 0) + seconds;
        if (merged === 0) delete record[to];
        else record[to] = merged;
        delete record[from];
      };
      move(archivedGameSeconds);
      move(playtimeAdjustments);
      return { archivedGameSeconds, playtimeAdjustments };
    }),
  setPlaytimeAdjustment: (key, seconds, clearKeys = []) =>
    set((state) => {
      const playtimeAdjustments = { ...state.playtimeAdjustments };
      for (const clearKey of clearKeys) delete playtimeAdjustments[clearKey];
      const normalized = Math.round(seconds);
      if (Number.isFinite(normalized) && normalized !== 0) {
        playtimeAdjustments[key] = normalized;
      }
      return { playtimeAdjustments };
    }),
  clearGameSeconds: (keys) =>
    set((state) => {
      const archivedGameSeconds = { ...state.archivedGameSeconds };
      const playtimeAdjustments = { ...state.playtimeAdjustments };
      let removedArchivedSeconds = 0;
      for (const key of new Set(keys)) {
        removedArchivedSeconds += Math.max(0, archivedGameSeconds[key] ?? 0);
        delete archivedGameSeconds[key];
        delete playtimeAdjustments[key];
      }
      return {
        archivedSeconds: Math.max(
          0,
          state.archivedSeconds - removedArchivedSeconds,
        ),
        archivedGameSeconds,
        playtimeAdjustments,
      };
    }),
  toggleSectionCollapsed: (sectionId) => {
    set((state) => ({
      collapsedSections: toggleCollapsedSection(
        state.collapsedSections,
        sectionId,
      ),
    }));
    persistSoon();
  },
  setCleanup: (cleanup) => set({ cleanup }),
  setLaunchOnStartup: (enabled) => {
    set((state) => ({
      settings: { ...state.settings, launchOnStartup: enabled },
    }));
    persistSoon();
  },
  setShowDurationDays: (enabled) => {
    set((state) => ({
      settings: { ...state.settings, showDurationDays: enabled },
    }));
    persistSoon();
  },
  setMyGamesCardSize: (libraryCardSize) => {
    set((state) => ({
      settings: { ...state.settings, libraryCardSize },
    }));
    persistSoon();
  },
  setMyGamesSortKey: (librarySortKey) => {
    set((state) => ({
      settings: { ...state.settings, librarySortKey },
    }));
    persistSoon();
  },
  setMyGamesShowBadges: (libraryShowBadges) => {
    set((state) => ({
      settings: { ...state.settings, libraryShowBadges },
    }));
    persistSoon();
  },
  setAutoShareIgnoredProcesses: (enabled) => {
    set((state) => ({
      settings: { ...state.settings, autoShareIgnoredProcesses: enabled },
    }));
    persistSoon();
  },
  setEmulatorSetting: (key, enabled) => {
    set((state) => ({ settings: { ...state.settings, [key]: enabled } }));
    persistSoon();
  },
  setDesktopOverlaySetting: (key, enabled) => {
    set((state) => ({ settings: { ...state.settings, [key]: enabled } }));
    persistSoon();
  },
  setLauncherSetting: (key, enabled) => {
    set((state) => {
      if (key === "rememberLaunchPaths") {
        if (enabled) {
          return {
            settings: { ...state.settings, rememberLaunchPaths: true },
          };
        }
        return {
          settings: {
            ...state.settings,
            rememberLaunchPaths: false,
            gameLaunchingEnabled: false,
            controllerNavigationEnabled: false,
          },
          launchTargets: new Map(),
          manualLaunchTargets: new Map(),
          emulatorAutoBinaries: new Map(),
          emulatorManualBinaries: new Map(),
          emulatorAutoLaunchTargets: new Map(),
          emulatorManualLaunchTargets: new Map(),
          emulatorLaunchCandidates: new Map(),
        };
      }
      const remembersPaths = state.settings.rememberLaunchPaths !== false;
      return {
        settings: {
          ...state.settings,
          [key]:
            key === "controllerNavigationEnabled" && enabled
              ? remembersPaths && state.settings.gameLaunchingEnabled === true
              : key === "gameLaunchingEnabled" && enabled
                ? remembersPaths
                : enabled,
          ...(key === "gameLaunchingEnabled" && !enabled
            ? { controllerNavigationEnabled: false }
            : {}),
        },
      };
    });
    persistSoon();
  },
  recordAutomaticDetection: (keys) => {
    const supplied = [...new Set(keys.filter(Boolean))];
    let isFirst = false;
    let changed = false;
    set((state) => {
      const known = new Set(state.autoDetectedGameKeys);
      isFirst = supplied.length > 0 && !supplied.some((key) => known.has(key));
      for (const key of supplied) {
        if (known.has(key)) continue;
        known.add(key);
        changed = true;
      }
      return changed ? { autoDetectedGameKeys: [...known] } : {};
    });
    if (changed) persistSoon();
    return isFirst;
  },
  carryAutoDetectedGameKey: (from, to) => {
    let changed = false;
    set((state) => {
      if (
        from === to ||
        !state.autoDetectedGameKeys.includes(from) ||
        state.autoDetectedGameKeys.includes(to)
      ) {
        return {};
      }
      changed = true;
      return { autoDetectedGameKeys: [...state.autoDetectedGameKeys, to] };
    });
    if (changed) persistSoon();
  },
  setEmulatorIgnoredSetting: (emulatorId, ignored) => {
    set((state) => {
      const key = emulatorId.trim().toLowerCase();
      const ignoredEmulatorIds = new Set(
        (state.settings.ignoredEmulatorIds ?? []).map((id) => id.toLowerCase()),
      );
      if (ignored) ignoredEmulatorIds.add(key);
      else ignoredEmulatorIds.delete(key);
      return {
        settings: {
          ...state.settings,
          ignoredEmulatorIds: [...ignoredEmulatorIds].sort(),
        },
      };
    });
    persistSoon();
  },
  setDevNumber: (key, value) => {
    set((state) => ({
      settings: { ...state.settings, [key]: Math.max(1, value) },
    }));
    persistSoon();
  },
  setApiEndpoint: (apiEndpoint) => {
    set((state) => ({ settings: { ...state.settings, apiEndpoint } }));
    persistSoon();
  },
  setTheme: (theme) => {
    set((state) => ({ settings: { ...state.settings, theme } }));
    applyTheme(theme, useAppStore.getState().settings.accentColor);
    persistSoon();
  },
  setAccentColor: (color) => {
    const accentColor = normalizeAccentColor(color);
    set((state) => ({ settings: { ...state.settings, accentColor } }));
    applyTheme(useAppStore.getState().settings.theme, accentColor);
    persistSoon();
  },
  toggleVerboseLogs: () => {
    set((state) => ({
      settings: { ...state.settings, verboseLogs: !state.settings.verboseLogs },
    }));
    persistSoon();
  },
  toggleBlacklist: (exeName, enabled) => {
    set((state) => {
      const blacklist = new Set(state.blacklist);
      const key = exeName.toLowerCase();
      if (enabled) blacklist.add(key);
      else blacklist.delete(key);
      return { blacklist };
    });
    persistSoon();
  },
  clearCache: () =>
    set({
      exeCache: new Map(),
      launchTargets: new Map(),
      gameMetadata: new Map(),
      libraryImports: new Map(),
      libraryInstalls: new Map(),
      scopedExeLinks: new Map(),
      emulatorObservations: [],
      emulatorMappings: new Map(),
      runtimeError: null,
    }),
}));

export function gameMetadataKey(game: Pick<GameMetadata, "id" | "source">) {
  return `${game.source}:${game.id}`;
}

export type GameIdentityRef = {
  gameId: number;
  source?: GameSource | null;
  igdbId?: number;
  gameName?: string;
  coverUrl?: string;
};

export type GameIdentityResolver = (
  gameId: number,
  source?: GameSource | null,
  gameName?: string,
) => number | null | undefined;

function normalizedIdentityText(value: string | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

function identityEvidenceConflicts(
  left: { gameName?: string; coverUrl?: string },
  right: { gameName?: string; coverUrl?: string },
) {
  const leftName = normalizedIdentityText(left.gameName);
  const rightName = normalizedIdentityText(right.gameName);
  if (!leftName || !rightName || leftName === rightName) return false;

  const leftCover = normalizedIdentityText(left.coverUrl);
  const rightCover = normalizedIdentityText(right.coverUrl);
  return !leftCover || !rightCover || leftCover !== rightCover;
}

// A server-side numeric id is only safe to reuse as identity evidence while
// the local and server metadata still describe the same game. This matters in
// test environments where resetting the database can issue an old id to a
// completely different game while desktop state survives the reset.
export function gameMetadataConflictsWithRef(
  metadata: Pick<GameMetadata, "name" | "coverUrl">,
  ref: Pick<GameIdentityRef, "gameName" | "coverUrl">,
) {
  return identityEvidenceConflicts(
    { gameName: metadata.name, coverUrl: metadata.coverUrl },
    ref,
  );
}

export function canonicalGameKey(ref: GameIdentityRef) {
  return ref.igdbId !== undefined
    ? `igdb#${ref.igdbId}`
    : `${ref.source ?? "unknown"}:${ref.gameId}`;
}

export function createGameIdentityResolver(
  gameMetadata: ReadonlyMap<string, GameMetadata>,
  exeCache: ReadonlyMap<string, ExeCacheEntry>,
  libraryImports: ReadonlyMap<string, LibraryImportEntry> = new Map(),
): GameIdentityResolver {
  type IdentityEvidence = {
    igdbId?: number;
    gameName?: string;
    coverUrl?: string;
  };
  const evidenceByPair = new Map<string, IdentityEvidence[]>();
  const byPair = new Map<string, Set<number>>();
  const byId = new Map<number, Set<number>>();
  const add = (
    gameId: number | undefined,
    source: GameSource | null | undefined,
    igdbId: number | undefined,
    gameName?: string,
    coverUrl?: string,
  ) => {
    if (gameId === undefined) return;
    const pair = `${source ?? "unknown"}:${gameId}`;
    const evidence = evidenceByPair.get(pair) ?? [];
    evidence.push({ igdbId, gameName, coverUrl });
    evidenceByPair.set(pair, evidence);
    if (igdbId === undefined) return;
    const pairIds = byPair.get(pair) ?? new Set<number>();
    pairIds.add(igdbId);
    byPair.set(pair, pairIds);
    const ids = byId.get(gameId) ?? new Set<number>();
    ids.add(igdbId);
    byId.set(gameId, ids);
  };

  for (const game of gameMetadata.values()) {
    add(game.id, game.source, game.igdbId, game.name, game.coverUrl);
  }
  for (const entry of exeCache.values()) {
    if (entry.state === "matched") {
      add(
        entry.gameId,
        entry.source,
        entry.igdbId,
        entry.gameName,
        entry.coverUrl,
      );
    }
  }
  for (const entry of libraryImports.values()) {
    add(entry.gameId, entry.source, entry.igdbId, entry.name, entry.coverUrl);
  }

  const conflictedPairs = new Set<string>();
  for (const [pair, evidence] of evidenceByPair) {
    if ((byPair.get(pair)?.size ?? 0) > 1) {
      conflictedPairs.add(pair);
      continue;
    }
    if (
      evidence.some((left, index) =>
        evidence
          .slice(index + 1)
          .some((right) => identityEvidenceConflicts(left, right)),
      )
    ) {
      conflictedPairs.add(pair);
    }
  }
  const conflictedIds = new Set(
    [...conflictedPairs].map((pair) =>
      Number(pair.slice(pair.lastIndexOf(":") + 1)),
    ),
  );

  const evidenceMatchesName = (pair: string, gameName: string | undefined) => {
    const expectedName = normalizedIdentityText(gameName);
    if (!expectedName) return true;
    const knownNames = (evidenceByPair.get(pair) ?? [])
      .map((evidence) => normalizedIdentityText(evidence.gameName))
      .filter(Boolean);
    return knownNames.length === 0 || knownNames.includes(expectedName);
  };

  return (gameId, source, gameName) => {
    const pair = `${source ?? "unknown"}:${gameId}`;
    if (conflictedPairs.has(pair)) return null;
    const exact = byPair.get(pair);
    if (exact?.size === 1) {
      return evidenceMatchesName(pair, gameName) ? [...exact][0] : null;
    }
    if (exact && exact.size > 1) return null;
    if (source) return undefined;
    if (conflictedIds.has(gameId)) return null;
    const candidates = byId.get(gameId);
    if (candidates?.size !== 1) return undefined;
    if (gameName) {
      const matchingPair = [...evidenceByPair.keys()].some(
        (candidate) =>
          candidate.endsWith(`:${gameId}`) &&
          evidenceMatchesName(candidate, gameName),
      );
      if (!matchingPair) return null;
    }
    return [...candidates][0];
  };
}

export function resolvedCanonicalGameKey(
  ref: GameIdentityRef,
  resolveIgdbId?: GameIdentityResolver,
) {
  const resolvedIgdbId = resolveIgdbId?.(ref.gameId, ref.source, ref.gameName);
  return canonicalGameKey({
    ...ref,
    // null means the resolver found contradictory metadata for this local
    // pair. In that case even a previously stamped id is unsafe and the
    // source/id pair remains isolated until authoritative data repairs it.
    igdbId:
      resolvedIgdbId === null
        ? undefined
        : (ref.igdbId ?? resolvedIgdbId ?? undefined),
  });
}

export function autoDetectionKeys(
  ref: GameIdentityRef,
  resolveIgdbId?: GameIdentityResolver,
) {
  return [
    ...new Set([
      resolvedCanonicalGameKey(ref, resolveIgdbId),
      `${ref.source ?? "unknown"}:${ref.gameId}`,
    ]),
  ];
}

export function useIsOffline() {
  return useAppStore((state) => isOfflineStatus(state.backendHealth.status));
}

export function isOfflineStatus(status: BackendHealthStatus) {
  return status === "offline" || status === "reconnecting";
}
