import { describe, expect, it } from "vitest";
import { libraryContextActions } from "./gameLibraryActions";

describe("game library context actions", () => {
  it("keeps Open in Steam available when direct launching is disabled", () => {
    expect(
      libraryContextActions({
        demo: false,
        isWindows: true,
        launcherEnabled: false,
        hasImport: true,
        installed: true,
      }),
    ).toEqual({ showOpenInLauncher: true, showPlayInLauncher: false });
  });

  it("offers Play in Steam only for installed games with launching enabled", () => {
    expect(
      libraryContextActions({
        demo: false,
        isWindows: true,
        launcherEnabled: true,
        hasImport: true,
        installed: true,
      }),
    ).toEqual({ showOpenInLauncher: true, showPlayInLauncher: true });

    expect(
      libraryContextActions({
        demo: false,
        isWindows: true,
        launcherEnabled: true,
        hasImport: true,
        installed: false,
      }).showPlayInLauncher,
    ).toBe(false);
  });

  it("hides unsupported and tutorial Steam actions", () => {
    expect(
      libraryContextActions({
        demo: false,
        isWindows: false,
        launcherEnabled: true,
        hasImport: true,
        installed: true,
      }).showOpenInLauncher,
    ).toBe(false);
    expect(
      libraryContextActions({
        demo: true,
        isWindows: true,
        launcherEnabled: true,
        hasImport: true,
        installed: true,
      }).showOpenInLauncher,
    ).toBe(false);
  });
});
