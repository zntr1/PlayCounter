import { describe, expect, it } from "vitest";
import {
  adjustmentSecondsFor,
  displayTotalSeconds,
  effectiveTotalSeconds,
  nextAdjustmentSeconds,
} from "./playtimeAdjustments";

describe("playtime adjustments", () => {
  it("sets an offset relative to recorded time", () => {
    expect(nextAdjustmentSeconds(7200, 3600)).toBe(-3600);
    expect(nextAdjustmentSeconds(0, 3600)).toBe(3600);
  });

  it("deduplicates alias keys and clamps displayed totals", () => {
    expect(
      adjustmentSecondsFor({ "community:7": -500, "igdb:8": 100 }, [
        "community:7",
        "community:7",
        "igdb:8",
      ]),
    ).toBe(-400);
    expect(displayTotalSeconds(300, -500)).toBe(0);
  });

  it("takes the higher of PlayCounter and launcher time, then the adjustment on top", () => {
    expect(effectiveTotalSeconds(300, -100, 500)).toBe(400);
    expect(effectiveTotalSeconds(700, -100, 500)).toBe(600);
    expect(effectiveTotalSeconds(900, 50, 500)).toBe(950);
    expect(effectiveTotalSeconds(300, 0, 500, 200)).toBe(700);
    expect(effectiveTotalSeconds(300, -900, 500)).toBe(0);
  });
});
