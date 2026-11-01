import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isLibraryProvider, validLibraryExternalId } from "@playcounter/shared";
import { createTransferData } from "../backup";
import { validateBackupData } from "../backupValidation";
import { createPersistedPayload, STORAGE_KEY } from "../persistence";
import { useAppStore } from "../store";
import { hydrate } from "../tracker";
import { commitLibraryImports } from "./commit";
import { mergeGogAccountLibrary } from "./gogAccount";
import {
  canImportScannedGame,
  importGroupForGame,
  requiresExecutableChoice,
  showsFileChoice,
  startsUnchecked,
} from "./importGroups";
import { buildLibraryImportCommit } from "./importPlan";
import { resolveLibraryGames } from "./resolve";
import type {
  LibraryScanResult,
  ResolvedLibraryGame,
  ScannedLibraryGame,
} from "./types";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  convertFileSrc: (value: string) => value,
}));

const DATE = "2026-11-01T12:00:00.000Z";

// The two GOG games installed on the development PC, as the scan finds them.
const fallout: ScannedLibraryGame = {
  externalId: "1",
  name: "Fallout",
  playtimeSeconds: null,
  hasPlayedEvidence: false,
  installed: true,
  installPath: String.raw`C:\GOG Games\Fallout`,
  executables: [
    {
      fileName: "FalloutLauncher.exe",
      relativePath: "FalloutLauncher.exe",
      sizeBytes: 1_000_000,
      depth: 0,
      declared: true,
    },
    {
      fileName: "falloutwHR.exe",
      relativePath: "falloutwHR.exe",
      sizeBytes: 1_500_000,
      depth: 0,
    },
  ],
};
const riftbreaker: ScannedLibraryGame = {
  externalId: "2147483111",
  name: "The Riftbreaker",
  playtimeSeconds: null,
  hasPlayedEvidence: false,
  installed: true,
  installPath: String.raw`C:\GOG Games\The Riftbreaker`,
  executables: [
    {
      fileName: "riftbreaker_win_release.exe",
      relativePath: String.raw`bin\riftbreaker_win_release.exe`,
      sizeBytes: 90_000_000,
      depth: 1,
      declared: true,
    },
  ],
};
const local: LibraryScanResult = {
  games: [fallout, riftbreaker],
  warnings: [],
  partial: false,
};

const resolved = (
  externalId: string,
  igdbId: number,
  name: string,
  exe?: string,
): ResolvedLibraryGame => ({
  key: `gog:${externalId}`,
  status: "resolved",
  game: { id: igdbId, igdbId, name, coverUrl: "", source: "igdb" },
  executables: exe
    ? [
        {
          platform: "windows",
          kind: "exe",
          value: exe,
          provenance: "igdb",
          verified: true,
        },
      ]
    : [],
});

beforeEach(() => {
  useAppStore.setState(useAppStore.getInitialState(), true);
  const items = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => items.set(key, value),
    removeItem: (key: string) => items.delete(key),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("GOG import", () => {
  it("knows GOG ids: digits, 1 to 10 long (a list check)", () => {
    expect(isLibraryProvider("gog")).toBe(true);
    for (const id of ["1", "1213504814", "2147483111"])
      expect(validLibraryExternalId("gog", id)).toBe(true);
    for (const id of ["0", "01", "12345678901", "Fallout", "1_is1", ""])
      expect(validLibraryExternalId("gog", id)).toBe(false);
  });

  it("adds the account's games with GOG's hours to the installed ones", () => {
    const merged = mergeGogAccountLibrary(
      {
        games: [
          // In the account and installed here.
          {
            productId: "2147483111",
            title: "The Riftbreaker",
            playtimeSeconds: 18_000,
          },
          // Bought for the test: never played, not installed.
          {
            productId: "1213504814",
            title: "Middle-earth™: Shadow of Mordor™ Game of the Year Edition",
            playtimeSeconds: 0,
          },
          // Played on another PC.
          {
            productId: "1207658924",
            title: "The Witcher: Enhanced Edition",
            playtimeSeconds: 7_500,
          },
        ],
        incomplete: false,
      },
      local,
    );
    const byId = new Map(merged.games.map((game) => [game.externalId, game]));
    expect(byId.get("2147483111")).toMatchObject({
      installed: true,
      inAccountLibrary: true,
      playtimeSeconds: 18_000,
      hasPlayedEvidence: true,
    });
    expect(byId.get("2147483111")?.executables).toHaveLength(1);
    // Installed from an offline installer, not in this account.
    expect(byId.get("1")).toMatchObject({
      installed: true,
      playtimeSeconds: null,
    });
    expect(byId.get("1")?.inAccountLibrary).toBeUndefined();
    expect(byId.get("1213504814")).toMatchObject({
      installed: false,
      inAccountLibrary: true,
      playtimeSeconds: 0,
      hasPlayedEvidence: false,
    });
    expect(byId.get("1207658924")).toMatchObject({
      installed: false,
      playtimeSeconds: 7_500,
      hasPlayedEvidence: true,
    });
    // Never played and not installed: importable, but only when picked.
    expect(startsUnchecked(byId.get("1213504814")!)).toBe(true);
    expect(startsUnchecked(byId.get("1207658924")!)).toBe(false);
    expect(merged.partial).toBe(false);
  });

  it("says when GOG answered only in part", () => {
    const merged = mergeGogAccountLibrary(
      {
        games: [
          {
            productId: "1207658924",
            title: "The Witcher",
            playtimeSeconds: null,
          },
        ],
        incomplete: true,
      },
      local,
    );
    expect(merged.partial).toBe(true);
    expect(merged.warnings).toHaveLength(1);
    expect(
      merged.games.find((game) => game.externalId === "1207658924"),
    ).toMatchObject({ playtimeSeconds: null, hasPlayedEvidence: false });
  });

  it("sends an id the server doesn't know to Needs you, never to Can't import", () => {
    expect(
      importGroupForGame({
        game: riftbreaker,
        provider: "gog",
        resolved: { key: "gog:2147483111", status: "unknown", executables: [] },
        alreadyImported: false,
      }),
    ).toBe("attention");
    expect(
      importGroupForGame({
        game: fallout,
        provider: "gog",
        resolved: resolved("1", 13, "Fallout", "falloutwHR.exe"),
        alreadyImported: false,
      }),
    ).toBe("ready");
  });

  it("imports a game GOG runs in DOSBox without asking for its file", () => {
    const doom: ScannedLibraryGame = {
      externalId: "1435848814",
      name: "DOOM",
      playtimeSeconds: null,
      hasPlayedEvidence: false,
      installed: true,
      installPath: String.raw`C:\GOG Games\DOOM`,
      executables: [],
      runsInEmulator: true,
    };
    const match = resolved("1435848814", 673, "Doom");
    expect(requiresExecutableChoice(doom, match)).toBe(false);
    expect(showsFileChoice("gog", doom, match)).toBe(false);
    expect(
      canImportScannedGame({
        game: doom,
        resolved: match,
        alreadyImported: false,
      }),
    ).toBe(true);
    // The same game without the emulator flag would need its file.
    expect(
      requiresExecutableChoice({ ...doom, runsInEmulator: undefined }, match),
    ).toBe(true);
  });

  it("looks GOG ids up by id only, and treats a 400 from an old server as not supported", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ results: [] }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    await resolveLibraryGames("https://api.example", "gog", [fallout]);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toEqual({
      items: [{ key: "gog:1", provider: "gog", externalId: "1" }],
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 400 })),
    );
    await expect(
      resolveLibraryGames("https://api.example", "gog", [fallout]),
    ).resolves.toEqual({ capability: "unsupported", games: [] });
  });

  function falloutCommit() {
    return buildLibraryImportCommit({
      provider: "gog",
      scanned: fallout,
      resolved: resolved("1", 13, "Fallout", "falloutwHR.exe"),
      now: DATE,
    })!;
  }

  it("keeps a saved GOG import and its install after a restart", async () => {
    commitLibraryImports([falloutCommit()]);
    const previous = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    useAppStore.setState(useAppStore.getInitialState(), true);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(previous));
    await hydrate();
    const state = useAppStore.getState();
    const entry = state.libraryImports.get("gog:1");
    expect(entry).toMatchObject({
      provider: "gog",
      externalId: "1",
      igdbId: 13,
    });
    expect(entry?.linkedExeNames.map((name) => name.toLowerCase())).toEqual([
      "falloutwhr.exe",
    ]);
    expect(state.libraryInstalls.get("gog:1")?.provider).toBe("gog");
  });

  it("imports a backup that holds GOG games and a GOG shelf", () => {
    commitLibraryImports([falloutCommit()]);
    useAppStore.setState({
      personalShelves: [
        { id: "gog-shelf", name: "GOG", filters: { source: "gog" } },
      ],
    });
    const data = JSON.parse(
      JSON.stringify(
        createTransferData(createPersistedPayload(useAppStore.getState())),
      ),
    );
    expect(data.libraryImports[0]).toMatchObject({ provider: "gog" });
    expect(() => validateBackupData(data, "data")).not.toThrow();
  });
});
