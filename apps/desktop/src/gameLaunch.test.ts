import { describe, expect, it } from "vitest";
import {
  findManualLaunchTarget,
  isWindowsExecutablePath,
  isVolatileLaunchPath,
  launchErrorKind,
  launchErrorMessage,
  launchFileBaseName,
  launchTargetsForGame,
  matchesTrackedExeName,
  manualLaunchTargetKey,
  resolveLaunchOwner,
  shouldForgetLaunchTarget,
  shouldForgetOnLaunchError,
  type LaunchTargetLike,
} from "./gameLaunch";

const target: LaunchTargetLike = {
  exeName: "Mixtape.exe",
  path: String.raw`C:\Games\Mixtape.exe`,
  owner: { gameId: 7, source: "igdb" },
};

describe("game launch helpers", () => {
  it("accepts only absolute Windows executable paths", () => {
    expect(isWindowsExecutablePath(String.raw`C:\Games\Game.exe`)).toBe(true);
    expect(isWindowsExecutablePath("c:/games/GAME.EXE")).toBe(true);
    expect(isWindowsExecutablePath(String.raw`\\nas\share\Game.exe`)).toBe(
      true,
    );
    expect(isWindowsExecutablePath("/home/u/.wine/drive_c/Game.exe")).toBe(
      false,
    );
    expect(isWindowsExecutablePath(String.raw`C:\Games\Game.bat`)).toBe(false);
    expect(isWindowsExecutablePath("Game.exe")).toBe(false);
    expect(isWindowsExecutablePath(null)).toBe(false);
  });

  it("handles executable basenames case-insensitively", () => {
    expect(launchFileBaseName(String.raw`C:\Games\Game.exe`)).toBe("Game.exe");
    expect(matchesTrackedExeName("c:/games/GAME.EXE", ["Game.exe"])).toBe(true);
    expect(matchesTrackedExeName("c:/games/Launcher.exe", ["Game.exe"])).toBe(
      false,
    );
  });

  it("keys manual targets by game owner and resolves them through aliases", () => {
    const oldOwner = { gameId: -7, source: "custom" as const };
    const currentOwner = { gameId: 7, source: "community" as const };
    const manualTarget = {
      exeName: "Launcher.exe",
      path: String.raw`C:\Games\Launcher.exe`,
      owner: oldOwner,
    };
    const targets = new Map([[manualLaunchTargetKey(oldOwner), manualTarget]]);

    expect(manualLaunchTargetKey({ gameId: 7, source: null })).toBe("7:null");
    expect(
      manualLaunchTargetKey({ gameId: 7, source: undefined } as never),
    ).toBe("7:null");
    expect(findManualLaunchTarget([currentOwner, oldOwner], targets)).toBe(
      manualTarget,
    );
    expect(findManualLaunchTarget([currentOwner], targets)).toBeUndefined();
  });

  it("recognizes volatile Temp paths without rejecting installed folders", () => {
    expect(
      isVolatileLaunchPath(String.raw`C:\Users\Me\AppData\Local\Temp\gg5.exe`),
    ).toBe(true);
    expect(
      isVolatileLaunchPath(String.raw`C:\Games\Temporary Heroes\game.exe`),
    ).toBe(false);
  });

  it("forgets only definitive stale path states", () => {
    expect(shouldForgetLaunchTarget("missing")).toBe(true);
    expect(shouldForgetLaunchTarget("notAFile")).toBe(true);
    expect(shouldForgetLaunchTarget("invalid")).toBe(true);
    expect(shouldForgetLaunchTarget("unreadable")).toBe(false);
    expect(shouldForgetOnLaunchError("notFound")).toBe(true);
    expect(shouldForgetOnLaunchError("unreadable")).toBe(false);
    expect(shouldForgetOnLaunchError("spawnFailed")).toBe(false);
  });

  it("uses the current matched cache owner", () => {
    const cache = new Map([
      [
        "mixtape.exe",
        { state: "matched", gameId: 9, source: "custom" as const },
      ],
    ]);
    expect(resolveLaunchOwner("mixtape.exe", target, cache)).toEqual({
      gameId: 9,
      source: "custom",
    });
    expect(resolveLaunchOwner("mixtape.exe", target, new Map())).toEqual(
      target.owner,
    );
  });

  it("never exposes a shared executable on the wrong game card", () => {
    const launchTargets = new Map([["mixtape.exe", target]]);
    const exeCache = new Map([
      ["mixtape.exe", { state: "matched", gameId: 7, source: "igdb" as const }],
    ]);
    const common = {
      exeNames: ["Mixtape.exe"],
      launchTargets,
      exeCache,
    };
    expect(
      launchTargetsForGame({
        ...common,
        aliases: [{ gameId: 7, source: "igdb" }],
      }),
    ).toEqual([target]);
    expect(
      launchTargetsForGame({
        ...common,
        aliases: [{ gameId: 9, source: "custom" }],
      }),
    ).toEqual([]);
  });

  it("moves ownership on rematch without rewriting the target", () => {
    const launchTargets = new Map([["mixtape.exe", target]]);
    const exeCache = new Map([
      [
        "mixtape.exe",
        { state: "matched", gameId: 9, source: "custom" as const },
      ],
    ]);
    expect(
      launchTargetsForGame({
        exeNames: ["Mixtape.exe"],
        aliases: [{ gameId: 7, source: "igdb" }],
        launchTargets,
        exeCache,
      }),
    ).toEqual([]);
    expect(
      launchTargetsForGame({
        exeNames: ["Mixtape.exe"],
        aliases: [{ gameId: 9, source: "custom" }],
        launchTargets,
        exeCache,
      }),
    ).toEqual([target]);
  });

  it("formats structured and unstructured launch errors", () => {
    expect(launchErrorKind({ kind: "notFound" })).toBe("notFound");
    expect(launchErrorKind(new Error("nope"))).toBeNull();
    expect(
      launchErrorMessage({ kind: "notFound", message: "Gone." }, "Game"),
    ).toMatchObject({ title: "Game file not found" });
    expect(launchErrorMessage(new Error("Blocked"), "Game")).toEqual({
      title: "Game could not be started",
      detail: "Blocked",
    });
    expect(
      launchErrorKind(JSON.stringify({ kind: "notFound", message: "Gone" })),
    ).toBe("notFound");
    expect(
      launchErrorMessage(
        JSON.stringify({ kind: "spawnFailed", message: "Denied" }),
        "Game",
      ),
    ).toEqual({ title: "Game could not be started", detail: "Denied" });
  });
});
