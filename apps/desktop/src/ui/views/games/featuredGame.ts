import type { GameSource, LibraryFeaturedGame } from "@playcounter/shared";

/* Which game the library banner shows. A pinned game wins when it is still in
   the library; otherwise the most recently played one, and in a library that
   has never been played, the most recently added. */

export type FeaturableGame = {
  igdbId?: number;
  aliases: ReadonlyArray<{ gameId: number; source: GameSource | null }>;
  lastPlayedAt: string;
  hasLastPlayedEvidence?: boolean;
  sessionCount: number;
};

export function matchesFeaturedGame(
  game: FeaturableGame,
  featured: LibraryFeaturedGame,
) {
  if (featured.igdbId !== undefined && game.igdbId === featured.igdbId) {
    return true;
  }
  return game.aliases.some(
    (alias) =>
      alias.gameId === featured.gameId && alias.source === featured.source,
  );
}

export function pickFeaturedGame<T extends FeaturableGame>(
  games: readonly T[],
  featured: LibraryFeaturedGame | null | undefined,
): { game: T; pinned: boolean } | null {
  if (featured) {
    const pinned = games.find((game) => matchesFeaturedGame(game, featured));
    if (pinned) return { game: pinned, pinned: true };
  }
  const played = games.filter(
    (game) => game.hasLastPlayedEvidence || game.sessionCount > 0,
  );
  const latest = newest(played.length > 0 ? played : games);
  return latest ? { game: latest, pinned: false } : null;
}

function newest<T extends FeaturableGame>(games: readonly T[]) {
  let best: T | undefined;
  let bestTime = Number.NEGATIVE_INFINITY;
  for (const game of games) {
    const time = Date.parse(game.lastPlayedAt);
    if (Number.isNaN(time)) continue;
    if (time > bestTime) {
      best = game;
      bestTime = time;
    }
  }
  return best ?? games[0];
}
