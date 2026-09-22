import type { Session } from "@playcounter/shared";
import { beforeAll, describe, expect, it } from "vitest";
import {
  bucketSessions,
  dailyTotals,
  getSessionGameKey,
  groupSessionsByDay,
  historyHighlights,
  historyRange,
  playHabits,
  quantileLevel,
  quantileThresholds,
  sessionMarkers,
  splitAcrossBoundaries,
  summaryStats,
  topGames,
  weekdayHourMatrix,
} from "./historyStats";
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

describe("calendar-safe buckets", () => {
  it("keeps range edges at local midnight across spring DST", () => {
    const nowMs = new Date("2026-03-30T12:00:00+02:00").getTime();
    const range = historyRange("week", nowMs)!;
    expect(new Date(range.fromMs).getHours()).toBe(0);
    expect(new Date(range.toMs).getHours()).toBe(0);

    const transitionDay = new Date("2026-03-29T12:00:00+02:00").getTime();
    const buckets = bucketSessions([], "today", transitionDay);
    expect(buckets.compact).toHaveLength(23);
    expect(buckets.full).toHaveLength(23);
  });

  it("keeps range edges at local midnight across fall DST", () => {
    const nowMs = new Date("2026-10-26T12:00:00+01:00").getTime();
    const range = historyRange("month", nowMs)!;
    expect(new Date(range.fromMs).getHours()).toBe(0);
    expect(new Date(range.toMs).getHours()).toBe(0);

    const transitionDay = new Date("2026-10-25T12:00:00+01:00").getTime();
    const buckets = bucketSessions([], "today", transitionDay);
    expect(buckets.compact).toHaveLength(25);
    expect(buckets.full).toHaveLength(25);
  });

  it("shows each hour in the compact Today chart", () => {
    const nowMs = new Date("2026-08-09T12:00:00+02:00").getTime();
    const buckets = bucketSessions([], "today", nowMs);

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
    const range = historyRange("today", nowMs);
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
    const range = historyRange("week", nowMs);
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
      historyRange("week", nowMs),
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
  it("starts on the first of the month and buckets by day", () => {
    const nowMs = Date.parse("2026-09-22T12:00:00+02:00");
    expect(historyRange("currentMonth", nowMs)).toEqual({
      fromMs: Date.parse("2026-09-01T00:00:00+02:00"),
      toMs: Date.parse("2026-09-23T00:00:00+02:00"),
    });
    const chart = bucketSessions(
      [session("2026-09-02T12:00:00+02:00", 3600)],
      "currentMonth",
      nowMs,
    );
    expect(chart.title).toBe("This Month");
    expect(chart.full).toHaveLength(22);
    expect(chart.compact).toHaveLength(5);
    expect(chart.full[1].seconds).toBe(3600);
  });
});
