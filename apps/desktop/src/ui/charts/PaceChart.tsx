import { useMemo } from "react";
import { cumulativeSeconds, type HistoryBucket } from "../../historyStats";
import { formatDuration } from "../components";
import { ChartTooltip, useChartTooltip } from "./ChartTooltip";
import { useElementWidth } from "./chartUtils";
import { appLocale, getT } from "../../i18n";

const t = getT("common");

const chartHeight = 190;
const margin = { top: 12, right: 64, bottom: 24, left: 46 };

function niceCeiling(value: number) {
  if (value <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  const fraction = value / power;
  const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return nice * power;
}

/** Hours on the axis (minutes under two hours): a running total reads as
 *  "40h", never as "1.7d". */
function axis(seconds: number) {
  const divisor = seconds < 7200 ? 60 : 3600;
  const suffix = divisor === 60 ? "m" : "h";
  const maxValue = niceCeiling(Math.max(1, seconds / divisor));
  return {
    maxSeconds: maxValue * divisor,
    ticks: Array.from({ length: 5 }, (_, index) => ({
      seconds: (index * maxValue * divisor) / 4,
      label: `${((index * maxValue) / 4).toLocaleString(appLocale(), {
        maximumFractionDigits: 1,
        useGrouping: false,
      })}${suffix}`,
    })),
  };
}

/* The range's running total next to the period before's, same scale: the
   accent line with a soft wash, the period before as a muted line. */
export function PaceChart({
  current,
  previous,
  nowMs,
  showDurationDays,
}: {
  current: HistoryBucket[];
  previous: HistoryBucket[];
  /** A range still in progress draws its line only up to now. */
  nowMs: number;
  showDurationDays: boolean;
}) {
  const [containerRef, width] = useElementWidth<HTMLDivElement>();
  const tooltip = useChartTooltip();
  const currentTotals = useMemo(
    () => cumulativeSeconds(current, nowMs),
    [current, nowMs],
  );
  const previousTotals = useMemo(() => cumulativeSeconds(previous), [previous]);
  const count = Math.max(current.length, previous.length, 1);
  const scale = axis(
    Math.max(60, currentTotals.at(-1) ?? 0, previousTotals.at(-1) ?? 0),
  );
  const plotWidth = Math.max(0, width - margin.left - margin.right);
  const plotHeight = chartHeight - margin.top - margin.bottom;
  const xOf = (index: number) => margin.left + (index / count) * plotWidth;
  const yOf = (seconds: number) =>
    margin.top + plotHeight * (1 - seconds / scale.maxSeconds);
  const points = (totals: number[]) => [
    [xOf(0), yOf(0)],
    ...totals.map((total, index) => [xOf(index + 1), yOf(total)]),
  ];
  const line = (shape: number[][]) =>
    shape.map(([x, y], index) => `${index ? "L" : "M"} ${x} ${y}`).join(" ");
  const currentPoints = points(currentTotals);
  const previousPoints = points(previousTotals);
  const [currentX, currentY] = currentPoints.at(-1)!;
  const [previousX, previousY] = previousPoints.at(-1)!;
  const labelsApart =
    Math.abs(currentY - previousY) >= 15 ||
    Math.abs(currentX - previousX) >= 70;
  const ticks = [
    0,
    Math.floor((current.length - 1) / 2),
    current.length - 1,
  ].filter(
    (index, position, all) =>
      index >= 0 && index < current.length && all.indexOf(index) === position,
  );

  const tooltipContent = (index: number) => (
    <div className="grid gap-1">
      {current[index] ? (
        <>
          <div className="font-semibold">{current[index].tooltip}</div>
          {currentTotals[index] !== undefined ? (
            <div className="font-mono font-bold">
              {formatDuration(currentTotals[index], showDurationDays)}
            </div>
          ) : null}
        </>
      ) : null}
      {previous[index] ? (
        <div className="text-text-muted">
          {previous[index].tooltip}:{" "}
          <span className="font-mono font-semibold text-text">
            {formatDuration(previousTotals[index], showDurationDays)}
          </span>
        </div>
      ) : null}
    </div>
  );

  return (
    <div ref={containerRef} className="relative w-full">
      {width > 0 ? (
        <svg
          aria-hidden="true"
          width={width}
          height={chartHeight}
          className="block overflow-visible"
        >
          {scale.ticks.map((tick) => (
            <g key={tick.seconds}>
              <line
                x1={margin.left}
                x2={width - margin.right}
                y1={yOf(tick.seconds)}
                y2={yOf(tick.seconds)}
                stroke="rgb(var(--color-border))"
                strokeWidth="1"
              />
              <text
                x={margin.left - 8}
                y={yOf(tick.seconds) + 4}
                textAnchor="end"
                fill="rgb(var(--color-text-faint))"
                fontSize="11"
                className="tabular-nums"
              >
                {tick.label}
              </text>
            </g>
          ))}
          <path
            d={`${line(currentPoints)} L ${currentX} ${yOf(0)} L ${xOf(0)} ${yOf(0)} Z`}
            fill="rgb(var(--color-accent) / 0.1)"
          />
          <path
            d={line(previousPoints)}
            fill="none"
            stroke="rgb(var(--color-text-muted) / 0.7)"
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          <path
            d={line(currentPoints)}
            fill="none"
            stroke="rgb(var(--color-accent))"
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          <circle
            cx={previousX}
            cy={previousY}
            r="4"
            fill="rgb(var(--color-text-muted))"
            stroke="rgb(var(--color-surface))"
            strokeWidth="2"
          />
          <circle
            cx={currentX}
            cy={currentY}
            r="4.5"
            fill="rgb(var(--color-accent))"
            stroke="rgb(var(--color-surface))"
            strokeWidth="2"
          />
          <text
            x={currentX + 9}
            y={currentY + 4}
            fill="rgb(var(--color-text))"
            fontSize="12"
            fontWeight="700"
            className="font-mono"
          >
            {formatDuration(currentTotals.at(-1) ?? 0, showDurationDays)}
          </text>
          {labelsApart ? (
            <text
              x={previousX + 9}
              y={previousY + 4}
              fill="rgb(var(--color-text-muted))"
              fontSize="12"
              fontWeight="700"
              className="font-mono"
            >
              {formatDuration(previousTotals.at(-1) ?? 0, showDurationDays)}
            </text>
          ) : null}
          {ticks.map((index) => (
            <text
              key={index}
              x={xOf(index + 1)}
              y={chartHeight - 6}
              textAnchor={
                index === current.length - 1
                  ? "end"
                  : index === 0
                    ? "start"
                    : "middle"
              }
              fill="rgb(var(--color-text-faint))"
              fontSize="10"
              fontWeight="600"
            >
              {current[index].label}
            </text>
          ))}
          {Array.from({ length: count }, (_, index) => (
            <rect
              key={index}
              x={xOf(index)}
              y={margin.top}
              width={plotWidth / count}
              height={plotHeight}
              fill="transparent"
              onPointerEnter={(event) =>
                tooltip.show(event.currentTarget, tooltipContent(index))
              }
              onPointerLeave={() => tooltip.hide()}
            />
          ))}
        </svg>
      ) : (
        <div style={{ height: chartHeight }} />
      )}
      <ChartTooltip state={tooltip.state} onClose={tooltip.hide} />
      <span className="sr-only">
        {t("Running total: {{current}}, the period before: {{previous}}", {
          current: formatDuration(currentTotals.at(-1) ?? 0, showDurationDays),
          previous: formatDuration(
            previousTotals.at(-1) ?? 0,
            showDurationDays,
          ),
        })}
      </span>
    </div>
  );
}
