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

export function visibleLibraryTabs(input: {
  allTabCount: number;
  unimportedGameCount: number;
  providers: readonly ProviderTabInput[];
}): LibraryTabDescriptor[] {
  const providers = input.providers.filter(providerTabVisible);
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

export type UnimportedLibraryGame = ProviderLibraryGame & {
  totalSeconds: number;
  emulatorIds: readonly string[];
};

export type UnimportedLibrarySummary = {
  gameCount: number;
  trackedSeconds: number;
  playedCount: number;
  emulatorCount: number;
};

function normalizedSeconds(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

export function summarizeUnimportedLibrary(
  games: readonly UnimportedLibraryGame[],
): UnimportedLibrarySummary {
  const summary: UnimportedLibrarySummary = {
    gameCount: 0,
    trackedSeconds: 0,
    playedCount: 0,
    emulatorCount: 0,
  };

  for (const game of games) {
    if (!isUnimportedGame(game)) continue;
    const seconds = normalizedSeconds(game.totalSeconds);
    summary.gameCount += 1;
    summary.trackedSeconds += seconds;
    if (seconds > 0) summary.playedCount += 1;
    if (game.emulatorIds.length > 0) summary.emulatorCount += 1;
  }

  return summary;
}
