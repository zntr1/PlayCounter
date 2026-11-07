import { Timer } from "lucide-react";
import { useState } from "react";
import type { GameSeason, HistoryRange } from "../../../historyStats";
import { ChartTooltip, useChartTooltip } from "../../charts/ChartTooltip";
import {
  addDays,
  localDateKey,
  useElementWidth,
} from "../../charts/chartUtils";
import { gameColor } from "../../charts/gameColors";
import { formatDuration } from "../../components";
import { GameCover } from "../../GameCover";
import { appLocale, getT } from "../../../i18n";

const t = getT("history");

/** Lanes shown before "Show all". */
const visibleLanes = 8;
const labelWidth = 230;
const labelGap = 8;
const dayMs = 86_400_000;

function startOfDay(ms: number) {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/* Game seasons: one lane per game across the range, a bar for each day it was
   played (one scale for all lanes) and a faint line from its first to its
   last day, so what you were into when, and the comebacks, show at a glance.
   Eight lanes, the rest behind "Show all". */
export function GameSeasons({
  seasons,
  range,
  colorSlots,
  showDurationDays,
  resolveGameName,
  resolveGameCover,
  onSelectGame,
}: {
  seasons: GameSeason[];
  range: HistoryRange;
  colorSlots: ReadonlyMap<string, number>;
  showDurationDays: boolean;
  resolveGameName: (key: string | null) => string | null;
  resolveGameCover: (key: string | null) => string | null;
  onSelectGame: (key: string) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const [containerRef, width] = useElementWidth<HTMLDivElement>();
  const tooltip = useChartTooltip();
  const dayCount = Math.max(1, Math.round((range.toMs - range.fromMs) / dayMs));
  const plotWidth = Math.max(0, width - labelWidth - labelGap);
  const dayWidth = plotWidth / dayCount;
  const dayIndex = (ms: number) =>
    Math.round((startOfDay(ms) - range.fromMs) / dayMs);
  // One scale for every lane, folded ones included, so opening them
  // doesn't resize the rest.
  const mostInADay = Math.max(
    1,
    ...seasons.flatMap((season) => season.days.map((day) => day.seconds)),
  );
  const shown = showAll ? seasons : seasons.slice(0, visibleLanes);
  const nameOf = (key: string) => resolveGameName(key) ?? t("Unknown game");

  const ticks: Array<{ x: number; label: string }> = [];
  let lastTickX = Number.NEGATIVE_INFINITY;
  const tick = (ms: number, label: string) => {
    const x = dayIndex(ms) * dayWidth;
    if (x - lastTickX < 44) return;
    ticks.push({ x, label });
    lastTickX = x;
  };
  if (plotWidth > 0) {
    const first = new Date(range.fromMs);
    if (dayCount <= 62) {
      const firstMonday = (8 - first.getDay()) % 7;
      if (firstMonday * dayWidth >= 44)
        tick(
          range.fromMs,
          first.toLocaleDateString(appLocale(), {
            month: "short",
            day: "numeric",
          }),
        );
      for (
        let day = addDays(first, firstMonday);
        day.getTime() < range.toMs;
        day = addDays(day, 7)
      )
        tick(
          day.getTime(),
          day.toLocaleDateString(appLocale(), {
            month: "short",
            day: "numeric",
          }),
        );
    } else {
      let month = new Date(first.getFullYear(), first.getMonth(), 1);
      if (month.getTime() < range.fromMs)
        month = new Date(first.getFullYear(), first.getMonth() + 1, 1);
      for (
        ;
        month.getTime() < range.toMs;
        month = new Date(month.getFullYear(), month.getMonth() + 1, 1)
      )
        tick(
          month.getTime(),
          month.toLocaleDateString(
            appLocale(),
            month.getMonth() === 0
              ? { month: "short", year: "numeric" }
              : { month: "short" },
          ),
        );
    }
  }

  return (
    <div ref={containerRef} className="min-w-0">
      {shown.map((season, index) => {
        const thin = index >= visibleLanes;
        const laneHeight = thin ? 26 : 38;
        const color = gameColor(colorSlots.get(season.key));
        const cover = resolveGameCover(season.key);
        const firstDay = season.days[0];
        const lastDay = season.days[season.days.length - 1];
        const barGap = dayWidth > 5 ? 2 : dayWidth > 2.5 ? 1 : 0;
        const barWidth = Math.max(1.5, dayWidth - barGap);
        return (
          <div
            key={season.key}
            data-season-lane={season.key}
            data-thin={thin || undefined}
            className="grid items-end border-b border-border/45 py-[3px]"
            style={{
              gridTemplateColumns: `${labelWidth}px minmax(0, 1fr)`,
              columnGap: labelGap,
            }}
          >
            <button
              type="button"
              title={t("Show sessions of this game")}
              onClick={() => onSelectGame(season.key)}
              className="group grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2.5 rounded-md pr-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
            >
              {cover ? (
                <GameCover
                  src={cover}
                  alt=""
                  loading="lazy"
                  draggable={false}
                  className={
                    thin
                      ? "h-[27px] w-5 rounded-[3px] object-cover"
                      : "h-[35px] w-[26px] rounded-[3px] object-cover"
                  }
                />
              ) : (
                <span
                  aria-hidden="true"
                  className={
                    thin
                      ? "grid h-[27px] w-5 place-items-center rounded-[3px] bg-surface-hover text-text-faint"
                      : "grid h-[35px] w-[26px] place-items-center rounded-[3px] bg-surface-hover text-text-faint"
                  }
                >
                  <Timer size={12} />
                </span>
              )}
              <span
                data-season-name
                className={
                  thin
                    ? "truncate text-xs font-semibold text-text-muted group-hover:text-accent-ink"
                    : "truncate text-[13px] font-semibold text-text group-hover:text-accent-ink"
                }
              >
                {nameOf(season.key)}
              </span>
              <span className="font-mono text-xs font-semibold text-text-muted">
                {formatDuration(season.seconds, showDurationDays)}
              </span>
            </button>
            {plotWidth > 0 ? (
              <svg
                width={plotWidth}
                height={laneHeight}
                className="block overflow-visible"
              >
                <line
                  x1="0"
                  x2={plotWidth}
                  y1={laneHeight - 0.5}
                  y2={laneHeight - 0.5}
                  stroke="rgb(var(--color-border) / 0.8)"
                  strokeWidth="1"
                />
                {firstDay && lastDay ? (
                  <rect
                    x={dayIndex(firstDay.fromMs) * dayWidth}
                    y={laneHeight - 3}
                    width={Math.max(
                      2,
                      (dayIndex(lastDay.fromMs) +
                        1 -
                        dayIndex(firstDay.fromMs)) *
                        dayWidth,
                    )}
                    height="3"
                    rx="1.5"
                    fill={color}
                    opacity="0.35"
                  />
                ) : null}
                {season.days.map((day) => {
                  const height = Math.max(
                    3,
                    (day.seconds / mostInADay) * (laneHeight - 9),
                  );
                  return (
                    <rect
                      key={day.fromMs}
                      data-season-day={localDateKey(new Date(day.fromMs))}
                      x={dayIndex(day.fromMs) * dayWidth + barGap / 2}
                      y={laneHeight - 4 - height}
                      width={barWidth}
                      height={height}
                      rx={barWidth > 6 ? 2 : 0.5}
                      fill={color}
                      className="transition-[filter] hover:brightness-125"
                      onPointerEnter={(event) =>
                        tooltip.show(
                          event.currentTarget,
                          <div className="grid gap-1">
                            <div className="font-semibold">
                              {nameOf(season.key)}
                            </div>
                            <div className="font-mono font-bold">
                              {formatDuration(day.seconds, showDurationDays)}
                            </div>
                            <div className="text-text-muted">
                              {new Date(day.fromMs).toLocaleDateString(
                                appLocale(),
                                {
                                  weekday: "short",
                                  month: "short",
                                  day: "numeric",
                                  year: "numeric",
                                },
                              )}
                            </div>
                          </div>,
                        )
                      }
                      onPointerLeave={() => tooltip.hide()}
                    />
                  );
                })}
              </svg>
            ) : (
              <div style={{ height: laneHeight }} />
            )}
          </div>
        );
      })}
      <div
        data-season-axis
        aria-hidden="true"
        className="relative mt-1 h-5"
        style={{ marginLeft: labelWidth + labelGap, width: plotWidth }}
      >
        {ticks.map((entry) => (
          <span
            key={entry.x}
            className="absolute top-[3px] whitespace-nowrap border-l border-border pl-1 text-[10px] font-semibold text-text-faint"
            style={{ left: entry.x }}
          >
            {entry.label}
          </span>
        ))}
      </div>
      {seasons.length > visibleLanes ? (
        <button
          type="button"
          aria-expanded={showAll}
          onClick={() => setShowAll((open) => !open)}
          className="mt-2 rounded-md text-xs font-semibold text-accent-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        >
          {showAll
            ? t("Show fewer")
            : t("Show all {{count}} games", { count: seasons.length })}
        </button>
      ) : null}
      <ChartTooltip state={tooltip.state} onClose={tooltip.hide} />
    </div>
  );
}
