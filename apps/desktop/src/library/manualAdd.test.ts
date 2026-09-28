// @vitest-environment happy-dom
import type {
  Game,
  LibraryKnownExecutable,
  MatchProcessesResponse,
} from "@playcounter/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore, type GameMetadata } from "../store";
import {
  linkGameFileByHand,
  linkServerKnownFiles,
  untrackGame,
} from "../tracker";
import { knownGameFiles } from "./knownGameFiles";
import {
  addAndShareGameFile,
  addGameWithoutFile,
  checkGameFile,
  type GameFile,
} from "./manualAdd";
import { scopedExeLinkKey } from "./scopedLinks";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
  convertFileSrc: (value: string) => value,
}));

type MatchEntry = MatchProcessesResponse["matches"][number];

const HADES: GameMetadata = {
  id: 1,
  igdbId: 100,
  name: "Hades",
  coverUrl: "hades.jpg",
  source: "igdb",
};
const HADES_II: Game = {
  id: 2,
  igdbId: 200,
  name: "Hades II",
  coverUrl: "hades2.jpg",
  source: "igdb",
};
const CELESTE: Game = {
  id: 3,
  igdbId: 300,
  name: "Celeste",
  coverUrl: "celeste.jpg",
  source: "igdb",
};
const HADES_EXE = "D:\\Games\\Hades\\Hades.exe";
const HADES_FILE: GameFile = { exeName: "Hades.exe", exePath: HADES_EXE };
const NOW = "2026-09-28T10:00:00.000Z";

let sequence = 0;
let fetchMock: ReturnType<typeof vi.fn>;
/** The files the server knows for every game it is asked about. */
let known: LibraryKnownExecutable[] = [];

function exe(value: string, extra: Partial<LibraryKnownExecutable> = {}) {
  return {
    platform: "windows",
    kind: "exe",
    value,
    provenance: "community",
    verified: true,
    ...extra,
  } satisfies LibraryKnownExecutable;
}

/** The server's answer for the picked file and for a community suggestion. */
function serve(
  match: Partial<MatchEntry> | null,
  suggestion: { status?: number; body: unknown } = {
    body: { id: 55, verified: false },
  },
) {
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/api/match-processes")) {
      const body = JSON.parse(String(init?.body)) as {
        processes: { key: string }[];
      };
      return Response.json({
        matches: match
          ? body.processes.map((process) => ({
              key: process.key,
              game: null,
              ...match,
            }))
          : [],
      });
    }
    if (url.endsWith("/api/community/suggestions")) {
      return Response.json(suggestion.body, {
        status: suggestion.status ?? 200,
      });
    }
    const games = [HADES, HADES_II, CELESTE];
    if (url.endsWith("/api/library/reverse-resolve")) {
      const { gameId } = JSON.parse(String(init?.body)) as { gameId: number };
      const game = games.find((item) => item.id === gameId);
      return game
        ? Response.json({ game, executables: known })
        : Response.json({ error: "Game not found" }, { status: 404 });
    }
    if (url.includes("/api/games/search")) {
      const query = new URL(url).searchParams.get("query");
      return Response.json({
        games: games.filter((item) => String(item.igdbId) === query),
      });
    }
    return Response.json({ error: "not found" }, { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
}

function matched(exeName: string, game: Game, extra = {}) {
  return {
    exeName,
    state: "matched" as const,
    gameId: game.id,
    igdbId: game.igdbId,
    gameName: game.name,
    coverUrl: game.coverUrl,
    source: game.source,
    lastCheckedAt: NOW,
    ...extra,
  };
}

/** What a refused file must leave untouched. */
function writtenState() {
  const state = useAppStore.getState();
  return {
    exeCache: [...state.exeCache],
    scopedExeLinks: [...state.scopedExeLinks],
    launchTargets: [...state.launchTargets],
    playcounterLibrary: [...state.playcounterLibrary],
  };
}

beforeEach(() => {
  localStorage.clear();
  useAppStore.setState(useAppStore.getInitialState(), true);
  useAppStore.setState({
    settings: {
      ...useAppStore.getState().settings,
      apiEndpoint: `https://manual-add-${sequence++}.example`,
    },
  });
  known = [];
  serve(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("adding a game without a file", () => {
  it("writes one library entry, and adding it again writes nothing", () => {
    expect(addGameWithoutFile(HADES)).toBe(true);
    expect(addGameWithoutFile(HADES)).toBe(false);

    const entries = [...useAppStore.getState().playcounterLibrary.values()];
    expect(entries).toEqual([
      expect.objectContaining({
        gameId: 1,
        igdbId: 100,
        source: "igdb",
        name: "Hades",
        coverUrl: "hades.jpg",
      }),
    ]);
    expect(Number.isFinite(Date.parse(entries[0].addedAt))).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("is removed again by Remove", () => {
    addGameWithoutFile(HADES);
    untrackGame(HADES.id, HADES.source, false);
    expect(useAppStore.getState().playcounterLibrary.size).toBe(0);
  });
});

describe("linking the server's known files", () => {
  it("links them by name with who knows them, but not one that counts for another game", async () => {
    addGameWithoutFile(HADES);
    useAppStore.getState().setExeCacheEntry(matched("Shared.exe", CELESTE));
    known = [exe("Hades.exe"), exe("Shared.exe", { provenance: "igdb" })];
    await linkServerKnownFiles(HADES);

    const exeCache = useAppStore.getState().exeCache;
    expect(exeCache.get("hades.exe")).toMatchObject({
      state: "matched",
      gameId: 1,
      igdbId: 100,
      // The community knows the file: the badge is not the IGDB metadata.
      source: "igdb",
      identifierSource: "community",
    });
    expect(exeCache.get("shared.exe")).toMatchObject({ gameId: 3 });
  });

  it("finds a game named on this PC by its IGDB id", async () => {
    linkGameFileByHand(
      { exeName: "Game.exe", exePath: "D:\\Games\\Hades\\Game.exe" },
      HADES,
      "own",
    );
    known = [exe("Hades.exe", { provenance: "igdb" })];
    await linkServerKnownFiles({ id: -5, igdbId: 100, source: "custom" });

    expect(useAppStore.getState().exeCache.get("hades.exe")).toMatchObject({
      gameId: 1,
      identifierSource: "igdb",
    });
  });

  it("leaves a game alone that is no longer in the library", async () => {
    known = [exe("Hades.exe")];
    await linkServerKnownFiles(HADES);
    expect(useAppStore.getState().exeCache.has("hades.exe")).toBe(false);
  });

  it("changes nothing when the lookup fails", async () => {
    addGameWithoutFile(HADES);
    known = [exe("Hades.exe")];
    await linkServerKnownFiles({ id: 99, igdbId: 100, source: "igdb" });
    expect(useAppStore.getState().exeCache.size).toBe(0);
  });

  it("uses only the files a launcher import links by name", () => {
    useAppStore.setState({ ignoredProcesses: new Set(["ignored.exe"]) });
    expect(
      knownGameFiles([
        exe("THAW.exe"),
        exe("thaw.exe"),
        exe("Hades.exe", { provenance: "igdb" }),
        exe("hades.exe"),
        exe("Unverified.exe", { verified: false }),
        exe("Shared.exe", { ambiguous: true }),
        exe("Game.exe"),
        exe("Ignored.exe"),
        exe("thaw", { platform: "linux" }),
        exe("123", { kind: "steam_app_id" }),
      ]),
    ).toEqual([
      { exeName: "THAW.exe", identifierSource: "community" },
      // Known to both: IGDB wins, as in a launcher import.
      { exeName: "Hades.exe", identifierSource: "igdb" },
    ]);
  });
});

describe("checking a picked file", () => {
  it.each(["Hades.exe", "D:\\Games\\Hades\\readme.txt", "..\\Hades.exe"])(
    "refuses %s as not a full path to an .exe",
    async (path) => {
      expect((await checkGameFile(path, HADES)).kind).toBe("invalid");
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["the built-in ignore list", { ignoredProcesses: new Set(["hades.exe"]) }],
    ["the user's ignore list", { blacklist: new Set(["hades.exe"]) }],
    [
      "an ignored cache entry",
      {
        exeCache: new Map([
          [
            "hades.exe",
            {
              exeName: "Hades.exe",
              state: "blacklisted" as const,
              lastCheckedAt: NOW,
            },
          ],
        ]),
      },
    ],
  ])("refuses a file on %s", async (_label, patch) => {
    useAppStore.setState(patch);
    expect((await checkGameFile(HADES_EXE, HADES)).kind).toBe("ignored");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses Game.exe in an ignored folder but not in another folder", async () => {
    useAppStore.setState({
      ignoredExeFolders: new Map([
        [
          "game.exe|d:\\games\\junk",
          {
            exeName: "Game.exe",
            pathPrefix: "D:\\Games\\Junk",
            ignoredAt: NOW,
          },
        ],
      ]),
    });
    serve({});
    expect((await checkGameFile("D:\\Games\\Junk\\Game.exe", HADES)).kind).toBe(
      "ignored",
    );
    expect(
      (await checkGameFile("D:\\Games\\Hades\\Game.exe", HADES)).kind,
    ).toBe("link");
  });

  it("refuses software known on this PC or on the server", async () => {
    useAppStore.setState({
      exeCache: new Map([
        [
          "code.exe",
          {
            exeName: "Code.exe",
            state: "tool",
            gameName: "Visual Studio Code",
            lastCheckedAt: NOW,
          },
        ],
      ]),
    });
    expect(
      await checkGameFile("C:\\Apps\\VS Code\\Code.exe", HADES),
    ).toMatchObject({ kind: "software", name: "Visual Studio Code" });
    expect(fetchMock).not.toHaveBeenCalled();

    serve({ game: { ...HADES_II, name: "Steam", kind: "tool" } });
    expect(
      await checkGameFile("C:\\Program Files\\Steam\\steam.exe", HADES),
    ).toMatchObject({ kind: "software", name: "Steam" });
    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(body.supportsTools).toBe(true);
  });

  it("refuses a file that already counts for another game, by name or by folder", async () => {
    useAppStore.setState({
      exeCache: new Map([["hades.exe", matched("Hades.exe", CELESTE)]]),
    });
    expect(await checkGameFile(HADES_EXE, HADES)).toMatchObject({
      kind: "taken",
      game: { name: "Celeste" },
    });

    const link = {
      exeName: "Game.exe",
      pathPrefix: "D:\\Games\\Celeste",
      exePath: "D:\\Games\\Celeste\\Game.exe",
      gameId: CELESTE.id,
      igdbId: CELESTE.igdbId,
      source: CELESTE.source,
      gameName: CELESTE.name,
      coverUrl: CELESTE.coverUrl,
      setAt: NOW,
    };
    useAppStore.setState({
      exeCache: new Map(),
      scopedExeLinks: new Map([
        [scopedExeLinkKey(link.exeName, link.pathPrefix)!, link],
      ]),
    });
    expect(
      (await checkGameFile("D:\\Games\\Celeste\\Game.exe", HADES)).kind,
    ).toBe("taken");
    expect(fetchMock).not.toHaveBeenCalled();
    // Another folder's Game.exe is free.
    serve({});
    expect(
      (await checkGameFile("D:\\Games\\Hades\\Game.exe", HADES)).kind,
    ).toBe("link");
  });

  it("only needs Play for a file that already counts for the same game", async () => {
    const custom = { ...HADES, id: -5, source: "custom" as const };
    useAppStore.setState({
      exeCache: new Map([["hades.exe", matched("Hades.exe", custom)]]),
    });
    expect(await checkGameFile(HADES_EXE, HADES)).toMatchObject({
      kind: "same",
      game: { id: -5, source: "custom" },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each<[string, Partial<MatchEntry>, string]>([
    ["names the same game", { game: HADES }, "link"],
    ["names another game", { game: HADES_II }, "other"],
    ["is unsure", { ambiguousGames: [HADES_II, CELESTE] }, "link"],
    [
      "flags the name as shared",
      { game: HADES_II, flaggedIdentifier: { reason: "ambiguous" } },
      "link",
    ],
    ["does not know the file", {}, "share"],
  ])("follows the server when it %s", async (_label, match, kind) => {
    serve(match);
    const check = await checkGameFile(HADES_EXE, HADES);
    expect(check.kind).toBe(kind);
    if (check.kind === "other") expect(check.game).toEqual(HADES_II);
  });

  it("links the server's own game, so a community file is not badged IGDB", async () => {
    serve({ game: { ...HADES, id: 130, source: "community" } });
    expect(await checkGameFile(HADES_EXE, HADES)).toMatchObject({
      kind: "link",
      game: { id: 130, source: "community" },
    });
  });

  it("never shares or asks about Game.exe: the user's pick wins", async () => {
    serve({ game: HADES_II });
    expect(
      await checkGameFile("D:\\Games\\Hades\\Game.exe", HADES),
    ).toMatchObject({ kind: "link", game: undefined });
    serve({});
    expect(
      await checkGameFile("D:\\Games\\Hades\\Game.exe", HADES),
    ).toMatchObject({ kind: "link", game: undefined });
  });

  it.each<[string, Partial<MatchEntry>]>([
    ["Game.exe", { ambiguousGames: [HADES_II, HADES] }],
    ["Hades.exe", { ambiguousGames: [HADES_II, HADES] }],
    ["Hades.exe", { game: HADES, flaggedIdentifier: { reason: "ambiguous" } }],
  ])(
    "links the server's entry when it lists %s for this game among others",
    async (exeName, match) => {
      serve(match);
      expect(
        await checkGameFile(`D:\\Games\\Hades\\${exeName}`, HADES),
      ).toMatchObject({ kind: "link", game: { id: 1, source: "igdb" } });
    },
  );

  it("writes nothing while checking", async () => {
    addGameWithoutFile(HADES);
    const before = writtenState();
    for (const match of [{ game: HADES }, { game: HADES_II }, {}]) {
      serve(match);
      await checkGameFile(HADES_EXE, HADES);
    }
    expect(writtenState()).toEqual(before);
  });
});

describe("linking a picked file", () => {
  it("links the file to the game and gives Play the picked file over an older one", () => {
    useAppStore.setState({
      launchTargets: new Map([
        [
          "hades.exe",
          {
            exeName: "Hades.exe",
            path: "C:\\Old\\Hades.exe",
            owner: { gameId: 1, source: "igdb" },
          },
        ],
      ]),
    });
    linkGameFileByHand(HADES_FILE, HADES, "link");
    const state = useAppStore.getState();
    expect(state.exeCache.get("hades.exe")).toMatchObject({
      state: "matched",
      gameId: 1,
      igdbId: 100,
      source: "igdb",
    });
    expect(state.launchTargets.get("hades.exe")).toEqual({
      exeName: "Hades.exe",
      path: HADES_EXE,
      owner: { gameId: 1, source: "igdb" },
    });
  });

  it("links the other game when the user takes the server's game", () => {
    linkGameFileByHand(HADES_FILE, HADES_II, "link");
    expect(useAppStore.getState().exeCache.get("hades.exe")).toMatchObject({
      gameId: 2,
      gameName: "Hades II",
    });
  });

  it("keeps the existing link and only sets Play for the same game", () => {
    const custom = { ...HADES, id: -5, source: "custom" as const };
    const entry = matched("Hades.exe", custom, { communitySuggestionId: 9 });
    useAppStore.setState({ exeCache: new Map([["hades.exe", entry]]) });
    linkGameFileByHand(HADES_FILE, custom, "play");
    const state = useAppStore.getState();
    expect(state.exeCache.get("hades.exe")).toMatchObject({
      gameId: -5,
      source: "custom",
      communitySuggestionId: 9,
    });
    expect(state.launchTargets.get("hades.exe")).toMatchObject({
      path: HADES_EXE,
      owner: { gameId: -5, source: "custom" },
    });
  });

  it("marks the user's own pick as Custom, by name or by folder", () => {
    linkGameFileByHand(HADES_FILE, HADES, "own");
    linkGameFileByHand(
      { exeName: "Game.exe", exePath: "D:\\Games\\Hades\\Game.exe" },
      HADES,
      "own",
    );
    const state = useAppStore.getState();
    expect(state.exeCache.get("hades.exe")).toMatchObject({
      gameId: 1,
      source: "igdb",
      identifierSource: "custom",
    });
    expect([...state.scopedExeLinks.values()]).toEqual([
      expect.objectContaining({
        exeName: "Game.exe",
        gameId: 1,
        identifierSource: "custom",
      }),
    ]);
  });

  it("links Game.exe to its folder only, with Play on the folder link", () => {
    const file = {
      exeName: "Game.exe",
      exePath: "D:\\Games\\Hades\\Game.exe",
    };
    linkGameFileByHand(file, HADES, "link");
    const state = useAppStore.getState();
    expect(state.exeCache.has("game.exe")).toBe(false);
    expect(state.launchTargets.has("game.exe")).toBe(false);
    expect([...state.scopedExeLinks.values()]).toEqual([
      expect.objectContaining({
        exeName: "Game.exe",
        pathPrefix: "D:\\Games\\Hades",
        exePath: file.exePath,
        gameId: 1,
        igdbId: 100,
      }),
    ]);
  });

  it("moves time from a file waiting in Discovered to the game", () => {
    useAppStore.setState({
      exeCache: new Map([
        [
          "hades.exe",
          {
            exeName: "Hades.exe",
            state: "unmatched",
            trackedSeconds: 1200,
            lastCheckedAt: NOW,
          },
        ],
      ]),
    });
    linkGameFileByHand(HADES_FILE, HADES, "link");
    const state = useAppStore.getState();
    expect(state.exeCache.get("hades.exe")?.state).toBe("matched");
    expect(state.recentSessions).toEqual([
      expect.objectContaining({ gameId: 1, durationSeconds: 1200 }),
    ]);
  });
});

describe("adding and sharing an unknown file", () => {
  it("links it here, then sends it for review like a launcher import", async () => {
    serve({}, { body: { id: 55, verified: false } });
    const outcome = await addAndShareGameFile(HADES_FILE, HADES);
    expect(outcome).toEqual({ kind: "submitted" });
    const state = useAppStore.getState();
    const entry = state.exeCache.get("hades.exe");
    expect(entry).toMatchObject({
      state: "matched",
      source: "custom",
      igdbId: 100,
      gameName: "Hades",
      communitySuggestionId: 55,
      communitySuggestionStatus: "pending",
    });
    expect(state.launchTargets.get("hades.exe")).toMatchObject({
      path: HADES_EXE,
      owner: { gameId: entry?.gameId, source: "custom" },
    });
    const sent = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith("/api/community/suggestions"),
    );
    expect(JSON.parse(String(sent?.[1].body))).toMatchObject({
      exeName: "Hades.exe",
      name: "Hades",
      igdbId: 100,
    });
  });

  it("applies the database game when the server already knows the pair", async () => {
    serve({}, { body: { igdbGame: HADES } });
    expect(await addAndShareGameFile(HADES_FILE, HADES)).toEqual({
      kind: "already-known",
    });
    expect(useAppStore.getState().exeCache.get("hades.exe")).toMatchObject({
      gameId: 1,
      source: "igdb",
    });
  });

  it("keeps the local link when sending fails", async () => {
    serve({}, { status: 503, body: { error: "Unavailable" } });
    const outcome = await addAndShareGameFile(HADES_FILE, HADES);
    expect(outcome?.kind).toBe("failed");
    expect(useAppStore.getState().exeCache.get("hades.exe")).toMatchObject({
      state: "matched",
      source: "custom",
      shareState: "failed",
    });
    expect(useAppStore.getState().launchTargets.has("hades.exe")).toBe(true);
  });
});
