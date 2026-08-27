import { describe, expect, it } from "vitest";
import { myGamesLayout } from "./myGamesLayout";

function layout(overrides: Partial<Parameters<typeof myGamesLayout>[0]> = {}) {
  return myGamesLayout({
    libraryGameCount: 3,
    steamGameCount: 0,
    steamImportSupported: true,
    requestedTab: "all",
    visibleGameCount: 3,
    ...overrides,
  });
}

describe("My Games layout", () => {
  it("offers Steam import in an otherwise empty Windows library", () => {
    expect(layout({ libraryGameCount: 0, visibleGameCount: 0 })).toEqual({
      showTabs: false,
      activeTab: "all",
      showImportCta: true,
      panel: "empty-library",
    });
  });

  it("keeps an empty non-Windows library neutral", () => {
    expect(
      layout({
        libraryGameCount: 0,
        steamImportSupported: false,
        visibleGameCount: 0,
      }),
    ).toMatchObject({
      showTabs: false,
      activeTab: "all",
      showImportCta: false,
      panel: "empty-library",
    });
  });

  it("keeps the empty Steam tab selected when import is supported", () => {
    expect(layout({ requestedTab: "steam", visibleGameCount: 0 })).toEqual({
      showTabs: true,
      activeTab: "steam",
      showImportCta: true,
      panel: "steam-empty",
    });
  });

  it("never exposes an empty Steam destination without import support", () => {
    for (const libraryGameCount of [0, 2]) {
      for (const requestedTab of ["all", "steam"] as const) {
        const result = layout({
          libraryGameCount,
          steamGameCount: 0,
          steamImportSupported: false,
          requestedTab,
          visibleGameCount: libraryGameCount,
        });
        expect(result.activeTab).not.toBe("steam");
        expect(result.panel).not.toBe("steam-empty");
      }
    }
  });

  it("shows restored Steam games without an import action off Windows", () => {
    expect(
      layout({
        steamGameCount: 2,
        steamImportSupported: false,
        requestedTab: "steam",
        visibleGameCount: 2,
      }),
    ).toMatchObject({
      showTabs: true,
      activeTab: "steam",
      showImportCta: false,
      panel: "games",
    });
  });

  it("shows a search miss after Steam games have been imported", () => {
    expect(
      layout({
        steamGameCount: 2,
        requestedTab: "steam",
        visibleGameCount: 0,
      }).panel,
    ).toBe("no-search-results");
  });

  it("prioritizes the Steam import callout over a stale search", () => {
    expect(layout({ requestedTab: "steam", visibleGameCount: 0 }).panel).toBe(
      "steam-empty",
    );
  });

  it("renders the game library on the regular path", () => {
    expect(layout().panel).toBe("games");
  });
});
