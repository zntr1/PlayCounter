import { describe, expect, it } from "vitest";
import type { EmulatorMapping } from "./types";
import {
  discoverXeniaLaunchTarget,
  readXeniaTitle,
  xeniaAdapter,
} from "./xenia";

const context = { denylist: new Set<string>(), privateTokens: ["philip"] };
const BUILD = "Xenia-canary (canary_experimental@534aeb6 on 2026-10-22)";
const HALO = `${BUILD} | [4D5307E6 v0.0.0.11] Halo 3 <Vulkan>`;
const HALO_ISO = String.raw`D:\X360\Halo 3 (USA).iso`;

function read(windowTitle: string | null, args: string[] = []) {
  return xeniaAdapter.read(
    {
      emulatorId: "xenia",
      exeName: "xenia_canary.exe",
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
    contentKey: `xenia:title_id:${contentValue}`,
    emulatorId: "xenia",
    label: "Xenia",
    contentKind: "title_id",
    contentValue,
    display,
    trust: "recognized",
    decision: "game",
    gameId: 1,
    confidence: "user",
    decidedAt: "2026-10-23T00:00:00Z",
    lastSeenAt: "2026-10-23T00:00:00Z",
  };
}

describe("Xenia window title", () => {
  it.each([
    [BUILD, { idle: true }],
    [`${BUILD} <Vulkan>`, { idle: true }],
    ["Xenia (master@95a5c3e on 2026-02-18) <D3D12>", { idle: true }],
    [
      "Xenia-canary (PR#123 - canary_experimental@534aeb6 on 2026-10-22)",
      { idle: true },
    ],
    [HALO, { titleId: "4d5307e6", name: "Halo 3" }],
    [
      `${BUILD} | [415607D2 v1.0.1] Gears of War 2 <D3D12> (@2.00x) (Preloading shaders\u2026) [Patches Applied] [Plugins Loaded]`,
      { titleId: "415607d2", name: "Gears of War 2" },
    ],
    [
      `Xenia (master@95a5c3e on 2026-02-18) | [584111F7] Minecraft: Xbox 360 Edition <Vulkan>`,
      { titleId: "584111f7", name: "Minecraft: Xbox 360 Edition" },
    ],
    [`${BUILD} | [4D5307E6] <Vulkan>`, { titleId: "4d5307e6", name: "" }],
    ["Xenia-canary", null],
    ["xenia_canary.exe", null],
  ])("%s", (title, expected) => {
    expect(readXeniaTitle(title)).toEqual(expected);
  });
});

describe("Xenia adapter", () => {
  it("identifies a game by its title ID with the name as shareable hint", () => {
    expect(read(HALO)).toEqual({
      state: "content",
      content: {
        kind: "title_id",
        value: "4d5307e6",
        display: "Halo 3",
        trust: "recognized",
        shareable: true,
        volatile: true,
        detectionSource: "window_title",
        searchHint: "Halo 3",
        shareableSearchHint: true,
      },
    });
  });

  it("shows the title ID when the game has no name", () => {
    expect(read(`${BUILD} | [4D5307E6] <Vulkan>`)).toMatchObject({
      content: { value: "4d5307e6", display: "4D5307E6" },
    });
  });

  it.each(["00000000", "FFFE07D1", "FFFF0055"])(
    "keeps system and homebrew ID %s local",
    (id) => {
      expect(read(`${BUILD} | [${id}] Homebrew <Vulkan>`)).toMatchObject({
        state: "content",
        content: {
          trust: "weak",
          shareable: false,
          shareableSearchHint: false,
        },
      });
    },
  );

  it("reads idle and missing titles as idle", () => {
    expect(read(BUILD)).toEqual({ state: "idle" });
    expect(read(null, [HALO_ISO])).toEqual({ state: "idle" });
  });

  it("reports a title it cannot read", () => {
    expect(read("Xenia-canary")).toEqual({
      state: "unidentified",
      reason: "title-not-parsable",
    });
  });
});

describe("Xenia launch target", () => {
  it.each([
    [[HALO_ISO]],
    [["--fullscreen", HALO_ISO]],
    [["--gpu=vulkan", HALO_ISO]],
    [[String.raw`D:\X360\Halo 3\default.xex`]],
  ])("uses %j while the title shows the same game", (args) => {
    expect(discoverXeniaLaunchTarget({ args, windowTitle: HALO })).toEqual({
      target: { kind: "file", filePath: args.at(-1) },
      source: "launch_arguments",
    });
  });

  it.each([
    ["idle", [HALO_ISO], BUILD],
    ["another game", [String.raw`D:\X360\Fable II.iso`], HALO],
    ["no game file", ["--fullscreen"], HALO],
  ])("ignores the argument for %s", (_case, args, windowTitle) => {
    expect(discoverXeniaLaunchTarget({ args, windowTitle })).toBeNull();
  });

  it("proves a file by name, asks otherwise", () => {
    const halo = mapping("4d5307e6", "Halo 3");
    const validate = (filePath: string) =>
      xeniaAdapter.launch?.validateTargetForMapping(halo, {
        kind: "file",
        filePath,
      });
    expect(validate(HALO_ISO)).toEqual({ valid: true, association: "proven" });
    expect(validate(String.raw`D:\X360\disc1.iso`)).toEqual({
      valid: true,
      association: "requires_confirmation",
    });
    expect(validate(String.raw`D:\X360\Halo 3.zip`)).toEqual({
      valid: false,
      reason: "unsupported-content-file",
    });
  });
});
