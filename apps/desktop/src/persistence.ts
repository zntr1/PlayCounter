import type {
  ContributionCounts,
  ContributionStatus,
  Session,
  Settings,
} from "@playcounter/shared";
import type { AppNotification } from "./notifications";
import type { InstallPresenceMarker } from "./installPresence";
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
  installPresenceMarker: InstallPresenceMarker | null;
  contributionOwnerUuid: string | null;
  settings: Settings;
  exeCache: ReadonlyMap<string, unknown>;
  launchTargets?: ReadonlyMap<string, unknown>;
  manualLaunchTargets?: ReadonlyMap<string, unknown>;
  emulatorAutoBinaries?: ReadonlyMap<string, unknown>;
  emulatorManualBinaries?: ReadonlyMap<string, unknown>;
  emulatorAutoLaunchTargets?: ReadonlyMap<string, unknown>;
  emulatorManualLaunchTargets?: ReadonlyMap<string, unknown>;
  gameMetadata: ReadonlyMap<string, unknown>;
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
  installPresenceMarker?: InstallPresenceMarker;
  contributionOwnerUuid?: string;
  settings: Settings;
  exeCache: unknown[];
  launchTargets?: unknown[];
  manualLaunchTargets?: unknown[];
  emulatorAutoBinaries?: unknown[];
  emulatorManualBinaries?: unknown[];
  emulatorAutoLaunchTargets?: unknown[];
  emulatorManualLaunchTargets?: unknown[];
  gameMetadata: unknown[];
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
  return {
    installUuid: state.installUuid ?? undefined,
    installPresenceMarker: state.installPresenceMarker ?? undefined,
    contributionOwnerUuid: state.contributionOwnerUuid ?? undefined,
    settings: state.settings,
    exeCache: [...state.exeCache.values()],
    launchTargets: [...(state.launchTargets?.values() ?? [])],
    manualLaunchTargets: [...(state.manualLaunchTargets?.values() ?? [])],
    emulatorAutoBinaries: [
      ...(state.emulatorAutoBinaries?.values() ?? []),
    ],
    emulatorManualBinaries: [
      ...(state.emulatorManualBinaries?.values() ?? []),
    ],
    emulatorAutoLaunchTargets: [
      ...(state.emulatorAutoLaunchTargets?.values() ?? []),
    ],
    emulatorManualLaunchTargets: [
      ...(state.emulatorManualLaunchTargets?.values() ?? []),
    ],
    gameMetadata: [...state.gameMetadata.values()],
    sessions: normalizeSessions([...state.recentSessions]),
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
