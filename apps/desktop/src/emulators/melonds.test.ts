import { describe, expect, it } from "vitest";
import type { EmulatorMapping } from "./types";
import {
  discoverMelonDSLaunchTarget,
  melondsAdapter,
  readMelonDSTitle,
} from "./melonds";

const context = { denylist: new Set<string>(), privateTokens: ["philip"] };
const RUNNING = "[60/60] melonDS 1.1";
const IDLE = "melonDS 1.1";
const MARIO_KART = String.raw`D:\DS\Mario Kart DS (USA).nds`;

function read(
  windowTitle: string | null,
  recentFile?: string,
  args: string[] = [],
) {
  return melondsAdapter.read(
    {
      emulatorId: "melonds",
      exeName: "melonDS.exe",
      pid: 1,
      startedAtUnix: 1,
      args,
      windowTitle,
      recentFile,
    },
    context,
  );
}

function mapping(contentValue: string, display: string): EmulatorMapping {
  return {
    contentKey: `melonds:rom:${contentValue}`,
    emulatorId: "melonds",
    label: "melonDS",
    contentKind: "rom",
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

describe("melonDS window title", () => {
  it.each([
    [RUNNING, { running: true }],
    ["[58/60] melonDS 1.1-dev", { running: true }],
    ["[p2] [60/60] melonDS 1.1", { running: true }],
    ["[p1:w2] [60/60] melonDS 1.1", { running: true }],
    [IDLE, { running: false }],
    ["[w2] melonDS 1.1", { running: false }],
    ["melonDS", { running: false }],
    ["Emu settings - melonDS", null],
    ["[60/60] DeSmuME 0.9.13", null],
  ])("%s", (title, expected) => {
    expect(readMelonDSTitle(title)).toEqual(expected);
  });
});

describe("melonDS adapter", () => {
  it("identifies the newest ROM of the recent list while a game runs", () => {
    expect(read(RUNNING, MARIO_KART)).toEqual({
      state: "content",
      content: {
        kind: "rom",
        value: "mario kart ds (usa)",
        display: "Mario Kart DS (USA).nds",
        trust: "recognized",
        shareable: true,
        volatile: true,
        detectionSource: "recent_file",
      },
    });
  });

  it("names a ROM inside an archive by its own file name", () => {
    expect(
      read(RUNNING, String.raw`D:\DS\roms.zip|DS/Mario Kart DS (USA).nds`),
    ).toMatchObject({
      content: {
        value: "mario kart ds (usa)",
        display: "Mario Kart DS (USA).nds",
      },
    });
  });

  it("gives a compressed ROM the same identity", () => {
    expect(read(RUNNING, `${MARIO_KART}.zst`)).toMatchObject({
      content: { value: "mario kart ds (usa)" },
    });
  });

  it("keeps file names holding a private token local", () => {
    expect(read(RUNNING, String.raw`D:\DS\philip hack.nds`)).toMatchObject({
      content: { shareable: false },
    });
  });

  it("reads a paused game, no game and no title as idle", () => {
    expect(read(IDLE, MARIO_KART)).toEqual({ state: "idle" });
    expect(read("[w2] melonDS 1.1", MARIO_KART)).toEqual({ state: "idle" });
    expect(read(null, MARIO_KART)).toEqual({ state: "idle" });
  });

  it.each([
    ["no recent list", undefined],
    ["a GBA ROM", String.raw`D:\GBA\Pokemon Emerald.gba`],
    ["a BIOS", String.raw`D:\DS\bios.nds`],
  ])("knows a game runs but not which with %s", (_case, recentFile) => {
    expect(read(RUNNING, recentFile)).toEqual({
      state: "unidentified",
      reason: "no-signal",
    });
  });

  it("reports a title it cannot read", () => {
    expect(read("Emu settings - melonDS", MARIO_KART)).toEqual({
      state: "unidentified",
      reason: "title-not-parsable",
    });
  });
});

describe("melonDS launch target", () => {
  it("uses the newest ROM of the recent list while a game runs", () => {
    expect(
      discoverMelonDSLaunchTarget({
        recentFile: MARIO_KART,
        windowTitle: RUNNING,
      }),
    ).toEqual({
      target: { kind: "file", filePath: MARIO_KART },
      source: "recent_file",
    });
  });

  it.each([
    ["paused or idle", MARIO_KART, IDLE],
    ["an archive", String.raw`D:\DS\roms.zip|Mario Kart DS (USA).nds`, RUNNING],
    ["no recent list", undefined, RUNNING],
  ])("has none for %s", (_case, recentFile, windowTitle) => {
    expect(discoverMelonDSLaunchTarget({ recentFile, windowTitle })).toBeNull();
  });

  it("proves only a file of the same ROM", () => {
    const marioKart = mapping("mario kart ds (usa)", "Mario Kart DS (USA).nds");
    const validate = (filePath: string) =>
      melondsAdapter.launch?.validateTargetForMapping(marioKart, {
        kind: "file",
        filePath,
      });
    expect(validate(MARIO_KART)).toEqual({
      valid: true,
      association: "proven",
    });
    expect(validate(`${MARIO_KART}.zst`)).toEqual({
      valid: true,
      association: "proven",
    });
    expect(validate(String.raw`D:\DS\New Super Mario Bros.nds`)).toEqual({
      valid: false,
      reason: "content-name-mismatch",
    });
    expect(
      melondsAdapter.launch?.identifyTarget(
        { kind: "file", filePath: MARIO_KART },
        context,
      ),
    ).toMatchObject({
      kind: "rom",
      value: "mario kart ds (usa)",
      detectionSource: "launch_arguments",
      volatile: false,
    });
  });
});
