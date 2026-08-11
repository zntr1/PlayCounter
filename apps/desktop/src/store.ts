import type {
  ContributionStatus,
  Game,
  GameSource,
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
import type { AppNotification, ContributionCounts } from "./notifications";
import type { AwardedMilestone } from "./milestones";
import { EMPTY_CONTRIBUTION_COUNTS } from "./notifications";
import { persistAppState } from "./persistence";
import { toggleCollapsedSection } from "./sectionCollapse";
import { splitStoredSessions } from "./sessionPersistence";
import { applyTheme, normalizeAccentColor } from "./theme";

export type ViewId =
  | "now"
  | "games"
  | "discovered"
  | "history"
  | "achievements"
  | "settings"
  | "dev";

export type ProcessSnapshot = {
  exeName: string;
  exePath: string | null;
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
};

export type AmbiguousProcessMatch = {
  exeName: string;
  exePath: string | null;
  candidates: Game[];
  detectedAt: string;
  endedAt?: string;
  // When the candidates were last fetched; gates re-querying the match API.
  lastCheckedAt?: string;
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
  pendingCommunityGame?: Game;
  communitySuggestionId?: number;
  communitySuggestionVerified?: boolean;
  communitySuggestionStatus?: ContributionStatus;
  communitySuggestionNote?: string;
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

type AppState = {
  activeView: ViewId;
  historyQuery: string;
  historyGameKey: string | null;
  installUuid: string | null;
  contributionOwnerUuid: string | null;
  activeSessions: ActiveSession[];
  ambiguousMatches: AmbiguousProcessMatch[];
  recentSessions: Session[];
  gameMetadata: Map<string, GameMetadata>;
  processes: ProcessSnapshot[];
  lastProcessScanAt: string | null;
  lastProcessScanError: string | null;
  ignoredProcesses: Set<string>;
  userIgnoredProcesses: Set<string>;
  userIgnoredProcessesPath: string | null;
  exeCache: Map<string, ExeCacheEntry>;
  apiRequestLog: ApiRequestLogEntry[];
  runtimeLog: RuntimeLogEntry[];
  blacklist: Set<string>;
  runtimeError: string | null;
  backendHealth: BackendHealth;
  toasts: Toast[];
  notifications: AppNotification[];
  discoveredReviewReminder: DiscoveredReviewReminder;
  seenContributionStatus: Record<string, ContributionStatus>;
  contributionCounts: ContributionCounts;
  awardedMilestones: AwardedMilestone[];
  milestonesInitializedAt: string | null;
  archivedSeconds: number;
  archivedGameSeconds: Record<string, number>;
  playtimeAdjustments: Record<string, number>;
  collapsedSections: string[];
  cleanup: (() => void) | null;
  settings: Settings;
  setActiveView: (view: ViewId) => void;
  setHistoryQuery: (query: string) => void;
  setHistoryGameKey: (key: string | null) => void;
  adoptInstallIdentity: (installUuid: string) => void;
  setActiveSessions: (sessions: ActiveSession[]) => void;
  setAmbiguousMatch: (match: AmbiguousProcessMatch) => void;
  removeAmbiguousMatch: (exeName: string) => void;
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
  addApiRequestLogEntry: (entry: Omit<ApiRequestLogEntry, "id" | "at">) => void;
  addRuntimeLogEntry: (message: string) => void;
  setRuntimeError: (error: string | null) => void;
  setBackendHealth: (health: BackendHealth) => void;
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
  pollingIntervalSeconds: 5,
  unmatchedRetryDays: 30,
  apiEndpoint: DEFAULT_API_ENDPOINT,
  verboseLogs: false,
  theme: "dark",
  accentColor: null,
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

export const useAppStore = create<AppState>((set) => ({
  activeView: "now",
  historyQuery: "",
  historyGameKey: null,
  installUuid: null,
  contributionOwnerUuid: null,
  activeSessions: [],
  ambiguousMatches: [],
  recentSessions: [],
  gameMetadata: new Map(),
  processes: [],
  lastProcessScanAt: null,
  lastProcessScanError: null,
  ignoredProcesses: new Set(),
  userIgnoredProcesses: new Set(),
  userIgnoredProcessesPath: null,
  exeCache: new Map(),
  apiRequestLog: [],
  runtimeLog: [],
  blacklist: new Set(),
  runtimeError: null,
  backendHealth: { status: "checking", checkedAt: null, detail: null },
  toasts: [],
  notifications: [],
  discoveredReviewReminder: null,
  seenContributionStatus: {},
  contributionCounts: EMPTY_CONTRIBUTION_COUNTS,
  awardedMilestones: [],
  milestonesInitializedAt: null,
  archivedSeconds: 0,
  archivedGameSeconds: {},
  playtimeAdjustments: {},
  collapsedSections: [],
  cleanup: null,
  settings: defaultSettings,
  setActiveView: (activeView) => set({ activeView }),
  setHistoryQuery: (historyQuery) => set({ historyQuery }),
  setHistoryGameKey: (historyGameKey) => set({ historyGameKey }),
  adoptInstallIdentity: (installUuid) =>
    set((state) => {
      if (state.contributionOwnerUuid === installUuid) {
        return { installUuid, contributionOwnerUuid: installUuid };
      }
      return {
        installUuid,
        contributionOwnerUuid: installUuid,
        seenContributionStatus: {},
        contributionCounts: EMPTY_CONTRIBUTION_COUNTS,
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
      return { exeCache };
    }),
  removeExeCacheEntry: (exeName) =>
    set((state) => {
      const exeCache = new Map(state.exeCache);
      exeCache.delete(exeName.toLowerCase());
      return { exeCache };
    }),
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
  clearCache: () => set({ exeCache: new Map(), runtimeError: null }),
}));

export function gameMetadataKey(game: Pick<GameMetadata, "id" | "source">) {
  return `${game.source}:${game.id}`;
}

export type GameIdentityRef = {
  gameId: number;
  source?: GameSource | null;
  igdbId?: number;
};

export type GameIdentityResolver = (
  gameId: number,
  source?: GameSource | null,
) => number | undefined;

export function canonicalGameKey(ref: GameIdentityRef) {
  return ref.igdbId !== undefined
    ? `igdb#${ref.igdbId}`
    : `${ref.source ?? "unknown"}:${ref.gameId}`;
}

export function createGameIdentityResolver(
  gameMetadata: ReadonlyMap<string, GameMetadata>,
  exeCache: ReadonlyMap<string, ExeCacheEntry>,
): GameIdentityResolver {
  const byPair = new Map<string, number>();
  const byId = new Map<number, Set<number>>();
  const add = (
    gameId: number | undefined,
    source: GameSource | null | undefined,
    igdbId: number | undefined,
  ) => {
    if (gameId === undefined || igdbId === undefined) return;
    byPair.set(`${source ?? "unknown"}:${gameId}`, igdbId);
    const ids = byId.get(gameId) ?? new Set<number>();
    ids.add(igdbId);
    byId.set(gameId, ids);
  };

  for (const game of gameMetadata.values()) {
    add(game.id, game.source, game.igdbId);
  }
  for (const entry of exeCache.values()) {
    if (entry.state === "matched") {
      add(entry.gameId, entry.source, entry.igdbId);
    }
  }

  return (gameId, source) => {
    const exact = byPair.get(`${source ?? "unknown"}:${gameId}`);
    if (exact !== undefined) return exact;
    if (source) return undefined;
    const candidates = byId.get(gameId);
    return candidates?.size === 1 ? [...candidates][0] : undefined;
  };
}

export function resolvedCanonicalGameKey(
  ref: GameIdentityRef,
  resolveIgdbId?: GameIdentityResolver,
) {
  return canonicalGameKey({
    ...ref,
    igdbId: ref.igdbId ?? resolveIgdbId?.(ref.gameId, ref.source) ?? undefined,
  });
}

export function useIsOffline() {
  return useAppStore((state) => isOfflineStatus(state.backendHealth.status));
}

export function isOfflineStatus(status: BackendHealthStatus) {
  return status === "offline" || status === "reconnecting";
}
