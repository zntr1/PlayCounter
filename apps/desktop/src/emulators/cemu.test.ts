import { describe, expect, it } from "vitest";
import type { EmulatorMapping } from "./types";
import { cemuAdapter, discoverCemuLaunchTarget, readCemuTitle } from "./cemu";

const context = { denylist: new Set<string>(), privateTokens: ["philip"] };
const BOTW =
  "Cemu 2.6 - FPS: 59.94 [Vulkan] [NVIDIA GPU] [TitleId: 00050000-101C9500] Breath of the Wild [EU v208]";
const BOTW_WUA = String.raw`D:\WiiU\The Legend of Zelda Breath of the Wild [ALZP01].wua`;
const BOTW_INSTALLED = String.raw`D:\Cemu\mlc01\usr\title\00050000\101c9500\code\U-King.rpx`;

function read(windowTitle: string | null, args: string[] = []) {
  return cemuAdapter.read(
    {
      emulatorId: "cemu",
      exeName: "Cemu.exe",
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
    contentKey: `cemu:title_id:${contentValue}`,
    emulatorId: "cemu",
    label: "Cemu",
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

describe("Cemu window title", () => {
  it.each([
    ["Cemu 2.6", { idle: true }],
    ["Cemu 2.6 - Loading...", { idle: true }],
    ["Cemu 2c212b5-experimental", { idle: true }],
    [BOTW, { titleId: "00050000101c9500", name: "Breath of the Wild" }],
    [
      "Cemu 2.6 - FPS: 0.00  [Generic] [TitleId: 00050000-10145d00] SUPER MARIO 3D WORLD [US v1]",
      { titleId: "0005000010145d00", name: "SUPER MARIO 3D WORLD" },
    ],
    [
      "Cemu 2.6 - FPS: 30.00 [OpenGL] [AMD GPU] [TitleId: 00050000-1010ed00] [Online-Pretendo] Mario Kart 8 [JP v64]",
      { titleId: "000500001010ed00", name: "Mario Kart 8" },
    ],
    [
      "Cemu 2.6 - FPS: 30.00 [Vulkan] [Intel GPU] [TitleId: 00050000-1010ed00] [Online-Philips LAN] Mario Kart 8 [v64]",
      { titleId: "000500001010ed00", name: "Mario Kart 8" },
    ],
    [
      "Cemu 2.6 - FPS: 60.00 [Vulkan] [NVIDIA GPU] [TitleId: ffffffff-1a2b3c4d] Unknown Game [v0]",
      { titleId: "ffffffff1a2b3c4d", name: "Unknown Game" },
    ],
    ["Cemu", null],
    ["Edit game profile - Breath of the Wild", null],
    ["Dolphin 2412 | Breath of the Wild", null],
    [null, null],
  ])("%s", (title, expected) => {
    expect(readCemuTitle(title)).toEqual(expected);
  });
});

describe("Cemu adapter", () => {
  it("reads idle, loading and no title as idle", () => {
    expect(read("Cemu 2.6")).toEqual({ state: "idle" });
    expect(read("Cemu 2.6 - Loading...", ["-g", BOTW_WUA])).toEqual({
      state: "idle",
    });
    expect(read(null, ["-g", BOTW_WUA])).toEqual({ state: "idle" });
  });

  it("identifies a game by its title ID with the name as shareable search hint", () => {
    expect(read(BOTW)).toEqual({
      state: "content",
      content: {
        kind: "title_id",
        value: "00050000101c9500",
        display: "Breath of the Wild",
        trust: "recognized",
        shareable: true,
        volatile: true,
        detectionSource: "window_title",
        searchHint: "Breath of the Wild",
        shareableSearchHint: true,
      },
    });
  });

  it("follows the title, not stale start-up arguments", () => {
    const mk8 =
      "Cemu 2.6 - FPS: 59.94 [Vulkan] [NVIDIA GPU] [TitleId: 00050000-1010ed00] Mario Kart 8 [EU v64]";
    const reading = read(mk8, ["-g", BOTW_WUA]);
    expect(reading.state === "content" && reading.content.value).toBe(
      "000500001010ed00",
    );
  });

  it("keeps homebrew local", () => {
    const reading = read(
      "Cemu 2.6 - FPS: 60.00 [Vulkan] [NVIDIA GPU] [TitleId: ffffffff-1a2b3c4d] Unknown Game [v0]",
    );
    expect(reading).toMatchObject({
      state: "content",
      content: {
        value: "ffffffff1a2b3c4d",
        trust: "weak",
        shareable: false,
        shareableSearchHint: false,
      },
    });
    expect(reading.state === "content" && reading.content.searchHint).toBe(
      undefined,
    );
  });

  it("does not share a name that holds a private token", () => {
    const reading = read(
      "Cemu 2.6 - FPS: 60.00 [Vulkan] [NVIDIA GPU] [TitleId: 00050000-12345678] Philip's Homebrew [v0]",
    );
    expect(reading).toMatchObject({
      state: "content",
      content: { shareable: true, shareableSearchHint: false },
    });
  });

  it("reports a title it cannot read", () => {
    expect(read("Edit game profile - Breath of the Wild")).toEqual({
      state: "unidentified",
      reason: "title-not-parsable",
    });
  });
});

describe("Cemu launch target", () => {
  it.each([
    [["-g", BOTW_WUA], BOTW_WUA],
    [[`--game=${BOTW_WUA}`], BOTW_WUA],
    [["--game", `"${BOTW_WUA}"`], BOTW_WUA],
    [["-g", BOTW_INSTALLED], BOTW_INSTALLED],
    [["-g", String.raw`D:\Dumps\Breath of the Wild [ALZP01]\code\U-King.rpx`], String.raw`D:\Dumps\Breath of the Wild [ALZP01]\code\U-King.rpx`],
  ])("uses %j while the title shows the same game", (args, filePath) => {
    expect(discoverCemuLaunchTarget({ args, windowTitle: BOTW })).toEqual({
      target: { kind: "file", filePath },
      source: "launch_arguments",
    });
  });

  it.each([
    ["idle", ["-g", BOTW_WUA], "Cemu 2.6"],
    ["loading", ["-g", BOTW_WUA], "Cemu 2.6 - Loading..."],
    ["another game", ["-g", String.raw`D:\WiiU\Mario Kart 8.wua`], BOTW],
    [
      "another installed title",
      ["-g", String.raw`D:\Cemu\mlc01\usr\title\00050000\1010ed00\code\Turbo.rpx`],
      BOTW,
    ],
    ["an engine-named .rpx", ["-g", String.raw`D:\Dumps\code\U-King.rpx`], BOTW],
    ["a title ID launch", ["-t", "00050000101c9500"], BOTW],
    ["no file", [], BOTW],
  ])("ignores the argument for %s", (_case, args, windowTitle) => {
    expect(discoverCemuLaunchTarget({ args, windowTitle })).toBeNull();
  });

  it("identifies only installed game paths", () => {
    expect(
      cemuAdapter.launch?.identifyTarget(
        { kind: "file", filePath: BOTW_INSTALLED },
        context,
      ),
    ).toMatchObject({ kind: "title_id", value: "00050000101c9500" });
    expect(
      cemuAdapter.launch?.identifyTarget(
        { kind: "file", filePath: BOTW_WUA },
        context,
      ),
    ).toBeNull();
  });

  it("proves a file by title ID or name, asks otherwise", () => {
    const botw = mapping("00050000101c9500", "Breath of the Wild");
    const validate = (filePath: string) =>
      cemuAdapter.launch?.validateTargetForMapping(botw, {
        kind: "file",
        filePath,
      });
    expect(validate(BOTW_INSTALLED)).toEqual({
      valid: true,
      association: "proven",
    });
    expect(validate(BOTW_WUA)).toEqual({ valid: true, association: "proven" });
    expect(validate(String.raw`D:\WiiU\game.wux`)).toEqual({
      valid: true,
      association: "requires_confirmation",
    });
    expect(validate(String.raw`D:\WiiU\meta.xml`)).toEqual({
      valid: false,
      reason: "unsupported-content-file",
    });
  });
});
