import type { Session } from "@playcounter/shared";
import { dailyTotals, getSessionGameKey, summaryStats } from "./historyStats";
import { gameSecondsKey, gameSecondsRefFromKey } from "./gameSeconds";
import type { AppNotification, NotificationKind } from "./notifications";
import { resolvedCanonicalGameKey, type GameIdentityResolver } from "./store";
import type { ProviderFloor } from "./library/playtimeFloor";
import {
  displayTotalSeconds,
  effectiveTotalSeconds,
  trackedSinceReadSeconds,
} from "./playtimeAdjustments";
import { appLocale, getT } from "./i18n";

const t = getT("achievements");

export const TOTAL_HOURS = [10, 50, 100, 250, 500, 1_000, 2_500, 5_000];
export const MONTH_HOURS = [10, 25, 50, 100, 200];
export const GAME_HOURS = [10, 25, 50, 100, 250, 500, 1_000];
export const STREAK_DAYS = [3, 7, 14, 30, 100];
export const VERIFIED_COUNTS = [1, 5, 10, 25, 50, 100, 150, 200];
export const EMULATOR_VERIFIED_COUNTS = [1, 3, 5, 10, 25, 50, 100, 150];

// Keep streak records readable for backwards compatibility, but hide the
// category and do not grant new awards until it is ready to be enabled again.
export const PLAY_STREAK_ACHIEVEMENTS_ENABLED = false;

export type MilestoneCategory =
  | "total"
  | "month"
  | "game"
  | "streak"
  | "verified"
  | "emulator";

export type MilestoneNotificationKind = Extract<
  NotificationKind,
  `milestone-${string}`
>;

export type AwardedMilestone = {
  id: string;
  kind: MilestoneNotificationKind;
  /** Text in the language of the moment it was earned. The app shows
   *  milestoneTitle() instead; this is the fallback for old game awards
   *  without `gameName`. */
  title: string;
  /** Game awards: the game's name when it was earned. Absent on older ones,
   *  whose name is read from the English title. */
  gameName?: string;
  coverUrl?: string;
  awardedAt: string;
  backfilled?: boolean;
  aliasIds?: string[];
};

export type MilestoneMetrics = {
  totalHours: number;
  monthKey: string;
  monthHours: number;
  streakDays: number;
  verifiedCount: number;
  verifiedEmulatorCount: number;
  games: Map<string, { hours: number; name: string; coverUrl: string }>;
  canonicalByAlias: Map<string, string>;
};

export type MilestoneEvaluation = {
  awardedMilestones: AwardedMilestone[];
  awardedMilestoneIds: string[];
  milestonesInitializedAt: string;
  notifications: AppNotification[];
  revokedMilestoneIds: string[];
};

export type MilestoneInput = {
  sessions: Session[];
  archivedSeconds: number;
  archivedGameSeconds: Record<string, number>;
  playtimeAdjustments: Record<string, number>;
  verifiedContributions: number;
  verifiedEmulatorContributions?: number;
  resolveIgdbId?: GameIdentityResolver;
  providerFloors?: ProviderFloor[];
  now?: Date;
};

export function parseMilestoneId(id: string): {
  category: MilestoneCategory;
  scope: string;
  threshold: number;
} | null {
  const parts = id.split(":");
  if (parts[0] !== "milestone" || parts.length < 3) return null;
  const category = parts[1] as MilestoneCategory;
  if (
    !["total", "month", "game", "streak", "verified", "emulator"].includes(
      category,
    )
  ) {
    return null;
  }
  const threshold = Number(parts.at(-1));
  if (!Number.isFinite(threshold) || threshold <= 0) return null;
  const scope = parts.slice(2, -1).join(":");
  if ((category === "month" || category === "game") && !scope) return null;
  if (category !== "month" && category !== "game" && scope) return null;
  return { category, scope, threshold };
}

export function milestoneMetrics(input: MilestoneInput): MilestoneMetrics {
  const now = input.now ?? new Date();
  const retainedSeconds = input.sessions.reduce(
    (total, session) => total + Math.max(0, session.durationSeconds ?? 0),
    0,
  );
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const monthSeconds = [
    ...dailyTotals(
      input.sessions,
      monthStart.getTime(),
      nextMonth.getTime(),
    ).values(),
  ].reduce((total, day) => total + day.seconds, 0);

  const { games, canonicalByAlias } = gameLifetimeTotals(input);

  const visibleGames = new Map<
    string,
    { hours: number; name: string; coverUrl: string }
  >();
  const adjustmentDeltaSeconds = [...games.entries()].reduce(
    (sum, [key, game]) => {
      const totalSeconds = effectiveTotalSeconds(
        game.recordedSeconds,
        game.adjustmentSeconds,
        game.providerFloorSeconds,
        game.trackedSinceReadSeconds,
      );
      visibleGames.set(key, {
        hours: totalSeconds / 3600,
        name: game.name || "A game",
        coverUrl: game.coverUrl,
      });
      return sum + totalSeconds - game.recordedSeconds;
    },
    0,
  );

  return {
    totalHours:
      Math.max(
        0,
        input.archivedSeconds + retainedSeconds + adjustmentDeltaSeconds,
      ) / 3600,
    monthKey,
    monthHours: monthSeconds / 3600,
    streakDays: summaryStats(input.sessions, now.getTime()).currentStreakDays,
    verifiedCount: Math.max(0, input.verifiedContributions),
    verifiedEmulatorCount: Math.max(
      0,
      input.verifiedEmulatorContributions ?? 0,
    ),
    games: visibleGames,
    canonicalByAlias,
  };
}

export type GameLifetimeTotal = {
  recordedSeconds: number;
  adjustmentSeconds: number;
  providerFloorSeconds: number;
  /** PlayCounter time since the launcher read, added on top of it. */
  trackedSinceReadSeconds: number;
  /** Empty when only archived time or an edit knows the game. */
  name: string;
  coverUrl: string;
};

/**
 * Every game's lifetime parts, keyed like its sessions: recorded time
 * (sessions + archive), manual edits and launcher totals. The total is
 * effectiveTotalSeconds() of these, the same number My Games shows.
 */
export function gameLifetimeTotals(
  input: Pick<
    MilestoneInput,
    | "sessions"
    | "archivedGameSeconds"
    | "playtimeAdjustments"
    | "providerFloors"
    | "resolveIgdbId"
  >,
) {
  const games = new Map<string, GameLifetimeTotal>();
  const canonicalByAlias = new Map<string, string>();
  const rememberAlias = (canonicalKey: string, alias: string) => {
    canonicalByAlias.set(canonicalKey, canonicalKey);
    canonicalByAlias.set(alias, canonicalKey);
  };

  for (const [key, seconds] of Object.entries(input.archivedGameSeconds)) {
    const ref = gameSecondsRefFromKey(key);
    if (!ref) continue;
    const canonicalKey = resolvedCanonicalGameKey(ref, input.resolveIgdbId);
    const game = games.get(canonicalKey) ?? emptyGame();
    game.recordedSeconds += Math.max(0, seconds);
    games.set(canonicalKey, game);
    rememberAlias(canonicalKey, key);
  }
  for (const session of input.sessions) {
    const key = getSessionGameKey(session, input.resolveIgdbId);
    const game = games.get(key) ?? {
      ...emptyGame(),
      name: session.gameName ?? session.exeName,
      coverUrl: session.coverUrl ?? "",
    };
    game.recordedSeconds += Math.max(0, session.durationSeconds ?? 0);
    if (session.gameName) game.name = session.gameName;
    if (session.coverUrl) game.coverUrl = session.coverUrl;
    games.set(key, game);
    rememberAlias(key, gameSecondsKey(session));
  }
  for (const [key, seconds] of Object.entries(input.playtimeAdjustments)) {
    const ref = gameSecondsRefFromKey(key);
    if (!ref) continue;
    const canonicalKey = resolvedCanonicalGameKey(ref, input.resolveIgdbId);
    const game = games.get(canonicalKey) ?? emptyGame();
    game.adjustmentSeconds += seconds;
    games.set(canonicalKey, game);
    rememberAlias(canonicalKey, key);
  }
  const floors = input.providerFloors ?? [];
  const recorded = floors.length > 0 ? recordedSecondsByGame(input) : null;
  for (const floor of floors) {
    const game = games.get(floor.canonicalKey) ?? {
      ...emptyGame(),
      name: floor.name,
      coverUrl: floor.coverUrl,
    };
    if (floor.seconds >= game.providerFloorSeconds) {
      game.providerFloorSeconds = floor.seconds;
      game.trackedSinceReadSeconds = recorded!.secondsSinceRead(floor);
    }
    if (!game.name) game.name = floor.name;
    if (!game.coverUrl) game.coverUrl = floor.coverUrl;
    games.set(floor.canonicalKey, game);
    rememberAlias(floor.canonicalKey, floor.canonicalKey);
  }

  return { games, canonicalByAlias };
}

/**
 * A manual adjustment ("Set total") moves the whole total, launcher time
 * included. An adjustment made before a game had launcher time only knew
 * PlayCounter's time (it may hold the Steam hours typed in by hand), so when
 * launcher time first counts, the higher of the two wins: the adjustment
 * becomes the part of the shown total above the higher of PlayCounter and
 * launcher time. Used on a game's first launcher read, and once for saves
 * from before adjustments moved the whole total, which keep what they showed.
 */
export function moveAdjustmentsOnTop(
  playtimeAdjustments: Record<string, number>,
  gameKeys: ReadonlySet<string>,
  input: Omit<Parameters<typeof gameLifetimeTotals>[0], "playtimeAdjustments">,
) {
  if (gameKeys.size === 0) return false;
  const { games, canonicalByAlias } = gameLifetimeTotals({
    ...input,
    playtimeAdjustments,
  });
  let changed = false;
  for (const gameKey of gameKeys) {
    const game = games.get(gameKey);
    if (!game || game.adjustmentSeconds === 0) continue;
    const launcherSeconds =
      game.providerFloorSeconds > 0
        ? game.providerFloorSeconds + game.trackedSinceReadSeconds
        : 0;
    const shown = Math.max(
      displayTotalSeconds(game.recordedSeconds, game.adjustmentSeconds),
      launcherSeconds,
    );
    const adjustment = Math.round(
      shown - Math.max(game.recordedSeconds, launcherSeconds),
    );
    if (adjustment === game.adjustmentSeconds) continue;
    const keys = Object.keys(playtimeAdjustments)
      .filter((key) => canonicalByAlias.get(key) === gameKey)
      .sort();
    for (const key of keys) delete playtimeAdjustments[key];
    if (adjustment !== 0) playtimeAdjustments[keys[0]] = adjustment;
    changed = true;
  }
  return changed;
}

/**
 * PlayCounter's recorded time per game (sessions + archive), keyed like
 * launcher totals. `secondsFor` with a date counts only sessions started
 * before it; archived time has no dates and always counts.
 */
export function recordedSecondsByGame(
  input: Pick<
    MilestoneInput,
    "sessions" | "archivedGameSeconds" | "resolveIgdbId"
  >,
) {
  const games = new Map<
    string,
    {
      archivedSeconds: number;
      sessions: { startedMs: number; seconds: number }[];
    }
  >();
  const game = (key: string) => {
    let entry = games.get(key);
    if (!entry) {
      entry = { archivedSeconds: 0, sessions: [] };
      games.set(key, entry);
    }
    return entry;
  };
  for (const [key, seconds] of Object.entries(input.archivedGameSeconds)) {
    const ref = gameSecondsRefFromKey(key);
    if (!ref) continue;
    game(resolvedCanonicalGameKey(ref, input.resolveIgdbId)).archivedSeconds +=
      Math.max(0, seconds);
  }
  for (const session of input.sessions) {
    game(getSessionGameKey(session, input.resolveIgdbId)).sessions.push({
      startedMs: Date.parse(session.startedAt),
      seconds: Math.max(0, session.durationSeconds ?? 0),
    });
  }
  const secondsFor = (canonicalKey: string, beforeMs = Infinity) => {
    const entry = games.get(canonicalKey);
    if (!entry) return 0;
    return Math.round(
      entry.sessions.reduce(
        (total, session) =>
          // A session without a valid start counts as before the read.
          session.startedMs >= beforeMs ? total : total + session.seconds,
        entry.archivedSeconds,
      ),
    );
  };
  /**
   * PlayCounter's time the launcher total holds: the snapshot, but never more
   * than what is still recorded from before the read. Time removed from back
   * then (a deleted session, a file removed with its history) must not hold
   * back the sessions played after the import.
   */
  const secondsAtRead = (floor: LauncherRead) =>
    floor.recordedSecondsAtRead === undefined
      ? undefined
      : Math.min(
          floor.recordedSecondsAtRead,
          secondsFor(floor.canonicalKey, floor.readAtMs),
        );
  return {
    secondsFor,
    secondsAtRead,
    /** PlayCounter time since the launcher read, added on top of it. */
    secondsSinceRead(floor: LauncherRead | undefined, runningSeconds = 0) {
      if (!floor) return 0;
      return trackedSinceReadSeconds(
        secondsAtRead(floor),
        secondsFor(floor.canonicalKey) + runningSeconds,
      );
    },
  };
}

type LauncherRead = Pick<
  ProviderFloor,
  "canonicalKey" | "recordedSecondsAtRead" | "readAtMs"
>;

export function evaluateMilestones(
  input: MilestoneInput & {
    awardedMilestones?: AwardedMilestone[];
    awardedMilestoneIds?: string[];
    milestonesInitializedAt: string | null;
    verifiedContributionsAuthoritative?: boolean;
    emulatorContributionsAuthoritative?: boolean;
  },
): MilestoneEvaluation {
  const now = input.now ?? new Date();
  const createdAt = now.toISOString();
  const metrics = milestoneMetrics({ ...input, now });
  const reached: AppNotification[] = [];

  addThresholds(
    reached,
    "month",
    metrics.monthKey,
    metrics.monthHours,
    MONTH_HOURS,
    createdAt,
  );
  addThresholds(
    reached,
    "emulator",
    "",
    metrics.verifiedEmulatorCount,
    EMULATOR_VERIFIED_COUNTS,
    createdAt,
  );
  addThresholds(
    reached,
    "total",
    "",
    metrics.totalHours,
    TOTAL_HOURS,
    createdAt,
  );
  for (const [key, game] of metrics.games) {
    addThresholds(
      reached,
      "game",
      key,
      game.hours,
      GAME_HOURS,
      createdAt,
      game,
    );
  }
  if (PLAY_STREAK_ACHIEVEMENTS_ENABLED) {
    addThresholds(
      reached,
      "streak",
      "",
      metrics.streakDays,
      STREAK_DAYS,
      createdAt,
    );
  }
  addThresholds(
    reached,
    "verified",
    "",
    metrics.verifiedCount,
    VERIFIED_COUNTS,
    createdAt,
  );

  const reachedById = new Map(reached.map((item) => [item.id, item]));
  const normalized = normalizeAwardedMilestones(
    migrateAwardedMilestones({
      awardedMilestones: input.awardedMilestones,
      awardedMilestoneIds: input.awardedMilestoneIds,
      milestonesInitializedAt: input.milestonesInitializedAt,
      now,
    }),
    metrics,
    reachedById,
  );
  const revokedIds = new Set<string>();
  const retained = normalized.filter((milestone) => {
    if (isMilestoneReached(milestone, reachedById)) return true;
    const parsed = parseMilestoneId(milestone.id);
    if (!parsed) return true;
    let revoke = false;
    if (parsed.category === "total") {
      revoke = metrics.totalHours < parsed.threshold;
    } else if (parsed.category === "game") {
      const canonical = currentCanonicalForMilestone(milestone, metrics);
      revoke =
        !canonical ||
        (metrics.games.get(canonical)?.hours ?? 0) < parsed.threshold;
    } else if (
      parsed.category === "verified" &&
      input.verifiedContributionsAuthoritative
    ) {
      revoke = metrics.verifiedCount < parsed.threshold;
    } else if (
      parsed.category === "emulator" &&
      input.emulatorContributionsAuthoritative
    ) {
      revoke = metrics.verifiedEmulatorCount < parsed.threshold;
    }
    if (!revoke) return true;
    revokedIds.add(milestone.id);
    for (const aliasId of milestone.aliasIds ?? []) revokedIds.add(aliasId);
    return false;
  });

  const awardedIds = milestoneIdSet(retained);
  const fresh: AppNotification[] = [];
  for (const notification of reached) {
    if (awardedIds.has(notification.id)) continue;
    const equivalentIds = equivalentIdsFor(notification.id, metrics);
    if (equivalentIds.some((id) => awardedIds.has(id))) continue;
    const milestone: AwardedMilestone = {
      id: notification.id,
      kind: notification.kind as MilestoneNotificationKind,
      title: notification.title,
      ...reachedGameName(notification),
      coverUrl: notification.coverUrl,
      awardedAt: createdAt,
    };
    retained.push(milestone);
    awardedIds.add(milestone.id);
    fresh.push(notification);
  }

  return {
    awardedMilestones: retained,
    awardedMilestoneIds: [...milestoneIdSet(retained)],
    milestonesInitializedAt: input.milestonesInitializedAt ?? createdAt,
    notifications: input.milestonesInitializedAt ? fresh : [],
    revokedMilestoneIds: [...revokedIds],
  };
}

export function migrateAwardedMilestones(input: {
  awardedMilestones?: unknown;
  awardedMilestoneIds?: unknown;
  milestonesInitializedAt?: string | null;
  now?: Date;
}): AwardedMilestone[] {
  if (Array.isArray(input.awardedMilestones)) {
    return input.awardedMilestones
      .map((value) => sanitizeAwardedMilestone(value, input.now ?? new Date()))
      .filter((item): item is AwardedMilestone => item !== null);
  }
  if (!Array.isArray(input.awardedMilestoneIds)) return [];
  const awardedAt = (input.now ?? new Date()).toISOString();
  const migrated = new Map<string, AwardedMilestone>();
  for (const value of input.awardedMilestoneIds) {
    if (typeof value !== "string") continue;
    const parsed = parseMilestoneId(value);
    if (!parsed) continue;
    migrated.set(value, {
      id: value,
      kind: kindForCategory(parsed.category),
      title: milestoneTitle(parsed),
      awardedAt,
    });
  }
  return [...migrated.values()];
}

function emptyGame(): GameLifetimeTotal {
  return {
    recordedSeconds: 0,
    adjustmentSeconds: 0,
    providerFloorSeconds: 0,
    trackedSinceReadSeconds: 0,
    name: "",
    coverUrl: "",
  };
}

function normalizeAwardedMilestones(
  milestones: AwardedMilestone[],
  metrics: MilestoneMetrics,
  reachedById: Map<string, AppNotification>,
) {
  const normalized = new Map<string, AwardedMilestone>();
  for (const milestone of milestones) {
    const parsed = parseMilestoneId(milestone.id);
    let targetId = milestone.id;
    if (parsed?.category === "game") {
      const canonical = currentCanonicalForMilestone(milestone, metrics);
      if (canonical)
        targetId = `milestone:game:${canonical}:${parsed.threshold}`;
    }
    const reached = reachedById.get(targetId);
    const aliasIds = new Set(milestone.aliasIds ?? []);
    if (targetId !== milestone.id) aliasIds.add(milestone.id);
    aliasIds.delete(targetId);
    const candidate: AwardedMilestone = {
      ...milestone,
      id: targetId,
      ...(reached
        ? {
            title: reached.title,
            ...reachedGameName(reached),
            coverUrl: reached.coverUrl,
          }
        : {}),
      ...(aliasIds.size > 0
        ? { aliasIds: [...aliasIds] }
        : { aliasIds: undefined }),
    };
    const existing = normalized.get(targetId);
    if (!existing) {
      normalized.set(targetId, candidate);
      continue;
    }
    const earlier =
      Date.parse(existing.awardedAt) <= Date.parse(candidate.awardedAt)
        ? existing
        : candidate;
    normalized.set(targetId, {
      ...earlier,
      ...(reached
        ? {
            title: reached.title,
            ...reachedGameName(reached),
            coverUrl: reached.coverUrl,
          }
        : {}),
      aliasIds: [
        ...new Set(
          [
            ...(existing.aliasIds ?? []),
            ...(candidate.aliasIds ?? []),
            existing.id === targetId ? "" : existing.id,
            candidate.id === targetId ? "" : candidate.id,
          ].filter(Boolean),
        ),
      ],
    });
  }
  return [...normalized.values()];
}

function currentCanonicalForMilestone(
  milestone: Pick<AwardedMilestone, "id" | "aliasIds">,
  metrics: MilestoneMetrics,
) {
  for (const id of [milestone.id, ...(milestone.aliasIds ?? [])]) {
    const parsed = parseMilestoneId(id);
    if (parsed?.category !== "game") continue;
    const canonical = metrics.canonicalByAlias.get(parsed.scope);
    if (canonical) return canonical;
  }
  return undefined;
}

function isMilestoneReached(
  milestone: AwardedMilestone,
  reachedById: Map<string, AppNotification>,
) {
  return [milestone.id, ...(milestone.aliasIds ?? [])].some((id) =>
    reachedById.has(id),
  );
}

function equivalentIdsFor(id: string, metrics: MilestoneMetrics) {
  const parsed = parseMilestoneId(id);
  if (parsed?.category !== "game") return [id];
  const canonical = metrics.canonicalByAlias.get(parsed.scope) ?? parsed.scope;
  const ids = [id];
  for (const [alias, target] of metrics.canonicalByAlias) {
    if (target === canonical) {
      ids.push(`milestone:game:${alias}:${parsed.threshold}`);
    }
  }
  return [...new Set(ids)];
}

function milestoneIdSet(milestones: AwardedMilestone[]) {
  return new Set(
    milestones.flatMap((milestone) => [
      milestone.id,
      ...(milestone.aliasIds ?? []),
    ]),
  );
}

function sanitizeAwardedMilestone(
  value: unknown,
  migrationDate: Date,
): AwardedMilestone | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string") return null;
  const parsed = parseMilestoneId(record.id);
  if (!parsed || record.kind !== kindForCategory(parsed.category)) return null;
  const awardedAt =
    record.backfilled === true
      ? migrationDate.toISOString()
      : validIsoDate(record.awardedAt);
  if (!awardedAt) return null;
  const aliasIds = Array.isArray(record.aliasIds)
    ? [
        ...new Set(
          record.aliasIds.filter(
            (id): id is string =>
              typeof id === "string" && parseMilestoneId(id) !== null,
          ),
        ),
      ]
    : undefined;
  return {
    id: record.id,
    kind: record.kind as MilestoneNotificationKind,
    title:
      typeof record.title === "string" ? record.title : milestoneTitle(parsed),
    ...(typeof record.gameName === "string" && record.gameName
      ? { gameName: record.gameName }
      : {}),
    ...(typeof record.coverUrl === "string" && record.coverUrl
      ? { coverUrl: record.coverUrl }
      : {}),
    awardedAt,
    ...(aliasIds?.length ? { aliasIds } : {}),
  };
}

function validIsoDate(value: unknown) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    return null;
  }
  return new Date(value).toISOString();
}

function kindForCategory(
  category: MilestoneCategory,
): MilestoneNotificationKind {
  return `milestone-${category}`;
}

/** A milestone's text, made from the parts of its id: "100 hours played in
 *  Elden Ring". Every milestone sentence comes from here. */
export function milestoneTitle(
  milestone: { category: MilestoneCategory; scope: string; threshold: number },
  gameName?: string,
) {
  const count = milestone.threshold;
  switch (milestone.category) {
    case "total":
      return t("You've played {{count, number}} hours in total", { count });
    case "month":
      return t("{{count, number}} hours played in {{month}}", {
        count,
        month: monthLabel(milestone.scope),
      });
    case "game":
      return t("{{count, number}} hours played in {{game}}", {
        count,
        // "A game" is the data stand-in for a game nobody named.
        game:
          gameName && gameName.toLowerCase() !== "a game"
            ? gameName
            : t("a game"),
      });
    case "streak":
      return t("{{count, number}}-day play streak", { count });
    case "verified":
      return count === 1
        ? t("Your first contribution was approved")
        : t("{{count, number}} contributions approved", { count });
    case "emulator":
      return count === 1
        ? t("Your first emulator match was approved")
        : t("{{count, number}} emulator matches approved", { count });
  }
}

/** The game name a reached game milestone carries over to its award. */
function reachedGameName(notification: AppNotification) {
  const gameName = notification.params?.game;
  return gameName ? { gameName } : {};
}

function monthLabel(scope: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(scope);
  if (!match) return scope;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return scope;
  return new Date(year, month - 1, 1).toLocaleDateString(appLocale(), {
    month: "long",
    year: "numeric",
  });
}

function addThresholds(
  notifications: AppNotification[],
  category: MilestoneCategory,
  scope: string,
  value: number,
  thresholds: number[],
  createdAt: string,
  game?: { name: string; coverUrl: string },
) {
  for (let index = thresholds.length - 1; index >= 0; index -= 1) {
    const threshold = thresholds[index];
    if (value < threshold) continue;
    notifications.push({
      id: scope
        ? `milestone:${category}:${scope}:${threshold}`
        : `milestone:${category}:${threshold}`,
      kind: kindForCategory(category),
      title: milestoneTitle({ category, scope, threshold }, game?.name),
      coverUrl: game?.coverUrl,
      ...(game ? { params: { game: game.name } } : {}),
      createdAt,
    });
  }
}
