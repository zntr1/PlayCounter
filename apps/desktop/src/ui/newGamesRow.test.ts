import type { LibraryProviderId } from "@playcounter/shared";
import { describe, expect, it } from "vitest";
import {
  addedLabel,
  newGameKey,
  newRowEntries,
  newRowGames,
  newRowSummary,
  type NewRowGame,
} from "./newGamesRow";

// Local times, so the calendar-day rules hold in every time zone. Day 0 is
// 31 October, -4 is 27 October.
const at = (day: number, hour: number, minute = 0, ms = 0) =>
  new Date(2026, 10, day, hour, minute, 0, ms).toISOString();
const NOW = Date.parse(at(3, 20));
const HOUR = 3_600_000;
// The 7-day window counts real hours, so its edges are counted back from NOW.
const hoursAgo = (hours: number) => new Date(NOW - hours * HOUR).toISOString();

type TestGame = NewRowGame & { id: string };

let nextGameId = 1;
function game(
  id: string,
  addedAt: string | undefined,
  extra: Partial<TestGame> = {},
): TestGame {
  return {
    id,
    name: id,
    gameId: -nextGameId++,
    source: "custom",
    addedAt,
    sessionCount: 0,
    libraryImports: [],
    ...extra,
  };
}

/** A game a launcher import brought in: its import entry is its first route. */
function imported(
  id: string,
  provider: LibraryProviderId,
  importedAt: string,
  extra: Partial<TestGame> = {},
): TestGame {
  return game(id, importedAt, {
    libraryImports: [{ provider, entry: { importedAt } }],
    ...extra,
  });
}

const ids = (entries: ReturnType<typeof newRowEntries<TestGame>>) =>
  entries.map((entry) =>
    entry.kind === "game"
      ? entry.game.id
      : `${entry.provider} import: ${entry.games.map((g) => g.id).join(" ")}`,
  );

describe("which games are in the row (plan 1, 4)", () => {
  it("holds the games added in the last 7 days and not played yet, newest first", () => {
    const games = [
      game("added 3 days ago", hoursAgo(72)),
      game("added 2 hours ago", hoursAgo(2)),
      game("added 6 days 23 hours ago", hoursAgo(6 * 24 + 23)),
      game("added yesterday", hoursAgo(26)),
    ];
    expect(newRowGames(games, NOW).map((g) => g.id)).toEqual([
      "added 2 hours ago",
      "added yesterday",
      "added 3 days ago",
      "added 6 days 23 hours ago",
    ]);
  });

  it("drops a game once it is 7 days old, played, running or played in its launcher", () => {
    const games = [
      game("still new", hoursAgo(10)),
      game("7 days old", hoursAgo(7 * 24)),
      game("played here", hoursAgo(10), { sessionCount: 1 }),
      game("running now", hoursAgo(10), { activeStartedAt: hoursAgo(1) }),
      game("played on Steam", hoursAgo(10), { hasLastPlayedEvidence: true }),
      game("no added date", undefined),
    ];
    expect(newRowGames(games, NOW).map((g) => g.id)).toEqual(["still new"]);
  });

  it("puts games added at the same moment in name order", () => {
    const games = [game("Beta", at(3, 10)), game("Alpha", at(3, 10))];
    expect(newRowGames(games, NOW).map((g) => g.id)).toEqual(["Alpha", "Beta"]);
  });
});

describe("import cards (plan 5)", () => {
  // A real import stamps every game a few milliseconds apart.
  const steamImport = (count: number, day = 2, hour = 21) =>
    Array.from({ length: count }, (_, index) =>
      imported(`steam ${index + 1}`, "steam", at(day, hour, 0, index * 3)),
    );

  it("makes one card of 5 or more games one launcher brought in on one day", () => {
    const row = newRowGames(
      [game("own game", at(3, 18)), ...steamImport(5)],
      NOW,
    );
    expect(ids(newRowEntries(row))).toEqual([
      "own game",
      "steam import: steam 5 steam 4 steam 3 steam 2 steam 1",
    ]);
  });

  it("keeps fewer than 5 as single cards", () => {
    const row = newRowGames(steamImport(4), NOW);
    expect(ids(newRowEntries(row))).toEqual([
      "steam 4",
      "steam 3",
      "steam 2",
      "steam 1",
    ]);
  });

  it("joins an import and later auto-adds of the same launcher on the same day", () => {
    const row = newRowGames(
      [
        ...steamImport(3, 3, 10),
        imported("auto-added 1", "steam", at(3, 18)),
        imported("auto-added 2", "steam", at(3, 18, 5)),
      ],
      NOW,
    );
    expect(ids(newRowEntries(row))).toEqual([
      "steam import: auto-added 2 auto-added 1 steam 3 steam 2 steam 1",
    ]);
  });

  it("counts each calendar day on its own", () => {
    const row = newRowGames(
      [
        imported("before midnight 1", "steam", at(2, 23, 58)),
        imported("before midnight 2", "steam", at(2, 23, 59)),
        imported("before midnight 3", "steam", at(2, 23, 59, 500)),
        imported("after midnight 1", "steam", at(3, 0, 1)),
        imported("after midnight 2", "steam", at(3, 0, 2)),
      ],
      NOW,
    );
    expect(newRowEntries(row).every((entry) => entry.kind === "game")).toBe(
      true,
    );
  });

  it("makes one card per launcher", () => {
    const epic = Array.from({ length: 5 }, (_, index) =>
      imported(`epic ${index + 1}`, "epic", at(3, 9, index)),
    );
    const row = newRowGames([...steamImport(5, 3, 12), ...epic], NOW);
    expect(ids(newRowEntries(row))).toEqual([
      "steam import: steam 5 steam 4 steam 3 steam 2 steam 1",
      "epic import: epic 5 epic 4 epic 3 epic 2 epic 1",
    ]);
  });

  it("puts the card where its newest game would be", () => {
    const row = newRowGames(
      [
        game("added today", at(3, 18)),
        ...steamImport(5, 2, 21),
        game("added 3 days ago", at(0, 12)),
      ],
      NOW,
    );
    expect(ids(newRowEntries(row))).toEqual([
      "added today",
      "steam import: steam 5 steam 4 steam 3 steam 2 steam 1",
      "added 3 days ago",
    ]);
  });

  it("never groups games added by hand, by a game file or a watch folder", () => {
    const own = Array.from({ length: 6 }, (_, index) =>
      game(`own ${index + 1}`, at(3, 10, index)),
    );
    expect(ids(newRowEntries(newRowGames(own, NOW)))).toEqual([
      "own 6",
      "own 5",
      "own 4",
      "own 3",
      "own 2",
      "own 1",
    ]);
  });

  it("leaves out a game that was in the library before the import brought it again", () => {
    const row = newRowGames(
      [
        ...steamImport(5),
        imported("known before", "steam", at(2, 21, 1), {
          addedAt: at(0, 15),
        }),
      ],
      NOW,
    );
    expect(ids(newRowEntries(row))).toEqual([
      "steam import: steam 5 steam 4 steam 3 steam 2 steam 1",
      "known before",
    ]);
  });
});

describe("the folded line (plan 6)", () => {
  it("names the games and the import, then how many more", () => {
    const steam = Array.from({ length: 115 }, (_, index) =>
      imported(`steam ${index}`, "steam", at(2, 21, 0, index)),
    );
    const row = newRowGames(
      [
        game("Hollow Knight: Silksong", at(3, 18)),
        ...steam,
        game("Balatro", at(1, 15)),
        game("Clair Obscur: Expedition 33", at(-2, 17)),
      ],
      NOW,
    );
    expect(newRowSummary(newRowEntries(row))).toBe(
      "Hollow Knight: Silksong, a Steam import of 115 games and 2 more",
    );
  });

  it("names two entries without a count", () => {
    const row = newRowGames(
      [game("Hollow Knight: Silksong", at(3, 18)), game("Balatro", at(1, 9))],
      NOW,
    );
    expect(newRowSummary(newRowEntries(row))).toBe(
      "Hollow Knight: Silksong and Balatro",
    );
  });
});

describe("Mark all as seen (plan 12)", () => {
  it("drops the games added before it; games added after it are new", () => {
    const games = [
      game("added before", hoursAgo(10)),
      game("added after", hoursAgo(2)),
    ];
    const marked = { seenAt: hoursAgo(5), seenGames: {} };
    expect(newRowGames(games, NOW, marked).map((g) => g.id)).toEqual([
      "added after",
    ]);
    expect(newRowGames(games, NOW).map((g) => g.id)).toEqual([
      "added after",
      "added before",
    ]);
  });
});

describe("Mark as seen, one game (plan 13)", () => {
  it("drops the marked game only", () => {
    const silksong = game("Silksong", hoursAgo(2));
    const balatro = game("Balatro", hoursAgo(50));
    const marked = {
      seenAt: null,
      seenGames: { [newGameKey(silksong)]: hoursAgo(1) },
    };
    expect(
      newRowGames([silksong, balatro], NOW, marked).map((g) => g.id),
    ).toEqual(["Balatro"]);
  });
});

describe("added label (plan 2)", () => {
  it("counts calendar days, not 24-hour spans", () => {
    const lateNight = Date.parse(at(3, 0, 10));
    expect(addedLabel(at(2, 23, 50), lateNight)).toBe("Added yesterday");
    expect(addedLabel(at(3, 0, 5), lateNight)).toBe("Added today");
    expect(addedLabel(at(3, 0, 30), NOW)).toBe("Added today");
    expect(addedLabel(at(0, 23), NOW)).toBe("Added 3 days ago");
  });
});
