import { afterEach, describe, expect, it, vi } from "vitest";
import { checkLibraryImportForMatches } from "./recheck";
import type { LibraryImportEntry } from "./types";

const entry: LibraryImportEntry = {
  provider: "steam",
  externalId: "730",
  igdbId: 1942,
  gameId: 9,
  source: "igdb",
  name: "Counter-Strike 2",
  coverUrl: "cover",
  importedAt: "2026-01-01T00:00:00.000Z",
  providerSeconds: 7_200,
  lastReadAt: "2026-01-01T00:00:00.000Z",
  linkedExeNames: [],
  linkedExeSources: [],
};

function resolverResponse(executable: {
  value: string;
  verified: boolean;
  ambiguous?: boolean;
}) {
  return new Response(
    JSON.stringify({
      results: [
        {
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
              provenance: "community",
              ...executable,
            },
          ],
        },
      ],
    }),
    { status: 200 },
  );
}

describe("Steam import match recheck", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("creates a local match for a newly approved safe executable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => resolverResponse({ value: "cs2.exe", verified: true })),
    );

    const result = await checkLibraryImportForMatches({
      apiEndpoint: "https://example.test",
      entry,
    });

    expect(result.kind).toBe("found");
    if (result.kind !== "found") return;
    expect(result.executableNames).toEqual(["cs2.exe"]);
    expect(result.commit.entry.linkedExeNames).toEqual(["cs2.exe"]);
    expect(result.commit.entry.linkedExeSources).toEqual(["community"]);
    expect(result.commit.exeCacheEntries[0]).toMatchObject({
      exeName: "cs2.exe",
      identifierSource: "community",
      gameId: 9,
    });
  });

  it("keeps unknown provider playtime unknown after a metadata recheck", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => resolverResponse({ value: "cs2.exe", verified: true })),
    );

    const result = await checkLibraryImportForMatches({
      apiEndpoint: "https://example.test",
      entry: { ...entry, providerSeconds: null },
    });

    expect(result.kind).toBe("found");
    if (result.kind !== "found") return;
    expect(result.commit.entry.providerSeconds).toBeNull();
  });

  it("locally links an ambiguous executable without an install path", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        resolverResponse({
          value: "game.exe",
          verified: true,
          ambiguous: true,
        }),
      ),
    );

    const result = await checkLibraryImportForMatches({
      apiEndpoint: "https://example.test",
      entry,
    });

    expect(result.kind).toBe("found");
    if (result.kind !== "found") return;
    expect(result.executableNames).toEqual(["game.exe"]);
    expect(result.commit.exeCacheEntries[0]).toMatchObject({
      exeName: "game.exe",
      gameId: 9,
      identifierSource: "community",
    });
  });

  it("also path-scopes an ambiguous executable when install root is known", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        resolverResponse({
          value: "game.exe",
          verified: true,
          ambiguous: true,
        }),
      ),
    );

    const result = await checkLibraryImportForMatches({
      apiEndpoint: "https://example.test",
      entry,
      install: {
        provider: "steam",
        externalId: "730",
        installPath: String.raw`C:\Steam\steamapps\common\CS2`,
        scannedAt: "2026-01-01T00:00:00.000Z",
      },
    });

    expect(result.kind).toBe("found");
    if (result.kind !== "found") return;
    expect(result.commit.exeCacheEntries[0]).toMatchObject({
      exeName: "game.exe",
      gameId: 9,
    });
    expect(result.commit.scopedLinks[0]).toMatchObject({
      exeName: "game.exe",
      pathPrefix: String.raw`c:\steam\steamapps\common\cs2`,
    });
  });
});


describe("Xbox import match recheck", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    { ambiguous: false, installed: false, expected: "found" },
    { ambiguous: true, installed: false, expected: "needs_install" },
    { ambiguous: true, installed: true, expected: "found" },
  ])("handles ambiguous=$ambiguous, installed=$installed safely", async ({ ambiguous, installed, expected }) => {
    const fetchMock = vi.fn(async () => {
      const response = await resolverResponse({ value: "game.exe", verified: true, ambiguous }).json();
      return new Response(JSON.stringify(response.results[0]), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await checkLibraryImportForMatches({
      apiEndpoint: "https://example.test",
      entry: { ...entry, provider: "xbox", externalId: "1234", providerSeconds: null },
      install: installed ? {
        provider: "xbox",
        externalId: "1234",
        installPath: String.raw`C:\XboxGames\Game`,
        scannedAt: entry.lastReadAt,
      } : undefined,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.test/api/library/reverse-resolve",
      expect.objectContaining({ body: JSON.stringify({ gameId: entry.gameId }) }),
    );
    expect(result.kind).toBe(expected);
    if (result.kind !== "found") return;
    expect(result.commit.entry).toMatchObject({
      provider: "xbox", externalId: "1234", providerSeconds: null,
      linkedExeNames: ["game.exe"],
    });
    if (ambiguous) {
      expect(result.commit.exeCacheEntries).toEqual([]);
      expect(result.commit.scopedLinks[0]).toMatchObject({
        provider: "xbox", externalId: "1234", gameId: entry.gameId,
        pathPrefix: String.raw`c:\xboxgames\game`,
      });
    } else {
      expect(result.commit.exeCacheEntries[0]).toMatchObject({
        exeName: "game.exe", gameId: entry.gameId,
      });
    }
  });

  it("reports no match when the confirmed Xbox game still has no executables", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      const response = await resolverResponse({ value: "game.exe", verified: true }).json();
      return new Response(JSON.stringify({ ...response.results[0], executables: [] }), { status: 200 });
    }));
    const result = await checkLibraryImportForMatches({
      apiEndpoint: "https://example.test",
      entry: { ...entry, provider: "xbox" },
    });
    expect(result.kind).toBe("not_found");
  });
});
