/* Time to beat and rating for sorting My Games
   (docs/time-to-beat-sort-plan.md). The numbers are kept between starts, so a
   sort that stays picked does not ask about the whole library at every start
   (docs/cover-refresh-plan.md, "The same for the sort numbers"). */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GameSortFacts } from "@playcounter/shared";
import {
  gameSortFactsSnapshot,
  loadGameSortFacts,
  resetGameSortFactsForTests,
} from "./gameSortFacts";
import { resetRequestPaceForTests } from "./requestPace";

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
const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

/** The ids one request asked for, in order. */
function askedIds(call: unknown[]) {
  const url = new URL(String(call[0]));
  expect(url.origin + url.pathname).toBe(`${endpoint}/api/games/sort-facts`);
  return url.searchParams.get("igdbIds")!.split(",").map(Number);
}

/** A server that knows a rating for every even id and nothing else. */
function evenRatingsServer(rating = () => 80) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const ids = new URL(String(input)).searchParams
      .get("igdbIds")!
      .split(",")
      .map(Number);
    const facts: GameSortFacts[] = ids
      .filter((id) => id % 2 === 0)
      .map((igdbId) => ({ igdbId, rating: rating() }));
    return Response.json({ facts });
  });
}

/** The app closes and starts again: memory is gone, the disk is not. */
function restartApp() {
  resetGameSortFactsForTests();
  resetRequestPaceForTests();
}

describe("loading time to beat and rating for My Games", () => {
  beforeEach(() => {
    disk.values.clear();
    disk.full = false;
    restartApp();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("asks for a whole library in requests of 100 games", async () => {
    const fetchMock = evenRatingsServer();
    vi.stubGlobal("fetch", fetchMock);
    const ids = Array.from({ length: 250 }, (_, index) => index + 1);

    await loadGameSortFacts(ids, endpoint);

    expect(fetchMock.mock.calls.map(askedIds)).toEqual([
      ids.slice(0, 100),
      ids.slice(100, 200),
      ids.slice(200),
    ]);
    const facts = gameSortFactsSnapshot();
    expect(facts.get(2)).toEqual({ igdbId: 2, rating: 80 });
    // Asked, and the server has nothing: known as "no numbers".
    expect(facts.get(1)).toBeNull();
    expect(facts.size).toBe(250);
  });

  it("asks only about games it has not asked about yet", async () => {
    const fetchMock = evenRatingsServer();
    vi.stubGlobal("fetch", fetchMock);

    await loadGameSortFacts([1, 2], endpoint);
    await loadGameSortFacts([1, 2, 3], endpoint);
    await loadGameSortFacts([1, 2, 3], endpoint);

    expect(fetchMock.mock.calls.map(askedIds)).toEqual([[1, 2], [3]]);
  });

  it("does not ask for games without an IGDB id or twice for one game", async () => {
    const fetchMock = evenRatingsServer();
    vi.stubGlobal("fetch", fetchMock);

    await loadGameSortFacts([0, -4, Number.NaN, 2.5, 7, 7], endpoint);
    await loadGameSortFacts([0, -4], endpoint);

    expect(fetchMock.mock.calls.map(askedIds)).toEqual([[7]]);
  });

  it("asks again after a failed request", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("down", { status: 500 }))
      .mockImplementation(evenRatingsServer());
    vi.stubGlobal("fetch", fetchMock);

    await expect(loadGameSortFacts([2], endpoint)).rejects.toThrow();
    expect(gameSortFactsSnapshot().has(2)).toBe(false);

    await loadGameSortFacts([2], endpoint);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(gameSortFactsSnapshot().get(2)).toEqual({ igdbId: 2, rating: 80 });
  });

  it("stops before the next request once the sort is left", async () => {
    const controller = new AbortController();
    const server = evenRatingsServer();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      controller.abort();
      return server(input);
    });
    vi.stubGlobal("fetch", fetchMock);
    const ids = Array.from({ length: 150 }, (_, index) => index + 1);

    await loadGameSortFacts(ids, endpoint, controller.signal);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    // The request already on its way still counts.
    expect(gameSortFactsSnapshot().size).toBe(100);
  });

  it("after a restart the numbers are there without a request, also for games without numbers", async () => {
    vi.stubGlobal("fetch", evenRatingsServer());
    await loadGameSortFacts([1, 2, 3, 4], endpoint);
    restartApp();
    const fetchMock = evenRatingsServer();
    vi.stubGlobal("fetch", fetchMock);
    expect(gameSortFactsSnapshot().size).toBe(0);

    await loadGameSortFacts([1, 2, 3, 4], endpoint);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(gameSortFactsSnapshot().get(2)).toEqual({ igdbId: 2, rating: 80 });
    expect(gameSortFactsSnapshot().get(1)).toBeNull();
  });

  it("asks again about numbers a week old, and sorts by the old ones until the answer is in", async () => {
    vi.useFakeTimers();
    let rating = 80;
    const fetchMock = evenRatingsServer(() => rating);
    vi.stubGlobal("fetch", fetchMock);
    await loadGameSortFacts([2], endpoint);

    await vi.advanceTimersByTimeAsync(6 * DAY);
    await loadGameSortFacts([2], endpoint);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(2 * DAY);
    restartApp();
    rating = 91;
    const loading = loadGameSortFacts([2], endpoint);
    // Read from this PC first: the old number is there while the server is asked.
    await vi.advanceTimersByTimeAsync(0);
    await loading;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(gameSortFactsSnapshot().get(2)).toEqual({ igdbId: 2, rating: 91 });
  });

  it("keeps a week-old number when the server cannot be asked", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", evenRatingsServer());
    await loadGameSortFacts([2], endpoint);
    await vi.advanceTimersByTimeAsync(8 * DAY);
    restartApp();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("down", { status: 500 })),
    );

    await expect(loadGameSortFacts([2], endpoint)).rejects.toThrow();

    expect(gameSortFactsSnapshot().get(2)).toEqual({ igdbId: 2, rating: 80 });
  });

  it("3,000 games: 25 requests at once, the rest a minute later", async () => {
    vi.useFakeTimers();
    const fetchMock = evenRatingsServer();
    vi.stubGlobal("fetch", fetchMock);
    const ids = Array.from({ length: 3000 }, (_, index) => index + 1);

    const loading = loadGameSortFacts(ids, endpoint);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(25);

    await vi.advanceTimersByTimeAsync(59_000);
    expect(fetchMock).toHaveBeenCalledTimes(25);

    await vi.advanceTimersByTimeAsync(2 * MINUTE);
    await loading;
    expect(fetchMock).toHaveBeenCalledTimes(30);
    expect(gameSortFactsSnapshot().size).toBe(3000);
  });

  it("numbers of another server are not mixed in", async () => {
    vi.stubGlobal("fetch", evenRatingsServer());
    await loadGameSortFacts([2], endpoint);
    restartApp();
    const other = "https://test.example.test";
    const fetchMock = vi.fn(async () =>
      Response.json({ facts: [{ igdbId: 2, rating: 55 }] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await loadGameSortFacts([2], other);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(gameSortFactsSnapshot().get(2)).toEqual({ igdbId: 2, rating: 55 });
  });

  it("works for this run when nothing can be saved", async () => {
    const fetchMock = evenRatingsServer();
    vi.stubGlobal("fetch", fetchMock);
    disk.full = true;

    await loadGameSortFacts([2], endpoint);
    await loadGameSortFacts([2], endpoint);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(gameSortFactsSnapshot().get(2)).toEqual({ igdbId: 2, rating: 80 });
  });

  it("keeps the numbers out of localStorage, where the app's own data lives", async () => {
    vi.stubGlobal("fetch", evenRatingsServer());
    vi.stubGlobal("localStorage", {
      setItem: () => {
        throw new Error("the sort numbers must not go into localStorage");
      },
      getItem: () => null,
    });

    await loadGameSortFacts([2, 4], endpoint);

    expect(disk.values.size).toBe(1);
  });
});
