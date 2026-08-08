import type { Session, Settings } from "@playcounter/shared";
import { normalizeSessions } from "./sessionPersistence";

export const STORAGE_KEY = "playcounter:v1";

type PersistableAppState = {
  installUuid: string | null;
  settings: Settings;
  exeCache: ReadonlyMap<string, unknown>;
  gameMetadata: ReadonlyMap<string, unknown>;
  recentSessions: Session[];
  activeSessions: unknown[];
  ambiguousMatches: unknown[];
  blacklist: ReadonlySet<string>;
};

export type PersistedPayload = {
  installUuid?: string;
  settings: Settings;
  exeCache: unknown[];
  gameMetadata: unknown[];
  sessions: Session[];
  activeSessions: unknown[];
  ambiguousMatches: unknown[];
  blacklist: string[];
};

export type PersistResult =
  | { status: "saved"; sessions: Session[] }
  | {
      status: "trimmed";
      sessions: Session[];
      removed: Session[];
    }
  | { status: "failed"; error: unknown; sessions: Session[] };

export function createPersistedPayload(
  state: PersistableAppState,
): PersistedPayload {
  return {
    installUuid: state.installUuid ?? undefined,
    settings: state.settings,
    exeCache: [...state.exeCache.values()],
    gameMetadata: [...state.gameMetadata.values()],
    sessions: normalizeSessions([...state.recentSessions]),
    activeSessions: state.activeSessions,
    ambiguousMatches: state.ambiguousMatches,
    blacklist: [...state.blacklist],
  };
}

function isQuotaExceeded(error: unknown) {
  return (
    error instanceof DOMException &&
    (error.name === "QuotaExceededError" || error.code === 22)
  );
}

export function persistAppState(state: PersistableAppState): PersistResult {
  const payload = createPersistedPayload(state);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    return { status: "saved", sessions: payload.sessions };
  } catch (error) {
    if (!isQuotaExceeded(error) || payload.sessions.length === 0) {
      return { status: "failed", error, sessions: payload.sessions };
    }

    const removeCount = Math.max(1, Math.ceil(payload.sessions.length * 0.1));
    const sessions = payload.sessions.slice(0, -removeCount);
    const removed = payload.sessions.slice(-removeCount);
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ ...payload, sessions }),
      );
      return { status: "trimmed", sessions, removed };
    } catch (retryError) {
      return {
        status: "failed",
        error: retryError,
        sessions: payload.sessions,
      };
    }
  }
}

export function readPersistedRecord(
  onParseError?: () => void,
): Record<string, unknown> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Record<
      string,
      unknown
    >;
  } catch {
    onParseError?.();
    return {};
  }
}

export function writePersistedRecord(data: Record<string, unknown>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}
