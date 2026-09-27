import { describe, expect, it } from "vitest";
import {
  isLeftmostVisualItem,
  nextControllerIndex,
  type ControllerItemRect,
} from "./controllerInput";

const grid: ControllerItemRect[] = [
  { left: 0, top: 0, width: 20, height: 20 },
  { left: 100, top: 0, width: 20, height: 20 },
  { left: 0, top: 100, width: 20, height: 20 },
  { left: 100, top: 100, width: 20, height: 20 },
];

describe("controller grid navigation", () => {
  it("moves geometrically through a card grid", () => {
    expect(nextControllerIndex(grid, 0, "right")).toBe(1);
    expect(nextControllerIndex(grid, 0, "down")).toBe(2);
    expect(nextControllerIndex(grid, 3, "left")).toBe(2);
    expect(nextControllerIndex(grid, 3, "up")).toBe(1);
  });

  it("continues across row edges in library order", () => {
    expect(nextControllerIndex(grid, 0, "left")).toBe(0);
    expect(nextControllerIndex(grid, 1, "right")).toBe(2);
    expect(nextControllerIndex(grid, 2, "left")).toBe(1);
    expect(nextControllerIndex(grid, 3, "right")).toBe(3);
  });

  it("selects the first item when focus is absent", () => {
    expect(nextControllerIndex(grid, -1, "down")).toBe(0);
    expect(nextControllerIndex([], -1, "right")).toBe(-1);
  });

  it("ignores controls that are far outside the intended direction", () => {
    const cardsAndHeader = [
      { left: 420, top: 20, width: 30, height: 30 },
      { left: 100, top: 500, width: 100, height: 140 },
      { left: 220, top: 500, width: 100, height: 140 },
      { left: 100, top: 660, width: 100, height: 140 },
    ];
    expect(nextControllerIndex(cardsAndHeader, 2, "right")).toBe(3);
  });

  it("recognizes left-edge card boundaries", () => {
    expect(isLeftmostVisualItem(grid, 0)).toBe(true);
    expect(isLeftmostVisualItem(grid, 1)).toBe(false);
    expect(isLeftmostVisualItem(grid, 2)).toBe(true);
  });
});
