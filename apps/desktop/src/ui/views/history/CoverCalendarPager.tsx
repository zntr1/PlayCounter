import type { Session } from "@playcounter/shared";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState, type CSSProperties } from "react";
import { dayBuckets, type HistoryRange } from "../../../historyStats";
import type { GameIdentityResolver } from "../../../store";
import { CoverCalendar } from "../../charts/CoverCalendar";
import { appLocale, getT } from "../../../i18n";

const t = getT("history");

const dayMs = 86_400_000;
/** The month name with its arrows: 32px buttons and 12px below. */
const headerHeight = 44;
/** The weekday names above the days. */
const weekdayHeight = 16;
const gap = 6;
/** Next to a short column (collapsed panels) the days stay this big. */
const smallestDay = 64;

function startOfMonth(ms: number) {
  const date = new Date(ms);
  return new Date(date.getFullYear(), date.getMonth(), 1).getTime();
}

function addMonths(ms: number, months: number) {
  const date = new Date(startOfMonth(ms));
  date.setMonth(date.getMonth() + months);
  return date.getTime();
}

function mondayOf(ms: number) {
  const day = new Date(ms);
  day.setHours(0, 0, 0, 0);
  day.setDate(day.getDate() - ((day.getDay() + 6) % 7));
  return day.getTime();
}

/** A month's own weeks, Monday to Sunday: four to six. */
function monthWeeks(month: number) {
  const last = addMonths(month, 1) - 1;
  return Math.round(
    (mondayOf(last) + 7 * dayMs - mondayOf(month)) / (7 * dayMs),
  );
}

/* The cover calendar for any range, one whole month at a time: a range inside
   one month shows that month; a longer one starts at its last month, with ‹ ›
   between its first and last month and six weeks on every page, so nothing
   moves while paging. The squares fill the space the styles give them
   (.cover-calendar-fit). Remount it (key) when the range changes. */
export function CoverCalendarPager({
  sessions,
  range,
  nowMs,
  resolveIgdbId,
  thresholds,
  colorSlots,
  showDurationDays,
  resolveGameName,
  resolveGameCover,
  onSelectDay,
  labelledBy,
}: {
  sessions: Session[];
  range: HistoryRange;
  nowMs: number;
  resolveIgdbId: GameIdentityResolver;
  thresholds: number[];
  colorSlots: ReadonlyMap<string, number>;
  showDurationDays: boolean;
  resolveGameName: (key: string | null) => string | null;
  resolveGameCover: (key: string | null) => string | null;
  onSelectDay: (dateKey: string) => void;
  labelledBy: string;
}) {
  const firstMonth = startOfMonth(range.fromMs);
  const lastMonth = startOfMonth(range.toMs - 1);
  const paged = firstMonth < lastMonth;
  const [month, setMonth] = useState(lastMonth);
  const layout = { fromMs: month, toMs: addMonths(month, 1) };
  const weeks = paged ? 6 : monthWeeks(month);
  // Everything but the squares: header, weekday names and the gaps.
  const chrome = (paged ? headerHeight : 0) + weekdayHeight + weeks * gap;
  const countedFrom = Math.max(layout.fromMs, range.fromMs);
  const countedTo = Math.min(layout.toMs, range.toMs);
  const days = useMemo(
    () =>
      dayBuckets(
        sessions,
        { fromMs: countedFrom, toMs: countedTo },
        nowMs,
        resolveIgdbId,
      ),
    [countedFrom, countedTo, nowMs, resolveIgdbId, sessions],
  );
  const arrow =
    "grid h-8 w-8 place-items-center rounded-lg text-text-muted transition-colors hover:bg-surface-hover hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:pointer-events-none disabled:opacity-25";

  return (
    <div
      className="cover-calendar-fit"
      style={
        {
          "--cover-fit-min": `${chrome + weeks * smallestDay}px`,
        } as CSSProperties
      }
    >
      <div
        className="cover-calendar-pager"
        style={
          {
            "--cover-weeks": weeks,
            "--cover-chrome": `${chrome}px`,
            "--cover-gaps": `${6 * gap}px`,
          } as CSSProperties
        }
      >
        {paged ? (
          <div className="mb-3 flex items-center justify-between gap-2">
            <button
              type="button"
              aria-label={t("Previous month")}
              disabled={month <= firstMonth}
              onClick={() => setMonth((shown) => addMonths(shown, -1))}
              className={arrow}
            >
              <ChevronLeft aria-hidden="true" size={16} />
            </button>
            <span data-cover-month className="text-sm font-bold text-text">
              {new Date(month).toLocaleDateString(appLocale(), {
                month: "long",
                year: "numeric",
              })}
            </span>
            <button
              type="button"
              aria-label={t("Next month")}
              disabled={month >= lastMonth}
              onClick={() => setMonth((shown) => addMonths(shown, 1))}
              className={arrow}
            >
              <ChevronRight aria-hidden="true" size={16} />
            </button>
          </div>
        ) : null}
        <CoverCalendar
          layout={layout}
          weeks={weeks}
          range={{ fromMs: countedFrom, toMs: countedTo }}
          days={days}
          nowMs={nowMs}
          thresholds={thresholds}
          colorSlots={colorSlots}
          showDurationDays={showDurationDays}
          resolveGameName={resolveGameName}
          resolveGameCover={resolveGameCover}
          onSelectDay={onSelectDay}
          labelledBy={labelledBy}
        />
      </div>
    </div>
  );
}
