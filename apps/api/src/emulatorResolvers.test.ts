import { describe, expect, it } from "vitest";
import {
  emulatorResolverFor,
  supportsEmulatorContent,
} from "./emulatorResolvers.js";

describe("emulator resolver registry", () => {
  it("defines DOSBox and Dolphin guest platforms", () => {
    expect(emulatorResolverFor("DOSBOX")?.igdbPlatformIds).toEqual([13]);
    expect(emulatorResolverFor("dolphin")?.igdbPlatformIds).toEqual([5, 21]);
  });

  it("validates content kinds per emulator", () => {
    expect(supportsEmulatorContent("dosbox", "program")).toBe(true);
    expect(supportsEmulatorContent("dosbox", "rom")).toBe(false);
    expect(supportsEmulatorContent("dolphin", "rom")).toBe(true);
    expect(supportsEmulatorContent("dolphin", "program")).toBe(false);
  });

  it("derives human search queries without changing stored identity", () => {
    expect(
      emulatorResolverFor("dolphin")?.deriveSearchQuery(
        "the-legend-of-zelda-wind-waker (disc 1).rvz",
      ),
    ).toBe("the legend of zelda wind waker");
    expect(
      emulatorResolverFor("dolphin")?.deriveSearchQuery("0001000148415858"),
    ).toBeNull();
    expect(
      emulatorResolverFor("dolphin")?.deriveSearchQuery("g4op69"),
    ).toBeNull();
    expect(
      emulatorResolverFor("dolphin")?.deriveSearchQuery(
        "g4op69",
        "The Sims 2: Pets",
      ),
    ).toBe("The Sims 2: Pets");
  });
});
