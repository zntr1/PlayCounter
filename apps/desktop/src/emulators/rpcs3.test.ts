import { describe, expect, it } from "vitest";
import type { EmulatorMapping } from "./types";
import { discoverRpcs3LaunchTarget, readRpcs3Title, rpcs3Adapter } from "./rpcs3";

const context = { denylist: new Set<string>(), privateTokens: ["philip"] };
const MAIN = "RPCS3 0.0.38-18000-a1b2c3d4 Alpha | master";
const DEMONS = "FPS: 59.94 | Vulkan | 0.0.38-18000 | Demon's Souls [BLUS30443]";
const HDD_EBOOT = String.raw`D:\RPCS3\dev_hdd0\game\BLUS30443\USRDIR\EBOOT.BIN`;
const DISC_EBOOT = String.raw`D:\PS3\Demon's Souls\PS3_GAME\USRDIR\EBOOT.BIN`;

function read(windowTitle: string | null, args: string[] = []) {
  return rpcs3Adapter.read(
    {
      emulatorId: "rpcs3",
      exeName: "rpcs3.exe",
      pid: 1,
      startedAtUnix: 1,
      args,
      windowTitle,
    },
    context,
  );
}

function mapping(contentValue: string, display: string): EmulatorMapping {
  return {
    contentKey: `rpcs3:title_id:${contentValue}`,
    emulatorId: "rpcs3",
    label: "RPCS3",
    contentKind: "title_id",
    contentValue,
    display,
    trust: "recognized",
    decision: "game",
    gameId: 1,
    confidence: "user",
    decidedAt: "2026-10-14T00:00:00Z",
    lastSeenAt: "2026-10-14T00:00:00Z",
  };
}

describe("RPCS3 window title", () => {
  it.each([
    [MAIN, { idle: true }],
    ["RPCS3 0.0.38-18000-a1b2c3d4 Alpha | master | local_build", { idle: true }],
    [DEMONS, { serial: "blus30443", name: "Demon's Souls" }],
    [
      "FPS: 30.00 | OpenGL | 0.0.38-18000 | Metal Gear Solid 4: Guns of the Patriots [BLES00246]",
      { serial: "bles00246", name: "Metal Gear Solid 4: Guns of the Patriots" },
    ],
    ["Journey [NPUA80069]", { serial: "npua80069", name: "Journey" }],
    ["FPS: 60.00 | Vulkan | Journey", null],
    ["Settings", null],
  ])("%s", (title, expected) => {
    expect(readRpcs3Title(title)).toEqual(expected);
  });
});

describe("RPCS3 adapter", () => {
  it("reads the main window and no title as idle", () => {
    expect(read(MAIN)).toEqual({ state: "idle" });
    expect(read(null, [HDD_EBOOT])).toEqual({ state: "idle" });
  });

  it("identifies a game by its serial with the name as shareable hint", () => {
    expect(read(DEMONS)).toEqual({
      state: "content",
      content: {
        kind: "title_id",
        value: "blus30443",
        display: "Demon's Souls",
        trust: "recognized",
        shareable: true,
        volatile: true,
        detectionSource: "window_title",
        searchHint: "Demon's Souls",
        shareableSearchHint: true,
      },
    });
  });

  it("follows the title, not stale start-up arguments", () => {
    const reading = read(
      "FPS: 60.00 | Vulkan | 0.0.38 | Journey [NPUA80069]",
      [HDD_EBOOT],
    );
    expect(reading.state === "content" && reading.content.value).toBe(
      "npua80069",
    );
  });

  it("reports a custom title format without the serial", () => {
    expect(read("FPS: 60.00 | Demon's Souls")).toEqual({
      state: "unidentified",
      reason: "title-not-parsable",
    });
  });
});

describe("RPCS3 launch target", () => {
  it.each([
    [[HDD_EBOOT]],
    [["--no-gui", HDD_EBOOT]],
    [["--config", String.raw`D:\cfg.yml`, DISC_EBOOT]],
    [[String.raw`D:\PS3\Demon's Souls [BLUS30443].iso`]],
  ])("uses %j while the title shows the same game", (args) => {
    expect(discoverRpcs3LaunchTarget({ args, windowTitle: DEMONS })).toEqual({
      target: { kind: "file", filePath: args.at(-1) },
      source: "launch_arguments",
    });
  });

  it.each([
    ["the main window", [HDD_EBOOT], MAIN],
    [
      "another installed game",
      [String.raw`D:\RPCS3\dev_hdd0\game\NPUA80069\USRDIR\EBOOT.BIN`],
      DEMONS,
    ],
    ["a differently named disc", [String.raw`D:\PS3\Journey\PS3_GAME\USRDIR\EBOOT.BIN`], DEMONS],
    ["a non-boot file", [String.raw`D:\PS3\Demon's Souls\PS3_GAME\USRDIR\DATA.BIN`], DEMONS],
    ["a config value", ["--config", HDD_EBOOT], DEMONS],
  ])("ignores the argument for %s", (_case, args, windowTitle) => {
    expect(discoverRpcs3LaunchTarget({ args, windowTitle })).toBeNull();
  });

  it("identifies only paths with a serial", () => {
    expect(
      rpcs3Adapter.launch?.identifyTarget(
        { kind: "file", filePath: HDD_EBOOT },
        context,
      ),
    ).toMatchObject({ kind: "title_id", value: "blus30443" });
    expect(
      rpcs3Adapter.launch?.identifyTarget(
        { kind: "file", filePath: DISC_EBOOT },
        context,
      ),
    ).toBeNull();
  });

  it("proves a file by serial or folder name, asks otherwise", () => {
    const demons = mapping("blus30443", "Demon's Souls");
    const validate = (filePath: string) =>
      rpcs3Adapter.launch?.validateTargetForMapping(demons, {
        kind: "file",
        filePath,
      });
    expect(validate(HDD_EBOOT)).toEqual({ valid: true, association: "proven" });
    expect(validate(DISC_EBOOT)).toEqual({ valid: true, association: "proven" });
    expect(validate(String.raw`D:\PS3\game\PS3_GAME\USRDIR\EBOOT.BIN`)).toEqual({
      valid: true,
      association: "requires_confirmation",
    });
    expect(validate(String.raw`D:\PS3\save.bin`)).toEqual({
      valid: false,
      reason: "unsupported-content-file",
    });
  });
});
