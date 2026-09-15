import { usePersonalLibraryState } from "./PersonalLibraryContext";
import { useMemo } from "react";
import { getGameJournal, type GameIdentityRef } from "../store";

export function useGameJournal(game: GameIdentityRef) {
  const gameJournals = usePersonalLibraryState((s) => s.gameJournals);
  const gameMetadata = usePersonalLibraryState((s) => s.gameMetadata);
  const exeCache = usePersonalLibraryState((s) => s.exeCache);
  const libraryImports = usePersonalLibraryState((s) => s.libraryImports);
  return useMemo(
    () =>
      getGameJournal(
        { gameJournals, gameMetadata, exeCache, libraryImports },
        game,
      ),
    [
      gameJournals,
      gameMetadata,
      exeCache,
      libraryImports,
      game.gameId,
      game.source,
      game.igdbId,
      game.gameName,
      game.coverUrl,
    ],
  );
}
