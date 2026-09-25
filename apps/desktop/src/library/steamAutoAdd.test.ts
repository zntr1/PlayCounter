// @vitest-environment happy-dom
import { invoke } from "@tauri-apps/api/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../store";
import { commitLibraryImports } from "./commit";
import { buildLibraryImportCommit } from "./importPlan";
import { resolveLibraryGames } from "./resolve";
import { resetSteamLibrarySync, syncSteamLibrary } from "./steamAutoAdd";
import {
  readSteamAutoAdd,
  rememberSteamImportAccount,
} from "./steamAutoAddState";
import {
  libraryEntryKey,
  type LibraryImportEntry,
  type ResolvedLibraryGame,
  type ScannedLibraryGame,
} from "./types";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  convertFileSrc: (value: string) => value,
}));
vi.mock("../platform", () => ({ currentPlatform: () => "windows" }));
vi.mock("./resolve", () => ({ resolveLibraryGames: vi.fn() }));

const NOW = "2026-09-25T12:00:00.000Z";
const steamPath = (name: string) => `C:\\Steam\\steamapps\\common\\${name}`;

function scanned(appId: string, name: string): ScannedLibraryGame {
  return {
    externalId: appId,
    name,
    playtimeSeconds: 0,
    hasPlayedEvidence: false,
    installed: true,
    installPath: steamPath(name),
    executables: [],
  };
}

function resolvedGame(appId: string, id: number): ResolvedLibraryGame {
  return {
    key: libraryEntryKey("steam", appId),
    status: "resolved",
    game: {
      id,
      igdbId: id,
      name: `Game ${id}`,
      coverUrl: "",
      source: "igdb",
    },
    executables: [],
  };
}

const existing: LibraryImportEntry = {
  provider: "steam",
  externalId: "440",
  gameId: 440,
  igdbId: 440,
  source: "igdb",
  name: "Already imported",
  coverUrl: "",
  importedAt: NOW,
  lastReadAt: NOW,
  providerSeconds: 3600,
  linkedExeNames: [],
  linkedExeSources: [],
};

type Installed = { appId: string; installPath: string };

function mockSteam(installed: Installed[], games: ScannedLibraryGame[]) {
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === "library_steam_installed_apps") return installed;
    if (command === "library_list_accounts") return [{ accountId: 99 }];
    if (command === "library_scan") {
      const appIds = (args as { appIds: string[] }).appIds;
      return {
        games: games.filter((game) => appIds.includes(game.externalId)),
        warnings: [],
        partial: false,
      };
    }
    return undefined;
  });
}

function importedIds() {
  return [...useAppStore.getState().libraryImports.values()]
    .map((entry) => entry.externalId)
    .sort();
}

beforeEach(() => {
  localStorage.clear();
  resetSteamLibrarySync();
  vi.mocked(invoke).mockReset();
  vi.mocked(resolveLibraryGames).mockReset();
  useAppStore.setState(useAppStore.getInitialState(), true);
  useAppStore.setState({
    libraryImports: new Map([[libraryEntryKey("steam", "440"), existing]]),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("adding new Steam games automatically", () => {
  it("adds newly installed games the catalog knows, and nothing else", async () => {
    rememberSteamImportAccount(7);
    mockSteam(
      [
        { appId: "440", installPath: steamPath("Already imported") },
        { appId: "698780", installPath: steamPath("DDLC") },
        { appId: "999999", installPath: steamPath("Unknown tool") },
      ],
      [scanned("698780", "DDLC"), scanned("999999", "Unknown tool")],
    );
    vi.mocked(resolveLibraryGames).mockResolvedValue({
      capability: "supported",
      games: [
        resolvedGame("698780", 698780),
        { key: "steam:999999", status: "unknown", executables: [] },
      ],
    });

    await expect(syncSteamLibrary("test")).resolves.toBe(1);

    expect(invoke).toHaveBeenCalledWith("library_scan", {
      provider: "steam",
      accountId: 7,
      appIds: ["698780", "999999"],
    });
    expect(importedIds()).toEqual(["440", "698780"]);
    expect(
      useAppStore.getState().libraryInstalls.get("steam:698780")?.installPath,
    ).toBe("c:\\steam\\steamapps\\common\\ddlc");
    expect(useAppStore.getState().toasts.at(-1)?.title).toBe(
      "1 Steam game added",
    );

    // The unknown app is not looked up again on the next focus.
    vi.mocked(resolveLibraryGames).mockClear();
    await expect(syncSteamLibrary("again")).resolves.toBe(0);
    expect(resolveLibraryGames).not.toHaveBeenCalled();
  });

  it("never adds a game the user removed", async () => {
    rememberSteamImportAccount(7);
    useAppStore.getState().removeLibraryImport("steam", "440");
    useAppStore.setState({
      libraryImports: new Map([
        [libraryEntryKey("steam", "10"), { ...existing, externalId: "10" }],
      ]),
    });
    mockSteam(
      [{ appId: "440", installPath: steamPath("Already imported") }],
      [scanned("440", "Already imported")],
    );

    await expect(syncSteamLibrary("test")).resolves.toBe(0);
    expect(readSteamAutoAdd().dismissedAppIds).toEqual(["440"]);
    expect(invoke).not.toHaveBeenCalledWith("library_scan", expect.anything());
    expect(importedIds()).toEqual(["10"]);
  });

  it("takes back a removal when the game is imported by hand", () => {
    useAppStore.getState().removeLibraryImport("steam", "440");
    const commit = buildLibraryImportCommit({
      provider: "steam",
      scanned: scanned("440", "Already imported"),
      resolved: resolvedGame("440", 440),
    });
    commitLibraryImports([commit!]);
    expect(readSteamAutoAdd().dismissedAppIds).toEqual([]);
  });

  it("waits for a first Steam import", async () => {
    useAppStore.setState({ libraryImports: new Map() });
    mockSteam([{ appId: "698780", installPath: steamPath("DDLC") }], []);

    await expect(syncSteamLibrary("test")).resolves.toBe(0);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("uses the most recent Steam account for imports made before it was remembered", async () => {
    mockSteam(
      [{ appId: "698780", installPath: steamPath("DDLC") }],
      [scanned("698780", "DDLC")],
    );
    vi.mocked(resolveLibraryGames).mockResolvedValue({
      capability: "supported",
      games: [resolvedGame("698780", 698780)],
    });

    await expect(syncSteamLibrary("test")).resolves.toBe(1);
    expect(invoke).toHaveBeenCalledWith("library_scan", {
      provider: "steam",
      accountId: 99,
      appIds: ["698780"],
    });
  });

  it("only restores reinstalled games when adding is turned off", async () => {
    rememberSteamImportAccount(7);
    useAppStore.getState().setAutoAddSteamGames(false);
    useAppStore.getState().setLauncherSetting("gameLaunchingEnabled", true);
    mockSteam(
      [
        { appId: "440", installPath: steamPath("Already imported") },
        { appId: "698780", installPath: steamPath("DDLC") },
      ],
      [scanned("698780", "DDLC")],
    );

    await expect(syncSteamLibrary("test")).resolves.toBe(0);
    expect(importedIds()).toEqual(["440"]);
    expect(
      useAppStore.getState().libraryInstalls.get("steam:440")?.installPath,
    ).toBe("C:\\Steam\\steamapps\\common\\Already imported");
    expect(invoke).not.toHaveBeenCalledWith("library_scan", expect.anything());
  });

  it("does nothing while both adding and launching are off", async () => {
    useAppStore.getState().setAutoAddSteamGames(false);
    useAppStore.getState().setLauncherSetting("gameLaunchingEnabled", false);

    await expect(syncSteamLibrary("test")).resolves.toBe(0);
    expect(invoke).not.toHaveBeenCalled();
  });
});
