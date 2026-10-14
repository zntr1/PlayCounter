import { describe, expect, it } from "vitest";
import type { EmulatorMapping, RawEmulatorSignals } from "./types";
import {
  discoverDuckStationLaunchTarget,
  duckstationAdapter,
} from "./duckstation";

const context = { denylist: new Set<string>(), privateTokens: ["philip"] };
const FF7_CUE = String.raw`D:\PS1\Final Fantasy VII (USA) (Disc 1).cue`;
const FF7_BIN = String.raw`D:\PS1\Final Fantasy VII (USA) (Disc 1).bin`;
const CTR_TRACKS = [
  String.raw`D:\PS1\Crash Team Racing (USA) (Track 1).bin`,
  String.raw`D:\PS1\Crash Team Racing (USA) (Track 2).bin`,
];

function read(
  signals: Partial<Pick<RawEmulatorSignals, "args" | "openFiles" | "windowTitle">>,
) {
  return duckstationAdapter.read(
    {
      emulatorId: "duckstation",
      exeName: "duckstation-qt-x64-ReleaseLTCG.exe",
      pid: 1,
      startedAtUnix: 1,
      args: [],
      windowTitle: null,
      ...signals,
    },
    context,
  );
}

function mapping(contentValue: string): EmulatorMapping {
  return {
    contentKey: `duckstation:rom:${contentValue}`,
    emulatorId: "duckstation",
    label: "DuckStation",
    contentKind: "rom",
    contentValue,
    display: contentValue,
    trust: "recognized",
    decision: "game",
    gameId: 1,
    confidence: "user",
    decidedAt: "2026-10-14T00:00:00Z",
    lastSeenAt: "2026-10-14T00:00:00Z",
  };
}

describe("DuckStation adapter", () => {
  it("identifies the open disc file without disc and track numbers", () => {
    expect(
      read({ openFiles: [FF7_BIN], windowTitle: "Final Fantasy VII" }),
    ).toEqual({
      state: "content",
      content: {
        kind: "rom",
        value: "final fantasy vii (usa)",
        display: "Final Fantasy VII (USA) (Disc 1).bin",
        trust: "recognized",
        shareable: true,
        volatile: true,
        detectionSource: "open_file_handle",
      },
    });
  });

  it("treats every track of one disc as one game", () => {
    expect(read({ openFiles: CTR_TRACKS })).toMatchObject({
      state: "content",
      content: { value: "crash team racing (usa)" },
    });
  });

  it("follows the open disc, not stale start-up arguments", () => {
    expect(read({ args: [FF7_CUE], openFiles: CTR_TRACKS })).toMatchObject({
      state: "content",
      content: { value: "crash team racing (usa)" },
    });
  });

  it.each([
    ["no open disc", [String.raw`D:\DuckStation\memcards\shared_card_1.mcd`]],
    ["a BIOS image", [String.raw`D:\DuckStation\bios\scph5501.bin`]],
    ["a cache file", [String.raw`D:\DuckStation\cache\vulkan_pipelines.bin`]],
  ])("reads %s as idle", (_case, openFiles) => {
    expect(read({ openFiles, args: [FF7_CUE] })).toEqual({ state: "idle" });
  });

  it("does not guess between two different discs", () => {
    expect(read({ openFiles: [FF7_BIN, CTR_TRACKS[0]] })).toEqual({
      state: "unidentified",
      reason: "no-signal",
    });
  });

  it("falls back to the start-up file without handle access", () => {
    expect(read({ args: [FF7_CUE], windowTitle: "Final Fantasy VII" })).toMatchObject({
      state: "content",
      content: { value: "final fantasy vii (usa)", detectionSource: "launch_arguments" },
    });
    expect(read({ args: [FF7_CUE], windowTitle: "DuckStation v0.1-9876" })).toEqual({
      state: "idle",
    });
    expect(read({ windowTitle: "Final Fantasy VII" })).toEqual({
      state: "unidentified",
      reason: "title-not-parsable",
    });
  });
});

describe("DuckStation launch target", () => {
  it("prefers the .cue the game was started with over its track file", () => {
    expect(
      discoverDuckStationLaunchTarget({
        args: ["-batch", "--", FF7_CUE],
        openFiles: [FF7_BIN],
        windowTitle: null,
      }),
    ).toEqual({
      target: { kind: "file", filePath: FF7_CUE },
      source: "launch_arguments",
    });
  });

  it("uses the first track when the game was started from the list", () => {
    expect(
      discoverDuckStationLaunchTarget({
        args: [],
        openFiles: [...CTR_TRACKS].reverse(),
        windowTitle: null,
      }),
    ).toEqual({
      target: { kind: "file", filePath: CTR_TRACKS[0] },
      source: "open_file_handle",
    });
  });

  it("ignores option values", () => {
    expect(
      discoverDuckStationLaunchTarget({
        args: ["-statefile", FF7_BIN],
        windowTitle: "Final Fantasy VII",
      }),
    ).toBeNull();
  });

  it("accepts any file of the same game and rejects other games", () => {
    const ff7 = mapping("final fantasy vii (usa)");
    const validate = (filePath: string) =>
      duckstationAdapter.launch?.validateTargetForMapping(ff7, {
        kind: "file",
        filePath,
      });
    expect(validate(FF7_CUE)).toEqual({ valid: true, association: "proven" });
    expect(validate(String.raw`D:\PS1\Final Fantasy VII (USA) (Disc 2).chd`)).toEqual({
      valid: true,
      association: "proven",
    });
    expect(validate(CTR_TRACKS[0])).toEqual({
      valid: false,
      reason: "content-name-mismatch",
    });
  });
});
