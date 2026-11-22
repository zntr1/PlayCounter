// @vitest-environment happy-dom
import type {
  CommunityGameSuggestionResponse,
  Game,
} from "@playcounter/shared";
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
  applyContributionMarkers,
  applyDatabaseGameToFolderLinks,
  applyKnownGameMatch,
  correctRunningGenericExe,
  dismissAmbiguousMatch,
  doNotTrackGame,
  findGameMatches,
  hydrate,
  ignoreDiscoveredProcess,
  ignoreTrackedProcessLocally,
  localDatabaseGame,
  markExecutableAsSoftware,
  refreshPerFolderFiles,
  reportNegativeMatch,
  restoreDismissedWatchFolder,
  restoreIgnoredExeFolder,
  runningExePath,
  scanProcessesNow,
  selectAmbiguousCustomGame,
  selectAmbiguousMatch,
  sendSharedFileGame,
  setUserIgnoredProcess,
  submitLocalLinkToCommunity,
  untrackGame,
} from "./tracker";
import { isGenericExeName } from "./library/exeCandidates";
import { setPerFolderFiles } from "./library/perFolderFiles";
import {
  readWatchFolders,
  writeWatchFolders,
} from "./library/watchFolderState";
import { STORAGE_KEY } from "./persistence";
import { resetSleepWatch } from "./sleepGap";

/* Game.exe and co. are linked per folder ────────────────────────────────────
   Every way a game gets linked to a generic exe name must link the folder the
   file runs from, never the name: one name link claims every other copy on
   the PC. Every case runs for RPG Maker games with their own Game.exe, for
   Java games that bring their own Java (jre\bin\javaw.exe), and for WoW
   clients, which all run Wow.exe (Battle.net's _retail_ folder, older clients
   in a folder of their own). SkyrimSE.exe is on no built-in list: the admin
   panel marks it "Per folder", and the app fetched that list
   (docs/per-folder-list-plan.md). */

const SHARED_FILES = [
  { exeName: "Game.exe", subfolder: "" },
  { exeName: "javaw.exe", subfolder: String.raw`jre\bin` },
  { exeName: "Wow.exe", subfolder: "_retail_" },
  { exeName: "Sherlock.exe", subfolder: "" },
  { exeName: "SkyrimSE.exe", subfolder: "", fromServer: true },
];

/** The games' own folders. Utility is an app, not a game. */
const TUPAC_FOLDER = String.raw`D:\Games\Tupac`;
const SOLITAIRE_FOLDER = String.raw`D:\Games\Solitaire`;
const MOVED_FOLDER = String.raw`E:\Tupac`;
const UTILITY_FOLDER = String.raw`D:\Games\Utility`;

let running: ProcessSnapshot[] = [];
let serverGame: Game | null = null;
let serverAmbiguous: Game[] | undefined;
/** What GET /api/identifiers/per-folder answers: the names, or a failure. */
let serverPerFolder: string[] | "fails" = [];
/** What POST /api/community/suggestions answers. */
let serverSuggestion: CommunityGameSuggestionResponse = {};

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

/** App data an older version saved; hydrate() loads it as on start. */
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

beforeEach(() => {
  running = [];
  serverGame = null;
  serverAmbiguous = undefined;
  serverPerFolder = [];
  serverSuggestion = {};
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
      if (String(url).endsWith("/api/identifiers/per-folder")) {
        return serverPerFolder === "fails"
          ? new Response("", { status: 500 })
          : Response.json({ files: serverPerFolder });
      }
      if (String(url).endsWith("/api/community/suggestions")) {
        return Response.json(serverSuggestion);
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
  setPerFolderFiles([]);
});

describe.each(SHARED_FILES)(
  "$exeName",
  ({ exeName: EXE, subfolder, fromServer }) => {
    const KEY = EXE.toLowerCase();
    beforeEach(() => {
      if (fromServer) setPerFolderFiles([KEY]);
    });
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
        expect(
          useAppStore.getState().exeCache.get("celeste.exe"),
        ).toMatchObject({
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
          .mock.calls.filter(([url]) =>
            String(url).includes("/api/community/"),
          );
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

        const outcome = await reportNegativeMatch(EXE, [
          runningExePath(session),
        ]);

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

    /* docs/shared-file-suggestions-plan.md: a database game a player picks
       for a shared file goes to review, from the folder it was picked for.
       Once approved, it is one more choice for the file. */
    describe(`a database game picked for a ${EXE} goes to review`, () => {
      const INSTALL = "550e8400-e29b-41d4-a716-446655440000";
      const REAL_TUPAC = { igdbId: 77, name: "Real Tupac", coverUrl: "real" };

      beforeEach(() => {
        useAppStore.setState({ installUuid: INSTALL });
        serverSuggestion = { id: 900, verified: false };
      });

      function suggestionsSent() {
        return vi
          .mocked(fetch)
          .mock.calls.filter(([url]) =>
            String(url).endsWith("/api/community/suggestions"),
          )
          .map(([, init]) => JSON.parse(String(init?.body)) as unknown);
      }

      const SENT = {
        exeName: EXE,
        name: "Real Tupac",
        coverUrl: "real",
        igdbId: 77,
        installUuid: INSTALL,
        sharedFile: true,
      };

      function expectNoNameLink() {
        expect(useAppStore.getState().exeCache.get(KEY)?.state).not.toBe(
          "matched",
        );
      }

      it("from the picker's search: its folder as today, and the pair", async () => {
        ambiguous(TUPAC);
        const game = localDatabaseGame(EXE, TUPAC, REAL_TUPAC);
        selectAmbiguousMatch(EXE, game);

        expect(await sendSharedFileGame(EXE, game)).toBe(true);

        expect(suggestionsSent()).toEqual([SENT]);
        expect(linkFor(TUPAC)).toMatchObject({
          gameName: "Real Tupac",
          communitySuggestionId: 900,
        });
        expectNoNameLink();
      });

      it('from "Wrong game?": only the running folder changes, and the pair', async () => {
        serverGame = igdbGame(42, "Tupac");
        running = [process(TUPAC, 10)];
        await scanProcessesNow();
        addCustomGame(EXE, "Solitaire", SOLITAIRE);
        const [session] = useAppStore.getState().activeSessions;
        const game = correctRunningGenericExe(session, REAL_TUPAC)!;

        expect(await sendSharedFileGame(EXE, game)).toBe(true);

        expect(suggestionsSent()).toEqual([SENT]);
        expect(linkFor(TUPAC)).toMatchObject({ communitySuggestionId: 900 });
        expect(linkFor(SOLITAIRE)).toMatchObject({ gameName: "Solitaire" });
        expect(linkFor(SOLITAIRE)?.communitySuggestionId).toBeUndefined();
        expectNoNameLink();
      });

      it("from Discovered's search & add", async () => {
        const game = addDatabaseGameLocally(EXE, TUPAC, REAL_TUPAC);

        expect(await sendSharedFileGame(EXE, game)).toBe(true);

        expect(suggestionsSent()).toEqual([SENT]);
        expect(linkFor(TUPAC)).toMatchObject({ communitySuggestionId: 900 });
        expectNoNameLink();
      });

      it("from My Games' Change game", async () => {
        addCustomGame(EXE, "Tupac", TUPAC);
        addCustomGame(EXE, "Solitaire", SOLITAIRE);
        const tupac = linkFor(TUPAC)!;
        const game = applyDatabaseGameToFolderLinks(
          EXE,
          [{ gameId: tupac.gameId, source: "custom" }],
          REAL_TUPAC,
        )!;

        expect(await sendSharedFileGame(EXE, game)).toBe(true);

        expect(suggestionsSent()).toEqual([SENT]);
        expect(linkFor(TUPAC)).toMatchObject({ communitySuggestionId: 900 });
        expect(linkFor(SOLITAIRE)?.communitySuggestionId).toBeUndefined();
        expectNoNameLink();
      });

      it("from the launcher import, with the shared-file mark", async () => {
        addDatabaseGameLocally(EXE, TUPAC, REAL_TUPAC);
        const [key] = [...useAppStore.getState().scopedExeLinks].find(
          ([, link]) => link.exePath === TUPAC,
        )!;

        expect(
          await submitLocalLinkToCommunity({ kind: "scoped", key }),
        ).toEqual({ kind: "submitted" });

        expect(suggestionsSent()).toEqual([SENT]);
      });

      it("keeps a folder link when the server already knows the pair", async () => {
        serverSuggestion = { igdbGame: igdbGame(77, "Real Tupac") };
        addCustomGame(EXE, "Solitaire", SOLITAIRE);
        const game = addDatabaseGameLocally(EXE, TUPAC, REAL_TUPAC);

        expect(await sendSharedFileGame(EXE, game)).toBe(false);

        expect(linkFor(TUPAC)).toMatchObject({
          gameId: 77,
          gameName: "Real Tupac",
          source: "igdb",
        });
        expect(linkFor(SOLITAIRE)).toMatchObject({ gameName: "Solitaire" });
        expectNoNameLink();
      });

      it("marks only that folder when the pair was turned down before", async () => {
        serverSuggestion = {
          id: 900,
          verified: false,
          rejected: true,
          reviewNote: "Not this game",
        };
        addCustomGame(EXE, "Solitaire", SOLITAIRE);
        const game = addDatabaseGameLocally(EXE, TUPAC, REAL_TUPAC);

        expect(await sendSharedFileGame(EXE, game)).toBe(false);

        expect(linkFor(TUPAC)).toMatchObject({
          gameName: "Real Tupac",
          communitySuggestionStatus: "rejected",
          communitySuggestionNote: "Not this game",
        });
        expect(linkFor(SOLITAIRE)?.communitySuggestionStatus).toBeUndefined();
      });

      it("shows the approval on that folder only", async () => {
        addCustomGame(EXE, "Solitaire", SOLITAIRE);
        const game = addDatabaseGameLocally(EXE, TUPAC, REAL_TUPAC);
        await sendSharedFileGame(EXE, game);

        useAppStore.setState((state) =>
          applyContributionMarkers(
            {
              exeCache: state.exeCache,
              scopedExeLinks: state.scopedExeLinks,
            },
            [
              {
                platform: "windows",
                kind: "exe",
                value: EXE,
                gameId: 900,
                gameName: "Real Tupac",
                coverUrl: "real",
                status: "verified",
                createdAt: "2026-11-17T00:00:00.000Z",
              },
            ],
          ),
        );

        expect(linkFor(TUPAC)).toMatchObject({
          communitySuggestionStatus: "verified",
          communitySuggestionVerified: true,
        });
        expect(linkFor(SOLITAIRE)?.communitySuggestionStatus).toBeUndefined();
        expectNoNameLink();
      });

      it("offers the player's own game once when the server offers it back", async () => {
        addDatabaseGameLocally(EXE, TUPAC, REAL_TUPAC);
        // Approved, the pair comes back as a community game for the file.
        serverAmbiguous = [
          {
            id: 900,
            igdbId: 77,
            name: "Real Tupac",
            coverUrl: "real",
            source: "community",
          },
        ];

        running = [process(SOLITAIRE, 21)];
        await scanProcessesNow();

        const [picker] = useAppStore.getState().ambiguousMatches;
        expect(picker?.exePath).toBe(SOLITAIRE);
        expect(picker?.candidates).toEqual([
          expect.objectContaining({ name: "Real Tupac", source: "custom" }),
        ]);
      });

      it("sends nothing for a game the player only named", async () => {
        addCustomGame(EXE, "Tupac", TUPAC);
        const tupac = linkFor(TUPAC)!;

        expect(
          await sendSharedFileGame(EXE, { id: tupac.gameId, source: "custom" }),
        ).toBe(false);

        expect(suggestionsSent()).toEqual([]);
      });

      it(`keeps "It's software" for a ${EXE} on this PC`, async () => {
        expect(
          await markExecutableAsSoftware(EXE, {
            name: "Script Extender",
            share: true,
          }),
        ).toEqual({ kind: "local" });

        expect(suggestionsSent()).toEqual([]);
      });

      it("sends nothing offline; the folder link stays", async () => {
        useAppStore.setState({
          backendHealth: { status: "offline", checkedAt: null, detail: null },
        });
        const game = addDatabaseGameLocally(EXE, TUPAC, REAL_TUPAC);

        expect(await sendSharedFileGame(EXE, game)).toBe(false);

        expect(suggestionsSent()).toEqual([]);
        expect(linkFor(TUPAC)).toMatchObject({ gameName: "Real Tupac" });
        expect(linkFor(TUPAC)?.shareState).toBeUndefined();
      });
    });
  },
);

/* A game that brings its own Java, next to Minecraft ────────────────────────
   From a bug report: Age of History III runs javaw.exe from its own jre\bin
   and was counted as Minecraft, whose launcher runs javaw.exe from its
   runtime folder. Paths as the two install them. */

describe("Minecraft and a game that brings its own Java", () => {
  const MINECRAFT_JAVA = String.raw`C:\Users\Phil\AppData\Roaming\.minecraft\runtime\java-runtime-gamma\windows-x64\java-runtime-gamma\bin\javaw.exe`;
  const AOH3_JAVA = String.raw`D:\SteamLibrary\steamapps\common\Age of History 3\jre\bin\javaw.exe`;
  const MINECRAFT = igdbGame(1, "Minecraft: Java Edition");
  const AOH3 = igdbGame(2, "Age of History III");

  /** The picker's entry for Minecraft, if it offers one. */
  function offeredMinecraft() {
    return useAppStore
      .getState()
      .ambiguousMatches[0]?.candidates.find(
        (game) => game.name === MINECRAFT.name,
      );
  }

  it("counts both apart after one question", async () => {
    // The server knows javaw.exe for many games.
    serverAmbiguous = [MINECRAFT, igdbGame(3, "Slay the Spire")];
    running = [process(MINECRAFT_JAVA, 1)];
    await scanProcessesNow();
    selectAmbiguousMatch("javaw.exe", MINECRAFT);
    expect(activeGameNames()).toEqual(["Minecraft: Java Edition"]);

    // Age of History III starts: it asks instead of counting Minecraft.
    running = [process(MINECRAFT_JAVA, 1), process(AOH3_JAVA, 2)];
    await scanProcessesNow();
    expect(activeGameNames()).toEqual(["Minecraft: Java Edition"]);
    expect(useAppStore.getState().ambiguousMatches).toEqual([
      expect.objectContaining({ exePath: AOH3_JAVA }),
    ]);

    // Found through the search.
    selectAmbiguousMatch("javaw.exe", AOH3);
    expect(activeGameNames()).toEqual([
      "Minecraft: Java Edition",
      "Age of History III",
    ]);

    // From then on each starts as itself, without a question.
    running = [];
    await scanProcessesNow();
    running = [process(AOH3_JAVA, 3)];
    await scanProcessesNow();
    expect(activeGameNames()).toEqual(["Age of History III"]);
    running = [process(MINECRAFT_JAVA, 4)];
    await scanProcessesNow();
    expect(activeGameNames()).toEqual(["Minecraft: Java Edition"]);
    expect(useAppStore.getState().ambiguousMatches).toEqual([]);
  });

  describe("an old save that counts every javaw.exe as Minecraft", () => {
    const MINECRAFT_HOUR = {
      id: 1,
      gameId: 1,
      igdbId: 1,
      gameName: "Minecraft: Java Edition",
      coverUrl: "cover",
      source: "igdb",
      exeName: "javaw.exe",
      startedAt: "2026-10-01T10:00:00.000Z",
      endedAt: "2026-10-01T11:00:00.000Z",
      durationSeconds: 3600,
    };

    function loadOldSave(values: Record<string, unknown>) {
      save({
        exeCache: [
          {
            exeName: "javaw.exe",
            state: "matched",
            gameId: 1,
            igdbId: 1,
            gameName: "Minecraft: Java Edition",
            coverUrl: "cover",
            source: "igdb",
            lastCheckedAt: "2026-10-01T00:00:00.000Z",
          },
        ],
        sessions: [MINECRAFT_HOUR],
        ...values,
      });
      hydrate();
    }

    it("moves it to the Java game that ran last; Wrong game fixes a wrong one, the hours stay", async () => {
      // Age of History III ran last and was counted as Minecraft.
      loadOldSave({
        launchTargets: [
          {
            exeName: "javaw.exe",
            path: AOH3_JAVA,
            owner: { gameId: 1, source: "igdb" },
          },
        ],
      });
      running = [process(AOH3_JAVA, 1)];
      await scanProcessesNow();
      expect(activeGameNames()).toEqual(["Minecraft: Java Edition"]);

      const [session] = useAppStore.getState().activeSessions;
      correctRunningGenericExe(session, {
        igdbId: 2,
        name: "Age of History III",
        coverUrl: "cover",
      });
      expect(activeGameNames()).toEqual(["Age of History III"]);

      // Minecraft's own Java asks once and offers the Minecraft with the hours.
      running = [];
      await scanProcessesNow();
      running = [process(MINECRAFT_JAVA, 2)];
      await scanProcessesNow();
      expect(activeGameNames()).toEqual([]);
      expect(offeredMinecraft()).toMatchObject({ id: 1, source: "igdb" });

      selectAmbiguousMatch("javaw.exe", offeredMinecraft()!);
      expect(useAppStore.getState().activeSessions).toEqual([
        expect.objectContaining({ gameId: 1, source: "igdb" }),
      ]);
      expect(useAppStore.getState().recentSessions).toContainEqual(
        expect.objectContaining({ id: 1, gameId: 1, durationSeconds: 3600 }),
      );
    });

    it.each([
      [
        "Remember launch paths is off",
        { settings: { rememberLaunchPaths: false } },
      ],
      ["a backup brought no paths", {}],
      [
        "the remembered file is another game's",
        {
          launchTargets: [
            {
              exeName: "javaw.exe",
              path: AOH3_JAVA,
              owner: { gameId: 2, source: "igdb" },
            },
          ],
        },
      ],
    ])(
      "drops it when %s; Minecraft keeps its hours",
      async (_label, values) => {
        loadOldSave(values);
        expect(
          useAppStore.getState().exeCache.get("javaw.exe")?.state,
        ).not.toBe("matched");
        expect(useAppStore.getState().recentSessions).toEqual([
          expect.objectContaining({ id: 1, gameId: 1, durationSeconds: 3600 }),
        ]);

        // Age of History III asks instead of counting Minecraft.
        running = [process(AOH3_JAVA, 1)];
        await scanProcessesNow();
        expect(activeGameNames()).toEqual([]);
        selectAmbiguousMatch("javaw.exe", AOH3);
        running = [];
        await scanProcessesNow();

        // Minecraft asks once and offers the Minecraft with the hours.
        running = [process(MINECRAFT_JAVA, 2)];
        await scanProcessesNow();
        expect(activeGameNames()).toEqual([]);
        expect(offeredMinecraft()).toMatchObject({ id: 1, source: "igdb" });

        selectAmbiguousMatch("javaw.exe", offeredMinecraft()!);
        expect(useAppStore.getState().activeSessions).toEqual([
          expect.objectContaining({ gameId: 1, source: "igdb" }),
        ]);
      },
    );
  });
});

/* A file the admin panel marks "Per folder", fetched at the start of the app
   (docs/per-folder-list-plan.md). Skyrim Special Edition and Enderal SE both
   run SkyrimSE.exe, each from its own folder. The Steam folders are from
   memory, not read from a real install. */
describe("SkyrimSE.exe once the admin panel marks it per folder", () => {
  const SKYRIM = String.raw`C:\Program Files (x86)\Steam\steamapps\common\Skyrim Special Edition\SkyrimSE.exe`;
  const ENDERAL = String.raw`C:\Program Files (x86)\Steam\steamapps\common\Enderal Special Edition\SkyrimSE.exe`;
  const SKYRIM_GAME = igdbGame(
    1,
    "The Elder Scrolls V: Skyrim Special Edition",
  );
  const ENDERAL_GAME = igdbGame(
    2,
    "Enderal: Forgotten Stories - Special Edition",
  );
  const SKYRIM_HOUR = {
    id: 1,
    gameId: 1,
    igdbId: 1,
    gameName: SKYRIM_GAME.name,
    coverUrl: "cover",
    source: "igdb",
    exeName: "SkyrimSE.exe",
    startedAt: "2026-11-01T10:00:00.000Z",
    endedAt: "2026-11-01T11:00:00.000Z",
    durationSeconds: 3600,
  };
  const SKYRIM_PLAY_FILE = {
    launchTargets: [
      {
        exeName: "SkyrimSE.exe",
        path: SKYRIM,
        owner: { gameId: 1, source: "igdb" },
      },
    ],
  };

  /** A save from before the list: SkyrimSE.exe is Skyrim's by name, for
   *  every copy on the PC. */
  function loadSave(values: Record<string, unknown> = {}) {
    save({
      exeCache: [
        {
          exeName: "SkyrimSE.exe",
          state: "matched",
          gameId: 1,
          igdbId: 1,
          gameName: SKYRIM_GAME.name,
          coverUrl: "cover",
          source: "igdb",
          lastCheckedAt: "2026-11-01T00:00:00.000Z",
        },
      ],
      sessions: [SKYRIM_HOUR],
      ...values,
    });
    hydrate();
  }

  function nameLink() {
    return useAppStore.getState().exeCache.get("skyrimse.exe");
  }

  function perFolderRequests() {
    return vi
      .mocked(fetch)
      .mock.calls.filter(([url]) =>
        String(url).endsWith("/api/identifiers/per-folder"),
      );
  }

  function communityCalls() {
    return vi
      .mocked(fetch)
      .mock.calls.filter(([url]) => String(url).includes("/api/community/"));
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it("tracks Skyrim and Enderal as two games, with their hours apart", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-17T18:00:00.000Z"));
    serverPerFolder = ["skyrimse.exe"];
    await refreshPerFolderFiles("startup");
    // The server knows one game for the file; the flag makes it ask.
    serverAmbiguous = [SKYRIM_GAME];
    running = [process(SKYRIM, 1)];
    await scanProcessesNow();
    selectAmbiguousMatch("SkyrimSE.exe", SKYRIM_GAME);

    running = [process(SKYRIM, 1), process(ENDERAL, 2)];
    await scanProcessesNow();
    expect(activeGameNames()).toEqual([SKYRIM_GAME.name]);
    expect(useAppStore.getState().ambiguousMatches).toEqual([
      expect.objectContaining({ exePath: ENDERAL }),
    ]);
    selectAmbiguousMatch("SkyrimSE.exe", ENDERAL_GAME);
    expect(activeGameNames()).toEqual([SKYRIM_GAME.name, ENDERAL_GAME.name]);

    // An hour played, PlayCounter awake all along (sleepGap.ts).
    vi.setSystemTime(new Date("2026-11-17T19:00:00.000Z"));
    resetSleepWatch();
    running = [];
    await scanProcessesNow();
    const hours = useAppStore
      .getState()
      .recentSessions.map((session) => [session.gameId, session.gameName]);
    expect(hours).toEqual(
      expect.arrayContaining([
        [1, SKYRIM_GAME.name],
        [2, ENDERAL_GAME.name],
      ]),
    );

    // From then on each starts as itself, without a question.
    running = [process(ENDERAL, 3)];
    await scanProcessesNow();
    expect(activeGameNames()).toEqual([ENDERAL_GAME.name]);
    running = [];
    await scanProcessesNow();
    running = [process(SKYRIM, 4)];
    await scanProcessesNow();
    expect(activeGameNames()).toEqual([SKYRIM_GAME.name]);
    expect(useAppStore.getState().ambiguousMatches).toEqual([]);
  });

  describe("when the list names it while the app runs", () => {
    it("moves Skyrim's name link to the folder of its Play file, and saves that", async () => {
      loadSave(SKYRIM_PLAY_FILE);
      expect(nameLink()?.state).toBe("matched");

      serverPerFolder = ["skyrimse.exe"];
      await refreshPerFolderFiles("startup");

      expect(nameLink()?.state).not.toBe("matched");
      expect(linkFor(SKYRIM)).toMatchObject({
        gameId: 1,
        gameName: SKYRIM_GAME.name,
      });
      hydrate();
      expect(linkFor(SKYRIM)).toMatchObject({ gameId: 1 });

      // Enderal asks instead of counting as Skyrim.
      running = [process(ENDERAL, 1)];
      await scanProcessesNow();
      expect(activeGameNames()).toEqual([]);
      expect(useAppStore.getState().ambiguousMatches[0]?.exePath).toBe(ENDERAL);
    });

    it("drops a name link without a Play file; Skyrim keeps its hours and is offered first", async () => {
      loadSave();

      serverPerFolder = ["skyrimse.exe"];
      await refreshPerFolderFiles("startup");

      expect(nameLink()?.state).not.toBe("matched");
      expect(useAppStore.getState().recentSessions).toEqual([
        expect.objectContaining({ id: 1, gameId: 1, durationSeconds: 3600 }),
      ]);
      serverAmbiguous = [ENDERAL_GAME, SKYRIM_GAME];
      running = [process(ENDERAL, 1)];
      await scanProcessesNow();
      expect(activeGameNames()).toEqual([]);
      const picker = useAppStore.getState().ambiguousMatches[0];
      expect(picker?.exePath).toBe(ENDERAL);
      expect(picker?.candidates[0]).toMatchObject({
        id: 1,
        name: SKYRIM_GAME.name,
      });
    });

    // With launch paths remembered, a running Skyrim has its Play file, and
    // its link moves to that folder at once (the test above).
    it("leaves a running Skyrim without a Play file on its name link until the next start", async () => {
      loadSave({ settings: { rememberLaunchPaths: false } });
      running = [process(SKYRIM, 1)];
      await scanProcessesNow();
      expect(activeGameNames()).toEqual([SKYRIM_GAME.name]);

      serverPerFolder = ["skyrimse.exe"];
      await refreshPerFolderFiles("startup");

      expect(nameLink()?.state).toBe("matched");
      expect(activeGameNames()).toEqual([SKYRIM_GAME.name]);

      running = [];
      await scanProcessesNow();
      hydrate();
      expect(nameLink()?.state).not.toBe("matched");
      running = [process(ENDERAL, 2)];
      await scanProcessesNow();
      expect(activeGameNames()).toEqual([]);
    });
  });

  it("keeps SkyrimSE.exe as software on this PC", async () => {
    setPerFolderFiles(["skyrimse.exe"]);
    useAppStore.setState({
      installUuid: "550e8400-e29b-41d4-a716-446655440000",
    });

    expect(
      await markExecutableAsSoftware("SkyrimSE.exe", {
        name: "Skyrim Script Extender",
        share: true,
      }),
    ).toEqual({ kind: "local" });
    expect(communityCalls()).toEqual([]);
  });

  describe("fetching the list at the start", () => {
    it("follows the server when Phil removes the name", async () => {
      setPerFolderFiles(["skyrimse.exe"]);
      serverPerFolder = [];

      await refreshPerFolderFiles("startup");

      expect(isGenericExeName("SkyrimSE.exe")).toBe(false);
    });

    it("keeps the saved list when the request fails", async () => {
      setPerFolderFiles(["skyrimse.exe"]);
      serverPerFolder = "fails";

      await refreshPerFolderFiles("startup");

      expect(perFolderRequests()).toHaveLength(1);
      expect(isGenericExeName("SkyrimSE.exe")).toBe(true);
    });

    it("asks nothing while the server is offline and keeps the saved list", async () => {
      setPerFolderFiles(["skyrimse.exe"]);
      useAppStore.setState({
        backendHealth: { status: "offline", checkedAt: null, detail: null },
      });

      await refreshPerFolderFiles("startup");

      expect(perFolderRequests()).toEqual([]);
      expect(isGenericExeName("SkyrimSE.exe")).toBe(true);
    });
  });
});
