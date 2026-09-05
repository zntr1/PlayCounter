import type { LibraryProviderId } from "@playcounter/shared";
import { hasProviderImport, type ProviderLibraryGame } from "./providerLibrary";

export type LibraryTabId = "all" | LibraryProviderId | "unimported";
export type LibraryTabKind = "all" | "provider" | "unimported";

export type LibraryTabDescriptor = {
  id: LibraryTabId;
  kind: LibraryTabKind;
  label: string;
  count: number;
};

export type ProviderTabInput = {
  provider: LibraryProviderId;
  label: string;
  importSupported: boolean;
  gameCount: number;
};

export function isUnimportedGame(game: ProviderLibraryGame) {
  return game.libraryImports.length === 0;
}

export function filterByLibraryTab<T extends ProviderLibraryGame>(
  games: readonly T[],
  tab: LibraryTabId,
): T[] {
  if (tab === "all") return [...games];
  if (tab === "unimported") return games.filter(isUnimportedGame);
  return games.filter((game) => hasProviderImport(game, tab));
}

export function providerTabVisible(input: ProviderTabInput) {
  return input.importSupported || input.gameCount > 0;
}

/** True while a provider tab is on screen with nothing imported into it, so
 *  there is something for the hide toggle to act on. */
export function hasEmptyProviderTabs(
  providers: readonly ProviderTabInput[],
): boolean {
  return providers.some(
    (provider) => providerTabVisible(provider) && provider.gameCount === 0,
  );
}

export function visibleLibraryTabs(input: {
  allTabCount: number;
  unimportedGameCount: number;
  providers: readonly ProviderTabInput[];
  hideEmptyProviders?: boolean;
}): LibraryTabDescriptor[] {
  const providers = input.providers.filter(
    (provider) =>
      providerTabVisible(provider) &&
      (!input.hideEmptyProviders || provider.gameCount > 0),
  );
  // Without a provider tab there is nothing to switch between: All games and
  // PlayCounter would list the same games. Drop the whole strip instead of
  // leaving a dead tab behind.
  if (providers.length === 0) return [];

  return [
    { id: "all", kind: "all", label: "All games", count: input.allTabCount },
    {
      id: "unimported",
      kind: "unimported",
      label: "PlayCounter",
      count: input.unimportedGameCount,
    },
    ...providers.map<LibraryTabDescriptor>((provider) => ({
      id: provider.provider,
      kind: "provider",
      label: provider.label,
      count: provider.gameCount,
    })),
  ];
}

export function resolveLibraryTab(
  requested: LibraryTabId,
  tabs: readonly LibraryTabDescriptor[],
): LibraryTabId {
  return tabs.some((tab) => tab.id === requested) ? requested : "all";
}
