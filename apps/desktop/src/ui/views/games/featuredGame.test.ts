import { describe, expect, it } from "vitest";
import { pickFeaturedGame } from "./featuredGame";

const game = (
  overrides: Partial<{
    igdbId: number;
    gameId: number;
    source: "igdb" | "community" | "custom" | null;
    lastPlayedAt: string;
    hasLastPlayedEvidence: boolean;
    sessionCount: number;
  }> = {},
) => ({
  igdbId: overrides.igdbId,
  aliases: [
    { gameId: overrides.gameId ?? 1, source: overrides.source ?? "igdb" },
  ],
  lastPlayedAt: overrides.lastPlayedAt ?? "2026-01-01T00:00:00Z",
  hasLastPlayedEvidence: overrides.hasLastPlayedEvidence,
  sessionCount: overrides.sessionCount ?? 0,
});

describe("pickFeaturedGame", () => {
  it("returns nothing for an empty library", () => {
    expect(pickFeaturedGame([], null)).toBeNull();
  });

  it("prefers the most recently played game over a newer unplayed one", () => {
    const played = game({
      gameId: 1,
      lastPlayedAt: "2026-02-01T00:00:00Z",
      sessionCount: 3,
    });
    const added = game({ gameId: 2, lastPlayedAt: "2026-03-01T00:00:00Z" });
    expect(pickFeaturedGame([added, played], null)).toEqual({
      game: played,
      pinned: false,
    });
  });

  it("falls back to the most recently added game when nothing was played", () => {
    const older = game({ gameId: 1, lastPlayedAt: "2026-01-01T00:00:00Z" });
    const newer = game({ gameId: 2, lastPlayedAt: "2026-02-01T00:00:00Z" });
    expect(pickFeaturedGame([older, newer], null)?.game).toBe(newer);
  });

  it("honours a pin by IGDB id, then by local identity", () => {
    const byIgdb = game({ igdbId: 500, gameId: 7, source: "igdb" });
    const local = game({ gameId: 9, source: "custom" });
    const recent = game({
      gameId: 3,
      lastPlayedAt: "2027-01-01T00:00:00Z",
      sessionCount: 1,
    });
    const games = [recent, byIgdb, local];
    expect(
      pickFeaturedGame(games, { gameId: 999, source: null, igdbId: 500 }),
    ).toEqual({ game: byIgdb, pinned: true });
    expect(pickFeaturedGame(games, { gameId: 9, source: "custom" })).toEqual({
      game: local,
      pinned: true,
    });
  });

  it("drops back to last played when the pinned game left the library", () => {
    const recent = game({ gameId: 3, sessionCount: 1 });
    expect(pickFeaturedGame([recent], { gameId: 42, source: "igdb" })).toEqual({
      game: recent,
      pinned: false,
    });
  });
});
