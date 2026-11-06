import type { Session } from "@playcounter/shared";
import clsx from "clsx";
import { memo, useMemo, useState } from "react";
import { usePickedCovers } from "../../../pickedCovers";
import type { GameIdentityResolver } from "../../../store";
import {
  bucketSessions,
  dailyTotals,
  gameSeasons,
  getSessionGameKey,
  historyHighlights,
  playHabits,
  previousHistoryRange,
  quantileThresholds,
  rangeSeconds,
  resolveHistorySelection,
  summaryStats,
  topGames,
  weekdayHourMatrix,
  type DailyTotal,
  type HistoryRange,
  type HistorySelection,
  type PlayHabits,
  type TopGame,
} from "../../../historyStats";
import { ColumnChart } from "../../charts/ColumnChart";
import { assignGameColors, gameColor } from "../../charts/gameColors";
import { PaceChart } from "../../charts/PaceChart";
import { RhythmHeatmap } from "../../charts/RhythmHeatmap";
import { addDays } from "../../charts/chartUtils";
import { Panel, formatDuration } from "../../components";
import { SectionHeading, useSectionCollapse } from "../../CollapsibleSection";
import { appLocale, weekdayNames, getT } from "../../../i18n";
import { CoverCalendarPager, coverCalendarRows } from "./CoverCalendarPager";
import { GameSeasons } from "./GameSeasons";

const t = getT("history");

export type ResolvedGame = { name: string; coverUrl: string };

type CachedSelectionAnalytics = {
  selectedRange: HistoryRange | null;
  /** The period to compare with; null for all time. */
  previousRange: HistoryRange | null;
  previousSeconds: number;
  chart: ReturnType<typeof bucketSessions>;
  previousChart: ReturnType<typeof bucketSessions> | null;
  rangeStats: ReturnType<typeof summaryStats>;
  rhythm: ReturnType<typeof weekdayHourMatrix>;
  games: ReturnType<typeof topGames>;
  seasons: ReturnType<typeof gameSeasons>;
  highlights: ReturnType<typeof historyHighlights>;
  habits: PlayHabits;
};

type CachedHistoryAnalytics = {
  dayKey: number;
  resolveIgdbId: GameIdentityResolver;
  resolveGame: (session: Session) => ResolvedGame;
  allTimeStats: ReturnType<typeof summaryStats>;
  /** Playtime per day from the first session to today. */
  historyDaily: Map<string, DailyTotal>;
  firstSessionMs: number | null;
  selections: Map<string, CachedSelectionAnalytics>;
};

/* Everything derived from the session list, keyed by that list's identity so
   the hero, the tabs and the insights share one computation per day. */
const historyAnalyticsCache = new WeakMap<Session[], CachedHistoryAnalytics>();

function localDayKey(nowMs: number) {
  const day = new Date(nowMs);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
}

function selectionKey(selection: HistorySelection) {
  return JSON.stringify(selection);
}

export function getHistoryAnalytics(
  sessions: Session[],
  selection: HistorySelection,
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
    const tomorrowMs = addDays(today, 1).getTime();
    const starts = sessions
      .map((session) => Date.parse(session.startedAt))
      .filter((value) => Number.isFinite(value));
    const firstSessionMs = starts.length > 0 ? Math.min(...starts) : null;
    const historyDaily =
      firstSessionMs === null
        ? new Map<string, DailyTotal>()
        : dailyTotals(sessions, firstSessionMs, tomorrowMs);
    cached = {
      dayKey,
      resolveIgdbId,
      resolveGame,
      allTimeStats: summaryStats(sessions, nowMs),
      historyDaily,
      firstSessionMs,
      selections: new Map(),
    };
    historyAnalyticsCache.set(sessions, cached);
  }

  const key = selectionKey(selection);
  let selected = cached.selections.get(key);
  if (!selected) {
    const selectedRange = resolveHistorySelection(selection, nowMs);
    const previousRange = previousHistoryRange(selection, nowMs);
    const rangeStats =
      selection.kind === "all"
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
    selected = {
      selectedRange,
      previousRange,
      previousSeconds: previousRange
        ? rangeSeconds(sessions, previousRange)
        : 0,
      chart: bucketSessions(sessions, selectedRange, nowMs, resolveIgdbId),
      previousChart: previousRange
        ? bucketSessions(sessions, previousRange, nowMs, resolveIgdbId)
        : null,
      rangeStats,
      rhythm,
      games,
      seasons: gameSeasons(sessions, selectedRange, nowMs, resolveIgdbId),
      highlights: historyHighlights(
        sessions,
        nowMs,
        selectedRange,
        resolveGame,
        resolveIgdbId,
      ),
      habits: playHabits(rhythm, rangeStats, games),
    };
    cached.selections.set(key, selected);
  }

  return { ...cached, ...selected };
}

export function hasCachedHistoryInsights(sessions: Session[], nowMs: number) {
  const cached = historyAnalyticsCache.get(sessions);
  return (
    cached?.dayKey === localDayKey(nowMs) &&
    cached.selections.has(selectionKey({ kind: "all" }))
  );
}

function formatHour(hour: number) {
  return new Date(2000, 0, 1, hour).toLocaleTimeString(appLocale(), {
    hour: "numeric",
  });
}

function formatPercent(share: number) {
  return `${Math.round(share * 100)} %`;
}

export const HistoryInsights = memo(function HistoryInsights({
  sessions,
  selection,
  rangeLabel,
  comparisonLabel,
  nowMs,
  showDurationDays,
  resolveGame,
  resolveIgdbId,
  detailedChart,
  onDetailedChartChange,
  onSelectDay,
  onSelectGame,
}: {
  sessions: Session[];
  selection: HistorySelection;
  rangeLabel: string;
  /** The period before, by its dates; null for all time. */
  comparisonLabel: string | null;
  nowMs: number;
  showDurationDays: boolean;
  resolveGame: (session: Session) => ResolvedGame;
  resolveIgdbId: GameIdentityResolver;
  detailedChart: boolean;
  onDetailedChartChange: (detailed: boolean) => void;
  onSelectDay: (dateKey: string) => void;
  /** Opens a game's sessions. */
  onSelectGame: (key: string) => void;
}) {
  const playtimeSection = useSectionCollapse("history.playtime");
  const calendarSection = useSectionCollapse("history.calendar");
  const paceSection = useSectionCollapse("history.pace");
  const seasonsSection = useSectionCollapse("history.seasons");
  const habitsSection = useSectionCollapse("history.habits");
  const rhythmSection = useSectionCollapse("history.rhythm");
  const [litGame, setLitGame] = useState<string | null>(null);
  const {
    chart,
    previousChart,
    previousSeconds,
    rangeStats,
    rhythm,
    habits,
    games,
    seasons,
    selectedRange,
    firstSessionMs,
    historyDaily,
  } = useMemo(
    () =>
      getHistoryAnalytics(
        sessions,
        selection,
        nowMs,
        resolveIgdbId,
        resolveGame,
      ),
    [nowMs, resolveGame, resolveIgdbId, selection, sessions],
  );
  const gamesByKey = useMemo(() => {
    const byKey = new Map<string, ResolvedGame>();
    for (const session of sessions) {
      const key = getSessionGameKey(session, resolveIgdbId);
      if (!byKey.has(key)) byKey.set(key, resolveGame(session));
    }
    return byKey;
  }, [resolveGame, resolveIgdbId, sessions]);
  const resolveGameName = (key: string | null) =>
    key ? (gamesByKey.get(key)?.name ?? null) : null;
  const pickedCovers = usePickedCovers();
  const resolveGameCover = (key: string | null) =>
    key ? (pickedCovers[key] ?? gamesByKey.get(key)?.coverUrl) || null : null;
  const colorSlots = useMemo(
    () =>
      assignGameColors(games.flatMap((game) => (game.key ? [game.key] : []))),
    [games],
  );
  const canDetail = chart.full.length !== chart.compact.length;
  // Two to 42 days show as a calendar of covers; All time counts from the
  // first session, so a short history gets one too.
  const shownRange =
    selectedRange ??
    (firstSessionMs === null
      ? null
      : {
          fromMs: localDayKey(firstSessionMs),
          toMs: addDays(new Date(localDayKey(nowMs)), 1).getTime(),
        });
  const shownDays = shownRange
    ? Math.round((shownRange.toMs - shownRange.fromMs) / 86_400_000)
    : 0;
  const coverRows = shownRange ? coverCalendarRows(shownRange) : 0;
  const dayThresholds = useMemo(
    () =>
      quantileThresholds([...historyDaily.values()].map((day) => day.seconds)),
    [historyDaily],
  );
  // With Pace, the right column holds Pace and Play habits. A calendar of up
  // to two weeks gets the weekday chart under it, so no panel stretches
  // empty; a taller one has it full width below.
  const withPace = Boolean(previousChart && comparisonLabel);
  const rhythmBeside = withPace && coverRows <= 2;
  const detailed = canDetail && detailedChart;
  const buckets = detailed ? chart.full : chart.compact;
  const chartTotal = buckets.reduce((sum, bucket) => sum + bucket.seconds, 0);

  return (
    <div className="grid min-w-0 gap-6">
      <Panel dataTour="history-playtime-chart" className="min-w-0 p-5">
        <SectionHeading
          id="playtime-chart-heading"
          title={t("Playtime over time")}
          caption={t("{{duration}} logged · {{title}}", {
            duration: formatDuration(chartTotal, showDurationDays),
            title: rangeLabel,
          })}
          collapsed={playtimeSection.collapsed}
          onToggle={playtimeSection.toggle}
          controls="playtime-chart-body"
          action={
            !playtimeSection.collapsed && canDetail ? (
              <div
                role="group"
                aria-label={t("Chart detail")}
                className="inline-flex overflow-hidden rounded-lg border border-border"
              >
                {[
                  { id: false, label: t("Overview") },
                  { id: true, label: t("Detailed") },
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
            ) : null
          }
        />
        {!playtimeSection.collapsed ? (
          <div id="playtime-chart-body">
            {buckets.length === 0 || chartTotal === 0 ? (
              <div className="py-16 text-center text-sm text-text-muted">
                {t("No sessions in this range.")}
              </div>
            ) : (
              <figure
                aria-labelledby="playtime-chart-heading"
                className={clsx("m-0", detailed && "overflow-x-auto pb-1")}
              >
                <ColumnChart
                  buckets={buckets}
                  showDurationDays={showDurationDays}
                  resolveGameName={resolveGameName}
                  colorSlots={colorSlots}
                  highlightKey={litGame}
                  className={clsx(
                    detailed && buckets.length > 12 && "min-w-[720px]",
                  )}
                />
                <GameLegend
                  games={games}
                  colorSlots={colorSlots}
                  pickedCovers={pickedCovers}
                  showDurationDays={showDurationDays}
                  onLight={setLitGame}
                />
              </figure>
            )}
          </div>
        ) : null}
      </Panel>

      <Panel className="min-w-0 p-5">
        <SectionHeading
          id="seasons-heading"
          title={t("Game seasons")}
          caption={t("When you played what · {{range}}", { range: rangeLabel })}
          collapsed={seasonsSection.collapsed}
          onToggle={seasonsSection.toggle}
          controls="seasons-body"
        />
        {!seasonsSection.collapsed ? (
          <div id="seasons-body">
            {!shownRange || shownDays < 7 ? (
              <div className="py-10 text-center text-sm text-text-muted">
                {t("Pick at least a week to see your seasons.")}
              </div>
            ) : seasons.length === 0 ? (
              <div className="py-10 text-center text-sm text-text-muted">
                {t("No sessions in this range.")}
              </div>
            ) : (
              <GameSeasons
                seasons={seasons}
                range={shownRange}
                colorSlots={colorSlots}
                showDurationDays={showDurationDays}
                resolveGameName={resolveGameName}
                resolveGameCover={resolveGameCover}
                onSelectGame={onSelectGame}
              />
            )}
          </div>
        ) : null}
      </Panel>

      <div className="grid min-w-0 gap-6 2xl:grid-cols-[minmax(0,3fr)_minmax(360px,2fr)]">
        <Panel
          className={clsx(
            "min-w-0 p-5 2xl:col-start-1 2xl:row-start-1",
            (calendarSection.collapsed || withPace) && "self-start",
          )}
        >
          <SectionHeading
            id="activity-heading"
            title={t("Cover calendar")}
            caption={t("Most played game each day · {{range}}", {
              range: rangeLabel,
            })}
            collapsed={calendarSection.collapsed}
            onToggle={calendarSection.toggle}
            controls="activity-calendar-body"
          />
          {!calendarSection.collapsed ? (
            <div id="activity-calendar-body">
              {sessions.length === 0 || !shownRange ? (
                <div className="py-12 text-center text-sm text-text-muted">
                  {t("Playtime activity will appear here.")}
                </div>
              ) : (
                <CoverCalendarPager
                  key={selectionKey(selection)}
                  sessions={sessions}
                  range={shownRange}
                  nowMs={nowMs}
                  resolveIgdbId={resolveIgdbId}
                  thresholds={dayThresholds}
                  colorSlots={colorSlots}
                  showDurationDays={showDurationDays}
                  resolveGameName={resolveGameName}
                  resolveGameCover={resolveGameCover}
                  onSelectDay={onSelectDay}
                  labelledBy="activity-heading"
                />
              )}
            </div>
          ) : null}
        </Panel>
        <div
          className={clsx(
            "grid min-w-0 content-start gap-6 2xl:col-start-2 2xl:row-start-1",
            rhythmBeside && "2xl:row-span-2",
          )}
        >
          {previousChart && comparisonLabel ? (
            <Panel className="min-w-0 p-5">
              <SectionHeading
                id="pace-heading"
                title={t("Pace")}
                caption={t("Running total · {{range}} vs. {{period}}", {
                  range: rangeLabel,
                  period: comparisonLabel,
                })}
                collapsed={paceSection.collapsed}
                onToggle={paceSection.toggle}
                controls="pace-body"
              />
              {!paceSection.collapsed ? (
                <figure
                  id="pace-body"
                  aria-labelledby="pace-heading"
                  className="m-0"
                >
                  <PaceChart
                    current={chart.full}
                    previous={previousChart.full}
                    nowMs={nowMs}
                    showDurationDays={showDurationDays}
                  />
                  <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-text-muted">
                    <li className="inline-flex items-center gap-1.5">
                      <span
                        aria-hidden="true"
                        className="h-0.5 w-3 rounded-full bg-accent"
                      />
                      {rangeLabel}{" "}
                      <span className="font-mono font-semibold text-text">
                        {formatDuration(
                          rangeStats.totalSeconds,
                          showDurationDays,
                        )}
                      </span>
                    </li>
                    <li className="inline-flex items-center gap-1.5">
                      <span
                        aria-hidden="true"
                        className="h-0.5 w-3 rounded-full bg-text-muted/80"
                      />
                      {comparisonLabel}{" "}
                      <span className="font-mono font-semibold text-text">
                        {formatDuration(previousSeconds, showDurationDays)}
                      </span>
                    </li>
                  </ul>
                </figure>
              ) : null}
            </Panel>
          ) : null}
          <Panel
            className={clsx(
              "min-w-0 p-5",
              habitsSection.collapsed && "self-start",
            )}
          >
            <SectionHeading
              id="habits-heading"
              title={t("Play habits")}
              caption={rangeLabel}
              collapsed={habitsSection.collapsed}
              onToggle={habitsSection.toggle}
              controls="habits-body"
            />
            {!habitsSection.collapsed ? (
              <div id="habits-body">
                {habits.gamesPlayed === 0 ? (
                  <div className="py-12 text-center text-sm text-text-muted">
                    {t("Your habits will appear here.")}
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
        <Panel
          className={clsx(
            "min-w-0 p-5",
            rhythmBeside
              ? "self-start 2xl:col-start-1 2xl:row-start-2"
              : "2xl:col-span-2",
          )}
        >
          <SectionHeading
            id="rhythm-heading"
            title={t("When you play")}
            caption={t("Weekday × hour · {{title}}", { title: rangeLabel })}
            collapsed={rhythmSection.collapsed}
            onToggle={rhythmSection.toggle}
            controls="rhythm-body"
          />
          {!rhythmSection.collapsed ? (
            <div id="rhythm-body">
              {sessions.length === 0 ? (
                <div className="py-12 text-center text-sm text-text-muted">
                  {t("Your play rhythm will appear here.")}
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
    </div>
  );
});

/* The stacked chart's legend: its colored games with cover and playtime, the
   rest as "Other". Pointing at a game lights its parts of the bars. */
function GameLegend({
  games,
  colorSlots,
  pickedCovers,
  showDurationDays,
  onLight,
}: {
  games: TopGame[];
  colorSlots: ReadonlyMap<string, number>;
  pickedCovers: Record<string, string>;
  showDurationDays: boolean;
  onLight: (key: string | null) => void;
}) {
  const colored = games.filter((game) => game.key && colorSlots.has(game.key));
  const rest = games.filter((game) => !game.key || !colorSlots.has(game.key));
  const restSeconds = rest.reduce((sum, game) => sum + game.seconds, 0);
  return (
    <ul
      data-chart-legend
      aria-label={t("Games in the chart")}
      className="mt-3.5 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-text-muted"
    >
      {colored.map((game) => {
        const cover = (game.key && pickedCovers[game.key]) || game.coverUrl;
        return (
          <li
            key={game.key}
            className="inline-flex items-center gap-1.5 hover:text-text"
            onPointerEnter={() => onLight(game.key)}
            onPointerLeave={() => onLight(null)}
          >
            <span
              aria-hidden="true"
              className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
              style={{ background: gameColor(colorSlots.get(game.key!)) }}
            />
            {cover ? (
              <img
                src={cover}
                alt=""
                aria-hidden="true"
                loading="lazy"
                className="h-5 w-[15px] shrink-0 rounded-[2px] object-cover"
              />
            ) : null}
            {game.name}{" "}
            <span className="font-mono font-semibold text-text">
              {formatDuration(game.seconds, showDurationDays)}
            </span>
          </li>
        );
      })}
      {rest.length > 0 ? (
        <li
          className="inline-flex items-center gap-1.5 hover:text-text"
          title={rest.map((game) => game.name).join(", ")}
          onPointerEnter={() => onLight("")}
          onPointerLeave={() => onLight(null)}
        >
          <span
            aria-hidden="true"
            className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
            style={{ background: gameColor(undefined) }}
          />
          {t("Other games ({{number}})", { number: rest.length })}{" "}
          <span className="font-mono font-semibold text-text">
            {formatDuration(restSeconds, showDurationDays)}
          </span>
        </li>
      ) : null}
    </ul>
  );
}

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
      label: t("Favourite day"),
      value: weekdayNames("long")[habits.favoriteWeekday.index],
      detail: t("{{percent}} of playtime", {
        percent: formatPercent(habits.favoriteWeekday.share),
      }),
    });
  }
  if (habits.primeHours) {
    facts.push({
      label: t("Prime time"),
      value: `${formatHour(habits.primeHours.from)} – ${formatHour(habits.primeHours.to)}`,
      detail: t("your busiest two hours"),
    });
  }
  facts.push({
    label: t("Per active day"),
    value: formatDuration(habits.perActiveDaySeconds, showDurationDays),
    detail: t("on days you played"),
  });
  facts.push({
    label: t("Weekend share"),
    value: formatPercent(habits.weekendShare),
    detail: t("{{percent}} on weekdays", {
      percent: formatPercent(1 - habits.weekendShare),
    }),
  });
  facts.push({
    label: t("Night owl"),
    value: formatPercent(habits.lateNightShare),
    detail: t("played between midnight and 5"),
  });
  facts.push({
    label: t("Games played"),
    value: String(habits.gamesPlayed),
    detail: t("{{gamesOverTenHours}} with over 10h", {
      gamesOverTenHours: habits.gamesOverTenHours,
    }),
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
