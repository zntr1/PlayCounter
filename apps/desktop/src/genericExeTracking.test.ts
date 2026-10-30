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
  doNotTrackGame,
  findGameMatches,
  hydrate,
  ignoreDiscoveredProcess,
  ignoreTrackedProcessLocally,
  reportNegativeMatch,
  restoreDismissedWatchFolder,
  restoreIgnoredExeFolder,
  runningExePath,
  scanProcessesNow,
  selectAmbiguousCustomGame,
  selectAmbiguousMatch,
  setUserIgnoredProcess,
  untrackGame,
} from "./tracker";
import {
  readWatchFolders,
  writeWatchFolders,
} from "./library/watchFolderState";
import { STORAGE_KEY } from "./persistence";

/* Game.exe and co. are linked per folder ────────────────────────────────────
   Every way a game gets linked to a generic exe name must link the folder the
   file runs from, never the name: one name link claims every other copy on
   the PC. Every case runs for RPG Maker games with their own Game.exe and for
   Java games that bring their own Java (jre\bin\javaw.exe). */

const SHARED_FILES = [
  { exeName: "Game.exe", subfolder: "" },
  { exeName: "javaw.exe", subfolder: String.raw`jre\bin` },
];

/** The games' own folders. Utility is an app, not a game. */
const TUPAC_FOLDER = String.raw`D:\Games\Tupac`;
const SOLITAIRE_FOLDER = String.raw`D:\Games\Solitaire`;
const MOVED_FOLDER = String.raw`E:\Tupac`;
const UTILITY_FOLDER = String.raw`D:\Games\Utility`;

let running: ProcessSnapshot[] = [];
let serverGame: Game | null = null;
let serverAmbiguous: Game[] | undefined;

function exeNameOf(exePath: string) {
  return exePath.replace(/^.*\\/, "");
}

/** The folder a file runs from: what folder links and ignores hold. */
function folderOf(exePath: string) {
  return exePath.replace(/\\[^\\]*$/, "");
}

function process(exePath: string, pid: number): ProcessSnapshot {
  return { exeName: exeNameOf(exePath), exePath, pid };
}

function igdbGame(id: number, name: string): Game {
  return { id, igdbId: id, name, coverUrl: "cover", source: "igdb" };
}

function folderLinks() {
  return [...useAppStore.getState().scopedExeLinks.values()];
}

function linkFor(exePath: string) {
  const folder = folderOf(exePath).toLowerCase();
  return folderLinks().find((link) => link.pathPrefix.toLowerCase() === folder);
}

function activeGameNames() {
  return useAppStore
    .getState()
    .activeSessions.map((session) => session.gameName);
}

/** The two kinds of games a generic file's folder gets: named, or picked from
 *  the database (a custom game carrying an IGDB id). */
const linkedGames: Array<[string, (name: string, exePath: string) => void]> = [
  [
    "named",
    (name, exePath) => addCustomGame(exeNameOf(exePath), name, exePath),
  ],
  [
    "database pick",
    (name, exePath) =>
      addDatabaseGameLocally(exeNameOf(exePath), exePath, {
        igdbId: name.length,
        name,
        coverUrl: "cover",
      }),
  ],
];

/** A running copy waiting in the picker. */
function ambiguous(exePath: string, candidates: Game[] = []) {
  useAppStore.getState().setAmbiguousMatch({
    exeName: exeNameOf(exePath),
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

describe.each(SHARED_FILES)("$exeName", ({ exeName: EXE, subfolder }) => {
  const KEY = EXE.toLowerCase();
  /** The file inside a game's folder. */
  const at = (gameFolder: string) =>
    [gameFolder, subfolder, EXE].filter(Boolean).join("\\");
  const TUPAC = at(TUPAC_FOLDER);
  const SOLITAIRE = at(SOLITAIRE_FOLDER);
  const MOVED = at(MOVED_FOLDER);
  const OTHER = at(UTILITY_FOLDER);

  describe(`every way of linking a ${EXE} links its folder`, () => {
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
          selectAmbiguousMatch(EXE, igdbGame(42, "Tupac"));
        },
      ],
      [
        "picker custom name",
        (exePath) => {
          ambiguous(exePath);
          selectAmbiguousCustomGame(EXE, "Tupac");
        },
      ],
      ["Discovered add", (exePath) => addCustomGame(EXE, "Tupac", exePath)],
      [
        "Discovered search & add",
        (exePath) => {
          addDatabaseGameLocally(EXE, exePath, {
            igdbId: 42,
            name: "Tupac",
            coverUrl: "cover",
          });
        },
      ],
      [
        "known database match",
        (exePath) => applyKnownGameMatch(EXE, igdbGame(42, "Tupac"), exePath),
      ],
      [
        "watched folder find",
        (exePath) => adoptFolderGame(EXE, exePath, igdbGame(42, "Tupac")),
      ],
    ];

    it.each(ways)("%s", async (_label, link) => {
      await link(TUPAC);

      expect(useAppStore.getState().exeCache.get(KEY)?.state).not.toBe(
        "matched",
      );
      expect(folderLinks()).toEqual([
        expect.objectContaining({
          exeName: EXE,
          pathPrefix: folderOf(TUPAC),
          exePath: TUPAC,
          gameName: "Tupac",
        }),
      ]);
    });

    it("keeps a name link for a unique name", () => {
      addCustomGame(
        "Celeste.exe",
        "Celeste",
        String.raw`D:\Celeste\Celeste.exe`,
      );
      expect(useAppStore.getState().exeCache.get("celeste.exe")).toMatchObject({
        state: "matched",
        gameName: "Celeste",
      });
      expect(folderLinks()).toEqual([]);
    });
  });

  describe(`games with their own ${EXE}`, () => {
    it("tracks two folders as two games", async () => {
      addCustomGame(EXE, "Tupac", TUPAC);

      // Another folder runs: the name already has a game, so the picker asks.
      running = [process(SOLITAIRE, 2)];
      await scanProcessesNow();
      expect(activeGameNames()).toEqual([]);
      const picker = useAppStore.getState().ambiguousMatches[0];
      expect(picker).toMatchObject({ exeName: EXE, exePath: SOLITAIRE });
      expect(picker.candidates.map((game) => game.name)).toEqual(["Tupac"]);

      selectAmbiguousCustomGame(EXE, "Solitaire");
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
      addCustomGame(EXE, "Tupac", TUPAC);
      const tupacId = linkFor(TUPAC)!.gameId;

      running = [process(MOVED, 4)];
      await scanProcessesNow();
      const [tupac] = useAppStore.getState().ambiguousMatches[0].candidates;
      selectAmbiguousMatch(EXE, tupac);

      expect(linkFor(MOVED)?.gameId).toBe(tupacId);
      expect(useAppStore.getState().activeSessions[0]).toMatchObject({
        gameId: tupacId,
        gameName: "Tupac",
      });
    });

    it("reuses the id when a moved game is typed in again under its name", () => {
      addCustomGame(EXE, "Tupac", TUPAC);
      addCustomGame(EXE, "tupac", MOVED);
      expect(linkFor(MOVED)?.gameId).toBe(linkFor(TUPAC)?.gameId);
    });

    it(`takes the database's only game for the first ${EXE}, then asks`, async () => {
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

    it(`does not count a linked game's time for the ${EXE} waiting in Discovered`, async () => {
      vi.useFakeTimers();
      try {
        vi.setSystemTime(new Date("2026-09-27T10:00:00Z"));
        addCustomGame(EXE, "Tupac", TUPAC);
        useAppStore.getState().setExeCacheEntry({
          exeName: EXE,
          state: "unmatched",
          exePath: SOLITAIRE,
          lastCheckedAt: new Date().toISOString(),
        });

        running = [process(TUPAC, 7)];
        await scanProcessesNow();
        vi.setSystemTime(new Date("2026-09-27T10:05:00Z"));
        await scanProcessesNow();

        expect(useAppStore.getState().exeCache.get(KEY)).toMatchObject({
          state: "unmatched",
          exePath: SOLITAIRE,
        });
        const waiting = useAppStore.getState().exeCache.get(KEY)!;
        expect(waiting.runningSince).toBeUndefined();
        expect(waiting.trackedSeconds ?? 0).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    });

    it(`keeps another folder's picker open while a linked ${EXE} runs`, async () => {
      addCustomGame(EXE, "Tupac", TUPAC);
      ambiguous(SOLITAIRE);

      running = [process(TUPAC, 8)];
      await scanProcessesNow();

      expect(activeGameNames()).toEqual(["Tupac"]);
      expect(useAppStore.getState().ambiguousMatches).toEqual([
        expect.objectContaining({ exePath: SOLITAIRE }),
      ]);
    });

    it(`corrects only the running folder when a ${EXE} is the wrong game`, async () => {
      serverGame = igdbGame(42, "Tupac");
      running = [process(TUPAC, 10)];
      await scanProcessesNow();
      addCustomGame(EXE, "Solitaire", SOLITAIRE);
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
      expect(useAppStore.getState().exeCache.get(KEY)?.state).not.toBe(
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

    it(`moves ${EXE}'s name link to its Play file's folder on load`, async () => {
      save({
        exeCache: [
          {
            exeName: EXE,
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
            exeName: EXE,
            path: TUPAC,
            owner: { gameId: -5, source: "custom" },
          },
        ],
      });
      hydrate();

      expect(useAppStore.getState().exeCache.has(KEY)).toBe(false);
      expect(linkFor(TUPAC)).toMatchObject({ gameId: -5, gameName: "Tupac" });

      // The other folder is no longer claimed by Tupac.
      running = [process(SOLITAIRE, 9)];
      await scanProcessesNow();
      expect(activeGameNames()).toEqual([]);
      expect(useAppStore.getState().ambiguousMatches[0]?.exePath).toBe(
        SOLITAIRE,
      );
    });

    it("keeps a custom folder link without an IGDB id across a reload", () => {
      addCustomGame(EXE, "Tupac", TUPAC);
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

  describe(`ignoring one folder's ${EXE}`, () => {
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

    it(`keeps every other ${EXE} tracked`, async () => {
      addCustomGame(EXE, "Tupac", TUPAC);
      running = [process(OTHER, 11)];
      await scanProcessesNow();
      expect(useAppStore.getState().ambiguousMatches[0]?.exePath).toBe(OTHER);

      const outcome = await dismissAmbiguousMatch(EXE);

      expect(outcome.folder).toBe(folderOf(OTHER));
      expect(ignoredFolders()).toEqual([folderOf(OTHER)]);
      expect(useAppStore.getState().blacklist.has(KEY)).toBe(false);
      expect(invokeMock).not.toHaveBeenCalledWith(
        "set_user_ignored_process",
        expect.anything(),
      );

      running = [process(OTHER, 11), process(TUPAC, 12)];
      await scanProcessesNow();
      expect(activeGameNames()).toEqual(["Tupac"]);
      expect(useAppStore.getState().ambiguousMatches).toEqual([]);
    });

    it(`never reports ${EXE} as not a game`, async () => {
      addCustomGame(EXE, "Tupac", TUPAC);
      addCustomGame(EXE, "Solitaire", SOLITAIRE);
      running = [process(TUPAC, 13)];
      await scanProcessesNow();
      const [session] = useAppStore.getState().activeSessions;

      const outcome = await reportNegativeMatch(EXE, [runningExePath(session)]);

      expect(outcome).toMatchObject({
        report: "skipped",
        folder: folderOf(TUPAC),
      });
      expect(communityCalls()).toEqual([]);
      expect(activeGameNames()).toEqual([]);
      expect(linkFor(TUPAC)).toBeUndefined();
      expect(linkFor(SOLITAIRE)).toMatchObject({ gameName: "Solitaire" });
    });

    it('ignores only the running folder on "Not playing"', async () => {
      addCustomGame(EXE, "Tupac", TUPAC);
      running = [process(TUPAC, 14)];
      await scanProcessesNow();
      const [session] = useAppStore.getState().activeSessions;

      await ignoreTrackedProcessLocally(EXE, runningExePath(session));

      expect(ignoredFolders()).toEqual([folderOf(TUPAC)]);
      await scanProcessesNow();
      expect(activeGameNames()).toEqual([]);
    });

    it(`does not share an ignored ${EXE}, even with sharing on`, async () => {
      useAppStore.setState({
        installUuid: "550e8400-e29b-41d4-a716-446655440000",
        settings: {
          ...useAppStore.getState().settings,
          autoShareIgnoredProcesses: true,
        },
      });

      const outcome = await ignoreDiscoveredProcess(EXE, OTHER);

      expect(outcome.folder).toBe(folderOf(OTHER));
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
      addCustomGame(EXE, "Tupac", TUPAC);
      await ignoreDiscoveredProcess(EXE, OTHER);
      const [key] = useAppStore.getState().ignoredExeFolders.keys();

      restoreIgnoredExeFolder(key);
      running = [process(OTHER, 15)];
      await scanProcessesNow();

      expect(ignoredFolders()).toEqual([]);
      expect(useAppStore.getState().ambiguousMatches[0]?.exePath).toBe(OTHER);
    });

    it("keeps ignored folders across a reload", async () => {
      addCustomGame(EXE, "Tupac", TUPAC);
      await ignoreDiscoveredProcess(EXE, OTHER);
      useAppStore.setState({ ignoredExeFolders: new Map() });

      hydrate();

      expect(ignoredFolders()).toEqual([folderOf(OTHER)]);
    });

    it.each(linkedGames)(
      'ignores only that game\'s folders on "Ignore game" (%s)',
      async (_label, add) => {
        add("Tupac", TUPAC);
        add("Tupac", MOVED);
        add("Solitaire", SOLITAIRE);
        const tupac = linkFor(TUPAC)!;

        await doNotTrackGame(tupac.gameId, tupac.source, [EXE], false, [
          { gameId: tupac.gameId, source: tupac.source },
        ]);

        expect(ignoredFolders()).toEqual([folderOf(TUPAC), folderOf(MOVED)]);
        expect(invokeMock).not.toHaveBeenCalledWith(
          "set_user_ignored_process",
          expect.anything(),
        );
        running = [process(SOLITAIRE, 16)];
        await scanProcessesNow();
        expect(activeGameNames()).toEqual(["Solitaire"]);
      },
    );
  });

  describe("restoring an ignored file of a watched folder", () => {
    const TOOL_FOLDER = String.raw`D:\Games\Tool`;

    // A watched folder remembers the game's own folder; the ignore holds the
    // folder the file runs from, which can sit deeper (jre\bin).
    function dismiss(...items: Array<[string, string]>) {
      writeWatchFolders({
        folders: [],
        seen: {},
        pending: {},
        dismissed: items.map(([folderPath, exeName]) => ({
          folderPath,
          exeName,
        })),
      });
    }

    function dismissedFolders() {
      return readWatchFolders().dismissed.map((item) => item.folderPath);
    }

    function ignoredFolders() {
      return [...useAppStore.getState().ignoredExeFolders.values()].map(
        (entry) => entry.pathPrefix,
      );
    }

    beforeEach(() => {
      invokeMock.mockImplementation(async (command: string) =>
        command === "set_user_ignored_process"
          ? { processes: [], userFilePath: null, userProcesses: [] }
          : undefined,
      );
    });

    it("offers the folder again after Restore in Discovered, and only that one", async () => {
      await ignoreDiscoveredProcess(EXE, TUPAC);
      await ignoreDiscoveredProcess(EXE, SOLITAIRE);
      dismiss([TUPAC_FOLDER, EXE], [SOLITAIRE_FOLDER, EXE]);
      const [tupacKey] = useAppStore.getState().ignoredExeFolders.keys();

      restoreIgnoredExeFolder(tupacKey);

      expect(dismissedFolders()).toEqual([SOLITAIRE_FOLDER]);
    });

    it("stops ignoring the folder after Restore in Settings", async () => {
      await ignoreDiscoveredProcess(EXE, TUPAC);
      await ignoreDiscoveredProcess(EXE, SOLITAIRE);
      dismiss([TUPAC_FOLDER, EXE], [SOLITAIRE_FOLDER, EXE]);

      await restoreDismissedWatchFolder(TUPAC_FOLDER, EXE);

      expect(dismissedFolders()).toEqual([SOLITAIRE_FOLDER]);
      expect(ignoredFolders()).toEqual([folderOf(SOLITAIRE)]);
    });

    it("offers a unique name's folders again when the name is restored", async () => {
      useAppStore.setState({ userIgnoredProcesses: new Set(["tool.exe"]) });
      dismiss([TOOL_FOLDER, "tool.exe"], [TUPAC_FOLDER, EXE]);

      await setUserIgnoredProcess("Tool.exe", false);

      expect(dismissedFolders()).toEqual([TUPAC_FOLDER]);
    });

    it("clears the in-app block on Restore in Settings", async () => {
      await ignoreDiscoveredProcess(
        "Tool.exe",
        String.raw`D:\Games\Tool\Tool.exe`,
      );
      dismiss([TOOL_FOLDER, "tool.exe"]);

      await restoreDismissedWatchFolder(TOOL_FOLDER, "tool.exe");

      expect(useAppStore.getState().blacklist.has("tool.exe")).toBe(false);
      expect(dismissedFolders()).toEqual([]);
    });
  });

  describe(`removing a ${EXE} game`, () => {
    it.each(linkedGames)(
      "asks again for its folder (%s)",
      async (_label, add) => {
        add("Tupac", TUPAC);
        add("Solitaire", SOLITAIRE);
        const tupac = linkFor(TUPAC)!;

        untrackGame(tupac.gameId, tupac.source, false, [
          { gameId: tupac.gameId, source: tupac.source },
        ]);
        expect(linkFor(TUPAC)).toBeUndefined();

        running = [process(TUPAC, 17)];
        await scanProcessesNow();
        expect(activeGameNames()).toEqual([]);
        expect(useAppStore.getState().ambiguousMatches[0]).toMatchObject({
          exePath: TUPAC,
          candidates: [expect.objectContaining({ name: "Solitaire" })],
        });
      },
    );
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
            exeName: EXE,
            startedAt: "2026-09-01T10:00:00.000Z",
            endedAt: "2026-09-01T11:00:00.000Z",
            durationSeconds: 3600,
          },
        ],
      });

      addCustomGame(EXE, "Tupac", TUPAC);

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
      addCustomGame(EXE, "Solitaire", SOLITAIRE);
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
              exeName: EXE,
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
      const lookup = await findGameMatches(EXE);
      expect(lookup.games).toHaveLength(30);
      expect(lookup.hiddenCount).toBe(70);
    });
  });

  describe(`changing a ${EXE} game in My Games`, () => {
    it("moves every folder of that game with its hours, and only that game", () => {
      addCustomGame(EXE, "Tupac", TUPAC);
      addCustomGame(EXE, "Tupac", MOVED);
      addCustomGame(EXE, "Solitaire", SOLITAIRE);
      const tupac = linkFor(TUPAC)!;
      useAppStore.setState({
        recentSessions: [
          {
            id: 1,
            gameId: tupac.gameId,
            gameName: "Tupac",
            coverUrl: "",
            source: "custom",
            exeName: EXE,
            startedAt: "2026-09-01T10:00:00.000Z",
            endedAt: "2026-09-01T11:00:00.000Z",
            durationSeconds: 3600,
          },
        ],
        archivedGameSeconds: { [`custom:${tupac.gameId}`]: 7200 },
      });

      const game = applyDatabaseGameToFolderLinks(
        EXE,
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
});
