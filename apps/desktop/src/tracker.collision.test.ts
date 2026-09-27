import type { Game, Session } from "@playcounter/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (value: string) => value,
  invoke: invokeMock,
}));
import { createTransferData } from "./backup";
import { validateBackupData } from "./backupValidation";
import { useAppStore, type ExeCacheEntry } from "./store";
import {
  markTrackedExecutableAsSoftware,
  resetToolTickForTests,
  scanProcessesNow,
  selectAmbiguousMatch,
} from "./tracker";
import { sanitizeToolUsage, type ToolUsageRecord } from "./toolUsage";
import type { ExeDetails } from "./ui/exeDetails";

// The rule under test: when software and a game share an exe (Code.exe is VS
// Code and the game Code:29), the file's own name decides; unclear goes to the
// picker, except on a re-check, which never asks. Whenever an exe goes from a
// game to software, the time counted for that exe moves to the software
// counter, split by local day, and nothing else moves.

const T0 = new Date("2026-09-26T10:00:00Z").getTime();
// Local times, so the day split holds in every timezone.
const at = (day: number, hour: number, minute = 0) =>
  new Date(2026, 8, day, hour, minute).getTime();

const vsCode: Game = {
  id: 3,
  name: "Visual Studio Code",
  coverUrl: "",
  source: "community",
  kind: "tool",
};
const code29: Game = {
  id: 9,
  igdbId: 215514,
  name: "Code:29",
  coverUrl: "",
  source: "igdb",
};

let running: Array<{ exeName: string; exePath: string | null; pid: number }>;
let fetchMock: ReturnType<typeof vi.fn>;
let matchResults: Record<string, unknown>;
let exeDetails: Record<string, ExeDetails | null>;
// Module state (exe details, re-check times) outlives a test: every test uses
// its own exe name and path.
let serial = 0;

function nextExe() {
  serial += 1;
  const exeName = `Code${serial}.exe`;
  return {
    exeName,
    key: exeName.toLowerCase(),
    exePath: `C:\\VS${serial}\\${exeName}`,
  };
}

function requestsTo(path: string) {
  return fetchMock.mock.calls.filter(([url]) => String(url).endsWith(path));
}

async function scanAt(ms: number) {
  vi.setSystemTime(new Date(ms));
  await scanProcessesNow();
}

async function flush() {
  for (let index = 0; index < 50; index += 1) await Promise.resolve();
}

function totalSeconds(record: ToolUsageRecord | undefined) {
  return Object.values(record?.days ?? {}).reduce(
    (sum, value) => sum + value,
    0,
  );
}

function session(
  exeName: string,
  fromMs: number,
  toMs: number,
  game: Game = code29,
): Session {
  return {
    id: fromMs,
    gameId: game.id,
    igdbId: game.igdbId,
    gameName: game.name,
    coverUrl: game.coverUrl,
    source: game.source,
    exeName,
    startedAt: new Date(fromMs).toISOString(),
    endedAt: new Date(toMs).toISOString(),
    durationSeconds: (toMs - fromMs) / 1000,
  };
}

function matchedEntry(
  exeName: string,
  game: Game,
  overrides: Partial<ExeCacheEntry> = {},
): ExeCacheEntry {
  return {
    exeName,
    state: "matched",
    gameId: game.id,
    igdbId: game.igdbId,
    gameName: game.name,
    coverUrl: game.coverUrl,
    source: game.source,
    lastCheckedAt: new Date(T0).toISOString(),
    ...overrides,
  };
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
  exeDetails = {};
  invokeMock.mockReset();
  invokeMock.mockImplementation(
    async (command: string, args?: { exePath?: string }) => {
      if (command === "scan_processes") return running;
      if (command === "get_exe_details") {
        return exeDetails[args?.exePath ?? ""] ?? null;
      }
      return undefined;
    },
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
    launchTargets: new Map(),
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

describe("a new exe that is software and a game", () => {
  it.each([
    ["names the software", { productName: "Visual Studio Code" }, "tool"],
    ["names the game", { fileDescription: "Code:29" }, "game"],
    ["names neither", { productName: "Notepad" }, "picker"],
    [
      "names both",
      { productName: "Visual Studio Code", fileDescription: "Code:29" },
      "picker",
    ],
    ["has no details", null, "picker"],
  ] as const)("the file %s: %s", async (_label, details, expected) => {
    const { exeName, key, exePath } = nextExe();
    exeDetails[exePath] = details;
    running = [{ exeName, exePath, pid: 1 }];
    matchResults[key] = { game: vsCode, collidingGames: [code29] };

    await scanAt(T0);

    const state = useAppStore.getState();
    const entry = state.exeCache.get(key);
    if (expected === "tool") {
      expect(entry).toMatchObject({ state: "tool", gameId: vsCode.id });
      expect(state.activeSessions).toEqual([]);
      expect(state.ambiguousMatches).toEqual([]);
    } else if (expected === "game") {
      expect(entry).toMatchObject({ state: "matched", gameId: code29.id });
      expect(state.activeSessions).toEqual([
        expect.objectContaining({ gameName: "Code:29", exeName }),
      ]);
      expect(state.ambiguousMatches).toEqual([]);
    } else {
      expect(entry?.state).not.toBe("matched");
      expect(entry?.state).not.toBe("tool");
      expect(state.activeSessions).toEqual([]);
      expect(state.ambiguousMatches).toEqual([
        expect.objectContaining({ exeName, candidates: [vsCode, code29] }),
      ]);
    }
  });

  it("asks without a running path", async () => {
    const { exeName, key } = nextExe();
    running = [{ exeName, exePath: null, pid: 1 }];
    matchResults[key] = { game: vsCode, collidingGames: [code29] };

    await scanAt(T0);

    expect(invokeMock).not.toHaveBeenCalledWith(
      "get_exe_details",
      expect.anything(),
    );
    expect(useAppStore.getState().ambiguousMatches).toHaveLength(1);
  });

  it("offers only the games with Track software off", async () => {
    useAppStore.setState({
      settings: { ...useAppStore.getState().settings, trackTools: false },
    });
    const { exeName, key, exePath } = nextExe();
    running = [{ exeName, exePath, pid: 1 }];
    matchResults[key] = { game: vsCode, collidingGames: [code29] };

    await scanAt(T0);

    expect(useAppStore.getState().ambiguousMatches).toEqual([
      expect.objectContaining({ candidates: [code29] }),
    ]);
  });

  it("keeps an exe that is already software without asking again", async () => {
    const { exeName, key, exePath } = nextExe();
    useAppStore.getState().setExeCacheEntry({
      exeName,
      state: "tool",
      gameId: vsCode.id,
      gameName: vsCode.name,
      source: "community",
      lastCheckedAt: "2026-01-01T00:00:00.000Z",
    });
    running = [{ exeName, exePath, pid: 1 }];
    matchResults[key] = { game: vsCode, collidingGames: [code29] };

    await scanAt(T0);

    expect(requestsTo("/api/match-processes")).toHaveLength(1);
    expect(useAppStore.getState().exeCache.get(key)?.state).toBe("tool");
    expect(useAppStore.getState().ambiguousMatches).toEqual([]);
  });
});

describe("the picker's software choice", () => {
  it.each([
    ["while it runs", undefined, T0 - 10 * 60_000, T0],
    ["after it closed", T0 - 5 * 60_000, T0 - 15 * 60_000, T0 - 5 * 60_000],
  ])(
    "counts the time since detection as software %s",
    (_label, endedAtMs, detectedAtMs, untilMs) => {
      const { exeName, key, exePath } = nextExe();
      useAppStore.getState().setAmbiguousMatch({
        exeName,
        exePath,
        candidates: [vsCode, code29],
        detectedAt: new Date(detectedAtMs).toISOString(),
        endedAt: endedAtMs ? new Date(endedAtMs).toISOString() : undefined,
      });

      selectAmbiguousMatch(exeName, vsCode);

      const state = useAppStore.getState();
      expect(state.exeCache.get(key)).toMatchObject({
        state: "tool",
        gameId: vsCode.id,
        source: "community",
      });
      expect(state.ambiguousMatches).toEqual([]);
      expect(state.activeSessions).toEqual([]);
      expect(state.recentSessions).toEqual([]);
      expect(totalSeconds(state.toolUsage[key])).toBe(
        (untilMs - detectedAtMs) / 1000,
      );
      expect(requestsTo("/api/community/suggestions")).toHaveLength(0);
    },
  );
});

describe("re-checking a tracked game", () => {
  it("switches when the file names the software, moving only this exe's time", async () => {
    const { exeName, key, exePath } = nextExe();
    exeDetails[exePath] = { productName: "Visual Studio Code" };
    useAppStore.getState().setExeCacheEntry(matchedEntry(exeName, code29));
    useAppStore.getState().setLaunchTarget({
      exeName,
      path: exePath,
      owner: { gameId: code29.id, source: "igdb" },
    });
    useAppStore.setState({
      recentSessions: [
        session(exeName, at(20, 23), at(21, 1)),
        session("Code29Launcher.exe", at(22, 10), at(22, 11)),
      ],
    });
    running = [{ exeName, exePath, pid: 1 }];
    matchResults[key] = { game: vsCode, collidingGames: [code29] };

    await scanAt(T0);
    await vi.waitFor(() =>
      expect(useAppStore.getState().exeCache.get(key)?.state).toBe("tool"),
    );
    await scanAt(T0 + 5_000);

    const state = useAppStore.getState();
    expect(state.activeSessions).toEqual([]);
    expect(state.ambiguousMatches).toEqual([]);
    expect(state.recentSessions.map((entry) => entry.exeName)).toEqual([
      "Code29Launcher.exe",
    ]);
    expect(state.launchTargets.has(key)).toBe(false);
    const usage = state.toolUsage[key];
    expect(usage.days["2026-09-20"]).toBe(3600);
    expect(usage.days["2026-09-21"]).toBe(3600);
    // The two hours moved plus the five seconds counted as software since.
    expect(totalSeconds(usage)).toBe(7200 + 5);
  });

  it.each([
    ["names neither", { productName: "Notepad" }],
    ["names the game", { productName: "Code:29" }],
    ["has no details", null],
  ])(
    "stays a game without asking when the file %s",
    async (_label, details) => {
      const { exeName, key, exePath } = nextExe();
      exeDetails[exePath] = details;
      useAppStore.getState().setExeCacheEntry(matchedEntry(exeName, code29));
      useAppStore.setState({
        recentSessions: [session(exeName, at(20, 10), at(20, 11))],
      });
      running = [{ exeName, exePath, pid: 1 }];
      matchResults[key] = { game: vsCode, collidingGames: [code29] };

      await scanAt(T0);
      await vi.waitFor(() =>
        expect(invokeMock).toHaveBeenCalledWith("get_exe_details", { exePath }),
      );
      await flush();

      const state = useAppStore.getState();
      expect(state.exeCache.get(key)?.state).toBe("matched");
      expect(state.ambiguousMatches).toEqual([]);
      expect(state.activeSessions).toEqual([
        expect.objectContaining({ exeName }),
      ]);
      expect(state.recentSessions).toHaveLength(1);
      expect(state.toolUsage[key]).toBeUndefined();
    },
  );

  it("switches an admin-moved community game with no game left, file or not", async () => {
    const { exeName, key } = nextExe();
    const wallpaper: Game = {
      id: 40,
      name: "Wallpaper Engine",
      coverUrl: "",
      source: "community",
    };
    useAppStore.getState().setExeCacheEntry(matchedEntry(exeName, wallpaper));
    useAppStore.setState({
      recentSessions: [session(exeName, at(20, 10), at(20, 11), wallpaper)],
    });
    running = [{ exeName, exePath: null, pid: 1 }];
    matchResults[key] = { game: { ...wallpaper, kind: "tool" } };

    await scanAt(T0);
    await vi.waitFor(() =>
      expect(useAppStore.getState().exeCache.get(key)?.state).toBe("tool"),
    );

    const state = useAppStore.getState();
    expect(state.recentSessions).toEqual([]);
    expect(state.activeSessions).toEqual([]);
    expect(state.toolUsage[key].days["2026-09-20"]).toBe(3600);
  });

  it("leaves the user's own custom game alone", async () => {
    const { exeName, key, exePath } = nextExe();
    exeDetails[exePath] = { productName: "Visual Studio Code" };
    useAppStore.getState().setExeCacheEntry(
      matchedEntry(exeName, {
        id: -5,
        name: "My Code",
        coverUrl: "",
        source: "custom",
      }),
    );
    running = [{ exeName, exePath, pid: 1 }];
    matchResults[key] = { game: vsCode, collidingGames: [code29] };

    await scanAt(T0);
    await vi.waitFor(() =>
      expect(requestsTo("/api/match-processes")).toHaveLength(1),
    );
    await flush();

    expect(useAppStore.getState().exeCache.get(key)).toMatchObject({
      state: "matched",
      source: "custom",
    });
  });
});

describe("It's software", () => {
  it("ends the session, moves this exe's time and withdraws a pending game suggestion", async () => {
    const { exeName, key } = nextExe();
    const obs: Game = { id: -5, name: "OBS", coverUrl: "", source: "custom" };
    useAppStore.getState().setExeCacheEntry(
      matchedEntry(exeName, obs, {
        communitySuggestionId: 77,
        communitySuggestionStatus: "pending",
      }),
    );
    useAppStore.setState({
      recentSessions: [
        session(exeName, at(20, 10), at(20, 11), obs),
        session("obs-other.exe", at(20, 12), at(20, 12, 30), obs),
      ],
      activeSessions: [
        {
          id: 1,
          gameId: obs.id,
          gameName: obs.name,
          coverUrl: "",
          source: "custom",
          exeName,
          startedAt: new Date(T0 - 20 * 60_000).toISOString(),
          checkpointedAt: new Date(T0).toISOString(),
        },
      ],
    });

    const outcome = await markTrackedExecutableAsSoftware(exeName, {
      name: "OBS Studio",
      share: false,
    });
    await vi.waitFor(() =>
      expect(requestsTo("/api/community/suggestions/cancel")).toHaveLength(1),
    );

    const state = useAppStore.getState();
    expect(outcome).toEqual({ kind: "local" });
    expect(state.exeCache.get(key)).toMatchObject({
      state: "tool",
      source: "custom",
      gameName: "OBS Studio",
    });
    expect(state.activeSessions).toEqual([]);
    expect(state.recentSessions.map((entry) => entry.exeName)).toEqual([
      "obs-other.exe",
    ]);
    expect(totalSeconds(state.toolUsage[key])).toBe(3600 + 20 * 60);
    expect(state.toolUsage[key].carriedSeconds).toBeUndefined();
    expect(
      JSON.parse(requestsTo("/api/community/suggestions/cancel")[0][1].body),
    ).toMatchObject({ exeName, gameId: 77 });
    expect(requestsTo("/api/community/identifier-reports")).toHaveLength(0);
  });

  it("counts a picker's time since detection", async () => {
    const { exeName, key, exePath } = nextExe();
    useAppStore.getState().setAmbiguousMatch({
      exeName,
      exePath,
      candidates: [code29],
      detectedAt: new Date(T0 - 10 * 60_000).toISOString(),
    });

    await markTrackedExecutableAsSoftware(exeName, {
      name: "Visual Studio Code",
      share: false,
    });

    const state = useAppStore.getState();
    expect(state.ambiguousMatches).toEqual([]);
    expect(state.exeCache.get(key)?.state).toBe("tool");
    expect(totalSeconds(state.toolUsage[key])).toBe(600);
  });
});

it.each([
  ["an IGDB game once per app start", code29, 1],
  [
    "a community game every five minutes",
    { ...code29, id: 41, igdbId: undefined, source: "community" as const },
    2,
  ],
])("re-checks %s", async (_label, game, expected) => {
  const { exeName, key, exePath } = nextExe();
  useAppStore.getState().setExeCacheEntry(matchedEntry(exeName, game));
  running = [{ exeName, exePath, pid: 1 }];
  matchResults[key] = { game };

  await scanAt(T0);
  await vi.waitFor(() =>
    expect(requestsTo("/api/match-processes")).toHaveLength(1),
  );
  await scanAt(T0 + 6 * 60_000);
  await flush();

  expect(requestsTo("/api/match-processes")).toHaveLength(expected);
});

it("keeps moved time in a backup", () => {
  const toolUsage = {
    "code.exe": { days: { "2026-09-20": 3600, "2026-09-21": 3600 } },
  };
  const data = createTransferData({ toolUsage });

  expect(() => validateBackupData(data, "backup")).not.toThrow();
  expect(sanitizeToolUsage(data.toolUsage)).toEqual(toolUsage);
});
