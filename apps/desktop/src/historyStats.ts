import type { Session } from "@playcounter/shared";
import { resolvedCanonicalGameKey, type GameIdentityResolver } from "./store";

export type HistoryFilter = "all" | "today" | "week" | "month" | "currentMonth";

export type HistoryRange = { fromMs: number; toMs: number };

export type HistoryBucket = {
  label: string;
  tooltip: string;
  seconds: number;
  sessionCount: number;
  topGameKey: string | null;
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

function dayBoundaries(fromMs: number, count: number) {
  return Array.from({ length: count + 1 }, (_, index) =>
    addLocalDays(fromMs, index),
  );
}

function elapsedHourBoundaries(fromMs: number, toMs: number) {
  const boundaries = [fromMs];
  for (let cursor = fromMs + hourMs; cursor < toMs; cursor += hourMs) {
    boundaries.push(cursor);
  }
  boundaries.push(toMs);
  return boundaries;
}

export function historyRange(
  filter: HistoryFilter,
  nowMs: number,
): HistoryRange | null {
  if (filter === "all") return null;
  const todayMs = startOfLocalDay(nowMs).getTime();
  const fromMs =
    filter === "today"
      ? todayMs
      : filter === "currentMonth"
        ? startOfLocalMonth(nowMs)
        : addLocalDays(todayMs, filter === "week" ? -6 : -29);
  return { fromMs, toMs: addLocalDays(todayMs, 1) };
}

function formatHour(ms: number) {
  return new Date(ms).toLocaleTimeString([], { hour: "numeric" });
}

function formatDate(ms: number) {
  return new Date(ms).toLocaleDateString([], {
    month: "short",
    day: "numeric",
  });
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
  const buckets = boundaries.slice(0, -1).map((_, index) => ({
    label: descriptors?.[index]?.label ?? "",
    tooltip: descriptors?.[index]?.tooltip ?? "",
    seconds: 0,
    sessionCount: 0,
    topGameKey: null as string | null,
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
  });
  return buckets;
}

function descriptorsForBoundaries(
  boundaries: number[],
  mode: "hour" | "day" | "month",
) {
  return boundaries.slice(0, -1).map((fromMs, index) => {
    const toMs = boundaries[index + 1];
    if (mode === "hour") {
      return {
        label: formatHour(fromMs),
        tooltip: `${formatHour(fromMs)} – ${formatHour(toMs)}`,
      };
    }
    if (mode === "month") {
      return {
        label: new Date(fromMs).toLocaleDateString([], { month: "long" }),
        tooltip: new Date(fromMs).toLocaleDateString([], {
          month: "short",
          year: "numeric",
        }),
      };
    }
    return {
      label: new Date(fromMs).toLocaleDateString([], { weekday: "short" }),
      tooltip: formatDate(fromMs),
    };
  });
}

function groupedBoundaries(boundaries: number[], groups: number) {
  const intervalCount = boundaries.length - 1;
  const indexes = Array.from({ length: groups + 1 }, (_, index) =>
    Math.floor((index * intervalCount) / groups),
  );
  indexes[indexes.length - 1] = intervalCount;
  return indexes.map((index) => boundaries[index]);
}

function rangeDescriptors(boundaries: number[]) {
  return boundaries.slice(0, -1).map((fromMs, index) => ({
    label: formatDate(fromMs),
    tooltip: `${formatDate(fromMs)} – ${formatDate(
      Math.max(fromMs, boundaries[index + 1] - 1),
    )}`,
  }));
}

export function bucketSessions(
  sessions: Session[],
  filter: HistoryFilter,
  nowMs: number,
  resolveIgdbId?: GameIdentityResolver,
) {
  const todayMs = startOfLocalDay(nowMs).getTime();

  if (filter === "today") {
    const toMs = addLocalDays(todayMs, 1);
    const hourlyBoundaries = elapsedHourBoundaries(todayMs, toMs);
    const hourlyBuckets = aggregateBoundaries(
      sessions,
      hourlyBoundaries,
      descriptorsForBoundaries(hourlyBoundaries, "hour"),
      resolveIgdbId,
    );
    return {
      title: "Today",
      compact: hourlyBuckets,
      full: hourlyBuckets,
    };
  }

  if (filter === "week" || filter === "month" || filter === "currentMonth") {
    const days =
      filter === "week"
        ? 7
        : filter === "month"
          ? 30
          : new Date(nowMs).getDate();
    const fromMs = addLocalDays(todayMs, -(days - 1));
    const fullBoundaries = dayBoundaries(fromMs, days);
    const compactBoundaries =
      days <= 10 ? fullBoundaries : groupedBoundaries(fullBoundaries, 5);
    const fullDescriptors = descriptorsForBoundaries(fullBoundaries, "day");
    if (fullDescriptors.length > 0) fullDescriptors.at(-1)!.label = "Today";
    return {
      title:
        filter === "week"
          ? "Last 7 Days"
          : filter === "month"
            ? "Last 30 Days"
            : "This Month",
      compact: aggregateBoundaries(
        sessions,
        compactBoundaries,
        days <= 10 ? fullDescriptors : rangeDescriptors(compactBoundaries),
        resolveIgdbId,
      ),
      full: aggregateBoundaries(
        sessions,
        fullBoundaries,
        fullDescriptors,
        resolveIgdbId,
      ),
    };
  }

  const starts = sessions
    .map((session) => sessionInterval(session)?.fromMs)
    .filter((value): value is number => value !== undefined);
  if (starts.length === 0) {
    return { title: "All Time", compact: [], full: [] as HistoryBucket[] };
  }

  const first = new Date(Math.min(...starts));
  first.setDate(1);
  first.setHours(0, 0, 0, 0);
  const afterCurrentMonth = new Date(nowMs);
  afterCurrentMonth.setDate(1);
  afterCurrentMonth.setHours(0, 0, 0, 0);
  afterCurrentMonth.setMonth(afterCurrentMonth.getMonth() + 1);
  const boundaries: number[] = [];
  for (const cursor = new Date(first); cursor < afterCurrentMonth; ) {
    boundaries.push(cursor.getTime());
    cursor.setMonth(cursor.getMonth() + 1);
    cursor.setDate(1);
    cursor.setHours(0, 0, 0, 0);
  }
  boundaries.push(afterCurrentMonth.getTime());

  const full = aggregateBoundaries(
    sessions,
    boundaries,
    descriptorsForBoundaries(boundaries, "month"),
    resolveIgdbId,
  );
  const compactBoundaries =
    full.length <= 6 ? boundaries : groupedBoundaries(boundaries, 6);
  const compact =
    full.length <= 6
      ? full
      : aggregateBoundaries(
          sessions,
          compactBoundaries,
          rangeDescriptors(compactBoundaries),
          resolveIgdbId,
        );
  return { title: "All Time", compact, full };
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
      name: "Other",
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
