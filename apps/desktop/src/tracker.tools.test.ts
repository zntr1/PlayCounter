import type { Contribution, Game } from "@playcounter/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (value: string) => value,
  invoke: invokeMock,
}));
import { validateBackupData } from "./backupValidation";
import { useAppStore, type ExeCacheEntry } from "./store";
import {
  markExecutableAsSoftware,
  pollContributions,
  resetToolTickForTests,
  scanProcessesNow,
  unmarkLocalTool,
} from "./tracker";
import { localDayKey } from "./toolUsage";

// The rule under test: a tool (Discord, a launcher) is never a game. It never
// starts a session, never reaches the picker or Discovered, and its time only
// goes to the Software counter, and only with Track software on.

const T0 = new Date("2026-09-26T10:00:00Z").getTime();
const discordTool: Game = {
  id: 7,
  name: "Discord",
  coverUrl: "",
  source: "community",
  kind: "tool",
};

let running: Array<{ exeName: string; exePath: string | null; pid: number }>;
let fetchMock: ReturnType<typeof vi.fn>;
let matchResults: Record<string, unknown>;

function matchRequests() {
  return fetchMock.mock.calls.filter(([url]) =>
    String(url).endsWith("/api/match-processes"),
  );
}

function toolEntry(overrides: Partial<ExeCacheEntry> = {}): ExeCacheEntry {
  return {
    exeName: "Discord.exe",
    state: "tool",
    gameId: 7,
    gameName: "Discord",
    coverUrl: "",
    source: "community",
    lastCheckedAt: new Date(T0).toISOString(),
    ...overrides,
  };
}

async function scanAt(ms: number) {
  vi.setSystemTime(new Date(ms));
  await scanProcessesNow();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(T0));
  resetToolTickForTests();
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal("navigator", {
    userAgent: "Mozilla/5.0 (Windows NT 10.0)",
    platform: "Win32",
  });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: { setItem: vi.fn(), getItem: vi.fn(() => null) },
  });
  running = [];
  matchResults = {};
  invokeMock.mockReset();
  invokeMock.mockImplementation(async (command: string) =>
    command === "scan_processes" ? running : undefined,
  );
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).endsWith("/api/match-processes")) {
      const body = JSON.parse(String(init?.body)) as {
        processes: Array<{ key: string }>;
      };
      return Response.json({
        matches: body.processes.map((process) => ({
          key: process.key,
          game: null,
          ...((matchResults[process.key] as object | undefined) ?? {}),
        })),
      });
    }
    return Response.json({});
  });
  vi.stubGlobal("fetch", fetchMock);
  useAppStore.setState({
    exeCache: new Map(),
    scopedExeLinks: new Map(),
    activeSessions: [],
    ambiguousMatches: [],
    recentSessions: [],
    toolUsage: {},
    blacklist: new Set(),
    ignoredProcesses: new Set(),
    userIgnoredProcesses: new Set(),
    installUuid: "550e8400-e29b-41d4-a716-446655440000",
    seenContributionStatus: {},
    notifications: [],
    toasts: [],
    backendHealth: {
      status: "online",
      checkedAt: "2026-09-26T00:00:00.000Z",
      detail: null,
    },
    settings: { ...useAppStore.getState().settings, trackTools: true },
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("tools from the match API", () => {
  it("never become sessions, pickers or Discovered entries, and count only as tools", async () => {
    running = [
      { exeName: "Discord.exe", exePath: "C:\\D\\Discord.exe", pid: 1 },
    ];
    matchResults["discord.exe"] = { game: discordTool };

    await scanAt(T0);
    await scanAt(T0 + 5_000);

    const state = useAppStore.getState();
    expect(JSON.parse(matchRequests()[0][1].body).supportsTools).toBe(true);
    expect(state.activeSessions).toEqual([]);
    expect(state.ambiguousMatches).toEqual([]);
    expect(state.exeCache.get("discord.exe")).toMatchObject({
      state: "tool",
      gameId: 7,
      gameName: "Discord",
    });
    expect(state.toolUsage["discord.exe"]).toEqual({
      exePath: "C:\\D\\Discord.exe",
      days: { [localDayKey(T0)]: 5 },
    });
  });

  it("counts nothing while Track software is off", async () => {
    useAppStore.setState({
      settings: { ...useAppStore.getState().settings, trackTools: false },
    });
    useAppStore.getState().setExeCacheEntry(toolEntry());
    running = [{ exeName: "Discord.exe", exePath: null, pid: 1 }];

    await scanAt(T0);
    await scanAt(T0 + 5_000);

    expect(useAppStore.getState().toolUsage).toEqual({});
    expect(useAppStore.getState().activeSessions).toEqual([]);
  });

  it("counts a cached tool without asking the API", async () => {
    useAppStore.getState().setExeCacheEntry(toolEntry());
    running = [{ exeName: "Discord.exe", exePath: null, pid: 1 }];

    await scanAt(T0);
    await scanAt(T0 + 5_000);

    expect(matchRequests()).toHaveLength(0);
    expect(
      useAppStore.getState().toolUsage["discord.exe"].days[localDayKey(T0)],
    ).toBe(5);
  });

  it("does not credit a gap longer than five minutes", async () => {
    useAppStore.getState().setExeCacheEntry(toolEntry());
    running = [{ exeName: "Discord.exe", exePath: null, pid: 1 }];

    await scanAt(T0);
    await scanAt(T0 + 9 * 60 * 60 * 1000);

    expect(useAppStore.getState().toolUsage["discord.exe"]?.days ?? {}).toEqual(
      {},
    );
  });

  it("keeps someone else's pending tool out of an unmatched exe", async () => {
    running = [{ exeName: "Voicemeeter.exe", exePath: null, pid: 1 }];
    matchResults["voicemeeter.exe"] = {
      pendingCommunityGames: [{ ...discordTool, id: 8, name: "Voicemeeter" }],
    };

    await scanAt(T0);

    const entry = useAppStore.getState().exeCache.get("voicemeeter.exe");
    expect(entry?.state).toBe("unmatched");
    expect(entry?.pendingCommunityGame).toBeUndefined();
  });

  it("moves a community game that became a tool out of the games", async () => {
    useAppStore.getState().setExeCacheEntry({
      exeName: "Wallpaper.exe",
      state: "matched",
      gameId: 9,
      gameName: "Wallpaper Engine",
      coverUrl: "",
      source: "community",
      lastCheckedAt: new Date(T0).toISOString(),
    });
    running = [{ exeName: "Wallpaper.exe", exePath: null, pid: 1 }];
    matchResults["wallpaper.exe"] = {
      game: { ...discordTool, id: 9, name: "Wallpaper Engine" },
    };

    await scanAt(T0);
    await vi.waitFor(() =>
      expect(useAppStore.getState().exeCache.get("wallpaper.exe")?.state).toBe(
        "tool",
      ),
    );
    await scanAt(T0 + 5_000);

    expect(useAppStore.getState().activeSessions).toEqual([]);
  });

  it.each([
    ["custom", "tool"],
    ["community", "matched"],
  ] as const)(
    "re-checks a %s tool: a game answer leaves it as %s",
    async (source, expected) => {
      useAppStore.getState().setExeCacheEntry(
        toolEntry({
          source,
          gameId: source === "custom" ? -5 : 7,
          lastCheckedAt: "2026-01-01T00:00:00.000Z",
        }),
      );
      running = [{ exeName: "Discord.exe", exePath: null, pid: 1 }];
      matchResults["discord.exe"] = {
        game: { id: 70, name: "Discord Game", coverUrl: "", source: "igdb" },
      };

      await scanAt(T0);

      const entry = useAppStore.getState().exeCache.get("discord.exe");
      expect(entry?.state).toBe(expected);
      expect(Date.parse(entry!.lastCheckedAt)).toBe(T0);
    },
  );
});

describe("Track as software", () => {
  it("makes a Discovered exe a local tool and carries its Discovered time", async () => {
    useAppStore.getState().setExeCacheEntry({
      exeName: "Voicemeeter.exe",
      state: "unmatched",
      lastCheckedAt: new Date(T0).toISOString(),
      trackedSeconds: 120,
    });

    const outcome = await markExecutableAsSoftware("Voicemeeter.exe", {
      name: "Voicemeeter",
      share: false,
    });

    expect(outcome).toEqual({ kind: "local" });
    expect(
      useAppStore.getState().exeCache.get("voicemeeter.exe"),
    ).toMatchObject({
      state: "tool",
      source: "custom",
      gameName: "Voicemeeter",
    });
    expect(useAppStore.getState().toolUsage["voicemeeter.exe"]).toEqual({
      days: {},
      carriedSeconds: 120,
    });
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).endsWith("/api/community/suggestions"),
      ),
    ).toBe(false);
  });

  it("shares a tool suggestion and follows its approval", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).endsWith("/api/community/suggestions")) {
        return Response.json({ id: 55, verified: false });
      }
      return Response.json({
        items: [
          {
            platform: "windows",
            kind: "exe",
            value: "Voicemeeter.exe",
            gameId: 55,
            gameName: "Voicemeeter",
            coverUrl: "https://cdn2.steamgriddb.com/grid/v.png",
            gameKind: "tool",
            status: "verified",
            createdAt: "2026-09-26T10:00:00.000Z",
          } satisfies Contribution,
        ],
        counts: { suggested: 1, verified: 1, pending: 0, rejected: 0 },
      });
    });

    const outcome = await markExecutableAsSoftware("Voicemeeter.exe", {
      name: "Voicemeeter",
      coverUrl: "https://cdn2.steamgriddb.com/grid/v.png",
      share: true,
    });
    const suggestion = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith("/api/community/suggestions"),
    )!;

    expect(outcome).toEqual({ kind: "submitted" });
    expect(JSON.parse(suggestion[1].body)).toMatchObject({
      exeName: "Voicemeeter.exe",
      name: "Voicemeeter",
      kind: "tool",
    });
    expect(
      useAppStore.getState().exeCache.get("voicemeeter.exe"),
    ).toMatchObject({
      state: "tool",
      source: "custom",
      communitySuggestionId: 55,
    });

    await pollContributions("test", { suppressNotifications: true });

    expect(
      useAppStore.getState().exeCache.get("voicemeeter.exe"),
    ).toMatchObject({
      state: "tool",
      source: "community",
      gameId: 55,
      communitySuggestionStatus: "verified",
    });
  });
});

it("sends only tools marked on this PC back to Discovered", () => {
  useAppStore
    .getState()
    .setExeCacheEntry(
      toolEntry({ exeName: "Voicemeeter.exe", source: "custom", gameId: -3 }),
    );
  useAppStore.getState().setExeCacheEntry(toolEntry());

  unmarkLocalTool("custom:-3");
  unmarkLocalTool("community:7");

  const { exeCache } = useAppStore.getState();
  expect(exeCache.get("voicemeeter.exe")?.state).toBe("unmatched");
  expect(exeCache.get("discord.exe")?.state).toBe("tool");
});

it("withdraws a pending shared suggestion on Not Software, and only that", async () => {
  useAppStore.getState().setExeCacheEntry(
    toolEntry({
      exeName: "RiotClient.exe",
      source: "custom",
      gameId: -3,
      communitySuggestionId: 55,
      communitySuggestionStatus: "pending",
    }),
  );
  useAppStore
    .getState()
    .setExeCacheEntry(
      toolEntry({ exeName: "Local.exe", source: "custom", gameId: -4 }),
    );

  unmarkLocalTool("custom:-3");
  unmarkLocalTool("custom:-4");
  await vi.waitFor(() =>
    expect(
      fetchMock.mock.calls.filter(([url]) =>
        String(url).endsWith("/api/community/suggestions/cancel"),
      ),
    ).toHaveLength(1),
  );

  const cancel = fetchMock.mock.calls.find(([url]) =>
    String(url).endsWith("/api/community/suggestions/cancel"),
  )!;
  expect(JSON.parse(cancel[1].body)).toEqual({
    exeName: "RiotClient.exe",
    gameId: 55,
    installUuid: "550e8400-e29b-41d4-a716-446655440000",
  });
  expect(useAppStore.getState().exeCache.get("riotclient.exe")).toEqual({
    exeName: "RiotClient.exe",
    state: "unmatched",
    lastCheckedAt: new Date(T0).toISOString(),
  });
});

it("accepts tool entries and usage in backups", () => {
  expect(() =>
    validateBackupData(
      {
        exeCache: [toolEntry()],
        toolUsage: {
          "discord.exe": {
            exePath: "C:\\D\\Discord.exe",
            days: { "2026-09-26": 5 },
            carriedSeconds: 3,
          },
        },
      },
      "backup",
    ),
  ).not.toThrow();
});
