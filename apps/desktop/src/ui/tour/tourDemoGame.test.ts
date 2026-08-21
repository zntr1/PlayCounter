import { describe, expect, it } from "vitest";
import { isShareableEmulatorMapping } from "../../emulators/share";
import {
  emulatorTourDemoActive,
  tourDemoEmulatorMapping,
  tourDemoEmulatorSession,
} from "./tourDemoGame";

describe("emulator tour demo", () => {
  it("is active only for the Dolphin emulator guide", () => {
    expect(emulatorTourDemoActive(null)).toBe(false);
    expect(emulatorTourDemoActive("core")).toBe(false);
    expect(emulatorTourDemoActive("emulators")).toBe(true);
    expect(emulatorTourDemoActive("emulators", "dolphin")).toBe(true);
    expect(emulatorTourDemoActive("emulators", "dosbox")).toBe(false);
  });

  it("uses non-persistable identities", () => {
    const mapping = tourDemoEmulatorMapping();
    const session = tourDemoEmulatorSession("2026-08-21T08:00:00.000Z");

    expect(mapping.gameId).toBeLessThan(0);
    expect(mapping.igdbId).toBeUndefined();
    expect(mapping.contentKey).toMatch(/^playcounter-tour:/);
    expect(mapping.decision).toBe("game");
    expect(mapping.needsConfirmation).toBe(true);
    expect(mapping.coverUrl).toBe(
      "https://images.igdb.com/igdb/image/upload/t_cover_big/co3ohz.webp",
    );
    expect(session.id).toBeLessThan(0);
    expect(session.igdbId).toBeUndefined();
    expect(
      isShareableEmulatorMapping(mapping, {
        privateTokens: [],
        privacyReady: true,
      }),
    ).toBe(false);
  });
});
