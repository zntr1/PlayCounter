import type { Contribution, Game, Session } from "@playcounter/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (value: string) => value,
  invoke: invokeMock,
}));
import {
  createGameIdentityResolver,
  resolvedCanonicalGameKey,
  useAppStore,
  type ExeCacheEntry,
} from "./store";
import {
  addManualSession,
  applyGameMatch,
  applyCommunitySuggestionOutcome,
  applyContributionMarkers,
  dismissAmbiguousMatch,
  hydrateGameMetadata,
  findGameMatches,
  ignoreDiscoveredProcess,
  suggestIgnoredProcess,
  persist,
  removeGameHistory,
  reportNegativeMatch,
  setGamePlaytime,
  suggestTrackedGameToCommunity,
  untrackGame,
} from "./tracker";

function entry(overrides: Partial<ExeCacheEntry> = {}): ExeCacheEntry {
  return {
    exeName: "Game.exe",
    state: "matched",
    gameId: -1,
    gameName: "Game",
    coverUrl: "cover",
    source: "custom",
    lastCheckedAt: "2026-08-09T00:00:00.000Z",
    ...overrides,
  };
}

function contribution(overrides: Partial<Contribution> = {}): Contribution {
  return {
    platform: "windows",
    kind: "exe",
    value: "Game.exe",
    gameId: 42,
    gameName: "Game",
    coverUrl: "cover",
    status: "rejected",
    reviewNote: "Wrong game",
    createdAt: "2026-08-09T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal("navigator", {
    userAgent: "Mozilla/5.0 (Windows NT 10.0)",
    platform: "Win32",
  });
  invokeMock.mockReset();
  invokeMock.mockImplementation(async (command: string) => {
    if (command === "set_user_ignored_process") {
      return {
        processes: ["game.exe"],
        userProcesses: ["game.exe"],
        userFilePath: "ignored-processes.txt",
      };
    }
    if (command === "scan_processes") return [];
    return undefined;
  });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: { setItem: vi.fn(), getItem: vi.fn(() => null) },
  });
  useAppStore.setState({
    exeCache: new Map(),
    activeSessions: [],
    ambiguousMatches: [],
    recentSessions: [],
    gameMetadata: new Map(),
    archivedSeconds: 0,
    archivedGameSeconds: {},
    playtimeAdjustments: {},
    blacklist: new Set(),
    ignoredProcesses: new Set(),
    userIgnoredProcesses: new Set(),
    installUuid: null,
    notifications: [],
    awardedMilestones: [],
    milestonesInitializedAt: null,
    backendHealth: {
      status: "online",
      checkedAt: "2026-08-09T00:00:00.000Z",
      detail: null,
    },
  });
});

describe("ignored process suggestions", () => {
  const installUuid = "550e8400-e29b-41d4-a716-446655440000";

  it("user-ignores locally and sends minimal, platform-scoped evidence", async () => {
    const cached = entry({
      exeName: "Service.exe",
      state: "unmatched",
      gameId: undefined,
      gameName: undefined,
    });
    useAppStore.setState({
      installUuid,
      exeCache: new Map([["service.exe", cached]]),
      settings: {
        ...useAppStore.getState().settings,
        autoShareIgnoredProcesses: true,
      },
    });
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({ status: "recorded" }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const outcome = await ignoreDiscoveredProcess("Service.exe");

    expect(outcome).toEqual({
      localBlockApplied: true,
      ignoreFileUpdated: true,
      suggestion: {
        kind: "suggested",
        status: "recorded",
      },
    });
    expect(invokeMock).toHaveBeenCalledWith("set_user_ignored_process", {
      exeName: "Service.exe",
      ignored: true,
    });
    expect(useAppStore.getState().blacklist.has("service.exe")).toBe(true);
    expect(useAppStore.getState().exeCache.has("service.exe")).toBe(false);
    expect(globalThis.localStorage.setItem).toHaveBeenCalled();
    const request = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith("/api/community/ignored-processes"),
    );
    expect(JSON.parse(String(request?.[1]?.body))).toEqual({
      exeName: "Service.exe",
      platform: "windows",
      installUuid,
    });
  });

  it("only user-ignores locally when automatic sharing is disabled", async () => {
    useAppStore.setState({
      installUuid,
      settings: {
        ...useAppStore.getState().settings,
        autoShareIgnoredProcesses: false,
      },
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(ignoreDiscoveredProcess("Service.exe")).resolves.toEqual({
      localBlockApplied: true,
      ignoreFileUpdated: true,
      suggestion: { kind: "disabled" },
    });
    expect(invokeMock).toHaveBeenCalledWith("set_user_ignored_process", {
      exeName: "Service.exe",
      ignored: true,
    });
    expect(useAppStore.getState().blacklist.has("service.exe")).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("protects matched games and pickers", async () => {
    useAppStore.setState({
      installUuid,
      exeCache: new Map([["game.exe", entry({ source: "igdb" })]]),
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(suggestIgnoredProcess("Game.exe")).resolves.toEqual({
      localBlockApplied: true,
      ignoreFileUpdated: true,
      suggestion: { kind: "not_eligible", reason: "matched_game" },
    });
    expect(fetchMock).not.toHaveBeenCalled();

    useAppStore.setState({
      blacklist: new Set(),
      ambiguousMatches: [
        {
          exeName: "Picker.exe",
          exePath: null,
          candidates: [],
          detectedAt: "2026-08-16T20:00:00.000Z",
        },
      ],
    });
    await expect(suggestIgnoredProcess("Picker.exe")).resolves.toEqual({
      localBlockApplied: true,
      ignoreFileUpdated: true,
      suggestion: { kind: "not_eligible", reason: "ambiguous_picker" },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still user-ignores locally when suggestions are unavailable offline", async () => {
    useAppStore.setState({
      installUuid,
      backendHealth: {
        status: "offline",
        checkedAt: "2026-08-16T20:00:00.000Z",
        detail: "unreachable",
      },
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(suggestIgnoredProcess("Service.exe")).resolves.toEqual({
      localBlockApplied: true,
      ignoreFileUpdated: true,
      suggestion: { kind: "skipped", reason: "offline" },
    });
    expect(invokeMock).toHaveBeenCalledWith("set_user_ignored_process", {
      exeName: "Service.exe",
      ignored: true,
    });
    expect(useAppStore.getState().blacklist.has("service.exe")).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps the local user-ignore when submitting the suggestion fails", async () => {
    useAppStore.setState({ installUuid });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 404,
        statusText: "Not Found",
      })),
    );

    await expect(suggestIgnoredProcess("Service.exe")).resolves.toEqual({
      localBlockApplied: true,
      ignoreFileUpdated: true,
      suggestion: { kind: "failed" },
    });
    expect(useAppStore.getState().blacklist.has("service.exe")).toBe(true);
    expect(invokeMock).toHaveBeenCalledWith("set_user_ignored_process", {
      exeName: "Service.exe",
      ignored: true,
    });
  });

  it("still submits the suggestion when the user ignore file cannot be updated", async () => {
    useAppStore.setState({ installUuid });
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "set_user_ignored_process") throw new Error("locked");
      if (command === "scan_processes") return [];
      return undefined;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({ status: "recorded" }),
      })),
    );

    await expect(suggestIgnoredProcess("Service.exe")).resolves.toEqual({
      localBlockApplied: true,
      ignoreFileUpdated: false,
      suggestion: {
        kind: "suggested",
        status: "recorded",
      },
    });
    expect(useAppStore.getState().blacklist.has("service.exe")).toBe(true);
  });

  it("shares one in-flight request between concurrent callers", async () => {
    useAppStore.setState({ installUuid });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchMock = vi.fn(async () => {
      await gate;
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({ status: "recorded" }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const first = suggestIgnoredProcess("Service.exe");
    const second = suggestIgnoredProcess("Service.exe");
    release();
    const [left, right] = await Promise.all([first, second]);
    expect(left).toEqual(right);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("negative match reports", () => {
  const installUuid = "550e8400-e29b-41d4-a716-446655440000";
  const activeSession = {
    id: 10,
    gameId: 42,
    gameName: "Wrong game",
    exeName: "Game.exe",
    coverUrl: "cover",
    source: "igdb" as const,
    startedAt: "2026-08-09T10:00:00.000Z",
    checkpointedAt: "2026-08-09T10:01:00.000Z",
  };
  const historySession: Session = {
    id: 11,
    gameId: 42,
    gameName: "Wrong game",
    exeName: "Game.exe",
    coverUrl: "cover",
    source: "igdb",
    startedAt: "2026-08-08T10:00:00.000Z",
    endedAt: "2026-08-08T10:01:00.000Z",
    durationSeconds: 60,
  };

  function seedMatchedGame() {
    useAppStore.setState({
      installUuid,
      exeCache: new Map([
        [
          "game.exe",
          entry({
            gameId: 42,
            gameName: "Wrong game",
            source: "igdb",
          }),
        ],
      ]),
      activeSessions: [activeSession],
      recentSessions: [historySession],
    });
  }

  it("blocks locally, stops the active session, and sends mapped evidence", async () => {
    seedMatchedGame();
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({ status: "recorded", flagged: false }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const outcome = await reportNegativeMatch("Game.exe");

    expect(outcome).toEqual({
      localBlockApplied: true,
      ignoreFileUpdated: true,
      report: "recorded",
    });
    expect(useAppStore.getState().blacklist.has("game.exe")).toBe(true);
    expect(useAppStore.getState().exeCache.has("game.exe")).toBe(false);
    expect(useAppStore.getState().activeSessions).toEqual([]);
    expect(useAppStore.getState().recentSessions).toEqual([historySession]);
    expect(invokeMock).toHaveBeenCalledWith("set_user_ignored_process", {
      exeName: "Game.exe",
      ignored: true,
    });
    const reportRequest = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith("/api/community/identifier-reports"),
    );
    expect(reportRequest).toBeDefined();
    expect(JSON.parse(String(reportRequest?.[1]?.body))).toEqual({
      exeName: "Game.exe",
      reason: "not_a_game",
      installUuid,
      gameId: 42,
      gameSource: "igdb",
    });
  });

  it("keeps the local block and report when the ignore-file write fails", async () => {
    seedMatchedGame();
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "set_user_ignored_process") {
        throw new Error("file locked");
      }
      if (command === "scan_processes") {
        return [{ exeName: "Game.exe", exePath: null }];
      }
      return undefined;
    });
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/api/community/identifier-reports")) {
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          json: async () => ({ status: "recorded", flagged: false }),
        };
      }
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({
          matches: [
            {
              key: "game.exe",
              game: {
                id: 42,
                name: "Wrong game",
                coverUrl: "",
                source: "igdb",
              },
            },
          ],
        }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const outcome = await reportNegativeMatch("Game.exe");
    await vi.waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("scan_processes"),
    );

    expect(outcome).toEqual({
      localBlockApplied: true,
      ignoreFileUpdated: false,
      report: "recorded",
    });
    expect(useAppStore.getState().blacklist.has("game.exe")).toBe(true);
    expect(useAppStore.getState().exeCache.has("game.exe")).toBe(false);
    expect(useAppStore.getState().activeSessions).toEqual([]);
    expect(
      fetchMock.mock.calls.filter(([url]) =>
        String(url).endsWith("/api/match-processes"),
      ),
    ).toHaveLength(0);
  });

  it("dismisses and ignores an uncertain picker without sending a report", async () => {
    useAppStore.setState({
      installUuid,
      ambiguousMatches: [
        {
          exeName: "Game.exe",
          exePath: null,
          candidates: [
            {
              id: 42,
              name: "Possible game",
              coverUrl: "",
              source: "igdb",
            },
          ],
          detectedAt: "2026-08-09T10:00:00.000Z",
        },
      ],
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const outcome = await dismissAmbiguousMatch("Game.exe");
    await vi.waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("scan_processes"),
    );

    expect(outcome).toEqual({
      localBlockApplied: true,
      ignoreFileUpdated: true,
    });
    expect(useAppStore.getState().ambiguousMatches).toEqual([]);
    expect(useAppStore.getState().blacklist.has("game.exe")).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns flag metadata from a manual match lookup", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({
        matches: [
          {
            key: "game.exe",
            game: null,
            ambiguousGames: [
              {
                id: 42,
                name: "Possible game",
                coverUrl: "",
                source: "igdb",
              },
            ],
            flaggedIdentifier: { reason: "not_a_game" },
          },
        ],
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(findGameMatches("Game.exe")).resolves.toEqual({
      games: [
        {
          id: 42,
          name: "Possible game",
          coverUrl: "",
          source: "igdb",
        },
      ],
      flaggedIdentifier: { reason: "not_a_game" },
    });
  });

  it("returns pending community alternatives so a mistaken correction can be reverted", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({
        matches: [
          {
            key: "palworld.exe",
            game: null,
            pendingCommunityGames: [
              {
                id: 42,
                igdbId: 100,
                name: "Palworld",
                coverUrl: "palworld.jpg",
                source: "community",
              },
              {
                id: 84,
                igdbId: 200,
                name: "Warcraft III",
                coverUrl: "warcraft.jpg",
                source: "community",
              },
            ],
          },
        ],
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(findGameMatches("Palworld.exe")).resolves.toEqual({
      games: [
        {
          id: 42,
          igdbId: 100,
          name: "Palworld",
          coverUrl: "palworld.jpg",
          source: "community",
        },
        {
          id: 84,
          igdbId: 200,
          name: "Warcraft III",
          coverUrl: "warcraft.jpg",
          source: "community",
        },
      ],
      pendingCommunityGameIds: [42, 84],
    });
  });

  it("does not offer the current in-review correction as a community match", async () => {
    useAppStore.setState({
      exeCache: new Map([
        [
          "palworld.exe",
          entry({
            exeName: "Palworld.exe",
            gameId: -123,
            igdbId: 200,
            gameName: "Warcraft III: The Frozen Throne",
            coverUrl: "warcraft.jpg",
            communitySuggestionId: 84,
            communitySuggestionVerified: false,
            communitySuggestionStatus: "pending",
          }),
        ],
      ]),
    });
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({
        matches: [
          {
            key: "palworld.exe",
            game: {
              id: 42,
              igdbId: 100,
              name: "Palworld",
              coverUrl: "palworld.jpg",
              source: "community",
            },
            pendingCommunityGames: [
              {
                id: 84,
                igdbId: 200,
                name: "Warcraft III: The Frozen Throne",
                coverUrl: "warcraft.jpg",
                source: "community",
              },
            ],
          },
        ],
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(findGameMatches("Palworld.exe")).resolves.toEqual({
      games: [
        {
          id: 42,
          igdbId: 100,
          name: "Palworld",
          coverUrl: "palworld.jpg",
          source: "community",
        },
      ],
    });
  });

  it("locally switches an in-review correction back to an earlier community candidate", () => {
    useAppStore.setState({
      exeCache: new Map([
        [
          "palworld.exe",
          entry({
            exeName: "Palworld.exe",
            gameId: -123,
            igdbId: 200,
            gameName: "Warcraft III",
            coverUrl: "warcraft.jpg",
            communitySuggestionId: 84,
            communitySuggestionVerified: false,
            communitySuggestionStatus: "pending",
          }),
        ],
      ]),
    });

    suggestTrackedGameToCommunity(
      "Palworld.exe",
      "Palworld",
      "palworld.jpg",
      42,
      false,
      100,
    );

    expect(useAppStore.getState().exeCache.get("palworld.exe")).toMatchObject({
      state: "matched",
      source: "custom",
      igdbId: 100,
      gameName: "Palworld",
      coverUrl: "palworld.jpg",
      communitySuggestionId: 42,
      communitySuggestionVerified: false,
      communitySuggestionStatus: "pending",
      pendingCommunityGame: {
        id: 42,
        igdbId: 100,
        name: "Palworld",
        coverUrl: "palworld.jpg",
        source: "community",
      },
    });
  });
});

describe("game metadata hydration", () => {
  it("does not loop when metadata has no IGDB identity", async () => {
    const session: Session = {
      id: 1,
      gameId: 987654,
      gameName: "Legacy community game",
      coverUrl: "",
      source: "community",
      exeName: "Legacy.exe",
      startedAt: "2026-08-09T00:00:00.000Z",
      endedAt: "2026-08-09T00:02:00.000Z",
      durationSeconds: 120,
    };
    const sessions = [session];
    useAppStore.setState({ recentSessions: sessions });
    vi.stubGlobal("window", globalThis);
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({
        games: [
          {
            id: 987654,
            name: "Legacy community game",
            coverUrl: "",
            source: "community",
          },
        ],
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    await hydrateGameMetadata([
      { gameId: session.gameId, source: session.source },
    ]);
    await hydrateGameMetadata([
      { gameId: session.gameId, source: session.source },
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().recentSessions).toBe(sessions);
  });

  it("keeps unchanged persisted session references stable", () => {
    const session: Session = {
      id: 2,
      gameId: 42,
      gameName: "Game",
      coverUrl: "",
      source: "igdb",
      exeName: "Game.exe",
      startedAt: "2026-08-09T00:00:00.000Z",
      endedAt: "2026-08-09T00:02:00.000Z",
      durationSeconds: 120,
    };
    const sessions = [session];
    useAppStore.setState({ recentSessions: sessions });

    persist();

    expect(useAppStore.getState().recentSessions).toBe(sessions);
  });

  it("repairs a cached game corrupted by a reused server id", async () => {
    const reusedGameId = 310031;
    const wrongIgdbId = 378504;
    const wuchangSession: Session = {
      id: 31,
      gameId: reusedGameId,
      igdbId: wrongIgdbId,
      gameName: "Wuchang: Fallen Feathers",
      coverUrl: "wuchang-cover",
      source: "community",
      exeName: "Project_Plague-WinGDK-Shipping.exe",
      startedAt: "2026-08-08T00:00:00.000Z",
      endedAt: "2026-08-08T01:00:00.000Z",
      durationSeconds: 3600,
    };
    useAppStore.setState({
      gameMetadata: new Map([
        [
          `community:${reusedGameId}`,
          {
            id: reusedGameId,
            igdbId: wrongIgdbId,
            name: "Higher or Lower: Spotify Edition",
            coverUrl: "spotify-cover",
            source: "community",
          },
        ],
      ]),
      exeCache: new Map([
        [
          "project_plague-wingdk-shipping.exe",
          entry({
            exeName: "Project_Plague-WinGDK-Shipping.exe",
            gameId: reusedGameId,
            igdbId: wrongIgdbId,
            gameName: "Wuchang: Fallen Feathers",
            coverUrl: "wuchang-cover",
            source: "community",
          }),
        ],
      ]),
      activeSessions: [
        {
          id: wuchangSession.id,
          gameId: wuchangSession.gameId,
          igdbId: wuchangSession.igdbId,
          gameName: wuchangSession.gameName!,
          coverUrl: wuchangSession.coverUrl!,
          source: wuchangSession.source,
          exeName: wuchangSession.exeName,
          startedAt: wuchangSession.startedAt,
          checkpointedAt: wuchangSession.startedAt,
        },
      ],
      recentSessions: [wuchangSession],
    });
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) =>
      Promise.resolve({
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({ games: [] }),
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await hydrateGameMetadata([]);

    const state = useAppStore.getState();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain(`ids=${reusedGameId}`);
    expect(state.gameMetadata.has(`community:${reusedGameId}`)).toBe(false);
    expect(
      state.exeCache.get("project_plague-wingdk-shipping.exe")?.igdbId,
    ).toBeUndefined();
    expect(state.activeSessions[0].igdbId).toBeUndefined();
    expect(state.recentSessions[0].igdbId).toBeUndefined();

    const resolveIgdbId = createGameIdentityResolver(
      state.gameMetadata,
      state.exeCache,
    );
    expect(
      resolvedCanonicalGameKey(state.recentSessions[0], resolveIgdbId),
    ).toBe(`community:${reusedGameId}`);
  });
});

describe("contribution marker repair", () => {
  it("repairs the sole matching markerless custom game", () => {
    const repaired = applyContributionMarkers(
      new Map([["game.exe", entry()]]),
      [contribution()],
    ).get("game.exe");
    expect(repaired?.communitySuggestionId).toBe(42);
    expect(repaired?.communitySuggestionStatus).toBe("rejected");
    expect(repaired?.communitySuggestionNote).toBe("Wrong game");
  });

  it("does not clobber an existing marker", () => {
    const existing = entry({ communitySuggestionId: 7 });
    const repaired = applyContributionMarkers(
      new Map([["game.exe", existing]]),
      [contribution()],
    ).get("game.exe");
    expect(repaired).toBe(existing);
  });

  it("does not repair a repurposed exe whose game name differs", () => {
    const existing = entry({ gameName: "Different Game" });
    const repaired = applyContributionMarkers(
      new Map([["game.exe", existing]]),
      [contribution()],
    ).get("game.exe");
    expect(repaired).toBe(existing);
  });

  it("does not choose between two viable contributions for one exe", () => {
    const existing = entry();
    const repaired = applyContributionMarkers(
      new Map([["game.exe", existing]]),
      [contribution(), contribution({ gameId: 43 })],
    ).get("game.exe");
    expect(repaired).toBe(existing);
  });
});

describe("rejected contribution reconciliation", () => {
  it("allows a rejected suggestion to become approved", () => {
    useAppStore.setState({
      exeCache: new Map([
        [
          "game.exe",
          entry({
            communitySuggestionId: 42,
            communitySuggestionVerified: false,
            communitySuggestionStatus: "rejected",
            communitySuggestionNote: "Old note",
          }),
        ],
      ]),
    });
    const approved: Game = {
      id: 42,
      igdbId: 12345,
      name: "Game",
      coverUrl: "cover",
      source: "community",
    };
    expect(
      applyCommunitySuggestionOutcome("Game.exe", [approved], [], true, true),
    ).toBe("approved");
    expect(
      useAppStore.getState().exeCache.get("game.exe")
        ?.communitySuggestionStatus,
    ).toBe("verified");
    expect(useAppStore.getState().exeCache.get("game.exe")?.igdbId).toBe(12345);
  });

  it("leaves an already rejected suggestion unchanged when still absent", () => {
    const rejected = entry({
      communitySuggestionId: 42,
      communitySuggestionVerified: false,
      communitySuggestionStatus: "rejected",
      communitySuggestionNote: "Keep this note",
    });
    useAppStore.setState({ exeCache: new Map([["game.exe", rejected]]) });
    expect(
      applyCommunitySuggestionOutcome("Game.exe", [], [], true, false),
    ).toBe("rejected");
    expect(useAppStore.getState().exeCache.get("game.exe")).toBe(rejected);
  });

  it("teaches a legacy pending custom entry its IGDB identity", () => {
    useAppStore.setState({
      exeCache: new Map([
        [
          "game.exe",
          entry({
            communitySuggestionId: 42,
            communitySuggestionStatus: "pending",
          }),
        ],
      ]),
      activeSessions: [
        {
          id: 1,
          gameId: -1,
          gameName: "Game",
          exeName: "Game.exe",
          coverUrl: "cover",
          source: "custom",
          startedAt: "2026-08-09T00:00:00.000Z",
          checkpointedAt: "2026-08-09T00:01:00.000Z",
        },
      ],
      recentSessions: [
        {
          id: 2,
          gameId: -1,
          gameName: "Game",
          exeName: "Game.exe",
          source: "custom",
          startedAt: "2026-08-08T00:00:00.000Z",
          endedAt: "2026-08-08T01:00:00.000Z",
          durationSeconds: 3600,
        },
      ],
    });
    const pending: Game = {
      id: 42,
      igdbId: 12345,
      name: "Game",
      coverUrl: "cover",
      source: "community",
    };

    expect(
      applyCommunitySuggestionOutcome("Game.exe", [], [pending], true, false),
    ).toBe("pending");
    expect(useAppStore.getState().exeCache.get("game.exe")?.igdbId).toBe(12345);
    expect(useAppStore.getState().activeSessions[0].igdbId).toBe(12345);
    expect(useAppStore.getState().recentSessions[0].igdbId).toBe(12345);
  });
});

describe("canonical alias actions", () => {
  it("carries identity through a running game match rewrite", () => {
    useAppStore.setState({
      exeCache: new Map([["game.exe", entry({ gameId: 7 })]]),
      activeSessions: [
        {
          id: 1,
          gameId: 7,
          gameName: "Game",
          exeName: "Game.exe",
          coverUrl: "cover",
          source: "custom",
          startedAt: "2026-08-09T00:00:00.000Z",
          checkpointedAt: "2026-08-09T00:01:00.000Z",
        },
      ],
    });

    applyGameMatch("Game.exe", {
      id: 10,
      igdbId: 12345,
      name: "Game",
      coverUrl: "cover",
      source: "igdb",
    });
    expect(useAppStore.getState().activeSessions[0]).toMatchObject({
      gameId: 10,
      igdbId: 12345,
      source: "igdb",
    });
  });

  it("untracks and adjusts all pairs represented by one merged card", () => {
    const aliases = [
      { gameId: 1, source: "igdb" as const },
      { gameId: 7, source: "community" as const },
    ];
    const sessions = aliases
      .map((alias, index) => ({
        id: index + 1,
        gameId: alias.gameId,
        igdbId: 12345,
        gameName: "Game",
        exeName: index === 0 ? "Game.exe" : "GameShipping.exe",
        source: alias.source,
        startedAt: `2026-08-0${index + 1}T00:00:00.000Z`,
        endedAt: `2026-08-0${index + 1}T01:00:00.000Z`,
        durationSeconds: 3600,
      }))
      .reverse();
    useAppStore.setState({
      recentSessions: sessions,
      exeCache: new Map([
        ["game.exe", entry({ gameId: 1, source: "igdb", igdbId: 12345 })],
        [
          "gameshipping.exe",
          entry({
            exeName: "GameShipping.exe",
            gameId: 7,
            source: "community",
            igdbId: 12345,
          }),
        ],
      ]),
    });

    setGamePlaytime({
      gameId: 1,
      igdbId: 12345,
      gameName: "Game",
      coverUrl: "cover",
      source: "igdb",
      exeName: "Game.exe",
      targetSeconds: 3600,
      aliases,
    });
    expect(useAppStore.getState().recentSessions).toEqual(sessions);
    expect(useAppStore.getState().playtimeAdjustments).toEqual({
      "igdb:1": -3600,
    });

    untrackGame(1, "igdb", true, aliases);
    expect(useAppStore.getState().exeCache.size).toBe(0);
    expect(useAppStore.getState().recentSessions).toEqual([]);
    expect(useAppStore.getState().playtimeAdjustments).toEqual({});
  });

  it("stores an archive-aware adjustment without inventing a session", () => {
    useAppStore.setState({
      archivedSeconds: 3600,
      archivedGameSeconds: { "community:7": 3600 },
    });

    setGamePlaytime({
      gameId: 7,
      gameName: "Game",
      coverUrl: "cover",
      source: "community",
      exeName: "Game.exe",
      targetSeconds: 1800,
    });

    expect(useAppStore.getState().recentSessions).toEqual([]);
    expect(useAppStore.getState().playtimeAdjustments).toEqual({
      "community:7": -1800,
    });
  });

  it("refuses adjustments while the game is active", () => {
    useAppStore.setState({
      activeSessions: [
        {
          id: 1,
          gameId: 7,
          gameName: "Game",
          coverUrl: "cover",
          exeName: "Game.exe",
          source: "community",
          startedAt: "2026-08-09T00:00:00.000Z",
          checkpointedAt: "2026-08-09T00:01:00.000Z",
        },
      ],
    });

    expect(() =>
      setGamePlaytime({
        gameId: 7,
        gameName: "Game",
        coverUrl: "cover",
        source: "community",
        exeName: "Game.exe",
        targetSeconds: 3600,
      }),
    ).toThrow("Stop the active session");
    expect(useAppStore.getState().playtimeAdjustments).toEqual({});
  });

  it("keeps archived and adjusted time when untracking without history removal", () => {
    useAppStore.setState({
      archivedSeconds: 3600,
      archivedGameSeconds: { "community:7": 3600 },
      playtimeAdjustments: { "community:7": 600 },
      exeCache: new Map([
        ["game.exe", entry({ gameId: 7, source: "community" })],
      ]),
    });

    untrackGame(7, "community", false);

    expect(useAppStore.getState()).toMatchObject({
      archivedSeconds: 3600,
      archivedGameSeconds: { "community:7": 3600 },
      playtimeAdjustments: { "community:7": 600 },
    });
  });

  it("marks a manually logged session without treating it as an adjustment", () => {
    addManualSession({
      gameId: 7,
      gameName: "Game",
      coverUrl: "cover",
      source: "community",
      exeName: "Game.exe",
      durationSeconds: 600,
      endedAt: "2026-08-09T01:00:00.000Z",
    });

    expect(useAppStore.getState().recentSessions[0]).toMatchObject({
      origin: "manual",
      durationSeconds: 600,
    });
    expect(useAppStore.getState().playtimeAdjustments).toEqual({});
  });

  it("clears retained, archived, and adjusted time together", () => {
    useAppStore.setState({
      recentSessions: [
        {
          id: 1,
          gameId: 7,
          source: "community",
          exeName: "Game.exe",
          startedAt: "2026-08-09T00:00:00.000Z",
          endedAt: "2026-08-09T01:00:00.000Z",
          durationSeconds: 3600,
        },
      ],
      archivedSeconds: 1800,
      archivedGameSeconds: { "community:7": 1800 },
      playtimeAdjustments: { "community:7": -900 },
    });

    removeGameHistory(7, [{ gameId: 7, source: "community" }]);

    expect(useAppStore.getState()).toMatchObject({
      recentSessions: [],
      archivedSeconds: 0,
      archivedGameSeconds: {},
      playtimeAdjustments: {},
    });
  });

  it("revokes the only game's playtime achievements when adjusted to zero", () => {
    const awardedAt = "2026-08-09T20:00:00.000Z";
    const playtimeAwards = [
      {
        id: "milestone:total:10",
        kind: "milestone-total" as const,
        title: "You've played 10 hours in total",
        awardedAt,
      },
      {
        id: "milestone:game:community:7:10",
        kind: "milestone-game" as const,
        title: "10 hours played in Game",
        awardedAt,
      },
      {
        id: "milestone:month:2026-08:10",
        kind: "milestone-month" as const,
        title: "10 hours played in August 2026",
        awardedAt,
      },
    ];
    useAppStore.setState({
      recentSessions: [
        {
          id: 1,
          gameId: 7,
          gameName: "Game",
          source: "community",
          exeName: "Game.exe",
          startedAt: "2026-08-09T00:00:00.000Z",
          endedAt: "2026-08-09T20:00:00.000Z",
          durationSeconds: 20 * 3600,
        },
      ],
      awardedMilestones: playtimeAwards,
      milestonesInitializedAt: "2026-08-01T00:00:00.000Z",
      notifications: playtimeAwards.map((award) => ({
        id: award.id,
        kind: award.kind,
        title: award.title,
        createdAt: award.awardedAt,
      })),
      toasts: [],
    });

    setGamePlaytime({
      gameId: 7,
      gameName: "Game",
      coverUrl: "cover",
      source: "community",
      exeName: "Game.exe",
      targetSeconds: 0,
    });

    const state = useAppStore.getState();
    expect(state.awardedMilestones.map((item) => item.id)).toEqual([
      "milestone:month:2026-08:10",
    ]);
    expect(state.notifications.map((item) => item.id)).toEqual([
      "milestone:month:2026-08:10",
    ]);
    expect(state.toasts).toEqual([]);
  });

  it("revokes playtime achievements after deleting all history", () => {
    useAppStore.setState({
      recentSessions: [
        {
          id: 1,
          gameId: 7,
          gameName: "Game",
          source: "community",
          exeName: "Game.exe",
          startedAt: "2026-08-09T00:00:00.000Z",
          endedAt: "2026-08-09T20:00:00.000Z",
          durationSeconds: 20 * 3600,
        },
      ],
      awardedMilestones: [
        {
          id: "milestone:total:10",
          kind: "milestone-total",
          title: "You've played 10 hours in total",
          awardedAt: "2026-08-09T20:00:00.000Z",
        },
        {
          id: "milestone:game:community:7:10",
          kind: "milestone-game",
          title: "10 hours played in Game",
          awardedAt: "2026-08-09T20:00:00.000Z",
        },
      ],
      milestonesInitializedAt: "2026-08-01T00:00:00.000Z",
    });

    removeGameHistory(7, [{ gameId: 7, source: "community" }]);

    expect(useAppStore.getState().awardedMilestones).toEqual([]);
  });

  it("awards achievements immediately for a manually added session", () => {
    useAppStore.setState({
      milestonesInitializedAt: "2026-08-01T00:00:00.000Z",
    });

    addManualSession({
      gameId: 7,
      gameName: "Game",
      coverUrl: "cover",
      source: "community",
      exeName: "Game.exe",
      durationSeconds: 10 * 3600,
      endedAt: "2026-08-09T20:00:00.000Z",
    });

    expect(
      useAppStore.getState().awardedMilestones.map((item) => item.id),
    ).toEqual(
      expect.arrayContaining([
        "milestone:total:10",
        "milestone:game:community:7:10",
      ]),
    );
  });
});
