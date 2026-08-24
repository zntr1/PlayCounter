import { describe, expect, it } from "vitest";
import {
  LAST_PLAYED_PROMOTION_DELAY_MS,
  compareMyGames,
  shouldPromoteActiveGame,
  type MyGamesSortValue,
} from "./myGamesSort";

function game(
  gameId: number,
  overrides: Partial<MyGamesSortValue> = {},
): MyGamesSortValue {
  return {
    gameId,
    source: "igdb",
    name: `Game ${gameId}`,
    totalSeconds: 0,
    sessionCount: 0,
    lastPlayedAt: "2026-08-19T12:00:00.000Z",
    ...overrides,
  };
}

describe("My Games sorting", () => {
  it("waits 30 seconds before promoting an active game", () => {
    const startedAt = "2026-08-19T12:00:00.000Z";
    const startedAtMs = Date.parse(startedAt);

    expect(
      shouldPromoteActiveGame(
        startedAt,
        startedAtMs + LAST_PLAYED_PROMOTION_DELAY_MS - 1,
      ),
    ).toBe(false);
    expect(
      shouldPromoteActiveGame(
        startedAt,
        startedAtMs + LAST_PLAYED_PROMOTION_DELAY_MS,
      ),
    ).toBe(true);
  });

  it("keeps concurrently active games stable when checkpoints advance", () => {
    const first = game(1, {
      activeStartedAt: "2026-08-19T11:00:00.000Z",
      lastPlayedAt: "2026-08-19T12:00:00.000Z",
    });
    const second = game(2, {
      activeStartedAt: "2026-08-19T11:15:00.000Z",
      lastPlayedAt: "2026-08-19T12:00:10.000Z",
    });

    expect(
      [first, second].sort((left, right) =>
        compareMyGames(left, right, "recent"),
      ),
    ).toEqual([second, first]);

    first.lastPlayedAt = "2026-08-19T12:01:00.000Z";
    expect(
      [first, second].sort((left, right) =>
        compareMyGames(left, right, "recent"),
      ),
    ).toEqual([second, first]);
  });

  it("places active games before completed games", () => {
    const active = game(1, {
      activeStartedAt: "2026-08-19T10:00:00.000Z",
      lastPlayedAt: "2026-08-19T10:00:00.000Z",
    });
    const completed = game(2, {
      lastPlayedAt: "2026-08-19T12:00:00.000Z",
    });

    expect(
      [completed, active].sort((left, right) =>
        compareMyGames(left, right, "recent"),
      ),
    ).toEqual([active, completed]);
  });
});
