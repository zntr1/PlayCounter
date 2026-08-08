import { useEffect, useMemo, useRef, useState } from "react";
import type { DailyTotal } from "../../historyStats";
import { quantileLevel, quantileThresholds } from "../../historyStats";
import { formatDuration } from "../components";
import { ChartTooltip, useChartTooltip } from "./ChartTooltip";
import {
  addDays,
  formatAccessibleDate,
  heatmapColor,
  heatmapColors,
  localDateKey,
  useElementWidth,
} from "./chartUtils";

const weekCount = 53;
const cellGap = 3;
const weekdayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function CalendarHeatmap({
  totals,
  nowMs,
  showDurationDays,
  resolveGameName,
}: {
  totals: Map<string, DailyTotal>;
  nowMs: number;
  showDurationDays: boolean;
  resolveGameName: (key: string | null) => string | null;
}) {
  const [scrollRef, availableWidth] = useElementWidth<HTMLDivElement>();
  const cellRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const tooltip = useChartTooltip();
  const cellSize = Math.max(
    11,
    Math.min(
      28,
      Math.floor(
        (availableWidth - 40 - (weekCount - 1) * cellGap) / weekCount,
      ) || 11,
    ),
  );
  const columnSize = cellSize + cellGap;
  const today = useMemo(() => {
    const value = new Date(nowMs);
    value.setHours(0, 0, 0, 0);
    return value;
  }, [nowMs]);
  const dataStart = useMemo(() => {
    const firstKey = totals.keys().next().value as string | undefined;
    return firstKey ? new Date(`${firstKey}T00:00:00`) : addDays(today, -363);
  }, [today, totals]);
  const firstDay = useMemo(() => {
    const mondayOffset = (dataStart.getDay() + 6) % 7;
    return addDays(dataStart, -mondayOffset);
  }, [dataStart]);
  const cells = useMemo(
    () =>
      Array.from({ length: weekCount * 7 }, (_, index) => {
        const date = addDays(firstDay, index);
        const isOutside = date < dataStart || date > today;
        return {
          date,
          key: localDateKey(date),
          total: isOutside ? undefined : totals.get(localDateKey(date)),
          isOutside,
        };
      }),
    [dataStart, firstDay, today, totals],
  );
  const thresholds = useMemo(
    () => quantileThresholds(cells.map((cell) => cell.total?.seconds ?? 0)),
    [cells],
  );

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
    }
  }, [cellSize, scrollRef]);

  useEffect(() => {
    const todayIndex = cells.findIndex(
      (cell) => cell.key === localDateKey(today),
    );
    if (todayIndex >= 0) setActiveIndex(todayIndex);
  }, [cells, today]);

  const months = useMemo(() => {
    const result: Array<{ label: string; column: number }> = [];
    let previous = -1;
    for (let column = 0; column < weekCount; column += 1) {
      const date = addDays(firstDay, column * 7);
      if (date.getMonth() !== previous) {
        result.push({
          label: date.toLocaleDateString([], { month: "short" }),
          column,
        });
        previous = date.getMonth();
      }
    }
    return result;
  }, [firstDay]);

  function content(index: number) {
    const cell = cells[index];
    const total = cell.total;
    return (
      <div className="grid gap-1">
        <div className="font-semibold">{formatAccessibleDate(cell.date)}</div>
        <div>{formatDuration(total?.seconds ?? 0, showDurationDays)}</div>
        <div className="text-text-muted">
          {total?.sessionCount ?? 0} session
          {(total?.sessionCount ?? 0) === 1 ? "" : "s"}
          {total?.topGameKey
            ? ` · ${resolveGameName(total.topGameKey) ?? "Unknown game"}`
            : ""}
        </div>
      </div>
    );
  }

  function focusIndex(index: number) {
    const next = Math.max(0, Math.min(cells.length - 1, index));
    if (cells[next]?.isOutside) return;
    setActiveIndex(next);
    cellRefs.current[next]?.focus();
  }

  return (
    <figure aria-labelledby="activity-calendar-title">
      <figcaption className="sr-only" id="activity-calendar-title">
        Daily playtime over the last 52 weeks
      </figcaption>
      <div ref={scrollRef} className="overflow-x-auto pb-2">
        <div className="min-w-max">
          <div
            className="relative ml-8 h-5"
            style={{ width: weekCount * columnSize }}
          >
            {months.map((month) => (
              <span
                key={`${month.label}-${month.column}`}
                className="absolute text-[10px] font-medium text-text-faint"
                style={{ left: month.column * columnSize }}
              >
                {month.label}
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <div
              className="grid text-[10px] font-medium text-text-faint"
              style={{
                gridTemplateRows: `repeat(7, ${cellSize}px)`,
                gap: cellGap,
              }}
            >
              {weekdayLabels.map((label, index) => (
                <span
                  key={label}
                  style={{ height: cellSize, lineHeight: `${cellSize}px` }}
                >
                  {index % 2 === 0 ? label : ""}
                </span>
              ))}
            </div>
            <div
              role="grid"
              aria-label="Daily playtime calendar"
              className="grid grid-flow-col"
              style={{
                gridTemplateRows: `repeat(7, ${cellSize}px)`,
                gridAutoColumns: `${cellSize}px`,
                gap: cellGap,
              }}
            >
              {cells.map((cell, index) => {
                const level = quantileLevel(
                  cell.total?.seconds ?? 0,
                  thresholds,
                );
                const background = cell.isOutside
                  ? "transparent"
                  : level === 0
                    ? "rgb(var(--color-surface-hover))"
                    : heatmapColor(level, thresholds.length)!;
                return (
                  <button
                    key={cell.key}
                    ref={(element) => {
                      cellRefs.current[index] = element;
                    }}
                    type="button"
                    role="gridcell"
                    tabIndex={index === activeIndex ? 0 : -1}
                    disabled={cell.isOutside}
                    aria-label={`${formatAccessibleDate(cell.date)}: ${formatDuration(cell.total?.seconds ?? 0, showDurationDays)}`}
                    className="rounded-[2px] border-0 p-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-text"
                    style={{ width: cellSize, height: cellSize, background }}
                    onPointerEnter={(event) => {
                      if (cell.isOutside) return;
                      setActiveIndex(index);
                      tooltip.show(event.currentTarget, content(index));
                    }}
                    onPointerLeave={tooltip.hide}
                    onFocus={(event) => {
                      if (!cell.isOutside)
                        tooltip.show(event.currentTarget, content(index));
                    }}
                    onBlur={tooltip.hide}
                    onKeyDown={(event) => {
                      const weekday = index % 7;
                      const move =
                        event.key === "ArrowUp" && weekday > 0
                          ? -1
                          : event.key === "ArrowDown" && weekday < 6
                            ? 1
                            : event.key === "ArrowLeft"
                              ? -7
                              : event.key === "ArrowRight"
                                ? 7
                                : undefined;
                      if (move !== undefined) {
                        event.preventDefault();
                        focusIndex(index + move);
                      }
                    }}
                  />
                );
              })}
            </div>
          </div>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-end gap-1.5 text-[10px] text-text-faint">
        <span>Less</span>
        <span className="h-[11px] w-[11px] rounded-[2px] bg-surface-hover" />
        {heatmapColors.map((color) => (
          <span
            key={color}
            className="h-[11px] w-[11px] rounded-[2px]"
            style={{ background: color }}
          />
        ))}
        <span>More</span>
      </div>
      <ChartTooltip state={tooltip.state} onClose={tooltip.hide} />
    </figure>
  );
}
