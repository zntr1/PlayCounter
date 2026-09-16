import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rateLimitedFetch } from "../rateLimitedFetch";
import { requestLibraryJson } from "./request";
import { resolveLibraryGames } from "./resolve";

const fetchMock = vi.fn<typeof fetch>();
let sequence = 0;
let endpoint: string;
beforeEach(() => {
  vi.useFakeTimers();
  endpoint = `https://library-request-${sequence++}.example`;
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const limited = (seconds = 20) =>
  new Response(null, {
    status: 429,
    headers: { "Retry-After": String(seconds) },
  });

describe("importer requests", () => {
  it("waits out an existing cooldown and can be cancelled before any lookup is sent", async () => {
    fetchMock.mockResolvedValue(limited());
    await rateLimitedFetch(endpoint);
    const controller = new AbortController();
    const waiting = vi.fn();
    const result = requestLibraryJson(endpoint, {
      signal: controller.signal,
      onRateLimitWait: waiting,
    });
    const rejected = expect(result).rejects.toMatchObject({
      name: "AbortError",
    });
    await vi.advanceTimersByTimeAsync(19_999);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(waiting).toHaveBeenLastCalledWith(true);
    controller.abort();
    await rejected;
    expect(waiting).toHaveBeenLastCalledWith(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("retains completed Steam batches and retries only the throttled batch", async () => {
    const batches: string[][] = [];
    fetchMock.mockImplementation(async (_url, init) => {
      const items = JSON.parse(String(init?.body)).items as { key: string }[];
      batches.push(items.map(({ key }) => key));
      if (batches.length === 2) return limited();
      return Response.json({
        results: items.map(({ key }) => ({
          key,
          status: "unknown",
          executables: [],
        })),
      });
    });
    const games = Array.from({ length: 205 }, (_, i) => ({
      externalId: String(i + 1),
      playtimeSeconds: null,
      installed: false,
      executables: [],
    }));
    const waiting = vi.fn();
    const result = resolveLibraryGames(
      endpoint,
      "steam",
      games,
      undefined,
      waiting,
    );
    await vi.advanceTimersByTimeAsync(19_999);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(waiting).toHaveBeenLastCalledWith(true);
    await vi.advanceTimersByTimeAsync(1);
    expect((await result).games).toHaveLength(205);
    expect(batches.map((batch) => batch.length)).toEqual([100, 100, 100, 5]);
    expect(batches[1]).toEqual(batches[2]);
    expect(waiting).toHaveBeenLastCalledWith(false);
  });

  it("stops after two retries rather than looping forever on 429", async () => {
    fetchMock.mockImplementation(async () => limited(1));
    const result = requestLibraryJson(endpoint);
    await vi.advanceTimersByTimeAsync(2_000);
    expect((await result).status).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("bounds an excessively long server cooldown", async () => {
    fetchMock.mockResolvedValue(limited(600));
    const result = requestLibraryJson(endpoint);
    const rejected = expect(result).rejects.toThrow("server is still busy");
    await vi.advanceTimersByTimeAsync(120_000);
    await rejected;
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not replay a request after a network failure", async () => {
    fetchMock.mockRejectedValue(new Error("connection lost"));
    await expect(
      requestLibraryJson(endpoint, { method: "POST" }),
    ).rejects.toThrow("connection lost");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
