import { describe, expect, it } from "vitest";
import {
  filterByProviderTab,
  libraryProviders,
  summarizeProviderLibrary,
  type ProviderLibraryGame,
} from "./providerLibrary";

function game(
  gameId: number,
  options: {
    igdbId?: number;
    imports?: ProviderLibraryGame["libraryImports"];
  } = {},
): ProviderLibraryGame {
  return {
    gameId,
    igdbId: options.igdbId,
    source: "igdb",
    libraryImports: options.imports ?? [],
  };
}

const steamEntry = (externalId: string, installed: boolean) => ({
  provider: "steam" as const,
  externalId,
  installed,
});

describe("provider library", () => {
  it("shows one provider badge when multiple provider entries map to one game", () => {
    expect(
      libraryProviders([steamEntry("100", true), steamEntry("101", false)]),
    ).toEqual(["steam"]);
  });

  it("filters Steam games without changing the all-games result", () => {
    const games = [
      game(1, { igdbId: 10, imports: [steamEntry("100", true)] }),
      game(2),
    ];

    expect(filterByProviderTab(games, "all")).toEqual(games);
    expect(filterByProviderTab(games, "steam")).toEqual([games[0]]);
  });

  it("summarizes canonical Steam games from Steam floors only", () => {
    const games = [
      game(1, {
        igdbId: 10,
        imports: [steamEntry("100", true), steamEntry("101", false)],
      }),
      game(2, {
        igdbId: 20,
        imports: [steamEntry("200", false)],
      }),
      game(3),
    ];

    expect(
      summarizeProviderLibrary(games, "steam", {
        "igdb#10": 7_201,
        "igdb#20": 0,
        "igdb#30": 99_999,
      }),
    ).toEqual({
      gameCount: 2,
      entryCount: 3,
      providerSeconds: 7_201,
      playedCount: 1,
      installedCount: 1,
    });
  });

  it("clamps invalid provider floors instead of contaminating totals", () => {
    const games = [
      game(1, { igdbId: 10, imports: [steamEntry("100", true)] }),
      game(2, { igdbId: 20, imports: [steamEntry("200", true)] }),
    ];

    expect(
      summarizeProviderLibrary(games, "steam", {
        "igdb#10": -50,
        "igdb#20": Number.NaN,
      }),
    ).toMatchObject({ providerSeconds: 0, playedCount: 0 });
  });
});
