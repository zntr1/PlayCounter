// @vitest-environment happy-dom
import type { LibraryProviderId } from "@playcounter/shared";
import { invoke } from "@tauri-apps/api/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../store";
import { commitLibraryImports } from "./commit";
import { buildLibraryImportCommit } from "./importPlan";
import {
  readLibraryAutoAdd,
  rememberSteamImportAccount,
} from "./libraryAutoAddState";
import {
  resetLibraryInstallSync,
  syncLibraryInstalls,
} from "./libraryAutoSync";
import { resolveLibraryGames } from "./resolve";
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
const gamePath = (name: string) => `C:\\Games\\${name}`;

function scanned(externalId: string, name: string): ScannedLibraryGame {
  return {
    externalId,
    name,
    playtimeSeconds: 0,
    hasPlayedEvidence: false,
    installed: true,
    installPath: gamePath(name),
    executables: [],
  };
}

function resolvedGame(
  provider: LibraryProviderId,
  externalId: string,
  id: number,
): ResolvedLibraryGame {
  return {
    key: libraryEntryKey(provider, externalId),
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

function imported(
  provider: LibraryProviderId,
  externalId: string,
): [string, LibraryImportEntry] {
  return [
    libraryEntryKey(provider, externalId),
    {
      provider,
      externalId,
      gameId: Number.parseInt(externalId, 36),
      igdbId: Number.parseInt(externalId, 36),
      source: "igdb",
      name: `Imported ${externalId}`,
      coverUrl: "",
      importedAt: NOW,
      lastReadAt: NOW,
      providerSeconds: 3600,
      linkedExeNames: [],
      linkedExeSources: [],
    },
  ];
}

type Installed = Partial<
  Record<LibraryProviderId, { externalId: string; installPath: string }[]>
>;

function mockLaunchers(
  installed: Installed,
  scans: Partial<Record<LibraryProviderId, ScannedLibraryGame[]>>,
) {
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    const provider = (args as { provider?: LibraryProviderId })?.provider;
    if (command === "library_installed_games") {
      return provider ? (installed[provider] ?? []) : null;
    }
    if (command === "library_list_accounts") return [{ accountId: 99 }];
    if (command === "library_scan" && provider) {
      const appIds = (args as { appIds?: string[] }).appIds;
      return {
        games: (scans[provider] ?? []).filter(
          (game) => !appIds || appIds.includes(game.externalId),
        ),
        warnings: [],
        partial: false,
      };
    }
    return undefined;
  });
}

function importedIds() {
  return [...useAppStore.getState().libraryImports.keys()].sort();
}

beforeEach(() => {
  localStorage.clear();
  resetLibraryInstallSync();
  vi.mocked(invoke).mockReset();
  vi.mocked(resolveLibraryGames).mockReset();
  useAppStore.setState(useAppStore.getInitialState(), true);
  useAppStore.setState({
    libraryImports: new Map([imported("steam", "440")]),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("adding newly installed games automatically", () => {
  it("adds new Steam games the catalog knows, and nothing else", async () => {
    rememberSteamImportAccount(7);
    mockLaunchers(
      {
        steam: [
          { externalId: "440", installPath: gamePath("Already imported") },
          { externalId: "698780", installPath: gamePath("DDLC") },
          { externalId: "999999", installPath: gamePath("Unknown tool") },
        ],
      },
      { steam: [scanned("698780", "DDLC"), scanned("999999", "Unknown tool")] },
    );
    vi.mocked(resolveLibraryGames).mockResolvedValue({
      capability: "supported",
      games: [
        resolvedGame("steam", "698780", 698780),
        { key: "steam:999999", status: "unknown", executables: [] },
      ],
    });

    await expect(syncLibraryInstalls("test")).resolves.toBe(1);

    expect(invoke).toHaveBeenCalledWith("library_scan", {
      provider: "steam",
      accountId: 7,
      appIds: ["698780", "999999"],
    });
    expect(importedIds()).toEqual(["steam:440", "steam:698780"]);
    expect(
      useAppStore.getState().libraryInstalls.get("steam:698780")?.installPath,
    ).toBe("c:\\games\\ddlc");
    expect(useAppStore.getState().toasts.at(-1)?.title).toBe("1 game added");

    // The unknown app is not looked up again on the next focus.
    vi.mocked(resolveLibraryGames).mockClear();
    await expect(syncLibraryInstalls("again")).resolves.toBe(0);
    expect(resolveLibraryGames).not.toHaveBeenCalled();
  });

  it("adds new Battle.net games after a Battle.net import", async () => {
    useAppStore.setState({
      libraryImports: new Map([imported("battlenet", "w3")]),
    });
    mockLaunchers(
      {
        battlenet: [
          { externalId: "w3", installPath: gamePath("Warcraft III") },
          { externalId: "fenris", installPath: gamePath("Diablo IV") },
        ],
      },
      {
        battlenet: [
          scanned("w3", "Warcraft III"),
          scanned("fenris", "Diablo IV"),
        ],
      },
    );
    vi.mocked(resolveLibraryGames).mockResolvedValue({
      capability: "supported",
      games: [resolvedGame("battlenet", "fenris", 125165)],
    });

    await expect(syncLibraryInstalls("test")).resolves.toBe(1);
    expect(importedIds()).toEqual(["battlenet:fenris", "battlenet:w3"]);
    expect(resolveLibraryGames).toHaveBeenCalledWith(
      expect.any(String),
      "battlenet",
      [scanned("fenris", "Diablo IV")],
    );
  });

  it("restores reinstalled Xbox games but never adds unknown Xbox installs", async () => {
    useAppStore.setState({
      libraryImports: new Map([imported("xbox", "1234")]),
    });
    mockLaunchers(
      {
        xbox: [
          { externalId: "1234", installPath: gamePath("Imported Xbox") },
          { externalId: "5678", installPath: gamePath("New Xbox") },
        ],
      },
      {},
    );

    await expect(syncLibraryInstalls("test")).resolves.toBe(0);
    expect(importedIds()).toEqual(["xbox:1234"]);
    expect(
      useAppStore.getState().libraryInstalls.get("xbox:1234")?.installPath,
    ).toBe("C:\\Games\\Imported Xbox");
    expect(invoke).not.toHaveBeenCalledWith("library_scan", expect.anything());
  });

  it("only asks launchers the user imported from", async () => {
    mockLaunchers({}, {});
    await syncLibraryInstalls("test");
    expect(invoke).toHaveBeenCalledWith("library_installed_games", {
      provider: "steam",
    });
    expect(invoke).not.toHaveBeenCalledWith("library_installed_games", {
      provider: "xbox",
    });
    expect(invoke).not.toHaveBeenCalledWith("library_installed_games", {
      provider: "battlenet",
    });
  });

  it("never adds a game the user removed", async () => {
    rememberSteamImportAccount(7);
    useAppStore.getState().removeLibraryImport("steam", "440");
    useAppStore.setState({
      libraryImports: new Map([imported("steam", "10")]),
    });
    mockLaunchers(
      {
        steam: [
          { externalId: "440", installPath: gamePath("Already imported") },
        ],
      },
      { steam: [scanned("440", "Already imported")] },
    );

    await expect(syncLibraryInstalls("test")).resolves.toBe(0);
    expect(readLibraryAutoAdd().dismissed).toEqual(["steam:440"]);
    expect(invoke).not.toHaveBeenCalledWith("library_scan", expect.anything());
    expect(importedIds()).toEqual(["steam:10"]);
  });

  it("takes back a removal when the game is imported by hand", () => {
    useAppStore.getState().removeLibraryImport("steam", "440");
    const commit = buildLibraryImportCommit({
      provider: "steam",
      scanned: scanned("440", "Already imported"),
      resolved: resolvedGame("steam", "440", 440),
    });
    commitLibraryImports([commit!]);
    expect(readLibraryAutoAdd().dismissed).toEqual([]);
  });

  it("waits for a first import", async () => {
    useAppStore.setState({ libraryImports: new Map() });
    mockLaunchers(
      { steam: [{ externalId: "698780", installPath: gamePath("DDLC") }] },
      {},
    );

    await expect(syncLibraryInstalls("test")).resolves.toBe(0);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("uses the most recent Steam account for imports made before it was remembered", async () => {
    mockLaunchers(
      { steam: [{ externalId: "698780", installPath: gamePath("DDLC") }] },
      { steam: [scanned("698780", "DDLC")] },
    );
    vi.mocked(resolveLibraryGames).mockResolvedValue({
      capability: "supported",
      games: [resolvedGame("steam", "698780", 698780)],
    });

    await expect(syncLibraryInstalls("test")).resolves.toBe(1);
    expect(invoke).toHaveBeenCalledWith("library_scan", {
      provider: "steam",
      accountId: 99,
      appIds: ["698780"],
    });
  });

  it("only restores reinstalled games when adding is turned off", async () => {
    rememberSteamImportAccount(7);
    useAppStore.getState().setAutoAddInstalledGames(false);
    useAppStore.getState().setLauncherSetting("gameLaunchingEnabled", true);
    mockLaunchers(
      {
        steam: [
          { externalId: "440", installPath: gamePath("Already imported") },
          { externalId: "698780", installPath: gamePath("DDLC") },
        ],
      },
      { steam: [scanned("698780", "DDLC")] },
    );

    await expect(syncLibraryInstalls("test")).resolves.toBe(0);
    expect(importedIds()).toEqual(["steam:440"]);
    expect(
      useAppStore.getState().libraryInstalls.get("steam:440")?.installPath,
    ).toBe("C:\\Games\\Already imported");
    expect(invoke).not.toHaveBeenCalledWith("library_scan", expect.anything());
  });

  it("keeps syncing other launchers when one fails", async () => {
    useAppStore.setState({
      libraryImports: new Map([
        imported("steam", "440"),
        imported("xbox", "1234"),
      ]),
    });
    vi.mocked(invoke).mockImplementation(async (command, args) => {
      const provider = (args as { provider?: string })?.provider;
      if (command === "library_installed_games" && provider === "steam") {
        throw new Error("Steam is busy");
      }
      if (command === "library_installed_games" && provider === "xbox") {
        return [{ externalId: "1234", installPath: gamePath("Xbox game") }];
      }
      return undefined;
    });

    await expect(syncLibraryInstalls("test")).resolves.toBe(0);
    expect(useAppStore.getState().libraryInstalls.has("xbox:1234")).toBe(true);
  });

  it("does nothing while both adding and launching are off", async () => {
    useAppStore.getState().setAutoAddInstalledGames(false);
    useAppStore.getState().setLauncherSetting("gameLaunchingEnabled", false);

    await expect(syncLibraryInstalls("test")).resolves.toBe(0);
    expect(invoke).not.toHaveBeenCalled();
  });
});
