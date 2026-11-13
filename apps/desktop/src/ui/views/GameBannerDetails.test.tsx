// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { commitLibraryImports } from "../../library/commit";
import { buildLibraryImportCommit } from "../../library/importPlan";
import { useAppStore } from "../../store";
import { useLibrarySources } from "../librarySources";
import { useGameDetailsRequest } from "../openGameDetails";
import { ViewBanner } from "../ViewBanner";
import { LibraryTestShell } from "./libraryTestShell";
import { MyGamesView } from "./MyGamesView";

vi.mock("../../tracker");
vi.mock("../../platform", () => ({ currentPlatform: () => "windows" }));
vi.mock("../../gameDetails", () => ({
  useGameDetails: () => ({ status: "empty" }),
}));

const DATE = "2026-11-08T10:00:00.000Z";
let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  useAppStore.setState(useAppStore.getInitialState(), true);
  useLibrarySources.setState(useLibrarySources.getInitialState(), true);
  useGameDetailsRequest.setState({ request: null });
  useAppStore.setState({
    activeView: "games",
    settings: {
      ...useAppStore.getState().settings,
      libraryShowShelves: false,
      libraryShowNewRow: false,
    },
  });
  // Elden Ring from Steam (it can move to PlayCounter), with a file the
  // database matched (it can be reported).
  commitLibraryImports([
    buildLibraryImportCommit({
      provider: "steam",
      now: DATE,
      scanned: {
        externalId: "1245620",
        playtimeSeconds: 3600,
        lastPlayedUnix: Date.parse(DATE) / 1000,
        installed: false,
        executables: [],
      },
      resolved: {
        key: "steam:1245620",
        status: "resolved",
        game: {
          id: 7,
          igdbId: 700,
          source: "igdb",
          name: "Elden Ring",
          coverUrl: "",
        },
        executables: [],
      },
    })!,
  ]);
  useAppStore.getState().setExeCacheEntry({
    exeName: "eldenring.exe",
    state: "matched",
    gameId: 7,
    igdbId: 700,
    gameName: "Elden Ring",
    coverUrl: "",
    source: "igdb",
    lastCheckedAt: DATE,
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

const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');

const buttonNamed = (scope: ParentNode, label: string) =>
  [...scope.querySelectorAll("button")].find(
    (button) => button.textContent?.trim() === label,
  );

async function openBannerDetails() {
  const moreInfo = buttonNamed(container, "More Info");
  expect(moreInfo, "missing More Info").toBeDefined();
  await act(async () => moreInfo!.click());
  expect(dialog()?.textContent).toContain("Elden Ring");
}

async function openFilesTab() {
  const tab = [
    ...dialog()!.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
  ].find((entry) => entry.textContent?.startsWith("Files"));
  expect(tab, "missing Files tab").toBeDefined();
  await act(async () => tab!.click());
}

// Phil, 2026-11-10: the banner's Details is the card's own, with every action.
it("the My Games banner's Details has Report and Move to PlayCounter", async () => {
  await act(() => root.render(<LibraryTestShell />));
  await openBannerDetails();
  await openFilesTab();

  expect(buttonNamed(dialog()!, "Report")).toBeDefined();
  expect(buttonNamed(dialog()!, "Move to PlayCounter")).toBeDefined();
});

// Another page's banner opens it in place, before My Games was ever opened.
it("the banner on another page opens the same Details there", async () => {
  useAppStore.setState({ activeView: "history" });
  await act(() =>
    root.render(
      <>
        <ViewBanner view="history" onArtworkChange={() => {}} />
        {/* As App keeps it on other pages: the library's data, no cards. */}
        <MyGamesView renderContent={false} />
      </>,
    ),
  );
  expect(container.querySelector(".game-library-card")).toBeNull();
  await openBannerDetails();
  await openFilesTab();

  expect(buttonNamed(dialog()!, "Report")).toBeDefined();
  expect(buttonNamed(dialog()!, "Move to PlayCounter")).toBeDefined();
  expect(useAppStore.getState().activeView).toBe("history");
});

/** Another page with its banner, and My Games kept mounted as App does. */
const otherPage = (renderContent: boolean, parked = false) => (
  <>
    <ViewBanner view="history" onArtworkChange={() => {}} />
    <MyGamesView renderContent={renderContent} parked={parked} />
  </>
);

async function closeDetails() {
  const close = dialog()!.querySelector<HTMLButtonElement>(
    'button[aria-label="Close"]',
  );
  await act(async () => close!.click());
  expect(dialog()).toBeNull();
}

// Closed stays closed, also when My Games builds it again: on the first
// visit to My Games, and when the window comes back from the tray.
it("a closed Details doesn't open again by itself", async () => {
  useAppStore.setState({ activeView: "history" });
  await act(() => root.render(otherPage(false)));
  await openBannerDetails();
  await closeDetails();

  await act(() => root.render(otherPage(true)));
  expect(dialog()).toBeNull();
  await act(() => root.render(otherPage(true, true)));
  await act(() => root.render(otherPage(true)));
  expect(dialog()).toBeNull();
});

it("More Info opens Details again after it was closed", async () => {
  useAppStore.setState({ activeView: "history" });
  await act(() => root.render(otherPage(false)));
  await openBannerDetails();
  await closeDetails();

  await openBannerDetails();
});
