import type {
  Game,
  GameSource,
  Session,
  Settings,
  Theme,
} from "@playcounter/shared";
import { create } from "zustand";
import { filterPersistableSessions } from "./sessionPersistence";
import { applyTheme, normalizeAccentColor } from "./theme";

export type ViewId =
  | "now"
  | "games"
  | "discovered"
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
  // When the candidates were last fetched; gates re-querying the match API.
  lastCheckedAt?: string;
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
  import.meta.env.VITE_PLAYCOUNTER_API_URL ?? "http://localhost:4000";

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
        sessions: filterPersistableSessions(state.recentSessions),
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
      recentSessions: filterPersistableSessions([
        session,
        ...state.recentSessions,
      ]).slice(0, 500),
    })),
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

export function useIsOffline() {
  return useAppStore(
    (state) =>
      state.backendHealth.status === "offline" ||
      state.backendHealth.status === "reconnecting",
  );
}
