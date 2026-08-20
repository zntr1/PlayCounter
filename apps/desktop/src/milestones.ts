import type { Session } from "@playcounter/shared";
import { dailyTotals, getSessionGameKey, summaryStats } from "./historyStats";
import { gameSecondsKey, gameSecondsRefFromKey } from "./gameSeconds";
import type { AppNotification, NotificationKind } from "./notifications";
import { resolvedCanonicalGameKey, type GameIdentityResolver } from "./store";

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
  title: string;
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

type MilestoneInput = {
  sessions: Session[];
  archivedSeconds: number;
  archivedGameSeconds: Record<string, number>;
  playtimeAdjustments: Record<string, number>;
  verifiedContributions: number;
  verifiedEmulatorContributions?: number;
  resolveIgdbId?: GameIdentityResolver;
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

  const games = new Map<
    string,
    {
      recordedSeconds: number;
      adjustmentSeconds: number;
      name: string;
      coverUrl: string;
    }
  >();
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

  const visibleGames = new Map<
    string,
    { hours: number; name: string; coverUrl: string }
  >();
  const adjustmentDeltaSeconds = [...games.entries()].reduce(
    (sum, [key, game]) => {
      const totalSeconds = Math.max(
        0,
        game.recordedSeconds + game.adjustmentSeconds,
      );
      visibleGames.set(key, {
        hours: totalSeconds / 3600,
        name: game.name,
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
    "milestone-month",
    `milestone:month:${metrics.monthKey}`,
    metrics.monthHours,
    MONTH_HOURS,
    (hours) =>
      `${hours} hours played in ${now.toLocaleDateString([], {
        month: "long",
        year: "numeric",
      })}`,
    createdAt,
  );
  addThresholds(
    reached,
    "milestone-emulator",
    "milestone:emulator",
    metrics.verifiedEmulatorCount,
    EMULATOR_VERIFIED_COUNTS,
    (count) =>
      count === 1
        ? "Your first emulator match was approved"
        : `${count} emulator matches approved`,
    createdAt,
  );
  addThresholds(
    reached,
    "milestone-total",
    "milestone:total",
    metrics.totalHours,
    TOTAL_HOURS,
    (hours) => `You've played ${hours.toLocaleString()} hours in total`,
    createdAt,
  );
  for (const [key, game] of metrics.games) {
    addThresholds(
      reached,
      "milestone-game",
      `milestone:game:${key}`,
      game.hours,
      GAME_HOURS,
      (hours) => `${hours} hours played in ${game.name}`,
      createdAt,
      game.coverUrl,
    );
  }
  if (PLAY_STREAK_ACHIEVEMENTS_ENABLED) {
    addThresholds(
      reached,
      "milestone-streak",
      "milestone:streak",
      metrics.streakDays,
      STREAK_DAYS,
      (days) => `${days}-day play streak`,
      createdAt,
    );
  }
  addThresholds(
    reached,
    "milestone-verified",
    "milestone:verified",
    metrics.verifiedCount,
    VERIFIED_COUNTS,
    (count) =>
      count === 1
        ? "Your first suggestion was approved"
        : `${count} suggestions approved`,
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
      title: genericMilestoneTitle(parsed),
      awardedAt,
    });
  }
  return [...migrated.values()];
}

function emptyGame() {
  return {
    recordedSeconds: 0,
    adjustmentSeconds: 0,
    name: "A game",
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
      ...(reached ? { title: reached.title, coverUrl: reached.coverUrl } : {}),
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
      ...(reached ? { title: reached.title, coverUrl: reached.coverUrl } : {}),
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
      typeof record.title === "string"
        ? record.title
        : genericMilestoneTitle(parsed),
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

function genericMilestoneTitle(parsed: {
  category: MilestoneCategory;
  scope: string;
  threshold: number;
}) {
  const threshold = parsed.threshold.toLocaleString();
  switch (parsed.category) {
    case "total":
      return `You've played ${threshold} hours in total`;
    case "month":
      return `${threshold} hours played in ${monthLabel(parsed.scope)}`;
    case "game":
      return `${threshold} hours played in a game`;
    case "streak":
      return `${threshold}-day play streak`;
    case "verified":
      return parsed.threshold === 1
        ? "Your first suggestion was approved"
        : `${threshold} suggestions approved`;
    case "emulator":
      return parsed.threshold === 1
        ? "Your first emulator match was approved"
        : `${threshold} emulator matches approved`;
  }
}

function monthLabel(scope: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(scope);
  if (!match) return scope;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return scope;
  return new Date(year, month - 1, 1).toLocaleDateString([], {
    month: "long",
    year: "numeric",
  });
}

function addThresholds(
  notifications: AppNotification[],
  kind: NotificationKind,
  idPrefix: string,
  value: number,
  thresholds: number[],
  title: (threshold: number) => string,
  createdAt: string,
  coverUrl?: string,
) {
  for (let index = thresholds.length - 1; index >= 0; index -= 1) {
    const threshold = thresholds[index];
    if (value < threshold) continue;
    notifications.push({
      id: `${idPrefix}:${threshold}`,
      kind,
      title: title(threshold),
      coverUrl,
      createdAt,
    });
  }
}
