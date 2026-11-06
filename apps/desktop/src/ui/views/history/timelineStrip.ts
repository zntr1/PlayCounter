import type { DailyTotal, HistoryRange } from "../../../historyStats";

/* The timeline strip's arithmetic: bars of the whole history and what a drag
   on them picks. Whole local days, never before the strip's first day (minMs)
   or past today (maxMs = tomorrow's midnight). */

export type StripDragMode = "new" | "move" | "start" | "end";
export type StripUnit = "day" | "week" | "month";

/** Day bars cover at least this many days, so a young history sits at the
 *  right end instead of filling the strip with a few huge bars. */
const minimumDays = 30;

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

function startOfMonth(ms: number) {
  const date = new Date(ms);
  return new Date(date.getFullYear(), date.getMonth(), 1).getTime();
}

function startOfUnit(ms: number, unit: StripUnit) {
  return unit === "day"
    ? startOfDay(ms)
    : unit === "week"
      ? startOfWeek(ms)
      : startOfMonth(ms);
}

function nextUnit(ms: number, unit: StripUnit) {
  if (unit === "day") return addDays(ms, 1);
  if (unit === "week") return addDays(startOfWeek(ms), 7);
  const date = new Date(ms);
  return new Date(date.getFullYear(), date.getMonth() + 1, 1).getTime();
}

/** What the strip spans and in which bars, by the history's length: days up
 *  to three months (the last 30 days at least), weeks up to two years,
 *  months beyond. It always ends today. */
export function stripSpan(
  firstMs: number,
  nowMs: number,
): HistoryRange & { unit: StripUnit } {
  const toMs = addDays(startOfDay(nowMs), 1);
  const first = startOfDay(firstMs);
  const length = daysBetween(first, toMs);
  if (length <= 92)
    return {
      unit: "day",
      fromMs: Math.min(first, addDays(toMs, -minimumDays)),
      toMs,
    };
  const unit: StripUnit = length <= 730 ? "week" : "month";
  return { unit, fromMs: startOfUnit(first, unit), toMs };
}

/** Each bar's playtime over the strip's span. */
export function stripBars(
  daily: ReadonlyMap<string, DailyTotal>,
  span: HistoryRange & { unit: StripUnit },
) {
  const bars: Array<HistoryRange & { seconds: number }> = [];
  for (let fromMs = span.fromMs; fromMs < span.toMs; ) {
    const toMs = Math.min(nextUnit(fromMs, span.unit), span.toMs);
    let seconds = 0;
    for (let day = fromMs; day < toMs; day = addDays(day, 1))
      seconds += daily.get(dateKey(day))?.seconds ?? 0;
    bars.push({ fromMs, toMs, seconds });
    fromMs = toMs;
  }
  return bars;
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

/** A click on a bar opens its day, week or month. */
export function stripBarAt(
  ms: number,
  unit: StripUnit,
  minMs: number,
  maxMs: number,
) {
  const fromMs = startOfUnit(ms, unit);
  return {
    fromMs: Math.max(fromMs, minMs),
    toMs: Math.min(nextUnit(fromMs, unit), maxMs),
  };
}
