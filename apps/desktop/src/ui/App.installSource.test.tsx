// @vitest-environment happy-dom
/* docs/steam-release-plan.md, 1: Steam delivers the Steam copy's updates,
 * so the Steam copy never looks for one itself. */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useAppStore } from "../store";
import { UPDATE_FIRST_CHECK_DELAY_MS } from "../updateNotice";
import { checkForUpdate } from "../updater";
import { App } from "./App";

const mocks = vi.hoisted(() => ({
  source: { value: "direct" as "steam" | "direct" },
}));

vi.mock("../installSource", () => ({
  readInstallSource: async () => mocks.source.value,
}));
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
vi.mock("./views/AchievementsView", () => ({
  AchievementsView: () => <p>Achievements content</p>,
}));
vi.mock("./tour/TourUI", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./tour/TourUI")>()),
  WelcomePrompt: () => null,
  TourOverlay: () => null,
}));

const DAY_MS = 24 * 60 * 60 * 1000;

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(document, "elementFromPoint").mockReturnValue(null);
  vi.mocked(checkForUpdate).mockClear();
  localStorage.clear();
  useAppStore.setState(useAppStore.getInitialState(), true);
  useAppStore.setState({
    activeView: "achievements",
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

it("never checks for updates in the Steam copy", async () => {
  mocks.source.value = "steam";
  await act(async () => root.render(<App />));
  await act(() =>
    vi.advanceTimersByTimeAsync(UPDATE_FIRST_CHECK_DELAY_MS + DAY_MS),
  );
  expect(checkForUpdate).not.toHaveBeenCalled();
  expect(useAppStore.getState().installSource).toBe("steam");
});

it("still checks for updates in the direct copy", async () => {
  mocks.source.value = "direct";
  await act(async () => root.render(<App />));
  await act(() => vi.advanceTimersByTimeAsync(UPDATE_FIRST_CHECK_DELAY_MS));
  expect(checkForUpdate).toHaveBeenCalled();
});
