// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { LiveTimerPayload } from "../liveTimer";
import { LiveTimerPill } from "./LiveTimerPill";

let root: Root;
let container: HTMLDivElement;

const start = Date.parse("2026-11-08T10:00:00Z");
const payload: LiveTimerPayload = {
  countFromMs: start,
  pausedAtMs: null,
  corner: "top-left",
  monitor: "primary",
  accentColor: null,
  targetPids: [],
  pauseLabel: "Pause the timer for Elden Ring",
  resumeLabel: "Resume the timer for Elden Ring",
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(start + (3600 + 12 * 60 + 40) * 1000);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const button = () => container.querySelector("button");

// docs/pause-timer-plan.md: option C, and the paused look.
it("shows its button only while the mouse rests on it", async () => {
  const onTogglePause = vi.fn();
  await act(() =>
    root.render(
      <LiveTimerPill payload={payload} onTogglePause={onTogglePause} />,
    ),
  );
  expect(container.textContent).toBe("1:12:40");
  expect(button()).toBeNull();

  await act(() =>
    root.render(
      <LiveTimerPill payload={payload} hovered onTogglePause={onTogglePause} />,
    ),
  );
  expect(button()!.getAttribute("aria-label")).toBe(
    "Pause the timer for Elden Ring",
  );
  act(() => button()!.click());
  expect(onTogglePause).toHaveBeenCalledOnce();
});

it("paused: stands still and keeps Resume in sight", async () => {
  await act(() =>
    root.render(
      <LiveTimerPill
        payload={{ ...payload, pausedAtMs: start + 50 * 60_000 }}
        onTogglePause={vi.fn()}
      />,
    ),
  );
  await act(() => vi.advanceTimersByTimeAsync(5_000));
  expect(container.textContent).toBe("0:50:00");
  expect(container.querySelector(".live-timer-paused")).not.toBeNull();
  expect(button()!.getAttribute("aria-label")).toBe(
    "Resume the timer for Elden Ring",
  );
});
