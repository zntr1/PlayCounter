import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock, recordHealthMock, accountOperation } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  recordHealthMock: vi.fn(),
  accountOperation: { revision: 0 },
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("../loginHealth", () => ({
  recordLoginHealth: recordHealthMock,
  supersedeLoginCheck: vi.fn(),
  getLoginOperationRevision: () => accountOperation.revision,
}));

import {
  refreshXboxAchievementList,
  scanXboxLibrary,
  signInXboxAccount,
  xboxProvider,
  XboxSignInRequiredError,
} from "./xbox";
import { useKeptLogins } from "../keptLogins";
import { reverseResolveLibraryGame, searchLibraryGames } from "../gameLookup";
import { buildLibraryImportCommit } from "../importPlan";

const endpoint = "https://api.playcounter.test";
const firstAttemptId = "a".repeat(48);
const secondAttemptId = "b".repeat(48);

beforeEach(() => {
  recordHealthMock.mockReset();
  accountOperation.revision = 0;
  useKeptLogins.setState({ logins: [] });
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("Xbox library provider", () => {
  it("rejects unencrypted remote account APIs before starting authentication", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      scanXboxLibrary({ apiEndpoint: "http://api.example.com" }),
    ).rejects.toThrow("HTTPS");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a spoofed authorization URL before showing it or opening a browser", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          attemptId: firstAttemptId,
          authorizeUrl:
            "https://login.microsoftonline.com.evil.test/consumers/oauth2/v2.0/authorize",
        }),
      ),
    );
    const onAuthorizeUrl = vi.fn();
    await expect(
      scanXboxLibrary({ apiEndpoint: endpoint, onAuthorizeUrl }),
    ).rejects.toThrow("unsupported sign-in URL");
    expect(onAuthorizeUrl).not.toHaveBeenCalled();
    expect(invokeMock).not.toHaveBeenCalledWith(
      "open_microsoft_signin_url",
      expect.anything(),
    );
  });
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
    expect(invokeMock).not.toHaveBeenCalledWith(
      "open_microsoft_signin_url",
      expect.anything(),
    );
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
    expect(invokeMock).not.toHaveBeenCalledWith(
      "open_microsoft_signin_url",
      expect.anything(),
    );
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
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "open_microsoft_signin_url") {
        throw new Error("stale browser session");
      }
      if (command === "library_scan_xbox_local") {
        return { games: [], warnings: [], partial: false };
      }
    });
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
    expect(invokeMock).not.toHaveBeenCalledWith(
      "open_microsoft_signin_url",
      expect.anything(),
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
      searchLibraryGames(`${endpoint}/`, "Forza Horizon", {
        mainGamesAndRemastersOnly: true,
      }),
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

    const reverse = await reverseResolveLibraryGame(endpoint, 42);
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

describe("Xbox achievements", () => {
  const authorizeUrl =
    "https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize";
  const list = {
    provider: "xbox",
    externalId: "1234",
    fetchedAt: 1_790_000_000_000,
    achievements: [
      {
        id: "scid:1",
        name: "First win",
        description: "Win a race.",
        hidden: false,
        unlocked: true,
        unlockedAt: 1_780_000_000_000,
        gamerscore: 30,
      },
    ],
  };

  afterEach(() => {
    vi.unstubAllGlobals();
    invokeMock.mockReset();
  });

  function startBody(fetchMock: ReturnType<typeof vi.fn>, call: number) {
    const body = fetchMock.mock.calls[call][1]?.body;
    return body === undefined ? undefined : JSON.parse(String(body));
  }

  it("an import asks Xbox for achievements and hands the lists back", async () => {
    invokeMock.mockResolvedValue({ games: [], warnings: [], partial: false });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ attemptId: firstAttemptId, authorizeUrl }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          status: "done",
          games: [
            {
              externalId: "1234",
              name: "Forza Horizon 5",
              providerSeconds: 60,
              candidates: [],
              achievements: list,
            },
            {
              externalId: "5678",
              name: "Old game",
              providerSeconds: null,
              candidates: [],
              achievementError: "unavailable",
            },
            {
              externalId: "9012",
              name: "Broken list",
              providerSeconds: null,
              candidates: [],
              achievements: { ...list, externalId: "9012", achievements: "x" },
            },
          ],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await scanXboxLibrary({ apiEndpoint: endpoint });

    expect(startBody(fetchMock, 0)).toEqual({
      includeAchievements: true,
      language: "en",
    });
    expect(result.achievementLists).toEqual([list]);
    // A broken list never costs the game its import.
    expect(result.games.map((game) => game.externalId)).toEqual([
      "1234",
      "5678",
      "9012",
    ]);
  });

  it("a list for another title than its game is dropped", async () => {
    invokeMock.mockResolvedValue({ games: [], warnings: [], partial: false });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse({ attemptId: firstAttemptId, authorizeUrl }),
        )
        .mockResolvedValueOnce(
          jsonResponse({
            status: "done",
            games: [
              {
                externalId: "5678",
                name: "Other",
                providerSeconds: null,
                candidates: [],
                achievements: list,
              },
            ],
          }),
        ),
    );
    const result = await scanXboxLibrary({ apiEndpoint: endpoint });
    expect(result.achievementLists).toBeUndefined();
  });

  it("an older server that refuses the option still imports", async () => {
    invokeMock.mockResolvedValue({ games: [], warnings: [], partial: false });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: "Bad Request" }, 400))
      .mockResolvedValueOnce(
        jsonResponse({ attemptId: firstAttemptId, authorizeUrl }),
      )
      .mockResolvedValueOnce(jsonResponse({ status: "done", games: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(scanXboxLibrary({ apiEndpoint: endpoint })).resolves.toEqual({
      games: [],
      warnings: [],
      partial: false,
      resolvedGames: [],
    });
    expect(startBody(fetchMock, 0)).toEqual({
      includeAchievements: true,
      language: "en",
    });
    expect(startBody(fetchMock, 1)).toBeUndefined();
  });

  it("refresh asks only for the one title and skips this PC's scan", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ attemptId: firstAttemptId, authorizeUrl }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          status: "done",
          games: [
            {
              externalId: "1234",
              name: "Xbox title 1234",
              providerSeconds: null,
              candidates: [],
              achievements: list,
            },
          ],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const onAuthorizeUrl = vi.fn();

    await expect(
      refreshXboxAchievementList("1234", {
        apiEndpoint: endpoint,
        onAuthorizeUrl,
      }),
    ).resolves.toEqual({ list });
    expect(startBody(fetchMock, 0)).toEqual({
      achievementTitleIds: ["1234"],
      language: "en",
    });
    expect(onAuthorizeUrl).toHaveBeenCalledWith(authorizeUrl);
    expect(invokeMock).toHaveBeenCalledWith("open_microsoft_signin_url", {
      url: authorizeUrl,
    });
    expect(invokeMock).not.toHaveBeenCalledWith("library_scan_xbox_local");
  });

  it("refresh reports why Xbox sent no list", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse({ attemptId: firstAttemptId, authorizeUrl }),
        )
        .mockResolvedValueOnce(
          jsonResponse({
            status: "done",
            games: [
              {
                externalId: "1234",
                name: "Xbox title 1234",
                providerSeconds: null,
                candidates: [],
                achievementError: "unavailable",
              },
            ],
          }),
        ),
    );
    await expect(
      refreshXboxAchievementList("1234", {
        apiEndpoint: endpoint,
        openAuthorizeUrl: false,
      }),
    ).resolves.toEqual({ error: "unavailable" });
  });

  it("refresh on an older server says it isn't there yet", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ error: "Bad Request" }, 400)),
    );
    await expect(
      refreshXboxAchievementList("1234", { apiEndpoint: endpoint }),
    ).rejects.toThrow(/server/i);
    expect(invokeMock).not.toHaveBeenCalledWith(
      "open_microsoft_signin_url",
      expect.anything(),
    );
  });
});

describe("Kept Xbox sign-in", () => {
  const authorizeUrl =
    "https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize";
  const claimHash = "f".repeat(64);
  const localScan = { games: [], warnings: [], partial: false };

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    invokeMock.mockReset();
  });

  function answer(commands: Record<string, unknown>) {
    invokeMock.mockImplementation(async (command: string) => commands[command]);
  }

  function startBody(fetchMock: ReturnType<typeof vi.fn>, call: number) {
    const body = fetchMock.mock.calls[call][1]?.body;
    return body === undefined ? undefined : JSON.parse(String(body));
  }

  it("never creates an OAuth attempt when a background refresh has no saved sign-in", async () => {
    answer({ xbox_login_sync_start: { status: "signedOut" } });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      refreshXboxAchievementList("1234", {
        apiEndpoint: endpoint,
        savedLoginOnly: true,
      }),
    ).rejects.toBeInstanceOf(XboxSignInRequiredError);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(invokeMock).not.toHaveBeenCalledWith(
      "xbox_login_claim_hash",
      expect.anything(),
    );
    expect(invokeMock).not.toHaveBeenCalledWith(
      "open_microsoft_signin_url",
      expect.anything(),
    );
  });

  it("marks a rejected saved sign-in as requiring login without creating an OAuth attempt", async () => {
    useKeptLogins.setState({
      logins: [{ service: "xbox", name: "Chief", savedAt: 1 }],
    });
    answer({ xbox_login_sync_start: { status: "signedOut" } });
    vi.stubGlobal("fetch", vi.fn());
    await expect(
      refreshXboxAchievementList("1234", {
        apiEndpoint: endpoint,
        savedLoginOnly: true,
      }),
    ).rejects.toBeInstanceOf(XboxSignInRequiredError);
    expect(recordHealthMock).toHaveBeenCalledWith("xbox", "needsSignIn");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps transient background failures distinct from expired authentication", async () => {
    useKeptLogins.setState({
      logins: [{ service: "xbox", name: "Chief", savedAt: 1 }],
    });
    answer({
      xbox_login_sync_start: { status: "unavailable", httpStatus: 502 },
    });
    vi.stubGlobal("fetch", vi.fn());
    await expect(
      refreshXboxAchievementList("1234", {
        apiEndpoint: endpoint,
        savedLoginOnly: true,
      }),
    ).rejects.not.toBeInstanceOf(XboxSignInRequiredError);
    expect(recordHealthMock).toHaveBeenCalledWith("xbox", "unavailable");
    expect(recordHealthMock).not.toHaveBeenCalledWith("xbox", "needsSignIn");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refreshes achievements silently with a saved login and records successful renewal", async () => {
    answer({
      xbox_login_sync_start: { status: "started", attemptId: firstAttemptId },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        jsonResponse({
          status: "done",
          games: [
            {
              externalId: "1234",
              name: "Game",
              providerSeconds: null,
              candidates: [],
              achievementError: "unavailable",
            },
          ],
        }),
      ),
    );
    await expect(
      refreshXboxAchievementList("1234", {
        apiEndpoint: endpoint,
        savedLoginOnly: true,
      }),
    ).resolves.toEqual({ error: "unavailable" });
    expect(recordHealthMock).toHaveBeenCalledWith("xbox", "valid");
    expect(invokeMock).not.toHaveBeenCalledWith(
      "xbox_login_claim_hash",
      expect.anything(),
    );
    expect(invokeMock).not.toHaveBeenCalledWith(
      "open_microsoft_signin_url",
      expect.anything(),
    );
  });

  it("treats an unexpected native answer as unavailable without starting OAuth", async () => {
    answer({ xbox_login_sync_start: undefined });
    vi.stubGlobal("fetch", vi.fn());
    await expect(
      refreshXboxAchievementList("1234", {
        apiEndpoint: endpoint,
        savedLoginOnly: true,
      }),
    ).rejects.not.toBeInstanceOf(XboxSignInRequiredError);
    expect(recordHealthMock).toHaveBeenCalledWith("xbox", "unavailable");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not publish an old account's late authentication result after an account change", async () => {
    let finish!: (value: unknown) => void;
    invokeMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ status: "done", games: [] })),
    );
    const pending = refreshXboxAchievementList("1234", {
      apiEndpoint: endpoint,
      savedLoginOnly: true,
    });
    accountOperation.revision++;
    finish({ status: "started", attemptId: firstAttemptId });
    await pending;
    expect(recordHealthMock).not.toHaveBeenCalled();
  });

  it("imports with the kept sign-in, without a browser", async () => {
    answer({
      xbox_login_sync_start: { status: "started", attemptId: firstAttemptId },
      library_scan_xbox_local: localScan,
    });
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        status: "done",
        games: [
          {
            externalId: "1234",
            name: "Forza Horizon 5",
            providerSeconds: 60,
            candidates: [],
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const onAuthorizeUrl = vi.fn();
    const onXboxProgress = vi.fn();

    const result = await scanXboxLibrary({
      apiEndpoint: endpoint,
      onAuthorizeUrl,
      onXboxProgress,
    });

    expect(result.games.map((game) => game.externalId)).toEqual(["1234"]);
    expect(invokeMock).toHaveBeenCalledWith("xbox_login_sync_start", {
      apiEndpoint: endpoint,
      options: { includeAchievements: true, language: "en" },
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      `/api/xbox/import/result?attemptId=${firstAttemptId}`,
    );
    expect(onAuthorizeUrl).not.toHaveBeenCalled();
    expect(onXboxProgress).toHaveBeenCalledWith("history");
    expect(invokeMock).not.toHaveBeenCalledWith(
      "open_microsoft_signin_url",
      expect.anything(),
    );
    expect(invokeMock).not.toHaveBeenCalledWith(
      "xbox_login_claim_hash",
      expect.anything(),
    );
  });

  it("signs in in the browser when nothing is kept, and keeps that sign-in", async () => {
    answer({
      xbox_login_sync_start: { status: "signedOut" },
      xbox_login_claim_hash: claimHash,
      xbox_login_keep: true,
      logins_list: [{ service: "xbox", name: "Chief", savedAt: 1 }],
      library_scan_xbox_local: localScan,
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ attemptId: firstAttemptId, authorizeUrl }),
      )
      .mockResolvedValueOnce(jsonResponse({ status: "done", games: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await scanXboxLibrary({ apiEndpoint: endpoint });

    expect(startBody(fetchMock, 0)).toEqual({
      includeAchievements: true,
      language: "en",
      keepLogin: { claimHash },
    });
    expect(invokeMock).toHaveBeenCalledWith("xbox_login_claim_hash", {
      apiEndpoint: endpoint,
    });
    expect(invokeMock).toHaveBeenCalledWith("open_microsoft_signin_url", {
      url: authorizeUrl,
    });
    expect(invokeMock).toHaveBeenCalledWith("xbox_login_keep", {
      attemptId: firstAttemptId,
      claimHash,
    });
  });

  it("does not report a completed sign-in before the native claim is saved", async () => {
    let finishClaim!: (kept: boolean) => void;
    const pendingClaim = new Promise<boolean>((resolve) => {
      finishClaim = resolve;
    });
    answer({
      xbox_login_sync_start: { status: "signedOut" },
      xbox_login_claim_hash: claimHash,
      xbox_login_keep: pendingClaim,
      logins_list: [{ service: "xbox", name: "Chief", savedAt: 1 }],
      library_scan_xbox_local: localScan,
    });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse({ attemptId: firstAttemptId, authorizeUrl }),
        )
        .mockResolvedValueOnce(jsonResponse({ status: "done", games: [] })),
    );
    const completed = vi.fn();
    const run = scanXboxLibrary({ apiEndpoint: endpoint }).then(completed);
    await vi.waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("xbox_login_keep", {
        attemptId: firstAttemptId,
        claimHash,
      }),
    );
    expect(completed).not.toHaveBeenCalled();
    finishClaim(true);
    await run;
    expect(completed).toHaveBeenCalledOnce();
    expect(invokeMock).toHaveBeenCalledWith("logins_list");
  });

  it("saves authentication while history is pending and retains it if history fails", async () => {
    vi.useFakeTimers();
    answer({
      xbox_login_sync_start: { status: "signedOut" },
      xbox_login_claim_hash: claimHash,
      xbox_login_keep: true,
      logins_list: [{ service: "xbox", name: "Chief", savedAt: 1 }],
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ attemptId: firstAttemptId, authorizeUrl }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ status: "pending", stage: "history", loginReady: true }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          status: "failed",
          reason: "provider_error",
          loginReady: true,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const run = scanXboxLibrary({
      apiEndpoint: endpoint,
      openAuthorizeUrl: false,
    });
    const rejected = expect(run).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(invokeMock).toHaveBeenCalledWith("xbox_login_keep", {
      attemptId: firstAttemptId,
      claimHash,
    });
    expect(invokeMock).toHaveBeenCalledWith("logins_list");
    await vi.advanceTimersByTimeAsync(1_500);
    await rejected;
    expect(
      invokeMock.mock.calls.filter(
        ([command]) => command === "xbox_login_keep",
      ),
    ).toHaveLength(1);
  });

  it("finishes saving after leaving before the next authentication status poll", async () => {
    vi.useFakeTimers();
    let finishClaim!: (kept: boolean) => void;
    const pendingClaim = new Promise<boolean>((resolve) => {
      finishClaim = resolve;
    });
    answer({
      xbox_login_sync_start: { status: "signedOut" },
      xbox_login_claim_hash: claimHash,
      xbox_login_keep: pendingClaim,
      logins_list: [{ service: "xbox", name: "Chief", savedAt: 1 }],
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ attemptId: firstAttemptId, authorizeUrl }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ status: "pending", stage: "authorization" }),
      )
      .mockResolvedValueOnce(jsonResponse({ cancelled: true }));
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    const run = scanXboxLibrary({
      apiEndpoint: endpoint,
      signal: controller.signal,
      openAuthorizeUrl: false,
    });
    const rejected = expect(run).rejects.toThrow(/cancelled/i);
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await rejected;
    expect(invokeMock).toHaveBeenCalledWith("xbox_login_keep", {
      attemptId: firstAttemptId,
      claimHash,
    });
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).endsWith("/cancel")),
    ).toBe(true);
    expect(invokeMock).not.toHaveBeenCalledWith("logins_list");
    finishClaim(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(invokeMock).toHaveBeenCalledWith("logins_list");
    expect(invokeMock).not.toHaveBeenCalledWith("library_scan_xbox_local");
  });

  it("connects an account without requesting games, achievements, or local scans", async () => {
    answer({
      xbox_login_sync_start: { status: "signedOut" },
      xbox_login_claim_hash: claimHash,
      xbox_login_keep: true,
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ attemptId: firstAttemptId, authorizeUrl }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ status: "done", games: [], loginReady: true }),
      );
    vi.stubGlobal("fetch", fetchMock);
    await signInXboxAccount({ apiEndpoint: endpoint, openAuthorizeUrl: false });
    expect(startBody(fetchMock, 0)).toEqual({
      authenticationOnly: true,
      keepLogin: { claimHash },
    });
    expect(invokeMock).not.toHaveBeenCalledWith("library_scan_xbox_local");
  });

  it("retries a terminal login save before completing the connection", async () => {
    const claims = [false, true];
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "xbox_login_sync_start") return { status: "signedOut" };
      if (command === "xbox_login_claim_hash") return claimHash;
      if (command === "xbox_login_keep") return claims.shift();
    });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse({ attemptId: firstAttemptId, authorizeUrl }),
        )
        .mockResolvedValueOnce(
          jsonResponse({ status: "done", games: [], loginReady: true }),
        ),
    );
    await expect(
      signInXboxAccount({ apiEndpoint: endpoint, openAuthorizeUrl: false }),
    ).resolves.toBeUndefined();
    expect(
      invokeMock.mock.calls.filter(
        ([command]) => command === "xbox_login_keep",
      ),
    ).toHaveLength(2);
    expect(invokeMock).toHaveBeenCalledWith("logins_list");
  });

  it("reports a save failure instead of completing with an unsaved connection", async () => {
    answer({
      xbox_login_sync_start: { status: "signedOut" },
      xbox_login_claim_hash: claimHash,
      xbox_login_keep: false,
    });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse({ attemptId: firstAttemptId, authorizeUrl }),
        )
        .mockResolvedValueOnce(
          jsonResponse({ status: "done", games: [], loginReady: true }),
        )
        .mockResolvedValueOnce(jsonResponse({ cancelled: true })),
    );
    await expect(
      signInXboxAccount({ apiEndpoint: endpoint, openAuthorizeUrl: false }),
    ).rejects.toThrow("unavailable");
    expect(invokeMock).not.toHaveBeenCalledWith("logins_list");
  });

  it("uses a saved login on an older server that lacks separate account connections", async () => {
    const syncAnswers = [
      { status: "unavailable", httpStatus: 400 },
      { status: "started", attemptId: firstAttemptId },
    ];
    invokeMock.mockImplementation(async (command: string) =>
      command === "xbox_login_sync_start" ? syncAnswers.shift() : undefined,
    );
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ status: "done", games: [] })),
    );
    await signInXboxAccount({ apiEndpoint: endpoint });
    expect(invokeMock).toHaveBeenNthCalledWith(1, "xbox_login_sync_start", {
      apiEndpoint: endpoint,
      options: { authenticationOnly: true },
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, "xbox_login_sync_start", {
      apiEndpoint: endpoint,
      options: {},
    });
    expect(invokeMock).not.toHaveBeenCalledWith(
      "open_microsoft_signin_url",
      expect.anything(),
    );
  });

  it("does not replace a temporarily failing native login lookup with a browser sign-in", async () => {
    invokeMock.mockRejectedValue(new Error("temporary native failure"));
    vi.stubGlobal("fetch", vi.fn());
    await expect(signInXboxAccount({ apiEndpoint: endpoint })).rejects.toThrow(
      "unavailable",
    );
    expect(invokeMock).not.toHaveBeenCalledWith(
      "open_microsoft_signin_url",
      expect.anything(),
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not open a browser when saved-login renewal stays busy", async () => {
    vi.useFakeTimers();
    answer({ xbox_login_sync_start: { status: "busy", retryAfterSeconds: 1 } });
    vi.stubGlobal("fetch", vi.fn());
    const rejected = expect(
      signInXboxAccount({ apiEndpoint: endpoint }),
    ).rejects.toThrow("unavailable");
    await vi.advanceTimersByTimeAsync(5_000);
    await rejected;
    expect(invokeMock).not.toHaveBeenCalledWith(
      "open_microsoft_signin_url",
      expect.anything(),
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("makes a final claim check when authentication fails without saving a login", async () => {
    answer({
      xbox_login_sync_start: { status: "signedOut" },
      xbox_login_claim_hash: claimHash,
    });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse({ attemptId: firstAttemptId, authorizeUrl }),
        )
        .mockResolvedValueOnce(
          jsonResponse({
            status: "failed",
            reason: "oauth_error",
            stage: "authorization",
          }),
        ),
    );

    await expect(
      scanXboxLibrary({ apiEndpoint: endpoint, openAuthorizeUrl: false }),
    ).rejects.toThrow("not completed");
    expect(invokeMock).toHaveBeenCalledWith("xbox_login_keep", {
      attemptId: firstAttemptId,
      claimHash,
    });
    expect(invokeMock).not.toHaveBeenCalledWith("logins_list");
  });

  it("an older server without kept sign-ins still imports with achievements", async () => {
    answer({
      xbox_login_sync_start: { status: "signedOut" },
      xbox_login_claim_hash: claimHash,
      library_scan_xbox_local: localScan,
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: "Bad Request" }, 400))
      .mockResolvedValueOnce(
        jsonResponse({ attemptId: firstAttemptId, authorizeUrl }),
      )
      .mockResolvedValueOnce(jsonResponse({ status: "done", games: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await scanXboxLibrary({ apiEndpoint: endpoint, openAuthorizeUrl: false });

    expect(startBody(fetchMock, 0)).toEqual({
      includeAchievements: true,
      language: "en",
      keepLogin: { claimHash },
    });
    expect(startBody(fetchMock, 1)).toEqual({
      includeAchievements: true,
      language: "en",
    });
    expect(invokeMock).not.toHaveBeenCalledWith(
      "xbox_login_keep",
      expect.anything(),
    );
  });

  it("waits while the server is busy, then imports with the kept sign-in", async () => {
    vi.useFakeTimers();
    const syncAnswers = [
      { status: "busy", retryAfterSeconds: 3 },
      { status: "started", attemptId: firstAttemptId },
    ];
    invokeMock.mockImplementation(async (command: string) =>
      command === "xbox_login_sync_start"
        ? syncAnswers.shift()
        : command === "library_scan_xbox_local"
          ? localScan
          : undefined,
    );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ status: "done", games: [] })),
    );
    const waiting = vi.fn();

    const run = scanXboxLibrary({
      apiEndpoint: endpoint,
      onRateLimitWait: waiting,
    });
    await vi.advanceTimersByTimeAsync(2_999);
    expect(waiting).toHaveBeenLastCalledWith(true);
    await vi.advanceTimersByTimeAsync(1);

    await expect(run).resolves.toMatchObject({ games: [] });
    expect(waiting).toHaveBeenLastCalledWith(false);
    expect(
      invokeMock.mock.calls.filter(
        ([command]) => command === "xbox_login_sync_start",
      ),
    ).toHaveLength(2);
  });

  it.each([400, 404, 502])(
    "preserves a saved login on server error %s without opening a browser",
    async (status) => {
      answer({
        xbox_login_sync_start: { status: "unavailable", httpStatus: status },
      });
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      await expect(scanXboxLibrary({ apiEndpoint: endpoint })).rejects.toThrow(
        `(${status})`,
      );
      expect(fetchMock).not.toHaveBeenCalled();
      expect(invokeMock).not.toHaveBeenCalledWith(
        "open_microsoft_signin_url",
        expect.anything(),
      );
    },
  );

  it("refreshes one title with the kept sign-in", async () => {
    answer({
      xbox_login_sync_start: { status: "started", attemptId: firstAttemptId },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        jsonResponse({
          status: "done",
          games: [
            {
              externalId: "1234",
              name: "Xbox title 1234",
              providerSeconds: null,
              candidates: [],
              achievementError: "unavailable",
            },
          ],
        }),
      ),
    );

    await expect(
      refreshXboxAchievementList("1234", { apiEndpoint: endpoint }),
    ).resolves.toEqual({ error: "unavailable" });
    expect(invokeMock).toHaveBeenCalledWith("xbox_login_sync_start", {
      apiEndpoint: endpoint,
      options: { achievementTitleIds: ["1234"], language: "en" },
    });
  });
});
