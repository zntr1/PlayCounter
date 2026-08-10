import { achievementArt, type AchievementTier } from "../../../achievementArt";
import {
  GAME_HOURS,
  MONTH_HOURS,
  STREAK_DAYS,
  TOTAL_HOURS,
  VERIFIED_COUNTS,
  parseMilestoneId,
  type AwardedMilestone,
  type MilestoneCategory,
  type MilestoneMetrics,
  type MilestoneNotificationKind,
} from "../../../milestones";

export type AchievementGroupId = MilestoneCategory;
export type AchievementUnit = "hours" | "days" | "contributions";

export type AchievementCatalogItem = {
  id: string;
  category: MilestoneCategory;
  kind: MilestoneNotificationKind;
  title: string;
  threshold: number;
  unit: AchievementUnit;
  tier: AchievementTier;
  coverUrl?: string;
  currentValue?: number;
  scope: string;
  gameName?: string;
  milestone?: AwardedMilestone;
  ratio: number;
  isNext?: boolean;
  ladderOrder?: number;
};

export type AchievementCatalog = Map<
  AchievementGroupId,
  AchievementCatalogItem[]
>;

export type GameLabel = { name: string; coverUrl: string };

export const GROUP_META: Array<{
  id: AchievementGroupId;
  label: string;
  shortLabel: string;
  caption: string;
}> = [
  {
    id: "verified",
    label: "Community contributions",
    shortLabel: "Contributions",
    caption: "Help PlayCounter recognize more games for everyone.",
  },
  {
    id: "total",
    label: "Lifetime playtime",
    shortLabel: "Playtime",
    caption: "Build a legacy across every game you play.",
  },
  {
    id: "month",
    label: "Monthly quests",
    shortLabel: "Monthly",
    caption: "A fresh set of goals every calendar month.",
  },
  {
    id: "game",
    label: "Game mastery",
    shortLabel: "Games",
    caption: "Climb a separate trophy ladder for every game.",
  },
  {
    id: "streak",
    label: "Play streaks",
    shortLabel: "Streaks",
    caption: "Keep returning and make play a ritual.",
  },
];

type LadderGame = {
  key: string;
  name: string;
  coverUrl: string;
  hours?: number;
  earnedCount: number;
};

export type GameLadder = {
  key: string;
  name: string;
  coverUrl?: string;
  hours?: number;
  rungs: AchievementCatalogItem[];
};

export type AchievementSummaryData = {
  fixedTotal: number;
  fixedUnlocked: number;
  completionPct: number;
  byTier: Record<AchievementTier, number>;
  gameTrophies: number;
  pastMonthTrophies: number;
  ladderGameCount: number;
};

export type MonthHistory = {
  monthKey: string;
  label: string;
  earned: AchievementCatalogItem[];
  highestThreshold: number;
};

export function buildAchievementCatalog(
  awardedMilestones: AwardedMilestone[],
  metrics: MilestoneMetrics,
  gameLabels: ReadonlyMap<string, GameLabel> = new Map(),
): AchievementCatalog {
  const catalog = new Map<string, AchievementCatalogItem>();
  const earnedById = new Map<string, AwardedMilestone>();
  const earnedGameByScopeThreshold = new Map<string, AwardedMilestone>();

  for (const milestone of awardedMilestones) {
    rememberEarlierAward(earnedById, milestone.id, milestone);
    for (const aliasId of milestone.aliasIds ?? []) {
      rememberEarlierAward(earnedById, aliasId, milestone);
    }

    const parsed = parseMilestoneId(milestone.id);
    if (!parsed) continue;
    const scope =
      parsed.category === "game"
        ? canonicalGameScope(milestone, metrics)
        : parsed.scope;
    if (parsed.category === "game") {
      rememberEarlierAward(
        earnedGameByScopeThreshold,
        gameRungKey(scope, parsed.threshold),
        milestone,
      );
    }

    const id =
      parsed.category === "game"
        ? gameMilestoneId(scope, parsed.threshold)
        : milestone.id;
    const currentValue = currentValueFor(milestone, metrics);
    const existing = catalog.get(id);
    const award = earlierAward(existing?.milestone, milestone);
    catalog.set(
      id,
      createItem({
        id,
        category: parsed.category,
        kind: milestone.kind,
        title: award.title,
        threshold: parsed.threshold,
        unit: unitFor(parsed.category),
        scope,
        coverUrl: award.coverUrl,
        currentValue,
        milestone: award,
      }),
    );
  }

  const ensure = (
    input: Omit<
      AchievementCatalogItem,
      "tier" | "ratio" | "isNext" | "milestone"
    >,
    awardOverride?: AwardedMilestone,
  ) => {
    const award =
      awardOverride ??
      earnedById.get(input.id) ??
      catalog.get(input.id)?.milestone;
    const existing = catalog.get(input.id);
    catalog.set(
      input.id,
      createItem({
        ...existing,
        ...input,
        title: input.title,
        coverUrl: award?.coverUrl || input.coverUrl,
        milestone: award,
      }),
    );
  };

  for (const threshold of TOTAL_HOURS) {
    ensure({
      id: `milestone:total:${threshold}`,
      category: "total",
      kind: "milestone-total",
      title: `You've played ${threshold.toLocaleString()} hours in total`,
      threshold,
      currentValue: metrics.totalHours,
      unit: "hours",
      scope: "",
    });
  }

  const currentMonth = monthLabel(metrics.monthKey);
  for (const threshold of MONTH_HOURS) {
    ensure({
      id: `milestone:month:${metrics.monthKey}:${threshold}`,
      category: "month",
      kind: "milestone-month",
      title: `${threshold.toLocaleString()} hours played in ${currentMonth}`,
      threshold,
      currentValue: metrics.monthHours,
      unit: "hours",
      scope: metrics.monthKey,
    });
  }

  for (const threshold of STREAK_DAYS) {
    ensure({
      id: `milestone:streak:${threshold}`,
      category: "streak",
      kind: "milestone-streak",
      title: `${threshold.toLocaleString()}-day play streak`,
      threshold,
      currentValue: metrics.streakDays,
      unit: "days",
      scope: "",
    });
  }

  for (const threshold of VERIFIED_COUNTS) {
    ensure({
      id: `milestone:verified:${threshold}`,
      category: "verified",
      kind: "milestone-verified",
      title:
        threshold === 1
          ? "Your first contribution was verified"
          : `${threshold.toLocaleString()} contributions verified`,
      threshold,
      currentValue: metrics.verifiedCount,
      unit: "contributions",
      scope: "",
    });
  }

  const ladderGames = selectLadderGames(awardedMilestones, metrics, gameLabels);
  ladderGames.forEach((game, ladderOrder) => {
    for (const threshold of GAME_HOURS) {
      const id = gameMilestoneId(game.key, threshold);
      ensure(
        {
          id,
          category: "game",
          kind: "milestone-game",
          title: `${threshold.toLocaleString()} hours played in ${game.name}`,
          threshold,
          currentValue: game.hours,
          unit: "hours",
          scope: game.key,
          gameName: game.name,
          coverUrl: game.coverUrl,
          ladderOrder,
        },
        earnedGameByScopeThreshold.get(gameRungKey(game.key, threshold)),
      );
    }
  });

  const result: AchievementCatalog = new Map();
  for (const group of GROUP_META) {
    const items = [...catalog.values()]
      .filter((item) => item.category === group.id)
      .sort(compareCatalogItems);
    markNextInEachLadder(items);
    result.set(group.id, items);
  }
  return result;
}

export function selectLadderGames(
  awardedMilestones: AwardedMilestone[],
  metrics: MilestoneMetrics,
  gameLabels: ReadonlyMap<string, GameLabel> = new Map(),
): LadderGame[] {
  const earned = new Map<string, AwardedMilestone[]>();
  for (const milestone of awardedMilestones) {
    const parsed = parseMilestoneId(milestone.id);
    if (parsed?.category !== "game") continue;
    const key = canonicalGameScope(milestone, metrics);
    earned.set(key, [...(earned.get(key) ?? []), milestone]);
  }

  const keys = new Set(earned.keys());
  const remaining = [...metrics.games.entries()]
    .filter(([key, game]) => !keys.has(key) && game.hours > 0)
    .sort((left, right) => right[1].hours - left[1].hours)
    .slice(0, 8);
  for (const [key] of remaining) keys.add(key);

  return [...keys]
    .map((key) => {
      const awards = earned.get(key) ?? [];
      const metricGame = metrics.games.get(key);
      const metadata = gameLabels.get(key);
      const parsedName = [...awards]
        .sort(
          (left, right) => milestoneThreshold(right) - milestoneThreshold(left),
        )
        .map((award) =>
          gameNameFromMilestoneTitle(award.title, milestoneThreshold(award)),
        )
        .find((name): name is string => Boolean(name));
      const metricName = metricGame?.name.trim();
      const name =
        metadata?.name.trim() ||
        (metricName && metricName.toLowerCase() !== "a game"
          ? metricName
          : undefined) ||
        parsedName ||
        "Unknown game";
      const coverUrl =
        metadata?.coverUrl ||
        metricGame?.coverUrl ||
        awards.find((award) => award.coverUrl)?.coverUrl ||
        "";
      return {
        key,
        name,
        coverUrl,
        hours: metricGame?.hours,
        earnedCount: awards.length,
      };
    })
    .sort(
      (left, right) =>
        right.earnedCount - left.earnedCount ||
        (right.hours ?? -1) - (left.hours ?? -1) ||
        left.name.localeCompare(right.name, undefined, { numeric: true }),
    );
}

export function buildGameLadders(catalog: AchievementCatalog): GameLadder[] {
  const ladders = new Map<string, GameLadder>();
  for (const item of catalog.get("game") ?? []) {
    const ladder = ladders.get(item.scope) ?? {
      key: item.scope,
      name: item.gameName ?? "Unknown game",
      coverUrl: item.coverUrl,
      hours: item.currentValue,
      rungs: [],
    };
    ladder.rungs.push(item);
    if (!ladder.coverUrl && item.coverUrl) ladder.coverUrl = item.coverUrl;
    ladders.set(item.scope, ladder);
  }
  return [...ladders.values()];
}

export function summarizeAchievements(
  catalog: AchievementCatalog,
  currentMonthKey: string,
): AchievementSummaryData {
  const items = flattenCatalog(catalog);
  const fixed = items.filter(
    (item) =>
      item.category === "total" ||
      item.category === "streak" ||
      item.category === "verified" ||
      (item.category === "month" && item.scope === currentMonthKey),
  );
  const unlocked = items.filter((item) => item.milestone);
  const byTier: Record<AchievementTier, number> = {
    bronze: 0,
    silver: 0,
    gold: 0,
    platinum: 0,
  };
  for (const item of unlocked) byTier[item.tier] += 1;
  const fixedUnlocked = fixed.filter((item) => item.milestone).length;
  return {
    fixedTotal: fixed.length,
    fixedUnlocked,
    completionPct:
      fixed.length === 0 ? 0 : Math.round((fixedUnlocked / fixed.length) * 100),
    byTier,
    gameTrophies: unlocked.filter((item) => item.category === "game").length,
    pastMonthTrophies: unlocked.filter(
      (item) => item.category === "month" && item.scope !== currentMonthKey,
    ).length,
    ladderGameCount: new Set(
      (catalog.get("game") ?? []).map((item) => item.scope),
    ).size,
  };
}

export function recentUnlocks(
  catalog: AchievementCatalog,
  limit = 5,
): AchievementCatalogItem[] {
  return flattenCatalog(catalog)
    .filter((item) => item.milestone)
    .sort(
      (left, right) =>
        Date.parse(right.milestone!.awardedAt) -
        Date.parse(left.milestone!.awardedAt),
    )
    .slice(0, limit);
}

export function buildMonthHistory(
  catalog: AchievementCatalog,
  currentMonthKey: string,
): MonthHistory[] {
  const months = new Map<string, AchievementCatalogItem[]>();
  for (const item of catalog.get("month") ?? []) {
    if (!item.milestone || item.scope === currentMonthKey) continue;
    months.set(item.scope, [...(months.get(item.scope) ?? []), item]);
  }
  return [...months.entries()]
    .sort(([left], [right]) => right.localeCompare(left))
    .map(([monthKey, earned]) => ({
      monthKey,
      label: monthLabel(monthKey),
      earned: [...earned].sort(
        (left, right) => left.threshold - right.threshold,
      ),
      highestThreshold: Math.max(...earned.map((item) => item.threshold)),
    }));
}

const GENERATED_GAME_TITLE =
  /^([\d.,\u00a0\u202f\s]+)\s*hours played in\s+(.+?)\s*$/i;

export function gameNameFromMilestoneTitle(
  title: string,
  threshold?: number,
): string | undefined {
  const match = GENERATED_GAME_TITLE.exec(title.trim());
  if (!match) return undefined;
  if (threshold !== undefined) {
    const digits = match[1].replace(/\D/g, "");
    if (digits !== String(threshold)) return undefined;
  }
  const name = match[2].trim();
  if (!name || name.toLowerCase() === "a game") return undefined;
  return name;
}

export function remainderLabel(item: AchievementCatalogItem) {
  const amount = Math.max(0, Math.ceil(remainder(item)));
  const unit =
    item.unit === "days"
      ? amount === 1
        ? "day"
        : "days"
      : item.unit === "hours"
        ? amount === 1
          ? "hour"
          : "hours"
        : amount === 1
          ? "contribution"
          : "contributions";
  return `${amount.toLocaleString()} more ${unit}`;
}

export function progressLabel(
  currentValue: number,
  threshold: number,
  unit: AchievementUnit,
) {
  const current = Math.max(0, currentValue).toLocaleString(undefined, {
    maximumFractionDigits: 1,
  });
  return `${current} / ${threshold.toLocaleString()} ${unit}`;
}

export function monthLabel(scope: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(scope);
  if (!match) return scope;
  return new Date(Number(match[1]), Number(match[2]) - 1, 1).toLocaleDateString(
    [],
    { month: "long", year: "numeric" },
  );
}

function createItem(
  input: Omit<AchievementCatalogItem, "tier" | "ratio" | "isNext">,
): AchievementCatalogItem {
  const current = Math.max(0, input.currentValue ?? 0);
  return {
    ...input,
    tier: achievementArt({ id: input.id, kind: input.kind }).tier,
    ratio: input.milestone
      ? 1
      : Math.min(1, input.threshold > 0 ? current / input.threshold : 0),
  };
}

function currentValueFor(
  milestone: AwardedMilestone,
  metrics: MilestoneMetrics,
) {
  const parsed = parseMilestoneId(milestone.id);
  if (!parsed) return undefined;
  switch (parsed.category) {
    case "total":
      return metrics.totalHours;
    case "month":
      return parsed.scope === metrics.monthKey ? metrics.monthHours : undefined;
    case "game": {
      for (const id of [milestone.id, ...(milestone.aliasIds ?? [])]) {
        const candidate = parseMilestoneId(id);
        if (candidate?.category !== "game") continue;
        const canonical = metrics.canonicalByAlias.get(candidate.scope);
        if (canonical) return metrics.games.get(canonical)?.hours;
      }
      return metrics.games.get(parsed.scope)?.hours;
    }
    case "streak":
      return metrics.streakDays;
    case "verified":
      return metrics.verifiedCount;
  }
}

function canonicalGameScope(
  milestone: AwardedMilestone,
  metrics: MilestoneMetrics,
) {
  for (const id of [milestone.id, ...(milestone.aliasIds ?? [])]) {
    const parsed = parseMilestoneId(id);
    if (parsed?.category !== "game") continue;
    const canonical = metrics.canonicalByAlias.get(parsed.scope);
    if (canonical) return canonical;
  }
  return parseMilestoneId(milestone.id)?.scope ?? "unknown";
}

function markNextInEachLadder(items: AchievementCatalogItem[]) {
  const ladders = new Map<string, AchievementCatalogItem[]>();
  for (const item of items) {
    const key =
      item.category === "game" || item.category === "month"
        ? `${item.category}:${item.scope}`
        : item.category;
    ladders.set(key, [...(ladders.get(key) ?? []), item]);
  }
  for (const ladder of ladders.values()) {
    const ordered = [...ladder].sort(
      (left, right) => left.threshold - right.threshold,
    );
    const next =
      ordered.find(
        (item) =>
          !item.milestone &&
          Math.max(0, item.currentValue ?? 0) < item.threshold,
      ) ?? ordered.find((item) => !item.milestone);
    if (next) next.isNext = true;
  }
}

function compareCatalogItems(
  left: AchievementCatalogItem,
  right: AchievementCatalogItem,
) {
  if (left.category !== right.category) {
    return groupRank(left.category) - groupRank(right.category);
  }
  if (left.category === "game") {
    return (
      (left.ladderOrder ?? Number.MAX_SAFE_INTEGER) -
        (right.ladderOrder ?? Number.MAX_SAFE_INTEGER) ||
      (left.gameName ?? "").localeCompare(right.gameName ?? "", undefined, {
        numeric: true,
      }) ||
      left.threshold - right.threshold
    );
  }
  if (left.category === "month") {
    return (
      right.scope.localeCompare(left.scope) || left.threshold - right.threshold
    );
  }
  return left.threshold - right.threshold;
}

function groupRank(category: MilestoneCategory) {
  return GROUP_META.findIndex((group) => group.id === category);
}

function unitFor(category: MilestoneCategory): AchievementUnit {
  if (category === "streak") return "days";
  if (category === "verified") return "contributions";
  return "hours";
}

function flattenCatalog(catalog: AchievementCatalog) {
  return [...catalog.values()].flat();
}

function remainder(item: AchievementCatalogItem) {
  return item.threshold - Math.max(0, item.currentValue ?? 0);
}

function milestoneThreshold(milestone: AwardedMilestone) {
  return parseMilestoneId(milestone.id)?.threshold ?? 0;
}

function gameMilestoneId(scope: string, threshold: number) {
  return `milestone:game:${scope}:${threshold}`;
}

function gameRungKey(scope: string, threshold: number) {
  return `${scope}:${threshold}`;
}

function earlierAward(
  left: AwardedMilestone | undefined,
  right: AwardedMilestone,
) {
  if (!left) return right;
  return Date.parse(left.awardedAt) <= Date.parse(right.awardedAt)
    ? left
    : right;
}

function rememberEarlierAward(
  map: Map<string, AwardedMilestone>,
  key: string,
  milestone: AwardedMilestone,
) {
  map.set(key, earlierAward(map.get(key), milestone));
}
