// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useAppStore } from "../store";
import type { LibraryImportEntry } from "../library/types";
import { App } from "./App";
import { useLibrarySources } from "./librarySources";

vi.mock("../tracker");
vi.mock("../platform", () => ({ currentPlatform: () => "windows" }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: async () => "1.1.18" }));
vi.mock("@tauri-apps/plugin-autostart", () => ({
  isEnabled: async () => true,
  enable: async () => {},
  disable: async () => {},
}));
vi.mock("./tour/TourUI", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./tour/TourUI")>()),
  WelcomePrompt: () => null,
  TourOverlay: () => null,
}));

const imported: LibraryImportEntry = {
  provider: "steam",
  externalId: "100",
  gameId: 1,
  igdbId: 100,
  source: "igdb",
  name: "Imported game",
  coverUrl: "",
  importedAt: "2026-09-22T12:00:00Z",
  lastReadAt: "2026-09-22T12:00:00Z",
  providerSeconds: 0,
  linkedExeNames: [],
  linkedExeSources: [],
};
let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(document, "elementFromPoint").mockReturnValue(null);
  localStorage.clear();
  useAppStore.setState(useAppStore.getInitialState(), true);
  useLibrarySources.setState(useLibrarySources.getInitialState(), true);
  useAppStore.setState({
    activeView: "games",
    lastSeenReleaseNotesVersion: "1.1.18",
    exeCache: new Map([
      [
        "local.exe",
        {
          exeName: "local.exe",
          gameId: -1,
          gameName: "Local game",
          source: "custom",
          state: "matched",
          lastCheckedAt: imported.importedAt,
        },
      ],
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

function sourceToggle() {
  return container.querySelector<HTMLButtonElement>(
    'button[aria-label="Show sources"], button[aria-label="Hide sources"]',
  );
}

function sources() {
  return container.querySelector('[aria-label="Game library source"]');
}

it("keeps an empty My Games non-expandable", async () => {
  useAppStore.setState({ exeCache: new Map() });
  await act(() => root.render(<App />));
  expect(sourceToggle()).toBeNull();
  expect(sources()).toBeNull();
  expect(container.querySelector('[data-tour="nav-games"]')?.textContent).toBe(
    "My Games0",
  );
});

it("offers launcher imports once a game is tracked, before any import", async () => {
  useAppStore.getState().setMyGamesHideEmptyProviderTabs(true);
  await act(() => root.render(<App />));
  expect(sourceToggle()?.getAttribute("aria-expanded")).toBe("true");
  await act(() =>
    container.querySelector<HTMLButtonElement>("#library-tab-steam")!.click(),
  );
  expect(useAppStore.getState().libraryTab).toBe("steam");
  expect(container.textContent).toContain("Import from Steam");
});

it("keeps launcher groups after the last import is removed", async () => {
  await act(() => root.render(<App />));
  await act(() =>
    useAppStore.setState({
      libraryImports: new Map([["steam:100", imported]]),
    }),
  );
  expect(sourceToggle()?.getAttribute("aria-expanded")).toBe("true");
  expect(sources()).not.toBeNull();
  await act(() => sourceToggle()!.click());
  expect(sourceToggle()?.getAttribute("aria-expanded")).toBe("false");
  expect(sources()).toBeNull();
  await act(() => sourceToggle()!.click());
  await act(() =>
    container.querySelector<HTMLButtonElement>("#library-tab-steam")!.click(),
  );
  expect(useAppStore.getState().libraryTab).toBe("steam");

  await act(() => useAppStore.setState({ libraryImports: new Map() }));
  expect(sources()).not.toBeNull();
  expect(useAppStore.getState().libraryTab).toBe("steam");
  expect(container.querySelectorAll(".game-library-card")).toHaveLength(0);
});

it("removes the expandable structure when launcher groups are hidden and restores the saved collapse preference", async () => {
  useAppStore.setState({ libraryImports: new Map([["steam:100", imported]]) });
  useAppStore.getState().setSidebarSourcesCollapsed(true);
  await act(() => root.render(<App />));
  expect(sourceToggle()?.getAttribute("aria-expanded")).toBe("false");

  await act(() => useAppStore.getState().setMyGamesShowProviderTabs(false));
  expect(sourceToggle()).toBeNull();
  expect(sources()).toBeNull();
  expect(container.querySelector('[data-tour="nav-games"]')?.textContent).toBe(
    "My Games2",
  );
  expect(container.querySelectorAll(".game-library-card")).toHaveLength(2);

  await act(() => useAppStore.getState().setMyGamesShowProviderTabs(true));
  expect(sourceToggle()?.getAttribute("aria-expanded")).toBe("false");
  expect(sources()).toBeNull();
  await act(() => sourceToggle()!.click());
  expect(sources()).not.toBeNull();
});
