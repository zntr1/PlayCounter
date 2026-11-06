import type { Session } from "@playcounter/shared";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { dayBuckets, type HistoryRange } from "../../../historyStats";
import type { GameIdentityResolver } from "../../../store";
import { CoverCalendar } from "../../charts/CoverCalendar";
import { appLocale, getT } from "../../../i18n";

const t = getT("history");

const dayMs = 86_400_000;
/** Up to six weeks show whole; longer ranges a month at a time. */
const wholeDays = 42;

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

/** How many week rows the calendar shows for a range: its own weeks up to
 *  six weeks, a month's (four to six) beyond. */
export function coverCalendarRows(range: HistoryRange) {
  const days = Math.round((range.toMs - range.fromMs) / dayMs);
  if (days > wholeDays) return 6;
  return Math.round(
    (mondayOf(range.toMs - 1) + 7 * dayMs - mondayOf(range.fromMs)) /
      (7 * dayMs),
  );
}

/* The cover calendar for any range: up to six weeks whole, longer ranges one
   month at a time, from the range's last month, with ‹ › between its first
   and last month. Remount it (key) when the range changes. */
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
  const paged = Math.round((range.toMs - range.fromMs) / dayMs) > wholeDays;
  const firstMonth = startOfMonth(range.fromMs);
  const lastMonth = startOfMonth(range.toMs - 1);
  const [month, setMonth] = useState(lastMonth);
  const layout = paged ? { fromMs: month, toMs: addMonths(month, 1) } : range;
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
    <div className="min-w-0" style={{ maxWidth: 7 * 104 + 6 * 6 }}>
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
  );
}
