import { describe, expect, it } from "vitest";
import { steamContextActions } from "./gameLibraryActions";

describe("Steam game context actions", () => {
  it("keeps Open in Steam available when direct launching is disabled", () => {
    expect(
      steamContextActions({
        demo: false,
        isWindows: true,
        launcherEnabled: false,
        hasImport: true,
        installed: true,
      }),
    ).toEqual({ showOpenInSteam: true, showPlayInSteam: false });
  });

  it("offers Play in Steam only for installed games with launching enabled", () => {
    expect(
      steamContextActions({
        demo: false,
        isWindows: true,
        launcherEnabled: true,
        hasImport: true,
        installed: true,
      }),
    ).toEqual({ showOpenInSteam: true, showPlayInSteam: true });

    expect(
      steamContextActions({
        demo: false,
        isWindows: true,
        launcherEnabled: true,
        hasImport: true,
        installed: false,
      }).showPlayInSteam,
    ).toBe(false);
  });

  it("hides unsupported and tutorial Steam actions", () => {
    expect(
      steamContextActions({
        demo: false,
        isWindows: false,
        launcherEnabled: true,
        hasImport: true,
        installed: true,
      }).showOpenInSteam,
    ).toBe(false);
    expect(
      steamContextActions({
        demo: true,
        isWindows: true,
        launcherEnabled: true,
        hasImport: true,
        installed: true,
      }).showOpenInSteam,
    ).toBe(false);
  });
});
