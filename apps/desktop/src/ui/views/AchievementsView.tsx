import { useMemo } from "react";
import {
  MONTH_HOURS,
  STREAK_DAYS,
  TOTAL_HOURS,
  VERIFIED_COUNTS,
  milestoneMetrics,
  parseMilestoneId,
  type AwardedMilestone,
  type MilestoneCategory,
  type MilestoneNotificationKind,
} from "../../milestones";
import { displayNotificationTitle } from "../../notifications";
import { createGameIdentityResolver, useAppStore } from "../../store";
import { NotificationArt } from "../AchievementBadge";
import { Panel } from "../components";

type CatalogItem = {
  id: string;
  category: MilestoneCategory;
  kind: MilestoneNotificationKind;
  title: string;
  threshold: number;
  coverUrl?: string;
  currentValue?: number;
  unit: "hours" | "days" | "contributions";
  sortLabel?: string;
  milestone?: AwardedMilestone;
};

const GROUPS: Array<{
  category: MilestoneCategory;
  label: string;
}> = [
  { category: "total", label: "Total playtime" },
  { category: "month", label: "Monthly" },
  { category: "streak", label: "Streaks" },
  { category: "verified", label: "Contributions" },
];

export function AchievementsView() {
  const awardedMilestones = useAppStore((state) => state.awardedMilestones);
  const sessions = useAppStore((state) => state.recentSessions);
  const archivedSeconds = useAppStore((state) => state.archivedSeconds);
  const archivedGameSeconds = useAppStore((state) => state.archivedGameSeconds);
  const playtimeAdjustments = useAppStore((state) => state.playtimeAdjustments);
  const verifiedContributions = useAppStore(
    (state) => state.contributionCounts.verified,
  );
  const gameMetadata = useAppStore((state) => state.gameMetadata);
  const exeCache = useAppStore((state) => state.exeCache);
  const resolveIgdbId = useMemo(
    () => createGameIdentityResolver(gameMetadata, exeCache),
    [exeCache, gameMetadata],
  );
  const metrics = useMemo(
    () =>
      milestoneMetrics({
        sessions,
        archivedSeconds,
        archivedGameSeconds,
        playtimeAdjustments,
        verifiedContributions,
        resolveIgdbId,
      }),
    [
      archivedGameSeconds,
      archivedSeconds,
      playtimeAdjustments,
      resolveIgdbId,
      sessions,
      verifiedContributions,
    ],
  );
  const groups = useMemo(
    () => buildAchievementCatalog(awardedMilestones, metrics),
    [awardedMilestones, metrics],
  );

  return (
    <div className="grid gap-6">
      {GROUPS.map((group) => {
        const items = groups.get(group.category) ?? [];
        const unlocked = items.filter((item) => item.milestone).length;
        return (
          <Panel key={group.category} className="overflow-hidden">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div>
                <h2 className="text-lg font-semibold text-text">
                  {group.label}
                </h2>
                {group.category === "month" ? (
                  <p className="mt-0.5 text-xs text-text-muted">
                    New monthly goals appear each calendar month.
                  </p>
                ) : null}
              </div>
              <span className="rounded-full bg-surface-hover px-2.5 py-1 text-xs font-medium text-text-muted">
                {unlocked} / {items.length} unlocked
              </span>
            </div>
            <div className="grid gap-px bg-border/70 sm:grid-cols-2">
              {items.map((item) => (
                <AchievementRow key={item.id} item={item} />
              ))}
            </div>
          </Panel>
        );
      })}
    </div>
  );
}

export function buildAchievementCatalog(
  awardedMilestones: AwardedMilestone[],
  metrics: ReturnType<typeof milestoneMetrics>,
) {
  const catalog = new Map<string, CatalogItem>();
  const earnedById = new Map<string, AwardedMilestone>();
  for (const milestone of awardedMilestones) {
    earnedById.set(milestone.id, milestone);
    for (const aliasId of milestone.aliasIds ?? []) {
      earnedById.set(aliasId, milestone);
    }
    const parsed = parseMilestoneId(milestone.id);
    if (!parsed) continue;
    catalog.set(milestone.id, {
      id: milestone.id,
      category: parsed.category,
      kind: milestone.kind,
      title: milestone.title,
      threshold: parsed.threshold,
      coverUrl: milestone.coverUrl,
      currentValue: currentValueFor(milestone, metrics),
      unit: unitFor(parsed.category),
      sortLabel: parsed.scope,
      milestone,
    });
  }

  const ensure = (item: Omit<CatalogItem, "milestone">) => {
    const milestone = earnedById.get(item.id);
    const key = milestone?.id ?? item.id;
    catalog.set(key, {
      ...(catalog.get(key) ?? item),
      ...item,
      id: key,
      milestone,
    });
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
    });
  }

  const result = new Map<MilestoneCategory, CatalogItem[]>();
  for (const group of GROUPS) {
    result.set(
      group.category,
      [...catalog.values()]
        .filter((item) => item.category === group.category)
        .sort(compareCatalogItems),
    );
  }
  return result;
}

function AchievementRow({ item }: { item: CatalogItem }) {
  const unlocked = Boolean(item.milestone);
  const title = item.milestone
    ? displayNotificationTitle({ ...item.milestone, title: item.title })
    : item.title;
  const visual = {
    id: item.id,
    kind: item.kind,
    title,
    coverUrl: item.coverUrl,
  };

  return (
    <article
      className={`flex min-w-0 gap-4 bg-surface px-5 py-4 ${unlocked ? "" : "opacity-60"}`}
    >
      <NotificationArt notification={visual} />
      <div className="min-w-0">
        <h3 className="break-words text-sm font-medium text-text">{title}</h3>
        {item.milestone ? (
          <time
            dateTime={item.milestone.awardedAt}
            className="mt-1 block text-xs text-text-muted"
          >
            Reached {new Date(item.milestone.awardedAt).toLocaleString()}
          </time>
        ) : (
          <AchievementProgress
            currentValue={item.currentValue}
            threshold={item.threshold}
            unit={item.unit}
          />
        )}
      </div>
    </article>
  );
}

function AchievementProgress({
  currentValue,
  threshold,
  unit,
}: {
  currentValue?: number;
  threshold: number;
  unit: CatalogItem["unit"];
}) {
  const current = Math.max(0, currentValue ?? 0);
  const progress = Math.min(100, (current / threshold) * 100);
  return (
    <div className="mt-2">
      <div className="mb-1 flex items-center justify-between gap-3 text-[11px] text-text-muted">
        <span className="font-medium">Progress</span>
        <span className="shrink-0 font-mono">
          {progressLabel(current, threshold, unit)}
        </span>
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-surface-hover"
        role="progressbar"
        aria-label="Achievement progress"
        aria-valuemin={0}
        aria-valuemax={threshold}
        aria-valuenow={Math.min(current, threshold)}
      >
        <div
          className="h-full rounded-full bg-accent transition-[width]"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}

function currentValueFor(
  milestone: AwardedMilestone,
  metrics: ReturnType<typeof milestoneMetrics>,
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
      return undefined;
    }
    case "streak":
      return metrics.streakDays;
    case "verified":
      return metrics.verifiedCount;
  }
}

function unitFor(category: MilestoneCategory): CatalogItem["unit"] {
  if (category === "streak") return "days";
  if (category === "verified") return "contributions";
  return "hours";
}

function compareCatalogItems(left: CatalogItem, right: CatalogItem) {
  const leftParsed = parseMilestoneId(left.id);
  const rightParsed = parseMilestoneId(right.id);
  if (left.category === "game") {
    const byTitle = (left.sortLabel ?? "").localeCompare(
      right.sortLabel ?? "",
      undefined,
      {
        numeric: true,
      },
    );
    if (byTitle !== 0) return byTitle;
  }
  if (left.category === "month") {
    const byMonth = (rightParsed?.scope ?? "").localeCompare(
      leftParsed?.scope ?? "",
    );
    if (byMonth !== 0) return byMonth;
  }
  return left.threshold - right.threshold;
}

function progressLabel(
  currentValue: number,
  threshold: number,
  unit: CatalogItem["unit"],
) {
  const current = Math.max(0, currentValue).toLocaleString(undefined, {
    maximumFractionDigits: 1,
  });
  return `${current} / ${threshold.toLocaleString()} ${unit}`;
}

function monthLabel(scope: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(scope);
  if (!match) return scope;
  return new Date(Number(match[1]), Number(match[2]) - 1, 1).toLocaleDateString(
    [],
    { month: "long", year: "numeric" },
  );
}
