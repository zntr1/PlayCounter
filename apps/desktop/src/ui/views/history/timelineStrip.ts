import type { DailyTotal, HistoryRange } from "../../../historyStats";

/* The timeline strip's arithmetic: weekly bars of the whole history and what
   a drag on them picks. Whole local days, never before the first session's
   day (minMs) or past today (maxMs = tomorrow's midnight). */

export type StripDragMode = "new" | "move" | "start" | "end";

const dayMs = 86_400_000;

function startOfDay(ms: number) {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function addDays(ms: number, days: number) {
  const date = new Date(ms);
  date.setDate(date.getDate() + days);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function daysBetween(fromMs: number, toMs: number) {
  return Math.round((startOfDay(toMs) - startOfDay(fromMs)) / dayMs);
}

function startOfWeek(ms: number) {
  const day = startOfDay(ms);
  return addDays(day, -((new Date(day).getDay() + 6) % 7));
}

function dateKey(ms: number) {
  const date = new Date(ms);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Monday-to-Sunday playtime from the first session's week until toMs. */
export function stripWeeks(
  daily: ReadonlyMap<string, DailyTotal>,
  firstMs: number,
  toMs: number,
) {
  const weeks: Array<HistoryRange & { seconds: number }> = [];
  for (let fromMs = startOfWeek(firstMs); fromMs < toMs; ) {
    const weekEnd = Math.min(addDays(fromMs, 7), toMs);
    let seconds = 0;
    for (let day = fromMs; day < weekEnd; day = addDays(day, 1))
      seconds += daily.get(dateKey(day))?.seconds ?? 0;
    weeks.push({ fromMs, toMs: weekEnd, seconds });
    fromMs = addDays(fromMs, 7);
  }
  return weeks;
}

/** A drag on an edge resizes, inside the window moves it, anywhere else picks
 *  new days. A window over almost all of the strip (All time) leaves no room
 *  outside it, so a drag inside it picks new days too. */
export function stripDragMode(
  target: { handle: "start" | "end" | null; insideWindow: boolean },
  windowShare: number,
): StripDragMode {
  if (target.handle) return target.handle;
  return target.insideWindow && windowShare < 0.9 ? "move" : "new";
}

export function stripDragRange(
  mode: StripDragMode,
  drag: {
    startMs: number;
    pointerMs: number;
    range: HistoryRange;
    minMs: number;
    maxMs: number;
  },
): HistoryRange {
  const { startMs, pointerMs, range, minMs, maxMs } = drag;
  const clamp = (ms: number) => Math.max(minMs, Math.min(maxMs - 1, ms));
  const pointer = clamp(pointerMs);
  if (mode === "new") {
    const start = clamp(startMs);
    return {
      fromMs: startOfDay(Math.min(start, pointer)),
      toMs: addDays(startOfDay(Math.max(start, pointer)), 1),
    };
  }
  if (mode === "start")
    return {
      fromMs: Math.min(startOfDay(pointer), addDays(range.toMs, -1)),
      toMs: range.toMs,
    };
  if (mode === "end")
    return {
      fromMs: range.fromMs,
      toMs: Math.max(addDays(startOfDay(pointer), 1), addDays(range.fromMs, 1)),
    };
  const length = daysBetween(range.fromMs, range.toMs);
  const shift = Math.max(
    daysBetween(range.fromMs, minMs),
    Math.min(
      daysBetween(range.toMs, maxMs),
      Math.round((pointerMs - startMs) / dayMs),
    ),
  );
  const fromMs = addDays(range.fromMs, shift);
  return { fromMs, toMs: addDays(fromMs, length) };
}

/** A click on a bar opens that week. */
export function stripWeekAt(ms: number, minMs: number, maxMs: number) {
  const fromMs = startOfWeek(ms);
  return {
    fromMs: Math.max(fromMs, minMs),
    toMs: Math.min(addDays(fromMs, 7), maxMs),
  };
}
