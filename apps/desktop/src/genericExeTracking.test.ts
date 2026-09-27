// @vitest-environment happy-dom
import type { Game } from "@playcounter/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (value: string) => value,
  invoke: invokeMock,
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

import { useAppStore, type ProcessSnapshot } from "./store";
import {
  addCustomGame,
  addDatabaseGameLocally,
  adoptFolderGame,
  applyDatabaseGameToFolderLinks,
  applyKnownGameMatch,
  correctRunningGenericExe,
  dismissAmbiguousMatch,
  findGameMatches,
  hydrate,
  ignoreDiscoveredProcess,
  ignoreTrackedProcessLocally,
  reportNegativeMatch,
  restoreIgnoredExeFolder,
  runningExePath,
  scanProcessesNow,
  selectAmbiguousCustomGame,
  selectAmbiguousMatch,
} from "./tracker";
import { STORAGE_KEY } from "./persistence";

/* Game.exe is linked per folder ─────────────────────────────────────────────
   Every way a game gets linked to a generic exe name must link the folder the
   file runs from, never the name: one name link claims every other Game.exe
   on the PC. */

const TUPAC = String.raw`D:\Games\Tupac\Game.exe`;
const SOLITAIRE = String.raw`D:\Games\Solitaire\Game.exe`;
const MOVED = String.raw`E:\Tupac\Game.exe`;

let running: ProcessSnapshot[] = [];
let serverGame: Game | null = null;
let serverAmbiguous: Game[] | undefined;

function process(exePath: string, pid: number): ProcessSnapshot {
  return { exeName: "Game.exe", exePath, pid };
}

function igdbGame(id: number, name: string): Game {
  return { id, igdbId: id, name, coverUrl: "cover", source: "igdb" };
}

function folderLinks() {
  return [...useAppStore.getState().scopedExeLinks.values()];
}

function linkFor(exePath: string) {
  const folder = exePath.replace(/\\[^\\]*$/, "").toLowerCase();
  return folderLinks().find((link) => link.pathPrefix.toLowerCase() === folder);
}

function activeGameNames() {
  return useAppStore
    .getState()
    .activeSessions.map((session) => session.gameName);
}

/** A running Game.exe waiting in the picker. */
function ambiguous(exePath: string, candidates: Game[] = []) {
  useAppStore.getState().setAmbiguousMatch({
    exeName: "Game.exe",
    exePath,
    candidates,
    detectedAt: new Date(Date.now() - 60_000).toISOString(),
    lastCheckedAt: new Date().toISOString(),
  });
}

beforeEach(() => {
  running = [];
  serverGame = null;
  serverAmbiguous = undefined;
  localStorage.clear();
  invokeMock.mockReset();
  invokeMock.mockImplementation(async (command: string) =>
    command === "scan_processes" ? running : undefined,
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith("/api/match-processes")) {
        const body = JSON.parse(String(init?.body)) as {
          processes: { key: string }[];
        };
        return Response.json({
          matches: body.processes.map(({ key }) => ({
            key,
            game: serverGame,
            ambiguousGames: serverAmbiguous,
          })),
        });
      }
      return Response.json({});
    }),
  );
  useAppStore.setState(useAppStore.getInitialState(), true);
  useAppStore.setState({
    backendHealth: { status: "online", checkedAt: null, detail: null },
    settings: {
      ...useAppStore.getState().settings,
      rememberLaunchPaths: true,
      unmatchedRetryDays: 7,
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("every way of linking a Game.exe links its folder", () => {
  const ways: Array<[string, (exePath: string) => void | Promise<void>]> = [
    [
      "automatic match",
      async (exePath) => {
        serverGame = igdbGame(42, "Tupac");
        running = [process(exePath, 1)];
        await scanProcessesNow();
      },
    ],
    [
      "picker pick",
      (exePath) => {
        ambiguous(exePath, [igdbGame(42, "Tupac")]);
        selectAmbiguousMatch("Game.exe", igdbGame(42, "Tupac"));
      },
    ],
    [
      "picker custom name",
      (exePath) => {
        ambiguous(exePath);
        selectAmbiguousCustomGame("Game.exe", "Tupac");
      },
    ],
    [
      "Discovered add",
      (exePath) => addCustomGame("Game.exe", "Tupac", exePath),
    ],
    [
      "Discovered search & add",
      (exePath) => {
        addDatabaseGameLocally("Game.exe", exePath, {
          igdbId: 42,
          name: "Tupac",
          coverUrl: "cover",
        });
      },
    ],
    [
      "known database match",
      (exePath) =>
        applyKnownGameMatch("Game.exe", igdbGame(42, "Tupac"), exePath),
    ],
    [
      "watched folder find",
      (exePath) => adoptFolderGame("Game.exe", exePath, igdbGame(42, "Tupac")),
    ],
  ];

  it.each(ways)("%s", async (_label, link) => {
    await link(TUPAC);

    expect(useAppStore.getState().exeCache.get("game.exe")?.state).not.toBe(
      "matched",
    );
    expect(folderLinks()).toEqual([
      expect.objectContaining({
        exeName: "Game.exe",
        pathPrefix: String.raw`D:\Games\Tupac`,
        exePath: TUPAC,
        gameName: "Tupac",
      }),
    ]);
  });

  it("keeps a name link for a unique name", () => {
    addCustomGame("Celeste.exe", "Celeste", String.raw`D:\Celeste\Celeste.exe`);
    expect(useAppStore.getState().exeCache.get("celeste.exe")).toMatchObject({
      state: "matched",
      gameName: "Celeste",
    });
    expect(folderLinks()).toEqual([]);
  });
});

describe("RPG Maker games with their own Game.exe", () => {
  it("tracks two folders as two games", async () => {
    addCustomGame("Game.exe", "Tupac", TUPAC);

    // Another folder runs: the name already has a game, so the picker asks.
    running = [process(SOLITAIRE, 2)];
    await scanProcessesNow();
    expect(activeGameNames()).toEqual([]);
    const picker = useAppStore.getState().ambiguousMatches[0];
    expect(picker).toMatchObject({ exeName: "Game.exe", exePath: SOLITAIRE });
    expect(picker.candidates.map((game) => game.name)).toEqual(["Tupac"]);

    selectAmbiguousCustomGame("Game.exe", "Solitaire");
    expect(activeGameNames()).toEqual(["Solitaire"]);
    expect(linkFor(SOLITAIRE)?.gameId).not.toBe(linkFor(TUPAC)?.gameId);

    running = [];
    await scanProcessesNow();
    running = [process(TUPAC, 3)];
    await scanProcessesNow();
    expect(activeGameNames()).toEqual(["Tupac"]);
    expect(useAppStore.getState().ambiguousMatches).toEqual([]);
  });

  it("keeps a moved game's hours under its id", async () => {
    addCustomGame("Game.exe", "Tupac", TUPAC);
    const tupacId = linkFor(TUPAC)!.gameId;

    running = [process(MOVED, 4)];
    await scanProcessesNow();
    const [tupac] = useAppStore.getState().ambiguousMatches[0].candidates;
    selectAmbiguousMatch("Game.exe", tupac);

    expect(linkFor(MOVED)?.gameId).toBe(tupacId);
    expect(useAppStore.getState().activeSessions[0]).toMatchObject({
      gameId: tupacId,
      gameName: "Tupac",
    });
  });

  it("reuses the id when a moved game is typed in again under its name", () => {
    addCustomGame("Game.exe", "Tupac", TUPAC);
    addCustomGame("Game.exe", "tupac", MOVED);
    expect(linkFor(MOVED)?.gameId).toBe(linkFor(TUPAC)?.gameId);
  });

  it("takes the database's only game for the first Game.exe, then asks", async () => {
    serverGame = igdbGame(42, "Tupac");
    running = [process(TUPAC, 5)];
    await scanProcessesNow();
    expect(activeGameNames()).toEqual(["Tupac"]);

    running = [process(TUPAC, 5), process(SOLITAIRE, 6)];
    await scanProcessesNow();
    expect(activeGameNames()).toEqual(["Tupac"]);
    expect(useAppStore.getState().ambiguousMatches[0]).toMatchObject({
      exePath: SOLITAIRE,
      candidates: [expect.objectContaining({ id: 42, name: "Tupac" })],
    });
  });

  it("does not count a linked game's time for the Game.exe waiting in Discovered", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-09-27T10:00:00Z"));
      addCustomGame("Game.exe", "Tupac", TUPAC);
      useAppStore.getState().setExeCacheEntry({
        exeName: "Game.exe",
        state: "unmatched",
        exePath: SOLITAIRE,
        lastCheckedAt: new Date().toISOString(),
      });

      running = [process(TUPAC, 7)];
      await scanProcessesNow();
      vi.setSystemTime(new Date("2026-09-27T10:05:00Z"));
      await scanProcessesNow();

      expect(useAppStore.getState().exeCache.get("game.exe")).toMatchObject({
        state: "unmatched",
        exePath: SOLITAIRE,
      });
      const waiting = useAppStore.getState().exeCache.get("game.exe")!;
      expect(waiting.runningSince).toBeUndefined();
      expect(waiting.trackedSeconds ?? 0).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps another folder's picker open while a linked Game.exe runs", async () => {
    addCustomGame("Game.exe", "Tupac", TUPAC);
    ambiguous(SOLITAIRE);

    running = [process(TUPAC, 8)];
    await scanProcessesNow();

    expect(activeGameNames()).toEqual(["Tupac"]);
    expect(useAppStore.getState().ambiguousMatches).toEqual([
      expect.objectContaining({ exePath: SOLITAIRE }),
    ]);
  });

  it("corrects only the running folder when a Game.exe is the wrong game", async () => {
    serverGame = igdbGame(42, "Tupac");
    running = [process(TUPAC, 10)];
    await scanProcessesNow();
    addCustomGame("Game.exe", "Solitaire", SOLITAIRE);
    const [session] = useAppStore.getState().activeSessions;

    const game = correctRunningGenericExe(session, {
      igdbId: 77,
      name: "Real Tupac",
      coverUrl: "real",
    });

    expect(game).toMatchObject({ igdbId: 77, name: "Real Tupac" });
    expect(linkFor(TUPAC)).toMatchObject({ gameName: "Real Tupac" });
    expect(linkFor(SOLITAIRE)).toMatchObject({ gameName: "Solitaire" });
    expect(activeGameNames()).toEqual(["Real Tupac"]);
    expect(useAppStore.getState().exeCache.get("game.exe")?.state).not.toBe(
      "matched",
    );
  });
});

describe("saves from before folder links", () => {
  function save(values: Record<string, unknown>) {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        settings: { rememberLaunchPaths: true },
        exeCache: [],
        gameMetadata: [],
        sessions: [],
        activeSessions: [],
        ambiguousMatches: [],
        blacklist: [],
        notifications: [],
        seenContributionStatus: {},
        ...values,
      }),
    );
  }

  it("moves Game.exe's name link to its Play file's folder on load", async () => {
    save({
      exeCache: [
        {
          exeName: "Game.exe",
          state: "matched",
          gameId: -5,
          gameName: "Tupac",
          coverUrl: "",
          source: "custom",
          lastCheckedAt: "2026-09-01T00:00:00.000Z",
        },
      ],
      launchTargets: [
        {
          exeName: "Game.exe",
          path: TUPAC,
          owner: { gameId: -5, source: "custom" },
        },
      ],
    });
    hydrate();

    expect(useAppStore.getState().exeCache.has("game.exe")).toBe(false);
    expect(linkFor(TUPAC)).toMatchObject({ gameId: -5, gameName: "Tupac" });

    // The other folder is no longer claimed by Tupac.
    running = [process(SOLITAIRE, 9)];
    await scanProcessesNow();
    expect(activeGameNames()).toEqual([]);
    expect(useAppStore.getState().ambiguousMatches[0]?.exePath).toBe(SOLITAIRE);
  });

  it("keeps a custom folder link without an IGDB id across a reload", () => {
    addCustomGame("Game.exe", "Tupac", TUPAC);
    const saved = localStorage.getItem(STORAGE_KEY);
    expect(saved).not.toBeNull();
    useAppStore.setState({ scopedExeLinks: new Map() });

    hydrate();

    expect(linkFor(TUPAC)).toMatchObject({
      gameName: "Tupac",
      source: "custom",
      exePath: TUPAC,
    });
    expect(linkFor(TUPAC)?.igdbId).toBeUndefined();
  });
});

describe("ignoring one folder's Game.exe", () => {
  const OTHER = String.raw`D:\Games\Utility\Game.exe`;
  const OTHER_FOLDER = String.raw`D:\Games\Utility`;

  function communityCalls() {
    return vi
      .mocked(fetch)
      .mock.calls.filter(([url]) => String(url).includes("/api/community/"));
  }

  function ignoredFolders() {
    return [...useAppStore.getState().ignoredExeFolders.values()].map(
      (entry) => entry.pathPrefix,
    );
  }

  it("keeps every other Game.exe tracked", async () => {
    addCustomGame("Game.exe", "Tupac", TUPAC);
    running = [process(OTHER, 11)];
    await scanProcessesNow();
    expect(useAppStore.getState().ambiguousMatches[0]?.exePath).toBe(OTHER);

    const outcome = await dismissAmbiguousMatch("Game.exe");

    expect(outcome.folder).toBe(OTHER_FOLDER);
    expect(ignoredFolders()).toEqual([OTHER_FOLDER]);
    expect(useAppStore.getState().blacklist.has("game.exe")).toBe(false);
    expect(invokeMock).not.toHaveBeenCalledWith(
      "set_user_ignored_process",
      expect.anything(),
    );

    running = [process(OTHER, 11), process(TUPAC, 12)];
    await scanProcessesNow();
    expect(activeGameNames()).toEqual(["Tupac"]);
    expect(useAppStore.getState().ambiguousMatches).toEqual([]);
  });

  it("never reports Game.exe as not a game", async () => {
    addCustomGame("Game.exe", "Tupac", TUPAC);
    addCustomGame("Game.exe", "Solitaire", SOLITAIRE);
    running = [process(TUPAC, 13)];
    await scanProcessesNow();
    const [session] = useAppStore.getState().activeSessions;

    const outcome = await reportNegativeMatch("Game.exe", [
      runningExePath(session),
    ]);

    expect(outcome).toMatchObject({
      report: "skipped",
      folder: String.raw`D:\Games\Tupac`,
    });
    expect(communityCalls()).toEqual([]);
    expect(activeGameNames()).toEqual([]);
    expect(linkFor(TUPAC)).toBeUndefined();
    expect(linkFor(SOLITAIRE)).toMatchObject({ gameName: "Solitaire" });
  });

  it('ignores only the running folder on "Not playing"', async () => {
    addCustomGame("Game.exe", "Tupac", TUPAC);
    running = [process(TUPAC, 14)];
    await scanProcessesNow();
    const [session] = useAppStore.getState().activeSessions;

    await ignoreTrackedProcessLocally("Game.exe", runningExePath(session));

    expect(ignoredFolders()).toEqual([String.raw`D:\Games\Tupac`]);
    await scanProcessesNow();
    expect(activeGameNames()).toEqual([]);
  });

  it("does not share an ignored Game.exe, even with sharing on", async () => {
    useAppStore.setState({
      installUuid: "550e8400-e29b-41d4-a716-446655440000",
      settings: {
        ...useAppStore.getState().settings,
        autoShareIgnoredProcesses: true,
      },
    });

    const outcome = await ignoreDiscoveredProcess("Game.exe", OTHER);

    expect(outcome.folder).toBe(OTHER_FOLDER);
    expect(outcome.suggestion).toEqual({ kind: "disabled" });
    expect(communityCalls()).toEqual([]);
  });

  it("still ignores a unique name everywhere", async () => {
    await ignoreDiscoveredProcess(
      "Tool.exe",
      String.raw`D:\Apps\Tool\Tool.exe`,
    );
    expect(useAppStore.getState().blacklist.has("tool.exe")).toBe(true);
    expect(ignoredFolders()).toEqual([]);
  });

  it("asks again after Restore", async () => {
    addCustomGame("Game.exe", "Tupac", TUPAC);
    await ignoreDiscoveredProcess("Game.exe", OTHER);
    const [key] = useAppStore.getState().ignoredExeFolders.keys();

    restoreIgnoredExeFolder(key);
    running = [process(OTHER, 15)];
    await scanProcessesNow();

    expect(ignoredFolders()).toEqual([]);
    expect(useAppStore.getState().ambiguousMatches[0]?.exePath).toBe(OTHER);
  });

  it("keeps ignored folders across a reload", async () => {
    addCustomGame("Game.exe", "Tupac", TUPAC);
    await ignoreDiscoveredProcess("Game.exe", OTHER);
    useAppStore.setState({ ignoredExeFolders: new Map() });

    hydrate();

    expect(ignoredFolders()).toEqual([OTHER_FOLDER]);
  });
});

describe("a game named again after a restore", () => {
  it("keeps its hours when the history knows the name", () => {
    useAppStore.setState({
      recentSessions: [
        {
          id: 1,
          gameId: -123,
          gameName: "Tupac",
          coverUrl: "",
          source: "custom",
          exeName: "Game.exe",
          startedAt: "2026-09-01T10:00:00.000Z",
          endedAt: "2026-09-01T11:00:00.000Z",
          durationSeconds: 3600,
        },
      ],
    });

    addCustomGame("Game.exe", "Tupac", TUPAC);

    expect(linkFor(TUPAC)?.gameId).toBe(-123);
  });
});

describe("a name thousands of database games use", () => {
  const many = Array.from({ length: 100 }, (_, index) =>
    igdbGame(1000 + index, `RPG ${index}`),
  );

  it("shows and saves only the first 30 in the picker", async () => {
    serverAmbiguous = many;
    running = [process(TUPAC, 20)];
    await scanProcessesNow();

    const [picker] = useAppStore.getState().ambiguousMatches;
    expect(picker.candidates.map((game) => game.id)).toEqual(
      many.slice(0, 30).map((game) => game.id),
    );
    expect(picker.hiddenCandidateCount).toBe(70);
  });

  it("keeps the games already linked to the name first", async () => {
    addCustomGame("Game.exe", "Solitaire", SOLITAIRE);
    serverAmbiguous = many;
    running = [process(TUPAC, 21)];
    await scanProcessesNow();

    const [picker] = useAppStore.getState().ambiguousMatches;
    expect(picker.candidates[0].name).toBe("Solitaire");
    expect(picker.candidates).toHaveLength(30);
    expect(picker.hiddenCandidateCount).toBe(71);
  });

  it("cuts a picker saved before the limit on load", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        settings: {},
        exeCache: [],
        gameMetadata: [],
        sessions: [],
        activeSessions: [],
        blacklist: [],
        notifications: [],
        seenContributionStatus: {},
        ambiguousMatches: [
          {
            exeName: "Game.exe",
            exePath: TUPAC,
            candidates: many,
            detectedAt: "2026-09-27T10:00:00.000Z",
          },
        ],
      }),
    );

    hydrate();

    const [picker] = useAppStore.getState().ambiguousMatches;
    expect(picker.candidates).toHaveLength(30);
    expect(picker.hiddenCandidateCount).toBe(70);
  });

  it("lists only the first 30 when checking for matches", async () => {
    serverAmbiguous = many;
    const lookup = await findGameMatches("Game.exe");
    expect(lookup.games).toHaveLength(30);
    expect(lookup.hiddenCount).toBe(70);
  });
});

describe("changing a Game.exe game in My Games", () => {
  it("moves every folder of that game with its hours, and only that game", () => {
    addCustomGame("Game.exe", "Tupac", TUPAC);
    addCustomGame("Game.exe", "Tupac", MOVED);
    addCustomGame("Game.exe", "Solitaire", SOLITAIRE);
    const tupac = linkFor(TUPAC)!;
    useAppStore.setState({
      recentSessions: [
        {
          id: 1,
          gameId: tupac.gameId,
          gameName: "Tupac",
          coverUrl: "",
          source: "custom",
          exeName: "Game.exe",
          startedAt: "2026-09-01T10:00:00.000Z",
          endedAt: "2026-09-01T11:00:00.000Z",
          durationSeconds: 3600,
        },
      ],
      archivedGameSeconds: { [`custom:${tupac.gameId}`]: 7200 },
    });

    const game = applyDatabaseGameToFolderLinks(
      "Game.exe",
      [{ gameId: tupac.gameId, source: "custom" }],
      { igdbId: 77, name: "Real Tupac", coverUrl: "real" },
    );

    expect(game).toMatchObject({ igdbId: 77, name: "Real Tupac" });
    expect(linkFor(TUPAC)).toMatchObject({ gameName: "Real Tupac" });
    expect(linkFor(MOVED)).toMatchObject({ gameName: "Real Tupac" });
    expect(linkFor(SOLITAIRE)).toMatchObject({ gameName: "Solitaire" });
    expect(useAppStore.getState().recentSessions[0]).toMatchObject({
      gameId: game!.id,
      gameName: "Real Tupac",
    });
    expect(useAppStore.getState().archivedGameSeconds).toEqual({
      [`custom:${game!.id}`]: 7200,
    });
  });
});
