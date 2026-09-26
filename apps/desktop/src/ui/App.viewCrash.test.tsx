// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useAppStore } from "../store";
import { initializeTracker } from "../tracker";
import { UPDATE_FIRST_CHECK_DELAY_MS } from "../updateNotice";
import { checkForUpdate } from "../updater";
import { App } from "./App";

vi.mock("../tracker");
vi.mock("../updater", () => ({
  checkForUpdate: vi.fn(async () => ({ status: "current" })),
  installAvailableUpdate: vi.fn(async () => false),
}));
vi.mock("../platform", () => ({ currentPlatform: () => "windows" }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: async () => "1.2.2" }));
vi.mock("@tauri-apps/plugin-autostart", () => ({
  isEnabled: async () => true,
  enable: async () => {},
  disable: async () => {},
}));
// Stands in for any page that throws while rendering unexpected data.
vi.mock("./views/HistoryView", () => ({
  HistoryView: () => {
    throw new Error("History broke");
  },
}));
vi.mock("./views/AchievementsView", () => ({
  AchievementsView: () => <p>Achievements content</p>,
}));
vi.mock("./tour/TourUI", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./tour/TourUI")>()),
  WelcomePrompt: () => null,
  TourOverlay: () => null,
}));

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(document, "elementFromPoint").mockReturnValue(null);
  vi.spyOn(console, "error").mockImplementation(() => {});
  localStorage.clear();
  useAppStore.setState(useAppStore.getInitialState(), true);
  useAppStore.setState({
    activeView: "history",
    lastSeenReleaseNotesVersion: "1.2.2",
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("keeps tracking, update checks and the other pages when a page crashes", async () => {
  await act(async () => root.render(<App />));

  expect(container.textContent).toContain("This page couldn't be shown");
  expect(container.textContent).toContain("History broke");
  expect(initializeTracker).toHaveBeenCalled();
  await act(() => vi.advanceTimersByTimeAsync(UPDATE_FIRST_CHECK_DELAY_MS));
  expect(checkForUpdate).toHaveBeenCalled();

  await act(async () => useAppStore.setState({ activeView: "achievements" }));

  expect(container.textContent).toContain("Achievements content");
  expect(container.textContent).not.toContain("This page couldn't be shown");
});
