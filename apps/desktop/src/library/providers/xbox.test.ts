import { afterEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

import {
  reverseResolveXboxGame,
  scanXboxLibrary,
  searchXboxGames,
  xboxProvider,
} from "./xbox";
import { buildLibraryImportCommit } from "../importPlan";

const endpoint = "https://api.playcounter.test";
const firstAttemptId = "a".repeat(48);
const secondAttemptId = "b".repeat(48);

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("Xbox library provider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    invokeMock.mockReset();
  });

  it("is available without local detection and exposes one sign-in account", async () => {
    await expect(xboxProvider.detect()).resolves.toEqual({
      provider: "xbox",
      available: true,
      checkedPaths: [],
    });
    await expect(xboxProvider.listAccounts()).resolves.toEqual([
      {
        accountId: 0,
        personaName: "Sign in with Microsoft",
        mostRecent: true,
        gamesWithPlaytime: 0,
      },
    ]);
  });

  it("opens Microsoft sign-in and maps server-resolved games without losing unknown playtime", async () => {
    invokeMock.mockResolvedValue(undefined);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          attemptId: firstAttemptId,
          authorizeUrl:
            "https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          status: "done",
          games: [
            {
              externalId: "1234",
              name: "Forza Horizon 5",
              providerSeconds: null,
              providerLastPlayedAt: "2026-08-31T12:00:00.000Z",
              candidates: [
                {
                  id: 42,
                  igdbId: 133430,
                  name: "Forza Horizon 5",
                  coverUrl: "cover",
                  source: "igdb",
                },
              ],
            },
          ],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      scanXboxLibrary({ apiEndpoint: `${endpoint}/` }),
    ).resolves.toEqual({
      games: [
        {
          externalId: "1234",
          name: "Forza Horizon 5",
          playtimeSeconds: null,
          lastPlayedUnix: 1_788_177_600,
          installed: false,
          executables: [],
        },
      ],
      warnings: [],
      partial: false,
      resolvedGames: [
        {
          key: "xbox:1234",
          status: "unknown",
          executables: [],
          candidates: [
            {
              id: 42,
              igdbId: 133430,
              name: "Forza Horizon 5",
              coverUrl: "cover",
              source: "igdb",
            },
          ],
        },
      ],
    });
    expect(invokeMock).toHaveBeenCalledWith("open_microsoft_signin_url", {
      url: "https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize",
    });
    expect(String(fetchMock.mock.calls[1][0])).toBe(
      `${endpoint}/api/xbox/import/result?attemptId=${firstAttemptId}`,
    );
  });

  it("cancels promptly even when server cleanup does not respond", async () => {
    invokeMock.mockResolvedValue(undefined);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          attemptId: secondAttemptId,
          authorizeUrl:
            "https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize",
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ status: "pending" }))
      .mockImplementationOnce(
        (_input: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener(
              "abort",
              () => reject(new DOMException("Aborted", "AbortError")),
              { once: true },
            );
          }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();

    const scan = scanXboxLibrary({
      apiEndpoint: endpoint,
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    vi.useFakeTimers();
    controller.abort();

    await expect(scan).rejects.toThrow("Xbox sign-in was cancelled.");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[2][0])).toBe(
      `${endpoint}/api/xbox/import/cancel`,
    );
    expect(JSON.parse(String(fetchMock.mock.calls[2][1]?.body))).toEqual({
      attemptId: secondAttemptId,
    });

    await vi.advanceTimersByTimeAsync(3_000);
  });

  it("rejects malformed Xbox game data before it reaches import state", async () => {
    invokeMock.mockResolvedValue(undefined);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          attemptId: firstAttemptId,
          authorizeUrl:
            "https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          status: "done",
          games: [
            {
              externalId: "",
              name: "Broken title",
              providerSeconds: 10,
              candidates: [],
            },
          ],
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(scanXboxLibrary({ apiEndpoint: endpoint })).rejects.toThrow(
      "Xbox import returned invalid game data.",
    );
  });

  it("searches persisted IGDB games for manual Xbox matching", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        games: [
          {
            id: 42,
            igdbId: 133430,
            name: "Forza Horizon 5",
            coverUrl: "cover",
            source: "igdb",
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      searchXboxGames(`${endpoint}/`, "Forza Horizon"),
    ).resolves.toEqual([
      {
        id: 42,
        igdbId: 133430,
        name: "Forza Horizon 5",
        coverUrl: "cover",
        source: "igdb",
      },
    ]);
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      `${endpoint}/api/games/search?query=Forza%20Horizon`,
    );
  });

  it("links verified executable mappings before the Xbox game is installed", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        game: {
          id: 42,
          igdbId: 17000,
          name: "No Man's Sky",
          coverUrl: "cover",
          releaseYear: 2016,
          source: "igdb",
        },
        executables: [
          {
            platform: "windows",
            kind: "exe",
            value: "NMS.exe",
            provenance: "igdb",
            verified: true,
          },
          {
            platform: "windows",
            kind: "exe",
            value: "NoMansSky.exe",
            provenance: "community",
            verified: true,
          },
          {
            platform: "windows",
            kind: "exe",
            value: "game.exe",
            provenance: "igdb",
            verified: true,
            ambiguous: true,
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const reverse = await reverseResolveXboxGame(endpoint, 42);
    const commit = buildLibraryImportCommit({
      provider: "xbox",
      scanned: {
        externalId: "1234",
        name: "No Man's Sky",
        playtimeSeconds: 3_600,
        installed: false,
        executables: [],
      },
      resolved: {
        key: "xbox:1234",
        status: "resolved",
        game: reverse.game,
        executables: reverse.executables,
      },
      now: "now",
    });

    expect(commit?.exeCacheEntries.map((entry) => entry.exeName)).toEqual([
      "NMS.exe",
      "NoMansSky.exe",
    ]);
    expect(commit?.scopedLinks).toEqual([]);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      gameId: 42,
    });
  });
});
