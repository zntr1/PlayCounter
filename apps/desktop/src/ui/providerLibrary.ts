import type { GameSource, LibraryProviderId } from "@playcounter/shared";
import { providerFloorKey } from "../library/playtimeFloor";

type ProviderLibraryImport = {
  provider: LibraryProviderId;
  externalId: string;
  installed: boolean;
  entry?: { providerSeconds: number | null };
};

export type ProviderLibraryGame = {
  gameId: number;
  igdbId?: number;
  source: GameSource | null;
  libraryImports: ProviderLibraryImport[];
};

export type ProviderLibrarySummary = {
  gameCount: number;
  entryCount: number;
  providerSeconds: number;
  playedCount: number;
  installedCount: number;
};

export function hasProviderImport(
  game: ProviderLibraryGame,
  provider: LibraryProviderId,
) {
  return game.libraryImports.some((entry) => entry.provider === provider);
}

export function libraryProviders(
  imports: readonly { provider: LibraryProviderId }[],
) {
  return [...new Set(imports.map((entry) => entry.provider))];
}
export function trackingUnavailableMessage(
  providers: readonly LibraryProviderId[],
  canCheckMatches: boolean,
) {
  const source =
    providers.length === 1
      ? `${providers[0] === "xbox" ? "Xbox" : "Steam"} playtime`
      : "Imported playtime";
  return canCheckMatches
    ? `${source} is already imported, but PlayCounter does not know this game's file name yet. Use Check for Matches, or install the game and run it once so PlayCounter can find it.`
    : `${source} is already imported, but PlayCounter does not know this game's file name yet. Install the game and run it once so PlayCounter can find it.`;
}

export function hasUnknownProviderPlaytime(
  imports: readonly ProviderLibraryImport[],
  provider: LibraryProviderId,
) {
  return imports.some(
    (entry) =>
      entry.provider === provider && entry.entry?.providerSeconds === null,
  );
}

export function summarizeProviderLibrary(
  games: readonly ProviderLibraryGame[],
  provider: LibraryProviderId,
  providerFloorSeconds: Readonly<Record<string, number>>,
): ProviderLibrarySummary {
  const summary: ProviderLibrarySummary = {
    gameCount: 0,
    entryCount: 0,
    providerSeconds: 0,
    playedCount: 0,
    installedCount: 0,
  };

  for (const game of games) {
    const providerEntries = game.libraryImports.filter(
      (entry) => entry.provider === provider,
    );
    if (providerEntries.length === 0) continue;

    const rawSeconds = providerFloorSeconds[providerFloorKey(game)] ?? 0;
    const seconds = Number.isFinite(rawSeconds)
      ? Math.max(0, Math.round(rawSeconds))
      : 0;
    summary.gameCount += 1;
    summary.entryCount += providerEntries.length;
    summary.providerSeconds += seconds;
    if (seconds > 0 || hasUnknownProviderPlaytime(providerEntries, provider)) {
      summary.playedCount += 1;
    }
    if (providerEntries.some((entry) => entry.installed)) {
      summary.installedCount += 1;
    }
  }

  return summary;
}
