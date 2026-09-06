import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestJson, requestJsonResponse } from "./requestJson";

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function stallResponseBody(headersDelay = 0) {
  const readBody = vi.fn();
  fetchMock.mockImplementation(async (_input, init) => {
    if (headersDelay)
      await new Promise((resolve) => setTimeout(resolve, headersDelay));
    return {
      ok: true,
      json: () => {
        readBody();
        return new Promise((_resolve, reject) => {
          init!.signal!.addEventListener(
            "abort",
            () => reject(init!.signal!.reason),
            {
              once: true,
            },
          );
        });
      },
    } as Response;
  });
  return readBody;
}

describe("JSON requests", () => {
  it("reads the response and releases the timer and cancellation listener", async () => {
    const controller = new AbortController();
    const removeListener = vi.spyOn(controller.signal, "removeEventListener");
    fetchMock.mockResolvedValue(Response.json({ candidates: [] }));
    await expect(
      requestJson("https://api.example", { signal: controller.signal }),
    ).resolves.toEqual({ candidates: [] });
    expect(vi.getTimerCount()).toBe(0);
    expect(removeListener).toHaveBeenCalledWith("abort", expect.any(Function));
  });

  it.each([0, 6_000])(
    "keeps one deadline across headers and body (headers delay=%s)",
    async (headersDelay) => {
      const readBody = stallResponseBody(headersDelay);
      const result = requestJson("https://api.example");
      const assertion = expect(result).rejects.toMatchObject({
        name: "TimeoutError",
      });
      await vi.advanceTimersByTimeAsync(headersDelay);
      expect(readBody).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(8_000 - headersDelay);
      await assertion;
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("cancels while the body is being read", async () => {
    stallResponseBody();
    const controller = new AbortController();
    const result = requestJson("https://api.example", {
      signal: controller.signal,
    });
    const assertion = expect(result).rejects.toMatchObject({
      name: "AbortError",
    });
    await Promise.resolve();
    controller.abort();
    await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not send an already cancelled request", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      requestJson("https://api.example", { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reports HTTP failures and releases the deadline", async () => {
    fetchMock.mockResolvedValue(
      new Response("unavailable", {
        status: 503,
        statusText: "Service Unavailable",
      }),
    );
    await expect(requestJson("https://api.example")).rejects.toThrow(
      "503 Service Unavailable",
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it("preserves unsupported endpoint status without reading an error body", async () => {
    const json = vi.fn();
    fetchMock.mockResolvedValue({
      ok: false,
      status: 501,
      statusText: "Not Implemented",
      json,
    } as unknown as Response);
    await expect(requestJsonResponse("https://api.example")).resolves.toEqual({
      ok: false,
      status: 501,
      statusText: "Not Implemented",
    });
    expect(json).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("releases the timer and listener after malformed JSON", async () => {
    const controller = new AbortController();
    const removeListener = vi.spyOn(controller.signal, "removeEventListener");
    fetchMock.mockResolvedValue(new Response("broken JSON"));
    await expect(
      requestJsonResponse("https://api.example", { signal: controller.signal }),
    ).rejects.toBeInstanceOf(SyntaxError);
    expect(vi.getTimerCount()).toBe(0);
    expect(removeListener).toHaveBeenCalledWith("abort", expect.any(Function));
  });
});
