import { describe, expect, it } from "vitest";
import {
  libraryLaunchErrorMessage,
  shouldForgetLibraryInstallOnLaunchError,
} from "./launchErrors";

describe("library launch errors", () => {
  it("reads the message of a structured launch error instead of stringifying it", () => {
    expect(
      libraryLaunchErrorMessage(
        {
          kind: "spawnFailed",
          message: "Could not start Xbox game: 0x80073D54",
        },
        "Yakuza 0",
        "Xbox",
      ),
    ).toEqual({
      title: "Could not start Yakuza 0",
      detail: "Could not start Xbox game: 0x80073D54",
    });
  });

  it("explains a missing installation and forgets the stored install", () => {
    const error = {
      kind: "notFound",
      message: "The local Xbox game registration could not be found.",
    };

    expect(libraryLaunchErrorMessage(error, "Yakuza 0", "Xbox")).toEqual({
      title: "Yakuza 0 is not installed",
      detail:
        "Windows no longer has this Xbox game installed. Install it again in Xbox to start it from PlayCounter.",
    });
    expect(shouldForgetLibraryInstallOnLaunchError(error)).toBe(true);
  });

  it("keeps the stored install for failures that do not prove removal", () => {
    expect(
      shouldForgetLibraryInstallOnLaunchError({
        kind: "spawnFailed",
        message: "Denied",
      }),
    ).toBe(false);
    expect(shouldForgetLibraryInstallOnLaunchError(new Error("Denied"))).toBe(
      false,
    );
  });

  it("handles serialized and plain errors", () => {
    expect(
      libraryLaunchErrorMessage(
        JSON.stringify({ kind: "notFound", message: "Gone" }),
        "Halo",
        "Xbox",
      ).title,
    ).toBe("Halo is not installed");
    expect(
      libraryLaunchErrorMessage(new Error("Steam is closed"), "Halo", "Steam"),
    ).toEqual({
      title: "Could not start Halo",
      detail: "Steam is closed",
    });
  });
});
