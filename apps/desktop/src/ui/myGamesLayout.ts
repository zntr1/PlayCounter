import type { ProviderLibraryTab } from "./providerLibrary";

export type MyGamesPanel =
  | "empty-library"
  | "steam-empty"
  | "no-search-results"
  | "games";

export type MyGamesLayout = {
  showTabs: boolean;
  activeTab: ProviderLibraryTab;
  showImportCta: boolean;
  panel: MyGamesPanel;
};

export function showSteamLibraryTab(input: {
  steamGameCount: number;
  steamImportSupported: boolean;
}) {
  return input.steamImportSupported || input.steamGameCount > 0;
}

export function resolveLibraryTab(
  requestedTab: ProviderLibraryTab,
  showSteamTab: boolean,
): ProviderLibraryTab {
  return requestedTab === "steam" && !showSteamTab ? "all" : requestedTab;
}

export function myGamesLayout(input: {
  libraryGameCount: number;
  steamGameCount: number;
  steamImportSupported: boolean;
  requestedTab: ProviderLibraryTab;
  visibleGameCount: number;
}): MyGamesLayout {
  const showSteamTab = showSteamLibraryTab(input);
  const activeTab = resolveLibraryTab(input.requestedTab, showSteamTab);
  const panel: MyGamesPanel =
    input.libraryGameCount === 0
      ? "empty-library"
      : activeTab === "steam" && input.steamGameCount === 0
        ? "steam-empty"
        : input.visibleGameCount === 0
          ? "no-search-results"
          : "games";

  return {
    showTabs: input.libraryGameCount > 0 && showSteamTab,
    activeTab,
    showImportCta: input.steamImportSupported,
    panel,
  };
}
