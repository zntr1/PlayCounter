import { describe, expect, it } from "vitest";
import {
  filterByLibraryTab,
  resolveLibraryTab,
  visibleLibraryTabs,
} from "./libraryTabs";
import type { ProviderLibraryGame } from "./providerLibrary";

function game(
  gameId: number,
  options: Partial<ProviderLibraryGame> = {},
): ProviderLibraryGame {
  return {
    gameId,
    source: "igdb",
    libraryImports: [],
    ...options,
  };
}

const steamEntry = (externalId: string, installed = false) => ({
  provider: "steam" as const,
  externalId,
  installed,
});

describe("library tabs", () => {
  it("filters all, provider, and PlayCounter games", () => {
    const games = [
      game(1, { libraryImports: [steamEntry("100", true)] }),
      game(2),
    ];
    expect(filterByLibraryTab(games, "all")).toEqual(games);
    expect(filterByLibraryTab(games, "all")).not.toBe(games);
    expect(filterByLibraryTab(games, "steam")).toEqual([games[0]]);
    expect(filterByLibraryTab(games, "unimported")).toEqual([games[1]]);
  });

  it("keeps a game with any provider import out of PlayCounter", () => {
    const imported = game(1, {
      libraryImports: [steamEntry("100"), steamEntry("101")],
    });
    expect(filterByLibraryTab([imported], "unimported")).toEqual([]);
    expect(filterByLibraryTab([imported], "steam")).toEqual([imported]);
  });

  it("only builds a tab strip when a provider is visible", () => {
    const hiddenProvider = {
      provider: "steam" as const,
      label: "Steam",
      importSupported: false,
      gameCount: 0,
    };
    expect(
      visibleLibraryTabs({
        allTabCount: 2,
        unimportedGameCount: 2,
        providers: [hiddenProvider],
      }),
    ).toEqual([]);

    expect(
      visibleLibraryTabs({
        allTabCount: 2,
        unimportedGameCount: 2,
        providers: [{ ...hiddenProvider, importSupported: true }],
      }),
    ).toEqual([
      { id: "all", kind: "all", label: "All games", count: 2 },
      {
        id: "unimported",
        kind: "unimported",
        label: "PlayCounter",
        count: 2,
      },
      { id: "steam", kind: "provider", label: "Steam", count: 0 },
    ]);
  });

  it("places PlayCounter before providers and keeps it visible at zero", () => {
    const tabs = visibleLibraryTabs({
      allTabCount: 2,
      unimportedGameCount: 0,
      providers: [
        {
          provider: "steam",
          label: "Steam",
          importSupported: false,
          gameCount: 2,
        },
      ],
    });
    expect(tabs.map((tab) => tab.id)).toEqual(["all", "unimported", "steam"]);
    expect(tabs.find((tab) => tab.id === "unimported")?.count).toBe(0);
  });

  it("falls back from an unavailable requested tab", () => {
    const tabs = visibleLibraryTabs({
      allTabCount: 1,
      unimportedGameCount: 1,
      providers: [
        {
          provider: "steam",
          label: "Steam",
          importSupported: true,
          gameCount: 0,
        },
      ],
    });
    expect(resolveLibraryTab("unimported", tabs)).toBe("unimported");
    expect(resolveLibraryTab("steam", [])).toBe("all");
  });
});
