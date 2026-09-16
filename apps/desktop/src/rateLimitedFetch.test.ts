import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rateLimitedFetch, rateLimitDelay } from "./rateLimitedFetch";

const fetchMock = vi.fn<typeof fetch>();
let sequence = 0;
let endpoint: string;
beforeEach(() => {
  vi.useFakeTimers();
  endpoint = `https://api-${sequence++}.example`;
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("API cooldown", () => {
  it("allows an exempt health probe during API cooldown without resetting the cooldown", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(null, { status: 429, headers: { "Retry-After": "20" } }),
      )
      .mockResolvedValue(Response.json({ ok: true }));
    await rateLimitedFetch(`${endpoint}/api/library/resolve`);
    expect(
      (await rateLimitedFetch(`${endpoint}/health`, undefined, "endpoint"))
        .status,
    ).toBe(200);
    expect(
      (await rateLimitedFetch(`${endpoint}/api/match-processes`)).status,
    ).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("still respects a health endpoint's own 429 on an older backend", async () => {
    fetchMock.mockResolvedValue(
      new Response(null, { status: 429, headers: { "Retry-After": "20" } }),
    );
    await rateLimitedFetch(`${endpoint}/health`, undefined, "endpoint");
    await rateLimitedFetch(`${endpoint}/health`, undefined, "endpoint");
    expect(
      (await rateLimitedFetch(`${endpoint}/api/match-processes`)).status,
    ).toBe(429);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("does not turn a zero-second Retry-After into a minute of blocking", async () => {
    fetchMock.mockResolvedValue(
      new Response(null, { status: 429, headers: { "Retry-After": "0" } }),
    );
    await rateLimitedFetch(endpoint);
    expect(rateLimitDelay(endpoint)).toBe(1_000);
  });

  it("shares Retry-After across routes, isolates other origins, and resumes after expiry", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(null, { status: 429, headers: { "Retry-After": "20" } }),
      )
      .mockResolvedValue(Response.json({ ok: true }));
    await rateLimitedFetch(`${endpoint}/lookup`, { method: "POST" });
    expect(
      (await rateLimitedFetch(`${endpoint}/feedback`, { method: "POST" }))
        .status,
    ).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(
      (await rateLimitedFetch("https://other.example/lookup")).status,
    ).toBe(200);
    await vi.advanceTimersByTimeAsync(19_999);
    expect((await rateLimitedFetch(`${endpoint}/lookup`)).status).toBe(429);
    await vi.advanceTimersByTimeAsync(1);
    expect((await rateLimitedFetch(`${endpoint}/lookup`)).status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it.each([undefined, "invalid", "-1"])(
    "uses a one-minute fallback for unavailable Retry-After (%s)",
    async (value) => {
      fetchMock.mockResolvedValue(
        new Response(null, {
          status: 429,
          headers: value ? { "Retry-After": value } : {},
        }),
      );
      await rateLimitedFetch(endpoint);
      expect(rateLimitDelay(endpoint)).toBe(60_000);
    },
  );

  it("supports HTTP dates and cancellation during cooldown", async () => {
    vi.setSystemTime(new Date("2026-09-16T12:00:00Z"));
    fetchMock.mockResolvedValue(
      new Response(null, {
        status: 429,
        headers: { "Retry-After": "Wed, 16 Sep 2026 12:00:30 GMT" },
      }),
    );
    await rateLimitedFetch(endpoint);
    expect(rateLimitDelay(endpoint)).toBe(30_000);
    const controller = new AbortController();
    controller.abort();
    await expect(
      rateLimitedFetch(endpoint, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
