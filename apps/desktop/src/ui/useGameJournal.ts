import { useMemo } from "react";
import { getGameJournal, useAppStore, type GameIdentityRef } from "../store";

export function useGameJournal(game: GameIdentityRef) {
  const gameJournals = useAppStore((s) => s.gameJournals);
  const gameMetadata = useAppStore((s) => s.gameMetadata);
  const exeCache = useAppStore((s) => s.exeCache);
  const libraryImports = useAppStore((s) => s.libraryImports);
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
