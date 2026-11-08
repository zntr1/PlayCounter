// @vitest-environment happy-dom
import type { LibraryKnownExecutable, Session } from "@playcounter/shared";
import { invoke } from "@tauri-apps/api/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EmulatorMapping } from "./emulators/types";
import {
  libraryEntryKey,
  type LibraryImportEntry,
  type ScopedExeLink,
} from "./library/types";
import { addGameWithoutFile } from "./library/manualAdd";
import {
  openQuickAdd,
  pickQuickAdd,
  searchQuickAdd,
  type QuickAddReply,
} from "./quickAdd";
import {
  getGameJournal,
  useAppStore,
  type ActiveSession,
  type GameMetadata,
} from "./store";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
  convertFileSrc: (value: string) => value,
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
const invokeMock = vi.mocked(invoke);

const NOW = "2026-11-08T20:00:00.000Z";
let sequence = 0;

function game(igdbId: number, name: string): GameMetadata {
  return {
    id: igdbId + 1,
    igdbId,
    name,
    coverUrl: `${name}.jpg`,
    releaseYear: 2020,
    source: "igdb",
  };
}
const HADES = game(100, "Hades");
const HADES_II = game(200, "Hades II");
const CELESTE = game(300, "Celeste");
const HOLLOW_KNIGHT = game(400, "Hollow Knight");
const OUTER_WILDS = game(500, "Outer Wilds");
const DISCO_ELYSIUM = game(600, "Disco Elysium");
const WIND_WAKER = game(700, "The Wind Waker");
const TUNIC = game(800, "Tunic");
const IGNORED = game(900, "Ignored Game");

let searchResults: GameMetadata[] | { status: number } = [];
let knownFiles: LibraryKnownExecutable[] = [];

beforeEach(() => {
  localStorage.clear();
  invokeMock.mockClear();
  useAppStore.setState(useAppStore.getInitialState(), true);
  useAppStore.setState({
    settings: {
      ...useAppStore.getState().settings,
      apiEndpoint: `https://quick-add-${sequence++}.example`,
    },
  });
  searchResults = [];
  knownFiles = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/games/search")) {
        return "status" in searchResults
          ? Response.json({ error: "down" }, { status: searchResults.status })
          : Response.json({ games: searchResults });
      }
      if (url.endsWith("/api/library/reverse-resolve")) {
        const { gameId } = JSON.parse(String(init?.body)) as {
          gameId: number;
        };
        const found = [HADES, HADES_II, TUNIC].find((g) => g.id === gameId);
        return found
          ? Response.json({ game: found, executables: knownFiles })
          : Response.json({ error: "Game not found" }, { status: 404 });
      }
      return Response.json({ error: "not found" }, { status: 404 });
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function replies(): QuickAddReply[] {
  return invokeMock.mock.calls
    .filter(([command]) => command === "quick_add_reply")
    .map(([, args]) => (args as { reply: QuickAddReply }).reply);
}
const lastReply = () => replies().at(-1);

function session(of: GameMetadata, exeName: string): Session {
  return {
    id: of.igdbId!,
    gameId: of.id,
    igdbId: of.igdbId,
    gameName: of.name,
    coverUrl: of.coverUrl,
    source: of.source,
    exeName,
    startedAt: "2026-11-01T18:00:00.000Z",
    endedAt: "2026-11-01T19:00:00.000Z",
    durationSeconds: 3600,
  };
}

function steamImport(of: GameMetadata): LibraryImportEntry {
  return {
    provider: "steam",
    externalId: "1145360",
    igdbId: of.igdbId!,
    gameId: of.id,
    source: "igdb",
    name: of.name,
    coverUrl: of.coverUrl,
    importedAt: NOW,
    providerSeconds: 7200,
    lastReadAt: NOW,
    linkedExeNames: [],
    linkedExeSources: [],
  };
}

/** One game in each place My Games reads its games from, one on the ignore
 *  list, and Tunic nowhere. */
function fillMyGames() {
  const running: ActiveSession = {
    id: 41,
    gameId: HOLLOW_KNIGHT.id,
    igdbId: HOLLOW_KNIGHT.igdbId,
    gameName: HOLLOW_KNIGHT.name,
    exeName: "hollow_knight.exe",
    coverUrl: HOLLOW_KNIGHT.coverUrl,
    source: "igdb",
    startedAt: NOW,
    checkpointedAt: NOW,
  };
  const folderLink: ScopedExeLink = {
    exeName: "disco.exe",
    pathPrefix: "d:\\games\\disco elysium\\",
    gameId: DISCO_ELYSIUM.id,
    source: "igdb",
    igdbId: DISCO_ELYSIUM.igdbId,
    gameName: DISCO_ELYSIUM.name,
    coverUrl: DISCO_ELYSIUM.coverUrl,
    setAt: NOW,
  };
  const dolphin: EmulatorMapping = {
    contentKey: "dolphin:title_id:GZLE01",
    emulatorId: "dolphin",
    label: "Dolphin",
    contentKind: "title_id",
    contentValue: "GZLE01",
    display: "GZLE01",
    trust: "recognized",
    decision: "game",
    gameId: WIND_WAKER.id,
    igdbId: WIND_WAKER.igdbId,
    gameName: WIND_WAKER.name,
    source: "igdb",
    confidence: "user",
    decidedAt: NOW,
    lastSeenAt: NOW,
  };
  useAppStore.setState({
    libraryImports: new Map([
      [libraryEntryKey("steam", "1145360"), steamImport(HADES)],
    ]),
    // Played only: no import, no Add game, its file no longer known.
    recentSessions: [
      session(CELESTE, "Celeste.exe"),
      session(IGNORED, "IgnoredGame.exe"),
    ],
    activeSessions: [running],
    userIgnoredProcesses: new Set(["ignoredgame.exe"]),
    scopedExeLinks: new Map([["disco.exe", folderLink]]),
    emulatorMappings: new Map([[dolphin.contentKey, dolphin]]),
  });
  useAppStore.getState().setExeCacheEntry({
    exeName: "OuterWilds.exe",
    state: "matched",
    gameId: OUTER_WILDS.id,
    igdbId: OUTER_WILDS.igdbId,
    gameName: OUTER_WILDS.name,
    coverUrl: OUTER_WILDS.coverUrl,
    source: "igdb",
    lastCheckedAt: NOW,
  });
  addGameWithoutFile(HADES_II);
}

describe("quick add search", () => {
  it("marks what My Games already lists, wherever the game came from", async () => {
    fillMyGames();
    searchResults = [
      HADES,
      HADES_II,
      CELESTE,
      HOLLOW_KNIGHT,
      OUTER_WILDS,
      DISCO_ELYSIUM,
      WIND_WAKER,
      TUNIC,
      IGNORED,
    ];
    await searchQuickAdd("ha");

    const reply = lastReply();
    expect(reply?.kind).toBe("results");
    const marks =
      reply?.kind === "results"
        ? Object.fromEntries(reply.games.map((g) => [g.name, g.inLibrary]))
        : {};
    expect(marks).toEqual({
      Hades: true, // imported from Steam
      "Hades II": true, // added with Add game
      Celeste: true, // only played
      "Hollow Knight": true, // running right now
      "Outer Wilds": true, // its file counts for it
      "Disco Elysium": true, // its file counts for it in one folder
      "The Wind Waker": true, // an emulator game
      Tunic: false,
      "Ignored Game": false, // only played through a file on the ignore list
    });
  });

  it("sends each match with what the box shows", async () => {
    searchResults = [TUNIC];
    await searchQuickAdd("tunic");
    expect(lastReply()).toEqual({
      kind: "results",
      query: "tunic",
      games: [
        {
          igdbId: 800,
          name: "Tunic",
          coverUrl: "Tunic.jpg",
          releaseYear: 2020,
          inLibrary: false,
        },
      ],
    });
  });

  it("sends Add game's text when the search fails", async () => {
    searchResults = { status: 503 };
    await searchQuickAdd("hades");
    expect(lastReply()).toEqual({
      kind: "error",
      query: "hades",
      message: "Game search failed (503).",
    });
  });
});

describe("quick add pick", () => {
  it("adds a game that isn't in My Games, with no status, and links its known files", async () => {
    knownFiles = [
      {
        platform: "windows",
        kind: "exe",
        value: "Tunic.exe",
        provenance: "community",
        verified: true,
      },
    ];
    searchResults = [TUNIC];
    await searchQuickAdd("tunic");
    await pickQuickAdd(800);

    expect(lastReply()).toEqual({ kind: "added", igdbId: 800 });
    const state = useAppStore.getState();
    expect([...state.playcounterLibrary.values()]).toEqual([
      expect.objectContaining({ igdbId: 800, name: "Tunic" }),
    ]);
    expect(
      getGameJournal(state, { gameId: TUNIC.id, source: "igdb", igdbId: 800 })
        .status,
    ).toBeNull();
    expect(state.exeCache.get("tunic.exe")).toEqual(
      expect.objectContaining({ state: "matched", igdbId: 800 }),
    );
  });

  it("changes nothing for a game already in My Games", async () => {
    useAppStore.setState({
      libraryImports: new Map([
        [libraryEntryKey("steam", "1145360"), steamImport(HADES)],
      ]),
    });
    useAppStore
      .getState()
      .updateGameJournal(
        { gameId: HADES.id, source: "igdb", igdbId: 100 },
        { status: "finished" },
      );
    const journals = useAppStore.getState().gameJournals;
    searchResults = [HADES];
    await searchQuickAdd("hades");
    await pickQuickAdd(100);

    expect(lastReply()).toEqual({ kind: "already", igdbId: 100 });
    const state = useAppStore.getState();
    expect(state.playcounterLibrary.size).toBe(0);
    expect(state.gameJournals).toBe(journals);
  });
});

describe("opening the box", () => {
  it("opens the quick add box while no game is running", () => {
    expect(useAppStore.getState().activeSessions).toEqual([]);
    openQuickAdd();
    expect(invokeMock).toHaveBeenCalledWith("quick_note_open", {
      payload: expect.objectContaining({ quickAdd: true }),
    });
  });
});
