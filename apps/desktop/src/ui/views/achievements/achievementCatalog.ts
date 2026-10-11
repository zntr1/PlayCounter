import { achievementArt, type AchievementTier } from "../../../achievementArt";
import {
  EMULATOR_VERIFIED_COUNTS,
  GAME_HOURS,
  MONTH_HOURS,
  PLAY_STREAK_ACHIEVEMENTS_ENABLED,
  STREAK_DAYS,
  TOTAL_HOURS,
  VERIFIED_COUNTS,
  milestoneTitle,
  parseMilestoneId,
  type AwardedMilestone,
  type MilestoneCategory,
  type MilestoneMetrics,
  type MilestoneNotificationKind,
} from "../../../milestones";
import { appLocale, getT } from "../../../i18n";

const t = getT("achievements");

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

function allGroupMeta(): Array<{
  id: AchievementGroupId;
  label: string;
  shortLabel: string;
  caption: string;
}> {
  return [
    {
      id: "verified",
      label: t("Community contributions"),
      shortLabel: t("Contributions"),
      caption: t("Help PlayCounter recognize more games for everyone."),
    },
    {
      id: "emulator",
      label: t("Emulator contributions"),
      shortLabel: t("Emulators"),
      caption: t("Help PlayCounter recognize the games you play in emulators."),
    },
    {
      id: "total",
      label: t("Lifetime playtime"),
      shortLabel: t("Playtime"),
      caption: t("Build a legacy across every game you play."),
    },
    {
      id: "month",
      label: t("Monthly quests"),
      shortLabel: t("Monthly"),
      caption: t("A fresh set of goals every calendar month."),
    },
    {
      id: "game",
      label: t("Game mastery"),
      shortLabel: t("Games"),
      caption: t("Climb a separate trophy ladder for every game."),
    },
    {
      id: "streak",
      label: t("Play streaks"),
      shortLabel: t("Streaks"),
      caption: t("Keep returning and make play a ritual."),
    },
  ];
}

export function groupMeta() {
  return allGroupMeta().filter(
    (group) => PLAY_STREAK_ACHIEVEMENTS_ENABLED || group.id !== "streak",
  );
}

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
        title: awardTitle(award),
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
      "tier" | "ratio" | "isNext" | "milestone" | "title"
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
        title: milestoneTitle(input, input.gameName),
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
      threshold,
      currentValue: metrics.totalHours,
      unit: "hours",
      scope: "",
    });
  }

  for (const threshold of MONTH_HOURS) {
    ensure({
      id: `milestone:month:${metrics.monthKey}:${threshold}`,
      category: "month",
      kind: "milestone-month",
      threshold,
      currentValue: metrics.monthHours,
      unit: "hours",
      scope: metrics.monthKey,
    });
  }

  if (PLAY_STREAK_ACHIEVEMENTS_ENABLED) {
    for (const threshold of STREAK_DAYS) {
      ensure({
        id: `milestone:streak:${threshold}`,
        category: "streak",
        kind: "milestone-streak",
        threshold,
        currentValue: metrics.streakDays,
        unit: "days",
        scope: "",
      });
    }
  }

  for (const threshold of VERIFIED_COUNTS) {
    ensure({
      id: `milestone:verified:${threshold}`,
      category: "verified",
      kind: "milestone-verified",
      threshold,
      currentValue: metrics.verifiedCount,
      unit: "contributions",
      scope: "",
    });
  }

  for (const threshold of EMULATOR_VERIFIED_COUNTS) {
    ensure({
      id: `milestone:emulator:${threshold}`,
      category: "emulator",
      kind: "milestone-emulator",
      threshold,
      currentValue: metrics.verifiedEmulatorCount,
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
  for (const group of groupMeta()) {
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
      const awardName = [...awards]
        .sort(
          (left, right) => milestoneThreshold(right) - milestoneThreshold(left),
        )
        .map((award) => awardGameName(award, milestoneThreshold(award)))
        .find((name): name is string => Boolean(name));
      const metricName = metricGame?.name.trim();
      const name =
        metadata?.name.trim() ||
        (metricName && metricName.toLowerCase() !== "a game"
          ? metricName
          : undefined) ||
        awardName ||
        t("Unknown game");
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
      name: item.gameName ?? t("Unknown game"),
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
      item.category === "emulator" ||
      (item.category === "month" && item.scope === currentMonthKey),
  );
  const unlocked = items.filter((item) => item.milestone);
  const byTier: Record<AchievementTier, number> = {
    bronze: 0,
    silver: 0,
    gold: 0,
    platinum: 0,
    diamond: 0,
    master: 0,
    grandmaster: 0,
    legendary: 0,
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

/** An earned award's text, made again from its id so it follows the app's
 *  language. An old game award whose name can't be found keeps its title. */
function awardTitle(award: AwardedMilestone) {
  const parsed = parseMilestoneId(award.id);
  if (!parsed) return award.title;
  if (parsed.category !== "game") return milestoneTitle(parsed);
  const name = awardGameName(award, parsed.threshold);
  return name ? milestoneTitle(parsed, name) : award.title;
}

/** The saved name, else (awards from before it was saved) the name inside
 *  the English title. */
function awardGameName(award: AwardedMilestone, threshold: number) {
  if (award.gameName && award.gameName.toLowerCase() !== "a game") {
    return award.gameName;
  }
  return gameNameFromMilestoneTitle(award.title, threshold);
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

/** What is left to reach the rung, rounded up: hours, days or contributions. */
export function remainingAmount(item: AchievementCatalogItem) {
  return Math.max(0, Math.ceil(remainder(item)));
}

export function remainderLabel(item: AchievementCatalogItem) {
  const count = remainingAmount(item);
  return item.unit === "days"
    ? t("{{count, number}} more days", { count })
    : item.unit === "hours"
      ? t("{{count, number}} more hours", { count })
      : t("{{count, number}} more contributions", { count });
}

export function progressLabel(
  currentValue: number,
  threshold: number,
  unit: AchievementUnit,
) {
  const current = Math.max(0, currentValue).toLocaleString(appLocale(), {
    maximumFractionDigits: 1,
  });
  const values = { current, threshold: threshold.toLocaleString(appLocale()) };
  return unit === "hours"
    ? t("{{current}} / {{threshold}} hours", values)
    : unit === "days"
      ? t("{{current}} / {{threshold}} days", values)
      : t("{{current}} / {{threshold}} contributions", values);
}

export function monthLabel(scope: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(scope);
  if (!match) return scope;
  return new Date(Number(match[1]), Number(match[2]) - 1, 1).toLocaleDateString(
    appLocale(),
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
    case "emulator":
      return metrics.verifiedEmulatorCount;
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
  return groupMeta().findIndex((group) => group.id === category);
}

function unitFor(category: MilestoneCategory): AchievementUnit {
  if (category === "streak") return "days";
  if (category === "verified" || category === "emulator") {
    return "contributions";
  }
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
