import { describe, expect, it } from "vitest";
import {
  DEFAULT_MY_GAMES_PRESENTATION,
  libraryBadgesVisible,
  resolveMyGamesPresentation,
  resolveMyGamesPresentationSettings,
} from "./myGamesPresentation";

describe("My Games presentation", () => {
  it("uses the current view defaults for absent settings", () => {
    expect(resolveMyGamesPresentation(undefined)).toEqual(
      DEFAULT_MY_GAMES_PRESENTATION,
    );
    expect(resolveMyGamesPresentation({})).toEqual(
      DEFAULT_MY_GAMES_PRESENTATION,
    );
  });

  it("sanitizes each imported setting independently", () => {
    expect(
      resolveMyGamesPresentation({
        libraryCardSize: "huge" as "grid",
        librarySortKey: "playtime",
        libraryShowBadges: false,
      }),
    ).toEqual({ cardSize: "grid", sortKey: "playtime", showBadges: false });
  });

  it("returns valid persisted setting keys", () => {
    expect(resolveMyGamesPresentationSettings(undefined)).toEqual({
      libraryCardSize: "grid",
      librarySortKey: "recent",
      libraryShowBadges: true,
    });
  });

  it("keeps tour badge anchors visible", () => {
    expect(libraryBadgesVisible({ showBadges: false, demo: false })).toBe(
      false,
    );
    expect(libraryBadgesVisible({ showBadges: false, demo: true })).toBe(true);
  });
});
