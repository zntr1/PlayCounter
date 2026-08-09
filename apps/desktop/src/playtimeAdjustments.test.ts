import { describe, expect, it } from "vitest";
import {
  adjustmentSecondsFor,
  displayTotalSeconds,
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
});
