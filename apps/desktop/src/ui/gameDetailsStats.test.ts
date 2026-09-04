import type { Session } from "@playcounter/shared";
import { describe, expect, it } from "vitest";
import {
  EMPTY_GAME_SESSION_STATS,
  summarizeGameSessions,
} from "./gameDetailsStats";

const NOW = Date.parse("2026-09-04T12:00:00.000Z");
const daysAgo = (days: number) =>
  new Date(NOW - days * 86_400_000).toISOString();

let nextId = 1;

function session(options: Partial<Session> = {}): Session {
  const startedAt = options.startedAt ?? daysAgo(1);
  const durationSeconds = options.durationSeconds ?? 3_600;
  return {
    id: nextId++,
    gameId: 10,
    source: "igdb",
    exeName: "game.exe",
    startedAt,
    endedAt: new Date(
      Date.parse(startedAt) + durationSeconds * 1000,
    ).toISOString(),
    durationSeconds,
    ...options,
  };
}

// The key shape canonicalGameKey produces for an igdb game with no igdbId.
const KEY = "igdb:10";

describe("summarizeGameSessions", () => {
  it("returns empty stats for a game with no history key", () => {
    expect(
      summarizeGameSessions([session()], { gameKey: null, nowMs: NOW }),
    ).toEqual(EMPTY_GAME_SESSION_STATS);
  });

  it("counts only the sessions belonging to the game", () => {
    const stats = summarizeGameSessions(
      [
        session({ durationSeconds: 1_800 }),
        session({ gameId: 99, durationSeconds: 9_999 }),
      ],
      { gameKey: KEY, nowMs: NOW },
    );

    expect(stats.sessionCount).toBe(1);
    expect(stats.trackedSeconds).toBe(1_800);
  });

  it("derives totals, average, longest and the played window", () => {
    const stats = summarizeGameSessions(
      [
        session({ startedAt: daysAgo(1), durationSeconds: 3_600 }),
        session({ startedAt: daysAgo(2), durationSeconds: 7_200 }),
        session({ startedAt: daysAgo(100), durationSeconds: 1_800 }),
      ],
      { gameKey: KEY, nowMs: NOW },
    );

    expect(stats.trackedSeconds).toBe(12_600);
    expect(stats.averageSeconds).toBe(4_200);
    expect(stats.longestSeconds).toBe(7_200);
    expect(stats.longestSessionStartedAt).toBe(daysAgo(2));
    expect(stats.firstPlayedAt).toBe(daysAgo(100));
    expect(stats.daysPlayed).toBe(3);
    // The 100-day-old session falls outside the 30-day window.
    expect(stats.last30DaysSeconds).toBe(10_800);
    expect(stats.last30DaysSessions).toBe(2);
  });

  it("reports the newest end time and the oldest start whatever the order", () => {
    const stats = summarizeGameSessions(
      [
        session({ startedAt: daysAgo(5) }),
        session({ startedAt: daysAgo(1), durationSeconds: 60 }),
        session({ startedAt: daysAgo(3) }),
      ],
      { gameKey: KEY, nowMs: NOW },
    );

    expect(stats.firstPlayedAt).toBe(daysAgo(5));
    expect(stats.lastPlayedAt).toBe(
      new Date(Date.parse(daysAgo(1)) + 60_000).toISOString(),
    );
  });

  it("counts two sessions on the same day as one played day", () => {
    const morning = "2026-09-01T08:00:00.000Z";
    const evening = "2026-09-01T20:00:00.000Z";
    const stats = summarizeGameSessions(
      [session({ startedAt: morning }), session({ startedAt: evening })],
      { gameKey: KEY, nowMs: NOW },
    );

    expect(stats.sessionCount).toBe(2);
    expect(stats.daysPlayed).toBe(1);
  });

  it("treats an unknown duration as zero rather than NaN", () => {
    const stats = summarizeGameSessions(
      [session({ durationSeconds: null }), session({ durationSeconds: 600 })],
      { gameKey: KEY, nowMs: NOW },
    );

    expect(stats.trackedSeconds).toBe(600);
    expect(stats.averageSeconds).toBe(300);
  });

  it("flags a truncated window when sessions have been archived", () => {
    expect(
      summarizeGameSessions([session()], {
        gameKey: KEY,
        archivedSeconds: 5_000,
        nowMs: NOW,
      }).truncated,
    ).toBe(true);

    // Archived seconds with nothing retained still has to say so.
    expect(
      summarizeGameSessions([], {
        gameKey: KEY,
        archivedSeconds: 5_000,
        nowMs: NOW,
      }),
    ).toEqual({ ...EMPTY_GAME_SESSION_STATS, truncated: true });
  });

  it("falls back to the start time when a session never ended", () => {
    const stats = summarizeGameSessions(
      [session({ startedAt: daysAgo(1), endedAt: null })],
      { gameKey: KEY, nowMs: NOW },
    );

    expect(stats.lastPlayedAt).toBe(daysAgo(1));
  });
});
