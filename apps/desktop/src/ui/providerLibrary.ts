import { LIBRARY_PROVIDER_LABELS } from "@playcounter/shared";
import type { GameSource, LibraryProviderId } from "@playcounter/shared";
import { providerFloorKey } from "../library/playtimeFloor";
import { getT } from "../i18n";

const t = getT("myGames");

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
  if (providers.length === 0) {
    return t(
      "PlayCounter does not know this game's file name yet. Run the game once so PlayCounter can find it, then check Discovered if it needs a match.",
    );
  }
  if (providers.length === 1 && providers[0] === "battlenet") {
    return canCheckMatches
      ? t(
          "This game is imported from Battle.net. Use Check for Matches to link its game file for future tracking.",
        )
      : t(
          "This game is imported from Battle.net. Run it once so PlayCounter can identify its game file.",
        );
  }
  const source =
    providers.length === 1
      ? t("{{provider}} playtime", {
          provider: LIBRARY_PROVIDER_LABELS[providers[0]],
        })
      : t("Imported playtime");
  return canCheckMatches
    ? t(
        "{{source}} is already imported, but PlayCounter does not know this game's file name yet. Use Check for Matches, or install the game and run it once so PlayCounter can find it.",
        { source },
      )
    : t(
        "{{source}} is already imported, but PlayCounter does not know this game's file name yet. Install the game and run it once so PlayCounter can find it.",
        { source },
      );
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
