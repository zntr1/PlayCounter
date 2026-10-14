import { describe, expect, it } from "vitest";
import type { EmulatorMapping } from "./types";
import { discoverEdenLaunchTarget, edenAdapter, readEdenTitle } from "./eden";

const context = { denylist: new Set<string>(), privateTokens: ["philip"] };
const IDLE = "Eden | v0.0.4 | msvc-19.44.35211";
const TOTK =
  "Eden | v0.0.4 | msvc-19.44.35211 | The Legend of Zelda: Tears of the Kingdom (64-bit) | 1.2.1 | NVIDIA";
const TOTK_NSP = String.raw`D:\Switch\The Legend of Zelda Tears of the Kingdom [0100F2C0115B6000].nsp`;

function read(windowTitle: string | null, args: string[] = []) {
  return edenAdapter.read(
    {
      emulatorId: "eden",
      exeName: "eden.exe",
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
    contentKey: `eden:rom:${contentValue}`,
    emulatorId: "eden",
    label: "Eden",
    contentKind: "rom",
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

describe("Eden window title", () => {
  it.each([
    [IDLE, { idle: true }],
    ["Eden Nightly | v0.0.4-nightly | clang-20", { idle: true }],
    [TOTK, { name: "The Legend of Zelda: Tears of the Kingdom" }],
    [
      "Eden | v0.0.4 | msvc-19.44 | Celeste (64-Bit) | AMD",
      { name: "Celeste" },
    ],
    [
      "Eden | v0.0.4 | msvc-19.44 | homebrew.nro (64-bit) | Intel",
      { name: "homebrew" },
    ],
    ["Eden | v0.0.4", null],
    ["yuzu | 1734 | msvc", null],
    ["Configure", null],
  ])("%s", (title, expected) => {
    expect(readEdenTitle(title)).toEqual(expected);
  });
});

describe("Eden adapter", () => {
  it("identifies a game by its name without a colon; the full name is the hint", () => {
    expect(read(TOTK)).toEqual({
      state: "content",
      content: {
        kind: "rom",
        value: "the legend of zelda tears of the kingdom",
        display: "The Legend of Zelda: Tears of the Kingdom",
        trust: "recognized",
        shareable: true,
        volatile: true,
        detectionSource: "window_title",
        searchHint: "The Legend of Zelda: Tears of the Kingdom",
        shareableSearchHint: true,
      },
    });
  });

  it("reads idle and missing titles as idle", () => {
    expect(read(IDLE)).toEqual({ state: "idle" });
    expect(read(null, [TOTK_NSP])).toEqual({ state: "idle" });
  });

  it("reports a title it cannot read", () => {
    expect(read("Eden | v0.0.4")).toEqual({
      state: "unidentified",
      reason: "title-not-parsable",
    });
  });
});

describe("Eden launch target", () => {
  it.each([
    [["-g", TOTK_NSP]],
    [["--game", TOTK_NSP]],
    [["-u", "1", TOTK_NSP]],
  ])("uses %j while the title shows the same game", (args) => {
    expect(discoverEdenLaunchTarget({ args, windowTitle: TOTK })).toEqual({
      target: { kind: "file", filePath: TOTK_NSP },
      source: "launch_arguments",
    });
  });

  it.each([
    ["idle", ["-g", TOTK_NSP], IDLE],
    ["another game", ["-g", String.raw`D:\Switch\Celeste.nsp`], TOTK],
    ["a config value", ["-c", TOTK_NSP], TOTK],
  ])("ignores the argument for %s", (_case, args, windowTitle) => {
    expect(discoverEdenLaunchTarget({ args, windowTitle })).toBeNull();
  });

  it("proves a file by name, asks otherwise", () => {
    const totk = mapping(
      "the legend of zelda tears of the kingdom",
      "The Legend of Zelda: Tears of the Kingdom",
    );
    const validate = (filePath: string) =>
      edenAdapter.launch?.validateTargetForMapping(totk, {
        kind: "file",
        filePath,
      });
    expect(validate(TOTK_NSP)).toEqual({ valid: true, association: "proven" });
    expect(validate(String.raw`D:\Switch\game.xci`)).toEqual({
      valid: true,
      association: "requires_confirmation",
    });
  });
});
