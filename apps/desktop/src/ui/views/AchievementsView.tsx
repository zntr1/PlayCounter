import { useMemo, useState } from "react";
import {
  BadgeCheck,
  CalendarCheck,
  Flame,
  Gamepad2,
  Joystick,
  Trophy,
  type LucideIcon,
} from "lucide-react";
import clsx from "clsx";
import { milestoneMetrics } from "../../milestones";
import {
  createGameIdentityResolver,
  resolvedCanonicalGameKey,
  useAppStore,
} from "../../store";
import { SectionToggle, useSectionCollapse } from "../CollapsibleSection";
import { Panel } from "../components";
import { AchievementCard } from "./achievements/AchievementCard";
import { AchievementSummary } from "./achievements/AchievementSummary";
import { GameLadderRow } from "./achievements/GameLadderRow";
import { MonthHistoryRow } from "./achievements/MonthHistoryRow";
import {
  GROUP_META,
  buildAchievementCatalog,
  buildGameLadders,
  buildMonthHistory,
  recentUnlocks,
  summarizeAchievements,
  type AchievementCatalogItem,
  type AchievementGroupId,
} from "./achievements/achievementCatalog";

type CategoryFilter = "all" | AchievementGroupId;
type StatusFilter = "all" | "unlocked" | "in-progress";

const GROUP_ICONS: Record<AchievementGroupId, LucideIcon> = {
  total: Trophy,
  month: CalendarCheck,
  game: Gamepad2,
  streak: Flame,
  verified: BadgeCheck,
  emulator: Joystick,
};

const STATUS_FILTERS: Array<{ id: StatusFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "unlocked", label: "Unlocked" },
  { id: "in-progress", label: "In progress" },
];

export function AchievementsView() {
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const awardedMilestones = useAppStore((state) => state.awardedMilestones);
  const sessions = useAppStore((state) => state.recentSessions);
  const archivedSeconds = useAppStore((state) => state.archivedSeconds);
  const archivedGameSeconds = useAppStore((state) => state.archivedGameSeconds);
  const playtimeAdjustments = useAppStore((state) => state.playtimeAdjustments);
  const verifiedContributions = useAppStore(
    (state) => state.contributionCounts.verified,
  );
  const verifiedEmulatorContributions = useAppStore(
    (state) => state.emulatorContributionCounts.verified,
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
        verifiedEmulatorContributions,
        resolveIgdbId,
      }),
    [
      archivedGameSeconds,
      archivedSeconds,
      playtimeAdjustments,
      resolveIgdbId,
      sessions,
      verifiedContributions,
      verifiedEmulatorContributions,
    ],
  );
  const gameLabels = useMemo(() => {
    const labels = new Map<string, { name: string; coverUrl: string }>();
    for (const game of gameMetadata.values()) {
      labels.set(
        resolvedCanonicalGameKey(
          {
            gameId: game.id,
            source: game.source,
            igdbId: game.igdbId,
            gameName: game.name,
            coverUrl: game.coverUrl,
          },
          resolveIgdbId,
        ),
        { name: game.name, coverUrl: game.coverUrl },
      );
    }
    return labels;
  }, [gameMetadata, resolveIgdbId]);
  const catalog = useMemo(
    () => buildAchievementCatalog(awardedMilestones, metrics, gameLabels),
    [awardedMilestones, gameLabels, metrics],
  );
  const summary = useMemo(
    () => summarizeAchievements(catalog, metrics.monthKey),
    [catalog, metrics.monthKey],
  );
  const recent = useMemo(() => recentUnlocks(catalog), [catalog]);
  const monthHistory = useMemo(
    () => buildMonthHistory(catalog, metrics.monthKey),
    [catalog, metrics.monthKey],
  );
  const gameLadders = useMemo(() => buildGameLadders(catalog), [catalog]);
  const hiddenGameCount = useMemo(() => {
    const displayed = new Set(
      (catalog.get("game") ?? []).map((item) => item.scope),
    );
    return [...metrics.games.entries()].filter(
      ([key, game]) => game.hours > 0 && !displayed.has(key),
    ).length;
  }, [catalog, metrics.games]);
  const visibleCount = GROUP_META.filter(
    (group) => category === "all" || category === group.id,
  ).reduce(
    (count, group) =>
      count +
      (catalog.get(group.id) ?? []).filter((item) =>
        matchesStatus(item, status),
      ).length,
    0,
  );

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <AchievementSummary summary={summary} recent={recent} />

      <Panel className="sticky top-0 z-30 flex min-w-0 flex-wrap items-center justify-between gap-4 p-4">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <FilterButton
            active={category === "all"}
            onClick={() => setCategory("all")}
          >
            All ·{" "}
            {formatCount(
              flattenCatalog(catalog).filter((item) => item.milestone).length,
            )}
            /{formatCount(flattenCatalog(catalog).length)}
          </FilterButton>
          {GROUP_META.map((group) => {
            const items = catalog.get(group.id) ?? [];
            return (
              <FilterButton
                key={group.id}
                active={category === group.id}
                onClick={() => setCategory(group.id)}
              >
                {group.shortLabel} ·{" "}
                {items.filter((item) => item.milestone).length}/{items.length}
              </FilterButton>
            );
          })}
        </div>
        <div className="flex items-center rounded-full border border-border bg-bg p-1">
          {STATUS_FILTERS.map((filter) => (
            <button
              key={filter.id}
              type="button"
              aria-pressed={status === filter.id}
              onClick={() => setStatus(filter.id)}
              className={clsx(
                "rounded-full px-3 py-1 text-xs font-semibold transition",
                status === filter.id
                  ? "bg-surface-hover text-text shadow-sm"
                  : "text-text-muted hover:text-text",
              )}
            >
              {filter.label}
            </button>
          ))}
        </div>
        <p className="sr-only" aria-live="polite">
          Showing {visibleCount} achievements
        </p>
      </Panel>

      <div className="grid gap-6">
        {GROUP_META.filter(
          (group) => category === "all" || category === group.id,
        ).map((group) => {
          const items = catalog.get(group.id) ?? [];
          const matching = items.filter((item) => matchesStatus(item, status));
          if (category === "all" && status !== "all" && matching.length === 0) {
            return null;
          }
          return (
            <AchievementSection
              key={group.id}
              category={group.id}
              items={items}
              matching={matching}
              currentMonthKey={metrics.monthKey}
              monthHistory={monthHistory}
              gameLadders={gameLadders}
              hiddenGameCount={hiddenGameCount}
              status={status}
            />
          );
        })}
      </div>
    </div>
  );
}

function AchievementSection({
  category,
  items,
  matching,
  currentMonthKey,
  monthHistory,
  gameLadders,
  hiddenGameCount,
  status,
}: {
  category: AchievementGroupId;
  items: AchievementCatalogItem[];
  matching: AchievementCatalogItem[];
  currentMonthKey: string;
  monthHistory: ReturnType<typeof buildMonthHistory>;
  gameLadders: ReturnType<typeof buildGameLadders>;
  hiddenGameCount: number;
  status: StatusFilter;
}) {
  const meta = GROUP_META.find((group) => group.id === category)!;
  const Icon = GROUP_ICONS[category];
  const unlocked = items.filter((item) => item.milestone).length;
  const progress = items.length === 0 ? 0 : (unlocked / items.length) * 100;
  const section = useSectionCollapse(`achievements.${category}`);
  const bodyId = `achievement-section-${category}`;

  return (
    <Panel className="overflow-hidden">
      <div
        className={clsx(
          "px-5 py-4",
          !section.collapsed && "border-b border-border",
        )}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <div className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent/10 text-accent">
              <Icon aria-hidden="true" size={18} />
            </div>
            <div className="min-w-0">
              <h2 className="text-lg font-bold tracking-tight text-text">
                {meta.label}
              </h2>
              <p className="mt-0.5 text-xs text-text-muted">{meta.caption}</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="rounded-full bg-surface-hover px-2.5 py-1 text-xs font-semibold text-text-muted">
              {unlocked} / {items.length} unlocked
            </span>
            <SectionToggle
              collapsed={section.collapsed}
              onToggle={section.toggle}
              controls={bodyId}
              label={meta.label}
            />
          </div>
        </div>
        <div
          className="mt-3 h-1 overflow-hidden rounded-full bg-surface-hover"
          role="progressbar"
          aria-label={`${meta.label} completion`}
          aria-valuemin={0}
          aria-valuemax={items.length}
          aria-valuenow={unlocked}
          aria-valuetext={`${unlocked} of ${items.length} unlocked`}
        >
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-500 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
      {!section.collapsed ? (
        <div id={bodyId} className="p-4 sm:p-5">
          {category === "game" ? (
            <GameSection
              ladders={gameLadders}
              hiddenGameCount={hiddenGameCount}
              status={status}
            />
          ) : category === "month" ? (
            <MonthSection
              items={matching.filter((item) => item.scope === currentMonthKey)}
              history={status === "in-progress" ? [] : monthHistory}
            />
          ) : matching.length > 0 ? (
            <CardGrid items={matching} />
          ) : (
            <NoFilterResults />
          )}
        </div>
      ) : null}
    </Panel>
  );
}

function MonthSection({
  items,
  history,
}: {
  items: AchievementCatalogItem[];
  history: ReturnType<typeof buildMonthHistory>;
}) {
  return (
    <div className="grid gap-6">
      {items.length > 0 ? (
        <div>
          <h3 className="mb-3 text-xs font-bold uppercase tracking-[0.16em] text-text-faint">
            This month
          </h3>
          <CardGrid items={items} />
        </div>
      ) : null}
      {history.length > 0 ? (
        <div>
          <div className="mb-3 flex items-baseline justify-between gap-4">
            <h3 className="text-xs font-bold uppercase tracking-[0.16em] text-text-faint">
              Earlier months
            </h3>
            <span className="text-xs text-text-faint">
              Milestones shown; exact past totals are not stored
            </span>
          </div>
          <div className="grid gap-2 lg:grid-cols-2">
            {history.map((month) => (
              <MonthHistoryRow key={month.monthKey} month={month} />
            ))}
          </div>
        </div>
      ) : null}
      {items.length === 0 && history.length === 0 ? <NoFilterResults /> : null}
    </div>
  );
}

function GameSection({
  ladders,
  hiddenGameCount,
  status,
}: {
  ladders: ReturnType<typeof buildGameLadders>;
  hiddenGameCount: number;
  status: StatusFilter;
}) {
  const visible = ladders.filter((ladder) => {
    if (status === "all") return true;
    if (status === "unlocked")
      return ladder.rungs.some((rung) => rung.milestone);
    return ladder.rungs.some(
      (rung) => !rung.milestone && rung.isNext && rung.ratio > 0,
    );
  });

  if (ladders.length === 0 && status === "all") {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-12 text-center">
        <div className="mb-3 grid h-14 w-14 place-items-center rounded-full bg-surface-hover text-text-faint">
          <Gamepad2 aria-hidden="true" size={27} />
        </div>
        <h3 className="text-base font-bold text-text">No game trophies yet</h3>
        <p className="mt-1 max-w-sm text-sm text-text-muted">
          Play any tracked game for 10 hours to unlock its first trophy.
        </p>
      </div>
    );
  }
  if (visible.length === 0) return <NoFilterResults />;

  return (
    <div className="grid gap-3">
      {visible.map((ladder) => (
        <GameLadderRow key={ladder.key} ladder={ladder} />
      ))}
      {hiddenGameCount > 0 ? (
        <p className="pt-1 text-center text-xs text-text-faint">
          +{hiddenGameCount} more tracked{" "}
          {hiddenGameCount === 1 ? "game" : "games"} will appear as they
          approach a trophy
        </p>
      ) : null}
    </div>
  );
}

function CardGrid({ items }: { items: AchievementCatalogItem[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
      {items.map((item) => (
        <AchievementCard key={item.id} item={item} />
      ))}
    </div>
  );
}

function NoFilterResults() {
  return (
    <div className="rounded-xl border border-dashed border-border py-10 text-center text-sm font-medium text-text-muted">
      No achievements match this filter.
    </div>
  );
}

function FilterButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={clsx(
        "rounded-full border px-3 py-1.5 text-xs font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50",
        active
          ? "border-accent bg-accent text-accent-fg shadow-sm"
          : "border-border bg-surface text-text-muted hover:border-text-muted/30 hover:text-text",
      )}
    >
      {children}
    </button>
  );
}

function matchesStatus(item: AchievementCatalogItem, status: StatusFilter) {
  if (status === "unlocked") return Boolean(item.milestone);
  if (status === "in-progress") {
    return !item.milestone && item.ratio > 0 && item.isNext;
  }
  return true;
}

function flattenCatalog(catalog: ReturnType<typeof buildAchievementCatalog>) {
  return [...catalog.values()].flat();
}

function formatCount(value: number) {
  return value.toLocaleString();
}
