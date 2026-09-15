import { describe, expect, it } from "vitest";
import {
  INITIAL_LIBRARY_RENDER_COUNT,
  nextLibraryRenderLimit,
} from "./libraryRenderWindow";

describe("library render window", () => {
  it("adds games in bounded batches", () => {
    expect(nextLibraryRenderLimit(INITIAL_LIBRARY_RENDER_COUNT, 200)).toBe(24);
    expect(nextLibraryRenderLimit(192, 200)).toBe(200);
  });

  it("does not exceed an empty or negative total", () => {
    expect(nextLibraryRenderLimit(36, 0)).toBe(0);
    expect(nextLibraryRenderLimit(36, -1)).toBe(0);
  });
});
