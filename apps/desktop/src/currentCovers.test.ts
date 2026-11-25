// @vitest-environment happy-dom
/* Current covers: a cover IGDB replaced reaches every drawn cover, while the
   copies stored on this PC stay as they are (docs/cover-refresh-plan.md).
   The app asks about a game once and then reads the server's list of
   replaced covers: one request a start, however big the library is. */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GameCover } from "@playcounter/shared";
import {
  hydrateCurrentCovers,
  knownIgdbIds,
  refreshCurrentCovers,
  resetCurrentCoversForTests,
  startCurrentCoverRefresh,
  useCurrentCovers,
} from "./currentCovers";
import {
  coverOverride,
  markCoverUnavailable,
  useCoverUrl,
} from "./pickedCovers";
import { resetRequestPaceForTests } from "./requestPace";
import {
  useAppStore,
  type ExeCacheEntry,
  type GameIdentityRef,
  type GameMetadata,
} from "./store";
import type {
  LibraryImportEntry,
  PlayCounterLibraryEntry,
} from "./library/types";

/** What the app keeps between starts (serverCache.ts), here in memory. */
const disk = vi.hoisted(() => ({
  values: new Map<string, unknown>(),
  full: false,
}));
vi.mock("./serverCache", () => ({
  readServerCache: async (key: string) => structuredClone(disk.values.get(key)),
  writeServerCache: async (key: string, value: unknown) => {
    if (disk.full) throw new Error("disk full");
    disk.values.set(key, structuredClone(value));
  },
}));

const endpoint = "https://api.example.test";
const igdbCover = (imageId: string) =>
  `https://images.igdb.com/igdb/image/upload/t_cover_big/${imageId}.jpg`;
const oldCover = igdbCover("co_old_season");
const newCover = igdbCover("co_new_season");
const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;

type Call =
  | { route: "covers"; ids: number[] }
  | { route: "changes"; since: string | null };

/**
 * The server: a cover for every asked game (named after its id unless
 * `cover` says otherwise), and the list of replaced covers. A cursor is the
 * position in that list ("at3"); the app must hand it back as it got it.
 */
function coverServer(origin = endpoint) {
  const server = {
    cover: (igdbId: number): string | null => igdbCover(`co_${igdbId}`),
    changes: [] as GameCover[],
    pageSize: 1000,
    calls: [] as Call[],
    /** Lets this many requests through, then fails `failNext` ones. */
    failAfter: 0,
    failNext: 0,
    refuseCursors: false,
    fetch: vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      expect(url.origin).toBe(origin);
      if (server.failNext > 0) {
        if (server.failAfter > 0) server.failAfter -= 1;
        else {
          server.failNext -= 1;
          return new Response("down", { status: 500 });
        }
      }
      if (url.pathname === "/api/games/covers") {
        const ids = url.searchParams.get("igdbIds")!.split(",").map(Number);
        server.calls.push({ route: "covers", ids });
        const covers: GameCover[] = ids.flatMap((igdbId) => {
          const coverUrl = server.cover(igdbId);
          return coverUrl ? [{ igdbId, coverUrl }] : [];
        });
        return Response.json({ covers });
      }
      if (url.pathname === "/api/games/cover-changes") {
        const since = url.searchParams.get("since");
        server.calls.push({ route: "changes", since });
        if (since === null) {
          return Response.json({
            covers: [],
            next: `at${server.changes.length}`,
            more: false,
          });
        }
        if (server.refuseCursors) return new Response("?", { status: 400 });
        const from = Number(since.slice(2));
        const page = server.changes.slice(from, from + server.pageSize);
        const end = from + page.length;
        return Response.json({
          covers: page,
          next: `at${end}`,
          more: end < server.changes.length,
        });
      }
      return new Response("not found", { status: 404 });
    }),
  };
  vi.stubGlobal("fetch", server.fetch);
  return server;
}

const coverCalls = (server: { calls: Call[] }) =>
  server.calls.flatMap((call) => (call.route === "covers" ? [call.ids] : []));
const listCalls = (server: { calls: Call[] }) =>
  server.calls.flatMap((call) =>
    call.route === "changes" ? [call.since] : [],
  );
const current = () => useCurrentCovers.getState().byIgdbId;

function setCurrent(entries: Array<[number, string]>) {
  useCurrentCovers.setState({ byIgdbId: new Map(entries) });
}

/** The app closes and starts again: memory is gone, the disk is not. */
function restartApp() {
  resetCurrentCoversForTests();
  resetRequestPaceForTests();
}

beforeEach(() => {
  useAppStore.setState(useAppStore.getInitialState(), true);
  disk.values.clear();
  disk.full = false;
  restartApp();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("the first refresh on this PC", () => {
  it("asks where the list starts, then about every game once, 100 a request, then reads the list", async () => {
    const server = coverServer();
    const ids = Array.from({ length: 250 }, (_, index) => index + 1);

    await refreshCurrentCovers(ids, endpoint);

    expect(server.calls).toEqual([
      { route: "changes", since: null },
      { route: "covers", ids: ids.slice(0, 100) },
      { route: "covers", ids: ids.slice(100, 200) },
      { route: "covers", ids: ids.slice(200) },
      { route: "changes", since: "at0" },
    ]);
    expect(current().size).toBe(250);
    expect(current().get(115)).toBe(igdbCover("co_115"));
  });

  it("does not ask for games without an IGDB id or twice for one game", async () => {
    const server = coverServer();

    await refreshCurrentCovers([0, -4, Number.NaN, 2.5, 7, 7], endpoint);

    expect(coverCalls(server)).toEqual([[7]]);
  });

  it("changes nothing stored on this PC", async () => {
    const server = coverServer();
    server.cover = () => newCover;
    const entry: ExeCacheEntry = {
      exeName: "LeagueClient.exe",
      state: "matched",
      gameId: 4,
      igdbId: 115,
      gameName: "League of Legends",
      coverUrl: oldCover,
      source: "igdb",
      lastCheckedAt: new Date(0).toISOString(),
    };
    useAppStore.setState({
      exeCache: new Map([["leagueclient.exe", entry]]),
    });
    const before = useAppStore.getState();

    await refreshCurrentCovers([115], endpoint);

    const after = useAppStore.getState();
    expect(after.exeCache).toBe(before.exeCache);
    expect(after.exeCache.get("leagueclient.exe")?.coverUrl).toBe(oldCover);
    expect(after.recentSessions).toBe(before.recentSessions);
    expect(after.activeSessions).toBe(before.activeSessions);
    expect(after.gameMetadata).toBe(before.gameMetadata);
  });

  it("keeps the covers out of localStorage, where the app's own data lives", async () => {
    coverServer();
    const before = JSON.stringify(localStorage);

    await refreshCurrentCovers([115, 8042], endpoint);

    expect(JSON.stringify(localStorage)).toBe(before);
    expect(disk.values.size).toBe(1);
  });
});

describe("every later refresh", () => {
  it("sends one request, however big the library is", async () => {
    vi.useFakeTimers();
    const server = coverServer();
    const ids = Array.from({ length: 3000 }, (_, index) => index + 1);
    const first = refreshCurrentCovers(ids, endpoint);
    await vi.advanceTimersByTimeAsync(3 * MINUTE);
    await first;
    server.calls.length = 0;

    await refreshCurrentCovers(ids, endpoint);

    expect(server.calls).toEqual([{ route: "changes", since: "at0" }]);
  });

  it("League gets a new cover: the list brings it, and games of other players are left out", async () => {
    const server = coverServer();
    server.cover = () => oldCover;
    await refreshCurrentCovers([115], endpoint);
    expect(current().get(115)).toBe(oldCover);

    server.changes.push(
      { igdbId: 999, coverUrl: igdbCover("co_someone_elses_game") },
      { igdbId: 115, coverUrl: newCover },
    );
    await refreshCurrentCovers([115], endpoint);

    expect(current().get(115)).toBe(newCover);
    expect(current().has(999)).toBe(false);
    expect(coverCalls(server)).toEqual([[115]]);
  });

  it("a game added to the library is asked about once", async () => {
    const server = coverServer();
    await refreshCurrentCovers([115], endpoint);

    await refreshCurrentCovers([115, 8042], endpoint);
    await refreshCurrentCovers([115, 8042], endpoint);

    expect(coverCalls(server)).toEqual([[115], [8042]]);
    expect(current().get(8042)).toBe(igdbCover("co_8042"));
  });

  it("a game the server has no cover for is not asked about again, until the list names it", async () => {
    const server = coverServer();
    server.cover = () => null;
    await refreshCurrentCovers([7], endpoint);
    await refreshCurrentCovers([7], endpoint);

    expect(coverCalls(server)).toEqual([[7]]);
    expect(current().has(7)).toBe(false);

    server.changes.push({ igdbId: 7, coverUrl: igdbCover("co_first") });
    await refreshCurrentCovers([7], endpoint);
    expect(current().get(7)).toBe(igdbCover("co_first"));
  });
});

describe("after the app was closed", () => {
  it("the current covers are back before any request, also offline", async () => {
    const server = coverServer();
    server.cover = () => newCover;
    await refreshCurrentCovers([115], endpoint);
    restartApp();
    const offline = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    vi.stubGlobal("fetch", offline);
    expect(current().size).toBe(0);

    await hydrateCurrentCovers();

    expect(current().get(115)).toBe(newCover);
    expect(offline).not.toHaveBeenCalled();
  });

  it("reads the list on from where it stopped and asks about no game again", async () => {
    const server = coverServer();
    server.changes.push({ igdbId: 1, coverUrl: igdbCover("co_before") });
    await refreshCurrentCovers([115], endpoint);
    restartApp();
    server.calls.length = 0;
    server.changes.push({ igdbId: 115, coverUrl: newCover });

    await refreshCurrentCovers([115], endpoint);

    expect(server.calls).toEqual([{ route: "changes", since: "at1" }]);
    expect(current().get(115)).toBe(newCover);
  });
});

describe("a long list of replaced covers", () => {
  const ids = [1, 2, 3, 4, 5];
  const replaced = (igdbId: number) => igdbCover(`co_new_${igdbId}`);

  it("is read page after page", async () => {
    const server = coverServer();
    await refreshCurrentCovers(ids, endpoint);
    server.pageSize = 2;
    server.changes.push(
      ...ids.map((igdbId) => ({ igdbId, coverUrl: replaced(igdbId) })),
    );
    server.calls.length = 0;

    await refreshCurrentCovers(ids, endpoint);

    expect(listCalls(server)).toEqual(["at0", "at2", "at4"]);
    expect(ids.map((igdbId) => current().get(igdbId))).toEqual(
      ids.map(replaced),
    );
  });

  it("a failure in between keeps the pages already read", async () => {
    const server = coverServer();
    await refreshCurrentCovers(ids, endpoint);
    server.pageSize = 2;
    server.changes.push(
      ...ids.map((igdbId) => ({ igdbId, coverUrl: replaced(igdbId) })),
    );
    server.calls.length = 0;
    // The request for the second page fails.
    server.failAfter = 1;
    server.failNext = 1;

    await expect(refreshCurrentCovers(ids, endpoint)).rejects.toThrow();
    expect(current().get(1)).toBe(replaced(1));
    restartApp();
    await refreshCurrentCovers(ids, endpoint);

    expect(listCalls(server)).toEqual(["at0", "at2", "at4"]);
    expect(current().get(5)).toBe(replaced(5));
  });
});

describe("when something fails", () => {
  it("the first questions about the library go on where they stopped", async () => {
    const server = coverServer();
    const ids = Array.from({ length: 250 }, (_, index) => index + 1);
    // The request for the second hundred fails.
    server.failAfter = 2;
    server.failNext = 1;

    await expect(refreshCurrentCovers(ids, endpoint)).rejects.toThrow();
    restartApp();
    await refreshCurrentCovers(ids, endpoint);

    expect(coverCalls(server)).toEqual([
      ids.slice(0, 100),
      ids.slice(100, 200),
      ids.slice(200),
    ]);
    // It did not ask again where the list starts either.
    expect(listCalls(server)).toEqual([null, "at0"]);
  });

  it("keeps what it had", async () => {
    const server = coverServer();
    server.cover = () => oldCover;
    await refreshCurrentCovers([115], endpoint);
    server.failNext = 5;

    await expect(refreshCurrentCovers([115], endpoint)).rejects.toThrow();

    expect(current().get(115)).toBe(oldCover);
  });

  it("the server no longer takes the app's place in the list: it starts over", async () => {
    const server = coverServer();
    server.cover = () => oldCover;
    await refreshCurrentCovers([115], endpoint);
    server.refuseCursors = true;
    await expect(refreshCurrentCovers([115], endpoint)).rejects.toThrow();
    server.refuseCursors = false;
    server.cover = () => newCover;
    server.calls.length = 0;

    await refreshCurrentCovers([115], endpoint);

    expect(server.calls).toEqual([
      { route: "changes", since: null },
      { route: "covers", ids: [115] },
      { route: "changes", since: "at0" },
    ]);
    expect(current().get(115)).toBe(newCover);
  });

  it("covers of another server are not mixed in", async () => {
    const prod = coverServer();
    prod.cover = () => oldCover;
    await refreshCurrentCovers([115], endpoint);
    const otherEndpoint = "https://test.example.test";
    const other = coverServer(otherEndpoint);
    other.cover = () => newCover;

    await refreshCurrentCovers([115], otherEndpoint);

    expect(other.calls).toEqual([
      { route: "changes", since: null },
      { route: "covers", ids: [115] },
      { route: "changes", since: "at0" },
    ]);
    expect(current().get(115)).toBe(newCover);
  });

  it("works for this run when nothing can be saved", async () => {
    const server = coverServer();
    disk.full = true;

    await refreshCurrentCovers([115], endpoint);
    await refreshCurrentCovers([115], endpoint);

    expect(current().get(115)).toBe(igdbCover("co_115"));
    expect(coverCalls(server)).toEqual([[115]]);
  });
});

describe("never past the server's limit of 30 requests a minute", () => {
  it("3,000 games: 25 requests at once, the rest a minute later", async () => {
    vi.useFakeTimers();
    const server = coverServer();
    const ids = Array.from({ length: 3000 }, (_, index) => index + 1);

    const refresh = refreshCurrentCovers(ids, endpoint);
    await vi.advanceTimersByTimeAsync(0);
    expect(coverCalls(server)).toHaveLength(25);

    await vi.advanceTimersByTimeAsync(59_000);
    expect(coverCalls(server)).toHaveLength(25);

    await vi.advanceTimersByTimeAsync(2 * MINUTE);
    await refresh;
    expect(coverCalls(server)).toHaveLength(30);
    expect(current().size).toBe(3000);
  });

  it("3,100 games, closed after the first 2,500: the next start asks about the other 600 only", async () => {
    vi.useFakeTimers();
    const server = coverServer();
    const ids = Array.from({ length: 3100 }, (_, index) => index + 1);
    const controller = new AbortController();
    const first = refreshCurrentCovers(ids, endpoint, controller.signal).catch(
      () => "stopped",
    );
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await vi.advanceTimersByTimeAsync(0);
    expect(await first).toBe("stopped");
    restartApp();
    server.calls.length = 0;

    const second = refreshCurrentCovers(ids, endpoint);
    await vi.advanceTimersByTimeAsync(3 * MINUTE);
    await second;

    expect(coverCalls(server)).toEqual([
      ids.slice(2500, 2600),
      ids.slice(2600, 2700),
      ids.slice(2700, 2800),
      ids.slice(2800, 2900),
      ids.slice(2900, 3000),
      ids.slice(3000),
    ]);
  });
});

describe("which games the app asks about", () => {
  it("takes every IGDB id the app stores a game with, and leaves out software and the player's own games", () => {
    const metadata: GameMetadata = {
      id: 1,
      igdbId: 101,
      name: "From metadata",
      coverUrl: "",
      source: "igdb",
    };
    const exe = (
      name: string,
      fields: Partial<ExeCacheEntry>,
    ): [string, ExeCacheEntry] => [
      name,
      { exeName: name, ...fields } as ExeCacheEntry,
    ];
    const session = (igdbId: number, source: "igdb" | "custom") =>
      ({ id: igdbId, gameId: igdbId, igdbId, source }) as never;

    const ids = knownIgdbIds({
      gameMetadata: new Map([["igdb:1", metadata]]),
      exeCache: new Map([
        exe("matched.exe", { state: "matched", igdbId: 102, source: "igdb" }),
        exe("discord.exe", {
          state: "tool",
          igdbId: 900,
          source: "community",
        }),
        exe("unknown.exe", { state: "unmatched", igdbId: 901 }),
        exe("own.exe", { state: "matched", igdbId: 902, source: "custom" }),
      ]),
      scopedExeLinks: new Map([
        ["game.exe|c:\\games\\a", { igdbId: 103, source: "igdb" } as never],
        ["game.exe|c:\\games\\b", { igdbId: 903, source: "custom" } as never],
      ]),
      libraryImports: new Map([
        ["steam:1", { igdbId: 104 } as LibraryImportEntry],
      ]),
      playcounterLibrary: new Map([
        ["igdb#105", { igdbId: 105 } as PlayCounterLibraryEntry],
      ]),
      emulatorMappings: new Map([
        ["mgba:a", { decision: "game", igdbId: 106, source: "igdb" } as never],
        ["mgba:b", { decision: "ignored", igdbId: 904 } as never],
      ]),
      activeSessions: [session(107, "igdb")],
      recentSessions: [session(108, "igdb"), session(905, "custom")],
    });

    expect([...ids].sort((left, right) => left - right)).toEqual([
      101, 102, 103, 104, 105, 106, 107, 108,
    ]);
  });
});

describe("refreshing current covers in the background", () => {
  function libraryWith(igdbId: number) {
    useAppStore.setState((state) => ({
      settings: { ...state.settings, apiEndpoint: `${endpoint}/` },
    }));
    useAppStore.setState({
      gameMetadata: new Map([
        [
          "igdb:4",
          {
            id: 4,
            igdbId,
            name: "League of Legends",
            coverUrl: oldCover,
            source: "igdb",
          },
        ],
      ]),
    });
  }

  function online(status: "online" | "offline") {
    useAppStore.setState((state) => ({
      backendHealth: { ...state.backendHealth, status },
    }));
  }

  it("reads the list at start, then again only after a day, one request each time", async () => {
    vi.useFakeTimers();
    const server = coverServer();
    libraryWith(115);
    online("online");

    const stop = startCurrentCoverRefresh();
    await vi.advanceTimersByTimeAsync(0);
    expect(server.calls).toEqual([
      { route: "changes", since: null },
      { route: "covers", ids: [115] },
      { route: "changes", since: "at0" },
    ]);

    await vi.advanceTimersByTimeAsync(23 * HOUR);
    expect(server.calls).toHaveLength(3);

    await vi.advanceTimersByTimeAsync(2 * HOUR);
    expect(server.calls.slice(3)).toEqual([{ route: "changes", since: "at0" }]);
    stop();
  });

  it("asks nothing offline and asks once the server is back", async () => {
    vi.useFakeTimers();
    const server = coverServer();
    libraryWith(115);
    online("offline");

    const stop = startCurrentCoverRefresh();
    await vi.advanceTimersByTimeAsync(0);
    expect(server.fetch).not.toHaveBeenCalled();

    online("online");
    await vi.advanceTimersByTimeAsync(0);
    expect(current().get(115)).toBe(igdbCover("co_115"));
    stop();
  });

  it("asks again within the day after a failed request", async () => {
    vi.useFakeTimers();
    const server = coverServer();
    server.failNext = 1;
    libraryWith(115);
    online("online");

    const stop = startCurrentCoverRefresh();
    await vi.advanceTimersByTimeAsync(0);
    expect(current().has(115)).toBe(false);

    await vi.advanceTimersByTimeAsync(HOUR);
    expect(current().get(115)).toBe(igdbCover("co_115"));
    stop();
  });
});

describe("drawing a cover", () => {
  const league: GameIdentityRef = {
    gameId: 4,
    source: "igdb",
    igdbId: 115,
    gameName: "League of Legends",
    coverUrl: oldCover,
  };

  it("draws the current cover instead of the stored one", () => {
    setCurrent([[115, newCover]]);

    expect(coverOverride(useAppStore.getState(), league)).toBe(newCover);
  });

  it("still draws a cover the player picked", () => {
    setCurrent([[115, newCover]]);
    const picked = "https://cdn2.steamgriddb.com/grid/players-pick.png";
    useAppStore.setState({ customCoverArt: { "igdb#115": picked } });

    expect(coverOverride(useAppStore.getState(), league)).toBe(picked);
  });

  it("falls back to the stored cover when the current one fails to load", () => {
    const failing = igdbCover("co_failing");
    setCurrent([[115, failing]]);
    markCoverUnavailable(failing);

    expect(coverOverride(useAppStore.getState(), league)).toBeUndefined();
  });

  it("leaves the player's own games with their own cover", () => {
    setCurrent([[115, newCover]]);

    expect(
      coverOverride(useAppStore.getState(), {
        gameId: 7,
        source: "custom",
        igdbId: 115,
        gameName: "My League build",
      }),
    ).toBeUndefined();
  });

  it("shows the current cover on a card that draws through useCoverUrl", () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const container = document.createElement("div");
    document.body.append(container);
    const root: Root = createRoot(container);
    function Card() {
      return createElement("span", null, useCoverUrl(league, oldCover));
    }

    act(() => root.render(createElement(Card)));
    expect(container.textContent).toBe(oldCover);

    act(() => setCurrent([[115, newCover]]));
    expect(container.textContent).toBe(newCover);

    act(() => root.unmount());
    container.remove();
  });
});
