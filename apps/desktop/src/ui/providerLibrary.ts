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
  imports: readonly {
    provider: LibraryProviderId;
    entry?: { providerSeconds: number | null };
  }[],
  provider: LibraryProviderId,
) {
  return imports.some(
    (entry) =>
      entry.provider === provider && entry.entry?.providerSeconds === null,
  );
}
