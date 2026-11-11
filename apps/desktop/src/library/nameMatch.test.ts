import { describe, expect, it } from "vitest";
import type { GameMetadata } from "../store";
import { nameMatch } from "./nameMatch";

// docs/name-auto-match-plan.md: a launcher title is matched by name when
// exactly one suggestion has the same name, compared without ™ ® © ℠, extra
// spaces, case, and with ’ read as '. Nothing else is loosened.

function game(id: number, name: string): GameMetadata {
  return { id, igdbId: id, name, coverUrl: "", source: "igdb" };
}

describe("a match by name", () => {
  it("ignores ® and ™ in the launcher's title", () => {
    const rocketLeague = game(1, "Rocket League");
    expect(
      nameMatch("Rocket League®", [
        rocketLeague,
        game(2, "Rocket League Sideswipe"),
      ]),
    ).toBe(rocketLeague);
    const forza = game(3, "Forza Horizon 5");
    expect(nameMatch("Forza  Horizon 5™ ", [forza])).toBe(forza);
  });

  it("ignores case", () => {
    const eternal = game(1, "Doom Eternal");
    expect(nameMatch("DOOM Eternal", [eternal, game(2, "Doom")])).toBe(eternal);
  });

  it("reads a curly apostrophe as a straight one", () => {
    const valhalla = game(1, "Assassin's Creed Valhalla");
    expect(nameMatch("Assassin’s Creed Valhalla", [valhalla])).toBe(valhalla);
  });

  it("is none when two suggestions have that name", () => {
    expect(
      nameMatch("DOOM", [game(1, "DOOM"), game(2, "Doom"), game(3, "Doom II")]),
    ).toBeNull();
  });

  it("is none when only punctuation differs", () => {
    expect(
      nameMatch("Tom Clancy's Rainbow Six: Siege", [
        game(1, "Tom Clancy's Rainbow Six Siege"),
      ]),
    ).toBeNull();
  });

  it("is none without suggestions or a title", () => {
    expect(nameMatch("Halo Infinite", [])).toBeNull();
    expect(nameMatch(undefined, [game(1, "Halo Infinite")])).toBeNull();
  });
});
