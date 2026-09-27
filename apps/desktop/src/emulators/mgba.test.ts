import { describe, expect, it } from "vitest";
import { isValidEmulatorBinaryPath } from "../emulatorLaunch";
import type { EmulatorMapping } from "./types";
import { discoverMgbaLaunchTarget, mgbaAdapter, readMgbaTitle } from "./mgba";

const context = { denylist: new Set<string>(), privateTokens: ["philip"] };
const FIRERED = String.raw`D:\ROMs\Pokemon FireRed.gba`;
const DB_TITLE =
  "mGBA - Pokemon - FireRed Version (USA, Europe) (59.7275 fps) - 0.10.5";

function read(
  windowTitle: string | null,
  args: string[] = [],
  exeName = "mGBA.exe",
) {
  return mgbaAdapter.read(
    {
      emulatorId: "mgba",
      exeName,
      pid: 1,
      startedAtUnix: 1,
      args,
      windowTitle,
    },
    context,
  );
}

function mapping(contentValue: string): EmulatorMapping {
  return {
    contentKey: `mgba:rom:${contentValue}`,
    emulatorId: "mgba",
    label: "mGBA",
    contentKind: "rom",
    contentValue,
    display: contentValue,
    trust: "recognized",
    decision: "game",
    gameId: 1,
    confidence: "user",
    decidedAt: "2026-09-27T00:00:00Z",
    lastSeenAt: "2026-09-27T00:00:00Z",
  };
}

describe("mGBA window title", () => {
  it.each([
    ["mGBA - 0.10.5", { idle: true }],
    ["mGBA - 0.11-8424-6a2d1d1", { idle: true }],
    [DB_TITLE, { game: "Pokemon - FireRed Version (USA, Europe)" }],
    ["mGBA - POKEMON FIRE - 0.10.5", { game: "POKEMON FIRE" }],
    ["mGBA - POKEMON FIRE (60 fps) - 0.10.5", { game: "POKEMON FIRE" }],
    [
      "mGBA - POKEMON FIRE -  Player 1 of 2 (59.7 fps) - 0.10.5",
      { game: "POKEMON FIRE" },
    ],
    [
      "mGBA - Pokemon FireRed.gba (59.7 fps) - 0.10.5",
      { game: "Pokemon FireRed.gba" },
    ],
    ["mGBA", null],
    ["Settings", null],
    [null, null],
  ])("reads %s", (title, expected) => {
    expect(readMgbaTitle(title)).toEqual(expected);
  });
});

describe("mGBA adapter", () => {
  it("identifies the game from the database name in the title", () => {
    expect(read(DB_TITLE)).toEqual({
      state: "content",
      content: {
        kind: "rom",
        value: "pokemon - firered version (usa, europe)",
        display: "Pokemon - FireRed Version (USA, Europe)",
        trust: "recognized",
        shareable: true,
        volatile: true,
        detectionSource: "window_title",
        searchHint: "Pokemon - FireRed Version (USA, Europe)",
      },
    });
  });

  it("follows the title when a ROM was loaded from the menu", () => {
    const reading = read(
      "mGBA - Pokemon - LeafGreen Version (USA, Europe) (60 fps) - 0.10.5",
      [FIRERED],
    );
    expect(reading.state === "content" && reading.content.value).toBe(
      "pokemon - leafgreen version (usa, europe)",
    );
  });

  it("gives the database title, a file-name title and the file one identity", () => {
    const noIntro = String.raw`D:\ROMs\Pokemon - FireRed Version (USA, Europe).gba`;
    const values = [
      read(DB_TITLE),
      read(
        "mGBA - Pokemon - FireRed Version (USA, Europe).gba (60 fps) - 0.10.5",
      ),
      read("mGBA", [noIntro], "mgba-sdl.exe"),
    ].map((reading) => reading.state === "content" && reading.content.value);
    expect(values).toEqual(
      Array(3).fill("pokemon - firered version (usa, europe)"),
    );
  });

  it("waits for the Qt title instead of using the start-up file", () => {
    // "Start game" scans before mGBA's window has its title.
    expect(read(null, [FIRERED])).toEqual({ state: "idle" });
    expect(read("mGBA", [FIRERED])).toEqual({ state: "idle" });
  });

  it("uses the start-up file when the title has no game (SDL)", () => {
    expect(read("mGBA", ["-s", "2", FIRERED], "mgba-sdl.exe")).toEqual({
      state: "content",
      content: {
        kind: "rom",
        value: "pokemon firered",
        display: "Pokemon FireRed.gba",
        trust: "recognized",
        shareable: true,
        volatile: false,
        detectionSource: "launch_arguments",
        searchHint: "Pokemon FireRed",
      },
    });
  });

  it("is idle on an idle title even with a start-up file", () => {
    expect(read("mGBA - 0.10.5", [FIRERED])).toEqual({ state: "idle" });
  });

  it("keeps private and generic names out of shared identities", () => {
    const shareable = (title: string) => {
      const reading = read(title);
      return reading.state === "content" ? reading.content.shareable : null;
    };
    expect(shareable("mGBA - philip firered.gba - 0.10.5")).toBe(false);
    expect(shareable("mGBA - [Hack] FireRed.gba - 0.10.5")).toBe(false);
    expect(shareable("mGBA - Pokemon FireRed.gba - 0.10.5")).toBe(true);
    expect(read("mGBA - GAME - 0.10.5")).toEqual({
      state: "unidentified",
      reason: "title-not-parsable",
    });
    expect(read(null, [String.raw`D:\ROMs\game.gba`], "mgba-sdl.exe")).toEqual({
      state: "unidentified",
      reason: "no-signal",
    });
  });
});

describe("mGBA launch target", () => {
  it("skips option values and needs exactly one game argument", () => {
    const args = ["-b", String.raw`C:\bios\gba_bios.gba`, "-p", "fix.ips"];
    expect(
      discoverMgbaLaunchTarget({ args: [...args, FIRERED], windowTitle: null }),
    ).toEqual({
      target: { kind: "file", filePath: FIRERED },
      source: "launch_arguments",
    });
    expect(
      discoverMgbaLaunchTarget({ args: ["a.gba", "b.gba"], windowTitle: null }),
    ).toBeNull();
    expect(
      discoverMgbaLaunchTarget({ args: ["save.sav"], windowTitle: null }),
    ).toBeNull();
  });

  it.each([
    [DB_TITLE, true],
    ["mGBA - POKEMON FIRE (60 fps) - 0.10.5", true],
    ["mGBA - Pokemon FireRed.gba (60 fps) - 0.10.5", true],
    ["mGBA - Pokemon - LeafGreen Version (USA) (60 fps) - 0.10.5", false],
    ["mGBA - 0.10.5", false],
  ])("only trusts the start-up file while %s agrees", (title, found) => {
    expect(
      discoverMgbaLaunchTarget({ args: [FIRERED], windowTitle: title }) !==
        null,
    ).toBe(found);
  });

  it("proves matching files and asks about the rest", () => {
    const validate = mgbaAdapter.launch!.validateTargetForMapping;
    const file = { kind: "file" as const, filePath: FIRERED };
    expect(validate(mapping("pokemon firered"), file)).toEqual({
      valid: true,
      association: "proven",
    });
    expect(
      validate(mapping("pokemon - firered version (usa, europe)"), file),
    ).toEqual({ valid: true, association: "proven" });
    expect(
      validate(mapping("pokemon - leafgreen version (usa)"), file),
    ).toEqual({ valid: true, association: "requires_confirmation" });
    expect(
      validate(mapping("pokemon firered.gba"), {
        kind: "file",
        filePath: String.raw`D:\ROMs\Pokemon FireRed.sav`,
      }),
    ).toEqual({ valid: false, reason: "unsupported-content-file" });
  });

  it("accepts both mGBA executables as the emulator binary", () => {
    expect(
      isValidEmulatorBinaryPath("mgba", String.raw`C:\mGBA\mGBA.exe`),
    ).toBe(true);
    expect(
      isValidEmulatorBinaryPath("mgba", String.raw`C:\mGBA\mgba-sdl.exe`),
    ).toBe(true);
    expect(
      isValidEmulatorBinaryPath("mgba", String.raw`C:\mGBA\updater.exe`),
    ).toBe(false);
  });
});
