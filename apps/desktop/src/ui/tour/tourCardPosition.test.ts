import { describe, expect, it } from "vitest";
import { tourCardPosition } from "./tourCardPosition";

describe("tour card position", () => {
  it("moves a tall card upward instead of constraining its height", () => {
    const position = tourCardPosition(
      { top: 500, left: 300, width: 600, height: 100 },
      undefined,
      420,
      { width: 1_200, height: 700 },
    );

    expect(position.top).toBe(264);
    expect(position).not.toHaveProperty("maxHeight");
  });

  it("keeps a card below its target when the full card fits", () => {
    expect(
      tourCardPosition(
        { top: 100, left: 300, width: 500, height: 120 },
        "below",
        300,
        { width: 1_200, height: 700 },
      ).top,
    ).toBe(236);
  });
});
