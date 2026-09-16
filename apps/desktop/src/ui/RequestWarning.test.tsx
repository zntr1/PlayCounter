// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { rateLimitedFetch } from "../rateLimitedFetch";
import { RequestWarning } from "./RequestWarning";

let root: Root;
let container: HTMLDivElement;
let endpoint: string;
let sequence = 0;
const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  endpoint = `https://notice-${sequence++}.example`;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("explains the pause, counts down silently, and disappears without sending requests", async () => {
  await act(() =>
    root.render(
      createElement(RequestWarning, {
        apiEndpoint: endpoint,
        runtimeError: null,
      }),
    ),
  );
  expect(container.textContent).toBe("");
  expect(vi.getTimerCount()).toBe(0);
  fetchMock.mockResolvedValue(
    new Response(null, { status: 429, headers: { "Retry-After": "20" } }),
  );
  await act(async () => {
    await rateLimitedFetch(`${endpoint}/api/match-processes`);
  });
  expect(container.textContent).toContain("Online requests paused");
  expect(container.textContent).toContain(
    "Background lookups will retry automatically",
  );
  expect(container.textContent).toContain("Other actions can be tried again");
  expect(container.textContent).not.toContain("429");
  const timer = container.querySelector('[role="timer"]')!;
  expect(timer.textContent).toBe("20s");
  expect(timer.getAttribute("aria-live")).toBe("off");
  expect(container.querySelector('[role="status"]')?.contains(timer)).toBe(
    false,
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1_000);
  });
  expect(timer.textContent).toBe("19s");
  await act(async () => {
    await vi.advanceTimersByTimeAsync(19_000);
  });
  expect(container.textContent).toBe("");
  expect(fetchMock).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it("preserves other runtime warnings and follows the selected backend", async () => {
  fetchMock.mockResolvedValue(
    new Response(null, { status: 429, headers: { "Retry-After": "70" } }),
  );
  await rateLimitedFetch(endpoint);
  await act(() =>
    root.render(
      createElement(RequestWarning, {
        apiEndpoint: endpoint,
        runtimeError: "Process scanning stopped",
      }),
    ),
  );
  expect(container.querySelector('[role="timer"]')?.textContent).toBe("1m 10s");
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(
    "Process scanning stopped",
  );
  await act(() =>
    root.render(
      createElement(RequestWarning, {
        apiEndpoint: `${endpoint}.other`,
        runtimeError: "Process scanning stopped",
      }),
    ),
  );
  expect(container.querySelector('[role="timer"]')).toBeNull();
  expect(container.textContent).toBe("Process scanning stopped");
  expect(vi.getTimerCount()).toBe(0);
});

it("updates an existing pause when a later in-flight response extends it", async () => {
  fetchMock
    .mockResolvedValueOnce(
      new Response(null, { status: 429, headers: { "Retry-After": "20" } }),
    )
    .mockResolvedValueOnce(
      new Response(null, { status: 429, headers: { "Retry-After": "40" } }),
    );
  await rateLimitedFetch(endpoint);
  await act(() =>
    root.render(
      createElement(RequestWarning, {
        apiEndpoint: endpoint,
        runtimeError: null,
      }),
    ),
  );
  await act(async () => {
    await rateLimitedFetch(`${endpoint}/health`, undefined, "endpoint");
  });
  expect(container.querySelectorAll('[role="timer"]')).toHaveLength(1);
  expect(container.querySelector('[role="timer"]')?.textContent).toBe("40s");
  await act(() => root.unmount());
  expect(vi.getTimerCount()).toBe(0);
  root = createRoot(container);
});
