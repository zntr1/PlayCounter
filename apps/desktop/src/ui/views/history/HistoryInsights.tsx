import type { Session } from "@playcounter/shared";
import { Maximize2, X } from "lucide-react";
import {
  memo,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
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
import { IconButton, useEscapeKey } from "../../primitives";

type ResolvedGame = { name: string; coverUrl: string };

function PanelHeading({
  id,
  title,
  caption,
  action,
}: {
  id: string;
  title: string;
  caption: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-5 flex min-w-0 items-start justify-between gap-4">
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
  onSelectGame,
}: {
  sessions: Session[];
  filter: HistoryFilter;
  nowMs: number;
  showDurationDays: boolean;
  resolveGame: (session: Session) => ResolvedGame;
  onSelectGame: (key: string, name: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const expandButtonRef = useRef<HTMLButtonElement>(null);
  const selectedRange = useMemo(
    () => historyRange(filter, nowMs),
    [filter, nowMs],
  );
  const chart = useMemo(
    () => bucketSessions(sessions, filter, nowMs),
    [filter, nowMs, sessions],
  );
  const rangeStats = useMemo(
    () => summaryStats(sessions, nowMs, selectedRange),
    [nowMs, selectedRange, sessions],
  );
  const allTimeStats = useMemo(
    () => summaryStats(sessions, nowMs),
    [nowMs, sessions],
  );
  const games = useMemo(
    () => topGames(sessions, resolveGame, 8, selectedRange),
    [resolveGame, selectedRange, sessions],
  );
  const rhythm = useMemo(
    () => weekdayHourMatrix(sessions, nowMs),
    [nowMs, sessions],
  );
  const calendar = useMemo(() => {
    const today = new Date(nowMs);
    today.setHours(0, 0, 0, 0);
    const from = addDays(today, -363);
    return dailyTotals(sessions, from.getTime(), addDays(today, 1).getTime());
  }, [nowMs, sessions]);
  const gamesByKey = useMemo(() => {
    const games = new Map<string, ResolvedGame>();
    for (const session of sessions) {
      games.set(getSessionGameKey(session), resolveGame(session));
    }
    return games;
  }, [resolveGame, sessions]);
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
    : "—";

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

      <Panel className="min-w-0 p-5">
        <PanelHeading
          id="playtime-chart-heading"
          title="Playtime over time"
          caption={`${formatDuration(chartTotal, showDurationDays)} logged · ${chart.title}`}
          action={
            <IconButton
              ref={expandButtonRef}
              icon={Maximize2}
              aria-label="Expand playtime chart"
              onClick={() => setExpanded(true)}
            />
          }
        />
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
      </Panel>

      <Panel className="min-w-0 p-5">
        <PanelHeading
          id="activity-heading"
          title="Activity calendar"
          caption="Last 52 weeks · range chips do not apply"
        />
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
      </Panel>

      <div className="grid min-w-0 gap-6 2xl:grid-cols-[minmax(0,2fr)_minmax(520px,3fr)]">
        <Panel className="min-w-0 p-5">
          <PanelHeading
            id="rhythm-heading"
            title="When you play"
            caption="All time · range chips do not apply"
          />
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
        </Panel>
        <Panel className="min-w-0 p-5">
          <PanelHeading
            id="top-games-heading"
            title="Top games"
            caption={chart.title}
          />
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
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEscapeKey(onClose);
  useEffect(() => {
    closeRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = [
        ...dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      ];
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  return createPortal(
    <div
      className="fixed inset-0 z-[60] grid place-items-center bg-black/60 px-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="expanded-chart-title"
        className="flex h-[80vh] w-[calc(100vw-3rem)] max-w-none flex-col rounded-lg border border-border bg-surface p-6 shadow-raised"
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2
              id="expanded-chart-title"
              className="text-sm font-bold uppercase tracking-wider text-text-faint"
            >
              {title}
            </h2>
            <p className="mt-1 text-sm text-text-muted">
              {formatDuration(total, showDurationDays)} logged
            </p>
          </div>
          <IconButton
            ref={closeRef}
            icon={X}
            aria-label="Close chart"
            onClick={onClose}
          />
        </div>
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
      </div>
    </div>,
    document.body,
  );
}
