import { describe, expect, it } from "vitest";
import type { EmulatorMapping } from "./types";
import { discoverPpssppLaunchTarget, ppssppAdapter, readPpssppTitle } from "./ppsspp";

const context = { denylist: new Set<string>(), privateTokens: ["philip"] };
const CRISIS = "PPSSPP v1.18.1 - ULUS10336 : CRISIS CORE -FINAL FANTASY VII-";
const CRISIS_ISO = String.raw`D:\PSP\Crisis Core - Final Fantasy VII (USA).iso`;

function read(windowTitle: string | null, args: string[] = []) {
  return ppssppAdapter.read(
    {
      emulatorId: "ppsspp",
      exeName: "PPSSPPWindows64.exe",
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
    contentKey: `ppsspp:title_id:${contentValue}`,
    emulatorId: "ppsspp",
    label: "PPSSPP",
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

describe("PPSSPP window title", () => {
  it.each([
    ["PPSSPP v1.18.1", { idle: true }],
    ["PPSSPP Gold v1.18.1-123-gabcdef0", { idle: true }],
    ["PPSSPP v1.18.1 (instance: 2)", { idle: true }],
    [CRISIS, { discId: "ulus10336", name: "CRISIS CORE -FINAL FANTASY VII-" }],
    [
      "PPSSPP v1.18.1 - NPUH10091 : Patapon 2 (debug) (instance: 2)",
      { discId: "npuh10091", name: "Patapon 2" },
    ],
    ["PPSSPP v1.18.1 - My Homebrew", { discId: null, name: "My Homebrew" }],
    ["PPSSPP", null],
    ["Settings", null],
  ])("%s", (title, expected) => {
    expect(readPpssppTitle(title)).toEqual(expected);
  });
});

describe("PPSSPP adapter", () => {
  it("reads idle titles and no title as idle", () => {
    expect(read("PPSSPP v1.18.1")).toEqual({ state: "idle" });
    expect(read(null, [CRISIS_ISO])).toEqual({ state: "idle" });
  });

  it("identifies a game by its disc ID with the name as shareable hint", () => {
    expect(read(CRISIS)).toEqual({
      state: "content",
      content: {
        kind: "title_id",
        value: "ulus10336",
        display: "CRISIS CORE -FINAL FANTASY VII-",
        trust: "recognized",
        shareable: true,
        volatile: true,
        detectionSource: "window_title",
        searchHint: "CRISIS CORE -FINAL FANTASY VII-",
        shareableSearchHint: true,
      },
    });
  });

  it("keeps homebrew without a disc ID local", () => {
    expect(read("PPSSPP v1.18.1 - My Homebrew")).toMatchObject({
      state: "content",
      content: { kind: "rom", value: "my homebrew", trust: "weak", shareable: false },
    });
  });

  it("follows the title, not stale start-up arguments", () => {
    const reading = read("PPSSPP v1.18.1 - NPUH10091 : Patapon 2", [CRISIS_ISO]);
    expect(reading.state === "content" && reading.content.value).toBe("npuh10091");
  });
});

describe("PPSSPP launch target", () => {
  it.each([
    [[CRISIS_ISO]],
    [["--fullscreen", CRISIS_ISO]],
    [[String.raw`D:\PSP\ULUS-10336.cso`]],
  ])("uses %j while the title shows the same game", (args) => {
    expect(discoverPpssppLaunchTarget({ args, windowTitle: CRISIS })).toEqual({
      target: { kind: "file", filePath: args.at(-1) },
      source: "launch_arguments",
    });
  });

  it.each([
    ["idle", [CRISIS_ISO], "PPSSPP v1.18.1"],
    ["another serial", [String.raw`D:\PSP\NPUH10091.iso`], CRISIS],
    ["another name", [String.raw`D:\PSP\Patapon 2.iso`], CRISIS],
    ["a save file", [String.raw`D:\PSP\Crisis Core.sav`], CRISIS],
  ])("ignores the argument for %s", (_case, args, windowTitle) => {
    expect(discoverPpssppLaunchTarget({ args, windowTitle })).toBeNull();
  });

  it("proves a file by serial or name, asks otherwise", () => {
    const crisis = mapping("ulus10336", "CRISIS CORE -FINAL FANTASY VII-");
    const validate = (filePath: string) =>
      ppssppAdapter.launch?.validateTargetForMapping(crisis, {
        kind: "file",
        filePath,
      });
    expect(validate(CRISIS_ISO)).toEqual({ valid: true, association: "proven" });
    expect(validate(String.raw`D:\PSP\ULUS10336.cso`)).toEqual({
      valid: true,
      association: "proven",
    });
    expect(validate(String.raw`D:\PSP\game.iso`)).toEqual({
      valid: true,
      association: "requires_confirmation",
    });
    expect(
      ppssppAdapter.launch?.identifyTarget(
        { kind: "file", filePath: String.raw`D:\PSP\ULUS-10336.cso` },
        context,
      ),
    ).toMatchObject({ kind: "title_id", value: "ulus10336" });
  });
});
