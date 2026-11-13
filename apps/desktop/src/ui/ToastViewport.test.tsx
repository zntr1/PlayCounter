// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useAppStore } from "../store";
import { ToastViewport } from "./App";

/* docs/hidden-shelves-plan.md, "Putting a game on a hiding shelf": a toast
   can carry one button, Undo. */

vi.mock("../tracker");
vi.mock("../platform", () => ({ currentPlatform: () => "windows" }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: async () => "1.1.18" }));
vi.mock("@tauri-apps/plugin-autostart", () => ({
  isEnabled: async () => true,
  enable: async () => {},
  disable: async () => {},
}));

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  useAppStore.setState(useAppStore.getInitialState(), true);
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

it("shows a toast's Undo button, runs it once and closes the toast", async () => {
  vi.useFakeTimers();
  const run = vi.fn();
  useAppStore.getState().addToast({
    tone: "success",
    title: "Added to Private. It's hidden from All games now.", // i18n-exempt: test fixture
    action: { label: "Undo", run }, // i18n-exempt: test fixture
  });
  await act(() => root.render(<ToastViewport />));
  const undo = [...container.querySelectorAll("button")].find(
    (button) => button.textContent?.trim() === "Undo",
  );
  expect(undo).toBeDefined();

  await act(() => undo!.click());
  expect(run).toHaveBeenCalledTimes(1);
  await act(() => vi.advanceTimersByTime(300));
  expect(useAppStore.getState().toasts).toEqual([]);
});

it("shows no extra button on a toast without one", async () => {
  useAppStore.getState().addToast({ tone: "info", title: "Saved" }); // i18n-exempt: test fixture
  await act(() => root.render(<ToastViewport />));
  expect(
    [...container.querySelectorAll("button")].map((button) =>
      button.getAttribute("aria-label"),
    ),
  ).toEqual(["Dismiss notification"]);
});
