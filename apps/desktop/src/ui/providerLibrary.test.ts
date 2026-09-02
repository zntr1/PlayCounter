import { describe, expect, it } from "vitest";
import {
  libraryProviders,
  summarizeProviderLibrary,
  trackingUnavailableMessage,
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

  it("counts an Xbox title with unknown duration as played without adding zero time", () => {
    const games = [
      game(1, {
        igdbId: 10,
        imports: [
          {
            provider: "xbox",
            externalId: "1234",
            installed: false,
            entry: { providerSeconds: null },
          },
        ],
      }),
    ];

    expect(summarizeProviderLibrary(games, "xbox", {})).toEqual({
      gameCount: 1,
      entryCount: 1,
      providerSeconds: 0,
      playedCount: 1,
      installedCount: 0,
    });
  });

  it("uses the imported provider in missing-executable warnings", () => {
    expect(trackingUnavailableMessage(["xbox"], false)).toBe(
      "Xbox playtime is already imported, but this game's filename is unknown. Install and run the game so PlayCounter can discover it.",
    );
    expect(trackingUnavailableMessage(["steam"], true)).toContain(
      "Steam playtime is already imported",
    );
    expect(trackingUnavailableMessage(["steam"], true)).toContain(
      "Use Check for Matches",
    );
  });
});
