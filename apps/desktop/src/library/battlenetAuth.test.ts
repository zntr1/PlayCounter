import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import reader from "../../src-tauri/src/library/battlenet_auth.js?raw";

type Result = {
  status: "pending" | "complete" | "error";
  games?: never[];
  incomplete?: boolean;
  error?: string;
};

function harness({
  body = { authenticated: true } as unknown,
  status = 200,
  pathname = "/overview",
  origin = "https://account.battle.net",
  responseUrl = "https://account.battle.net/api/",
  contentType = "application/json",
} = {}) {
  const window = {};
  const fetch = vi.fn(async (_path: string, _options?: RequestInit) => {
    const response = new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": contentType },
    });
    Object.defineProperty(response, "url", { value: responseUrl });
    return response;
  });
  const evaluate = () =>
    runInNewContext(reader, {
      window,
      location: { origin, pathname },
      fetch,
      AbortController,
      setTimeout,
      clearTimeout,
    }) as Result | null;
  return { fetch, evaluate };
}

afterEach(() => vi.useRealTimers());

describe("Battle.net authentication-only probe", () => {
  it("confirms authentication without reading games or exposing account details", async () => {
    const { evaluate, fetch } = harness({
      body: {
        authenticated: true,
        accountName: "PRIVATE-ACCOUNT",
        email: "private@example.test",
        token: "PRIVATE-TOKEN",
      },
    });
    expect(evaluate()).toEqual({ status: "pending" });
    await vi.waitFor(() => expect(evaluate()?.status).toBe("complete"));
    expect(evaluate()).toEqual({
      status: "complete",
      games: [],
      incomplete: false,
    });
    expect(fetch).toHaveBeenCalledExactlyOnceWith(
      "/api/",
      expect.objectContaining({
        credentials: "same-origin",
        redirect: "error",
        cache: "no-store",
        signal: expect.any(AbortSignal),
      }),
    );
    expect(JSON.stringify(evaluate())).not.toMatch(
      /PRIVATE|email|token|accountName/,
    );
  });

  it.each([200, 401, 403])(
    "rejects explicitly unauthenticated status %i",
    async (status) => {
      const { evaluate, fetch } = harness({
        body: { authenticated: false },
        status,
      });
      evaluate();
      await vi.waitFor(() =>
        expect(evaluate()).toEqual({ status: "error", error: "expired" }),
      );
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  it.each([401, 403])(
    "requests renewal for ambiguous refusal %i",
    async (status) => {
      const { evaluate } = harness({
        body: { challenge: true },
        status,
        contentType: "text/html",
      });
      evaluate();
      await vi.waitFor(() =>
        expect(evaluate()).toEqual({ status: "error", error: "renew" }),
      );
    },
  );

  it.each([
    { body: { authenticated: "true" } },
    { body: { changedSchema: true } },
    { status: 503 },
    { body: { authenticated: true, padding: "x".repeat(65_000) } },
    { responseUrl: "https://evil.test/api/" },
  ])("does not verify malformed or untrusted responses %#", async (options) => {
    const { evaluate } = harness(options);
    evaluate();
    await vi.waitFor(() =>
      expect(evaluate()).toEqual({ status: "error", error: "unavailable" }),
    );
  });

  it.each([{ pathname: "/login/" }, { origin: "https://evil.test" }])(
    "never probes login forms or unrelated origins %#",
    (options) => {
      const { evaluate, fetch } = harness(options);
      expect(evaluate()).toBeNull();
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it("times out an unresponsive status request without claiming authentication", async () => {
    vi.useFakeTimers();
    const { evaluate, fetch } = harness();
    fetch.mockImplementation(
      (_path, options) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener(
            "abort",
            () => reject(new Error("timeout")),
            { once: true },
          );
        }),
    );
    evaluate();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(evaluate()).toEqual({ status: "error", error: "unavailable" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
