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
  it("waits and retries a throttled sign-in start before opening the browser", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, { status: 429, headers: { "Retry-After": "20" } }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          attemptId: firstAttemptId,
          authorizeUrl:
            "https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize",
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ status: "done", games: [] }));
    vi.stubGlobal("fetch", fetchMock);
    invokeMock.mockResolvedValue({ games: [], warnings: [], partial: false });
    const waiting = vi.fn();
    const run = scanXboxLibrary({
      apiEndpoint: "https://xbox-start-cooldown.example",
      onRateLimitWait: waiting,
    });
    await vi.advanceTimersByTimeAsync(19_999);
    expect(invokeMock).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(waiting).toHaveBeenLastCalledWith(true);
    await vi.advanceTimersByTimeAsync(1);
    await expect(run).resolves.toMatchObject({ games: [] });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(
      invokeMock.mock.calls.filter(
        ([command]) => command === "open_microsoft_signin_url",
      ),
    ).toHaveLength(1);
    expect(waiting).toHaveBeenLastCalledWith(false);
  });

  it("can cancel before a throttled sign-in start without creating a later attempt", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(null, { status: 429, headers: { "Retry-After": "20" } }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    const run = scanXboxLibrary({
      apiEndpoint: "https://xbox-cancel-start.example",
      signal: controller.signal,
    });
    const rejected = expect(run).rejects.toThrow(/cancelled/i);
    await vi.advanceTimersByTimeAsync(1_000);
    controller.abort();
    await rejected;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(invokeMock).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("resumes a throttled status poll without cancelling the import", async () => {
    vi.useFakeTimers();
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
        new Response(null, { status: 429, headers: { "Retry-After": "20" } }),
      )
      .mockResolvedValueOnce(jsonResponse({ status: "done", games: [] }));
    vi.stubGlobal("fetch", fetchMock);
    invokeMock.mockResolvedValue({ games: [], warnings: [], partial: false });
    const result = scanXboxLibrary({
      apiEndpoint: "https://xbox-cooldown.example",
      openAuthorizeUrl: false,
    });
    await vi.advanceTimersByTimeAsync(19_999);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toMatchObject({ games: [] });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[2][0])).toContain(
      "/api/xbox/import/result",
    );
  });

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

  it("opens the installed Xbox app", async () => {
    invokeMock.mockResolvedValue(undefined);

    await expect(xboxProvider.launch("1234", "store")).resolves.toBeUndefined();

    expect(invokeMock).toHaveBeenCalledWith("open_xbox_app");
  });

  it("launches an installed title through the Xbox provider", async () => {
    invokeMock.mockResolvedValue(undefined);

    await expect(xboxProvider.launch("1234")).resolves.toBeUndefined();

    expect(invokeMock).toHaveBeenCalledWith("library_launch_app", {
      provider: "xbox",
      externalId: "1234",
      mode: "play",
    });
  });

  it("opens Microsoft sign-in and maps server-resolved games without losing unknown playtime", async () => {
    invokeMock.mockImplementation(async (command: string) =>
      command === "library_scan_xbox_local"
        ? {
            games: [
              {
                externalId: "1234",
                name: "Forza Horizon 5",
                installPath: String.raw`C:\XboxGames\Forza Horizon 5\Content`,
                executables: [
                  {
                    fileName: "ForzaHorizon5.exe",
                    relativePath: "ForzaHorizon5.exe",
                    sizeBytes: 1_000_000,
                    depth: 0,
                    declared: true,
                  },
                ],
              },
              {
                externalId: "9999",
                name: "Local only",
                installPath: String.raw`D:\XboxGames\Local only\Content`,
                executables: [],
              },
            ],
            warnings: ["local scan warning"],
            partial: true,
          }
        : undefined,
    );
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
    const onAuthorizeUrl = vi.fn();

    await expect(
      scanXboxLibrary({
        apiEndpoint: `${endpoint}/`,
        onAuthorizeUrl,
      }),
    ).resolves.toEqual({
      games: [
        {
          externalId: "1234",
          name: "Forza Horizon 5",
          playtimeSeconds: null,
          lastPlayedUnix: 1_788_177_600,
          installed: true,
          installPath: String.raw`C:\XboxGames\Forza Horizon 5\Content`,
          executables: [
            {
              fileName: "ForzaHorizon5.exe",
              relativePath: "ForzaHorizon5.exe",
              sizeBytes: 1_000_000,
              depth: 0,
              declared: true,
            },
          ],
        },
      ],
      warnings: ["local scan warning"],
      partial: true,
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
    expect(onAuthorizeUrl).toHaveBeenCalledWith(
      "https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize",
    );
    expect(String(fetchMock.mock.calls[1][0])).toBe(
      `${endpoint}/api/xbox/import/result?attemptId=${firstAttemptId}`,
    );
  });

  it("keeps the import alive when automatic browser opening fails", async () => {
    invokeMock.mockRejectedValue(new Error("stale browser session"));
    const authorizeUrl =
      "https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize";
    const onAuthorizeUrl = vi.fn();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ attemptId: firstAttemptId, authorizeUrl }),
      )
      .mockResolvedValueOnce(jsonResponse({ status: "done", games: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      scanXboxLibrary({ apiEndpoint: endpoint, onAuthorizeUrl }),
    ).resolves.toMatchObject({ games: [], resolvedGames: [] });

    expect(onAuthorizeUrl).toHaveBeenCalledWith(authorizeUrl);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns a copy-only link and actionable account failure", async () => {
    invokeMock.mockResolvedValue(undefined);
    const authorizeUrl =
      "https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize";
    const onAuthorizeUrl = vi.fn();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ attemptId: firstAttemptId, authorizeUrl }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          status: "failed",
          reason: "oauth_error",
          stage: "xbox_xsts",
          accountLabel: "player@example.com",
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      scanXboxLibrary({
        apiEndpoint: endpoint,
        onAuthorizeUrl,
        openAuthorizeUrl: false,
      }),
    ).rejects.toThrow(
      /Microsoft account: player@example\.com.*Xbox Live could not create a gaming session.*private browser window/,
    );

    expect(onAuthorizeUrl).toHaveBeenCalledWith(authorizeUrl);
    expect(invokeMock).not.toHaveBeenCalled();
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
      .mockResolvedValueOnce(
        jsonResponse({ status: "pending", stage: "history" }),
      )
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
    const onXboxProgress = vi.fn();

    const scan = scanXboxLibrary({
      apiEndpoint: endpoint,
      signal: controller.signal,
      onXboxProgress,
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    vi.useFakeTimers();
    controller.abort();

    await expect(scan).rejects.toThrow("Xbox sign-in was cancelled.");
    expect(onXboxProgress.mock.calls.map(([stage]) => stage)).toEqual([
      "authorization",
      "history",
    ]);
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
      `${endpoint}/api/games/search?query=Forza%20Horizon&mainGamesAndRemastersOnly=true`,
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
