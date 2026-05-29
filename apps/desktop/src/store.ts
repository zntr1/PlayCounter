import type {
  Game,
  GameSource,
  LiveEntry,
  Session,
  Settings,
} from "@playcounter/shared";
import { create } from "zustand";

export type ViewId =
  | "now"
  | "games"
  | "discovered"
  | "live"
  | "history"
  | "settings"
  | "dev";

export type ProcessSnapshot = {
  exeName: string;
  exePath: string | null;
};

export type ActiveSession = {
  id: number;
  gameId: number;
  gameName: string;
  exeName: string;
  coverUrl: string;
  source?: GameSource;
  communitySuggestionId?: number;
  communitySuggestionVerified?: boolean;
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
};

export type GameMetadata = {
  id: number;
  name: string;
  coverUrl: string;
  source: Exclude<GameSource, "custom">;
};

export type ExeCacheEntry = {
  exeName: string;
  state: "matched" | "unmatched" | "blacklisted";
  gameId?: number;
  gameName?: string;
  coverUrl?: string;
  source?: GameSource;
  pendingCommunityGame?: Game;
  communitySuggestionId?: number;
  communitySuggestionVerified?: boolean;
  communityUpgradeGame?: Game;
  dismissedCommunityUpgradeGameId?: number;
  lastCheckedAt: string;
};

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
  title: string;
  detail?: string;
};

type AppState = {
  activeView: ViewId;
  historyQuery: string;
  installUuid: string | null;
  activeSessions: ActiveSession[];
  ambiguousMatches: AmbiguousProcessMatch[];
  recentSessions: Session[];
  liveEntries: LiveEntry[];
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
  cleanup: (() => void) | null;
  settings: Settings;
  setActiveView: (view: ViewId) => void;
  setHistoryQuery: (query: string) => void;
  setInstallUuid: (installUuid: string) => void;
  setActiveSessions: (sessions: ActiveSession[]) => void;
  setAmbiguousMatch: (match: AmbiguousProcessMatch) => void;
  removeAmbiguousMatch: (exeName: string) => void;
  addSession: (session: Session) => void;
  setLiveEntries: (entries: LiveEntry[]) => void;
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
  setCleanup: (cleanup: () => void) => void;
  setShareAnonymousLiveData: (enabled: boolean) => void;
  setLaunchOnStartup: (enabled: boolean) => void;
  setDevNumber: (
    key:
      | "pollingIntervalSeconds"
      | "heartbeatIntervalSeconds"
      | "unmatchedRetryDays",
    value: number,
  ) => void;
  setApiEndpoint: (value: string) => void;
  toggleVerboseLogs: () => void;
  toggleBlacklist: (exeName: string, enabled: boolean) => void;
  clearCache: () => void;
};

export const DEFAULT_API_ENDPOINT =
  import.meta.env.VITE_PLAYCOUNTER_API_URL ?? "http://localhost:4000";

export type Stage = "local" | "test" | "prod";

export const BUILD_STAGE: Stage =
  (import.meta.env.VITE_PLAYCOUNTER_STAGE as Stage | undefined) ?? "local";

const defaultSettings: Settings = {
  shareAnonymousLiveData: true,
  launchOnStartup: true,
  pollingIntervalSeconds: 5,
  heartbeatIntervalSeconds: 60,
  unmatchedRetryDays: 30,
  apiEndpoint: DEFAULT_API_ENDPOINT,
  verboseLogs: false,
};

let nextRuntimeLogId = 0;
let nextToastId = 0;

function persistSoon() {
  queueMicrotask(() => {
    const state = useAppStore.getState();
    localStorage.setItem(
      "playcounter:v1",
      JSON.stringify({
        installUuid: state.installUuid ?? undefined,
        settings: state.settings,
        exeCache: [...state.exeCache.values()],
        gameMetadata: [...state.gameMetadata.values()],
        sessions: state.recentSessions,
        activeSessions: state.activeSessions,
        blacklist: [...state.blacklist],
      }),
    );
  });
}

export const useAppStore = create<AppState>((set) => ({
  activeView: "now",
  historyQuery: "",
  installUuid: null,
  activeSessions: [],
  ambiguousMatches: [],
  recentSessions: [],
  liveEntries: [],
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
  cleanup: null,
  settings: defaultSettings,
  setActiveView: (activeView) => set({ activeView }),
  setHistoryQuery: (historyQuery) => set({ historyQuery }),
  setInstallUuid: (installUuid) => set({ installUuid }),
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
    set((state) => ({
      recentSessions: [session, ...state.recentSessions].slice(0, 500),
    })),
  setLiveEntries: (liveEntries) => set({ liveEntries }),
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
      toasts: [{ ...toast, id: nextToastId++ }],
    })),
  dismissToast: (toastId) =>
    set((state) => ({
      toasts: state.toasts.filter((toast) => toast.id !== toastId),
    })),
  setCleanup: (cleanup) => set({ cleanup }),
  setShareAnonymousLiveData: (enabled) => {
    set((state) => ({
      settings: { ...state.settings, shareAnonymousLiveData: enabled },
    }));
    persistSoon();
  },
  setLaunchOnStartup: (enabled) => {
    set((state) => ({
      settings: { ...state.settings, launchOnStartup: enabled },
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

export function useIsOffline() {
  return useAppStore(
    (state) =>
      state.backendHealth.status === "offline" ||
      state.backendHealth.status === "reconnecting",
  );
}
