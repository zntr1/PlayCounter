import type {
  ContributionCounts,
  ContributionStatus,
  Session,
  Settings,
} from "@playcounter/shared";
import type { AppNotification, FeedbackReplyCursor } from "./notifications";
import type { DiscoveredReviewReminder } from "./discoveredReminder";
import type { AwardedMilestone } from "./milestones";
import { gameSecondsKey, isConsoleSession } from "./gameSeconds";
import {
  normalizeSessions,
  MAX_STORED_SESSIONS,
  MIN_SESSION_DURATION_SECONDS,
} from "./sessionPersistence";
import {
  archivePlaythroughSeconds,
  type GameJournal,
  type PersonalShelf,
} from "./personalLibrary";
import type {
  EmulatorMapping,
  EmulatorObservation,
  KnownEmulator,
} from "./emulators/types";
import { defaultTourProgress, type TourProgress } from "./ui/tour/tourState";
import type { ToolUsage } from "./toolUsage";
import { getT } from "./i18n";

const t = getT("settings");

export const STORAGE_KEY = "playcounter:v1";
/**
 * What changed in LIVE_FIELDS since STORAGE_KEY was last written. These change
 * on every scan or every minute while games, software and emulators run.
 * Rewriting all of STORAGE_KEY (about half a megabyte) for them sent every
 * other PlayCounter window (live timer, overlays) a storage event with two
 * copies of it, and those copies piled up in their memory.
 */
export const LIVE_STORAGE_KEY = "playcounter:v1:live";
const LIVE_FIELDS = new Set<string>([
  "activeSessions", // a running session saves its progress once a minute
  "toolUsage", // software time, every scan
  "exeCache", // the time of running Discovered apps, once a minute
  "knownEmulators", // "last seen", every scan while an emulator runs
  "emulatorMappings", // "last seen", every scan while an emulator game runs
  "emulatorObservations", // the time of unrecognized emulator games
]);
/** Past this, the changes go into one write of STORAGE_KEY instead. */
const MAX_LIVE_SAVE_LENGTH = 8_192;
/** Ties a LIVE_STORAGE_KEY save to the STORAGE_KEY write it continues. */
const SAVE_ID_FIELD = "saveId";
export const MAX_STORED_NOTIFICATIONS = 100;

type PersistableAppState = {
  gameJournals?: Record<string, GameJournal>;
  personalShelves?: PersonalShelf[];
  archivedPlaythroughSeconds?: Record<string, number>;
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
  playcounterLibrary?: ReadonlyMap<string, unknown>;
  libraryInstalls?: ReadonlyMap<string, unknown>;
  scopedExeLinks?: ReadonlyMap<string, unknown>;
  ignoredExeFolders?: ReadonlyMap<string, unknown>;
  rejectedGameFiles?: readonly unknown[];
  recentSessions: Session[];
  activeSessions: unknown[];
  ambiguousMatches: unknown[];
  emulatorMappings?: ReadonlyMap<string, EmulatorMapping>;
  emulatorObservations?: EmulatorObservation[];
  knownEmulators?: ReadonlyMap<string, KnownEmulator>;
  blacklist: ReadonlySet<string>;
  notifications: AppNotification[];
  feedbackReplyCursor?: FeedbackReplyCursor | null;
  discoveredReviewReminder: DiscoveredReviewReminder;
  seenContributionStatus: Record<string, ContributionStatus>;
  contributionCounts: ContributionCounts;
  emulatorContributionCounts?: ContributionCounts;
  awardedMilestones: AwardedMilestone[];
  milestonesInitializedAt: string | null;
  archivedSeconds: number;
  archivedGameSeconds: Record<string, number>;
  archivedConsoleSeconds?: Record<string, number>;
  playtimeAdjustments: Record<string, number>;
  customHeroArt?: Record<string, string>;
  customCoverArt?: Record<string, string>;
  toolUsage?: ToolUsage;
  collapsedSections: string[];
  autoDetectedGameKeys: string[];
  tourProgress?: TourProgress;
  lastSeenReleaseNotesVersion: string | null;
  suppressStartupNotificationsOnce?: boolean;
  suppressContributionNotificationsOnce?: boolean;
  languageNoticeSeen?: boolean;
  battleNetPlaytimeNoticeSeen?: boolean;
  discordInviteSnoozedAt?: string | null;
  discordInviteDone?: boolean;
};

export type PersistedPayload = {
  gameJournals?: Record<string, GameJournal>;
  personalShelves?: PersonalShelf[];
  archivedPlaythroughSeconds: Record<string, number>;
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
  playcounterLibrary?: unknown[];
  libraryInstalls?: unknown[];
  scopedExeLinks?: unknown[];
  ignoredExeFolders?: unknown[];
  rejectedGameFiles?: unknown[];
  sessions: Session[];
  activeSessions: unknown[];
  ambiguousMatches: unknown[];
  emulatorMappings?: EmulatorMapping[];
  emulatorObservations?: EmulatorObservation[];
  knownEmulators?: KnownEmulator[];
  blacklist: string[];
  notifications: AppNotification[];
  feedbackReplyCursor?: FeedbackReplyCursor | null;
  discoveredReviewReminder?: DiscoveredReviewReminder;
  seenContributionStatus: Record<string, ContributionStatus>;
  contributionCounts: ContributionCounts;
  emulatorContributionCounts?: ContributionCounts;
  awardedMilestones?: AwardedMilestone[];
  awardedMilestoneIds: string[];
  milestonesInitializedAt?: string;
  archivedSeconds: number;
  archivedGameSeconds: Record<string, number>;
  /** The console part of archivedGameSeconds; absent in older saves. */
  archivedConsoleSeconds: Record<string, number>;
  playtimeAdjustments: Record<string, number>;
  customHeroArt?: Record<string, string>;
  customCoverArt?: Record<string, string>;
  toolUsage?: ToolUsage;
  collapsedSections?: string[];
  autoDetectedGameKeys?: string[];
  tours?: TourProgress;
  lastSeenReleaseNotesVersion?: string;
  suppressStartupNotificationsOnce?: boolean;
  suppressContributionNotificationsOnce?: boolean;
  languageNoticeSeen?: boolean;
  battleNetPlaytimeNoticeSeen?: boolean;
  discordInviteSnoozedAt?: string;
  discordInviteDone?: boolean;
};

export type PersistedProjection = Pick<
  PersistedPayload,
  | "sessions"
  | "notifications"
  | "archivedSeconds"
  | "archivedGameSeconds"
  | "archivedPlaythroughSeconds"
  | "archivedConsoleSeconds"
>;

export type PersistResult =
  | ({ status: "suspended" } & PersistedProjection)
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
  const payload: PersistedPayload = {
    installUuid: state.installUuid ?? undefined,
    gameJournals: state.gameJournals ?? {},
    personalShelves: state.personalShelves ?? [],
    archivedPlaythroughSeconds: state.archivedPlaythroughSeconds ?? {},
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
    playcounterLibrary: [...(state.playcounterLibrary?.values() ?? [])],
    libraryInstalls: [...(state.libraryInstalls?.values() ?? [])],
    scopedExeLinks: [...(state.scopedExeLinks?.values() ?? [])],
    ignoredExeFolders: [...(state.ignoredExeFolders?.values() ?? [])],
    rejectedGameFiles: [...(state.rejectedGameFiles ?? [])],
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
    feedbackReplyCursor: state.feedbackReplyCursor ?? null,
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
    archivedConsoleSeconds: state.archivedConsoleSeconds ?? {},
    playtimeAdjustments: state.playtimeAdjustments,
    customHeroArt:
      state.customHeroArt && Object.keys(state.customHeroArt).length > 0
        ? state.customHeroArt
        : undefined,
    customCoverArt:
      state.customCoverArt && Object.keys(state.customCoverArt).length > 0
        ? state.customCoverArt
        : undefined,
    toolUsage:
      state.toolUsage && Object.keys(state.toolUsage).length > 0
        ? state.toolUsage
        : undefined,
    collapsedSections: state.collapsedSections,
    autoDetectedGameKeys: [...new Set(state.autoDetectedGameKeys)],
    tours: state.tourProgress ?? defaultTourProgress(),
    lastSeenReleaseNotesVersion: state.lastSeenReleaseNotesVersion ?? undefined,
    suppressStartupNotificationsOnce:
      state.suppressStartupNotificationsOnce || undefined,
    suppressContributionNotificationsOnce:
      state.suppressContributionNotificationsOnce || undefined,
    languageNoticeSeen: state.languageNoticeSeen || undefined,
    battleNetPlaytimeNoticeSeen: state.battleNetPlaytimeNoticeSeen || undefined,
    discordInviteSnoozedAt: state.discordInviteSnoozedAt ?? undefined,
    discordInviteDone: state.discordInviteDone || undefined,
  };
  if (state.recentSessions.length > MAX_STORED_SESSIONS) {
    const kept = new Set(sessions);
    const removed = state.recentSessions.filter(
      (session) =>
        !kept.has(session) &&
        (session.durationSeconds ?? 0) >= MIN_SESSION_DURATION_SECONDS,
    );
    if (removed.length)
      Object.assign(payload, archiveRemovedSessions(payload, removed));
  }
  return payload;
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
    archivedPlaythroughSeconds: payload.archivedPlaythroughSeconds,
    archivedConsoleSeconds: payload.archivedConsoleSeconds,
  };
}

function archiveRemovedSessions(payload: PersistedPayload, removed: Session[]) {
  const archivedGameSeconds = { ...payload.archivedGameSeconds };
  const archivedConsoleSeconds = { ...payload.archivedConsoleSeconds };
  let archivedSeconds = payload.archivedSeconds;
  for (const session of removed) {
    const seconds = Math.max(0, session.durationSeconds ?? 0);
    archivedSeconds += seconds;
    const key = gameSecondsKey(session);
    archivedGameSeconds[key] = (archivedGameSeconds[key] ?? 0) + seconds;
    if (seconds > 0 && isConsoleSession(session))
      archivedConsoleSeconds[key] = (archivedConsoleSeconds[key] ?? 0) + seconds;
  }
  return {
    archivedSeconds,
    archivedGameSeconds,
    archivedConsoleSeconds,
    archivedPlaythroughSeconds: archivePlaythroughSeconds(
      payload.archivedPlaythroughSeconds,
      removed,
    ),
  };
}

type EncodedField = { value: unknown; json: string | undefined };
type PersistenceCache = {
  sessionsInput?: Session[];
  sessions?: Session[];
  /** The fields as STORAGE_KEY holds them. */
  fields?: Map<string, EncodedField>;
  /** SAVE_ID_FIELD of that STORAGE_KEY write. */
  saveId?: string;
  /** LIVE_STORAGE_KEY as written since then, if it was. */
  liveJson?: string;
};

type PathKey = string | number;
/** [path, value] sets a value, [path] removes it. */
type LiveChange = [PathKey[], unknown] | [PathKey[]];

// Store collections and their entries are immutable. Keep only the latest
// projection per storage instance, so scans can reuse unchanged history and
// field encodings without retaining older versions of the application state.
const persistenceCaches = new WeakMap<Storage, PersistenceCache>();

// A reset keeps writes disabled until the app restarts, including late scan
// results and already queued store updates. A failed reset may only be retried
// or followed by a reload; resuming this in-memory state could resurrect data.
let persistenceSuspended = false;

// Saved data that failed to load stays untouched: saving the empty or partial
// state that replaced it would erase it. Saves and automatic backups stay off
// for this run, while a backup can still be restored over it.
let loadFailed = false;

export function suspendPersistenceForReset() {
  persistenceSuspended = true;
}

export function blockPersistenceAfterFailedLoad() {
  loadFailed = true;
}

export function isPersistenceSuspended() {
  return persistenceSuspended || loadFailed;
}

function samePersistedValue(left: unknown, right: unknown): boolean {
  return (
    Object.is(left, right) ||
    (Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => Object.is(value, right[index])))
  );
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function ownValue(record: Record<string, unknown>, key: string) {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

/** Adds what turns `before` into `after`, as JSON stores them, to `changes`. */
function collectChanges(
  before: unknown,
  after: unknown,
  path: PathKey[],
  changes: LiveChange[],
) {
  if (Object.is(before, after)) return;
  if (after === undefined) {
    changes.push([[...path]]);
  } else if (
    Array.isArray(before) &&
    Array.isArray(after) &&
    after.length >= before.length
  ) {
    for (let index = 0; index < after.length; index++) {
      path.push(index);
      if (index < before.length) {
        collectChanges(before[index], after[index], path, changes);
      } else {
        changes.push([[...path], after[index] ?? null]);
      }
      path.pop();
    }
  } else if (isPlainRecord(before) && isPlainRecord(after)) {
    for (const key of Object.keys(before)) {
      if (before[key] !== undefined && ownValue(after, key) === undefined) {
        changes.push([[...path, key]]);
      }
    }
    for (const key of Object.keys(after)) {
      if (after[key] === undefined) continue;
      path.push(key);
      collectChanges(ownValue(before, key), after[key], path, changes);
      path.pop();
    }
  } else {
    changes.push([[...path], after]);
  }
}

function isPathKey(key: unknown): key is PathKey {
  return (
    (typeof key === "string" && key !== "__proto__") ||
    (typeof key === "number" && Number.isInteger(key) && key >= 0)
  );
}

function isObject(value: unknown): value is Record<PathKey, unknown> {
  return typeof value === "object" && value !== null;
}

/** Applies saved changes to a parsed STORAGE_KEY; false if they don't fit. */
function applyLiveChanges(record: Record<string, unknown>, changes: unknown) {
  if (!Array.isArray(changes)) return false;
  for (const change of changes) {
    if (!Array.isArray(change) || (change.length !== 1 && change.length !== 2))
      return false;
    const path: unknown = change[0];
    if (!Array.isArray(path) || path.length === 0 || !path.every(isPathKey))
      return false;
    let parent: unknown = record;
    for (const key of path.slice(0, -1)) {
      parent = isObject(parent) ? parent[key] : undefined;
    }
    if (!isObject(parent)) return false;
    const key = path[path.length - 1];
    if (change.length === 2) parent[key] = change[1];
    else delete parent[key];
  }
  return true;
}

function newSaveId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function writePayload(
  storage: Storage,
  cache: PersistenceCache,
  payload: PersistedPayload,
) {
  const fields = new Map<string, EncodedField>();
  const liveValues = new Map<string, unknown>();
  const liveChanges: LiveChange[] = [];
  let changed = !cache.fields;
  for (const [key, value] of Object.entries(payload)) {
    const previous = cache.fields?.get(key);
    if (previous && samePersistedValue(previous.value, value)) {
      fields.set(key, previous);
    } else if (previous && LIVE_FIELDS.has(key)) {
      // STORAGE_KEY keeps its value until STORAGE_KEY is written again.
      fields.set(key, previous);
      liveValues.set(key, value);
      collectChanges(previous.value, value, [key], liveChanges);
    } else {
      const json = JSON.stringify(value);
      fields.set(key, { value, json });
      if (!previous || previous.json !== json) changed = true;
    }
  }
  if (cache.fields?.size !== fields.size) changed = true;

  // Only successful writes become the baseline. A failed save must be retried
  // even when the next scan supplies exactly the same state.
  if (!changed && cache.saveId !== undefined) {
    if (liveChanges.length === 0 && cache.liveJson === undefined) {
      cache.fields = fields;
      return;
    }
    const liveJson = JSON.stringify({
      [SAVE_ID_FIELD]: cache.saveId,
      changes: liveChanges,
    });
    if (liveJson.length <= MAX_LIVE_SAVE_LENGTH) {
      if (liveJson !== cache.liveJson)
        storage.setItem(LIVE_STORAGE_KEY, liveJson);
      cache.liveJson = liveJson;
      cache.fields = fields;
      return;
    }
  }

  for (const [key, value] of liveValues) {
    fields.set(key, { value, json: JSON.stringify(value) });
  }
  const saveId = newSaveId();
  // A LIVE_STORAGE_KEY left from before carries another save id: ignored.
  const serialized = `{${[
    `${JSON.stringify(SAVE_ID_FIELD)}:${JSON.stringify(saveId)}`,
    ...[...fields]
      .filter(([, field]) => field.json !== undefined)
      .map(([key, field]) => `${JSON.stringify(key)}:${field.json}`),
  ].join(",")}}`;
  storage.setItem(STORAGE_KEY, serialized);
  cache.fields = fields;
  cache.saveId = saveId;
  cache.liveJson = undefined;
}

export function persistAppState(state: PersistableAppState): PersistResult {
  if (isPersistenceSuspended()) {
    return {
      status: "suspended",
      ...projection(createPersistedPayload(state)),
    };
  }
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

/** The saved state with the changes saved while things ran (LIVE_STORAGE_KEY),
 *  when they continue this very write of STORAGE_KEY. */
function withLiveChanges(record: Record<string, unknown>, raw: string | null) {
  if (!isPlainRecord(record) || raw === null) return record;
  const saveId = record[SAVE_ID_FIELD];
  delete record[SAVE_ID_FIELD];
  if (typeof saveId !== "string") return record;
  let live: unknown;
  try {
    live = JSON.parse(localStorage.getItem(LIVE_STORAGE_KEY) ?? "null");
  } catch {
    return record;
  }
  if (!isPlainRecord(live) || live[SAVE_ID_FIELD] !== saveId) return record;
  if (applyLiveChanges(record, live.changes)) return record;
  // Changes that don't fit are dropped: STORAGE_KEY is whole on its own.
  const whole = JSON.parse(raw) as Record<string, unknown>;
  delete whole[SAVE_ID_FIELD];
  return whole;
}

export function readPersistedRecord(
  onParseError?: () => void,
): Record<string, unknown> {
  let raw: string | null;
  let record: Record<string, unknown>;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
    record = JSON.parse(raw ?? "{}") as Record<string, unknown>;
  } catch {
    onParseError?.();
    return {};
  }
  return withLiveChanges(record, raw);
}

/** All saved data as one JSON text, e.g. for a backup file. */
export function readPersistedText(): string | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw === null) return null;
  try {
    return JSON.stringify(withLiveChanges(JSON.parse(raw), raw));
  } catch {
    // Unreadable data is kept exactly as it is.
    return raw;
  }
}

/** Puts back STORAGE_KEY as it was read earlier, e.g. after a failed restore. */
export function restorePersistedText(text: string | null) {
  persistenceCaches.delete(localStorage);
  if (text === null) localStorage.removeItem(STORAGE_KEY);
  else localStorage.setItem(STORAGE_KEY, text);
}

export function writePersistedRecord(data: Record<string, unknown>) {
  if (persistenceSuspended) throw new Error(t("PlayCounter is being reset."));
  persistenceCaches.delete(localStorage);
  const { [SAVE_ID_FIELD]: _saveId, ...record } = data;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
}
