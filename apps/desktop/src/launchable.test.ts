import { describe, expect, it } from "vitest";
import type { EmulatorLaunchTarget } from "./emulatorLaunch";
import type { EmulatorMapping } from "./emulators/types";
import type { LaunchTargetLike } from "./gameLaunch";
import { isLaunchable, type LaunchSources } from "./launchable";

const owner = { gameId: 42, source: "igdb" as const };

function sources(overrides: Partial<LaunchSources> = {}): LaunchSources {
  return {
    launchTargets: new Map(),
    manualLaunchTargets: new Map(),
    exeCache: new Map(),
    scopedExeLinks: new Map(),
    emulatorMappings: new Map(),
    emulatorAutoLaunchTargets: new Map(),
    emulatorManualLaunchTargets: new Map(),
    ...overrides,
  };
}

function game(overrides: Partial<Parameters<typeof isLaunchable>[0]> = {}) {
  return {
    exeNames: ["game.exe"],
    aliases: [owner],
    emulatorContentKeys: [],
    libraryImports: [],
    ...overrides,
  };
}

function mapping(contentValue: string): EmulatorMapping {
  return {
    contentKey: `dolphin:rom:${contentValue}`,
    emulatorId: "dolphin",
    label: "Dolphin",
    contentKind: "rom",
    contentValue,
    display: contentValue,
    trust: "recognized",
    decision: "game",
    gameId: 42,
    confidence: "user",
    decidedAt: "2026-09-27T00:00:00.000Z",
    lastSeenAt: "2026-09-27T00:00:00.000Z",
  };
}

function romTarget(contentKey: string): EmulatorLaunchTarget {
  return {
    contentKey,
    emulatorId: "dolphin",
    filePath: String.raw`C:\Roms\game.rvz`,
    setAt: "2026-09-27T00:00:00.000Z",
  };
}

const exeTarget: LaunchTargetLike = {
  exeName: "game.exe",
  path: String.raw`C:\Games\Game\game.exe`,
  owner,
};

describe("isLaunchable", () => {
  it("is false for a game PlayCounter knows no way to start", () => {
    expect(isLaunchable(game(), sources())).toBe(false);
  });

  it.each(["steam", "xbox", "epic"])(
    "counts an installed %s copy, not an uninstalled one",
    (provider) => {
      const installed = { provider, installed: true };
      expect(
        isLaunchable(game({ libraryImports: [installed] }), sources()),
      ).toBe(true);
      expect(
        isLaunchable(
          game({ libraryImports: [{ ...installed, installed: false }] }),
          sources(),
        ),
      ).toBe(false);
    },
  );

  it("does not count a Battle.net install, which only opens the launcher", () => {
    expect(
      isLaunchable(
        game({ libraryImports: [{ provider: "battlenet", installed: true }] }),
        sources(),
      ),
    ).toBe(false);
  });

  it("counts a remembered .exe of the game and a manually set one", () => {
    expect(
      isLaunchable(
        game(),
        sources({ launchTargets: new Map([["game.exe", exeTarget]]) }),
      ),
    ).toBe(true);
    expect(
      isLaunchable(
        game({ exeNames: [] }),
        sources({ manualLaunchTargets: new Map([["42:igdb", exeTarget]]) }),
      ),
    ).toBe(true);
  });

  it("ignores a remembered .exe that belongs to another game", () => {
    expect(
      isLaunchable(
        game(),
        sources({
          launchTargets: new Map([
            ["game.exe", { ...exeTarget, owner: { gameId: 7, source: null } }],
          ]),
        }),
      ),
    ).toBe(false);
  });

  it("counts one emulator game with a known ROM, but not two or none", () => {
    const zelda = mapping("zelda.rvz");
    const mario = mapping("mario.rvz");
    const withRom = sources({
      emulatorMappings: new Map([
        [zelda.contentKey, zelda],
        [mario.contentKey, mario],
      ]),
      emulatorAutoLaunchTargets: new Map([
        [zelda.contentKey, romTarget(zelda.contentKey)],
      ]),
    });
    expect(
      isLaunchable(
        game({ exeNames: [], emulatorContentKeys: [zelda.contentKey] }),
        withRom,
      ),
    ).toBe(true);
    expect(
      isLaunchable(
        game({ exeNames: [], emulatorContentKeys: [mario.contentKey] }),
        withRom,
      ),
    ).toBe(false);
    expect(
      isLaunchable(
        game({
          exeNames: [],
          emulatorContentKeys: [zelda.contentKey, mario.contentKey],
        }),
        withRom,
      ),
    ).toBe(false);
  });
});
