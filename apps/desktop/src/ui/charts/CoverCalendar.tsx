import clsx from "clsx";
import type { HistoryBucket, HistoryRange } from "../../historyStats";
import { quantileLevel } from "../../historyStats";
import { formatDuration } from "../components";
import { ChartTooltip, useChartTooltip } from "./ChartTooltip";
import {
  addDays,
  formatAccessibleDate,
  heatmapColor,
  localDateKey,
} from "./chartUtils";
import { gameColor } from "./gameColors";
import { appLocale, getT, weekdayNames } from "../../i18n";

const t = getT("common");

/** The activity calendar's four steps, as cover brightness. */
const brightness = [0.4, 0.58, 0.78, 1];

function mondayOf(ms: number) {
  const day = new Date(ms);
  day.setHours(0, 0, 0, 0);
  return addDays(day, -((day.getDay() + 6) % 7));
}

/* A range of up to six weeks as a calendar of covers: each day with play
   shows the game played most that day, brighter for more playtime, with its
   playtime and how many more games there were. A click opens that day. */
export function CoverCalendar({
  range,
  days,
  nowMs,
  thresholds,
  colorSlots,
  showDurationDays,
  resolveGameName,
  resolveGameCover,
  onSelectDay,
  labelledBy,
}: {
  range: HistoryRange;
  /** The range's day buckets, each game's seconds most first. */
  days: HistoryBucket[];
  nowMs: number;
  /** Quantile steps of daily playtime over the whole history. */
  thresholds: number[];
  colorSlots: ReadonlyMap<string, number>;
  showDurationDays: boolean;
  resolveGameName: (key: string | null) => string | null;
  resolveGameCover: (key: string | null) => string | null;
  onSelectDay: (dateKey: string) => void;
  labelledBy: string;
}) {
  const tooltip = useChartTooltip();
  const byKey = new Map(
    days.map((day) => [localDateKey(new Date(day.fromMs)), day]),
  );
  const todayKey = localDateKey(new Date(nowMs));
  const first = mondayOf(range.fromMs);
  const end = addDays(mondayOf(range.toMs - 1), 7);
  const cells: Date[] = [];
  for (let date = first; date < end; date = addDays(date, 1)) cells.push(date);
  const plus = new Intl.NumberFormat(appLocale(), { signDisplay: "always" });
  const nameOf = (key: string) => resolveGameName(key) ?? t("Unknown game");

  const tooltipContent = (date: Date, day: HistoryBucket) => (
    <div className="grid gap-1">
      <div className="font-semibold">
        {date.toLocaleDateString(appLocale(), {
          weekday: "long",
          month: "short",
          day: "numeric",
        })}
      </div>
      <div className="font-mono font-bold">
        {formatDuration(day.seconds, showDurationDays)}
      </div>
      {day.games.map((game) => (
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
      <div className="text-text-faint">{t("Click to see this day")}</div>
    </div>
  );

  return (
    <div
      role="group"
      aria-labelledby={labelledBy}
      className="grid gap-1.5"
      style={{ gridTemplateColumns: "repeat(7, minmax(0, 104px))" }}
    >
      {weekdayNames("short").map((weekday) => (
        <span
          key={weekday}
          aria-hidden="true"
          className="pb-0.5 text-center text-[10px] font-bold uppercase tracking-[0.1em] text-text-faint"
        >
          {weekday}
        </span>
      ))}
      {cells.map((date) => {
        const key = localDateKey(date);
        const number = date.getDate();
        const dayMs = date.getTime();
        const isToday = key === todayKey;
        if (dayMs < range.fromMs || dayMs >= range.toMs || dayMs > nowMs) {
          return (
            <div
              key={key}
              data-cover-day={key}
              data-out
              aria-hidden="true"
              className="relative aspect-square rounded-lg border border-dashed border-border/60"
            >
              <span className="absolute left-[7px] top-[5px] font-mono text-xs font-bold text-text-faint/45">
                {number}
              </span>
            </div>
          );
        }
        const day = byKey.get(key);
        if (!day || day.seconds <= 0) {
          return (
            <div
              key={key}
              data-cover-day={key}
              className={clsx(
                "relative aspect-square rounded-lg bg-surface-hover/55",
                isToday && "ring-2 ring-accent",
              )}
            >
              <span className="absolute left-[7px] top-[5px] font-mono text-xs font-bold text-text-faint">
                {number}
              </span>
            </div>
          );
        }
        const top = day.games[0]?.key ?? day.topGameKey;
        const cover = resolveGameCover(top);
        const level = quantileLevel(day.seconds, thresholds);
        const step =
          thresholds.length <= 1
            ? brightness.length - 1
            : Math.round(
                ((Math.max(1, level) - 1) * (brightness.length - 1)) /
                  (thresholds.length - 1),
              );
        return (
          <button
            key={key}
            type="button"
            data-cover-day={key}
            aria-label={t(
              "{{label}}: {{duration}}, {{count}} total sessions, most played: {{game}}",
              {
                label: formatAccessibleDate(date),
                duration: formatDuration(day.seconds, showDurationDays),
                count: day.sessionCount,
                game: top ? nameOf(top) : t("Unknown game"),
              },
            )}
            onClick={() => onSelectDay(key)}
            onPointerEnter={(event) =>
              tooltip.show(event.currentTarget, tooltipContent(date, day))
            }
            onPointerLeave={() => tooltip.hide()}
            onFocus={(event) =>
              tooltip.show(event.currentTarget, tooltipContent(date, day))
            }
            onBlur={() => tooltip.hide()}
            className={clsx(
              "group relative aspect-square overflow-hidden rounded-lg text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
              isToday && "ring-2 ring-accent",
            )}
            style={
              cover
                ? undefined
                : {
                    background:
                      heatmapColor(Math.max(1, level), thresholds.length) ??
                      undefined,
                  }
            }
          >
            {cover ? (
              <img
                src={cover}
                alt=""
                aria-hidden="true"
                loading="lazy"
                draggable={false}
                className="absolute inset-0 h-full w-full object-cover object-[50%_22%] transition-transform duration-300 group-hover:scale-[1.06] motion-reduce:transition-none"
                style={{ opacity: brightness[step] }}
              />
            ) : null}
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgb(0_0_0/0.5)_0%,transparent_32%,transparent_52%,rgb(0_0_0/0.8)_100%)]"
            />
            <span className="absolute left-[7px] top-[5px] font-mono text-xs font-bold text-white">
              {number}
            </span>
            <span className="absolute bottom-[5px] left-[7px] font-mono text-[11.5px] font-bold text-white">
              {formatDuration(day.seconds, showDurationDays)}
            </span>
            {day.games.length > 1 ? (
              <span className="absolute bottom-1.5 right-1.5 rounded-full bg-black/60 px-[5px] font-mono text-[10px] font-semibold leading-4 text-white">
                {plus.format(day.games.length - 1)}
              </span>
            ) : null}
          </button>
        );
      })}
      <ChartTooltip state={tooltip.state} onClose={tooltip.hide} />
    </div>
  );
}
