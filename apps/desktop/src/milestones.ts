import type { GameSource, Session } from "@playcounter/shared";
import { dailyTotals, getSessionGameKey, summaryStats } from "./historyStats";
import type { AppNotification, NotificationKind } from "./notifications";
import { resolvedCanonicalGameKey, type GameIdentityResolver } from "./store";

const TOTAL_HOURS = [10, 50, 100, 250, 500, 1_000, 2_500, 5_000];
const MONTH_HOURS = [10, 25, 50, 100, 200];
const GAME_HOURS = [10, 25, 50, 100, 250, 500];
const STREAK_DAYS = [3, 7, 14, 30, 100];
const VERIFIED_COUNTS = [1, 5, 10, 25, 50];

export type MilestoneEvaluation = {
  awardedMilestoneIds: string[];
  milestonesInitializedAt: string;
  notifications: AppNotification[];
};

export function evaluateMilestones(input: {
  sessions: Session[];
  archivedSeconds: number;
  archivedGameSeconds: Record<string, number>;
  verifiedContributions: number;
  awardedMilestoneIds: string[];
  milestonesInitializedAt: string | null;
  resolveIgdbId?: GameIdentityResolver;
  now?: Date;
}): MilestoneEvaluation {
  const now = input.now ?? new Date();
  const createdAt = now.toISOString();
  const reached: AppNotification[] = [];
  const retainedSeconds = input.sessions.reduce(
    (total, session) => total + Math.max(0, session.durationSeconds ?? 0),
    0,
  );
  addThresholds(
    reached,
    "milestone-total",
    "milestone:total",
    (input.archivedSeconds + retainedSeconds) / 3600,
    TOTAL_HOURS,
    (hours) => `You've played ${hours.toLocaleString()} hours in total`,
    createdAt,
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
  addThresholds(
    reached,
    "milestone-month",
    `milestone:month:${monthKey}`,
    monthSeconds / 3600,
    MONTH_HOURS,
    (hours) =>
      `${hours} hours played in ${now.toLocaleDateString([], { month: "long" })}`,
    createdAt,
  );

  const games = new Map<
    string,
    { seconds: number; name: string; coverUrl: string }
  >();
  const aliasesByGame = new Map<string, Set<string>>();
  for (const [key, seconds] of Object.entries(input.archivedGameSeconds)) {
    const separator = key.indexOf(":");
    const source = separator >= 0 ? key.slice(0, separator) : "unknown";
    const gameId = Number(key.slice(separator + 1));
    const canonicalKey = Number.isFinite(gameId)
      ? resolvedCanonicalGameKey(
          { gameId, source: source as GameSource },
          input.resolveIgdbId,
        )
      : key;
    const game = games.get(canonicalKey) ?? {
      seconds: 0,
      name: "A game",
      coverUrl: "",
    };
    game.seconds += seconds;
    games.set(canonicalKey, game);
    const aliases = aliasesByGame.get(canonicalKey) ?? new Set<string>();
    aliases.add(key);
    aliasesByGame.set(canonicalKey, aliases);
  }
  for (const session of input.sessions) {
    const key = getSessionGameKey(session, input.resolveIgdbId);
    const game = games.get(key) ?? {
      seconds: 0,
      name: session.gameName ?? session.exeName,
      coverUrl: session.coverUrl ?? "",
    };
    game.seconds += Math.max(0, session.durationSeconds ?? 0);
    if (session.gameName) game.name = session.gameName;
    if (session.coverUrl) game.coverUrl = session.coverUrl;
    games.set(key, game);
    const aliases = aliasesByGame.get(key) ?? new Set<string>();
    aliases.add(`${session.source ?? "unknown"}:${session.gameId}`);
    aliasesByGame.set(key, aliases);
  }
  const equivalentAwardIds = new Map<string, string[]>();
  for (const [key, game] of games) {
    addThresholds(
      reached,
      "milestone-game",
      `milestone:game:${key}`,
      game.seconds / 3600,
      GAME_HOURS,
      (hours) => `${hours} hours played in ${game.name}`,
      createdAt,
      game.coverUrl,
    );
    for (const threshold of GAME_HOURS) {
      equivalentAwardIds.set(
        `milestone:game:${key}:${threshold}`,
        [...(aliasesByGame.get(key) ?? [])].map(
          (alias) => `milestone:game:${alias}:${threshold}`,
        ),
      );
    }
  }

  addThresholds(
    reached,
    "milestone-streak",
    "milestone:streak",
    summaryStats(input.sessions, now.getTime()).currentStreakDays,
    STREAK_DAYS,
    (days) => `${days}-day play streak`,
    createdAt,
  );
  addThresholds(
    reached,
    "milestone-verified",
    "milestone:verified",
    input.verifiedContributions,
    VERIFIED_COUNTS,
    (count) =>
      count === 1
        ? "Your first contribution was verified"
        : `${count} contributions verified`,
    createdAt,
  );

  const awarded = new Set(input.awardedMilestoneIds);
  for (const [canonicalId, aliasIds] of equivalentAwardIds) {
    if (aliasIds.some((id) => awarded.has(id))) awarded.add(canonicalId);
  }
  const fresh = reached.filter(
    (notification) =>
      !awarded.has(notification.id) &&
      !(equivalentAwardIds.get(notification.id) ?? []).some((id) =>
        awarded.has(id),
      ),
  );
  for (const notification of fresh) awarded.add(notification.id);
  return {
    awardedMilestoneIds: [...awarded],
    milestonesInitializedAt: input.milestonesInitializedAt ?? createdAt,
    notifications: input.milestonesInitializedAt ? fresh : [],
  };
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
  for (const threshold of thresholds) {
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
