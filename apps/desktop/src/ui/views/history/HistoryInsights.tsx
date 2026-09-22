import type { Session } from "@playcounter/shared";
import clsx from "clsx";
import { memo, type ReactNode, useMemo } from "react";
import type { GameIdentityResolver } from "../../../store";
import {
  bucketSessions,
  dailyTotals,
  getSessionGameKey,
  historyHighlights,
  historyRange,
  playHabits,
  summaryStats,
  topGames,
  weekdayHourMatrix,
  type HistoryFilter,
  type PlayHabits,
} from "../../../historyStats";
import { CalendarHeatmap } from "../../charts/CalendarHeatmap";
import { ColumnChart } from "../../charts/ColumnChart";
import { RhythmHeatmap } from "../../charts/RhythmHeatmap";
import { addDays } from "../../charts/chartUtils";
import { Panel, formatDuration } from "../../components";
import { SectionToggle, useSectionCollapse } from "../../CollapsibleSection";

export type ResolvedGame = { name: string; coverUrl: string };

type CachedFilterAnalytics = {
  selectedRange: ReturnType<typeof historyRange>;
  chart: ReturnType<typeof bucketSessions>;
  rangeStats: ReturnType<typeof summaryStats>;
  rhythm: ReturnType<typeof weekdayHourMatrix>;
  games: ReturnType<typeof topGames>;
  highlights: ReturnType<typeof historyHighlights>;
  habits: PlayHabits;
};

type CachedHistoryAnalytics = {
  dayKey: number;
  resolveIgdbId: GameIdentityResolver;
  resolveGame: (session: Session) => ResolvedGame;
  allTimeStats: ReturnType<typeof summaryStats>;
  calendar: ReturnType<typeof dailyTotals>;
  firstSessionMs: number | null;
  filters: Map<HistoryFilter, CachedFilterAnalytics>;
};

/* Everything derived from the session list, keyed by that list's identity so
   the hero, the tabs and the insights share one computation per day. */
const historyAnalyticsCache = new WeakMap<Session[], CachedHistoryAnalytics>();

function localDayKey(nowMs: number) {
  const day = new Date(nowMs);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
}

export function getHistoryAnalytics(
  sessions: Session[],
  filter: HistoryFilter,
  nowMs: number,
  resolveIgdbId: GameIdentityResolver,
  resolveGame: (session: Session) => ResolvedGame,
) {
  const dayKey = localDayKey(nowMs);
  let cached = historyAnalyticsCache.get(sessions);
  if (
    !cached ||
    cached.dayKey !== dayKey ||
    cached.resolveIgdbId !== resolveIgdbId ||
    cached.resolveGame !== resolveGame
  ) {
    const today = new Date(dayKey);
    const starts = sessions
      .map((session) => Date.parse(session.startedAt))
      .filter((value) => Number.isFinite(value));
    const firstSessionMs = starts.length > 0 ? Math.min(...starts) : null;
    // The calendar starts at the first session, capped at a year back.
    const yearAgo = addDays(today, -363);
    const calendarFrom =
      firstSessionMs !== null && firstSessionMs > yearAgo.getTime()
        ? firstSessionMs
        : yearAgo.getTime();
    cached = {
      dayKey,
      resolveIgdbId,
      resolveGame,
      allTimeStats: summaryStats(sessions, nowMs),
      calendar: dailyTotals(
        sessions,
        calendarFrom,
        addDays(today, 1).getTime(),
      ),
      firstSessionMs,
      filters: new Map(),
    };
    historyAnalyticsCache.set(sessions, cached);
  }

  let filtered = cached.filters.get(filter);
  if (!filtered) {
    const selectedRange = historyRange(filter, nowMs);
    const rangeStats =
      filter === "all"
        ? cached.allTimeStats
        : summaryStats(sessions, nowMs, selectedRange);
    const rhythm = weekdayHourMatrix(sessions, nowMs, selectedRange);
    const games = topGames(
      sessions,
      resolveGame,
      Number.POSITIVE_INFINITY,
      selectedRange,
      resolveIgdbId,
    );
    filtered = {
      selectedRange,
      chart: bucketSessions(sessions, filter, nowMs, resolveIgdbId),
      rangeStats,
      rhythm,
      games,
      highlights: historyHighlights(
        sessions,
        nowMs,
        selectedRange,
        resolveGame,
        resolveIgdbId,
      ),
      habits: playHabits(rhythm, rangeStats, games),
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
          className="text-xs font-bold uppercase tracking-[0.14em] text-text-faint"
        >
          {title}
        </h2>
        <p className="mt-1 text-sm text-text-muted">{caption}</p>
      </div>
      {action}
    </div>
  );
}

const weekdayNames = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

function formatHour(hour: number) {
  return new Date(2000, 0, 1, hour).toLocaleTimeString([], { hour: "numeric" });
}

function formatPercent(share: number) {
  return `${Math.round(share * 100)} %`;
}

export const HistoryInsights = memo(function HistoryInsights({
  sessions,
  filter,
  nowMs,
  showDurationDays,
  resolveGame,
  resolveIgdbId,
  detailedChart,
  onDetailedChartChange,
}: {
  sessions: Session[];
  filter: HistoryFilter;
  nowMs: number;
  showDurationDays: boolean;
  resolveGame: (session: Session) => ResolvedGame;
  resolveIgdbId: GameIdentityResolver;
  detailedChart: boolean;
  onDetailedChartChange: (detailed: boolean) => void;
}) {
  const playtimeSection = useSectionCollapse("history.playtime");
  const calendarSection = useSectionCollapse("history.calendar");
  const habitsSection = useSectionCollapse("history.habits");
  const rhythmSection = useSectionCollapse("history.rhythm");
  const { chart, rhythm, calendar, habits, firstSessionMs } = useMemo(
    () =>
      getHistoryAnalytics(sessions, filter, nowMs, resolveIgdbId, resolveGame),
    [filter, nowMs, resolveGame, resolveIgdbId, sessions],
  );
  const gamesByKey = useMemo(() => {
    const games = new Map<string, ResolvedGame>();
    for (const session of sessions) {
      const key = getSessionGameKey(session, resolveIgdbId);
      if (!games.has(key)) games.set(key, resolveGame(session));
    }
    return games;
  }, [resolveGame, resolveIgdbId, sessions]);
  const resolveGameName = (key: string | null) =>
    key ? (gamesByKey.get(key)?.name ?? null) : null;
  const resolveGameCover = (key: string | null) =>
    key ? (gamesByKey.get(key)?.coverUrl ?? null) : null;
  const canDetail = chart.full.length !== chart.compact.length;
  const detailed = canDetail && detailedChart;
  const buckets = detailed ? chart.full : chart.compact;
  const chartTotal = buckets.reduce((sum, bucket) => sum + bucket.seconds, 0);
  const calendarWeeks = useMemo(() => {
    const firstKey = calendar.keys().next().value as string | undefined;
    if (!firstKey) return 52;
    const from = new Date(`${firstKey}T00:00:00`).getTime();
    return Math.max(1, Math.ceil((localDayKey(nowMs) - from) / 604_800_000));
  }, [calendar, nowMs]);
  const calendarCaption =
    firstSessionMs !== null && calendarWeeks < 52
      ? `Since your first session · ${calendarWeeks} week${calendarWeeks === 1 ? "" : "s"}`
      : "Last 52 weeks";

  return (
    <div className="grid min-w-0 gap-6">
      <Panel dataTour="history-playtime-chart" className="min-w-0 p-5">
        <PanelHeading
          id="playtime-chart-heading"
          title="Playtime over time"
          caption={`${formatDuration(chartTotal, showDurationDays)} logged · ${chart.title}`}
          collapsed={playtimeSection.collapsed}
          action={
            <div className="flex items-center gap-2">
              {!playtimeSection.collapsed && canDetail ? (
                <div
                  role="group"
                  aria-label="Chart detail"
                  className="inline-flex overflow-hidden rounded-lg border border-border"
                >
                  {[
                    { id: false, label: "Overview" },
                    { id: true, label: "Detailed" },
                  ].map((option) => (
                    <button
                      key={String(option.id)}
                      type="button"
                      aria-pressed={detailed === option.id}
                      onClick={() => onDetailedChartChange(option.id)}
                      className={clsx(
                        "px-2.5 py-1 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
                        detailed === option.id
                          ? "bg-surface-hover text-text"
                          : "text-text-muted hover:text-text",
                      )}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
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
            {buckets.length === 0 ? (
              <div className="py-16 text-center text-sm text-text-muted">
                No sessions in this range.
              </div>
            ) : (
              <figure
                aria-labelledby="playtime-chart-heading"
                className={clsx(detailed && "overflow-x-auto pb-1")}
              >
                <ColumnChart
                  buckets={buckets}
                  showDurationDays={showDurationDays}
                  resolveGameName={resolveGameName}
                  resolveGameCover={resolveGameCover}
                  className={clsx(
                    detailed && buckets.length > 12 && "min-w-[720px]",
                  )}
                />
              </figure>
            )}
          </div>
        ) : null}
      </Panel>

      <div className="grid min-w-0 gap-6 2xl:grid-cols-[minmax(0,3fr)_minmax(360px,2fr)]">
        <Panel
          className={clsx(
            "min-w-0 p-5",
            calendarSection.collapsed && "self-start",
          )}
        >
          <PanelHeading
            id="activity-heading"
            title="Activity calendar"
            caption={calendarCaption}
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
        <Panel
          className={clsx(
            "min-w-0 p-5",
            habitsSection.collapsed && "self-start",
          )}
        >
          <PanelHeading
            id="habits-heading"
            title="Play habits"
            caption={chart.title}
            collapsed={habitsSection.collapsed}
            action={
              <SectionToggle
                collapsed={habitsSection.collapsed}
                onToggle={habitsSection.toggle}
                controls="habits-body"
                label="Play habits"
              />
            }
          />
          {!habitsSection.collapsed ? (
            <div id="habits-body">
              {habits.gamesPlayed === 0 ? (
                <div className="py-12 text-center text-sm text-text-muted">
                  Your habits will appear here.
                </div>
              ) : (
                <HabitFacts
                  habits={habits}
                  showDurationDays={showDurationDays}
                />
              )}
            </div>
          ) : null}
        </Panel>
      </div>

      <Panel className="min-w-0 p-5">
        <PanelHeading
          id="rhythm-heading"
          title="When you play"
          caption={`Weekday × hour · ${chart.title}`}
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
    </div>
  );
});

function HabitFacts({
  habits,
  showDurationDays,
}: {
  habits: PlayHabits;
  showDurationDays: boolean;
}) {
  const facts: Array<{ label: string; value: string; detail: string }> = [];
  if (habits.favoriteWeekday) {
    facts.push({
      label: "Favourite day",
      value: weekdayNames[habits.favoriteWeekday.index],
      detail: `${formatPercent(habits.favoriteWeekday.share)} of playtime`,
    });
  }
  if (habits.primeHours) {
    facts.push({
      label: "Prime time",
      value: `${formatHour(habits.primeHours.from)} – ${formatHour(habits.primeHours.to)}`,
      detail: "your busiest two hours",
    });
  }
  facts.push({
    label: "Per active day",
    value: formatDuration(habits.perActiveDaySeconds, showDurationDays),
    detail: "on days you played",
  });
  facts.push({
    label: "Weekend share",
    value: formatPercent(habits.weekendShare),
    detail: `${formatPercent(1 - habits.weekendShare)} on weekdays`,
  });
  facts.push({
    label: "Night owl",
    value: formatPercent(habits.lateNightShare),
    detail: "played between midnight and 5",
  });
  facts.push({
    label: "Games played",
    value: String(habits.gamesPlayed),
    detail: `${habits.gamesOverTenHours} with over 10h`,
  });

  return (
    <dl className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 2xl:grid-cols-2">
      {facts.map((fact) => (
        <div
          key={fact.label}
          className="rounded-lg border border-border bg-bg/40 px-3 py-2.5"
        >
          <dt className="text-[10px] font-bold uppercase tracking-[0.14em] text-text-faint">
            {fact.label}
          </dt>
          <dd className="mt-1 truncate font-mono text-lg font-bold leading-tight text-text">
            {fact.value}
          </dd>
          <dd className="mt-0.5 text-xs text-text-muted">{fact.detail}</dd>
        </div>
      ))}
    </dl>
  );
}
