import { describe, expect, it } from "vitest";
import type { EmulatorMapping } from "./types";
import {
  discoverRyujinxLaunchTarget,
  readRyujinxTitle,
  ryujinxAdapter,
} from "./ryujinx";

const context = { denylist: new Set<string>(), privateTokens: ["philip"] };
const ODYSSEY =
  "Ryujinx 1.3.2 - Super Mario Odyssey v1.3.0 (0100000000010000) (64-bit)";
const ODYSSEY_WINDOWS =
  "Ryujinx 1.3.2\nSuper Mario Odyssey\nv1.3.0\n(0100000000010000) (64-bit)";
const ODYSSEY_NSP = String.raw`D:\Switch\Super Mario Odyssey [0100000000010000][v0].nsp`;

function read(windowTitle: string | null, args: string[] = []) {
  return ryujinxAdapter.read(
    {
      emulatorId: "ryujinx",
      exeName: "Ryujinx.exe",
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
    contentKey: `ryujinx:title_id:${contentValue}`,
    emulatorId: "ryujinx",
    label: "Ryujinx",
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

describe("Ryujinx window title", () => {
  it.each([
    ["Ryujinx 1.3.2", { idle: true }],
    ["Ryujinx Canary 1.3.250", { idle: true }],
    ["Ryujinx 1.3.2 - Settings", { idle: true }],
    [ODYSSEY, { titleId: "0100000000010000", name: "Super Mario Odyssey" }],
    [ODYSSEY_WINDOWS, { titleId: "0100000000010000", name: "Super Mario Odyssey" }],
    [
      "Ryujinx 1.3.2 - The Legend of Zelda: Tears of the Kingdom v1.2.1 (0100F2C0115B6000) (64-bit) (Paused)",
      {
        titleId: "0100f2c0115b6000",
        name: "The Legend of Zelda: Tears of the Kingdom",
      },
    ],
    [
      "Ryujinx 1.1.1403 - Celeste (01002B30028F6000) (64-bit)",
      { titleId: "01002b30028f6000", name: "Celeste" },
    ],
    ["Super Mario Odyssey", null],
  ])("%j", (title, expected) => {
    expect(readRyujinxTitle(title)).toEqual(expected);
  });
});

describe("Ryujinx adapter", () => {
  it("identifies a game by its program ID with the name as shareable hint", () => {
    expect(read(ODYSSEY_WINDOWS)).toEqual({
      state: "content",
      content: {
        kind: "title_id",
        value: "0100000000010000",
        display: "Super Mario Odyssey",
        trust: "recognized",
        shareable: true,
        volatile: true,
        detectionSource: "window_title",
        searchHint: "Super Mario Odyssey",
        shareableSearchHint: true,
      },
    });
  });

  it("keeps homebrew program IDs local", () => {
    expect(
      read("Ryujinx 1.3.2 - My Homebrew (0000000000000000) (64-bit)"),
    ).toMatchObject({
      state: "content",
      content: { trust: "weak", shareable: false, shareableSearchHint: false },
    });
  });

  it("reads idle and missing titles as idle", () => {
    expect(read("Ryujinx 1.3.2")).toEqual({ state: "idle" });
    expect(read(null, [ODYSSEY_NSP])).toEqual({ state: "idle" });
  });
});

describe("Ryujinx launch target", () => {
  it.each([
    [[ODYSSEY_NSP]],
    [["-p", "Philip", ODYSSEY_NSP]],
    [["--fullscreen", String.raw`D:\Switch\Super Mario Odyssey.xci`]],
  ])("uses %j while the title shows the same game", (args) => {
    expect(discoverRyujinxLaunchTarget({ args, windowTitle: ODYSSEY })).toEqual({
      target: { kind: "file", filePath: args.at(-1) },
      source: "launch_arguments",
    });
  });

  it.each([
    ["idle", [ODYSSEY_NSP], "Ryujinx 1.3.2"],
    ["another program ID", [String.raw`D:\Switch\Celeste [01002B30028F6000].nsp`], ODYSSEY],
    ["another name", [String.raw`D:\Switch\Celeste.xci`], ODYSSEY],
    ["a profile value", ["--profile", ODYSSEY_NSP], ODYSSEY],
  ])("ignores the argument for %s", (_case, args, windowTitle) => {
    expect(discoverRyujinxLaunchTarget({ args, windowTitle })).toBeNull();
  });

  it("proves a file by program ID or name, asks otherwise", () => {
    const odyssey = mapping("0100000000010000", "Super Mario Odyssey");
    const validate = (filePath: string) =>
      ryujinxAdapter.launch?.validateTargetForMapping(odyssey, {
        kind: "file",
        filePath,
      });
    expect(validate(ODYSSEY_NSP)).toEqual({ valid: true, association: "proven" });
    expect(validate(String.raw`D:\Switch\game.xci`)).toEqual({
      valid: true,
      association: "requires_confirmation",
    });
    expect(validate(String.raw`D:\Switch\prod.keys`)).toEqual({
      valid: false,
      reason: "unsupported-content-file",
    });
    expect(
      ryujinxAdapter.launch?.identifyTarget(
        { kind: "file", filePath: ODYSSEY_NSP },
        context,
      ),
    ).toMatchObject({ kind: "title_id", value: "0100000000010000" });
  });
});
