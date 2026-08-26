import { afterEach, describe, expect, it, vi } from "vitest";
import { importExeCandidates } from "./exeCandidates";
import { buildSteamImportCommit } from "./importPlan";
import { providerFloorRecord, providerFloors } from "./playtimeFloor";
import { resolveLibraryGames } from "./resolve";
import { resolveScopedLink, scopedExeLinkKey } from "./scopedLinks";
import type {
  LibraryImportEntry,
  ResolvedLibraryGame,
  ScannedLibraryGame,
  ScopedExeLink,
} from "./types";

const scanned: ScannedLibraryGame = {
  externalId: "730",
  name: "Counter-Strike 2",
  playtimeSeconds: 7_200,
  installed: true,
  installPath: String.raw`C:\SteamLibrary\steamapps\common\Counter-Strike Global Offensive`,
  executables: [
    {
      fileName: "cs2.exe",
      relativePath: String.raw`game\bin\win64\cs2.exe`,
      sizeBytes: 80_000_000,
      depth: 3,
    },
    {
      fileName: "uninstall.exe",
      relativePath: "uninstall.exe",
      sizeBytes: 100,
      depth: 0,
    },
  ],
};

const resolved: ResolvedLibraryGame = {
  key: "steam:730",
  status: "resolved",
  game: {
    id: 9,
    igdbId: 1942,
    name: "Counter-Strike 2",
    coverUrl: "cover",
    source: "igdb",
  },
  executables: [
    {
      platform: "windows",
      kind: "exe",
      value: "cs2.exe",
      provenance: "igdb",
      verified: true,
    },
  ],
};

describe("library import", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("creates a provider floor and a safe cached executable match", () => {
    const commit = buildSteamImportCommit({ scanned, resolved, now: "now" });
    expect(commit?.entry.providerSeconds).toBe(7_200);
    expect(commit?.entry.igdbId).toBe(1942);
    expect(commit?.exeCacheEntries.map((entry) => entry.exeName)).toEqual([
      "cs2.exe",
    ]);
    expect(commit?.scopedLinks[0]).toMatchObject({
      exeName: "cs2.exe",
      igdbId: 1942,
    });
  });

  it("keeps ambiguous evidence path-scoped and manual mappings local", () => {
    const ambiguous = {
      ...resolved,
      executables: [{ ...resolved.executables[0], ambiguous: true }],
    };
    const commit = buildSteamImportCommit({ scanned, resolved: ambiguous });
    expect(commit?.exeCacheEntries).toEqual([]);
    expect(commit?.scopedLinks[0]).toMatchObject({
      exeName: "cs2.exe",
      igdbId: 1942,
      provider: "steam",
    });

    const noKnown = { ...resolved, executables: [] };
    const manual = buildSteamImportCommit({
      scanned,
      resolved: noKnown,
      selectedExecutable: scanned.executables[0],
    });
    expect(manual?.exeCacheEntries[0]).toMatchObject({
      exeName: "cs2.exe",
      source: "custom",
      igdbId: 1942,
      shareState: "unshared",
    });

    const generic = buildSteamImportCommit({
      scanned: {
        ...scanned,
        executables: [
          {
            fileName: "game.exe",
            relativePath: "game.exe",
            sizeBytes: 1_000_000,
            depth: 0,
          },
        ],
      },
      resolved: noKnown,
      selectedExecutable: {
        fileName: "game.exe",
        relativePath: "game.exe",
        sizeBytes: 1_000_000,
        depth: 0,
      },
    });
    expect(generic?.scopedLinks[0]).toMatchObject({
      exeName: "game.exe",
      source: "custom",
      shareState: "unshared",
    });
  });

  it("ranks known game executables and removes installer noise", () => {
    const candidates = importExeCandidates(
      scanned.executables,
      resolved.executables,
      "Counter-Strike 2",
    );
    expect(candidates.map((item) => item.fileName)).toEqual(["cs2.exe"]);
  });

  it("ranks executable candidates when Steam has no manifest name", () => {
    expect(
      importExeCandidates(scanned.executables, [], null).map(
        (item) => item.fileName,
      ),
    ).toEqual(["cs2.exe"]);
  });

  it("merges multiple provider records into the highest IGDB floor", () => {
    const base: LibraryImportEntry = {
      provider: "steam",
      externalId: "730",
      igdbId: 1942,
      gameId: 9,
      source: "igdb",
      name: "Counter-Strike 2",
      coverUrl: "cover",
      importedAt: "now",
      providerSeconds: 7_200,
      lastReadAt: "now",
      linkedExeNames: [],
    };
    const record = providerFloorRecord(
      providerFloors([
        base,
        { ...base, externalId: "731", providerSeconds: 6_000 },
      ]),
    );
    expect(record).toEqual({ "igdb#1942": 7_200 });
  });

  it("probes the resolver capability without uploading playtime or paths", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            {
              key: "steam:730",
              status: "resolved",
              game: resolved.game,
              executables: resolved.executables,
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const outcome = await resolveLibraryGames("https://api.example/", "steam", [
      scanned,
    ]);
    expect(outcome.capability).toBe("supported");
    const request = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(request.body))).toEqual({
      items: [{ key: "steam:730", provider: "steam", externalId: "730" }],
    });
  });

  it("disables import cleanly when the backend lacks the resolver", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 404 })),
    );
    await expect(
      resolveLibraryGames("https://api.example", "steam", [scanned]),
    ).resolves.toEqual({ capability: "unsupported", games: [] });
  });

  it("capability-probes the resolver even when Steam has no games", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ results: [] }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      resolveLibraryGames("https://api.example///", "steam", []),
    ).resolves.toEqual({ capability: "supported", games: [] });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example/api/library/resolve",
      expect.objectContaining({ body: JSON.stringify({ items: [] }) }),
    );
  });
});

describe("path-scoped executable links", () => {
  const link = {
    exeName: "game.exe",
    pathPrefix: String.raw`C:\Steam\common\Actual Game`,
    gameId: 9,
    source: "igdb",
    igdbId: 10,
    gameName: "Actual Game",
    coverUrl: "cover",
    provider: "steam",
    externalId: "1",
    setAt: "now",
  } satisfies ScopedExeLink;

  it("matches only a process beneath the normalized install root", () => {
    const links = new Map([
      [scopedExeLinkKey(link.exeName, link.pathPrefix)!, link],
    ]);
    expect(
      resolveScopedLink(
        {
          exeName: "GAME.EXE",
          exePath: String.raw`c:\steam\common\actual game\bin\game.exe`,
        },
        links,
      )?.igdbId,
    ).toBe(10);
    expect(
      resolveScopedLink(
        {
          exeName: "game.exe",
          exePath: String.raw`C:\Steam\common\Actual Game 2\game.exe`,
        },
        links,
      ),
    ).toBeNull();
  });
});
