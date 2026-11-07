import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LibraryKnownExecutable } from "@playcounter/shared";
import { persistAppState } from "../persistence";
import { useAppStore } from "../store";
import { backfillLibraryExecutableCache, hydrate } from "../tracker";
import { commitLibraryImports } from "./commit";
import { importProfile } from "./importProfiles";
import { startsUnchecked } from "./importGroups";
import { buildLibraryImportCommit } from "./importPlan";
import { playStationScanResult } from "./playstationAccount";
import type { ResolvedLibraryGame, ScannedLibraryGame } from "./types";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  convertFileSrc: (value: string) => value,
}));

beforeEach(() => {
  useAppStore.setState(useAppStore.getInitialState(), true);
  const items = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => items.set(key, value),
    removeItem: (key: string) => items.delete(key),
  });
});

const library = {
  games: [
    {
      conceptId: "10000333",
      title: "ELDEN RING",
      playtimeSeconds: 45_000,
      lastPlayedAt: "2026-10-30T21:25:28.987Z",
      platforms: ["PS5", "PS4"] as ("PS5" | "PS4")[],
      titleIds: ["CUSA18638_00", "PPSA04609_00"],
    },
    {
      conceptId: "200520",
      title: "Bloodborne",
      playtimeSeconds: null,
      lastPlayedAt: null,
      platforms: ["PS4"] as ("PS5" | "PS4")[],
      titleIds: ["CUSA00207_00"],
    },
  ],
  incomplete: false,
};

describe("PlayStation import", () => {
  it("is an account import matched by name, with playtime and no installs", () => {
    expect(importProfile("playstation")).toMatchObject({
      login: "playstation",
      choice: "account",
      matchedBy: "name",
      hasPlaytime: true,
      accountAndInstalls: false,
      linksFilesPerInstall: false,
    });
  });

  it("turns Sony's played list into a scan: played, not installed, unknown time stays unknown", () => {
    const scan = playStationScanResult(library);
    expect(scan.partial).toBe(false);
    expect(scan.warnings).toEqual([]);
    expect(scan.games).toEqual([
      {
        externalId: "200520",
        name: "Bloodborne",
        playtimeSeconds: null,
        hasPlayedEvidence: true,
        inAccountLibrary: true,
        lastPlayedUnix: undefined,
        installed: false,
        executables: [],
        consoleTitleIds: ["CUSA00207_00"],
      },
      {
        externalId: "10000333",
        name: "ELDEN RING",
        playtimeSeconds: 45_000,
        hasPlayedEvidence: true,
        inAccountLibrary: true,
        lastPlayedUnix: Math.floor(
          Date.parse("2026-10-30T21:25:28.987Z") / 1000,
        ),
        installed: false,
        executables: [],
        consoleTitleIds: ["CUSA18638_00", "PPSA04609_00"],
      },
    ]);
  });

  it("says so when Sony returned only part of the list", () => {
    const scan = playStationScanResult({ ...library, incomplete: true });
    expect(scan.partial).toBe(true);
    expect(scan.warnings).toHaveLength(1);
  });

  it("brings a game Sony names no console for, marked so it starts unchecked", () => {
    // GTA V on Phil's account: Sony's "unknown" category, played by someone
    // else on it.
    const [scanned] = playStationScanResult({
      games: [
        {
          conceptId: "201930",
          title: "Grand Theft Auto V (PlayStation®5)",
          playtimeSeconds: 2_917_966,
          lastPlayedAt: "2026-08-20T18:00:00.000Z",
          platforms: ["PS4"],
          titleIds: ["CUSA00411_00"],
          consoleUnknown: true,
        },
      ],
      incomplete: false,
    }).games;
    expect(scanned).toMatchObject({
      externalId: "201930",
      playtimeSeconds: 2_917_966,
      consoleTitleIds: ["CUSA00411_00"],
      consoleUnknown: true,
    });
    expect(startsUnchecked(scanned)).toBe(true);
    // Games Sony names a console for don't carry the mark.
    for (const game of playStationScanResult(library).games) {
      expect(game).not.toHaveProperty("consoleUnknown");
      expect(startsUnchecked(game)).toBe(false);
    }
  });

  it("keeps Sony's title ids on the saved game, from every read", () => {
    const resolved: ResolvedLibraryGame = {
      key: "playstation:10000333",
      status: "resolved",
      game: {
        id: 7,
        igdbId: 119133,
        name: "Elden Ring",
        coverUrl: "",
        source: "igdb",
      },
      executables: [],
    };
    const [scanned] = playStationScanResult({
      games: [library.games[0]],
      incomplete: false,
    }).games;
    const first = buildLibraryImportCommit({
      provider: "playstation",
      scanned: { ...scanned, consoleTitleIds: ["PPSA04609_00"] },
      resolved,
    })!;
    expect(first.entry.consoleTitleIds).toEqual(["PPSA04609_00"]);
    expect(first.install).toBeUndefined();
    commitLibraryImports([first]);
    const second = buildLibraryImportCommit({
      provider: "playstation",
      scanned: { ...scanned, consoleTitleIds: ["CUSA18638_00"] },
      resolved,
    })!;
    commitLibraryImports([second]);
    expect(
      useAppStore.getState().libraryImports.get("playstation:10000333")
        ?.consoleTitleIds,
    ).toEqual(["PPSA04609_00", "CUSA18638_00"]);
  });
});

/* A PlayStation copy runs on the console: its import links no PC file, even
   when the database knows the PC version's .exe. That file is linked when it
   runs here, like any game's. */
describe("PlayStation and PC files", () => {
  const HORIZON = {
    id: 21,
    igdbId: 11156,
    name: "Horizon Zero Dawn",
    coverUrl: "",
    source: "igdb" as const,
  };
  const PC_FILE: LibraryKnownExecutable = {
    platform: "windows",
    kind: "exe",
    value: "HorizonZeroDawn.exe",
    provenance: "igdb",
    verified: true,
  };
  const played: ScannedLibraryGame = {
    externalId: "200937",
    name: "Horizon Zero Dawn",
    playtimeSeconds: 22_576,
    hasPlayedEvidence: true,
    inAccountLibrary: true,
    installed: false,
    executables: [],
    consoleTitleIds: ["CUSA01967_00"],
  };
  const resolved = (key: string): ResolvedLibraryGame => ({
    key,
    status: "resolved",
    game: HORIZON,
    executables: [PC_FILE],
  });

  it("links none of the PC game's files, even one the database knows", () => {
    const fromSony = buildLibraryImportCommit({
      provider: "playstation",
      scanned: played,
      resolved: resolved("playstation:200937"),
    })!;
    expect(fromSony.exeCacheEntries).toEqual([]);
    expect(fromSony.scopedLinks).toEqual([]);
    expect(fromSony.entry).toMatchObject({
      linkedExeNames: [],
      linkedExeSources: [],
    });

    // The same game from Steam links its file as before.
    const fromSteam = buildLibraryImportCommit({
      provider: "steam",
      scanned: { ...played, externalId: "1151640", consoleTitleIds: [] },
      resolved: resolved("steam:1151640"),
    })!;
    expect(fromSteam.entry.linkedExeNames).toEqual(["HorizonZeroDawn.exe"]);
  });

  it("drops the PC files an earlier PlayStation import linked, and keeps a file that ran here", async () => {
    // Saved by the version before: the import linked Horizon's PC file.
    commitLibraryImports([
      {
        entry: {
          provider: "playstation",
          externalId: "200937",
          igdbId: HORIZON.igdbId,
          gameId: HORIZON.id,
          source: "igdb",
          name: HORIZON.name,
          coverUrl: "",
          importedAt: "2026-11-01T20:00:00.000Z",
          lastReadAt: "2026-11-01T20:00:00.000Z",
          providerSeconds: 22_576,
          linkedExeNames: ["HorizonZeroDawn.exe"],
          linkedExeSources: ["igdb"],
          consoleTitleIds: ["CUSA01967_00"],
        },
        metadata: HORIZON,
        exeCacheEntries: [
          {
            exeName: "HorizonZeroDawn.exe",
            state: "matched",
            gameId: HORIZON.id,
            igdbId: HORIZON.igdbId,
            gameName: HORIZON.name,
            coverUrl: "",
            source: "igdb",
            identifierSource: "igdb",
            libraryProvider: "playstation",
            libraryExternalId: "200937",
            lastCheckedAt: "2026-11-01T20:00:00.000Z",
          },
        ],
        scopedLinks: [],
      },
    ]);
    // Elden Ring from PlayStation, and its PC version ran here: PlayCounter
    // linked eldenring.exe itself.
    const [eldenRing] = playStationScanResult({
      games: [library.games[0]],
      incomplete: false,
    }).games;
    commitLibraryImports([
      buildLibraryImportCommit({
        provider: "playstation",
        scanned: eldenRing,
        resolved: {
          key: "playstation:10000333",
          status: "resolved",
          game: {
            id: 7,
            igdbId: 119133,
            name: "Elden Ring",
            coverUrl: "",
            source: "igdb",
          },
          executables: [],
        },
      })!,
    ]);
    useAppStore.getState().setExeCacheEntry({
      exeName: "eldenring.exe",
      state: "matched",
      gameId: 7,
      igdbId: 119133,
      gameName: "Elden Ring",
      coverUrl: "",
      source: "igdb",
      lastCheckedAt: "2026-11-01T21:00:00.000Z",
    });

    persistAppState(useAppStore.getState());
    useAppStore.setState(useAppStore.getInitialState(), true);
    await hydrate();

    const state = useAppStore.getState();
    expect(state.exeCache.has("horizonzerodawn.exe")).toBe(false);
    expect(state.libraryImports.get("playstation:200937")).toMatchObject({
      linkedExeNames: [],
      linkedExeSources: [],
      consoleTitleIds: ["CUSA01967_00"],
      providerSeconds: 22_576,
    });
    expect(state.exeCache.get("eldenring.exe")?.state).toBe("matched");
    expect(
      state.libraryImports.get("playstation:10000333")?.linkedExeNames,
    ).toEqual(["eldenring.exe"]);
  });

  it("never rebuilds a PC file from a PlayStation import", () => {
    const cache = new Map();
    const entry = buildLibraryImportCommit({
      provider: "playstation",
      scanned: played,
      resolved: { ...resolved("playstation:200937"), executables: [] },
    })!.entry;
    expect(
      backfillLibraryExecutableCache(cache, [
        {
          ...entry,
          linkedExeNames: ["horizonzerodawn.exe"],
          linkedExeSources: ["igdb"],
        },
      ]),
    ).toBe(false);
    expect(cache.size).toBe(0);
  });
});
