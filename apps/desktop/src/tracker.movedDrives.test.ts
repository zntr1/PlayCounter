import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STORAGE_KEY } from "./persistence";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (value: string) => value,
  invoke: invokeMock,
}));
vi.mock("./desktopOverlayBridge", async (importOriginal) => ({
  initializeDesktopOverlays: vi.fn(),
  disposeDesktopOverlays: vi.fn(),
  armDesktopOverlays: vi.fn(),
  emitOverlayEvent: vi.fn(),
  noteDiscoveredExecutable: vi.fn(),
  showCurrentSessionOverlay: vi.fn(),
  showPauseToggledOverlay: vi.fn(),
  newestSession: (
    await importOriginal<typeof import("./desktopOverlayBridge")>()
  ).newestSession,
}));
vi.mock("./controllerBridge", () => ({
  initializeControllerBridge: vi.fn(),
  disposeControllerBridge: vi.fn(),
  armControllerBridge: vi.fn(),
}));
vi.mock("./automaticBackups", () => ({
  initializeAutomaticBackups: vi.fn(),
  disposeAutomaticBackups: vi.fn(),
}));
vi.mock("./achievements/backgroundRefresh", () => ({
  schedulePostGameAchievementRefresh: vi.fn(),
  disposePostGameAchievementRefresh: vi.fn(),
}));

import { manualLaunchTargetKey } from "./gameLaunch";
import { findMovedDrives, resetMovedDrives } from "./library/movedDrives";
import { scopedExeLinkKey } from "./library/scopedLinks";
import type { IgnoredExeFolder, ScopedExeLink } from "./library/types";
import {
  readWatchFolders,
  writeWatchFolders,
} from "./library/watchFolderState";
import { useAppStore, type ProcessSnapshot } from "./store";
import type { EmulatorMapping } from "./emulators/types";
import {
  initializeTracker,
  launchEmulatorGame,
  launchGame,
  scanProcessesNow,
} from "./tracker";

/* A disk got another letter (docs/drive-letter-plan.md) ────────────────────
   Windows gave the disk that was D: the letter E:. Everything PlayCounter
   stored on D: is found again on E:, like Playnite does it: a stored path
   that is gone is tried on the other drives, and the first one that has it
   wins. The Rust side does the looking (find_moved_paths); here the fake
   answers "D: is now E:" unless a test says otherwise. */

const SET_AT = "2026-11-20T10:00:00.000Z";
const TUPAC_FOLDER = String.raw`D:\Games\Tupac`;
const TUPAC_EXE = String.raw`D:\Games\Tupac\Game.exe`;

let storage: Map<string, string>;
let processes: ProcessSnapshot[];
/** Where the fake Rust side finds a gone path; null = nowhere. */
let findsAt: (path: string) => string | null;
/** What starting a file on D: fails with. With the old disk gone, Rust can't
 *  tell a missing file from an unplugged drive: "unreadable". */
let failsOnD: { kind: string; message: string };

function onE(path: string) {
  return `E:${path.slice(2)}`;
}

/** The paths sent to find_moved_paths, call by call. */
function probes() {
  return invokeMock.mock.calls
    .filter(([command]) => command === "find_moved_paths")
    .map(([, args]) => (args as { paths: string[] }).paths);
}

function saved(path: string) {
  const escaped = JSON.stringify(path).slice(1, -1);
  return [...storage.values()].some((value) => value.includes(escaped));
}

function tupacLink(folder = TUPAC_FOLDER, gameId = -5): ScopedExeLink {
  return {
    exeName: "Game.exe",
    pathPrefix: folder,
    exePath: `${folder}\\Game.exe`,
    gameId,
    source: "custom",
    gameName: "Tupac",
    coverUrl: "",
    setAt: SET_AT,
  };
}

function linksByKey(...links: ScopedExeLink[]) {
  return new Map(
    links.map((link) => [
      scopedExeLinkKey(link.exeName, link.pathPrefix)!,
      link,
    ]),
  );
}

function ignored(folder: string): IgnoredExeFolder {
  return { exeName: "Game.exe", pathPrefix: folder, ignoredAt: SET_AT };
}

function ignoresByKey(...entries: IgnoredExeFolder[]) {
  return new Map(
    entries.map((entry) => [
      scopedExeLinkKey(entry.exeName, entry.pathPrefix)!,
      entry,
    ]),
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-24T12:00:00.000Z"));
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal("navigator", { platform: "Win32", userAgent: "Windows" });
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Offline")));
  storage = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  useAppStore.setState(useAppStore.getInitialState(), true);
  useAppStore.setState({
    backendHealth: { status: "offline", checkedAt: null, detail: "Offline" },
  });
  resetMovedDrives();
  processes = [];
  findsAt = (path) => (/^d:/i.test(path) ? onE(path) : null);
  failsOnD = { kind: "unreadable", message: "The device is not ready." };
  invokeMock.mockReset();
  invokeMock.mockImplementation(
    async (command: string, args?: Record<string, unknown>) => {
      if (command === "launch_executable") {
        if (/^d:/i.test(args!.path as string)) throw failsOnD;
        return undefined;
      }
      if (command === "launch_emulator_content") {
        const request = args!.request as Record<string, string>;
        if (
          [request.exePath, request.contentPath].some((path) =>
            /^d:/i.test(path),
          )
        ) {
          throw { kind: "notFound", message: "Gone." };
        }
        return { kind: "spawned" };
      }
      if (command === "find_moved_paths") {
        return (args!.paths as string[]).map((path) => ({
          path,
          movedTo: findsAt(path),
        }));
      }
      if (command === "verify_launch_paths") {
        return (args!.paths as string[]).map((path) => ({
          path,
          status: /^d:/i.test(path) ? "missing" : "ok",
        }));
      }
      if (command === "scan_processes") return processes;
      if (command === "privacy_context") return {};
      if (command === "install_uuid") return "moved-drives-test-install";
      if (command === "ignored_processes") {
        return { processes: [], userProcesses: [], userFilePath: null };
      }
      return undefined;
    },
  );
});

afterEach(() => {
  useAppStore.getState().cleanup?.();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("at app start", () => {
  const owner = { gameId: 1, source: "igdb" as const };
  const rows: Array<{
    name: string;
    oldPath: string;
    seed: () => void;
    stored: () => unknown;
  }> = [
    {
      name: "a Play file learned from a run",
      oldPath: String.raw`D:\Games\Hades\Hades.exe`,
      seed: () =>
        useAppStore.setState({
          launchTargets: new Map([
            [
              "hades.exe",
              {
                exeName: "Hades.exe",
                path: String.raw`D:\Games\Hades\Hades.exe`,
                owner,
              },
            ],
          ]),
        }),
      stored: () => useAppStore.getState().launchTargets.get("hades.exe")?.path,
    },
    {
      name: "a Play file set by hand",
      oldPath: String.raw`D:\Games\Hades\Launcher.exe`,
      seed: () =>
        useAppStore.setState({
          manualLaunchTargets: new Map([
            [
              manualLaunchTargetKey(owner),
              {
                exeName: "Launcher.exe",
                path: String.raw`D:\Games\Hades\Launcher.exe`,
                owner,
              },
            ],
          ]),
        }),
      stored: () =>
        useAppStore
          .getState()
          .manualLaunchTargets.get(manualLaunchTargetKey(owner))?.path,
    },
    {
      name: "an emulator program PlayCounter found",
      oldPath: String.raw`D:\Emulators\PCSX2\pcsx2-qt.exe`,
      seed: () =>
        useAppStore.setState({
          emulatorAutoBinaries: new Map([
            [
              "pcsx2",
              {
                emulatorId: "pcsx2",
                exePath: String.raw`D:\Emulators\PCSX2\pcsx2-qt.exe`,
                setAt: SET_AT,
              },
            ],
          ]),
        }),
      stored: () =>
        useAppStore.getState().emulatorAutoBinaries.get("pcsx2")?.exePath,
    },
    {
      name: "an emulator program set by hand",
      oldPath: String.raw`D:\Emulators\Dolphin\Dolphin.exe`,
      seed: () =>
        useAppStore.setState({
          emulatorManualBinaries: new Map([
            [
              "dolphin",
              {
                emulatorId: "dolphin",
                exePath: String.raw`D:\Emulators\Dolphin\Dolphin.exe`,
                setAt: SET_AT,
              },
            ],
          ]),
        }),
      stored: () =>
        useAppStore.getState().emulatorManualBinaries.get("dolphin")?.exePath,
    },
    {
      name: "an emulator game file PlayCounter found",
      oldPath: String.raw`D:\ROMs\PS2\Okami.iso`,
      seed: () =>
        useAppStore.setState({
          emulatorAutoLaunchTargets: new Map([
            [
              "pcsx2:file:okami.iso",
              {
                contentKey: "pcsx2:file:okami.iso",
                emulatorId: "pcsx2",
                filePath: String.raw`D:\ROMs\PS2\Okami.iso`,
                setAt: SET_AT,
              },
            ],
          ]),
        }),
      stored: () =>
        useAppStore
          .getState()
          .emulatorAutoLaunchTargets.get("pcsx2:file:okami.iso")?.filePath,
    },
    {
      name: "an emulator game file set by hand",
      oldPath: String.raw`D:\ROMs\GC\Zelda.rvz`,
      seed: () =>
        useAppStore.setState({
          emulatorManualLaunchTargets: new Map([
            [
              "dolphin:file:zelda.rvz",
              {
                contentKey: "dolphin:file:zelda.rvz",
                emulatorId: "dolphin",
                filePath: String.raw`D:\ROMs\GC\Zelda.rvz`,
                setAt: SET_AT,
              },
            ],
          ]),
        }),
      stored: () =>
        useAppStore
          .getState()
          .emulatorManualLaunchTargets.get("dolphin:file:zelda.rvz")?.filePath,
    },
    {
      name: "an emulator game file offered to Play",
      oldPath: String.raw`D:\ROMs\PS2\Ico.iso`,
      seed: () =>
        useAppStore.setState({
          emulatorLaunchCandidates: new Map([
            [
              "pcsx2:file:ico.iso",
              {
                contentKey: "pcsx2:file:ico.iso",
                emulatorId: "pcsx2",
                filePath: String.raw`D:\ROMs\PS2\Ico.iso`,
                displayName: "Ico",
                setAt: SET_AT,
              },
            ],
          ]),
        }),
      stored: () =>
        useAppStore
          .getState()
          .emulatorLaunchCandidates.get("pcsx2:file:ico.iso")?.filePath,
    },
    {
      name: "a Discovered app's last seen file",
      oldPath: String.raw`D:\Indie\Unknown\Unknown.exe`,
      seed: () =>
        useAppStore.setState({
          exeCache: new Map([
            [
              "unknown.exe",
              {
                exeName: "Unknown.exe",
                state: "unmatched",
                lastCheckedAt: SET_AT,
                exePath: String.raw`D:\Indie\Unknown\Unknown.exe`,
              },
            ],
          ]),
        }),
      stored: () => useAppStore.getState().exeCache.get("unknown.exe")?.exePath,
    },
    {
      name: "software's last seen file",
      oldPath: String.raw`D:\Apps\Discord\Discord.exe`,
      seed: () =>
        useAppStore.setState({
          toolUsage: {
            "discord.exe": {
              exePath: String.raw`D:\Apps\Discord\Discord.exe`,
              days: { "2026-11-20": 600 },
            },
          },
        }),
      stored: () => useAppStore.getState().toolUsage["discord.exe"]?.exePath,
    },
  ];

  it.each(rows)("finds $name on the new letter and saves it", async (row) => {
    row.seed();

    await expect(findMovedDrives("test")).resolves.toBe(1);

    expect(probes().flat()).toContain(row.oldPath);
    expect(row.stored()).toBe(onE(row.oldPath));
    expect(saved(onE(row.oldPath))).toBe(true);
  });

  it("moves a Game.exe folder link to its new folder, file and all", async () => {
    useAppStore.setState({ scopedExeLinks: linksByKey(tupacLink()) });

    await findMovedDrives("test");

    const links = useAppStore.getState().scopedExeLinks;
    expect(links.has(scopedExeLinkKey("Game.exe", TUPAC_FOLDER)!)).toBe(false);
    expect(links.get(scopedExeLinkKey("Game.exe", onE(TUPAC_FOLDER))!)).toEqual(
      {
        ...tupacLink(),
        pathPrefix: onE(TUPAC_FOLDER),
        exePath: onE(TUPAC_EXE),
      },
    );
    expect(saved(onE(TUPAC_FOLDER))).toBe(true);
  });

  it("moves a Game.exe folder ignore to its new folder", async () => {
    const junk = String.raw`D:\Games\Junk`;
    useAppStore.setState({ ignoredExeFolders: ignoresByKey(ignored(junk)) });

    await findMovedDrives("test");

    const folders = useAppStore.getState().ignoredExeFolders;
    expect(folders.has(scopedExeLinkKey("Game.exe", junk)!)).toBe(false);
    expect(folders.get(scopedExeLinkKey("Game.exe", onE(junk))!)).toEqual(
      ignored(onE(junk)),
    );
    expect(saved(onE(junk))).toBe(true);
  });

  it("moves watch folders, the game folders they found, finds and dismissals", async () => {
    writeWatchFolders({
      folders: [String.raw`D:\Games`],
      seen: {
        [String.raw`d:\games\tupac`]: { kind: "game", exeName: "Game.exe" },
      },
      pending: {
        "new.exe": {
          exePath: String.raw`D:\Games\New\New.exe`,
          folderPath: String.raw`D:\Games\New`,
          folderName: "New",
        },
      },
      dismissed: [
        { folderPath: String.raw`D:\Games\Junk`, exeName: "Junk.exe" },
      ],
    });

    await findMovedDrives("test");

    expect(readWatchFolders()).toEqual({
      folders: [String.raw`E:\Games`],
      seen: {
        [String.raw`e:\games\tupac`]: { kind: "game", exeName: "Game.exe" },
      },
      pending: {
        "new.exe": {
          exePath: String.raw`E:\Games\New\New.exe`,
          folderPath: String.raw`E:\Games\New`,
          folderName: "New",
        },
      },
      dismissed: [
        { folderPath: String.raw`E:\Games\Junk`, exeName: "Junk.exe" },
      ],
    });
  });

  it("leaves a path no other drive has as it is", async () => {
    findsAt = () => null;
    const target = {
      exeName: "Hades.exe",
      path: String.raw`D:\Games\Hades\Hades.exe`,
      owner,
    };
    useAppStore.setState({ launchTargets: new Map([["hades.exe", target]]) });

    await expect(findMovedDrives("test")).resolves.toBe(0);

    expect(useAppStore.getState().launchTargets.get("hades.exe")).toEqual(
      target,
    );
  });

  it("keeps a folder link the new folder already has, and the old one too", async () => {
    const replay = { ...tupacLink(onE(TUPAC_FOLDER), -9), gameName: "Tupac 2" };
    useAppStore.setState({ scopedExeLinks: linksByKey(tupacLink(), replay) });

    await findMovedDrives("test");

    const links = useAppStore.getState().scopedExeLinks;
    expect(links.get(scopedExeLinkKey("Game.exe", onE(TUPAC_FOLDER))!)).toEqual(
      replay,
    );
    expect(links.get(scopedExeLinkKey("Game.exe", TUPAC_FOLDER)!)).toEqual(
      tupacLink(),
    );
  });

  it("keeps a folder ignore the new folder already has, and the old one too", async () => {
    const junk = String.raw`D:\Games\Junk`;
    const newer = {
      ...ignored(onE(junk)),
      ignoredAt: "2026-11-23T08:00:00.000Z",
    };
    useAppStore.setState({
      ignoredExeFolders: ignoresByKey(ignored(junk), newer),
    });

    await findMovedDrives("test");

    const folders = useAppStore.getState().ignoredExeFolders;
    expect(folders.get(scopedExeLinkKey("Game.exe", onE(junk))!)).toEqual(
      newer,
    );
    expect(folders.get(scopedExeLinkKey("Game.exe", junk)!)).toEqual(
      ignored(junk),
    );
  });

  it("keeps a game folder a watch folder already found in the new place", async () => {
    writeWatchFolders({
      folders: [],
      seen: {
        [String.raw`d:\games\tupac`]: { kind: "game", exeName: "Game.exe" },
        [String.raw`e:\games\tupac`]: { kind: "empty" },
      },
      pending: {},
      dismissed: [],
    });

    await findMovedDrives("test");

    expect(readWatchFolders().seen).toEqual({
      [String.raw`d:\games\tupac`]: { kind: "game", exeName: "Game.exe" },
      [String.raw`e:\games\tupac`]: { kind: "empty" },
    });
  });

  it("looks for nothing off Windows", async () => {
    vi.stubGlobal("navigator", {
      platform: "MacIntel",
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)",
    });
    useAppStore.setState({ scopedExeLinks: linksByKey(tupacLink()) });

    await expect(findMovedDrives("test")).resolves.toBe(0);

    expect(probes()).toEqual([]);
  });

  it("looks before the start's Play check, so a moved Play file is kept", async () => {
    storage.set(
      STORAGE_KEY,
      JSON.stringify({
        launchTargets: [
          {
            exeName: "Hades.exe",
            path: String.raw`D:\Games\Hades\Hades.exe`,
            owner,
          },
        ],
      }),
    );

    await initializeTracker();
    await vi.advanceTimersByTimeAsync(3000);

    const commands = invokeMock.mock.calls.map(([command]) => command);
    expect(commands).toContain("verify_launch_paths");
    expect(commands.indexOf("find_moved_paths")).toBeGreaterThanOrEqual(0);
    expect(commands.indexOf("find_moved_paths")).toBeLessThan(
      commands.indexOf("verify_launch_paths"),
    );
    expect(useAppStore.getState().launchTargets.get("hades.exe")?.path).toBe(
      String.raw`E:\Games\Hades\Hades.exe`,
    );
  });
});

describe("while a game runs", () => {
  function run(exePath: string, pid = 7) {
    processes = [{ exeName: exePath.replace(/^.*\\/, ""), exePath, pid }];
  }

  it("tracks Game.exe from the re-lettered disk under its folder link in the same scan", async () => {
    useAppStore.setState({ scopedExeLinks: linksByKey(tupacLink()) });
    run(onE(TUPAC_EXE));

    await scanProcessesNow();

    expect(useAppStore.getState().activeSessions).toMatchObject([
      { gameId: -5, gameName: "Tupac" },
    ]);
    expect(useAppStore.getState().ambiguousMatches).toEqual([]);
    expect(
      useAppStore
        .getState()
        .scopedExeLinks.get(scopedExeLinkKey("Game.exe", onE(TUPAC_FOLDER))!),
    ).toMatchObject({ gameId: -5, exePath: onE(TUPAC_EXE) });
  });

  it("keeps ignoring Game.exe from an ignored folder on the re-lettered disk", async () => {
    const junk = String.raw`D:\Games\Junk`;
    useAppStore.setState({ ignoredExeFolders: ignoresByKey(ignored(junk)) });
    run(String.raw`E:\Games\Junk\Game.exe`);

    await scanProcessesNow();

    expect(useAppStore.getState().activeSessions).toEqual([]);
    expect(useAppStore.getState().ambiguousMatches).toEqual([]);
    expect(useAppStore.getState().exeCache.has("game.exe")).toBe(false);
    expect(
      useAppStore
        .getState()
        .ignoredExeFolders.has(scopedExeLinkKey("Game.exe", onE(junk))!),
    ).toBe(true);
  });

  it("leaves a second copy alone when the old folder still exists, and looks once", async () => {
    findsAt = () => null;
    useAppStore.setState({ scopedExeLinks: linksByKey(tupacLink()) });
    run(onE(TUPAC_EXE));

    await scanProcessesNow();
    await scanProcessesNow();

    expect(probes()).toHaveLength(1);
    expect(useAppStore.getState().activeSessions).toEqual([]);
    expect([...useAppStore.getState().scopedExeLinks.values()]).toEqual([
      tupacLink(),
    ]);
  });

  it("looks for nothing when no link matches the folder, not even with another letter", async () => {
    useAppStore.setState({ scopedExeLinks: linksByKey(tupacLink()) });
    run(String.raw`E:\Games\Solitaire\Game.exe`);

    await scanProcessesNow();

    expect(probes()).toEqual([]);
  });
});

describe("when Play is pressed", () => {
  const owner = { gameId: 1, source: "igdb" as const };
  const hades = {
    exeName: "Hades.exe",
    path: String.raw`D:\Games\Hades\Hades.exe`,
    owner,
  };

  function started() {
    return invokeMock.mock.calls
      .filter(([command]) => command === "launch_executable")
      .map(([, args]) => (args as { path: string }).path);
  }

  beforeEach(() => {
    useAppStore.getState().setLauncherSetting("gameLaunchingEnabled", true);
  });

  it("finds the Play file on the re-lettered disk, saves it there and starts it", async () => {
    useAppStore.setState({ launchTargets: new Map([["hades.exe", hades]]) });

    await expect(launchGame(hades)).resolves.toBe("launched");

    expect(started()).toEqual([hades.path, onE(hades.path)]);
    expect(useAppStore.getState().launchTargets.get("hades.exe")?.path).toBe(
      onE(hades.path),
    );
    expect(saved(onE(hades.path))).toBe(true);
  });

  it("finds a Play file set by hand the same way", async () => {
    const launcher = {
      ...hades,
      exeName: "Launcher.exe",
      path: String.raw`D:\Games\Hades\Launcher.exe`,
    };
    useAppStore.setState({
      manualLaunchTargets: new Map([[manualLaunchTargetKey(owner), launcher]]),
    });

    await expect(launchGame(launcher)).resolves.toBe("launched");

    expect(started().at(-1)).toBe(onE(launcher.path));
    expect(
      useAppStore
        .getState()
        .manualLaunchTargets.get(manualLaunchTargetKey(owner))?.path,
    ).toBe(onE(launcher.path));
  });

  it("still fails and forgets the file when no other drive has it", async () => {
    findsAt = () => null;
    failsOnD = { kind: "notFound", message: "PlayCounter no longer finds it." };
    useAppStore.setState({ launchTargets: new Map([["hades.exe", hades]]) });

    await expect(launchGame(hades)).rejects.toEqual(failsOnD);

    expect(started()).toEqual([hades.path]);
    expect(useAppStore.getState().launchTargets.has("hades.exe")).toBe(false);
  });

  it("looks on no other drive when the start failed for another reason", async () => {
    failsOnD = { kind: "spawnFailed", message: "Needs administrator rights." };
    useAppStore.setState({ launchTargets: new Map([["hades.exe", hades]]) });

    await expect(launchGame(hades)).rejects.toEqual(failsOnD);

    expect(probes()).toEqual([]);
    expect(started()).toEqual([hades.path]);
  });

  it("finds an emulator's program and game file on the re-lettered disk and starts them", async () => {
    const contentKey = "pcsx2:file:okami.iso";
    const binary = {
      emulatorId: "pcsx2",
      exePath: String.raw`D:\Emulators\PCSX2\pcsx2-qt.exe`,
      setAt: SET_AT,
    };
    const game = {
      contentKey,
      emulatorId: "pcsx2",
      filePath: String.raw`D:\ROMs\PS2\Okami.iso`,
      setAt: SET_AT,
    };
    useAppStore.setState({
      emulatorAutoBinaries: new Map([["pcsx2", binary]]),
      emulatorAutoLaunchTargets: new Map([[contentKey, game]]),
    });
    const mapping = {
      contentKey,
      emulatorId: "pcsx2",
      label: "PCSX2",
    } as EmulatorMapping;

    await expect(launchEmulatorGame(mapping)).resolves.toEqual({
      kind: "spawned",
    });

    expect(invokeMock).toHaveBeenLastCalledWith("launch_emulator_content", {
      request: {
        emulatorId: "pcsx2",
        exePath: onE(binary.exePath),
        contentPath: onE(game.filePath),
      },
    });
    expect(
      useAppStore.getState().emulatorAutoBinaries.get("pcsx2")?.exePath,
    ).toBe(onE(binary.exePath));
    expect(
      useAppStore.getState().emulatorAutoLaunchTargets.get(contentKey)
        ?.filePath,
    ).toBe(onE(game.filePath));
  });
});
