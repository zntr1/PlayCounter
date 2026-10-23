import { describe, expect, it } from "vitest";
import type { EmulatorMapping } from "./types";
import {
  azaharAdapter,
  discoverAzaharLaunchTarget,
  readAzaharTitle,
} from "./azahar";

const context = { denylist: new Set<string>(), privateTokens: ["philip"] };
const IDLE = "Azahar 2126.2";
const ZELDA = "Azahar 2126.2 | The Legend of Zelda: Ocarina of Time 3D";
const ZELDA_3DS = String.raw`D:\3DS\The Legend of Zelda - Ocarina of Time 3D (Europe).3ds`;

function read(windowTitle: string | null, args: string[] = []) {
  return azaharAdapter.read(
    {
      emulatorId: "azahar",
      exeName: "azahar.exe",
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
    contentKey: `azahar:rom:${contentValue}`,
    emulatorId: "azahar",
    label: "Azahar",
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

describe("Azahar window title", () => {
  it.each([
    [IDLE, { idle: true }],
    ["Azahar a1b2c3d", { idle: true }],
    [ZELDA, { name: "The Legend of Zelda: Ocarina of Time 3D" }],
    // Separate windows: the game windows name themselves in the UI language.
    ["Azahar 2126.2 | Pokémon X | Primary Window", { name: "Pokémon X" }],
    ["Azahar 2126.2 | Pokémon X | Zweites Fenster", { name: "Pokémon X" }],
    ["Azahar 2126.2 | ", null],
    ["Lime3DS 2119.1 | Pokémon X", null],
    ["Citra Nightly 2104 | Pokémon X", null],
    ["Set Up System Files", null],
  ])("%s", (title, expected) => {
    expect(readAzaharTitle(title)).toEqual(expected);
  });
});

describe("Azahar adapter", () => {
  it("identifies a game by its name without a colon; the full name is the hint", () => {
    expect(read(ZELDA)).toEqual({
      state: "content",
      content: {
        kind: "rom",
        value: "the legend of zelda ocarina of time 3d",
        display: "The Legend of Zelda: Ocarina of Time 3D",
        trust: "recognized",
        shareable: true,
        volatile: true,
        detectionSource: "window_title",
        searchHint: "The Legend of Zelda: Ocarina of Time 3D",
        shareableSearchHint: true,
      },
    });
  });

  it("gives every window of one game the same identity", () => {
    const main = read("Azahar 2126.2 | Pokémon X");
    const primary = read("Azahar 2126.2 | Pokémon X | Primary Window");
    expect(main).toEqual(primary);
    expect(main).toMatchObject({ content: { value: "pokémon x" } });
  });

  it("keeps names holding a private token local", () => {
    expect(read("Azahar 2126.2 | Philip's Homebrew")).toMatchObject({
      state: "content",
      content: { shareable: false, shareableSearchHint: false },
    });
  });

  it("reads idle and missing titles as idle", () => {
    expect(read(IDLE)).toEqual({ state: "idle" });
    expect(read(null, [ZELDA_3DS])).toEqual({ state: "idle" });
  });

  it("reports a title it cannot read", () => {
    expect(read("Citra Nightly 2104 | Pokémon X")).toEqual({
      state: "unidentified",
      reason: "title-not-parsable",
    });
  });
});

describe("Azahar launch target", () => {
  it.each([
    [[ZELDA_3DS]],
    [["-f", ZELDA_3DS]],
    [["--gdbport", "24689", ZELDA_3DS]],
  ])("uses %j while the title shows the same game", (args) => {
    expect(discoverAzaharLaunchTarget({ args, windowTitle: ZELDA })).toEqual({
      target: { kind: "file", filePath: ZELDA_3DS },
      source: "launch_arguments",
    });
  });

  it.each([
    ["idle", [ZELDA_3DS], IDLE],
    ["another game", [String.raw`D:\3DS\Pokemon X.3ds`], ZELDA],
    ["an install", ["-i", String.raw`D:\3DS\Ocarina of Time 3D.cia`], ZELDA],
    ["a movie value", ["-p", ZELDA_3DS], ZELDA],
  ])("ignores the argument for %s", (_case, args, windowTitle) => {
    expect(discoverAzaharLaunchTarget({ args, windowTitle })).toBeNull();
  });

  it("proves a file by name, asks otherwise", () => {
    const zelda = mapping(
      "the legend of zelda ocarina of time 3d",
      "The Legend of Zelda: Ocarina of Time 3D",
    );
    const validate = (filePath: string) =>
      azaharAdapter.launch?.validateTargetForMapping(zelda, {
        kind: "file",
        filePath,
      });
    expect(validate(ZELDA_3DS)).toEqual({ valid: true, association: "proven" });
    expect(validate(String.raw`D:\3DS\game.cci`)).toEqual({
      valid: true,
      association: "requires_confirmation",
    });
    expect(validate(String.raw`D:\3DS\Ocarina of Time 3D.cia`)).toEqual({
      valid: false,
      reason: "unsupported-content-file",
    });
  });
});
