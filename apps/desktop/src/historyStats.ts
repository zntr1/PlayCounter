import type { Session } from "@playcounter/shared";
import type { GameLifetimeTotal } from "./milestones";
import { effectiveTotalSeconds } from "./playtimeAdjustments";
import { resolvedCanonicalGameKey, type GameIdentityResolver } from "./store";
import { appLocale, getT } from "./i18n";

const t = getT("common");

/* What My History shows: everything, a period that the chip arrows step
   through (offset 0 = the current one, -1 = the one before), or a span picked
   in the calendar that steps by its own length. */
export type HistoryPeriod =
  | "day"
  | "week"
  | "month"
  | "year"
  | "last7"
  | "last30"
  | "last90";

export type HistorySelection =
  | { kind: "all" }
  | { kind: HistoryPeriod; offset: number }
  | {
      kind: "span";
      unit: "day" | "month";
      /** Local date key of the first day at offset 0. */
      fromKey: string;
      /** Days or months, by unit. */
      length: number;
      offset: number;
    };

export type HistoryBucketUnit = "hour" | "day" | "week" | "month";

export type HistoryRange = { fromMs: number; toMs: number };

export type HistoryBucket = {
  label: string;
  tooltip: string;
  fromMs: number;
  toMs: number;
  seconds: number;
  sessionCount: number;
  topGameKey: string | null;
  /** Each game's seconds in this bucket, the most played first. */
  games: Array<{ key: string; seconds: number }>;
};

export type DailyTotal = {
  seconds: number;
  sessionCount: number;
  topGameKey: string | null;
};

export type TopGame = {
  key: string | null;
  name: string;
  coverUrl: string;
  seconds: number;
  sessionCount: number;
  share: number;
  /** Start of the latest counted session, 0 for the "Other" bucket. */
  lastPlayedMs: number;
  otherGameNames?: string[];
};

export type SummaryStats = {
  totalSeconds: number;
  sessionCount: number;
  averageSeconds: number;
  longestSessionSeconds: number;
  activeDays: number;
  currentStreakDays: number;
  longestStreakDays: number;
  busiestDay: { dateKey: string; seconds: number } | null;
};

type ResolvedGame = { name: string; coverUrl: string };

const hourMs = 3_600_000;

export function getSessionGameKey(
  session: Session,
  resolveIgdbId?: GameIdentityResolver,
) {
  return resolvedCanonicalGameKey(session, resolveIgdbId);
}

function sessionInterval(session: Session): HistoryRange | null {
  const fromMs = Date.parse(session.startedAt);
  if (!Number.isFinite(fromMs)) return null;

  const durationSeconds = session.durationSeconds;
  const durationEnd =
    durationSeconds !== null && Number.isFinite(durationSeconds)
      ? fromMs + Math.max(0, durationSeconds) * 1000
      : Number.NaN;
  const parsedEnd = session.endedAt ? Date.parse(session.endedAt) : Number.NaN;
  const toMs = Number.isFinite(durationEnd) ? durationEnd : parsedEnd;

  return Number.isFinite(toMs) && toMs > fromMs ? { fromMs, toMs } : null;
}

function overlapMs(interval: HistoryRange, range: HistoryRange | null): number {
  if (!range) return interval.toMs - interval.fromMs;
  return Math.max(
    0,
    Math.min(interval.toMs, range.toMs) -
      Math.max(interval.fromMs, range.fromMs),
  );
}

export function splitAcrossBoundaries(
  session: Session,
  boundaries: number[],
): number[] {
  const result = Array.from(
    { length: Math.max(0, boundaries.length - 1) },
    () => 0,
  );
  visitBoundaryOverlaps(session, boundaries, (index, seconds) => {
    result[index] = seconds;
  });
  return result;
}

function firstBoundaryAfter(boundaries: number[], value: number) {
  let low = 0;
  let high = boundaries.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (boundaries[middle] <= value) low = middle + 1;
    else high = middle;
  }
  return low;
}

function visitBoundaryOverlaps(
  session: Session,
  boundaries: number[],
  visit: (index: number, seconds: number) => void,
) {
  const interval = sessionInterval(session);
  if (!interval || boundaries.length < 2) return;

  const clipStart = Math.max(interval.fromMs, boundaries[0]);
  const clipEnd = Math.min(interval.toMs, boundaries[boundaries.length - 1]);
  if (clipEnd <= clipStart) return;

  let index = Math.max(0, firstBoundaryAfter(boundaries, clipStart) - 1);
  let allocatedSeconds = 0;
  while (index < boundaries.length - 1 && boundaries[index] < clipEnd) {
    const cumulativeEnd = Math.min(clipEnd, boundaries[index + 1]);
    const cumulativeSeconds = Math.round((cumulativeEnd - clipStart) / 1000);
    const seconds = Math.max(0, cumulativeSeconds - allocatedSeconds);
    if (seconds > 0) visit(index, seconds);
    allocatedSeconds = cumulativeSeconds;
    index += 1;
  }
}

function startOfLocalDay(ms: number) {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date;
}

function startOfLocalMonth(ms: number) {
  const date = new Date(ms);
  date.setDate(1);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function addLocalDays(ms: number, days: number) {
  const date = new Date(ms);
  date.setDate(date.getDate() + days);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function localDateKey(ms: number) {
  const date = new Date(ms);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function elapsedHourBoundaries(fromMs: number, toMs: number) {
  const boundaries = [fromMs];
  for (let cursor = fromMs + hourMs; cursor < toMs; cursor += hourMs) {
    boundaries.push(cursor);
  }
  boundaries.push(toMs);
  return boundaries;
}

const rollingDays = { last7: 7, last30: 30, last90: 90 } as const;

function daysBetween(fromMs: number, toMs: number) {
  return Math.round(
    (startOfLocalDay(toMs).getTime() - startOfLocalDay(fromMs).getTime()) /
      86_400_000,
  );
}

function monthsBetween(fromMs: number, toMs: number) {
  const from = new Date(fromMs);
  const to = new Date(toMs);
  return (
    (to.getFullYear() - from.getFullYear()) * 12 +
    to.getMonth() -
    from.getMonth()
  );
}

/** Weeks start on Monday, like the activity calendar and the rhythm chart. */
function startOfLocalWeek(ms: number) {
  const day = startOfLocalDay(ms).getTime();
  return addLocalDays(day, -((new Date(day).getDay() + 6) % 7));
}

function addLocalMonths(ms: number, months: number) {
  const date = new Date(startOfLocalMonth(ms));
  date.setMonth(date.getMonth() + months);
  return date.getTime();
}

function startOfLocalYear(ms: number) {
  return new Date(new Date(ms).getFullYear(), 0, 1).getTime();
}

function addLocalYears(ms: number, years: number) {
  return new Date(new Date(ms).getFullYear() + years, 0, 1).getTime();
}

function tomorrowStart(nowMs: number) {
  return addLocalDays(startOfLocalDay(nowMs).getTime(), 1);
}

type SteppedSelection = Exclude<HistorySelection, { kind: "all" }>;

function stepped(selection: SteppedSelection, by: number): SteppedSelection {
  return { ...selection, offset: selection.offset + by };
}

/** The selection's whole period, before it is cut at the end of today. */
function naturalRange(
  selection: SteppedSelection,
  nowMs: number,
): HistoryRange {
  const todayMs = startOfLocalDay(nowMs).getTime();
  const offset = selection.offset;
  switch (selection.kind) {
    case "day": {
      const fromMs = addLocalDays(todayMs, offset);
      return { fromMs, toMs: addLocalDays(fromMs, 1) };
    }
    case "week": {
      const fromMs = addLocalDays(startOfLocalWeek(todayMs), 7 * offset);
      return { fromMs, toMs: addLocalDays(fromMs, 7) };
    }
    case "month": {
      const fromMs = addLocalMonths(todayMs, offset);
      return { fromMs, toMs: addLocalMonths(fromMs, 1) };
    }
    case "year": {
      const fromMs = addLocalYears(todayMs, offset);
      return { fromMs, toMs: addLocalYears(fromMs, 1) };
    }
    case "span": {
      const startMs = dateKeyToLocalMs(selection.fromKey);
      if (selection.unit === "month") {
        const fromMs = addLocalMonths(startMs, selection.length * offset);
        return { fromMs, toMs: addLocalMonths(fromMs, selection.length) };
      }
      const fromMs = addLocalDays(startMs, selection.length * offset);
      return { fromMs, toMs: addLocalDays(fromMs, selection.length) };
    }
    default: {
      const length = rollingDays[selection.kind];
      const toMs = addLocalDays(todayMs, 1 + length * offset);
      return { fromMs: addLocalDays(toMs, -length), toMs };
    }
  }
}

/** The days a selection covers, cut at the end of today; null = all time. */
export function resolveHistorySelection(
  selection: HistorySelection,
  nowMs: number,
): HistoryRange | null {
  if (selection.kind === "all") return null;
  const range = naturalRange(selection, nowMs);
  return {
    fromMs: range.fromMs,
    toMs: Math.min(range.toMs, tomorrowStart(nowMs)),
  };
}

/**
 * Days picked in the calendar or on the timeline strip ([fromMs, toMs),
 * local midnights). A pick that matches a period becomes that period, so the
 * arrows step it the natural way: a whole month by months, a week by weeks.
 */
export function historySelectionFromRange(
  fromMs: number,
  toMs: number,
  nowMs: number,
  firstSessionMs: number | null,
): HistorySelection {
  const todayMs = startOfLocalDay(nowMs).getTime();
  const tomorrowMs = addLocalDays(todayMs, 1);
  const from = startOfLocalDay(fromMs).getTime();
  const to = Math.min(toMs, tomorrowMs);
  const endsToday = to === tomorrowMs;
  if (
    endsToday &&
    firstSessionMs !== null &&
    from <= startOfLocalDay(firstSessionMs).getTime()
  )
    return { kind: "all" };
  const length = Math.max(1, daysBetween(from, to));
  if (length === 1) return { kind: "day", offset: daysBetween(todayMs, from) };
  if (from === startOfLocalMonth(from)) {
    if (
      to === addLocalMonths(from, 1) ||
      (endsToday && from === startOfLocalMonth(todayMs))
    )
      return { kind: "month", offset: monthsBetween(todayMs, from) };
    if (
      from === startOfLocalYear(from) &&
      (to === addLocalYears(from, 1) ||
        (endsToday && from === startOfLocalYear(todayMs)))
    )
      return {
        kind: "year",
        offset: new Date(from).getFullYear() - new Date(todayMs).getFullYear(),
      };
    if (to === startOfLocalMonth(to) || endsToday)
      return {
        kind: "span",
        unit: "month",
        fromKey: localDateKey(from),
        length: monthsBetween(from, addLocalDays(to, -1)) + 1,
        offset: 0,
      };
  }
  if (
    from === startOfLocalWeek(from) &&
    (to === addLocalDays(from, 7) ||
      (endsToday && from === startOfLocalWeek(todayMs)))
  )
    return {
      kind: "week",
      offset: Math.round(daysBetween(startOfLocalWeek(todayMs), from) / 7),
    };
  if (endsToday) {
    for (const kind of ["last7", "last30", "last90"] as const) {
      if (length === rollingDays[kind]) return { kind, offset: 0 };
    }
  }
  return {
    kind: "span",
    unit: "day",
    fromKey: localDateKey(from),
    length,
    offset: 0,
  };
}

/** Whole days by date key, the last one included: a streak or a day that a
 *  highlight or the activity calendar opens. */
export function historySelectionFromDays(
  fromKey: string,
  lastKey: string,
  nowMs: number,
  firstSessionMs: number | null,
) {
  return historySelectionFromRange(
    dateKeyToLocalMs(fromKey),
    addLocalDays(dateKeyToLocalMs(lastKey), 1),
    nowMs,
    firstSessionMs,
  );
}

/** › stops at the current period, ‹ once the period before ends before the
 *  first session. */
export function canStepHistorySelection(
  selection: HistorySelection,
  direction: 1 | -1,
  nowMs: number,
  firstSessionMs: number | null,
) {
  if (selection.kind === "all" || firstSessionMs === null) return false;
  if (direction > 0)
    return naturalRange(selection, nowMs).toMs < tomorrowStart(nowMs);
  return (
    naturalRange(stepped(selection, -1), nowMs).toMs >
    startOfLocalDay(firstSessionMs).getTime()
  );
}

export function stepHistorySelection(
  selection: HistorySelection,
  direction: 1 | -1,
): HistorySelection {
  return selection.kind === "all" ? selection : stepped(selection, direction);
}

/**
 * The period to compare with: as long as the range and right before it. A
 * month, week or year still in progress compares with the same days of the
 * one before (1–6 Nov with 1–6 Oct), never past that one's end.
 */
export function previousHistoryRange(
  selection: HistorySelection,
  nowMs: number,
): HistoryRange | null {
  if (selection.kind === "all") return null;
  const tomorrowMs = tomorrowStart(nowMs);
  const current = naturalRange(selection, nowMs);
  const previous = naturalRange(stepped(selection, -1), nowMs);
  if (current.toMs <= tomorrowMs) return previous;
  const length = daysBetween(current.fromMs, tomorrowMs);
  return {
    fromMs: previous.fromMs,
    toMs: Math.min(previous.toMs, addLocalDays(previous.fromMs, length)),
  };
}

/** Bar size by range length: 1 day = hours, up to 31 days = days, up to 92
 *  = weeks (Detailed: days), longer = months (Detailed: weeks). */
export function historyBucketUnits(days: number): {
  overview: HistoryBucketUnit;
  detailed: HistoryBucketUnit;
} {
  if (days <= 1) return { overview: "hour", detailed: "hour" };
  if (days <= 31) return { overview: "day", detailed: "day" };
  if (days <= 92) return { overview: "week", detailed: "day" };
  return { overview: "month", detailed: "week" };
}

/** Days from fromMs to the day before toMs: "Oct 3 – 19", "Wed, Nov 4",
 *  with the year when it is not this year's. */
export function formatHistoryDays(fromMs: number, toMs: number, nowMs: number) {
  const lastMs = addLocalDays(toMs, -1);
  const year = new Date(nowMs).getFullYear();
  const options: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    ...(new Date(fromMs).getFullYear() !== year ||
    new Date(lastMs).getFullYear() !== year
      ? { year: "numeric" }
      : {}),
  };
  if (startOfLocalDay(fromMs).getTime() === lastMs)
    return new Date(fromMs).toLocaleDateString(appLocale(), {
      weekday: "short",
      ...options,
    });
  return new Intl.DateTimeFormat(appLocale(), options).formatRange(
    new Date(fromMs),
    new Date(lastMs),
  );
}

function formatHour(ms: number) {
  return new Date(ms).toLocaleTimeString(appLocale(), { hour: "numeric" });
}

function topKey(gameSeconds: Map<string, number>) {
  let selected: string | null = null;
  let selectedSeconds = -1;
  for (const [key, seconds] of gameSeconds) {
    if (
      seconds > selectedSeconds ||
      (seconds === selectedSeconds && selected !== null && key < selected)
    ) {
      selected = key;
      selectedSeconds = seconds;
    }
  }
  return selected;
}

function aggregateBoundaries(
  sessions: Session[],
  boundaries: number[],
  descriptors?: Array<{ label: string; tooltip: string }>,
  resolveIgdbId?: GameIdentityResolver,
): HistoryBucket[] {
  const buckets: HistoryBucket[] = boundaries
    .slice(0, -1)
    .map((fromMs, index) => ({
      label: descriptors?.[index]?.label ?? "",
      tooltip: descriptors?.[index]?.tooltip ?? "",
      fromMs,
      toMs: boundaries[index + 1],
      seconds: 0,
      sessionCount: 0,
      topGameKey: null,
      games: [],
    }));
  const games = buckets.map(() => new Map<string, number>());

  for (const session of sessions) {
    const key = getSessionGameKey(session, resolveIgdbId);
    visitBoundaryOverlaps(session, boundaries, (index, seconds) => {
      buckets[index].seconds += seconds;
      buckets[index].sessionCount += 1;
      games[index].set(key, (games[index].get(key) ?? 0) + seconds);
    });
  }

  buckets.forEach((bucket, index) => {
    bucket.topGameKey = topKey(games[index]);
    bucket.games = [...games[index]]
      .map(([key, seconds]) => ({ key, seconds }))
      .sort(
        (left, right) =>
          right.seconds - left.seconds || (left.key < right.key ? -1 : 1),
      );
  });
  return buckets;
}

function unitBoundaries(range: HistoryRange, unit: HistoryBucketUnit) {
  if (unit === "hour") return elapsedHourBoundaries(range.fromMs, range.toMs);
  const next =
    unit === "day"
      ? (ms: number) => addLocalDays(ms, 1)
      : unit === "week"
        ? (ms: number) => addLocalDays(startOfLocalWeek(ms), 7)
        : (ms: number) => addLocalMonths(ms, 1);
  const boundaries = [range.fromMs];
  for (
    let cursor = next(range.fromMs);
    cursor < range.toMs;
    cursor = next(cursor)
  )
    boundaries.push(cursor);
  boundaries.push(range.toMs);
  return boundaries;
}

function unitDescriptors(
  boundaries: number[],
  unit: HistoryBucketUnit,
  rangeDays: number,
  nowMs: number,
) {
  const todayMs = startOfLocalDay(nowMs).getTime();
  const spansYears =
    new Date(boundaries[0]).getFullYear() !==
    new Date(boundaries[boundaries.length - 1] - 1).getFullYear();
  return boundaries.slice(0, -1).map((fromMs, index) => {
    const toMs = boundaries[index + 1];
    if (unit === "hour") {
      return {
        label: formatHour(fromMs),
        tooltip: new Intl.DateTimeFormat(appLocale(), {
          hour: "numeric",
        }).formatRange(new Date(fromMs), new Date(toMs)),
      };
    }
    if (unit === "day") {
      const label =
        rangeDays > 14
          ? new Date(fromMs).toLocaleDateString(appLocale(), {
              month: "short",
              day: "numeric",
            })
          : fromMs === todayMs
            ? t("Today")
            : new Date(fromMs).toLocaleDateString(appLocale(), {
                weekday: "short",
              });
      return {
        label,
        tooltip: new Date(fromMs).toLocaleDateString(appLocale(), {
          weekday: "short",
          month: "short",
          day: "numeric",
        }),
      };
    }
    if (unit === "week") {
      return {
        label: new Date(fromMs).toLocaleDateString(appLocale(), {
          month: "short",
          day: "numeric",
        }),
        tooltip: formatHistoryDays(fromMs, toMs, nowMs),
      };
    }
    const whole =
      fromMs === startOfLocalMonth(fromMs) &&
      toMs === addLocalMonths(fromMs, 1);
    const withYear =
      spansYears && (index === 0 || new Date(fromMs).getMonth() === 0);
    return {
      label: new Date(fromMs).toLocaleDateString(
        appLocale(),
        withYear ? { month: "short", year: "numeric" } : { month: "short" },
      ),
      tooltip: whole
        ? new Date(fromMs).toLocaleDateString(appLocale(), {
            month: "long",
            year: "numeric",
          })
        : formatHistoryDays(fromMs, toMs, nowMs),
    };
  });
}

function allTimeRange(sessions: Session[], nowMs: number): HistoryRange | null {
  let firstMs = Number.POSITIVE_INFINITY;
  for (const session of sessions) {
    const interval = sessionInterval(session);
    if (interval && interval.fromMs < firstMs) firstMs = interval.fromMs;
  }
  return Number.isFinite(firstMs)
    ? { fromMs: startOfLocalDay(firstMs).getTime(), toMs: tomorrowStart(nowMs) }
    : null;
}

/** The playtime chart's bars for a range (null = all time, from the first
 *  session). compact is the Overview, full the Detailed view; they are the
 *  same array when the range has no finer view. */
export function bucketSessions(
  sessions: Session[],
  range: HistoryRange | null,
  nowMs: number,
  resolveIgdbId?: GameIdentityResolver,
) {
  const shown = range ?? allTimeRange(sessions, nowMs);
  if (!shown || shown.toMs <= shown.fromMs)
    return { compact: [] as HistoryBucket[], full: [] as HistoryBucket[] };
  const days = Math.max(1, daysBetween(shown.fromMs, shown.toMs));
  const units = historyBucketUnits(days);
  const build = (unit: HistoryBucketUnit) => {
    const boundaries = unitBoundaries(shown, unit);
    return aggregateBoundaries(
      sessions,
      boundaries,
      unitDescriptors(boundaries, unit, days, nowMs),
      resolveIgdbId,
    );
  };
  const compact = build(units.overview);
  const full =
    units.detailed === units.overview ? compact : build(units.detailed);
  return { compact, full };
}

export type GameSeason = {
  key: string;
  seconds: number;
  /** The days it was played in the range, oldest first. */
  days: Array<{ fromMs: number; seconds: number }>;
};

/** Each game's playtime per day of a range (null = all time, from the first
 *  session), the most played game first: the lanes of Game seasons. */
export function gameSeasons(
  sessions: Session[],
  range: HistoryRange | null,
  nowMs: number,
  resolveIgdbId?: GameIdentityResolver,
): GameSeason[] {
  const shown = range ?? allTimeRange(sessions, nowMs);
  if (!shown || shown.toMs <= shown.fromMs) return [];
  const boundaries = unitBoundaries(shown, "day");
  const byGame = new Map<string, Map<number, number>>();
  for (const session of sessions) {
    const key = getSessionGameKey(session, resolveIgdbId);
    visitBoundaryOverlaps(session, boundaries, (index, seconds) => {
      let days = byGame.get(key);
      if (!days) byGame.set(key, (days = new Map()));
      days.set(index, (days.get(index) ?? 0) + seconds);
    });
  }
  return [...byGame]
    .map(([key, days]) => {
      const list = [...days]
        .sort((left, right) => left[0] - right[0])
        .map(([index, seconds]) => ({ fromMs: boundaries[index], seconds }));
      return {
        key,
        seconds: list.reduce((sum, day) => sum + day.seconds, 0),
        days: list,
      };
    })
    .sort(
      (left, right) =>
        right.seconds - left.seconds || (left.key < right.key ? -1 : 1),
    );
}

/** One bucket per day of a range, each game's seconds most first: the cover
 *  calendar's days, also for a single day (bucketSessions gives hours). */
export function dayBuckets(
  sessions: Session[],
  range: HistoryRange,
  nowMs: number,
  resolveIgdbId?: GameIdentityResolver,
) {
  if (range.toMs <= range.fromMs) return [];
  const boundaries = unitBoundaries(range, "day");
  return aggregateBoundaries(
    sessions,
    boundaries,
    unitDescriptors(
      boundaries,
      "day",
      Math.max(1, daysBetween(range.fromMs, range.toMs)),
      nowMs,
    ),
    resolveIgdbId,
  );
}

/** Seconds played inside a range (null = all time). */
export function rangeSeconds(sessions: Session[], range: HistoryRange | null) {
  let total = 0;
  for (const session of sessions) {
    const interval = sessionInterval(session);
    if (interval) total += Math.round(overlapMs(interval, range) / 1000);
  }
  return total;
}

/** Running total after each bucket, for the Pace line; buckets that start
 *  at or after untilMs (still ahead today) get none. */
export function cumulativeSeconds(
  buckets: HistoryBucket[],
  untilMs = Number.POSITIVE_INFINITY,
) {
  let total = 0;
  return buckets
    .filter((bucket) => bucket.fromMs < untilMs)
    .map((bucket) => (total += bucket.seconds));
}

export function dailyTotals(sessions: Session[], fromMs: number, toMs: number) {
  const boundaries: number[] = [];
  for (
    let cursor = startOfLocalDay(fromMs).getTime();
    cursor < toMs;
    cursor = addLocalDays(cursor, 1)
  ) {
    boundaries.push(cursor);
  }
  boundaries.push(toMs);
  const buckets = aggregateBoundaries(sessions, boundaries);
  return new Map<string, DailyTotal>(
    buckets.map((bucket, index) => [
      localDateKey(boundaries[index]),
      {
        seconds: bucket.seconds,
        sessionCount: bucket.sessionCount,
        topGameKey: bucket.topGameKey,
      },
    ]),
  );
}

export function weekdayHourMatrix(
  sessions: Session[],
  nowMs: number,
  range: HistoryRange | null = null,
) {
  const matrix = Array.from({ length: 7 }, () =>
    Array.from({ length: 24 }, () => 0),
  );

  for (const session of sessions) {
    const interval = sessionInterval(session);
    if (!interval) continue;
    const clippedStart = Math.max(interval.fromMs, range?.fromMs ?? -Infinity);
    const clippedEnd = Math.min(interval.toMs, nowMs, range?.toMs ?? Infinity);
    if (clippedEnd <= clippedStart) continue;
    const firstHour = new Date(clippedStart);
    firstHour.setMinutes(0, 0, 0);
    for (
      let cursor = firstHour.getTime();
      cursor < clippedEnd;
      cursor += hourMs
    ) {
      const seconds = Math.round(
        Math.max(
          0,
          Math.min(clippedEnd, cursor + hourMs) -
            Math.max(clippedStart, cursor),
        ) / 1000,
      );
      if (seconds <= 0) continue;
      const date = new Date(cursor);
      const mondayIndex = (date.getDay() + 6) % 7;
      matrix[mondayIndex][date.getHours()] += seconds;
    }
  }
  return matrix;
}

export function topGames(
  sessions: Session[],
  resolveGame: (session: Session) => ResolvedGame,
  limit = 8,
  range: HistoryRange | null = null,
  resolveIgdbId?: GameIdentityResolver,
): TopGame[] {
  const games = new Map<
    string,
    ResolvedGame & {
      key: string;
      seconds: number;
      sessionCount: number;
      lastPlayedMs: number;
    }
  >();
  for (const session of sessions) {
    const interval = sessionInterval(session);
    if (!interval) continue;
    const seconds = Math.round(overlapMs(interval, range) / 1000);
    if (seconds <= 0) continue;
    const key = getSessionGameKey(session, resolveIgdbId);
    const existing = games.get(key);
    if (existing) {
      existing.seconds += seconds;
      existing.sessionCount += 1;
      existing.lastPlayedMs = Math.max(existing.lastPlayedMs, interval.fromMs);
    } else {
      games.set(key, {
        key,
        ...resolveGame(session),
        seconds,
        sessionCount: 1,
        lastPlayedMs: interval.fromMs,
      });
    }
  }

  const sorted = [...games.values()].sort(
    (left, right) =>
      right.seconds - left.seconds || left.name.localeCompare(right.name),
  );
  const total = sorted.reduce((sum, game) => sum + game.seconds, 0);
  const visible = sorted.slice(0, Math.max(0, limit));
  const result: TopGame[] = visible.map((game) => ({
    ...game,
    share: total > 0 ? game.seconds / total : 0,
  }));
  const hidden = sorted.slice(visible.length);
  if (hidden.length > 0) {
    const seconds = hidden.reduce((sum, game) => sum + game.seconds, 0);
    result.push({
      key: null,
      name: t("Other"),
      coverUrl: "",
      seconds,
      sessionCount: hidden.reduce((sum, game) => sum + game.sessionCount, 0),
      share: total > 0 ? seconds / total : 0,
      lastPlayedMs: 0,
      otherGameNames: hidden.map((game) => game.name),
    });
  }
  return result;
}

/**
 * The "All time" leaderboard ranks lifetime totals, the number My Games shows,
 * so launcher time, archived time and manual edits count too. Games without a
 * single session join with a session count of 0.
 */
export function withLifetimeTotals(
  games: TopGame[],
  totals: ReadonlyMap<string, GameLifetimeTotal>,
  describe: (key: string) => {
    name: string;
    coverUrl: string;
    lastPlayedMs: number;
  },
): TopGame[] {
  const ranked = new Map<string, Omit<TopGame, "share">>();
  for (const game of games) if (game.key) ranked.set(game.key, game);
  for (const [key, total] of totals) {
    const seconds = effectiveTotalSeconds(
      total.recordedSeconds,
      total.adjustmentSeconds,
      total.providerFloorSeconds,
      total.trackedSinceReadSeconds,
    );
    const played = ranked.get(key);
    if (played) {
      ranked.set(key, { ...played, seconds });
      continue;
    }
    if (seconds <= 0) continue;
    const fallback = describe(key);
    ranked.set(key, {
      key,
      name: total.name || fallback.name,
      coverUrl: total.coverUrl || fallback.coverUrl,
      seconds,
      sessionCount: 0,
      lastPlayedMs: fallback.lastPlayedMs,
    });
  }

  const sorted = [...ranked.values()]
    .filter((game) => game.seconds > 0)
    .sort(
      (left, right) =>
        right.seconds - left.seconds || left.name.localeCompare(right.name),
    );
  const total = sorted.reduce((sum, game) => sum + game.seconds, 0);
  return sorted.map((game) => ({
    ...game,
    share: total > 0 ? game.seconds / total : 0,
  }));
}

function dateKeyToLocalMs(key: string) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day).getTime();
}

export function summaryStats(
  sessions: Session[],
  nowMs: number,
  range: HistoryRange | null = null,
): SummaryStats {
  const overlaps = sessions
    .map((session) => {
      const interval = sessionInterval(session);
      return interval ? Math.round(overlapMs(interval, range) / 1000) : 0;
    })
    .filter((seconds) => seconds > 0);
  const totalSeconds = overlaps.reduce((sum, seconds) => sum + seconds, 0);

  let daily = new Map<string, DailyTotal>();
  if (overlaps.length > 0) {
    const intervals = sessions
      .map(sessionInterval)
      .filter((value): value is HistoryRange => value !== null);
    const fromMs = range?.fromMs ?? Math.min(...intervals.map((v) => v.fromMs));
    const toMs =
      range?.toMs ?? addLocalDays(startOfLocalDay(nowMs).getTime(), 1);
    daily = dailyTotals(sessions, fromMs, toMs);
  }
  const activeKeys = [...daily]
    .filter(([, total]) => total.seconds > 0)
    .map(([key]) => key)
    .sort();
  const activeSet = new Set(activeKeys);

  let longestStreakDays = 0;
  let run = 0;
  let previousMs: number | null = null;
  for (const key of activeKeys) {
    const currentMs = dateKeyToLocalMs(key);
    run =
      previousMs !== null && addLocalDays(previousMs, 1) === currentMs
        ? run + 1
        : 1;
    longestStreakDays = Math.max(longestStreakDays, run);
    previousMs = currentMs;
  }

  // A streak remains current until yesterday is a complete missed day.
  const todayMs = startOfLocalDay(nowMs).getTime();
  const anchorMs = activeSet.has(localDateKey(todayMs))
    ? todayMs
    : activeSet.has(localDateKey(addLocalDays(todayMs, -1)))
      ? addLocalDays(todayMs, -1)
      : null;
  let currentStreakDays = 0;
  if (anchorMs !== null) {
    for (let cursor = anchorMs; activeSet.has(localDateKey(cursor)); ) {
      currentStreakDays += 1;
      cursor = addLocalDays(cursor, -1);
    }
  }

  let busiestDay: SummaryStats["busiestDay"] = null;
  for (const [dateKey, total] of daily) {
    if (
      total.seconds > 0 &&
      (!busiestDay ||
        total.seconds > busiestDay.seconds ||
        (total.seconds === busiestDay.seconds && dateKey > busiestDay.dateKey))
    ) {
      busiestDay = { dateKey, seconds: total.seconds };
    }
  }

  return {
    totalSeconds,
    sessionCount: overlaps.length,
    averageSeconds:
      overlaps.length > 0 ? Math.round(totalSeconds / overlaps.length) : 0,
    longestSessionSeconds: Math.max(0, ...overlaps),
    activeDays: activeKeys.length,
    currentStreakDays,
    longestStreakDays,
    busiestDay,
  };
}

export function quantileThresholds(values: number[], maxSteps = 4) {
  const sorted = values
    .filter((value) => value > 0)
    .sort((left, right) => left - right);
  const steps = Math.min(maxSteps, new Set(sorted).size);
  if (steps === 0) return [];
  return Array.from({ length: steps }, (_, index) => {
    const rank = Math.ceil(((index + 1) * sorted.length) / steps) - 1;
    return sorted[rank];
  }).filter((value, index, all) => index === 0 || value !== all[index - 1]);
}

export function quantileLevel(value: number, thresholds: number[]) {
  if (value <= 0 || thresholds.length === 0) return 0;
  const index = thresholds.findIndex((threshold) => value <= threshold);
  return index === -1 ? thresholds.length : index + 1;
}

/* Highlights, markers, habits and grouping ───────────────────────────────────
   Everything the History hero and the session journal show beyond raw
   numbers. Pure functions over the session list so they are cheap to test. */

export type HistoryHighlight =
  | {
      kind: "longestSession";
      session: Session;
      gameKey: string;
      name: string;
      coverUrl: string;
      seconds: number;
    }
  | {
      kind: "bestStreak";
      days: number;
      fromKey: string;
      toKey: string;
      seconds: number;
    }
  | {
      kind: "mostPlayed";
      gameKey: string;
      name: string;
      coverUrl: string;
      seconds: number;
      share: number;
    }
  | {
      kind: "busiestDay";
      dateKey: string;
      seconds: number;
      gameCount: number;
      topGameKey: string | null;
    }
  | {
      kind: "mostSessions";
      gameKey: string;
      name: string;
      coverUrl: string;
      sessionCount: number;
    }
  | {
      kind: "comeback";
      session: Session;
      gameKey: string;
      name: string;
      coverUrl: string;
      gapDays: number;
    };

/** Days without play that turn a resumed game into a "comeback". */
export const COMEBACK_MIN_DAYS = 14;

type StreakSpan = {
  fromKey: string;
  toKey: string;
  days: number;
  seconds: number;
};

function longestStreakSpan(daily: Map<string, DailyTotal>) {
  const activeKeys = [...daily]
    .filter(([, total]) => total.seconds > 0)
    .map(([key]) => key)
    .sort();
  let best: StreakSpan | null = null;
  let run: StreakSpan | null = null;
  let previousMs: number | null = null;
  for (const key of activeKeys) {
    const currentMs = dateKeyToLocalMs(key);
    const seconds = daily.get(key)!.seconds;
    run =
      run && previousMs !== null && addLocalDays(previousMs, 1) === currentMs
        ? {
            fromKey: run.fromKey,
            toKey: key,
            days: run.days + 1,
            seconds: run.seconds + seconds,
          }
        : { fromKey: key, toKey: key, days: 1, seconds };
    if (!best || run.days > best.days) best = run;
    previousMs = currentMs;
  }
  return best;
}

function gapDaysBetween(previousEndMs: number, nextStartMs: number) {
  return Math.round(
    (startOfLocalDay(nextStartMs).getTime() -
      startOfLocalDay(previousEndMs).getTime()) /
      86_400_000,
  );
}

export function historyHighlights(
  sessions: Session[],
  nowMs: number,
  range: HistoryRange | null,
  resolveGame: (session: Session) => ResolvedGame,
  resolveIgdbId?: GameIdentityResolver,
): HistoryHighlight[] {
  const result: HistoryHighlight[] = [];
  const counted: Array<{
    session: Session;
    interval: HistoryRange;
    seconds: number;
  }> = [];
  for (const session of sessions) {
    const interval = sessionInterval(session);
    if (!interval) continue;
    const seconds = Math.round(overlapMs(interval, range) / 1000);
    if (seconds > 0) counted.push({ session, interval, seconds });
  }
  if (counted.length === 0) return result;

  const longest = counted.reduce((best, entry) =>
    entry.seconds > best.seconds ? entry : best,
  );
  result.push({
    kind: "longestSession",
    session: longest.session,
    gameKey: getSessionGameKey(longest.session, resolveIgdbId),
    ...resolveGame(longest.session),
    seconds: longest.seconds,
  });

  const fromMs =
    range?.fromMs ?? Math.min(...counted.map((entry) => entry.interval.fromMs));
  const toMs = range?.toMs ?? addLocalDays(startOfLocalDay(nowMs).getTime(), 1);
  const daily = dailyTotals(sessions, fromMs, toMs);
  const streak = longestStreakSpan(daily);
  if (streak && streak.days >= 2)
    result.push({ kind: "bestStreak", ...streak });

  const games = topGames(
    sessions,
    resolveGame,
    Number.POSITIVE_INFINITY,
    range,
    resolveIgdbId,
  );
  const mostPlayed = games[0];
  if (mostPlayed?.key) {
    result.push({
      kind: "mostPlayed",
      gameKey: mostPlayed.key,
      name: mostPlayed.name,
      coverUrl: mostPlayed.coverUrl,
      seconds: mostPlayed.seconds,
      share: mostPlayed.share,
    });
  }

  let busiest: { dateKey: string; total: DailyTotal } | null = null;
  for (const [dateKey, total] of daily) {
    if (
      total.seconds > 0 &&
      (!busiest || total.seconds > busiest.total.seconds)
    ) {
      busiest = { dateKey, total };
    }
  }
  if (busiest) {
    const dayStart = dateKeyToLocalMs(busiest.dateKey);
    const dayEnd = addLocalDays(dayStart, 1);
    const keys = new Set(
      counted
        .filter(
          (entry) =>
            entry.interval.fromMs < dayEnd && entry.interval.toMs > dayStart,
        )
        .map((entry) => getSessionGameKey(entry.session, resolveIgdbId)),
    );
    result.push({
      kind: "busiestDay",
      dateKey: busiest.dateKey,
      seconds: busiest.total.seconds,
      gameCount: keys.size,
      topGameKey: busiest.total.topGameKey,
    });
  }

  const mostSessions = games
    .filter((game) => game.key && game.sessionCount >= 2)
    .sort(
      (left, right) =>
        right.sessionCount - left.sessionCount || right.seconds - left.seconds,
    )[0];
  if (mostSessions?.key) {
    result.push({
      kind: "mostSessions",
      gameKey: mostSessions.key,
      name: mostSessions.name,
      coverUrl: mostSessions.coverUrl,
      sessionCount: mostSessions.sessionCount,
    });
  }

  const markers = sessionMarkers(sessions, resolveIgdbId);
  const comeback = counted
    .map((entry) => ({
      entry,
      gapDays: markers.get(entry.session.id)?.comebackDays ?? 0,
    }))
    .filter((candidate) => candidate.gapDays >= COMEBACK_MIN_DAYS)
    .sort((left, right) => right.gapDays - left.gapDays)[0];
  if (comeback) {
    result.push({
      kind: "comeback",
      session: comeback.entry.session,
      gameKey: getSessionGameKey(comeback.entry.session, resolveIgdbId),
      ...resolveGame(comeback.entry.session),
      gapDays: comeback.gapDays,
    });
  }

  return result;
}

export type SessionMarker = {
  /** First ever session of a game that was played again afterwards. */
  first?: true;
  /** Longest session across the whole history. */
  longest?: true;
  /** Longest session of this game (with at least three sessions), when it is
   *  not already the overall longest. */
  gameRecord?: true;
  /** Days since the previous session of this game, when that gap is long. */
  comebackDays?: number;
};

export function sessionMarkers(
  sessions: Session[],
  resolveIgdbId?: GameIdentityResolver,
) {
  const markers = new Map<number, SessionMarker>();
  const mark = (id: number, patch: SessionMarker) =>
    markers.set(id, { ...(markers.get(id) ?? {}), ...patch });
  const ordered = sessions
    .map((session) => ({ session, interval: sessionInterval(session) }))
    .filter(
      (entry): entry is { session: Session; interval: HistoryRange } =>
        entry.interval !== null,
    )
    .sort((left, right) => left.interval.fromMs - right.interval.fromMs);

  let longest: { id: number; seconds: number } | null = null;
  const perGame = new Map<
    string,
    {
      count: number;
      firstId: number;
      lastEndMs: number;
      record: { id: number; seconds: number };
    }
  >();
  for (const { session, interval } of ordered) {
    const key = getSessionGameKey(session, resolveIgdbId);
    const seconds = Math.round((interval.toMs - interval.fromMs) / 1000);
    if (!longest || seconds > longest.seconds) {
      longest = { id: session.id, seconds };
    }
    const game = perGame.get(key);
    if (!game) {
      perGame.set(key, {
        count: 1,
        firstId: session.id,
        lastEndMs: interval.toMs,
        record: { id: session.id, seconds },
      });
      continue;
    }
    const gapDays = gapDaysBetween(game.lastEndMs, interval.fromMs);
    if (gapDays >= COMEBACK_MIN_DAYS) {
      mark(session.id, { comebackDays: gapDays });
    }
    game.count += 1;
    game.lastEndMs = Math.max(game.lastEndMs, interval.toMs);
    if (seconds > game.record.seconds) {
      game.record = { id: session.id, seconds };
    }
  }
  if (longest) mark(longest.id, { longest: true });
  for (const game of perGame.values()) {
    if (game.count >= 2) mark(game.firstId, { first: true });
    if (game.count >= 3 && game.record.id !== longest?.id) {
      mark(game.record.id, { gameRecord: true });
    }
  }
  return markers;
}

export type PlayHabits = {
  favoriteWeekday: { index: number; share: number } | null;
  primeHours: { from: number; to: number } | null;
  perActiveDaySeconds: number;
  weekendShare: number;
  lateNightShare: number;
  gamesPlayed: number;
  gamesOverTenHours: number;
};

/** Reads habits off the weekday×hour matrix, the summary and the ranked
 *  games so the Insights tab computes nothing twice. */
export function playHabits(
  matrix: number[][],
  stats: SummaryStats,
  games: TopGame[],
): PlayHabits {
  const total = matrix.flat().reduce((sum, seconds) => sum + seconds, 0);
  const weekdayTotals = matrix.map((row) =>
    row.reduce((sum, seconds) => sum + seconds, 0),
  );
  const hourTotals = Array.from({ length: 24 }, (_, hour) =>
    matrix.reduce((sum, row) => sum + row[hour], 0),
  );
  let favoriteWeekday: PlayHabits["favoriteWeekday"] = null;
  for (let index = 0; index < weekdayTotals.length; index += 1) {
    const seconds = weekdayTotals[index];
    if (
      seconds > 0 &&
      (!favoriteWeekday || seconds > weekdayTotals[favoriteWeekday.index])
    ) {
      favoriteWeekday = { index, share: seconds / total };
    }
  }
  let primeHours: PlayHabits["primeHours"] = null;
  let primeSeconds = 0;
  for (let hour = 0; hour < 24; hour += 1) {
    const seconds = hourTotals[hour] + hourTotals[(hour + 1) % 24];
    if (seconds > primeSeconds) {
      primeSeconds = seconds;
      primeHours = { from: hour, to: (hour + 2) % 24 };
    }
  }
  const realGames = games.filter((game) => game.key);
  return {
    favoriteWeekday,
    primeHours,
    perActiveDaySeconds:
      stats.activeDays > 0
        ? Math.round(stats.totalSeconds / stats.activeDays)
        : 0,
    weekendShare: total > 0 ? (weekdayTotals[5] + weekdayTotals[6]) / total : 0,
    lateNightShare:
      total > 0
        ? hourTotals.slice(0, 5).reduce((sum, seconds) => sum + seconds, 0) /
          total
        : 0,
    gamesPlayed: realGames.length,
    gamesOverTenHours: realGames.filter((game) => game.seconds >= 36_000)
      .length,
  };
}

export type HistoryDayGroup = {
  dateKey: string;
  dayMs: number;
  seconds: number;
  items: Session[];
};

export type HistoryMonthGroup = {
  monthKey: string;
  monthMs: number;
  seconds: number;
  sessionCount: number;
  days: HistoryDayGroup[];
};

/** Groups sessions by local day under their month, keeping the incoming
 *  order, so a list sorted newest-first reads top-down as a journal. */
export function groupSessionsByDay(sessions: Session[]): HistoryMonthGroup[] {
  const months: HistoryMonthGroup[] = [];
  for (const session of sessions) {
    const startedMs = Date.parse(session.startedAt);
    if (!Number.isFinite(startedMs)) continue;
    const seconds = Math.max(0, session.durationSeconds ?? 0);
    const dateKey = localDateKey(startedMs);
    const monthKey = dateKey.slice(0, 7);
    let month = months.at(-1);
    if (!month || month.monthKey !== monthKey) {
      month = {
        monthKey,
        monthMs: startOfLocalMonth(startedMs),
        seconds: 0,
        sessionCount: 0,
        days: [],
      };
      months.push(month);
    }
    let day = month.days.at(-1);
    if (!day || day.dateKey !== dateKey) {
      day = {
        dateKey,
        dayMs: startOfLocalDay(startedMs).getTime(),
        seconds: 0,
        items: [],
      };
      month.days.push(day);
    }
    day.items.push(session);
    day.seconds += seconds;
    month.seconds += seconds;
    month.sessionCount += 1;
  }
  return months;
}
