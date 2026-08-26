import { describe, expect, it } from "vitest";
import { findLocalLink, listLocalLinks, writeLocalLink } from "./localLinks";
import type { ExeCacheEntry } from "./store";
import type { ScopedExeLink } from "./library/types";

const exe: ExeCacheEntry = {
  exeName: "game.exe",
  state: "matched",
  gameId: -1,
  igdbId: 42,
  gameName: "Game",
  coverUrl: "cover",
  source: "custom",
  lastCheckedAt: "2026-01-01T00:00:00.000Z",
};

const scoped: ScopedExeLink = {
  exeName: "game.exe",
  pathPrefix: "C:\\Steam\\Game",
  gameId: -2,
  source: "custom",
  igdbId: 42,
  gameName: "Game",
  coverUrl: "cover",
  provider: "steam",
  externalId: "10",
  setAt: "2026-01-01T00:00:00.000Z",
};

describe("local links", () => {
  it("lists custom basename and scoped mappings with stable refs", () => {
    expect(
      listLocalLinks(
        new Map([["game.exe", exe]]),
        new Map([["game.exe|c:\\steam\\game", scoped]]),
      ).map((link) => link.ref.kind),
    ).toEqual(["exe", "scoped"]);
  });

  it("keeps a scoped mapping scoped when approving it", () => {
    const ref = { kind: "scoped", key: "game.exe|c:\\steam\\game" } as const;
    const updated = writeLocalLink(
      {
        exeCache: new Map(),
        scopedExeLinks: new Map([[ref.key, scoped]]),
      },
      ref,
      {
        source: "community",
        gameId: 99,
        communitySuggestionId: 99,
        communitySuggestionVerified: true,
        communitySuggestionStatus: "verified",
      },
    );

    expect(updated.exeCache.size).toBe(0);
    expect(
      findLocalLink(ref, updated.exeCache, updated.scopedExeLinks),
    ).toMatchObject({
      source: "community",
      gameId: 99,
      pathPrefix: "C:\\Steam\\Game",
    });
  });
});
