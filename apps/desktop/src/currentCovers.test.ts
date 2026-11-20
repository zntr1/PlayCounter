// @vitest-environment happy-dom
/* Current covers: a cover IGDB replaced reaches every drawn cover, while the
   copies stored on this PC stay as they are (docs/cover-refresh-plan.md). */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GameCover } from "@playcounter/shared";
import {
  clearCurrentCovers,
  knownIgdbIds,
  loadCurrentCovers,
  startCurrentCoverRefresh,
  useCurrentCovers,
} from "./currentCovers";
import {
  coverOverride,
  markCoverUnavailable,
  useCoverUrl,
} from "./pickedCovers";
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

const endpoint = "https://api.example.test";
const igdbCover = (imageId: string) =>
  `https://images.igdb.com/igdb/image/upload/t_cover_big/${imageId}.jpg`;
const oldCover = igdbCover("co_old_season");
const newCover = igdbCover("co_new_season");
const HOUR = 60 * 60 * 1000;

/** The ids one request asked for, in order. */
function askedIds(call: unknown[]) {
  const url = new URL(String(call[0]));
  expect(url.origin + url.pathname).toBe(`${endpoint}/api/games/covers`);
  return url.searchParams.get("igdbIds")!.split(",").map(Number);
}

/** A server with a cover for every asked id, named after the id. */
function coverServer(imageId = (igdbId: number) => `co_${igdbId}`) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const ids = new URL(String(input)).searchParams
      .get("igdbIds")!
      .split(",")
      .map(Number);
    const covers: GameCover[] = ids.map((igdbId) => ({
      igdbId,
      coverUrl: igdbCover(imageId(igdbId)),
    }));
    return Response.json({ covers });
  });
}

function setCurrent(entries: Array<[number, string]>) {
  useCurrentCovers.setState({ byIgdbId: new Map(entries) });
}

beforeEach(() => {
  useAppStore.setState(useAppStore.getInitialState(), true);
  clearCurrentCovers();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("loading current covers", () => {
  it("asks for a whole library in requests of 100 games", async () => {
    const fetchMock = coverServer();
    vi.stubGlobal("fetch", fetchMock);
    const ids = Array.from({ length: 250 }, (_, index) => index + 1);

    await loadCurrentCovers(ids, endpoint);

    expect(fetchMock.mock.calls.map(askedIds)).toEqual([
      ids.slice(0, 100),
      ids.slice(100, 200),
      ids.slice(200),
    ]);
    const covers = useCurrentCovers.getState().byIgdbId;
    expect(covers.size).toBe(250);
    expect(covers.get(115)).toBe(igdbCover("co_115"));
  });

  it("asks again about games it asked about before, and takes the newer cover", async () => {
    let season = "co_old_season";
    const fetchMock = coverServer(() => season);
    vi.stubGlobal("fetch", fetchMock);

    await loadCurrentCovers([115], endpoint);
    season = "co_new_season";
    await loadCurrentCovers([115], endpoint);

    expect(fetchMock.mock.calls.map(askedIds)).toEqual([[115], [115]]);
    expect(useCurrentCovers.getState().byIgdbId.get(115)).toBe(newCover);
  });

  it("does not ask for games without an IGDB id or twice for one game", async () => {
    const fetchMock = coverServer();
    vi.stubGlobal("fetch", fetchMock);

    await loadCurrentCovers([0, -4, Number.NaN, 2.5, 7, 7], endpoint);
    await loadCurrentCovers([0, -4], endpoint);

    expect(fetchMock.mock.calls.map(askedIds)).toEqual([[7]]);
  });

  it("keeps what it had after a failed request", async () => {
    setCurrent([[115, oldCover]]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("down", { status: 500 })),
    );

    await expect(loadCurrentCovers([115], endpoint)).rejects.toThrow();

    expect(useCurrentCovers.getState().byIgdbId.get(115)).toBe(oldCover);
  });

  it("changes nothing stored on this PC", async () => {
    vi.stubGlobal(
      "fetch",
      coverServer(() => "co_new_season"),
    );
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

    await loadCurrentCovers([115], endpoint);

    const after = useAppStore.getState();
    expect(after.exeCache).toBe(before.exeCache);
    expect(after.exeCache.get("leagueclient.exe")?.coverUrl).toBe(oldCover);
    expect(after.recentSessions).toBe(before.recentSessions);
    expect(after.activeSessions).toBe(before.activeSessions);
    expect(after.gameMetadata).toBe(before.gameMetadata);
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

  it("asks once at start, then again only after a day", async () => {
    vi.useFakeTimers();
    const fetchMock = coverServer();
    vi.stubGlobal("fetch", fetchMock);
    libraryWith(115);
    online("online");

    const stop = startCurrentCoverRefresh();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(23 * HOUR);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(2 * HOUR);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    stop();
  });

  it("asks nothing offline and asks once the server is back", async () => {
    vi.useFakeTimers();
    const fetchMock = coverServer();
    vi.stubGlobal("fetch", fetchMock);
    libraryWith(115);
    online("offline");

    const stop = startCurrentCoverRefresh();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).not.toHaveBeenCalled();

    online("online");
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(useCurrentCovers.getState().byIgdbId.get(115)).toBe(
      igdbCover("co_115"),
    );
    stop();
  });

  it("asks again within the day after a failed request", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("down", { status: 500 }))
      .mockImplementation(coverServer());
    vi.stubGlobal("fetch", fetchMock);
    libraryWith(115);
    online("online");

    const stop = startCurrentCoverRefresh();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(HOUR);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(useCurrentCovers.getState().byIgdbId.get(115)).toBe(
      igdbCover("co_115"),
    );
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
