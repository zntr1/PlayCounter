import clsx from "clsx";
import { useMemo, useRef, useState } from "react";
import type { HistoryBucket } from "../../historyStats";
import { formatDuration } from "../components";
import { ChartTooltip, useChartTooltip } from "./ChartTooltip";
import { useElementWidth } from "./chartUtils";

const defaultChartHeight = 230;
const margin = { top: 10, right: 12, bottom: 34, left: 58 };

function niceCeiling(value: number) {
  if (value <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  const fraction = value / power;
  const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return nice * power;
}

function axis(seconds: number) {
  const divisor = seconds < 7200 ? 60 : seconds < 172800 ? 3600 : 86400;
  const suffix = divisor === 60 ? "m" : divisor === 3600 ? "h" : "d";
  const maxValue = niceCeiling(Math.max(1, seconds / divisor));
  return {
    maxSeconds: maxValue * divisor,
    ticks: Array.from({ length: 5 }, (_, index) => ({
      seconds: (index * maxValue * divisor) / 4,
      label: `${Number(((index * maxValue) / 4).toFixed(1))}${suffix}`,
    })),
  };
}

function roundedTopPath(x: number, y: number, width: number, height: number) {
  const radius = Math.min(4, width / 2, height);
  const bottom = y + height;
  return `M ${x} ${bottom} L ${x} ${y + radius} Q ${x} ${y} ${x + radius} ${y} L ${x + width - radius} ${y} Q ${x + width} ${y} ${x + width} ${y + radius} L ${x + width} ${bottom} Z`;
}

export function ColumnChart({
  buckets,
  showDurationDays,
  resolveGameName,
  resolveGameCover,
  className,
  height = defaultChartHeight,
}: {
  buckets: HistoryBucket[];
  showDurationDays: boolean;
  resolveGameName: (key: string | null) => string | null;
  resolveGameCover: (key: string | null) => string | null;
  className?: string;
  height?: number;
}) {
  const [containerRef, width] = useElementWidth<HTMLDivElement>();
  const [activeIndex, setActiveIndex] = useState(0);
  const [expandedCoverIndex, setExpandedCoverIndex] = useState<number | null>(
    null,
  );
  const targetRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const tooltip = useChartTooltip();
  const maxBucket = Math.max(0, ...buckets.map((bucket) => bucket.seconds));
  const scale = useMemo(() => axis(maxBucket), [maxBucket]);
  const plotWidth = Math.max(0, width - margin.left - margin.right);
  const plotHeight = height - margin.top - margin.bottom;
  const bandWidth = buckets.length > 0 ? plotWidth / buckets.length : 0;
  const widestLabel = Math.min(
    120,
    Math.max(38, ...buckets.map((bucket) => bucket.label.length * 6.5)),
  );
  const labelEvery = Math.max(
    1,
    Math.ceil(widestLabel / Math.max(1, bandWidth)),
  );

  const tooltipContent = (bucket: HistoryBucket) => (
    <div className="grid gap-1">
      <div className="font-semibold">{bucket.tooltip}</div>
      <div>{formatDuration(bucket.seconds, showDurationDays)}</div>
      <div className="text-text-muted">
        {bucket.sessionCount} total session
        {bucket.sessionCount === 1 ? "" : "s"}
      </div>
      {bucket.topGameKey ? (
        <div className="text-text-muted">
          Most played: {resolveGameName(bucket.topGameKey) ?? "Unknown game"}
        </div>
      ) : null}
    </div>
  );

  function focusIndex(index: number) {
    const next = Math.max(0, Math.min(buckets.length - 1, index));
    setActiveIndex(next);
    targetRefs.current[next]?.focus();
  }

  return (
    <div ref={containerRef} className={clsx("relative w-full", className)}>
      {width > 0 ? (
        <>
          <svg
            aria-hidden="true"
            width={width}
            height={height}
            className="block overflow-visible"
          >
            {scale.ticks.map((tick) => {
              const y =
                margin.top + plotHeight * (1 - tick.seconds / scale.maxSeconds);
              return (
                <g key={tick.seconds}>
                  <line
                    x1={margin.left}
                    x2={width - margin.right}
                    y1={y}
                    y2={y}
                    stroke="rgb(var(--color-border))"
                    strokeWidth="1"
                  />
                  <text
                    x={margin.left - 8}
                    y={y + 4}
                    textAnchor="end"
                    fill="rgb(var(--color-text-faint))"
                    fontSize="11"
                    className="tabular-nums"
                  >
                    {tick.label}
                  </text>
                </g>
              );
            })}
            {buckets.map((bucket, index) => {
              if (bucket.seconds <= 0) return null;
              const height = Math.max(
                1,
                (bucket.seconds / scale.maxSeconds) * plotHeight,
              );
              const barWidth = Math.min(24, Math.max(2, bandWidth * 0.62));
              const x =
                margin.left + index * bandWidth + (bandWidth - barWidth) / 2;
              const y = margin.top + plotHeight - height;
              return (
                <path
                  key={index}
                  d={roundedTopPath(x, y, barWidth, height)}
                  fill="rgb(var(--color-accent))"
                  opacity={activeIndex === index ? 1 : 0.78}
                  className="chart-bar-grow transition-opacity"
                  style={{
                    transformOrigin: `${x + barWidth / 2}px ${margin.top + plotHeight}px`,
                    animationDelay: `${index * 12}ms`,
                  }}
                />
              );
            })}
            {buckets.map((bucket, index) =>
              index % labelEvery === 0 || index === buckets.length - 1 ? (
                <text
                  key={index}
                  x={margin.left + index * bandWidth + bandWidth / 2}
                  y={height - 9}
                  textAnchor="middle"
                  fill="rgb(var(--color-text-faint))"
                  fontSize="10"
                  fontWeight="600"
                >
                  {bucket.label}
                </text>
              ) : null,
            )}
          </svg>
          {bandWidth >= 20 ? (
            <div
              className="pointer-events-none absolute inset-0"
              aria-hidden="true"
            >
              {buckets.map((bucket, index) => {
                const coverUrl = resolveGameCover(bucket.topGameKey);
                if (!coverUrl || bucket.seconds <= 0) return null;
                const barHeight = Math.max(
                  1,
                  (bucket.seconds / scale.maxSeconds) * plotHeight,
                );
                const barWidth = Math.min(24, Math.max(2, bandWidth * 0.62));
                const centerX = margin.left + index * bandWidth + bandWidth / 2;
                const roomy = bandWidth >= 68;
                const coverWidth = roomy
                  ? 46
                  : Math.max(12, Math.min(18, bandWidth - 8));
                const coverHeight = roomy ? 62 : Math.round(coverWidth * 1.4);
                const placeRight = index < buckets.length - 1;
                const requestedLeft = roomy
                  ? placeRight
                    ? centerX + barWidth / 2 + 9
                    : centerX - barWidth / 2 - coverWidth - 9
                  : centerX - coverWidth / 2;
                const left = Math.max(
                  margin.left,
                  Math.min(width - margin.right - coverWidth, requestedLeft),
                );
                const top = Math.max(
                  margin.top + 2,
                  Math.min(
                    margin.top + plotHeight - coverHeight,
                    margin.top +
                    plotHeight -
                    barHeight -
                    (roomy ? 12 : coverHeight + 4),
                  ),
                );
                return (
                  <span
                    key={index}
                    className={clsx(
                      "chart-game-cover absolute",
                      !roomy && "chart-game-cover-small",
                      expandedCoverIndex === index && "z-20",
                    )}
                    style={{
                      left,
                      top,
                      width: coverWidth,
                      height: coverHeight,
                      animationDelay: `${index * 90}ms`,
                    }}
                  >
                    <span
                      className={clsx(
                        "chart-game-cover-zoom relative block h-full w-full origin-bottom transition-transform duration-200 ease-out motion-reduce:transition-none",
                        expandedCoverIndex === index
                          ? "scale-[1.7]"
                          : "scale-100",
                      )}
                    >
                      <img
                        src={coverUrl}
                        alt=""
                        className="h-full w-full rounded-[3px] object-cover"
                      />
                    </span>
                  </span>
                );
              })}
            </div>
          ) : null}
          <div
            className="absolute"
            style={{
              left: margin.left,
              right: margin.right,
              top: margin.top,
              height: plotHeight,
            }}
          >
            {buckets.map((bucket, index) => (
              <button
                key={index}
                ref={(element) => {
                  targetRefs.current[index] = element;
                }}
                type="button"
                tabIndex={index === activeIndex ? 0 : -1}
                aria-label={`${bucket.tooltip}: ${formatDuration(bucket.seconds, showDurationDays)}, ${bucket.sessionCount} total session${bucket.sessionCount === 1 ? "" : "s"}${bucket.topGameKey ? `, most played: ${resolveGameName(bucket.topGameKey) ?? "Unknown game"}` : ""}`}
                className="absolute inset-y-0 rounded-sm border-0 bg-transparent p-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
                style={{ left: index * bandWidth, width: bandWidth }}
                onPointerEnter={(event) => {
                  setActiveIndex(index);
                  setExpandedCoverIndex(index);
                  tooltip.show(event.currentTarget, tooltipContent(bucket));
                }}
                onPointerLeave={() => {
                  setExpandedCoverIndex(null);
                  tooltip.hide();
                }}
                onFocus={(event) => {
                  setActiveIndex(index);
                  setExpandedCoverIndex(index);
                  tooltip.show(event.currentTarget, tooltipContent(bucket));
                }}
                onBlur={() => {
                  setExpandedCoverIndex(null);
                  tooltip.hide();
                }}
                onKeyDown={(event) => {
                  if (event.key === "ArrowRight") {
                    event.preventDefault();
                    focusIndex(index + 1);
                  } else if (event.key === "ArrowLeft") {
                    event.preventDefault();
                    focusIndex(index - 1);
                  } else if (event.key === "Home") {
                    event.preventDefault();
                    focusIndex(0);
                  } else if (event.key === "End") {
                    event.preventDefault();
                    focusIndex(buckets.length - 1);
                  }
                }}
              />
            ))}
          </div>
        </>
      ) : (
        <div style={{ height }} />
      )}
      <ChartTooltip state={tooltip.state} onClose={tooltip.hide} />
    </div>
  );
}
