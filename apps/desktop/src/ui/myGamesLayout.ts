import type { LibraryTabDescriptor, LibraryTabId } from "./libraryTabs";
import { resolveLibraryTab } from "./libraryTabs";

export type MyGamesPanel =
  | "empty-library"
  | "provider-empty"
  | "unimported-empty"
  | "no-search-results"
  | "games";

export type MyGamesLayout = {
  showTabs: boolean;
  activeTab: LibraryTabId;
  showImportCta: boolean;
  panel: MyGamesPanel;
};

export function myGamesLayout(input: {
  libraryGameCount: number;
  tabs: readonly LibraryTabDescriptor[];
  requestedTab: LibraryTabId;
  activeTabGameCount: number;
  visibleGameCount: number;
  importSupported: boolean;
}): MyGamesLayout {
  const activeTab = resolveLibraryTab(input.requestedTab, input.tabs);
  const activeTabKind = input.tabs.find((tab) => tab.id === activeTab)?.kind;
  const panel: MyGamesPanel =
    input.libraryGameCount === 0
      ? "empty-library"
      : activeTabKind === "provider" && input.activeTabGameCount === 0
        ? "provider-empty"
        : activeTabKind === "unimported" && input.activeTabGameCount === 0
          ? "unimported-empty"
          : input.visibleGameCount === 0
            ? "no-search-results"
            : "games";

  return {
    showTabs: input.libraryGameCount > 0 && input.tabs.length > 0,
    activeTab,
    showImportCta: input.importSupported,
    panel,
  };
}
