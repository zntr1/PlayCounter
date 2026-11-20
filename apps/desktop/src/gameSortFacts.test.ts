import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GameSortFacts } from "@playcounter/shared";
import {
  clearGameSortFacts,
  gameSortFactsSnapshot,
  loadGameSortFacts,
} from "./gameSortFacts";

const endpoint = "https://api.example.test";

/** The ids one request asked for, in order. */
function askedIds(call: unknown[]) {
  const url = new URL(String(call[0]));
  expect(url.origin + url.pathname).toBe(`${endpoint}/api/games/sort-facts`);
  return url.searchParams.get("igdbIds")!.split(",").map(Number);
}

/** A server that knows a rating for every even id and nothing else. */
function evenRatingsServer() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const ids = new URL(String(input)).searchParams
      .get("igdbIds")!
      .split(",")
      .map(Number);
    const facts: GameSortFacts[] = ids
      .filter((id) => id % 2 === 0)
      .map((igdbId) => ({ igdbId, rating: 80 }));
    return Response.json({ facts });
  });
}

describe("loading time to beat and rating for My Games", () => {
  beforeEach(() => {
    clearGameSortFacts();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
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
});
