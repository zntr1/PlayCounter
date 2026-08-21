export type LibraryGameKind = "tracked" | "tour-demo";

export function isTourDemoLibraryGame(game: {
  kind: LibraryGameKind;
  gameId: number;
}) {
  // Local custom games also use negative ids, so provenance—not id sign—must
  // decide whether library actions should use the non-persistent tour path.
  return game.kind === "tour-demo";
}
