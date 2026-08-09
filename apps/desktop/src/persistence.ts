import type {
  ContributionStatus,
  Session,
  Settings,
} from "@playcounter/shared";
import type { AppNotification, ContributionCounts } from "./notifications";
import { normalizeSessions } from "./sessionPersistence";

export const STORAGE_KEY = "playcounter:v1";
export const MAX_STORED_NOTIFICATIONS = 100;

type PersistableAppState = {
  installUuid: string | null;
  contributionOwnerUuid: string | null;
  settings: Settings;
  exeCache: ReadonlyMap<string, unknown>;
  gameMetadata: ReadonlyMap<string, unknown>;
  recentSessions: Session[];
  activeSessions: unknown[];
  ambiguousMatches: unknown[];
  blacklist: ReadonlySet<string>;
  notifications: AppNotification[];
  seenContributionStatus: Record<string, ContributionStatus>;
  contributionCounts: ContributionCounts;
  awardedMilestoneIds: string[];
  milestonesInitializedAt: string | null;
  archivedSeconds: number;
  archivedGameSeconds: Record<string, number>;
};

export type PersistedPayload = {
  installUuid?: string;
  contributionOwnerUuid?: string;
  settings: Settings;
  exeCache: unknown[];
  gameMetadata: unknown[];
  sessions: Session[];
  activeSessions: unknown[];
  ambiguousMatches: unknown[];
  blacklist: string[];
  notifications: AppNotification[];
  seenContributionStatus: Record<string, ContributionStatus>;
  contributionCounts: ContributionCounts;
  awardedMilestoneIds: string[];
  milestonesInitializedAt?: string;
  archivedSeconds: number;
  archivedGameSeconds: Record<string, number>;
};

export type PersistedProjection = Pick<
  PersistedPayload,
  "sessions" | "notifications" | "archivedSeconds" | "archivedGameSeconds"
>;

export type PersistResult =
  | ({ status: "saved" } & PersistedProjection)
  | ({
      status: "trimmed";
      removed: Session[];
      droppedNotifications: number;
    } & PersistedProjection)
  | ({ status: "failed"; error: unknown } & PersistedProjection);

export function createPersistedPayload(
  state: PersistableAppState,
): PersistedPayload {
  return {
    installUuid: state.installUuid ?? undefined,
    contributionOwnerUuid: state.contributionOwnerUuid ?? undefined,
    settings: state.settings,
    exeCache: [...state.exeCache.values()],
    gameMetadata: [...state.gameMetadata.values()],
    sessions: normalizeSessions([...state.recentSessions]),
    activeSessions: state.activeSessions,
    ambiguousMatches: state.ambiguousMatches,
    blacklist: [...state.blacklist],
    notifications: state.notifications.slice(0, MAX_STORED_NOTIFICATIONS),
    seenContributionStatus: state.seenContributionStatus,
    contributionCounts: state.contributionCounts,
    awardedMilestoneIds: state.awardedMilestoneIds,
    milestonesInitializedAt: state.milestonesInitializedAt ?? undefined,
    archivedSeconds: state.archivedSeconds,
    archivedGameSeconds: state.archivedGameSeconds,
  };
}

function isQuotaExceeded(error: unknown) {
  return (
    error instanceof DOMException &&
    (error.name === "QuotaExceededError" || error.code === 22)
  );
}

function projection(payload: PersistedPayload): PersistedProjection {
  return {
    sessions: payload.sessions,
    notifications: payload.notifications,
    archivedSeconds: payload.archivedSeconds,
    archivedGameSeconds: payload.archivedGameSeconds,
  };
}

function archiveRemovedSessions(payload: PersistedPayload, removed: Session[]) {
  const archivedGameSeconds = { ...payload.archivedGameSeconds };
  let archivedSeconds = payload.archivedSeconds;
  for (const session of removed) {
    const seconds = Math.max(0, session.durationSeconds ?? 0);
    archivedSeconds += seconds;
    const key = `${session.source ?? "unknown"}:${session.gameId}`;
    archivedGameSeconds[key] = (archivedGameSeconds[key] ?? 0) + seconds;
  }
  return { archivedSeconds, archivedGameSeconds };
}

export function persistAppState(state: PersistableAppState): PersistResult {
  const payload = createPersistedPayload(state);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    return { status: "saved", ...projection(payload) };
  } catch (error) {
    if (!isQuotaExceeded(error)) {
      return { status: "failed", error, ...projection(payload) };
    }

    const withoutNotifications = { ...payload, notifications: [] };
    if (payload.notifications.length > 0) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(withoutNotifications));
        return {
          status: "trimmed",
          removed: [],
          droppedNotifications: payload.notifications.length,
          ...projection(withoutNotifications),
        };
      } catch (notificationRetryError) {
        if (!isQuotaExceeded(notificationRetryError)) {
          return {
            status: "failed",
            error: notificationRetryError,
            ...projection(payload),
          };
        }
      }
    }

    if (payload.sessions.length === 0) {
      return { status: "failed", error, ...projection(payload) };
    }

    const removeCount = Math.max(1, Math.ceil(payload.sessions.length * 0.1));
    const sessions = payload.sessions.slice(0, -removeCount);
    const removed = payload.sessions.slice(-removeCount);
    const archive = archiveRemovedSessions(payload, removed);
    const trimmedPayload = {
      ...withoutNotifications,
      ...archive,
      sessions,
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmedPayload));
      return {
        status: "trimmed",
        removed,
        droppedNotifications: payload.notifications.length,
        ...projection(trimmedPayload),
      };
    } catch (retryError) {
      return {
        status: "failed",
        error: retryError,
        ...projection(payload),
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
