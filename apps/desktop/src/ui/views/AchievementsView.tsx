import { useMemo, useState, type KeyboardEvent } from "react";
import {
  BadgeCheck,
  CalendarCheck,
  Flame,
  Gamepad2,
  Joystick,
  Medal,
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
import { providerFloors } from "../../library/playtimeFloor";
import { AchievementCard } from "./achievements/AchievementCard";
import { AchievementHero } from "./achievements/AchievementHero";
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

type Tab = "milestones" | "games";
type StatusFilter = "all" | "unlocked" | "in-progress";

const TABS: Array<{ id: Tab; label: string; icon: LucideIcon }> = [
  { id: "milestones", label: "Milestones", icon: Medal },
  { id: "games", label: "Game ladders", icon: Gamepad2 },
];

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

const MILESTONE_GROUPS = GROUP_META.filter((group) => group.id !== "game");

export function AchievementsView() {
  const [tab, setTab] = useState<Tab>("milestones");
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
  const libraryImports = useAppStore((state) => state.libraryImports);
  const resolveIgdbId = useMemo(
    () => createGameIdentityResolver(gameMetadata, exeCache, libraryImports),
    [exeCache, gameMetadata, libraryImports],
  );
  const metrics = useMemo(
    () =>
      milestoneMetrics({
        sessions,
        archivedSeconds,
        archivedGameSeconds,
        playtimeAdjustments,
        providerFloors: providerFloors(libraryImports.values()),
        verifiedContributions,
        verifiedEmulatorContributions,
        resolveIgdbId,
      }),
    [
      archivedGameSeconds,
      archivedSeconds,
      playtimeAdjustments,
      libraryImports,
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
  const recent = useMemo(() => recentUnlocks(catalog, 3), [catalog]);
  const nextUp = useMemo(
    () => nextMilestones(catalog, metrics.monthKey, 3),
    [catalog, metrics.monthKey],
  );
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
  const gameItems = catalog.get("game") ?? [];
  const tabCounts: Record<Tab, { unlocked: number; total: number }> = {
    milestones: { unlocked: summary.fixedUnlocked, total: summary.fixedTotal },
    games: {
      unlocked: gameItems.filter((item) => item.milestone).length,
      total: gameItems.length,
    },
  };

  const handleTabKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const index = TABS.findIndex((entry) => entry.id === tab);
    const step = event.key === "ArrowRight" ? 1 : -1;
    const next = TABS[(index + step + TABS.length) % TABS.length]!;
    setTab(next.id);
    document.getElementById(`achievements-tab-${next.id}`)?.focus();
  };

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <AchievementHero summary={summary} nextUp={nextUp} recent={recent} />

      <div className="sticky top-0 z-30 -mx-1 flex min-w-0 flex-wrap items-end justify-between gap-3 border-b border-border bg-bg/95 px-1 pt-1 backdrop-blur">
        <div
          role="tablist"
          aria-label="Achievement sections"
          onKeyDown={handleTabKeyDown}
          className="flex gap-1"
        >
          {TABS.map(({ id, label, icon: Icon }) => {
            const selected = tab === id;
            const counts = tabCounts[id];
            return (
              <button
                key={id}
                type="button"
                role="tab"
                id={`achievements-tab-${id}`}
                aria-selected={selected}
                aria-controls={`achievements-panel-${id}`}
                tabIndex={selected ? 0 : -1}
                onClick={() => setTab(id)}
                className={clsx(
                  "relative inline-flex items-center gap-2 rounded-t-lg px-4 py-2.5 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
                  selected
                    ? "text-accent after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-accent"
                    : "text-text-muted hover:text-text",
                )}
              >
                <Icon size={15} />
                {label}
                <span
                  className={clsx(
                    "font-mono text-[11px] tabular-nums",
                    selected ? "text-accent/70" : "text-text-faint",
                  )}
                >
                  {counts.unlocked.toLocaleString()}/
                  {counts.total.toLocaleString()}
                </span>
              </button>
            );
          })}
        </div>
        <div className="mb-2 flex items-center rounded-full border border-border bg-surface p-1">
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
      </div>

      {tab === "milestones" ? (
        <div
          id="achievements-panel-milestones"
          role="tabpanel"
          aria-labelledby="achievements-tab-milestones"
          className="grid gap-8"
        >
          {MILESTONE_GROUPS.map((group) => {
            const items = catalog.get(group.id) ?? [];
            const matching = items.filter((item) =>
              matchesStatus(item, status),
            );
            if (status !== "all" && matching.length === 0) return null;
            return (
              <MilestoneSection
                key={group.id}
                category={group.id}
                items={items}
                matching={matching}
                currentMonthKey={metrics.monthKey}
                monthHistory={status === "in-progress" ? [] : monthHistory}
              />
            );
          })}
          {status !== "all" &&
          MILESTONE_GROUPS.every(
            (group) =>
              !(catalog.get(group.id) ?? []).some((item) =>
                matchesStatus(item, status),
              ),
          ) ? (
            <NoFilterResults />
          ) : null}
        </div>
      ) : (
        <div
          id="achievements-panel-games"
          role="tabpanel"
          aria-labelledby="achievements-tab-games"
        >
          <GameSection
            ladders={gameLadders}
            hiddenGameCount={hiddenGameCount}
            status={status}
          />
        </div>
      )}
    </div>
  );
}

function MilestoneSection({
  category,
  items,
  matching,
  currentMonthKey,
  monthHistory,
}: {
  category: AchievementGroupId;
  items: AchievementCatalogItem[];
  matching: AchievementCatalogItem[];
  currentMonthKey: string;
  monthHistory: ReturnType<typeof buildMonthHistory>;
}) {
  const meta = GROUP_META.find((group) => group.id === category)!;
  const Icon = GROUP_ICONS[category];
  const counted =
    category === "month"
      ? items.filter((item) => item.scope === currentMonthKey)
      : items;
  const unlocked = counted.filter((item) => item.milestone).length;
  const visible =
    category === "month"
      ? matching.filter((item) => item.scope === currentMonthKey)
      : matching;

  return (
    <section aria-labelledby={`achievements-group-${category}`}>
      <div className="mb-3 flex items-end justify-between gap-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <Icon aria-hidden="true" size={16} className="shrink-0 text-accent" />
          <h2
            id={`achievements-group-${category}`}
            className="text-base font-bold tracking-tight text-text"
          >
            {meta.label}
          </h2>
          <span className="font-mono text-xs tabular-nums text-text-faint">
            {unlocked}/{counted.length}
          </span>
        </div>
        <p className="hidden truncate text-xs text-text-muted sm:block">
          {meta.caption}
        </p>
      </div>
      {visible.length > 0 ? (
        <CardGrid items={visible} />
      ) : category !== "month" || monthHistory.length === 0 ? (
        <NoFilterResults />
      ) : null}
      {category === "month" && monthHistory.length > 0 ? (
        <div className="mt-4">
          <div className="mb-2 flex items-baseline justify-between gap-4">
            <h3 className="text-xs font-bold uppercase tracking-[0.16em] text-text-faint">
              Earlier months
            </h3>
            <span className="text-xs text-text-faint">
              Milestones shown; exact past totals are not stored
            </span>
          </div>
          <div className="grid gap-2 lg:grid-cols-2">
            {monthHistory.map((month) => (
              <MonthHistoryRow key={month.monthKey} month={month} />
            ))}
          </div>
        </div>
      ) : null}
    </section>
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

function matchesStatus(item: AchievementCatalogItem, status: StatusFilter) {
  if (status === "unlocked") return Boolean(item.milestone);
  if (status === "in-progress") {
    return !item.milestone && item.ratio > 0 && item.isNext;
  }
  return true;
}

/* The closest locked milestone per ladder, most advanced first. Game rungs
 * stay out so the hero speaks about the same 29 items as the ring. */
function nextMilestones(
  catalog: ReturnType<typeof buildAchievementCatalog>,
  currentMonthKey: string,
  limit: number,
) {
  return [...catalog.values()]
    .flat()
    .filter(
      (item) =>
        item.category !== "game" &&
        !item.milestone &&
        item.isNext &&
        (item.category !== "month" || item.scope === currentMonthKey),
    )
    .sort((left, right) => right.ratio - left.ratio)
    .slice(0, limit);
}
