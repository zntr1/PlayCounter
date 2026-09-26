import { afterEach, describe, expect, it, vi } from "vitest";
import { mergeEpicAccountLibrary } from "./epicAccount";
import { resolveLibraryGames } from "./resolve";
import type { LibraryScanResult, ResolvedLibraryGame } from "./types";
import {
  canImportScannedGame,
  importGroupForGame,
  startsUnchecked,
} from "../ui/views/ImportLibraryView";

afterEach(() => vi.unstubAllGlobals());

const local: LibraryScanResult = {
  games: [
    {
      externalId: "Sugar",
      name: "Rocket League",
      playtimeSeconds: null,
      hasPlayedEvidence: false,
      installed: true,
      installPath: String.raw`C:\Program Files\Epic Games\rocketleague`,
      executables: [
        {
          fileName: "RocketLeague.exe",
          relativePath: String.raw`Binaries\Win64\RocketLeague.exe`,
          sizeBytes: 50_000_000,
          depth: 2,
          declared: true,
        },
      ],
    },
  ],
  warnings: [],
  partial: false,
};

const resolved = (key: string): ResolvedLibraryGame => ({
  key,
  status: "resolved",
  game: {
    id: 1,
    igdbId: 11198,
    name: "Rocket League",
    coverUrl: "",
    source: "igdb",
  },
  executables: [
    {
      platform: "windows",
      kind: "exe",
      value: "RocketLeague.exe",
      provenance: "igdb",
      verified: true,
    },
  ],
});

describe("Epic Games import", () => {
  it("adds account playtime to installed games and leaves unplayed owned games unchecked", () => {
    const merged = mergeEpicAccountLibrary(
      {
        games: [
          { appName: "Sugar", title: "Rocket League®", playtimeSeconds: 7_200 },
          { appName: "Hades", title: "Hades", playtimeSeconds: 3_600 },
          { appName: "Freebie", title: "Free Game", playtimeSeconds: 0 },
        ],
        incomplete: false,
      },
      local,
    );
    const byId = new Map(merged.games.map((game) => [game.externalId, game]));
    expect(byId.get("Sugar")).toMatchObject({
      installed: true,
      playtimeSeconds: 7_200,
      hasPlayedEvidence: true,
      name: "Rocket League®",
    });
    expect(byId.get("Sugar")?.executables).toHaveLength(1);
    expect(byId.get("Hades")).toMatchObject({
      installed: false,
      playtimeSeconds: 3_600,
      hasPlayedEvidence: true,
    });
    expect(merged.partial).toBe(false);

    const group = (externalId: string) =>
      importGroupForGame({
        game: byId.get(externalId)!,
        provider: "epic",
        resolved: resolved(`epic:${externalId}`),
        alreadyImported: false,
      });
    expect(group("Sugar")).toBe("ready");
    expect(group("Hades")).toBe("ready");
    expect(group("Freebie")).toBe("ready");
    // Epic accounts collect many never-played free games: importable, but
    // only when the user picks them.
    expect(startsUnchecked("epic", byId.get("Sugar")!)).toBe(false);
    expect(startsUnchecked("epic", byId.get("Hades")!)).toBe(false);
    expect(startsUnchecked("epic", byId.get("Freebie")!)).toBe(true);
    // Battle.net keeps checking its account games.
    expect(startsUnchecked("battlenet", byId.get("Freebie")!)).toBe(false);
  });

  it("marks the result partial when Epic answered only in part", () => {
    const merged = mergeEpicAccountLibrary(
      {
        games: [{ appName: "Hades", title: "Hades", playtimeSeconds: null }],
        incomplete: true,
      },
      { ...local, partial: true },
    );
    expect(merged.partial).toBe(true);
    expect(merged.warnings).toHaveLength(1);
    expect(
      merged.games.find((game) => game.externalId === "Hades"),
    ).toMatchObject({ installationStatusUnknown: true });
  });

  it("imports an installed game found without sign-in, with unknown playtime", () => {
    const game = local.games[0];
    expect(
      canImportScannedGame({
        game,
        resolved: resolved("epic:Sugar"),
        alreadyImported: false,
      }),
    ).toBe(true);
    // An unknown title needs the user to confirm the game first.
    expect(
      importGroupForGame({
        game,
        provider: "epic",
        resolved: { key: "epic:Sugar", status: "unknown", executables: [] },
        alreadyImported: false,
      }),
    ).toBe("attention");
  });

  it("sends the store title for Epic lookups only", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ results: [] }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    await resolveLibraryGames("https://api.example", "epic", local.games);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toEqual({
      items: [
        {
          key: "epic:Sugar",
          provider: "epic",
          externalId: "Sugar",
          title: "Rocket League",
        },
      ],
    });
  });

  it("switches import off against servers that do not know Epic yet", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 400 })),
    );
    await expect(
      resolveLibraryGames("https://api.example", "epic", local.games),
    ).resolves.toEqual({ capability: "unsupported", games: [] });
  });
});
