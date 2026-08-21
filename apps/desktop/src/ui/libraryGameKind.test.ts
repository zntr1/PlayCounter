import { describe, expect, it } from "vitest";
import { isTourDemoLibraryGame } from "./libraryGameKind";

describe("library game kind", () => {
  it("does not mistake a negative-id tracked custom game for a tour demo", () => {
    expect(
      isTourDemoLibraryGame({
        kind: "tracked",
        gameId: -1_234_567_890,
      }),
    ).toBe(false);
  });

  it("recognizes a tour demo independently of its id", () => {
    expect(
      isTourDemoLibraryGame({
        kind: "tour-demo",
        gameId: 42,
      }),
    ).toBe(true);
  });
});
