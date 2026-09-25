// @vitest-environment happy-dom
import type { Game } from "@playcounter/shared";
import { invoke } from "@tauri-apps/api/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../store";
import {
  adoptFolderGame,
  lookupFolderExecutables,
  noteFolderExecutable,
} from "../tracker";
import type { ScannedExecutable } from "./types";
import {
  resetWatchFolderScan,
  scanWatchFolders,
  startWatchFolderLinks,
} from "./watchFolders";
import {
  addWatchFolder,
  readWatchFolders,
  removeWatchFolder,
  restoreDismissedFolder,
  writeWatchFolders,
} from "./watchFolderState";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  convertFileSrc: (value: string) => value,
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("../platform", () => ({ currentPlatform: () => "windows" }));
vi.mock("../tracker", () => ({
  adoptFolderGame: vi.fn(),
  lookupFolderExecutables: vi.fn(),
  noteFolderExecutable: vi.fn(),
}));

const WATCHED = "D:\\Games";

function game(id: number, name: string): Game {
  return { id, igdbId: id, name, coverUrl: "", source: "igdb" };
}

function exe(fileName: string, relativePath = fileName): ScannedExecutable {
  return {
    fileName,
    relativePath,
    sizeBytes: 5_000_000,
    depth: relativePath.split("/").length - 1,
    declared: false,
  };
}

function folder(name: string) {
  return { watchFolder: WATCHED, path: `${WATCHED}\\${name}`, name };
}

function mockFolders(
  folders: Record<
    string,
    { executables: ScannedExecutable[]; capped?: boolean }
  >,
) {
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === "watch_folder_game_folders") {
      return Object.keys(folders).map(folder);
    }
    if (command === "watch_folder_scan") {
      const name = (args as { path: string }).path.split("\\").at(-1)!;
      return { capped: false, ...folders[name] };
    }
    return undefined;
  });
}

type MatchResult = Awaited<ReturnType<typeof lookupFolderExecutables>>;

function mockMatches(
  results: Record<
    string,
    Partial<MatchResult extends Map<string, infer R> ? R : never>
  >,
) {
  vi.mocked(lookupFolderExecutables).mockResolvedValue(
    new Map(
      Object.entries(results).map(([key, result]) => [
        key,
        { key, game: null, ...result },
      ]),
    ) as MatchResult,
  );
}

beforeEach(() => {
  localStorage.clear();
  resetWatchFolderScan();
  vi.mocked(invoke).mockReset();
  vi.mocked(adoptFolderGame).mockReset();
  vi.mocked(noteFolderExecutable).mockReset();
  vi.mocked(lookupFolderExecutables).mockReset();
  vi.mocked(lookupFolderExecutables).mockResolvedValue(new Map());
  useAppStore.setState(useAppStore.getInitialState(), true);
  addWatchFolder(WATCHED);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("scanning watched folders", () => {
  it("adds a folder whose file names exactly one game, with its launch file", async () => {
    mockFolders({
      Celeste: {
        executables: [exe("Celeste.exe"), exe("UnityCrashHandler64.exe")],
      },
    });
    mockMatches({ "celeste.exe": { game: game(1, "Celeste") } });

    await expect(scanWatchFolders("test")).resolves.toBe(1);

    expect(adoptFolderGame).toHaveBeenCalledWith(
      "Celeste.exe",
      "D:\\Games\\Celeste\\Celeste.exe",
      game(1, "Celeste"),
    );
    expect(noteFolderExecutable).not.toHaveBeenCalled();
    expect(readWatchFolders().seen).toEqual(["d:\\games\\celeste"]);
    expect(useAppStore.getState().toasts.at(-1)?.title).toBe(
      "1 game found in your folders",
    );
  });

  it("sends unclear folders to Discovered with their folder name", async () => {
    mockFolders({
      Ambiguous: { executables: [exe("Shared.exe")] },
      Flagged: { executables: [exe("launcher.exe", "bin/launcher.exe")] },
      Unknown: { executables: [exe("Tool.exe")] },
    });
    mockMatches({
      "shared.exe": {
        game: null,
        ambiguousGames: [game(1, "One"), game(2, "Two")],
      },
      "launcher.exe": {
        game: game(3, "Three"),
        flaggedIdentifier: { reason: "shared_executable" } as never,
      },
    });

    await expect(scanWatchFolders("test")).resolves.toBe(0);

    expect(adoptFolderGame).not.toHaveBeenCalled();
    expect(noteFolderExecutable).toHaveBeenCalledTimes(3);
    expect(readWatchFolders().pending).toEqual({
      "shared.exe": {
        exePath: "D:\\Games\\Ambiguous\\Shared.exe",
        folderPath: "D:\\Games\\Ambiguous",
        folderName: "Ambiguous",
      },
      "launcher.exe": {
        exePath: "D:\\Games\\Flagged\\bin\\launcher.exe",
        folderPath: "D:\\Games\\Flagged",
        folderName: "Flagged",
      },
      "tool.exe": {
        exePath: "D:\\Games\\Unknown\\Tool.exe",
        folderPath: "D:\\Games\\Unknown",
        folderName: "Unknown",
      },
    });
  });

  it("does not add a folder whose files name different games", async () => {
    mockFolders({
      Bundle: { executables: [exe("GameA.exe"), exe("GameB.exe")] },
    });
    mockMatches({
      "gamea.exe": { game: game(1, "A") },
      "gameb.exe": { game: game(2, "B") },
    });

    await scanWatchFolders("test");
    expect(adoptFolderGame).not.toHaveBeenCalled();
    expect(Object.keys(readWatchFolders().pending)).toHaveLength(1);
  });

  it("looks at each folder once, and retries a walk that was cut short", async () => {
    mockFolders({
      Empty: { executables: [] },
      Huge: { executables: [], capped: true },
    });

    await scanWatchFolders("first");
    expect(readWatchFolders().seen).toEqual(["d:\\games\\empty"]);

    vi.mocked(invoke).mockClear();
    resetWatchFolderScan();
    await scanWatchFolders("second");
    expect(invoke).toHaveBeenCalledWith("watch_folder_scan", {
      path: "D:\\Games\\Huge",
    });
    expect(invoke).not.toHaveBeenCalledWith("watch_folder_scan", {
      path: "D:\\Games\\Empty",
    });
  });

  it("skips dismissed folders and folders a launcher import covers", async () => {
    writeWatchFolders({
      ...readWatchFolders(),
      dismissed: [{ folderPath: "D:\\Games\\Dismissed", exeName: "D.exe" }],
    });
    useAppStore.getState().setLibraryInstall({
      provider: "battlenet",
      externalId: "w3",
      installPath: "d:/games/warcraft iii/_retail_",
      scannedAt: "2026-09-25T12:00:00.000Z",
    });
    mockFolders({
      Dismissed: { executables: [exe("D.exe")] },
      "Warcraft III": { executables: [exe("Warcraft III.exe")] },
    });

    await expect(scanWatchFolders("test")).resolves.toBe(0);
    expect(invoke).not.toHaveBeenCalledWith(
      "watch_folder_scan",
      expect.anything(),
    );
  });

  it("does nothing while launch paths are not remembered", async () => {
    useAppStore.getState().setLauncherSetting("rememberLaunchPaths", false);
    mockFolders({ Celeste: { executables: [exe("Celeste.exe")] } });

    await expect(scanWatchFolders("test")).resolves.toBe(0);
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe("linking Discovered finds back to their folder", () => {
  beforeEach(() => {
    writeWatchFolders({
      ...readWatchFolders(),
      pending: {
        "tool.exe": {
          exePath: "D:\\Games\\Unknown\\Tool.exe",
          folderPath: "D:\\Games\\Unknown",
          folderName: "Unknown",
        },
      },
    });
  });

  it("saves the folder's file as launch file once the find is matched", () => {
    const stop = startWatchFolderLinks();
    useAppStore.getState().setExeCacheEntry({
      exeName: "Tool.exe",
      state: "matched",
      gameId: 7,
      igdbId: 7,
      gameName: "Seven",
      source: "igdb",
      lastCheckedAt: "2026-09-25T12:00:00.000Z",
    });
    stop();

    expect(useAppStore.getState().launchTargets.get("tool.exe")).toEqual({
      exeName: "Tool.exe",
      path: "D:\\Games\\Unknown\\Tool.exe",
      owner: { gameId: 7, source: "igdb" },
    });
    expect(readWatchFolders().pending).toEqual({});
  });

  it("dismisses the folder for good when the find is ignored", () => {
    const stop = startWatchFolderLinks();
    useAppStore.setState({ userIgnoredProcesses: new Set(["tool.exe"]) });
    stop();

    expect(readWatchFolders().dismissed).toEqual([
      { folderPath: "D:\\Games\\Unknown", exeName: "tool.exe" },
    ]);
    expect(readWatchFolders().pending).toEqual({});
  });

  it("does not dismiss a find whose file was ignored before", () => {
    useAppStore.setState({ userIgnoredProcesses: new Set(["tool.exe"]) });
    const stop = startWatchFolderLinks();
    useAppStore.setState({
      userIgnoredProcesses: new Set(["tool.exe", "other.exe"]),
    });
    stop();

    expect(readWatchFolders().dismissed).toEqual([]);
  });
});

describe("watched folder state", () => {
  it("forgets everything under a removed folder", () => {
    writeWatchFolders({
      folders: [WATCHED, "E:\\More"],
      seen: ["d:\\games\\celeste", "e:\\more\\hades"],
      pending: {
        "tool.exe": {
          exePath: "D:\\Games\\Unknown\\Tool.exe",
          folderPath: "D:\\Games\\Unknown",
          folderName: "Unknown",
        },
      },
      dismissed: [{ folderPath: "D:\\Games\\Old", exeName: "Old.exe" }],
    });

    expect(removeWatchFolder("d:\\games")).toEqual({
      folders: ["E:\\More"],
      seen: ["e:\\more\\hades"],
      pending: {},
      dismissed: [],
    });
  });

  it("looks at a restored folder again", () => {
    writeWatchFolders({
      ...readWatchFolders(),
      seen: ["d:\\games\\old"],
      dismissed: [{ folderPath: "D:\\Games\\Old", exeName: "Old.exe" }],
    });
    const record = restoreDismissedFolder("D:\\Games\\Old");
    expect(record.seen).toEqual([]);
    expect(record.dismissed).toEqual([]);
  });
});
