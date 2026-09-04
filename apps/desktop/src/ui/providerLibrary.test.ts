import { describe, expect, it } from "vitest";
import {
  libraryProviders,
  trackingUnavailableMessage,
} from "./providerLibrary";

const steamEntry = (externalId: string, installed: boolean) => ({
  provider: "steam" as const,
  externalId,
  installed,
});

describe("provider library", () => {
  it("shows one provider badge when multiple provider entries map to one game", () => {
    expect(
      libraryProviders([steamEntry("100", true), steamEntry("101", false)]),
    ).toEqual(["steam"]);
  });

  it("uses the imported provider in missing-executable warnings", () => {
    expect(trackingUnavailableMessage(["xbox"], false)).toBe(
      "Xbox playtime is already imported, but PlayCounter does not know this game's file name yet. Install the game and run it once so PlayCounter can find it.",
    );
    expect(trackingUnavailableMessage(["steam"], true)).toContain(
      "Steam playtime is already imported",
    );
    expect(trackingUnavailableMessage(["steam"], true)).toContain(
      "Use Check for Matches",
    );
  });
});
