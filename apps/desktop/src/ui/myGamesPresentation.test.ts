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
        libraryGridColumns: 0,
        librarySortKey: "playtime",
        libraryShowOriginBadges: false,
      }),
    ).toEqual({
      cardSize: "grid",
      gridColumns: null,
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
      libraryGridColumns: null,
      librarySortKey: "recent",
      libraryShowOriginBadges: true,
      libraryShowMatchBadges: true,
    });
  });

  it("restores custom columns without changing the chosen card style", () => {
    expect(
      resolveMyGamesPresentationSettings({
        libraryCardSize: "large",
        libraryGridColumns: 6,
      }),
    ).toMatchObject({ libraryCardSize: "large", libraryGridColumns: 6 });
  });
});
