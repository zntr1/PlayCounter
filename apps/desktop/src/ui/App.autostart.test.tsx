// @vitest-environment happy-dom
/* docs/steam-release-plan.md, 6: with autostart on, the copy you start last
 * (Steam or website) is the one Windows starts. A dev run shares the name
 * "PlayCounter" and must not take it. */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isEnabled: vi.fn(async () => true),
  enable: vi.fn(async () => {}),
  disable: vi.fn(async () => {}),
}));

vi.mock("@tauri-apps/plugin-autostart", () => ({
  isEnabled: mocks.isEnabled,
  enable: mocks.enable,
  disable: mocks.disable,
}));
vi.mock("../installSource", () => ({ readInstallSource: async () => "steam" }));
vi.mock("../tracker");
vi.mock("../updater", () => ({
  checkForUpdate: vi.fn(async () => ({ status: "current" })),
  installAvailableUpdate: vi.fn(async () => false),
}));
vi.mock("../platform", () => ({ currentPlatform: () => "windows" }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: async () => "1.2.2" }));
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
  // The sync runs once per program start: a fresh App module per test.
  vi.resetModules();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(document, "elementFromPoint").mockReturnValue(null);
  mocks.isEnabled.mockReset().mockResolvedValue(true);
  mocks.enable.mockClear();
  mocks.disable.mockClear();
  localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function startApp() {
  const { useAppStore } = await import("../store");
  const { App } = await import("./App");
  useAppStore.setState({
    activeView: "achievements",
    lastSeenReleaseNotesVersion: "1.2.2",
  });
  await act(async () => root.render(<App />));
  await act(async () => {});
}

it("writes its own path again when autostart is already on", async () => {
  vi.stubEnv("DEV", false);
  await startApp();
  expect(mocks.enable).toHaveBeenCalledTimes(1);
  expect(mocks.disable).not.toHaveBeenCalled();
});

it("leaves an existing autostart entry alone in a dev run", async () => {
  vi.stubEnv("DEV", true);
  await startApp();
  expect(mocks.enable).not.toHaveBeenCalled();
});

it("keeps autostart off when the player turned it off", async () => {
  vi.stubEnv("DEV", false);
  localStorage.setItem(
    "playcounter:v1",
    JSON.stringify({ settings: { launchOnStartup: false } }),
  );
  await startApp();
  expect(mocks.enable).not.toHaveBeenCalled();
  expect(mocks.disable).toHaveBeenCalledTimes(1);
});
