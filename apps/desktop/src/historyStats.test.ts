import type { Session } from "@playcounter/shared";
import { beforeAll, describe, expect, it } from "vitest";
import {
  bucketSessions,
  dailyTotals,
  historyRange,
  quantileLevel,
  quantileThresholds,
  splitAcrossBoundaries,
  summaryStats,
  topGames,
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
    expect(bucketSessions([], "today", transitionDay).full).toHaveLength(23);
  });

  it("keeps range edges at local midnight across fall DST", () => {
    const nowMs = new Date("2026-10-26T12:00:00+01:00").getTime();
    const range = historyRange("month", nowMs)!;
    expect(new Date(range.fromMs).getHours()).toBe(0);
    expect(new Date(range.toMs).getHours()).toBe(0);

    const transitionDay = new Date("2026-10-25T12:00:00+01:00").getTime();
    expect(bucketSessions([], "today", transitionDay).full).toHaveLength(25);
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
