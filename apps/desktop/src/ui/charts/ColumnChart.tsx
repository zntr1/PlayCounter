import clsx from "clsx";
import { useMemo, useRef, useState } from "react";
import type { HistoryBucket } from "../../historyStats";
import { formatDuration } from "../components";
import { ChartTooltip, useChartTooltip } from "./ChartTooltip";
import { useElementWidth } from "./chartUtils";
import { gameColor } from "./gameColors";
import { appLocale, getT } from "../../i18n";

const t = getT("common");

const defaultChartHeight = 230;
const margin = { top: 10, right: 12, bottom: 34, left: 58 };
/** Surface between two stacked parts of a bar. */
const segmentGap = 2;
const otherKey = "";

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
      label: `${((index * maxValue) / 4).toLocaleString(appLocale(), {
        maximumFractionDigits: 1,
        useGrouping: false,
      })}${suffix}`,
    })),
  };
}

function roundedTopPath(x: number, y: number, width: number, height: number) {
  const radius = Math.min(4, width / 2, height);
  const bottom = y + height;
  return `M ${x} ${bottom} L ${x} ${y + radius} Q ${x} ${y} ${x + radius} ${y} L ${x + width - radius} ${y} Q ${x + width} ${y} ${x + width} ${y + radius} L ${x + width} ${bottom} Z`;
}

/** A bar's parts from the bottom up: the colored games in the legend's
 *  order, then everything else as one grey part on top. */
function barParts(bucket: HistoryBucket, stackOrder: readonly string[]) {
  const parts = stackOrder
    .map((key) => ({
      key,
      seconds: bucket.games.find((game) => game.key === key)?.seconds ?? 0,
    }))
    .filter((part) => part.seconds > 0);
  const rest =
    bucket.seconds - parts.reduce((sum, part) => sum + part.seconds, 0);
  if (rest > 0) parts.push({ key: otherKey, seconds: rest });
  return parts;
}

/* Playtime per bucket, each bar stacked by game: the colored games of the
   legend at the bottom, the rest grey on top. */
export function ColumnChart({
  buckets,
  showDurationDays,
  resolveGameName,
  colorSlots,
  highlightKey,
  className,
  height = defaultChartHeight,
}: {
  buckets: HistoryBucket[];
  showDurationDays: boolean;
  resolveGameName: (key: string | null) => string | null;
  /** The legend's games, most played first, with their color slot. */
  colorSlots: ReadonlyMap<string, number>;
  /** A game lit from the legend: the other parts fade. */
  highlightKey?: string | null;
  className?: string;
  height?: number;
}) {
  const [containerRef, width] = useElementWidth<HTMLDivElement>();
  const [activeIndex, setActiveIndex] = useState(0);
  const targetRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const tooltip = useChartTooltip();
  const stackOrder = useMemo(() => [...colorSlots.keys()], [colorSlots]);
  const maxBucket = Math.max(0, ...buckets.map((bucket) => bucket.seconds));
  const scale = useMemo(() => axis(maxBucket), [maxBucket]);
  const plotWidth = Math.max(0, width - margin.left - margin.right);
  const plotHeight = height - margin.top - margin.bottom;
  const bandWidth = buckets.length > 0 ? plotWidth / buckets.length : 0;
  const barWidth = Math.min(24, Math.max(2, bandWidth * 0.62));
  const widestLabel = Math.min(
    120,
    Math.max(38, ...buckets.map((bucket) => bucket.label.length * 6.5)),
  );
  const labelEvery = Math.max(
    1,
    Math.ceil(widestLabel / Math.max(1, bandWidth)),
  );
  const yOf = (seconds: number) =>
    margin.top + plotHeight * (1 - seconds / scale.maxSeconds);
  const nameOf = (key: string) =>
    key === otherKey ? t("Other") : (resolveGameName(key) ?? t("Unknown game"));

  const tooltipContent = (bucket: HistoryBucket) => {
    const games = bucket.games.slice(0, 7);
    const hidden = bucket.games.length - games.length;
    return (
      <div className="grid gap-1">
        <div className="font-semibold">{bucket.tooltip}</div>
        <div className="font-mono font-bold">
          {formatDuration(bucket.seconds, showDurationDays)}
        </div>
        <div className="text-text-muted">
          {t("{{count}} total sessions", { count: bucket.sessionCount })}
        </div>
        {games.map((game) => (
          <div
            key={game.key}
            className="grid grid-cols-[10px_minmax(0,1fr)_auto] items-center gap-2"
          >
            <span
              aria-hidden="true"
              className="h-[3px] w-2.5 rounded-full"
              style={{ background: gameColor(colorSlots.get(game.key)) }}
            />
            <span className="truncate text-text-muted">{nameOf(game.key)}</span>
            <span className="font-mono font-semibold">
              {formatDuration(game.seconds, showDurationDays)}
            </span>
          </div>
        ))}
        {hidden > 0 ? (
          <div className="text-text-muted">
            {t("{{count}} more games", { count: hidden })}
          </div>
        ) : null}
      </div>
    );
  };

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
              const y = yOf(tick.seconds);
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
              const x =
                margin.left + index * bandWidth + (bandWidth - barWidth) / 2;
              const parts = barParts(bucket, stackOrder);
              let below = 0;
              return (
                <g
                  key={index}
                  className="chart-bar-grow"
                  style={{
                    transformOrigin: `${x + barWidth / 2}px ${margin.top + plotHeight}px`,
                    animationDelay: `${index * 12}ms`,
                  }}
                  opacity={activeIndex === index ? 1 : 0.9}
                >
                  {parts.map((part, partIndex) => {
                    const bottom =
                      yOf(below) - (partIndex > 0 ? segmentGap : 0);
                    const top = yOf(below + part.seconds);
                    below += part.seconds;
                    const partHeight = bottom - top;
                    if (partHeight < 1) return null;
                    const last = partIndex === parts.length - 1;
                    return (
                      <path
                        key={part.key || "other"}
                        d={
                          last
                            ? roundedTopPath(x, top, barWidth, partHeight)
                            : `M ${x} ${top} h ${barWidth} v ${partHeight} h ${-barWidth} Z`
                        }
                        fill={gameColor(
                          part.key === otherKey
                            ? undefined
                            : colorSlots.get(part.key),
                        )}
                        opacity={
                          highlightKey === undefined ||
                          highlightKey === null ||
                          highlightKey === part.key
                            ? 1
                            : 0.2
                        }
                        className="transition-opacity"
                      />
                    );
                  })}
                </g>
              );
            })}
            {buckets.map((bucket, index) => {
              const last = index === buckets.length - 1;
              const shown =
                last ||
                (index % labelEvery === 0 &&
                  buckets.length - 1 - index >= labelEvery);
              return shown ? (
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
              ) : null;
            })}
          </svg>
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
                aria-label={
                  bucket.topGameKey
                    ? t(
                        "{{label}}: {{duration}}, {{count}} total sessions, most played: {{game}}",
                        {
                          label: bucket.tooltip,
                          duration: formatDuration(
                            bucket.seconds,
                            showDurationDays,
                          ),
                          count: bucket.sessionCount,
                          game:
                            resolveGameName(bucket.topGameKey) ??
                            t("Unknown game"),
                        },
                      )
                    : t("{{label}}: {{duration}}, {{count}} total sessions", {
                        label: bucket.tooltip,
                        duration: formatDuration(
                          bucket.seconds,
                          showDurationDays,
                        ),
                        count: bucket.sessionCount,
                      })
                }
                className="absolute inset-y-0 rounded-sm border-0 bg-transparent p-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
                style={{ left: index * bandWidth, width: bandWidth }}
                onPointerEnter={(event) => {
                  setActiveIndex(index);
                  tooltip.show(event.currentTarget, tooltipContent(bucket));
                }}
                onPointerLeave={() => tooltip.hide()}
                onFocus={(event) => {
                  setActiveIndex(index);
                  tooltip.show(event.currentTarget, tooltipContent(bucket));
                }}
                onBlur={() => tooltip.hide()}
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
