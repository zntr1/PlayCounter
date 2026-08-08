import { useRef, useState } from "react";
import { quantileLevel, quantileThresholds } from "../../historyStats";
import { formatDuration } from "../components";
import { ChartTooltip, useChartTooltip } from "./ChartTooltip";
import { heatmapColor, useElementWidth } from "./chartUtils";

const weekdayLabels = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];
const gap = 3;

export function RhythmHeatmap({
  matrix,
  showDurationDays,
}: {
  matrix: number[][];
  showDurationDays: boolean;
}) {
  const values = matrix.flat();
  const thresholds = quantileThresholds(values);
  const [activeIndex, setActiveIndex] = useState(0);
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const tooltip = useChartTooltip();
  const [figureRef, availableWidth] = useElementWidth<HTMLElement>();
  const cellSize = Math.max(
    14,
    Math.min(40, Math.floor((availableWidth - 68 - 23 * gap) / 24) || 14),
  );

  function focusIndex(index: number) {
    const next = Math.max(0, Math.min(values.length - 1, index));
    setActiveIndex(next);
    refs.current[next]?.focus();
  }

  return (
    <figure
      ref={figureRef}
      aria-labelledby="rhythm-title"
      className="overflow-x-auto pb-1"
    >
      <figcaption id="rhythm-title" className="sr-only">
        All-time playtime by weekday and hour
      </figcaption>
      <div className="min-w-max">
        <div
          className="mb-1 ml-[68px] grid"
          style={{ gridTemplateColumns: `repeat(24, ${cellSize}px)`, gap }}
        >
          {Array.from({ length: 24 }, (_, hour) => (
            <span key={hour} className="text-center text-[9px] text-text-faint">
              {hour % 3 === 0 ? String(hour).padStart(2, "0") : ""}
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <div
            className="grid"
            style={{ gridTemplateRows: `repeat(7, ${cellSize}px)`, gap }}
          >
            {weekdayLabels.map((label) => (
              <span
                key={label}
                className="w-[60px] truncate text-right text-[10px] text-text-faint"
                style={{ height: cellSize, lineHeight: `${cellSize}px` }}
              >
                {label.slice(0, 3)}
              </span>
            ))}
          </div>
          <div
            role="grid"
            aria-label="Playtime by weekday and hour"
            className="grid"
            style={{
              gridTemplateColumns: `repeat(24, ${cellSize}px)`,
              gridTemplateRows: `repeat(7, ${cellSize}px)`,
              gap,
            }}
          >
            {values.map((seconds, index) => {
              const day = Math.floor(index / 24);
              const hour = index % 24;
              const level = quantileLevel(seconds, thresholds);
              const content = (
                <div className="grid gap-1">
                  <div className="font-semibold">
                    {weekdayLabels[day]}, {String(hour).padStart(2, "0")}:00
                  </div>
                  <div>{formatDuration(seconds, showDurationDays)}</div>
                </div>
              );
              return (
                <button
                  key={`${day}-${hour}`}
                  ref={(element) => {
                    refs.current[index] = element;
                  }}
                  type="button"
                  role="gridcell"
                  tabIndex={index === activeIndex ? 0 : -1}
                  aria-label={`${weekdayLabels[day]} at ${hour}:00: ${formatDuration(seconds, showDurationDays)}`}
                  className="rounded-[2px] border-0 p-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-text"
                  style={{
                    background:
                      level === 0
                        ? "rgb(var(--color-surface-hover))"
                        : heatmapColor(level, thresholds.length)!,
                  }}
                  onPointerEnter={(event) => {
                    setActiveIndex(index);
                    tooltip.show(event.currentTarget, content);
                  }}
                  onPointerLeave={tooltip.hide}
                  onFocus={(event) =>
                    tooltip.show(event.currentTarget, content)
                  }
                  onBlur={tooltip.hide}
                  onKeyDown={(event) => {
                    const move =
                      event.key === "ArrowLeft" && hour > 0
                        ? -1
                        : event.key === "ArrowRight" && hour < 23
                          ? 1
                          : event.key === "ArrowUp" && day > 0
                            ? -24
                            : event.key === "ArrowDown" && day < 6
                              ? 24
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
      <ChartTooltip state={tooltip.state} onClose={tooltip.hide} />
    </figure>
  );
}
