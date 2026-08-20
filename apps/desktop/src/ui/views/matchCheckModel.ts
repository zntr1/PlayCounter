import type { Game, GameSource } from "@playcounter/shared";

type GameIdentity = { id: number; source?: GameSource | null };

export function matchCandidatePriority(game: Game) {
  if (game.source === "community") return 0;
  if (game.source === "igdb") return 1;
  return 2;
}

export function sortMatchCandidates(games: readonly Game[]) {
  return games
    .map((game, index) => ({ game, index }))
    .sort(
      (left, right) =>
        matchCandidatePriority(left.game) -
          matchCandidatePriority(right.game) || left.index - right.index,
    )
    .map(({ game }) => game);
}

export function isSameGame(a: GameIdentity, b: GameIdentity) {
  return a.id === b.id && a.source === b.source;
}

export function initialMatchSelection(
  games: readonly Game[],
  current: { gameId: number; source?: GameSource | null },
) {
  if (games.length !== 1) return null;
  return isSameGame(games[0], { id: current.gameId, source: current.source })
    ? null
    : games[0];
}
