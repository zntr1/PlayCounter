import { describe, expect, it } from "vitest";
import { shouldShowBackToTop } from "./backToTop";

describe("back to top visibility", () => {
  it("stays hidden near the top of the list", () => {
    expect(shouldShowBackToTop(0, 800)).toBe(false);
    expect(shouldShowBackToTop(1200, 800)).toBe(false);
  });

  it("appears once the user scrolled far", () => {
    expect(shouldShowBackToTop(1201, 800)).toBe(true);
  });

  it("stays hidden while the view has no measured height", () => {
    expect(shouldShowBackToTop(5000, 0)).toBe(false);
  });
});
