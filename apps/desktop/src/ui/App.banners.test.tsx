// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useAppStore } from "../store";
import { STORAGE_KEY } from "../persistence";
import { launchGame } from "../tracker";
import { App } from "./App";
import { useLibrarySources } from "./librarySources";
import { useLibraryLaunchLock } from "./libraryLaunchLock";

vi.mock("../tracker");
vi.mock("../platform", () => ({ currentPlatform: () => "windows" }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: async () => "1.1.18" }));
vi.mock("@tauri-apps/plugin-autostart", () => ({
  isEnabled: async () => true,
  enable: async () => {},
  disable: async () => {},
}));
vi.mock("./views/HistoryView", () => ({
  HistoryView: () => <p>History content</p>,
}));
vi.mock("./views/SettingsView", () => ({
  SettingsView: () => <p>Settings content</p>,
}));
vi.mock("./tour/TourUI", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./tour/TourUI")>()),
  WelcomePrompt: () => null,
  TourOverlay: () => null,
}));

const entry = (id: number, name: string) => ({
  exeName: `game${id}.exe`,
  gameId: id,
  gameName: name,
  source: "custom" as const,
  state: "matched" as const,
  lastCheckedAt: "2026-09-20T12:00:00Z",
});
let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.mocked(launchGame).mockClear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(document, "elementFromPoint").mockReturnValue(null);
  localStorage.clear();
  useAppStore.setState(useAppStore.getInitialState(), true);
  useLibrarySources.setState(useLibrarySources.getInitialState(), true);
  useLibraryLaunchLock.setState(useLibraryLaunchLock.getInitialState(), true);
  useAppStore.setState({
    activeView: "history",
    lastSeenReleaseNotesVersion: "1.1.18",
    exeCache: new Map([
      ["game-1.exe", entry(-1, "Library favorite")],
      ["game-2.exe", entry(-2, "Shelf favorite")],
    ]),
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function banner() {
  return container.querySelector('[data-banner-variant="compact"]');
}
function toggle(label: "Show banner" | "Hide banner") {
  const button = [
    ...container.querySelectorAll<HTMLButtonElement>("button"),
  ].find((item) => item.textContent?.trim() === label);
  expect(button).toBeDefined();
  return act(() => button!.click());
}

it("saves visibility separately for each view without mounting hidden library cards", async () => {
  await act(() => root.render(<App />));
  expect(banner()).toBeNull();
  await toggle("Show banner");
  expect(banner()?.querySelector("h2")?.textContent).toBe("Library favorite");
  expect(container.querySelector(".game-library-card")).toBeNull();
  await act(() => useAppStore.getState().setActiveView("settings"));
  expect(banner()).toBeNull();
  await toggle("Show banner");
  expect(banner()).not.toBeNull();
  await toggle("Hide banner");
  expect(banner()).toBeNull();
  await act(() => useAppStore.getState().setActiveView("history"));
  expect(banner()).not.toBeNull();
  await act(() => useAppStore.getState().setMyGamesShowHero(false));
  expect(banner()).not.toBeNull();
  expect(
    JSON.parse(localStorage.getItem(STORAGE_KEY)!).settings.viewShowHero,
  ).toEqual({ history: true, settings: false });
});

it("loads a saved banner before opening My Games and follows new play evidence", async () => {
  useAppStore.getState().setViewShowHero("history", true);
  await act(() => root.render(<App />));
  expect(banner()?.querySelector("h2")?.textContent).toBe("Library favorite");
  await act(() =>
    useAppStore.setState({
      recentSessions: [
        {
          id: 1,
          gameId: -2,
          source: "custom",
          gameName: "Shelf favorite",
          exeName: "game-2.exe",
          startedAt: "2026-09-21T12:00:00Z",
          endedAt: "2026-09-21T13:00:00Z",
          durationSeconds: 3600,
        },
      ],
    }),
  );
  expect(banner()?.querySelector("h2")?.textContent).toBe("Shelf favorite");
  await act(() =>
    useAppStore.setState({ exeCache: new Map(), recentSessions: [] }),
  );
  expect(banner()).toBeNull();
  expect(container.textContent).toContain(
    "once you have games in your library",
  );
  await toggle("Hide banner");
  expect(container.textContent).not.toContain(
    "once you have games in your library",
  );
});

it("uses the global banner on other views after visiting a shelf with its own banner", async () => {
  useAppStore.getState().setActiveView("games");
  useAppStore
    .getState()
    .setLibraryFeaturedGame({ gameId: -1, source: "custom" });
  useAppStore.getState().savePersonalShelf({
    name: "Weekend",
    featuredGame: { gameId: -2, source: "custom" },
  });
  useAppStore.getState().setViewShowHero("history", true);
  await act(() => root.render(<App />));
  const shelf = [
    ...container.querySelectorAll<HTMLButtonElement>(
      '[aria-label="Library shelf"] [role="tab"]',
    ),
  ].find((button) => button.textContent?.startsWith("Weekend"))!;
  await act(() => shelf.click());
  expect(
    container.querySelector('[data-banner-variant="full"] h2')?.textContent,
  ).toBe("Shelf favorite");
  await act(() => useAppStore.getState().setActiveView("history"));
  expect(banner()?.querySelector("h2")?.textContent).toBe("Library favorite");
  await act(() => useAppStore.getState().setActiveView("games"));
  expect(
    container.querySelector('[data-banner-variant="full"] h2')?.textContent,
  ).toBe("Shelf favorite");
});

it("keeps a launch in progress locked when switching to another banner", async () => {
  const { acquireLaunchLock, releaseLaunchLock } =
    useLibraryLaunchLock.getState();
  expect(acquireLaunchLock("library-card")).toBe(true);
  useAppStore.setState({
    settings: {
      ...useAppStore.getState().settings,
      gameLaunchingEnabled: true,
    },
    manualLaunchTargets: new Map([
      [
        "-1:custom",
        {
          exeName: "game-1.exe",
          path: "C:\\Games\\game-1.exe",
          owner: { gameId: -1, source: "custom" },
        },
      ],
    ]),
  });
  useAppStore.getState().setViewShowHero("history", true);
  await act(() => root.render(<App />));
  const play = banner()!.querySelector<HTMLButtonElement>(
    '[aria-label="Play: Library favorite"]',
  )!;
  expect(play).not.toBeNull();
  await act(() => play.click());
  expect(launchGame).not.toHaveBeenCalled();
  await act(() => releaseLaunchLock("library-card"));
  await act(() => play.click());
  expect(launchGame).toHaveBeenCalledOnce();
});
