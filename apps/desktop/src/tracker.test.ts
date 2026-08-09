import type { Contribution, Game, Session } from "@playcounter/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore, type ExeCacheEntry } from "./store";
import {
  applyGameMatch,
  applyCommunitySuggestionOutcome,
  applyContributionMarkers,
  hydrateGameMetadata,
  persist,
  setGamePlaytime,
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
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: { setItem: vi.fn(), getItem: vi.fn(() => null) },
  });
  useAppStore.setState({
    exeCache: new Map(),
    activeSessions: [],
    recentSessions: [],
    gameMetadata: new Map(),
    backendHealth: {
      status: "online",
      checkedAt: "2026-08-09T00:00:00.000Z",
      detail: null,
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
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
    const sessions = aliases.map((alias, index) => ({
      id: index + 1,
      gameId: alias.gameId,
      igdbId: 12345,
      gameName: "Game",
      exeName: index === 0 ? "Game.exe" : "GameShipping.exe",
      source: alias.source,
      startedAt: `2026-08-0${index + 1}T00:00:00.000Z`,
      endedAt: `2026-08-0${index + 1}T01:00:00.000Z`,
      durationSeconds: 3600,
    }));
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
    expect(
      useAppStore
        .getState()
        .recentSessions.reduce(
          (total, session) => total + (session.durationSeconds ?? 0),
          0,
        ),
    ).toBe(3600);

    untrackGame(1, "igdb", true, aliases);
    expect(useAppStore.getState().exeCache.size).toBe(0);
    expect(useAppStore.getState().recentSessions).toEqual([]);
  });
});
