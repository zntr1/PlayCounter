import type {
  ContributionCounts,
  ContributionStatus,
  Session,
  Settings,
} from "@playcounter/shared";
import type { AppNotification } from "./notifications";
import type { DiscoveredReviewReminder } from "./discoveredReminder";
import type { AwardedMilestone } from "./milestones";
import { gameSecondsKey } from "./gameSeconds";
import { normalizeSessions } from "./sessionPersistence";
import type {
  EmulatorMapping,
  EmulatorObservation,
  KnownEmulator,
} from "./emulators/types";
import { defaultTourProgress, type TourProgress } from "./ui/tour/tourState";

export const STORAGE_KEY = "playcounter:v1";
export const MAX_STORED_NOTIFICATIONS = 100;

type PersistableAppState = {
  installUuid: string | null;
  contributionOwnerUuid: string | null;
  settings: Settings;
  exeCache: ReadonlyMap<string, unknown>;
  launchTargets?: ReadonlyMap<string, unknown>;
  manualLaunchTargets?: ReadonlyMap<string, unknown>;
  emulatorAutoBinaries?: ReadonlyMap<string, unknown>;
  emulatorManualBinaries?: ReadonlyMap<string, unknown>;
  emulatorAutoLaunchTargets?: ReadonlyMap<string, unknown>;
  emulatorManualLaunchTargets?: ReadonlyMap<string, unknown>;
  emulatorLaunchCandidates?: ReadonlyMap<string, unknown>;
  gameMetadata: ReadonlyMap<string, unknown>;
  libraryImports?: ReadonlyMap<string, unknown>;
  libraryInstalls?: ReadonlyMap<string, unknown>;
  scopedExeLinks?: ReadonlyMap<string, unknown>;
  recentSessions: Session[];
  activeSessions: unknown[];
  ambiguousMatches: unknown[];
  emulatorMappings?: ReadonlyMap<string, EmulatorMapping>;
  emulatorObservations?: EmulatorObservation[];
  knownEmulators?: ReadonlyMap<string, KnownEmulator>;
  blacklist: ReadonlySet<string>;
  notifications: AppNotification[];
  discoveredReviewReminder: DiscoveredReviewReminder;
  seenContributionStatus: Record<string, ContributionStatus>;
  contributionCounts: ContributionCounts;
  emulatorContributionCounts?: ContributionCounts;
  awardedMilestones: AwardedMilestone[];
  milestonesInitializedAt: string | null;
  archivedSeconds: number;
  archivedGameSeconds: Record<string, number>;
  playtimeAdjustments: Record<string, number>;
  collapsedSections: string[];
  autoDetectedGameKeys: string[];
  tourProgress?: TourProgress;
  lastSeenReleaseNotesVersion: string | null;
  suppressStartupNotificationsOnce?: boolean;
  suppressContributionNotificationsOnce?: boolean;
};

export type PersistedPayload = {
  installUuid?: string;
  contributionOwnerUuid?: string;
  settings: Settings;
  exeCache: unknown[];
  launchTargets?: unknown[];
  manualLaunchTargets?: unknown[];
  emulatorAutoBinaries?: unknown[];
  emulatorManualBinaries?: unknown[];
  emulatorAutoLaunchTargets?: unknown[];
  emulatorManualLaunchTargets?: unknown[];
  emulatorLaunchCandidates?: unknown[];
  gameMetadata: unknown[];
  libraryImports?: unknown[];
  libraryInstalls?: unknown[];
  scopedExeLinks?: unknown[];
  sessions: Session[];
  activeSessions: unknown[];
  ambiguousMatches: unknown[];
  emulatorMappings?: EmulatorMapping[];
  emulatorObservations?: EmulatorObservation[];
  knownEmulators?: KnownEmulator[];
  blacklist: string[];
  notifications: AppNotification[];
  discoveredReviewReminder?: DiscoveredReviewReminder;
  seenContributionStatus: Record<string, ContributionStatus>;
  contributionCounts: ContributionCounts;
  emulatorContributionCounts?: ContributionCounts;
  awardedMilestones?: AwardedMilestone[];
  awardedMilestoneIds: string[];
  milestonesInitializedAt?: string;
  archivedSeconds: number;
  archivedGameSeconds: Record<string, number>;
  playtimeAdjustments: Record<string, number>;
  collapsedSections?: string[];
  autoDetectedGameKeys?: string[];
  tours?: TourProgress;
  lastSeenReleaseNotesVersion?: string;
  suppressStartupNotificationsOnce?: boolean;
  suppressContributionNotificationsOnce?: boolean;
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
  return buildPersistedPayload(state, normalizeSessions(state.recentSessions));
}

function buildPersistedPayload(
  state: PersistableAppState,
  sessions: Session[],
): PersistedPayload {
  return {
    installUuid: state.installUuid ?? undefined,
    contributionOwnerUuid: state.contributionOwnerUuid ?? undefined,
    settings: state.settings,
    exeCache: [...state.exeCache.values()],
    launchTargets: [...(state.launchTargets?.values() ?? [])],
    manualLaunchTargets: [...(state.manualLaunchTargets?.values() ?? [])],
    emulatorAutoBinaries: [...(state.emulatorAutoBinaries?.values() ?? [])],
    emulatorManualBinaries: [...(state.emulatorManualBinaries?.values() ?? [])],
    emulatorAutoLaunchTargets: [
      ...(state.emulatorAutoLaunchTargets?.values() ?? []),
    ],
    emulatorManualLaunchTargets: [
      ...(state.emulatorManualLaunchTargets?.values() ?? []),
    ],
    emulatorLaunchCandidates: [
      ...(state.emulatorLaunchCandidates?.values() ?? []),
    ],
    gameMetadata: [...state.gameMetadata.values()],
    libraryImports: [...(state.libraryImports?.values() ?? [])],
    libraryInstalls: [...(state.libraryInstalls?.values() ?? [])],
    scopedExeLinks: [...(state.scopedExeLinks?.values() ?? [])],
    sessions,
    activeSessions: state.activeSessions,
    ambiguousMatches: state.ambiguousMatches,
    emulatorMappings: [...(state.emulatorMappings?.values() ?? [])],
    knownEmulators: [...(state.knownEmulators?.values() ?? [])],
    emulatorObservations: (state.emulatorObservations ?? []).filter(
      (observation) =>
        observation.kind === "host-notice"
          ? Boolean(observation.dismissedAt)
          : observation.state !== "resolving" ||
            Boolean(observation.trackedSeconds),
    ),
    blacklist: [...state.blacklist],
    notifications: state.notifications.slice(0, MAX_STORED_NOTIFICATIONS),
    discoveredReviewReminder: state.discoveredReviewReminder ?? undefined,
    seenContributionStatus: state.seenContributionStatus,
    contributionCounts: state.contributionCounts,
    emulatorContributionCounts: state.emulatorContributionCounts ?? {
      suggested: 0,
      verified: 0,
      pending: 0,
      rejected: 0,
    },
    awardedMilestones: state.awardedMilestones,
    awardedMilestoneIds: [
      ...new Set(
        state.awardedMilestones.flatMap((milestone) => [
          milestone.id,
          ...(milestone.aliasIds ?? []),
        ]),
      ),
    ],
    milestonesInitializedAt: state.milestonesInitializedAt ?? undefined,
    archivedSeconds: state.archivedSeconds,
    archivedGameSeconds: state.archivedGameSeconds,
    playtimeAdjustments: state.playtimeAdjustments,
    collapsedSections: state.collapsedSections,
    autoDetectedGameKeys: [...new Set(state.autoDetectedGameKeys)],
    tours: state.tourProgress ?? defaultTourProgress(),
    lastSeenReleaseNotesVersion: state.lastSeenReleaseNotesVersion ?? undefined,
    suppressStartupNotificationsOnce:
      state.suppressStartupNotificationsOnce || undefined,
    suppressContributionNotificationsOnce:
      state.suppressContributionNotificationsOnce || undefined,
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
    const key = gameSecondsKey(session);
    archivedGameSeconds[key] = (archivedGameSeconds[key] ?? 0) + seconds;
  }
  return { archivedSeconds, archivedGameSeconds };
}

type EncodedField = { value: unknown; json: string | undefined };
type PersistenceCache = {
  sessionsInput?: Session[];
  sessions?: Session[];
  fields?: Map<string, EncodedField>;
};

// Store collections and their entries are immutable. Keep only the latest
// projection per storage instance, so scans can reuse unchanged history and
// field encodings without retaining older versions of the application state.
const persistenceCaches = new WeakMap<Storage, PersistenceCache>();

function samePersistedValue(left: unknown, right: unknown): boolean {
  return (
    Object.is(left, right) ||
    (Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => Object.is(value, right[index])))
  );
}

function writePayload(
  storage: Storage,
  cache: PersistenceCache,
  payload: PersistedPayload,
) {
  const fields = new Map<string, EncodedField>();
  let changed = !cache.fields;
  for (const [key, value] of Object.entries(payload)) {
    const previous = cache.fields?.get(key);
    const json =
      previous && samePersistedValue(previous.value, value)
        ? previous.json
        : JSON.stringify(value);
    fields.set(key, { value, json });
    if (!previous || previous.json !== json) changed = true;
  }
  if (cache.fields?.size !== fields.size) changed = true;
  if (changed) {
    const serialized = `{${[...fields]
      .filter(([, field]) => field.json !== undefined)
      .map(([key, field]) => `${JSON.stringify(key)}:${field.json}`)
      .join(",")}}`;
    storage.setItem(STORAGE_KEY, serialized);
  }
  // Only successful writes become the baseline. A failed save must be retried
  // even when the next scan supplies exactly the same state.
  cache.fields = fields;
}

export function persistAppState(state: PersistableAppState): PersistResult {
  // Accessing localStorage itself can throw when storage is unavailable.
  let storage: Storage;
  try {
    storage = localStorage;
  } catch (error) {
    return {
      status: "failed",
      error,
      ...projection(createPersistedPayload(state)),
    };
  }
  let cache = persistenceCaches.get(storage);
  if (!cache) {
    cache = {};
    persistenceCaches.set(storage, cache);
  }
  if (
    !cache.sessions ||
    !samePersistedValue(cache.sessionsInput, state.recentSessions)
  ) {
    cache.sessions = normalizeSessions(state.recentSessions);
  }
  cache.sessionsInput = state.recentSessions;
  const payload = buildPersistedPayload(state, cache.sessions);
  try {
    writePayload(storage, cache, payload);
    return { status: "saved", ...projection(payload) };
  } catch (error) {
    if (!isQuotaExceeded(error)) {
      return { status: "failed", error, ...projection(payload) };
    }

    const withoutNotifications = { ...payload, notifications: [] };
    if (payload.notifications.length > 0) {
      try {
        writePayload(storage, cache, withoutNotifications);
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
      writePayload(storage, cache, trimmedPayload);
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
  persistenceCaches.delete(localStorage);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}
