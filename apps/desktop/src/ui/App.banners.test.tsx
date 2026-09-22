// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { customHeroArtKey, useAppStore, type ActiveSession } from "../store";
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
vi.mock("./views/AchievementsView", () => ({
  AchievementsView: () => <p>Achievements content</p>,
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
    activeView: "achievements",
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

async function menuItem(label: string) {
  const more = container.querySelector<HTMLButtonElement>(
    'button[aria-label="More banner options"]',
  );
  expect(more).not.toBeNull();
  await act(() => more!.click());
  const item = [
    ...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
  ].find((element) => element.textContent?.trim() === label);
  expect(item).toBeDefined();
  await act(() => item!.click());
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
  await act(() => useAppStore.getState().setActiveView("achievements"));
  expect(banner()).not.toBeNull();
  await act(() => useAppStore.getState().setMyGamesShowHero(false));
  expect(banner()).not.toBeNull();
  expect(
    JSON.parse(localStorage.getItem(STORAGE_KEY)!).settings.viewShowHero,
  ).toEqual({ achievements: true, settings: false });
});

it("lets the banner menu switch between the compact card and full details", async () => {
  useAppStore.getState().setViewShowHero("achievements", true);
  await act(() => root.render(<App />));
  expect(banner()).not.toBeNull();
  expect(container.querySelector("main")?.dataset.bannerLayout).toBe("compact");
  await menuItem("Show more banner details");
  expect(banner()).toBeNull();
  expect(
    container.querySelector('[data-banner-variant="full"] h2')?.textContent,
  ).toBe("Library favorite");
  expect(container.querySelector("main")?.dataset.bannerLayout).toBe("full");
  expect(
    JSON.parse(localStorage.getItem(STORAGE_KEY)!).settings.viewBannerDetails,
  ).toBe(true);
  await menuItem("Hide banner details");
  expect(banner()).not.toBeNull();
  expect(container.querySelector("main")?.dataset.bannerLayout).toBe("compact");
});

it("shows no pinned-game banner or toggle on My History", async () => {
  useAppStore.getState().setViewShowHero("history", true);
  useAppStore.getState().setActiveView("history");
  await act(() => root.render(<App />));
  expect(banner()).toBeNull();
  expect(container.textContent).toContain("History content");
  expect(
    [...container.querySelectorAll("button")].some((button) =>
      /^(Show|Hide) banner$/.test(button.textContent?.trim() ?? ""),
    ),
  ).toBe(false);
});

it("keeps Now Playing on the first running game despite a saved library banner preference", async () => {
  const running = ["First running game", "Second running game"].map(
    (gameName, index): ActiveSession => ({
      id: index + 1,
      gameId: -3 - index,
      source: "custom",
      gameName,
      exeName: `running${index + 1}.exe`,
      coverUrl: `/running-${index + 1}-cover.jpg`,
      startedAt: "2026-09-21T12:00:00Z",
      checkpointedAt: "2026-09-21T12:00:00Z",
    }),
  );
  useAppStore.setState({
    activeView: "now",
    activeSessions: running,
    settings: {
      ...useAppStore.getState().settings,
      viewShowHero: { now: true, achievements: true },
      libraryFeaturedGame: { gameId: -1, source: "custom" },
    },
    customHeroArt: {
      [customHeroArtKey(running[0])]: "/first-running-banner.jpg",
      [customHeroArtKey(entry(-1, "Library favorite"))]: "/library-banner.jpg",
    },
  });

  function expectRunningGame(name: string, artwork: string) {
    expect(banner()).toBeNull();
    expect(container.querySelector(".active-hero h2")?.textContent).toBe(name);
    for (const selector of [".titlebar-art img", ".view-backdrop img"]) {
      expect(container.querySelector(selector)?.getAttribute("src")).toBe(
        artwork,
      );
    }
    expect(
      [...container.querySelectorAll("button")].some((button) =>
        /^(Show|Hide) banner$/.test(button.textContent?.trim() ?? ""),
      ),
    ).toBe(false);
  }

  await act(() => root.render(<App />));
  expectRunningGame("First running game", "/first-running-banner.jpg");

  await act(() => useAppStore.getState().setActiveView("achievements"));
  expect(banner()?.querySelector("h2")?.textContent).toBe("Library favorite");
  await act(() => useAppStore.getState().setActiveView("now"));
  expectRunningGame("First running game", "/first-running-banner.jpg");

  await act(() => useAppStore.setState({ activeSessions: [running[1]] }));
  expectRunningGame("Second running game", running[1].coverUrl);

  await act(() => useAppStore.setState({ activeSessions: [] }));
  expect(banner()).toBeNull();
  expect(container.querySelector(".titlebar-art")).toBeNull();
  expect(container.querySelector(".view-backdrop")).toBeNull();
  expect(container.textContent).toContain("No game detected");
});

it("loads a saved banner before opening My Games and follows new play evidence", async () => {
  useAppStore.getState().setViewShowHero("achievements", true);
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
  useAppStore.getState().setViewShowHero("achievements", true);
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
  await act(() => useAppStore.getState().setActiveView("achievements"));
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
  useAppStore.getState().setViewShowHero("achievements", true);
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
