import type { Session } from "@playcounter/shared";
import clsx from "clsx";
import { BarChart3, Maximize2 } from "lucide-react";
import {
  memo,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { GameIdentityResolver } from "../../../store";
import {
  bucketSessions,
  dailyTotals,
  getSessionGameKey,
  historyRange,
  summaryStats,
  topGames,
  weekdayHourMatrix,
  type HistoryFilter,
} from "../../../historyStats";
import { CalendarHeatmap } from "../../charts/CalendarHeatmap";
import { ColumnChart } from "../../charts/ColumnChart";
import { RhythmHeatmap } from "../../charts/RhythmHeatmap";
import { TopGamesBars } from "../../charts/TopGamesBars";
import { addDays } from "../../charts/chartUtils";
import { Panel, Stat, formatDuration } from "../../components";
import { SectionToggle, useSectionCollapse } from "../../CollapsibleSection";
import { IconButton, Modal } from "../../primitives";

type ResolvedGame = { name: string; coverUrl: string };

type CachedFilterAnalytics = {
  selectedRange: ReturnType<typeof historyRange>;
  chart: ReturnType<typeof bucketSessions>;
  rangeStats: ReturnType<typeof summaryStats>;
};

type CachedHistoryAnalytics = {
  dayKey: number;
  resolveIgdbId: GameIdentityResolver;
  allTimeStats: ReturnType<typeof summaryStats>;
  rhythm: ReturnType<typeof weekdayHourMatrix>;
  calendar: ReturnType<typeof dailyTotals>;
  filters: Map<HistoryFilter, CachedFilterAnalytics>;
};

const historyAnalyticsCache = new WeakMap<Session[], CachedHistoryAnalytics>();

function localDayKey(nowMs: number) {
  const day = new Date(nowMs);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
}

function getHistoryAnalytics(
  sessions: Session[],
  filter: HistoryFilter,
  nowMs: number,
  resolveIgdbId: GameIdentityResolver,
) {
  const dayKey = localDayKey(nowMs);
  let cached = historyAnalyticsCache.get(sessions);
  if (
    !cached ||
    cached.dayKey !== dayKey ||
    cached.resolveIgdbId !== resolveIgdbId
  ) {
    const today = new Date(dayKey);
    const from = addDays(today, -363);
    cached = {
      dayKey,
      resolveIgdbId,
      allTimeStats: summaryStats(sessions, nowMs),
      rhythm: weekdayHourMatrix(sessions, nowMs),
      calendar: dailyTotals(
        sessions,
        from.getTime(),
        addDays(today, 1).getTime(),
      ),
      filters: new Map(),
    };
    historyAnalyticsCache.set(sessions, cached);
  }

  let filtered = cached.filters.get(filter);
  if (!filtered) {
    const selectedRange = historyRange(filter, nowMs);
    filtered = {
      selectedRange,
      chart: bucketSessions(sessions, filter, nowMs, resolveIgdbId),
      rangeStats:
        filter === "all"
          ? cached.allTimeStats
          : summaryStats(sessions, nowMs, selectedRange),
    };
    cached.filters.set(filter, filtered);
  }

  return { ...cached, ...filtered };
}

export function hasCachedHistoryInsights(sessions: Session[], nowMs: number) {
  const cached = historyAnalyticsCache.get(sessions);
  return cached?.dayKey === localDayKey(nowMs) && cached.filters.has("all");
}

function PanelHeading({
  id,
  title,
  caption,
  action,
  collapsed = false,
}: {
  id: string;
  title: string;
  caption: string;
  action?: ReactNode;
  collapsed?: boolean;
}) {
  return (
    <div
      className={clsx(
        "flex min-w-0 items-start justify-between gap-4",
        collapsed ? "mb-0" : "mb-5",
      )}
    >
      <div className="min-w-0">
        <h2
          id={id}
          className="text-sm font-bold uppercase tracking-wider text-text-faint"
        >
          {title}
        </h2>
        <p className="mt-1 text-sm text-text-muted">{caption}</p>
      </div>
      {action}
    </div>
  );
}

export const HistoryInsights = memo(function HistoryInsights({
  sessions,
  filter,
  nowMs,
  showDurationDays,
  resolveGame,
  resolveIgdbId,
  onSelectGame,
}: {
  sessions: Session[];
  filter: HistoryFilter;
  nowMs: number;
  showDurationDays: boolean;
  resolveGame: (session: Session) => ResolvedGame;
  resolveIgdbId: GameIdentityResolver;
  onSelectGame: (key: string, name: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const expandButtonRef = useRef<HTMLButtonElement>(null);
  const playtimeSection = useSectionCollapse("history.playtime");
  const calendarSection = useSectionCollapse("history.calendar");
  const rhythmSection = useSectionCollapse("history.rhythm");
  const topGamesSection = useSectionCollapse("history.topGames");
  const { selectedRange, chart, rangeStats, allTimeStats, rhythm, calendar } =
    useMemo(
      () => getHistoryAnalytics(sessions, filter, nowMs, resolveIgdbId),
      [filter, nowMs, resolveIgdbId, sessions],
    );
  const games = useMemo(
    () => topGames(sessions, resolveGame, 8, selectedRange, resolveIgdbId),
    [resolveGame, resolveIgdbId, selectedRange, sessions],
  );
  const gamesByKey = useMemo(() => {
    const games = new Map<string, ResolvedGame>();
    for (const session of sessions) {
      games.set(
        getSessionGameKey(session, resolveIgdbId),
        resolveGame(session),
      );
    }
    return games;
  }, [resolveGame, resolveIgdbId, sessions]);
  const resolveGameName = (key: string | null) =>
    key ? (gamesByKey.get(key)?.name ?? null) : null;
  const resolveGameCover = (key: string | null) =>
    key ? (gamesByKey.get(key)?.coverUrl ?? null) : null;
  const chartTotal = chart.compact.reduce(
    (sum, bucket) => sum + bucket.seconds,
    0,
  );
  const busiestLabel = allTimeStats.busiestDay
    ? new Date(
        `${allTimeStats.busiestDay.dateKey}T00:00:00`,
      ).toLocaleDateString([], { month: "short", day: "numeric" })
    : "-";

  return (
    <div className="grid min-w-0 gap-6">
      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
        <Stat
          label="Total playtime"
          value={formatDuration(rangeStats.totalSeconds, showDurationDays)}
          trend={`over ${rangeStats.activeDays} active day${rangeStats.activeDays === 1 ? "" : "s"}`}
        />
        <Stat label="Sessions" value={String(rangeStats.sessionCount)} />
        <Stat
          label="Average session"
          value={formatDuration(rangeStats.averageSeconds, showDurationDays)}
        />
        <Stat
          label="Longest session"
          value={formatDuration(
            rangeStats.longestSessionSeconds,
            showDurationDays,
          )}
        />
        <Stat
          label="Current streak"
          value={`${allTimeStats.currentStreakDays}d`}
          trend={`best ${allTimeStats.longestStreakDays}d`}
        />
        <Stat
          label="Busiest day"
          value={busiestLabel}
          trend={
            allTimeStats.busiestDay
              ? `${formatDuration(allTimeStats.busiestDay.seconds, showDurationDays)} · all time`
              : "all time"
          }
        />
      </div>

      <Panel dataTour="history-playtime-chart" className="min-w-0 p-5">
        <PanelHeading
          id="playtime-chart-heading"
          title="Playtime over time"
          caption={`${formatDuration(chartTotal, showDurationDays)} logged · ${chart.title}`}
          collapsed={playtimeSection.collapsed}
          action={
            <div className="flex items-center gap-2">
              {!playtimeSection.collapsed ? (
                <IconButton
                  ref={expandButtonRef}
                  icon={Maximize2}
                  aria-label="Expand playtime chart"
                  onClick={() => setExpanded(true)}
                />
              ) : null}
              <SectionToggle
                collapsed={playtimeSection.collapsed}
                onToggle={playtimeSection.toggle}
                controls="playtime-chart-body"
                label="Playtime over time"
              />
            </div>
          }
        />
        {!playtimeSection.collapsed ? (
          <div id="playtime-chart-body">
            {chart.compact.length === 0 ? (
              <div className="py-16 text-center text-sm text-text-muted">
                No sessions in this range.
              </div>
            ) : (
              <figure aria-labelledby="playtime-chart-heading">
                <ColumnChart
                  buckets={chart.compact}
                  showDurationDays={showDurationDays}
                  resolveGameName={resolveGameName}
                  resolveGameCover={resolveGameCover}
                />
              </figure>
            )}
          </div>
        ) : null}
      </Panel>

      <Panel className="min-w-0 p-5">
        <PanelHeading
          id="activity-heading"
          title="Activity calendar"
          caption="Last 52 weeks"
          collapsed={calendarSection.collapsed}
          action={
            <SectionToggle
              collapsed={calendarSection.collapsed}
              onToggle={calendarSection.toggle}
              controls="activity-calendar-body"
              label="Activity calendar"
            />
          }
        />
        {!calendarSection.collapsed ? (
          <div id="activity-calendar-body">
            {sessions.length === 0 ? (
              <div className="py-12 text-center text-sm text-text-muted">
                Playtime activity will appear here.
              </div>
            ) : (
              <CalendarHeatmap
                totals={calendar}
                nowMs={nowMs}
                showDurationDays={showDurationDays}
                resolveGameName={resolveGameName}
              />
            )}
          </div>
        ) : null}
      </Panel>

      <div className="grid min-w-0 gap-6 2xl:grid-cols-[minmax(0,2fr)_minmax(520px,3fr)]">
        <Panel
          className={clsx(
            "min-w-0 p-5",
            rhythmSection.collapsed && "self-start",
          )}
        >
          <PanelHeading
            id="rhythm-heading"
            title="When you play"
            caption="All time"
            collapsed={rhythmSection.collapsed}
            action={
              <SectionToggle
                collapsed={rhythmSection.collapsed}
                onToggle={rhythmSection.toggle}
                controls="rhythm-body"
                label="When you play"
              />
            }
          />
          {!rhythmSection.collapsed ? (
            <div id="rhythm-body">
              {sessions.length === 0 ? (
                <div className="py-12 text-center text-sm text-text-muted">
                  Your play rhythm will appear here.
                </div>
              ) : (
                <RhythmHeatmap
                  matrix={rhythm}
                  showDurationDays={showDurationDays}
                />
              )}
            </div>
          ) : null}
        </Panel>
        <Panel
          className={clsx(
            "min-w-0 p-5",
            topGamesSection.collapsed && "self-start",
          )}
        >
          <PanelHeading
            id="top-games-heading"
            title="Top games"
            caption={chart.title}
            collapsed={topGamesSection.collapsed}
            action={
              <SectionToggle
                collapsed={topGamesSection.collapsed}
                onToggle={topGamesSection.toggle}
                controls="top-games-body"
                label="Top games"
              />
            }
          />
          {!topGamesSection.collapsed ? (
            <div id="top-games-body">
              {games.length === 0 ? (
                <div className="py-12 text-center text-sm text-text-muted">
                  No games in this range.
                </div>
              ) : (
                <TopGamesBars
                  games={games}
                  showDurationDays={showDurationDays}
                  onSelectGame={onSelectGame}
                />
              )}
            </div>
          ) : null}
        </Panel>
      </div>

      {expanded ? (
        <ChartDialog
          title={chart.title}
          total={chart.full.reduce((sum, bucket) => sum + bucket.seconds, 0)}
          buckets={chart.full}
          showDurationDays={showDurationDays}
          resolveGameName={resolveGameName}
          resolveGameCover={resolveGameCover}
          onClose={() => {
            setExpanded(false);
            requestAnimationFrame(() => expandButtonRef.current?.focus());
          }}
        />
      ) : null}
    </div>
  );
});

function ChartDialog({
  title,
  total,
  buckets,
  showDurationDays,
  resolveGameName,
  resolveGameCover,
  onClose,
}: {
  title: string;
  total: number;
  buckets: ReturnType<typeof bucketSessions>["full"];
  showDurationDays: boolean;
  resolveGameName: (key: string | null) => string | null;
  resolveGameCover: (key: string | null) => string | null;
  onClose: () => void;
}) {
  return (
    <Modal
      size="full"
      labelId="expanded-chart-title"
      eyebrow="Insights"
      title={title}
      subtitle={`${formatDuration(total, showDurationDays)} logged`}
      icon={BarChart3}
      onClose={onClose}
      bodyClassName="flex overflow-hidden"
    >
      <div className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden">
        <ColumnChart
          buckets={buckets}
          showDurationDays={showDurationDays}
          resolveGameName={resolveGameName}
          resolveGameCover={resolveGameCover}
          className="min-w-[720px]"
          height={500}
        />
      </div>
    </Modal>
  );
}
