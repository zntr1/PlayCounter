import { beforeEach, describe, expect, it } from "vitest";
import { assignGameColors, resetGameColors } from "./gameColors";

/* Plan: docs/history-ranges-plan.md, sentences 20–21. */
beforeEach(resetGameColors);

describe("game colours in the stacked chart", () => {
  it("colours the range's most played games in rank order, six at most", () => {
    expect([...assignGameColors(["a", "b", "c"])]).toEqual([
      ["a", 0],
      ["b", 1],
      ["c", 2],
    ]);
    expect(assignGameColors(["a", "b", "c", "d", "e", "f", "g"]).size).toBe(6);
  });

  it("keeps a game's colour when the range changes", () => {
    assignGameColors(["witcher", "hades", "balatro"]);
    const october = assignGameColors(["hades", "witcher", "rocket"]);
    expect(october.get("witcher")).toBe(0);
    expect(october.get("hades")).toBe(1);
    expect(october.get("rocket")).toBe(2);
    const later = assignGameColors(["balatro", "witcher"]);
    expect(later.get("witcher")).toBe(0);
    expect(later.get("balatro")).toBe(2);
  });

  it("never gives two games in one chart the same colour", () => {
    assignGameColors(["a", "b"]);
    assignGameColors(["c"]);
    const both = assignGameColors(["c", "a"]);
    expect(both.get("c")).toBe(0);
    expect(new Set(both.values()).size).toBe(2);
  });
});
