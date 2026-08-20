import type { Game } from "@playcounter/shared";
import { describe, expect, it } from "vitest";
import {
  initialMatchSelection,
  isSameGame,
  sortMatchCandidates,
} from "./matchCheckModel";

function game(id: number, source: Game["source"]): Game {
  return { id, source, name: `${source} ${id}`, coverUrl: "" };
}

describe("match check model", () => {
  it("orders community before IGDB before custom and stays stable", () => {
    const input = [
      game(1, "custom"),
      game(2, "igdb"),
      game(3, "community"),
      game(4, "igdb"),
    ];
    expect(sortMatchCandidates(input).map(({ id }) => id)).toEqual([
      3, 2, 4, 1,
    ]);
  });

  it("preselects only one non-current result", () => {
    const candidate = game(2, "igdb");
    expect(
      initialMatchSelection([candidate], { gameId: 1, source: "igdb" }),
    ).toBe(candidate);
    expect(
      initialMatchSelection([candidate], { gameId: 2, source: "igdb" }),
    ).toBeNull();
    expect(
      initialMatchSelection([candidate, game(3, "igdb")], {
        gameId: 1,
        source: "igdb",
      }),
    ).toBeNull();
  });

  it("treats the same id from different sources as different games", () => {
    expect(isSameGame(game(1, "igdb"), game(1, "community"))).toBe(false);
  });
});
