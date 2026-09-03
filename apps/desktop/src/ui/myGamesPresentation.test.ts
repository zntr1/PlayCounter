import { describe, expect, it } from "vitest";
import {
  DEFAULT_MY_GAMES_PRESENTATION,
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
        libraryShowOriginBadges: false,
      }),
    ).toEqual({
      cardSize: "grid",
      sortKey: "playtime",
      showOrigin: false,
      showMatch: true,
    });
  });

  it("seeds both badge toggles from the retired single one", () => {
    expect(
      resolveMyGamesPresentation({ libraryShowBadges: false }),
    ).toMatchObject({ showOrigin: false, showMatch: false });
  });

  it("lets a stored toggle win over the retired one", () => {
    expect(
      resolveMyGamesPresentation({
        libraryShowBadges: false,
        libraryShowMatchBadges: true,
      }),
    ).toMatchObject({ showOrigin: false, showMatch: true });
  });

  it("returns valid persisted setting keys", () => {
    expect(resolveMyGamesPresentationSettings(undefined)).toEqual({
      libraryCardSize: "grid",
      librarySortKey: "recent",
      libraryShowOriginBadges: true,
      libraryShowMatchBadges: true,
    });
  });
});
