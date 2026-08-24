import { describe, expect, it } from "vitest";
import type { EmulatorMapping } from "./emulators/types";
import {
  emulatorTargetCompatibility,
  isValidEmulatorBinaryPath,
  isValidEmulatorContentPath,
  resolveEmulatorBinary,
  resolveEmulatorLaunchTarget,
} from "./emulatorLaunch";

function mapping(
  contentKind: EmulatorMapping["contentKind"],
  contentValue: string,
): EmulatorMapping {
  return {
    contentKey: `dolphin:${contentKind}:${contentValue}`,
    emulatorId: "dolphin",
    label: "Dolphin",
    contentKind,
    contentValue,
    display: contentValue,
    trust: "recognized",
    decision: "game",
    gameId: 42,
    confidence: "user",
    decidedAt: "2026-08-24T00:00:00.000Z",
    lastSeenAt: "2026-08-24T00:00:00.000Z",
  };
}

describe("emulator launch helpers", () => {
  it("accepts only a full Dolphin executable path", () => {
    expect(
      isValidEmulatorBinaryPath(
        "dolphin",
        String.raw`C:\Emulators\Dolphin.exe`,
      ),
    ).toBe(true);
    expect(
      isValidEmulatorBinaryPath(
        "dolphin",
        String.raw`C:\Emulators\DolphinTool.exe`,
      ),
    ).toBe(false);
    expect(isValidEmulatorBinaryPath("dolphin", "Dolphin.exe")).toBe(false);
    expect(
      isValidEmulatorBinaryPath(
        "dosbox",
        String.raw`C:\Emulators\DOSBox.exe`,
      ),
    ).toBe(false);
  });

  it("validates Dolphin content extensions through the adapter capability", () => {
    expect(
      isValidEmulatorContentPath(
        "dolphin",
        String.raw`D:\Games\The Sims 2.rvz`,
      ),
    ).toBe(true);
    expect(
      isValidEmulatorContentPath(
        "dolphin",
        String.raw`D:\Games\The Sims 2.sav`,
      ),
    ).toBe(false);
  });

  it("prefers manual binary and content overrides", () => {
    const automaticBinary = {
      emulatorId: "dolphin",
      exePath: String.raw`C:\Auto\Dolphin.exe`,
      setAt: "auto",
    };
    const manualBinary = {
      ...automaticBinary,
      exePath: String.raw`C:\Manual\Dolphin.exe`,
      setAt: "manual",
    };
    expect(
      resolveEmulatorBinary(
        "dolphin",
        new Map([["dolphin", automaticBinary]]),
        new Map([["dolphin", manualBinary]]),
      ),
    ).toBe(manualBinary);

    const automaticTarget = {
      contentKey: "dolphin:rom:the sims 2.rvz",
      emulatorId: "dolphin",
      filePath: String.raw`D:\Auto\The Sims 2.rvz`,
      setAt: "auto",
    };
    const manualTarget = {
      ...automaticTarget,
      filePath: String.raw`D:\Manual\The Sims 2.rvz`,
      setAt: "manual",
    };
    expect(
      resolveEmulatorLaunchTarget(
        automaticTarget.contentKey,
        new Map([[automaticTarget.contentKey, automaticTarget]]),
        new Map([[manualTarget.contentKey, manualTarget]]),
      ),
    ).toBe(manualTarget);
  });

  it("proves filename mappings and asks once for title-ID mappings", () => {
    expect(
      emulatorTargetCompatibility(
        mapping("rom", "the sims 2.rvz"),
        String.raw`D:\Games\The Sims 2.rvz`,
      ),
    ).toEqual({ valid: true, association: "proven" });
    expect(
      emulatorTargetCompatibility(
        mapping("rom", "the sims 2.rvz"),
        String.raw`D:\Games\Mario Kart Wii.rvz`,
      ),
    ).toEqual({ valid: false, reason: "content-name-mismatch" });
    expect(
      emulatorTargetCompatibility(
        mapping("title_id", "g4op69"),
        String.raw`D:\Games\The Sims 2 Pets.rvz`,
      ),
    ).toEqual({ valid: true, association: "requires_confirmation" });
  });
});
