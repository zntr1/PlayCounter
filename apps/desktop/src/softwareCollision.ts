import type { Game } from "@playcounter/shared";
import type { ExeDetails } from "./ui/exeDetails";

/* One executable that is known software and a game at once: Code.exe is
   Visual Studio Code and also the game Code:29. The file's own name for itself
   decides; when it names neither or both, the person does. */

export type CollisionDecision =
  | { kind: "tool" }
  | { kind: "game"; game: Game }
  | { kind: "unclear" };

/** Lowercase letters and digits only: "Visual Studio Code®" and
 *  "visual-studio code" compare equal. */
function comparable(name: string | undefined) {
  return (name ?? "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

export function decideCollision(
  details: ExeDetails | null,
  tool: Game,
  games: readonly Game[],
): CollisionDecision {
  const fileNames = new Set(
    [details?.productName, details?.fileDescription]
      .map(comparable)
      .filter(Boolean),
  );
  const named = (entry: Game) => fileNames.has(comparable(entry.name));
  const toolNamed = named(tool);
  const namedGames = games.filter(named);
  if (toolNamed && namedGames.length === 0) return { kind: "tool" };
  if (!toolNamed && namedGames.length === 1) {
    return { kind: "game", game: namedGames[0] };
  }
  return { kind: "unclear" };
}
