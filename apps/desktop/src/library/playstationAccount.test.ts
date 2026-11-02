import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../store";
import { commitLibraryImports } from "./commit";
import { importProfile } from "./importProfiles";
import { startsUnchecked } from "./importGroups";
import { buildLibraryImportCommit } from "./importPlan";
import { playStationScanResult } from "./playstationAccount";
import type { ResolvedLibraryGame } from "./types";

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
        lastPlayedUnix: Math.floor(Date.parse("2026-10-30T21:25:28.987Z") / 1000),
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
