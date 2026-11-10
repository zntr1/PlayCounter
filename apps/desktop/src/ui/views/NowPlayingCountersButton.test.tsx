// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { commitLibraryImports } from "../../library/commit";
import { buildLibraryImportCommit } from "../../library/importPlan";
import { addGameWithoutFile } from "../../library/manualAdd";
import { useAppStore, type ActiveSession } from "../../store";
import { useGameDetailsRequest } from "../openGameDetails";
import { ActiveGameHero } from "./ActiveGameHero";
import { LibraryTestShell } from "./libraryTestShell";

vi.mock("../../tracker");
vi.mock("../../platform", () => ({ currentPlatform: () => "windows" }));
vi.mock("../../gameDetails", () => ({
  useGameDetails: () => ({ status: "empty" }),
}));

let root: Root;
let container: HTMLDivElement;

const running: ActiveSession = {
  id: 1,
  gameId: 7,
  gameName: "Elden Ring",
  exeName: "eldenring.exe",
  coverUrl: "",
  source: "igdb",
  startedAt: "2026-11-08T10:00:00.000Z",
  checkpointedAt: "2026-11-08T11:00:00.000Z",
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  useAppStore.setState(useAppStore.getInitialState(), true);
  useGameDetailsRequest.setState({ request: null });
  useAppStore.setState({
    activeView: "now",
    settings: {
      ...useAppStore.getState().settings,
      libraryShowShelves: false,
      libraryShowNewRow: false,
    },
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function renderHero(showCounters: boolean) {
  const state = useAppStore.getState();
  await act(() =>
    root.render(
      <ActiveGameHero
        session={running}
        elapsedSeconds={3600}
        recentSessions={[]}
        showDurationDays={false}
        exeCache={state.exeCache}
        resolveIgdbId={() => undefined}
        archivedGameSeconds={{}}
        playtimeAdjustments={{}}
        statusLabel="Now playing"
        showCounters={showCounters}
      />,
    ),
  );
}

const buttonNamed = (scope: ParentNode, label: string) =>
  [...scope.querySelectorAll("button")].find(
    (button) => button.textContent?.trim() === label,
  );

function addEldenRing() {
  addGameWithoutFile({
    id: 7,
    igdbId: 700,
    name: "Elden Ring",
    coverUrl: "",
    source: "igdb",
  });
}

const detailsDialog = () =>
  document.querySelector<HTMLElement>('[role="dialog"]');

const selectedTab = () =>
  detailsDialog()
    ?.querySelector('[role="tab"][aria-selected="true"]')
    ?.textContent?.trim();

// Phil, 2026-11-09: a "Counters" button next to "Journal" on Now Playing.
it("a running game has a Counters button next to Journal", async () => {
  await renderHero(true);
  const journal = buttonNamed(container, "Journal");
  const counters = buttonNamed(container, "Counters");
  expect(journal).toBeDefined();
  expect(counters).toBeDefined();
  expect(counters!.parentElement).toBe(journal!.parentElement);
});

// Tour cards show no counters (sample games have nothing to count).
it("a tour card has no Counters button", async () => {
  await renderHero(false);
  expect(buttonNamed(container, "Journal")).toBeDefined();
  expect(buttonNamed(container, "Counters")).toBeUndefined();
});

// Phil picked "Sprung nach My Games": the click switches the page.
it("Counters switches to My Games", async () => {
  await renderHero(true);
  await act(async () => buttonNamed(container, "Counters")!.click());
  expect(useAppStore.getState().activeView).toBe("games");
});

// ...and My Games opens the game's Details on the Counters tab.
it("My Games opens the running game's Details on the Counters tab", async () => {
  addEldenRing();
  await renderHero(true);
  await act(async () => buttonNamed(container, "Counters")!.click());
  await act(() => root.render(<LibraryTestShell />));

  expect(detailsDialog()?.textContent).toContain("Elden Ring");
  expect(selectedTab()).toBe("Counters");
});

// The jump must work although the library's search hides the card.
it("opens the Details even when the search hides the game's card", async () => {
  addEldenRing();
  useAppStore.getState().setLibraryQuery("zelda");
  await renderHero(true);
  await act(async () => buttonNamed(container, "Counters")!.click());
  await act(() => root.render(<LibraryTestShell />));

  expect(container.querySelector(".game-library-card")).toBeNull();
  expect(selectedTab()).toBe("Counters");
});

// Closing leaves you in My Games, and the dialog stays closed.
it("closing the Details leaves you in My Games", async () => {
  addEldenRing();
  await renderHero(true);
  await act(async () => buttonNamed(container, "Counters")!.click());
  await act(() => root.render(<LibraryTestShell />));

  const close = detailsDialog()!.querySelector<HTMLButtonElement>(
    'button[aria-label="Close"]',
  );
  await act(async () => close!.click());
  expect(detailsDialog()).toBeNull();
  expect(useAppStore.getState().activeView).toBe("games");

  // Coming back to My Games later doesn't reopen it.
  await act(() => root.render(<div />));
  await act(() => root.render(<LibraryTestShell />));
  expect(detailsDialog()).toBeNull();
});

/** Elden Ring as the database matched its file: a file that can be reported. */
function matchEldenRingFile() {
  useAppStore.getState().setExeCacheEntry({
    exeName: "eldenring.exe",
    state: "matched",
    gameId: 7,
    igdbId: 700,
    gameName: "Elden Ring",
    coverUrl: "",
    source: "igdb",
    lastCheckedAt: "2026-11-08T10:00:00.000Z",
  });
}

/** Elden Ring from Steam: a launcher game that can move to PlayCounter. */
function importEldenRingFromSteam() {
  commitLibraryImports([
    buildLibraryImportCommit({
      provider: "steam",
      now: "2026-11-08T10:00:00.000Z",
      scanned: {
        externalId: "1245620",
        playtimeSeconds: 3600,
        lastPlayedUnix: Date.parse("2026-11-08T10:00:00.000Z") / 1000,
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
}

async function jumpToCounters() {
  await renderHero(true);
  await act(async () => buttonNamed(container, "Counters")!.click());
  await act(() => root.render(<LibraryTestShell />));
}

async function openDetailsTab(name: string) {
  const tab = [
    ...detailsDialog()!.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
  ].find((entry) => entry.textContent?.startsWith(name));
  expect(tab, `missing ${name} tab`).toBeDefined();
  await act(async () => tab!.click());
}

// Phil, 2026-11-10: the jump's Details is the card's own, with every action.
it("the jump's Details reports a file, as the card's Details does", async () => {
  matchEldenRingFile();
  await jumpToCounters();
  await openDetailsTab("Files");

  const report = buttonNamed(detailsDialog()!, "Report");
  expect(report, "missing Report").toBeDefined();
  await act(async () => report!.click());
  expect(document.body.textContent).toContain("It's a different game");
});

it("the jump's Details moves a launcher game to PlayCounter", async () => {
  importEldenRingFromSteam();
  await jumpToCounters();
  await openDetailsTab("Files");

  const move = buttonNamed(detailsDialog()!, "Move to PlayCounter");
  expect(move, "missing Move to PlayCounter").toBeDefined();
  await act(async () => move!.click());
  // Details gives way to the card's move dialog.
  const moveDialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
  expect(moveDialog.textContent).toContain("Move to PlayCounter?");
  await act(async () =>
    buttonNamed(moveDialog, "Move to PlayCounter")!.click(),
  );
  expect(useAppStore.getState().playcounterLibrary.size).toBe(1);
});
