import { describe, expect, it } from "vitest";
import {
  filterByLibraryTab,
  hasEmptyProviderTabs,
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

  it("offers importable launchers before the first import", () => {
    const steam = {
      provider: "steam" as const,
      label: "Steam",
      importSupported: false,
      gameCount: 0,
    };
    expect(
      visibleLibraryTabs({
        allTabCount: 2,
        unimportedGameCount: 2,
        providers: [steam],
      }),
    ).toEqual([]);

    expect(
      visibleLibraryTabs({
        allTabCount: 2,
        unimportedGameCount: 2,
        providers: [{ ...steam, importSupported: true }],
      }).map((tab) => tab.id),
    ).toEqual(["all", "unimported", "steam"]);
  });

  it("ignores hiding empty sources until something is imported", () => {
    expect(
      visibleLibraryTabs({
        allTabCount: 2,
        unimportedGameCount: 2,
        providers: [
          {
            provider: "steam",
            label: "Steam",
            importSupported: true,
            gameCount: 0,
          },
        ],
        hideEmptyProviders: true,
      }).map((tab) => tab.id),
    ).toEqual(["all", "unimported", "steam"]);
  });

  it("keeps empty libraries flat", () => {
    expect(
      visibleLibraryTabs({
        allTabCount: 0,
        unimportedGameCount: 0,
        providers: [
          {
            provider: "steam",
            label: "Steam",
            importSupported: true,
            gameCount: 0,
          },
        ],
      }),
    ).toEqual([]);
  });

  it("can hide populated launcher groups and resolve back to All games", () => {
    const tabs = visibleLibraryTabs({
      allTabCount: 2,
      unimportedGameCount: 1,
      providers: [
        {
          provider: "steam",
          label: "Steam",
          importSupported: true,
          gameCount: 1,
        },
      ],
      showProviders: false,
    });
    expect(tabs).toEqual([]);
    expect(resolveLibraryTab("steam", tabs)).toBe("all");
    expect(resolveLibraryTab("unimported", tabs)).toBe("all");
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

  it("drops empty provider tabs only when hiding is on", () => {
    const providers = [
      {
        provider: "steam" as const,
        label: "Steam",
        importSupported: true,
        gameCount: 0,
      },
      {
        provider: "xbox" as const,
        label: "Xbox",
        importSupported: true,
        gameCount: 3,
      },
    ];
    expect(
      visibleLibraryTabs({
        allTabCount: 3,
        unimportedGameCount: 0,
        providers,
      }).map((tab) => tab.id),
    ).toEqual(["all", "unimported", "steam", "xbox"]);
    expect(
      visibleLibraryTabs({
        allTabCount: 3,
        unimportedGameCount: 0,
        providers,
        hideEmptyProviders: true,
      }).map((tab) => tab.id),
    ).toEqual(["all", "unimported", "xbox"]);
  });

  it("still hides the strip when no provider tab exists at all", () => {
    expect(
      visibleLibraryTabs({
        allTabCount: 4,
        unimportedGameCount: 4,
        providers: [
          {
            provider: "steam",
            label: "Steam",
            importSupported: false,
            gameCount: 0,
          },
        ],
        hideEmptyProviders: true,
      }),
    ).toEqual([]);
  });

  it("offers the hide toggle only while a visible provider tab is empty", () => {
    expect(
      hasEmptyProviderTabs([
        {
          provider: "steam",
          label: "Steam",
          importSupported: true,
          gameCount: 0,
        },
        {
          provider: "xbox",
          label: "Xbox",
          importSupported: true,
          gameCount: 2,
        },
      ]),
    ).toBe(true);
    expect(
      hasEmptyProviderTabs([
        {
          provider: "steam",
          label: "Steam",
          importSupported: true,
          gameCount: 1,
        },
      ]),
    ).toBe(false);
    expect(
      hasEmptyProviderTabs([
        {
          provider: "steam",
          label: "Steam",
          importSupported: false,
          gameCount: 0,
        },
      ]),
    ).toBe(false);
  });

  it("falls back from an unavailable requested tab", () => {
    const tabs = visibleLibraryTabs({
      allTabCount: 2,
      unimportedGameCount: 1,
      providers: [
        {
          provider: "steam",
          label: "Steam",
          importSupported: true,
          gameCount: 1,
        },
      ],
    });
    expect(resolveLibraryTab("unimported", tabs)).toBe("unimported");
    expect(resolveLibraryTab("steam", [])).toBe("all");
  });
});
