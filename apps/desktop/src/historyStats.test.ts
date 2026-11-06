import type { Session } from "@playcounter/shared";
import { beforeAll, describe, expect, it } from "vitest";
import {
  bucketSessions,
  canStepHistorySelection,
  cumulativeSeconds,
  dailyTotals,
  getSessionGameKey,
  groupSessionsByDay,
  historyBucketUnits,
  historyHighlights,
  historySelectionFromRange,
  playHabits,
  previousHistoryRange,
  rangeSeconds,
  resolveHistorySelection,
  type HistorySelection,
  quantileLevel,
  quantileThresholds,
  sessionMarkers,
  splitAcrossBoundaries,
  summaryStats,
  topGames,
  weekdayHourMatrix,
  withLifetimeTotals,
} from "./historyStats";
import { gameLifetimeTotals } from "./milestones";
import { heatmapColor, heatmapColors } from "./ui/charts/chartUtils";

beforeAll(() => {
  const runtime = globalThis as typeof globalThis & {
    process?: { env: Record<string, string | undefined> };
  };
  if (runtime.process) runtime.process.env.TZ = "Europe/Berlin";
});

function session(
  startedAt: string,
  durationSeconds: number,
  overrides: Partial<Session> = {},
): Session {
  return {
    id: 1,
    gameId: 10,
    gameName: "Test Game",
    coverUrl: "cover.jpg",
    source: "custom",
    exeName: "test.exe",
    startedAt,
    endedAt: new Date(
      Date.parse(startedAt) + durationSeconds * 1000,
    ).toISOString(),
    durationSeconds,
    ...overrides,
  };
}

const today = (nowMs: number) =>
  resolveHistorySelection({ kind: "day", offset: 0 }, nowMs);

describe("calendar-safe buckets", () => {
  it("keeps range edges at local midnight across spring DST", () => {
    const nowMs = new Date("2026-03-30T12:00:00+02:00").getTime();
    const range = resolveHistorySelection({ kind: "last7", offset: 0 }, nowMs)!;
    expect(new Date(range.fromMs).getHours()).toBe(0);
    expect(new Date(range.toMs).getHours()).toBe(0);

    const transitionDay = new Date("2026-03-29T12:00:00+02:00").getTime();
    const buckets = bucketSessions([], today(transitionDay), transitionDay);
    expect(buckets.compact).toHaveLength(23);
    expect(buckets.full).toHaveLength(23);
  });

  it("keeps range edges at local midnight across fall DST", () => {
    const nowMs = new Date("2026-10-26T12:00:00+01:00").getTime();
    const range = resolveHistorySelection(
      { kind: "last30", offset: 0 },
      nowMs,
    )!;
    expect(new Date(range.fromMs).getHours()).toBe(0);
    expect(new Date(range.toMs).getHours()).toBe(0);

    const transitionDay = new Date("2026-10-25T12:00:00+01:00").getTime();
    const buckets = bucketSessions([], today(transitionDay), transitionDay);
    expect(buckets.compact).toHaveLength(25);
    expect(buckets.full).toHaveLength(25);
  });

  it("shows each hour in the compact Today chart", () => {
    const nowMs = new Date("2026-08-09T12:00:00+02:00").getTime();
    const buckets = bucketSessions([], today(nowMs), nowMs);

    expect(buckets.compact).toHaveLength(24);
    expect(buckets.compact.map((bucket) => bucket.tooltip)).toEqual(
      buckets.full.map((bucket) => bucket.tooltip),
    );
  });
});

describe("splitAcrossBoundaries", () => {
  it("splits a cross-midnight session and clips to visible boundaries", () => {
    const item = session("2026-08-07T22:00:00+02:00", 4 * 3600);
    const midnight = new Date("2026-08-08T00:00:00+02:00").getTime();
    const start = new Date("2026-08-07T00:00:00+02:00").getTime();
    const end = new Date("2026-08-09T00:00:00+02:00").getTime();

    expect(splitAcrossBoundaries(item, [start, midnight, end])).toEqual([
      7200, 7200,
    ]);
    expect(splitAcrossBoundaries(item, [midnight, end])).toEqual([7200]);
  });

  it("uses duration as authoritative when endedAt disagrees", () => {
    const item = session("2026-08-08T10:00:00+02:00", 90, {
      endedAt: "2026-08-08T14:00:00+02:00",
    });
    const start = Date.parse(item.startedAt);
    expect(
      splitAcrossBoundaries(item, [start, start + 60_000, start + 120_000]),
    ).toEqual([60, 30]);
  });
});

describe("range-aware aggregates", () => {
  it("groups source aliases by their shared IGDB identity", () => {
    const igdb = session("2026-08-08T10:00:00+02:00", 3600, {
      id: 1,
      gameId: 1,
      source: "igdb",
    });
    const community = session("2026-08-08T12:00:00+02:00", 3600, {
      id: 2,
      gameId: 7,
      source: "community",
    });
    const resolveIgdbId = (
      gameId: number,
      source?: Session["source"] | null,
    ) =>
      (source === "igdb" && gameId === 1) ||
      (source === "community" && gameId === 7)
        ? 12345
        : undefined;

    expect(getSessionGameKey(igdb, resolveIgdbId)).toBe("igdb#12345");
    expect(getSessionGameKey(community, resolveIgdbId)).toBe("igdb#12345");
    expect(
      topGames(
        [igdb, community],
        () => ({ name: "Game", coverUrl: "" }),
        8,
        null,
        resolveIgdbId,
      ),
    ).toMatchObject([{ key: "igdb#12345", seconds: 7200, sessionCount: 2 }]);
  });

  it("assigns sparse sessions directly to their overlapping calendar days", () => {
    const fromMs = new Date("2026-08-01T00:00:00+02:00").getTime();
    const toMs = new Date("2026-08-05T00:00:00+02:00").getTime();
    const totals = dailyTotals(
      [
        session("2026-08-01T23:30:00+02:00", 2 * 3600, { id: 1 }),
        session("2026-08-04T12:00:00+02:00", 1800, {
          id: 2,
          gameId: 20,
        }),
      ],
      fromMs,
      toMs,
    );

    expect(totals.get("2026-08-01")).toMatchObject({
      seconds: 1800,
      sessionCount: 1,
      topGameKey: "custom:10",
    });
    expect(totals.get("2026-08-02")).toMatchObject({
      seconds: 5400,
      sessionCount: 1,
      topGameKey: "custom:10",
    });
    expect(totals.get("2026-08-03")?.seconds).toBe(0);
    expect(totals.get("2026-08-04")).toMatchObject({
      seconds: 1800,
      sessionCount: 1,
      topGameKey: "custom:20",
    });
  });

  it("clips totals, averages, longest sessions and top games", () => {
    const item = session("2026-08-07T22:00:00+02:00", 4 * 3600);
    const nowMs = new Date("2026-08-08T12:00:00+02:00").getTime();
    const range = today(nowMs);
    const stats = summaryStats([item], nowMs, range);
    expect(stats.totalSeconds).toBe(7200);
    expect(stats.averageSeconds).toBe(7200);
    expect(stats.longestSessionSeconds).toBe(7200);
    expect(stats.activeDays).toBe(1);

    const games = topGames(
      [item],
      (entry) => ({ name: entry.gameName!, coverUrl: entry.coverUrl! }),
      8,
      range,
    );
    expect(games[0].seconds).toBe(7200);
    expect(games[0].share).toBe(1);
  });

  it("handles streak anchoring and leap-day adjacency", () => {
    const nowMs = new Date("2024-03-01T08:00:00+01:00").getTime();
    const items = [
      session("2024-02-28T20:00:00+01:00", 3600, { id: 1 }),
      session("2024-02-29T20:00:00+01:00", 3600, { id: 2 }),
    ];
    const stats = summaryStats(items, nowMs);
    expect(stats.currentStreakDays).toBe(2);
    expect(stats.longestStreakDays).toBe(2);
  });

  it("returns finite zero values for empty input", () => {
    const stats = summaryStats([], Date.now());
    expect(stats).toMatchObject({
      totalSeconds: 0,
      sessionCount: 0,
      averageSeconds: 0,
      longestSessionSeconds: 0,
      activeDays: 0,
    });
    expect(stats.busiestDay).toBeNull();
    expect(topGames([], () => ({ name: "", coverUrl: "" }))).toEqual([]);
  });
});

describe("quantiles", () => {
  it("collapses ties and supports fewer than four values", () => {
    const thresholds = quantileThresholds([0, 10, 10, 20]);
    expect(thresholds).toEqual([10, 20]);
    expect(quantileLevel(0, thresholds)).toBe(0);
    expect(quantileLevel(10, thresholds)).toBe(1);
    expect(quantileLevel(20, thresholds)).toBe(2);
  });
});

describe("heatmap palette", () => {
  it("uses fixed discrete colors and expands short scales across the palette", () => {
    expect(new Set(heatmapColors).size).toBe(heatmapColors.length);
    expect(heatmapColor(0, 4)).toBeNull();
    expect(heatmapColor(1, 4)).toBe(heatmapColors[0]);
    expect(heatmapColor(4, 4)).toBe(heatmapColors[3]);
    expect(heatmapColor(1, 1)).toBe(heatmapColors[3]);
  });
});

describe("history highlights and markers", () => {
  const resolveGame = (entry: Session) => ({
    name: entry.gameName ?? entry.exeName,
    coverUrl: entry.coverUrl ?? "",
  });
  // Tuesday 2026-09-22 noon, Berlin time.
  const nowMs = Date.parse("2026-09-22T12:00:00+02:00");
  const gothic = { gameId: 1, gameName: "Gothic" };
  const league = { gameId: 2, gameName: "League" };
  const sessions: Session[] = [
    session("2026-05-04T20:00:00+02:00", 3600, { id: 1, ...gothic }),
    session("2026-05-05T20:00:00+02:00", 7200, { id: 2, ...gothic }),
    session("2026-05-06T20:00:00+02:00", 1800, { id: 3, ...league }),
    // Twenty hours: the longest session and Gothic's record.
    session("2026-07-09T09:00:00+02:00", 72000, { id: 4, ...gothic }),
    session("2026-07-09T06:00:00+02:00", 1200, { id: 5, ...league }),
    // League returns after a long pause.
    session("2026-09-06T14:00:00+02:00", 5400, { id: 6, ...league }),
    session("2026-09-21T22:00:00+02:00", 2100, { id: 7, ...league }),
  ];

  it("marks firsts, the longest session, game records and comebacks", () => {
    const markers = sessionMarkers(sessions);
    expect(markers.get(1)).toEqual({ first: true });
    expect(markers.get(3)).toEqual({ first: true });
    // A game played once has no "first" to speak of.
    expect(
      sessionMarkers([
        session("2026-09-01T20:00:00+02:00", 600, { id: 9, gameId: 9 }),
      ]).get(9),
    ).toEqual({ longest: true });
    // Gothic's marathon is the overall longest and itself a comeback.
    expect(markers.get(4)).toEqual({ longest: true, comebackDays: 65 });
    // League: four sessions, its longest is #6, which also came back
    // after roughly two months; #7 followed fifteen days later.
    expect(markers.get(6)).toEqual({ gameRecord: true, comebackDays: 59 });
    expect(markers.get(7)).toEqual({ comebackDays: 15 });
    expect(markers.get(2)).toBeUndefined();
    expect(markers.get(5)).toEqual({ comebackDays: 64 });
  });

  it("collects the highlights for the whole history", () => {
    const highlights = historyHighlights(sessions, nowMs, null, resolveGame);
    const kinds = highlights.map((highlight) => highlight.kind);
    expect(kinds).toEqual([
      "longestSession",
      "bestStreak",
      "mostPlayed",
      "busiestDay",
      "mostSessions",
      "comeback",
    ]);
    expect(highlights[0]).toMatchObject({
      kind: "longestSession",
      seconds: 72000,
      name: "Gothic",
    });
    expect(highlights[1]).toMatchObject({
      kind: "bestStreak",
      days: 3,
      fromKey: "2026-05-04",
      toKey: "2026-05-06",
    });
    expect(highlights[2]).toMatchObject({ kind: "mostPlayed", name: "Gothic" });
    expect(highlights[3]).toMatchObject({
      kind: "busiestDay",
      dateKey: "2026-07-09",
      gameCount: 2,
    });
    expect(highlights[4]).toMatchObject({
      kind: "mostSessions",
      name: "League",
      sessionCount: 4,
    });
    expect(highlights[5]).toMatchObject({
      kind: "comeback",
      name: "Gothic",
      gapDays: 65,
    });
  });

  it("scopes the highlights to the selected range and drops what does not apply", () => {
    const range = resolveHistorySelection({ kind: "last7", offset: 0 }, nowMs);
    const highlights = historyHighlights(sessions, nowMs, range, resolveGame);
    expect(highlights.map((highlight) => highlight.kind)).toEqual([
      "longestSession",
      "mostPlayed",
      "busiestDay",
      "comeback",
    ]);
    expect(highlights[0]).toMatchObject({ seconds: 2100, name: "League" });
    expect(highlights[3]).toMatchObject({ name: "League", gapDays: 15 });
  });

  it("returns nothing for an empty history", () => {
    expect(historyHighlights([], nowMs, null, resolveGame)).toEqual([]);
    expect(sessionMarkers([]).size).toBe(0);
  });
});

describe("play habits", () => {
  it("reads the favourite weekday, prime time and shares off the matrix", () => {
    const nowMs = Date.parse("2026-09-22T12:00:00+02:00");
    const sessions: Session[] = [
      // Saturday evening, two hours.
      session("2026-09-19T21:00:00+02:00", 7200, { id: 1, gameId: 1 }),
      // Sunday after midnight, one hour.
      session("2026-09-20T00:30:00+02:00", 3600, { id: 2, gameId: 1 }),
      // Monday evening, one hour.
      session("2026-09-21T21:00:00+02:00", 3600, { id: 3, gameId: 2 }),
    ];
    const resolveGame = (entry: Session) => ({ name: "g", coverUrl: "" });
    const stats = summaryStats(sessions, nowMs);
    const habits = playHabits(
      weekdayHourMatrix(sessions, nowMs),
      stats,
      topGames(sessions, resolveGame, Number.POSITIVE_INFINITY),
    );
    expect(habits.favoriteWeekday).toEqual({ index: 5, share: 0.5 });
    expect(habits.primeHours).toEqual({ from: 21, to: 23 });
    expect(habits.perActiveDaySeconds).toBe(4800);
    expect(habits.weekendShare).toBe(0.75);
    expect(habits.lateNightShare).toBe(0.25);
    expect(habits.gamesPlayed).toBe(2);
    expect(habits.gamesOverTenHours).toBe(0);
  });

  it("clips the weekday matrix to a range", () => {
    const nowMs = Date.parse("2026-09-22T12:00:00+02:00");
    const sessions: Session[] = [
      session("2026-08-01T21:00:00+02:00", 3600, { id: 1 }),
      session("2026-09-21T21:00:00+02:00", 3600, { id: 2 }),
    ];
    const matrix = weekdayHourMatrix(
      sessions,
      nowMs,
      resolveHistorySelection({ kind: "last7", offset: 0 }, nowMs),
    );
    expect(matrix.flat().reduce((sum, seconds) => sum + seconds, 0)).toBe(3600);
  });
});

describe("day grouping", () => {
  it("groups sessions by day under their month in the incoming order", () => {
    const sessions: Session[] = [
      session("2026-09-22T12:31:00+02:00", 2100, { id: 1 }),
      session("2026-09-21T22:36:00+02:00", 2100, { id: 2 }),
      session("2026-09-21T19:00:00+02:00", 600, { id: 3 }),
      session("2026-07-09T09:00:00+02:00", 72000, { id: 4 }),
    ];
    const months = groupSessionsByDay(sessions);
    expect(months.map((month) => month.monthKey)).toEqual([
      "2026-09",
      "2026-07",
    ]);
    expect(months[0]).toMatchObject({ sessionCount: 3, seconds: 4800 });
    expect(months[0].days.map((day) => day.dateKey)).toEqual([
      "2026-09-22",
      "2026-09-21",
    ]);
    expect(months[0].days[1]).toMatchObject({ seconds: 2700 });
    expect(months[0].days[1].items.map((item) => item.id)).toEqual([2, 3]);
    expect(months[1].days[0].items.map((item) => item.id)).toEqual([4]);
  });
});

describe("current month range", () => {
  it("starts on the first of the month and shows one bar per day", () => {
    const nowMs = Date.parse("2026-09-22T12:00:00+02:00");
    const range = resolveHistorySelection({ kind: "month", offset: 0 }, nowMs);
    expect(range).toEqual({
      fromMs: Date.parse("2026-09-01T00:00:00+02:00"),
      toMs: Date.parse("2026-09-23T00:00:00+02:00"),
    });
    const chart = bucketSessions(
      [session("2026-09-02T12:00:00+02:00", 3600)],
      range,
      nowMs,
    );
    expect(chart.full).toHaveLength(22);
    expect(chart.compact).toBe(chart.full);
    expect(chart.full[1].seconds).toBe(3600);
  });
});

/* Plan: docs/history-ranges-plan.md. Today is Friday, 6 Nov 2026, 21:40 in
   Berlin; the first session was on 1 Sep 2025. */
describe("history ranges", () => {
  const nowMs = Date.parse("2026-11-06T21:40:00+01:00");
  const firstMs = Date.parse("2025-09-01T19:12:00+02:00");
  const local = (key: string) => {
    const [year, month, day] = key.split("-").map(Number);
    return new Date(year, month - 1, day).getTime();
  };
  const days = (from: string, to: string) => ({
    fromMs: local(from),
    toMs: local(to),
  });
  const resolve = (selection: HistorySelection) =>
    resolveHistorySelection(selection, nowMs);
  const picked = (from: string, to: string) =>
    historySelectionFromRange(local(from), local(to), nowMs, firstMs);
  const canStep = (selection: HistorySelection, direction: 1 | -1) =>
    canStepHistorySelection(selection, direction, nowMs, firstMs);
  const before = (selection: HistorySelection) =>
    previousHistoryRange(selection, nowMs);

  // 2: This month → October 2026 → September 2026
  it("steps This month back one month at a time", () => {
    expect(resolve({ kind: "month", offset: 0 })).toEqual(
      days("2026-11-01", "2026-11-07"),
    );
    expect(resolve({ kind: "month", offset: -1 })).toEqual(
      days("2026-10-01", "2026-11-01"),
    );
    expect(resolve({ kind: "month", offset: -2 })).toEqual(
      days("2026-09-01", "2026-10-01"),
    );
  });

  // 2: 30 days → the 30 days before; 7 days → the 7 before; Today → Yesterday
  it("steps 30 days, 7 days and Today by their own length", () => {
    expect(resolve({ kind: "last30", offset: 0 })).toEqual(
      days("2026-10-08", "2026-11-07"),
    );
    expect(resolve({ kind: "last30", offset: -1 })).toEqual(
      days("2026-09-08", "2026-10-08"),
    );
    expect(resolve({ kind: "last7", offset: -1 })).toEqual(
      days("2026-10-24", "2026-10-31"),
    );
    expect(resolve({ kind: "day", offset: -1 })).toEqual(
      days("2026-11-05", "2026-11-06"),
    );
    expect(resolve({ kind: "day", offset: -2 })).toEqual(
      days("2026-11-04", "2026-11-05"),
    );
    expect(resolve({ kind: "all" })).toBeNull();
  });

  // 3: › is off on the current period, ‹ when the period before ends before
  // the first session
  it("steps forward only up to now and back only to the first session", () => {
    expect(canStep({ kind: "month", offset: 0 }, 1)).toBe(false);
    expect(canStep({ kind: "month", offset: -1 }, 1)).toBe(true);
    expect(canStep({ kind: "last30", offset: 0 }, 1)).toBe(false);
    expect(canStep({ kind: "day", offset: 0 }, 1)).toBe(false);
    expect(canStep({ kind: "day", offset: 0 }, -1)).toBe(true);
    // October 2025 → September 2025 holds the first session
    expect(canStep({ kind: "month", offset: -13 }, -1)).toBe(true);
    // September 2025 → August 2025 is before it
    expect(canStep({ kind: "month", offset: -14 }, -1)).toBe(false);
    expect(canStep({ kind: "all" }, -1)).toBe(false);
    expect(canStep({ kind: "all" }, 1)).toBe(false);
  });

  // 5: a picked range steps by its own length
  it("steps a picked span by its length: days by days, months by months", () => {
    const span = picked("2026-10-03", "2026-10-20");
    expect(span).toEqual({
      kind: "span",
      unit: "day",
      fromKey: "2026-10-03",
      length: 17,
      offset: 0,
    });
    expect(resolve({ ...span, offset: 1 } as HistorySelection)).toEqual(
      days("2026-10-20", "2026-11-06"),
    );
    const summer = picked("2026-06-01", "2026-09-01");
    expect(summer).toEqual({
      kind: "span",
      unit: "month",
      fromKey: "2026-06-01",
      length: 3,
      offset: 0,
    });
    expect(resolve({ ...summer, offset: -1 } as HistorySelection)).toEqual(
      days("2026-03-01", "2026-06-01"),
    );
  });

  // 6: a pick that matches a period becomes that period
  it("turns a pick that matches a period into that period", () => {
    expect(picked("2026-10-01", "2026-11-01")).toEqual({
      kind: "month",
      offset: -1,
    });
    expect(picked("2026-11-01", "2026-11-07")).toEqual({
      kind: "month",
      offset: 0,
    });
    expect(picked("2026-11-02", "2026-11-07")).toEqual({
      kind: "week",
      offset: 0,
    });
    expect(picked("2026-10-26", "2026-11-02")).toEqual({
      kind: "week",
      offset: -1,
    });
    expect(picked("2026-11-04", "2026-11-05")).toEqual({
      kind: "day",
      offset: -2,
    });
    expect(picked("2025-01-01", "2026-01-01")).toEqual({
      kind: "year",
      offset: -1,
    });
    expect(picked("2026-10-08", "2026-11-07")).toEqual({
      kind: "last30",
      offset: 0,
    });
    expect(picked("2026-10-31", "2026-11-07")).toEqual({
      kind: "last7",
      offset: 0,
    });
    expect(picked("2025-09-01", "2026-11-07")).toEqual({ kind: "all" });
  });

  // 18: same length, ending where the range starts
  it("compares with the period right before, same length", () => {
    expect(before({ kind: "month", offset: -1 })).toEqual(
      days("2026-09-01", "2026-10-01"),
    );
    expect(before({ kind: "last30", offset: 0 })).toEqual(
      days("2026-09-08", "2026-10-08"),
    );
    expect(before({ kind: "day", offset: 0 })).toEqual(
      days("2026-11-05", "2026-11-06"),
    );
    expect(before({ kind: "all" })).toBeNull();
  });

  // 18: a month, week or year in progress: the same days of the one before
  it("compares a period in progress with the same days of the one before", () => {
    expect(before({ kind: "month", offset: 0 })).toEqual(
      days("2026-10-01", "2026-10-07"),
    );
    expect(before({ kind: "week", offset: 0 })).toEqual(
      days("2026-10-26", "2026-10-31"),
    );
    expect(before({ kind: "year", offset: 0 })).toEqual(
      days("2025-01-01", "2025-11-07"),
    );
    // 31 days of March against February: capped at February's end
    expect(
      previousHistoryRange(
        { kind: "month", offset: 0 },
        Date.parse("2026-03-31T12:00:00+02:00"),
      ),
    ).toEqual(days("2026-02-01", "2026-03-01"));
  });

  // 22: 1 day = hours; up to 31 days = days; up to 92 = weeks (Detailed:
  // days); longer = months (Detailed: weeks)
  it("picks the bar size from the range length", () => {
    expect(historyBucketUnits(1)).toEqual({
      overview: "hour",
      detailed: "hour",
    });
    expect(historyBucketUnits(30)).toEqual({
      overview: "day",
      detailed: "day",
    });
    expect(historyBucketUnits(31)).toEqual({
      overview: "day",
      detailed: "day",
    });
    expect(historyBucketUnits(32)).toEqual({
      overview: "week",
      detailed: "day",
    });
    expect(historyBucketUnits(92)).toEqual({
      overview: "week",
      detailed: "day",
    });
    expect(historyBucketUnits(93)).toEqual({
      overview: "month",
      detailed: "week",
    });
  });

  it("shows 30 days as 30 bars and a quarter as calendar weeks", () => {
    const month = bucketSessions(
      [],
      resolve({ kind: "last30", offset: 0 }),
      nowMs,
    );
    expect(month.compact).toHaveLength(30);
    expect(month.full).toBe(month.compact);
    // 1 Aug 2026 is a Saturday: a two-day week, then Monday to Sunday
    const quarter = bucketSessions([], days("2026-08-01", "2026-11-01"), nowMs);
    expect(quarter.compact).toHaveLength(14);
    expect(quarter.compact[0]).toMatchObject({
      fromMs: local("2026-08-01"),
      toMs: local("2026-08-03"),
    });
    expect(quarter.full).toHaveLength(92);
  });

  it("starts All time at the first session", () => {
    const first = session("2026-09-14T20:00:00+02:00", 3600);
    const chart = bucketSessions([first], null, nowMs);
    // 14 Sep (a Monday) to today: 54 days, so calendar weeks
    expect(chart.compact).toHaveLength(8);
    expect(chart.compact[0]).toMatchObject({
      fromMs: local("2026-09-14"),
      seconds: 3600,
    });
  });

  // 20: every game's part of a bar, the most played first
  it("keeps each game's part of a bar, most played first", () => {
    const a = session("2026-10-05T18:00:00+02:00", 7200, {
      id: 1,
      gameId: 1,
      gameName: "A",
    });
    const b = session("2026-10-05T21:00:00+02:00", 3600, {
      id: 2,
      gameId: 2,
      gameName: "B",
    });
    const chart = bucketSessions(
      [b, a],
      days("2026-10-05", "2026-10-12"),
      nowMs,
    );
    expect(chart.full[0].games).toEqual([
      { key: getSessionGameKey(a), seconds: 7200 },
      { key: getSessionGameKey(b), seconds: 3600 },
    ]);
    expect(chart.full[0].topGameKey).toBe(getSessionGameKey(a));
    expect(chart.full[1].games).toEqual([]);
  });

  // 17 + 23: the compare line's total and the Pace line's running total
  it("adds up a range's playtime and runs a total for the pace line", () => {
    const items = [
      // 23:00 on 31 Oct to 1:00 on 1 Nov: one hour falls into November
      session("2026-10-31T23:00:00+01:00", 7200, { id: 1 }),
      session("2026-11-02T20:00:00+01:00", 3600, { id: 2 }),
    ];
    const november = resolve({ kind: "month", offset: 0 })!;
    expect(rangeSeconds(items, november)).toBe(7200);
    expect(
      cumulativeSeconds(bucketSessions(items, november, nowMs).full),
    ).toEqual([3600, 7200, 7200, 7200, 7200, 7200]);
  });

  // 23: a range still in progress draws its line only up to now
  it("stops the running total at now", () => {
    const evening = session("2026-11-06T19:00:00+01:00", 3600, { id: 3 });
    const today = resolve({ kind: "day", offset: 0 })!;
    const hours = bucketSessions([evening], today, nowMs).full;
    expect(hours).toHaveLength(24);
    // 21:40: the hours up to 21:00 have a total, 22:00 and 23:00 are ahead
    const totals = cumulativeSeconds(hours, nowMs);
    expect(totals).toHaveLength(22);
    expect(totals.at(-1)).toBe(3600);
  });
});

describe("all time leaderboard", () => {
  it("ranks lifetime totals and adds games that have no sessions", () => {
    const sessions = [
      session("2026-08-07T20:00:00+02:00", 20 * 3600, {
        id: 1,
        gameId: 100,
        igdbId: 100,
        source: "igdb",
        gameName: "Elden Ring",
      }),
      session("2026-08-06T20:00:00+02:00", 10 * 3600, {
        id: 2,
        gameId: 7,
        gameName: "Erased",
      }),
    ];
    const resolveGame = (entry: Session) => ({
      name: entry.gameName!,
      coverUrl: entry.coverUrl!,
    });
    const played = topGames(sessions, resolveGame, Number.POSITIVE_INFINITY);
    const { games: totals } = gameLifetimeTotals({
      sessions,
      archivedGameSeconds: { "community:9": 5 * 3600 },
      playtimeAdjustments: { "custom:7": -10 * 3600 },
      providerFloors: [
        {
          canonicalKey: "igdb#100",
          seconds: 300 * 3600,
          name: "Elden Ring",
          coverUrl: "",
        },
        {
          canonicalKey: "igdb#200",
          seconds: 500 * 3600,
          name: "Dota 2",
          coverUrl: "dota.jpg",
        },
      ],
    });
    const describe = (key: string) => ({
      name: key === "community:9" ? "Archived Game" : "Unknown game",
      coverUrl: "",
      lastPlayedMs: key === "igdb#200" ? 1_700_000_000_000 : 0,
    });

    const games = withLifetimeTotals(played, totals, describe);

    // Launcher time beats the 20h of sessions, like My Games; an edit that
    // takes a game to zero drops it.
    expect(
      games.map(({ key, name, seconds, sessionCount, lastPlayedMs }) => ({
        key,
        name,
        hours: seconds / 3600,
        sessionCount,
        lastPlayedMs,
      })),
    ).toEqual([
      {
        key: "igdb#200",
        name: "Dota 2",
        hours: 500,
        sessionCount: 0,
        lastPlayedMs: 1_700_000_000_000,
      },
      {
        key: "igdb#100",
        name: "Elden Ring",
        hours: 300,
        sessionCount: 1,
        lastPlayedMs: Date.parse("2026-08-07T20:00:00+02:00"),
      },
      {
        key: "community:9",
        name: "Archived Game",
        hours: 5,
        sessionCount: 0,
        lastPlayedMs: 0,
      },
    ]);
    expect(games.reduce((sum, game) => sum + game.share, 0)).toBeCloseTo(1);
  });
});
