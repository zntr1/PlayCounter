import { describe, expect, it } from "vitest";
import { myGamesLayout } from "./myGamesLayout";
import type { LibraryTabDescriptor } from "./libraryTabs";

const tabs: LibraryTabDescriptor[] = [
  { id: "all", kind: "all", label: "All games", count: 3 },
  { id: "steam", kind: "provider", label: "Steam", count: 0 },
  {
    id: "unimported",
    kind: "unimported",
    label: "Not imported",
    count: 3,
  },
];

function layout(overrides: Partial<Parameters<typeof myGamesLayout>[0]> = {}) {
  return myGamesLayout({
    libraryGameCount: 3,
    tabs,
    requestedTab: "all",
    activeTabGameCount: 3,
    visibleGameCount: 3,
    importSupported: true,
    ...overrides,
  });
}

describe("My Games layout", () => {
  it("offers import in an otherwise empty supported library", () => {
    expect(
      layout({
        libraryGameCount: 0,
        activeTabGameCount: 0,
        visibleGameCount: 0,
      }),
    ).toEqual({
      showTabs: false,
      activeTab: "all",
      showImportCta: true,
      panel: "empty-library",
    });
  });

  it("keeps an empty unsupported library neutral", () => {
    expect(
      layout({
        libraryGameCount: 0,
        tabs: [],
        activeTabGameCount: 0,
        visibleGameCount: 0,
        importSupported: false,
      }),
    ).toMatchObject({
      showTabs: false,
      activeTab: "all",
      showImportCta: false,
      panel: "empty-library",
    });
  });

  it("keeps an empty provider tab selected ahead of a stale search", () => {
    expect(
      layout({
        requestedTab: "steam",
        activeTabGameCount: 0,
        visibleGameCount: 0,
      }),
    ).toEqual({
      showTabs: true,
      activeTab: "steam",
      showImportCta: true,
      panel: "provider-empty",
    });
  });

  it("shows a dedicated empty Not imported panel", () => {
    expect(
      layout({
        requestedTab: "unimported",
        activeTabGameCount: 0,
        visibleGameCount: 0,
      }).panel,
    ).toBe("unimported-empty");
  });

  it("falls back from a provider tab that is not visible", () => {
    const result = layout({
      tabs: [],
      requestedTab: "steam",
      importSupported: false,
    });
    expect(result.activeTab).toBe("all");
    expect(result.panel).toBe("games");
  });

  it("shows restored provider games without an import action", () => {
    expect(
      layout({
        requestedTab: "steam",
        activeTabGameCount: 2,
        visibleGameCount: 2,
        importSupported: false,
      }),
    ).toMatchObject({
      showTabs: true,
      activeTab: "steam",
      showImportCta: false,
      panel: "games",
    });
  });

  it("shows a search miss after the active tab has games", () => {
    expect(
      layout({
        requestedTab: "unimported",
        activeTabGameCount: 2,
        visibleGameCount: 0,
      }).panel,
    ).toBe("no-search-results");
  });

  it("renders the game library on the regular path", () => {
    expect(layout().panel).toBe("games");
  });
});
