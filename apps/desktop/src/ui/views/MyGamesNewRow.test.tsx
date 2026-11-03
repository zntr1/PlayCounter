// @vitest-environment happy-dom
import type { LibraryProviderId } from "@playcounter/shared";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { commitLibraryImports } from "../../library/commit";
import { buildLibraryImportCommit } from "../../library/importPlan";
import { useAppStore, type ExeCacheEntry } from "../../store";
import { launchGame } from "../../tracker";
import { LibraryTestShell } from "./libraryTestShell";

vi.mock("../../tracker");
vi.mock("../../platform", () => ({ currentPlatform: () => "windows" }));
vi.mock("../../gameDetails", () => ({
  useGameDetails: () => ({ status: "empty" }),
}));

// Tuesday 3 November 2026, 20:00 local time.
const NOW = new Date(2026, 10, 3, 20, 0).getTime();
const HOUR = 3_600_000;
const hoursAgo = (hours: number) => new Date(NOW - hours * HOUR).toISOString();

let root: Root;
let container: HTMLDivElement;
let nextGameId = 1;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(Date, "now").mockReturnValue(NOW);
  localStorage.clear();
  nextGameId = 1;
  useAppStore.setState(useAppStore.getInitialState(), true);
  useAppStore.setState({
    activeView: "games",
    settings: {
      ...useAppStore.getState().settings,
      gameLaunchingEnabled: false,
      libraryShowShelves: false,
    },
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

/** A game PlayCounter found on its own (a game file, Add game, a watch folder). */
function addOwnGame(name: string, addedAt: string) {
  const gameId = -nextGameId++;
  const exeName = `${name.replace(/\W+/g, "")}.exe`;
  const entry: ExeCacheEntry = {
    exeName,
    state: "matched",
    gameId,
    gameName: name,
    source: "custom",
    lastCheckedAt: addedAt,
    addedAt,
  };
  useAppStore.setState((state) => ({
    exeCache: new Map([...state.exeCache, [exeName, entry]]),
  }));
  return gameId;
}

/** Games a launcher import brought in, each a few milliseconds apart. */
function importGames(
  provider: LibraryProviderId,
  names: readonly string[],
  importedAt: string,
) {
  const start = Date.parse(importedAt);
  commitLibraryImports(
    names.map((name, index) => {
      const gameId = nextGameId++;
      const commit = buildLibraryImportCommit({
        provider,
        now: new Date(start + index * 3).toISOString(),
        scanned: {
          externalId: String(gameId * 100),
          playtimeSeconds: 0,
          installed: false,
          executables: [],
        },
        resolved: {
          key: `${provider}:${gameId * 100}`,
          status: "resolved",
          game: {
            id: gameId,
            igdbId: gameId * 100,
            name,
            coverUrl: "",
            source: "igdb",
          },
          executables: [],
        },
      });
      expect(commit).not.toBeNull();
      return commit!;
    }),
  );
}

const render = () => act(() => root.render(<LibraryTestShell />));
const row = () =>
  container.querySelector<HTMLElement>('section[aria-label="New games"]');
// A card's name, without the .exe name it shows on hover.
const shownName = (heading: Element) =>
  (heading.querySelector(".game-card-name-default") ?? heading).textContent;
const rowCardNames = () =>
  [...row()!.querySelectorAll("article h3")].map(shownName);
const button = (name: string, scope: ParentNode = container) => {
  const found = [...scope.querySelectorAll<HTMLButtonElement>("button")].find(
    (element) =>
      element.getAttribute("aria-label") === name ||
      element.textContent?.trim() === name,
  );
  expect(found, `button "${name}"`).toBeDefined();
  return found!;
};
const hasButton = (name: string, scope: ParentNode) =>
  [...scope.querySelectorAll("button")].some(
    (element) =>
      element.getAttribute("aria-label") === name ||
      element.textContent?.trim() === name,
  );
// The New badges on the list's cards.
const newBadges = () =>
  container.querySelectorAll(
    'span[title="Added in the last 7 days, not played yet"]',
  ).length;
const libraryTitle = () =>
  [...container.querySelectorAll("h2")].find(
    (heading) => heading.textContent === "All games",
  )!;

it("shows the new games above the library, newest first, on small cards (plan 1, 2)", async () => {
  addOwnGame("Balatro", hoursAgo(50));
  addOwnGame("Hollow Knight: Silksong", hoursAgo(2));
  const played = addOwnGame("Elden Ring", hoursAgo(24 * 200));
  useAppStore.setState({
    recentSessions: [
      {
        id: 1,
        gameId: played,
        gameName: "Elden Ring",
        exeName: "EldenRing.exe",
        coverUrl: "",
        source: "custom",
        startedAt: hoursAgo(5),
        endedAt: hoursAgo(3),
        durationSeconds: 2 * 3_600,
      },
    ],
  });
  await render();

  expect(row()).not.toBeNull();
  expect(
    row()!.compareDocumentPosition(libraryTitle()) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(rowCardNames()).toEqual(["Hollow Knight: Silksong", "Balatro"]);
  expect(row()!.textContent).toContain("Added today");
  expect(row()!.textContent).toContain("Added 2 days ago");
  // Everything in the row is new and unplayed: no badge, no playtime.
  expect(row()!.querySelectorAll("article")[0].textContent).not.toContain(
    "New",
  );
  expect(row()!.textContent).not.toContain("sessions");
  // The list below keeps them too.
  const listNames = [...container.querySelectorAll("article h2")].map(
    shownName,
  );
  expect(listNames).toEqual(
    expect.arrayContaining([
      "Hollow Knight: Silksong",
      "Balatro",
      "Elden Ring",
    ]),
  );
});

it("shows one line and opens the rest with Show all (plan 3)", async () => {
  // Room for three 150 px cards.
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(500);
  for (const [index, name] of ["A", "B", "C", "D", "E"].entries())
    addOwnGame(`Game ${name}`, hoursAgo(index + 1));
  await render();

  expect(rowCardNames()).toEqual(["Game A", "Game B", "Game C"]);
  await act(() => button("Show all 5", row()!).click());
  expect(rowCardNames()).toEqual([
    "Game A",
    "Game B",
    "Game C",
    "Game D",
    "Game E",
  ]);
  await act(() => button("Show less", row()!).click());
  expect(rowCardNames()).toEqual(["Game A", "Game B", "Game C"]);
});

it("drops a game from the row the moment it starts (plan 4)", async () => {
  const gameId = addOwnGame("Hollow Knight: Silksong", hoursAgo(2));
  addOwnGame("Balatro", hoursAgo(50));
  await render();
  expect(rowCardNames()).toEqual(["Hollow Knight: Silksong", "Balatro"]);

  // Running for 5 seconds: before Last played moves it up (30 s).
  await act(() =>
    useAppStore.setState({
      activeSessions: [
        {
          id: 7,
          gameId,
          gameName: "Hollow Knight: Silksong",
          exeName: "HollowKnightSilksong.exe",
          coverUrl: "",
          source: "custom",
          startedAt: new Date(NOW - 5_000).toISOString(),
          checkpointedAt: new Date(NOW).toISOString(),
        },
      ],
    }),
  );
  expect(rowCardNames()).toEqual(["Balatro"]);
  expect(newBadges()).toBe(1);
});

it("counts pressing Play as playing, also for a game it can't track yet (plan 4)", async () => {
  vi.mocked(launchGame).mockResolvedValue("launched");
  useAppStore.setState((state) => ({
    settings: { ...state.settings, gameLaunchingEnabled: true },
  }));
  const gameId = addOwnGame("Hollow Knight: Silksong", hoursAgo(2));
  addOwnGame("Balatro", hoursAgo(50));
  useAppStore.setState({
    manualLaunchTargets: new Map([
      [
        `${gameId}:custom`,
        {
          exeName: "HollowKnightSilksong.exe",
          path: "C:/Games/HollowKnightSilksong.exe",
          owner: { gameId, source: "custom" as const },
        },
      ],
    ]),
  });
  await render();

  await act(async () =>
    row()!
      .querySelector<HTMLButtonElement>(
        '[aria-label="Play Hollow Knight: Silksong"]',
      )!
      .click(),
  );
  expect(launchGame).toHaveBeenCalledOnce();
  // No session appeared: the press alone counts.
  expect(useAppStore.getState().activeSessions).toEqual([]);
  expect(rowCardNames()).toEqual(["Balatro"]);
  expect(newBadges()).toBe(1);
});

it("shows no badges or warnings on the small cards (plan 2)", async () => {
  importGames("steam", ["Portal 2"], hoursAgo(3));
  const balatro = addOwnGame("Balatro", hoursAgo(50));
  useAppStore
    .getState()
    .updateGameJournal(
      { gameId: balatro, source: "custom", gameName: "Balatro" },
      { favorite: true, status: "playing" },
    );
  await render();

  const inList = (name: string) =>
    [...container.querySelectorAll("article")].find(
      (card) =>
        !row()!.contains(card) &&
        [...card.querySelectorAll("h2")].some(
          (heading) => shownName(heading) === name,
        ),
    )!;
  const badgesAndWarnings = (card: Element) =>
    [
      card.querySelector('[aria-label="Favorite"]'),
      card.querySelector('[aria-label^="Status: "]'),
      card.textContent?.includes("How this file was matched") || null,
      card.textContent?.includes("New sessions won't be tracked yet") || null,
    ].filter(Boolean).length;
  // The list's cards keep them; the row's small cards show none.
  expect(badgesAndWarnings(inList("Balatro"))).toBe(3);
  expect(badgesAndWarnings(inList("Portal 2"))).toBe(1);
  for (const card of row()!.querySelectorAll("article")) {
    expect(badgesAndWarnings(card)).toBe(0);
  }
});

it("makes one card of a launcher's import and opens it with its Show all (plan 5)", async () => {
  importGames(
    "steam",
    ["Portal 2", "Half-Life 2", "Celeste", "Hades", "Tunic", "Inside"],
    hoursAgo(23),
  );
  addOwnGame("Hollow Knight: Silksong", hoursAgo(2));
  await render();

  expect(rowCardNames()).toEqual(["Hollow Knight: Silksong", "Steam import"]);
  const importCard = row()!.querySelectorAll("article")[1];
  expect(importCard.textContent).toContain("6 games");
  expect(importCard.textContent).toContain("Added yesterday");

  // Show all 6 shows those 6 games and nothing else.
  await act(() => button("Show all 6", importCard).click());
  expect(rowCardNames()).toEqual([
    "Inside",
    "Tunic",
    "Hades",
    "Celeste",
    "Half-Life 2",
    "Portal 2",
  ]);
  expect(row()!.textContent).toContain("Steam import, 6 new games");
  // The way back sits right after that line, instead of Show less on the
  // far right. Mark all as seen would mark more than these 6: not here.
  const back = button("Back to all new games", row()!);
  expect(back.previousElementSibling?.textContent).toBe(
    "Steam import, 6 new games",
  );
  expect(hasButton("Show less", row()!)).toBe(false);
  expect(hasButton("Mark all as seen", row()!)).toBe(false);

  await act(() => back.click());
  expect(rowCardNames()).toEqual(["Hollow Knight: Silksong", "Steam import"]);
});

it("opens only its own import when two launchers brought games (plan 5)", async () => {
  // Room for three 150 px cards: the opened import needs more than one line.
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(500);
  importGames(
    "epic",
    ["Rocket League", "Fortnite", "Alan Wake 2", "Control", "Hades"],
    hoursAgo(20),
  );
  importGames(
    "battlenet",
    [
      "Diablo IV",
      "Overwatch 2",
      "StarCraft II",
      "Hearthstone",
      "World of Warcraft",
    ],
    hoursAgo(5),
  );
  addOwnGame("Hollow Knight: Silksong", hoursAgo(2));
  await render();
  expect(rowCardNames()).toEqual([
    "Hollow Knight: Silksong",
    "Battle.net import",
    "Epic Games import",
  ]);

  // Only Battle.net's games: no game outside the import, no Epic card.
  const battleNet = row()!.querySelectorAll("article")[1];
  await act(() => button("Show all 5", battleNet).click());
  expect(rowCardNames()).toEqual([
    "World of Warcraft",
    "Hearthstone",
    "StarCraft II",
    "Overwatch 2",
    "Diablo IV",
  ]);
  expect(row()!.textContent).toContain("Battle.net import, 5 new games");

  await act(() => button("Back to all new games", row()!).click());
  expect(rowCardNames()).toEqual([
    "Hollow Knight: Silksong",
    "Battle.net import",
    "Epic Games import",
  ]);
});

it("draws a big import's games in batches, like the list (plan 14)", async () => {
  // No IntersectionObserver here: batches come with Show more games, the
  // way the list's own fallback works. Room for three cards per line.
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(500);
  importGames(
    "steam",
    Array.from({ length: 30 }, (_, index) => `Game ${index + 1}`),
    hoursAgo(23),
  );
  for (const name of ["Balatro", "Celeste", "Tunic"]) {
    addOwnGame(name, hoursAgo(30));
  }
  await render();
  const steam = row()!.querySelectorAll("article")[0];

  await act(() => button("Show all 30", steam).click());
  expect(rowCardNames()).toHaveLength(12);
  await act(() => button("Show more games", row()!).click());
  expect(rowCardNames()).toHaveLength(24);
  await act(() => button("Show more games", row()!).click());
  expect(rowCardNames()).toHaveLength(30);
  expect(hasButton("Show more games", row()!)).toBe(false);

  // The header's Show all draws in batches too.
  await act(() => button("Back to all new games", row()!).click());
  await act(() => button("Show all 33", row()!).click());
  expect(rowCardNames()).toHaveLength(12);
});

it("keeps an import of fewer than 5 games as single cards (plan 5)", async () => {
  importGames("steam", ["Portal 2", "Celeste", "Hades", "Tunic"], hoursAgo(23));
  await render();
  expect(rowCardNames()).toEqual(["Tunic", "Hades", "Celeste", "Portal 2"]);
});

it("folds into one line that names the games, and stays folded (plan 6)", async () => {
  addOwnGame("Balatro", hoursAgo(50));
  addOwnGame("Hollow Knight: Silksong", hoursAgo(2));
  await render();

  await act(() => button("Fold the row", row()!).click());
  expect(useAppStore.getState().settings.libraryNewRowCollapsed).toBe(true);
  expect(row()!.querySelectorAll("article")).toHaveLength(0);
  expect(row()!.textContent).toContain("Hollow Knight: Silksong and Balatro");
  // Folded, the row can still be cleared.
  expect(hasButton("Mark all as seen", row()!)).toBe(true);

  await act(() => root.unmount());
  root = createRoot(container);
  await render();
  expect(row()!.querySelectorAll("article")).toHaveLength(0);

  await act(() => button("Show the row", row()!).click());
  expect(rowCardNames()).toEqual(["Hollow Knight: Silksong", "Balatro"]);
  expect(useAppStore.getState().settings.libraryNewRowCollapsed).toBe(false);
});

it("hides the row from its menu and brings it back in Customize (plan 7)", async () => {
  addOwnGame("Hollow Knight: Silksong", hoursAgo(2));
  await render();

  await act(() => button("More options for the New games row", row()!).click());
  await act(() => button("Hide row", document).click());
  expect(row()).toBeNull();
  expect(useAppStore.getState().settings.libraryShowNewRow).toBe(false);
  expect(useAppStore.getState().toasts[0]).toMatchObject({
    title: "New games row hidden",
    detail: "Turn it back on in Customize, next to the view buttons.",
  });

  await act(() => button("Customize library view").click());
  const toggle = document.querySelector<HTMLInputElement>(
    "#library-show-new-row",
  )!;
  expect(toggle.checked).toBe(false);
  await act(() => toggle.click());
  expect(row()).not.toBeNull();
  expect(useAppStore.getState().settings.libraryShowNewRow).toBe(true);
});

it("shows the new games of the open launcher tab only (plan 8)", async () => {
  importGames("steam", ["Portal 2"], hoursAgo(3));
  importGames("epic", ["Rocket League"], hoursAgo(4));
  addOwnGame("Hollow Knight: Silksong", hoursAgo(2));
  await render();
  expect(rowCardNames()).toEqual([
    "Hollow Knight: Silksong",
    "Portal 2",
    "Rocket League",
  ]);

  await act(() => useAppStore.getState().setLibraryTab("steam"));
  expect(rowCardNames()).toEqual(["Portal 2"]);
});

it("has no row with the Recently added sort or while searching (plan 9)", async () => {
  addOwnGame("Hollow Knight: Silksong", hoursAgo(2));
  await render();
  expect(row()).not.toBeNull();

  await act(() => useAppStore.getState().setMyGamesSortKey("added"));
  expect(row()).toBeNull();
  await act(() => useAppStore.getState().setMyGamesSortKey("recent"));
  expect(row()).not.toBeNull();

  await act(() => useAppStore.getState().setLibraryQuery("hollow"));
  expect(row()).toBeNull();
});

it("marks every new game as seen: out of the row, no New badge (plan 12)", async () => {
  addOwnGame("Balatro", hoursAgo(50));
  addOwnGame("Hollow Knight: Silksong", hoursAgo(2));
  await render();
  expect(newBadges()).toBe(2);

  await act(() => button("Mark all as seen", row()!).click());
  expect(row()).toBeNull();
  expect(newBadges()).toBe(0);
  expect(useAppStore.getState().settings.libraryNewGamesSeenAt).toBe(
    new Date(NOW).toISOString(),
  );

  // An hour later a game comes in: it is new, the others stay seen.
  vi.mocked(Date.now).mockReturnValue(NOW + HOUR);
  await act(() => {
    addOwnGame("Celeste", new Date(NOW + HOUR / 2).toISOString());
  });
  expect(rowCardNames()).toEqual(["Celeste"]);
  expect(newBadges()).toBe(1);
});

it("marks one game as seen with the × on its small card (plan 13)", async () => {
  addOwnGame("Balatro", hoursAgo(50));
  addOwnGame("Hollow Knight: Silksong", hoursAgo(2));
  await render();

  const silksong = row()!.querySelectorAll("article")[0];
  await act(() => button("Mark as seen", silksong).click());
  expect(rowCardNames()).toEqual(["Balatro"]);
  expect(newBadges()).toBe(1);
});

it("marks a whole import as seen with the × on its card (plan 13)", async () => {
  importGames(
    "steam",
    ["Portal 2", "Half-Life 2", "Celeste", "Hades", "Tunic"],
    hoursAgo(23),
  );
  addOwnGame("Hollow Knight: Silksong", hoursAgo(2));
  await render();
  expect(newBadges()).toBe(6);

  const steam = row()!.querySelectorAll("article")[1];
  await act(() => button("Mark as seen", steam).click());
  expect(rowCardNames()).toEqual(["Hollow Knight: Silksong"]);
  expect(newBadges()).toBe(1);
});

it("forgets a mark once its game can't be new any more (plan 13)", () => {
  useAppStore.getState().markNewGamesSeen(["custom:-1"]);
  vi.mocked(Date.now).mockReturnValue(NOW + 7 * 24 * HOUR);
  useAppStore.getState().markNewGamesSeen(["custom:-2"]);
  expect(
    Object.keys(useAppStore.getState().settings.libraryNewGamesSeen ?? {}),
  ).toEqual(["custom:-2"]);
});
