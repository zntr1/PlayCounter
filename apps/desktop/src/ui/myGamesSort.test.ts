import { describe, expect, it } from "vitest";
import {
  LAST_PLAYED_PROMOTION_DELAY_MS,
  NEW_GAME_WINDOW_MS,
  compareMyGames,
  earliestAddedAt,
  isNewGame,
  mergeLastPlayedEvidence,
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
  it("replaces metadata timestamps with imported last-played evidence", () => {
    expect(
      mergeLastPlayedEvidence(
        "2026-08-26T12:00:00.000Z",
        "2026-08-19T12:00:00.000Z",
        false,
      ),
    ).toBe("2026-08-19T12:00:00.000Z");
  });

  it("keeps the newest timestamp when both values are play evidence", () => {
    expect(
      mergeLastPlayedEvidence(
        "2026-08-26T12:00:00.000Z",
        "2026-08-19T12:00:00.000Z",
        true,
      ),
    ).toBe("2026-08-26T12:00:00.000Z");
    expect(
      mergeLastPlayedEvidence(
        "2026-08-19T12:00:00.000Z",
        "2026-08-26T12:00:00.000Z",
        true,
      ),
    ).toBe("2026-08-26T12:00:00.000Z");
  });

  it("ranks real play dates ahead of fresh imports and undated playtime", () => {
    const unplayedImport = game(1, {
      lastPlayedAt: "2026-08-26T12:00:00.000Z",
      hasLastPlayedEvidence: false,
    });
    const providerHistory = game(2, {
      lastPlayedAt: "2026-08-18T12:00:00.000Z",
      hasLastPlayedEvidence: true,
    });
    const localHistory = game(3, { sessionCount: 1 });
    const undatedPlaytime = game(4, {
      totalSeconds: 7_200,
      lastPlayedAt: "2026-08-26T12:00:00.000Z",
      hasLastPlayedEvidence: false,
    });

    expect(
      [unplayedImport, undatedPlaytime, providerHistory, localHistory].sort(
        (left, right) => compareMyGames(left, right, "recent"),
      ),
    ).toEqual([localHistory, providerHistory, unplayedImport, undatedPlaytime]);
  });

  it("orders games without valid play dates by name, ignoring import dates", () => {
    const olderImport = game(1, {
      name: "Alpha",
      hasLastPlayedEvidence: false,
    });
    const newerImport = game(2, {
      name: "Bravo",
      lastPlayedAt: "2026-08-26T12:00:00.000Z",
      hasLastPlayedEvidence: false,
    });
    const invalidDate = game(3, {
      name: "Charlie",
      lastPlayedAt: "invalid",
      hasLastPlayedEvidence: true,
    });
    const played = game(4, { sessionCount: 1 });

    expect(
      [invalidDate, newerImport, olderImport, played].sort((left, right) =>
        compareMyGames(left, right, "recent"),
      ),
    ).toEqual([played, olderImport, newerImport, invalidDate]);
  });

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
      sessionCount: 1,
      lastPlayedAt: "2026-08-19T12:00:00.000Z",
    });

    expect(
      [completed, active].sort((left, right) =>
        compareMyGames(left, right, "recent"),
      ),
    ).toEqual([active, completed]);
  });
});

describe("Recently added", () => {
  it("puts the newest games first and undated games last by name", () => {
    const older = game(1, { addedAt: "2026-09-20T12:00:00.000Z" });
    const newest = game(2, { addedAt: "2026-09-27T12:00:00.000Z" });
    const undatedB = game(3, { name: "B" });
    const undatedA = game(4, { name: "A", addedAt: "not a date" });

    expect(
      [undatedB, older, undatedA, newest].sort((left, right) =>
        compareMyGames(left, right, "added"),
      ),
    ).toEqual([newest, older, undatedA, undatedB]);
  });

  it("keeps the earliest valid date across a game's routes in", () => {
    const early = "2026-09-01T12:00:00.000Z";
    const late = "2026-09-20T12:00:00.000Z";
    expect(earliestAddedAt(undefined, late)).toBe(late);
    expect(earliestAddedAt(late, early)).toBe(early);
    expect(earliestAddedAt(early, late)).toBe(early);
    expect(earliestAddedAt(early, undefined)).toBe(early);
    expect(earliestAddedAt(early, "junk")).toBe(early);
    expect(earliestAddedAt("junk", early)).toBe(early);
  });

  it("marks a game new only in its first week and only while unplayed", () => {
    const now = Date.parse("2026-09-27T12:00:00.000Z");
    const addedAt = new Date(now - 60_000).toISOString();

    expect(isNewGame(game(1, { addedAt }), now)).toBe(true);
    expect(
      isNewGame(
        game(1, { addedAt: new Date(now - NEW_GAME_WINDOW_MS).toISOString() }),
        now,
      ),
    ).toBe(false);
    expect(isNewGame(game(1), now)).toBe(false);
    expect(isNewGame(game(1, { addedAt, sessionCount: 1 }), now)).toBe(false);
    expect(
      isNewGame(game(1, { addedAt, hasLastPlayedEvidence: true }), now),
    ).toBe(false);
    expect(isNewGame(game(1, { addedAt, activeStartedAt: addedAt }), now)).toBe(
      false,
    );
  });
});
