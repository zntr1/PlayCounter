import type { Game } from "@playcounter/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (value: string) => value,
  invoke: invokeMock,
}));
import { commitLibraryImports } from "./library/commit";
import { buildLibraryImportCommit } from "./library/importPlan";
import { useAppStore, type ExeCacheEntry } from "./store";
import {
  applyKnownGameMatch,
  applyLocalLinkGameMatch,
  linkKnownGameFiles,
  rejectFileForGame,
  resetToolTickForTests,
  scanProcessesNow,
} from "./tracker";

// The rule under test: "It doesn't belong to <game>" takes one file away from
// one game on this PC for good - the scan, a picker, the server's known files
// and a launcher import can't bring it back - and reports exactly that pair.
// Linking the file to the game yourself undoes it.

const T0 = new Date("2026-09-30T10:00:00Z").getTime();
const divinity = {
  id: 9,
  igdbId: 435,
  name: "Divinity: Original Sin II",
  coverUrl: "",
  source: "igdb" as const,
};
const other = {
  id: 12,
  igdbId: 900,
  name: "Other Game",
  coverUrl: "",
  source: "igdb" as const,
};
const divinityRef = {
  gameId: divinity.id,
  source: divinity.source,
  igdbId: divinity.igdbId,
  aliases: [{ gameId: divinity.id, source: divinity.source }],
};

let running: Array<{ exeName: string; exePath: string | null; pid: number }>;
let fetchMock: ReturnType<typeof vi.fn>;
let matchResults: Record<string, unknown>;
let serial = 0;

function nextExe() {
  serial += 1;
  const exeName = `SupportTool${serial}.exe`;
  return { exeName, key: exeName.toLowerCase() };
}

function requestsTo(path: string) {
  return fetchMock.mock.calls.filter(([url]) => String(url).endsWith(path));
}

function matchedEntry(exeName: string, game: Game): ExeCacheEntry {
  return {
    exeName,
    state: "matched",
    gameId: game.id,
    igdbId: game.igdbId,
    gameName: game.name,
    coverUrl: game.coverUrl,
    source: game.source,
    lastCheckedAt: new Date(T0).toISOString(),
  };
}

function reject(exeName: string) {
  useAppStore.setState({
    rejectedGameFiles: [
      {
        exeName: exeName.toLowerCase(),
        gameId: divinity.id,
        source: "igdb",
        igdbId: divinity.igdbId,
        rejectedAt: new Date(T0).toISOString(),
      },
    ],
  });
}

async function flush() {
  for (let index = 0; index < 50; index += 1) await Promise.resolve();
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
    if (String(url).endsWith("/api/community/identifier-reports")) {
      return Response.json({ status: "recorded", flagged: false });
    }
    return Response.json({});
  });
  vi.stubGlobal("fetch", fetchMock);
  useAppStore.setState({
    exeCache: new Map(),
    scopedExeLinks: new Map(),
    launchTargets: new Map(),
    libraryImports: new Map(),
    rejectedGameFiles: [],
    activeSessions: [],
    ambiguousMatches: [],
    recentSessions: [],
    blacklist: new Set(),
    ignoredProcesses: new Set(),
    userIgnoredProcesses: new Set(),
    installUuid: "550e8400-e29b-41d4-a716-446655440000",
    notifications: [],
    toasts: [],
    backendHealth: {
      status: "online",
      checkedAt: "2026-09-30T00:00:00.000Z",
      detail: null,
    },
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("It doesn't belong to the game", () => {
  it("takes the file off the game and reports exactly that pair", async () => {
    const { exeName, key } = nextExe();
    useAppStore.getState().setExeCacheEntry(matchedEntry(exeName, divinity));
    useAppStore.setState({
      libraryImports: new Map([
        [
          "steam:435",
          {
            provider: "steam",
            externalId: "435",
            igdbId: divinity.igdbId,
            gameId: divinity.id,
            source: "igdb",
            name: divinity.name,
            coverUrl: "",
            importedAt: new Date(T0).toISOString(),
            providerSeconds: null,
            providerHasPlayedEvidence: false,
            lastReadAt: new Date(T0).toISOString(),
            linkedExeNames: [exeName, "EoCApp.exe"],
            linkedExeSources: ["igdb"],
          },
        ],
      ]),
    });

    const outcome = await rejectFileForGame(exeName, divinityRef);

    const state = useAppStore.getState();
    expect(outcome).toEqual({ report: "recorded" });
    expect(state.exeCache.has(key)).toBe(false);
    expect(state.libraryImports.get("steam:435")?.linkedExeNames).toEqual([
      "EoCApp.exe",
    ]);
    expect(state.rejectedGameFiles).toEqual([
      expect.objectContaining({
        exeName: key,
        gameId: divinity.id,
        source: "igdb",
        igdbId: divinity.igdbId,
      }),
    ]);
    const reports = requestsTo("/api/community/identifier-reports");
    expect(reports).toHaveLength(1);
    expect(JSON.parse(String((reports[0][1] as RequestInit).body))).toEqual({
      exeName,
      reason: "wrong_game",
      gameId: divinity.id,
      gameSource: "igdb",
      installUuid: "550e8400-e29b-41d4-a716-446655440000",
    });
  });

  it("reports nothing offline", async () => {
    const { exeName } = nextExe();
    useAppStore.getState().setExeCacheEntry(matchedEntry(exeName, divinity));
    useAppStore.setState({
      backendHealth: { status: "offline", checkedAt: null, detail: null },
    });

    const outcome = await rejectFileForGame(exeName, divinityRef);

    expect(outcome.report).toBe("skipped");
    expect(requestsTo("/api/community/identifier-reports")).toHaveLength(0);
    expect(useAppStore.getState().rejectedGameFiles).toHaveLength(1);
  });

  it("only takes Game.exe out of this game's folder, reporting nothing", async () => {
    useAppStore.setState({
      scopedExeLinks: new Map([
        [
          "game.exe|c:\\games\\dead plate",
          {
            exeName: "Game.exe",
            pathPrefix: "C:\\Games\\Dead Plate",
            gameId: divinity.id,
            source: "igdb",
            igdbId: divinity.igdbId,
            gameName: divinity.name,
            coverUrl: "",
            setAt: new Date(T0).toISOString(),
          },
        ],
      ]),
    });

    const outcome = await rejectFileForGame("Game.exe", divinityRef);

    const state = useAppStore.getState();
    expect(outcome).toEqual({ folder: true, report: "skipped" });
    expect(state.scopedExeLinks.size).toBe(0);
    expect(state.rejectedGameFiles).toEqual([]);
    expect(requestsTo("/api/community/identifier-reports")).toHaveLength(0);
  });

  it("a scan never matches the file to that game again", async () => {
    const { exeName, key } = nextExe();
    reject(exeName);
    running = [{ exeName, exePath: `C:\\Games\\${exeName}`, pid: 1 }];
    matchResults[key] = { game: divinity };

    await scanProcessesNow();
    await flush();

    const state = useAppStore.getState();
    expect(state.exeCache.get(key)?.state).toBe("unmatched");
    expect(state.activeSessions).toEqual([]);
  });

  it("drops the game from a picker; the one game left is the match", async () => {
    const { exeName, key } = nextExe();
    reject(exeName);
    running = [{ exeName, exePath: `C:\\Games\\${exeName}`, pid: 1 }];
    matchResults[key] = { ambiguousGames: [divinity, other] };

    await scanProcessesNow();
    await flush();

    const state = useAppStore.getState();
    expect(state.exeCache.get(key)).toMatchObject({
      state: "matched",
      gameId: other.id,
    });
    expect(state.ambiguousMatches).toEqual([]);
  });

  it("the server's known files and a launcher import leave it off", () => {
    const { exeName, key } = nextExe();
    reject(exeName);

    linkKnownGameFiles([{ exeName, identifierSource: "igdb" }], divinity);
    commitLibraryImports([
      buildLibraryImportCommit({
        provider: "steam",
        now: new Date(T0).toISOString(),
        scanned: {
          externalId: "435",
          playtimeSeconds: 60,
          lastPlayedUnix: T0 / 1000,
          installed: true,
          executables: [],
        },
        resolved: {
          key: "steam:435",
          status: "resolved",
          game: divinity,
          executables: [
            {
              platform: "windows",
              kind: "exe",
              value: exeName,
              provenance: "igdb",
              verified: true,
            },
            {
              platform: "windows",
              kind: "exe",
              value: "EoCApp.exe",
              provenance: "igdb",
              verified: true,
            },
          ],
        },
      })!,
    ]);

    const state = useAppStore.getState();
    expect(state.exeCache.has(key)).toBe(false);
    expect(state.exeCache.has("eocapp.exe")).toBe(true);
    const imported = [...state.libraryImports.values()][0];
    expect(imported.linkedExeNames).toEqual(["EoCApp.exe"]);
  });

  it("linking the file to the game yourself undoes it", () => {
    const { exeName, key } = nextExe();
    reject(exeName);

    applyKnownGameMatch(exeName, divinity);

    const state = useAppStore.getState();
    expect(state.rejectedGameFiles).toEqual([]);
    expect(state.exeCache.get(key)).toMatchObject({
      state: "matched",
      gameId: divinity.id,
    });
  });

  it("picking the game again in a search undoes it too", () => {
    const { exeName, key } = nextExe();
    useAppStore.getState().setExeCacheEntry(matchedEntry(exeName, other));
    reject(exeName);

    applyLocalLinkGameMatch(key, divinity);

    expect(useAppStore.getState().rejectedGameFiles).toEqual([]);
  });
});
