// @vitest-environment happy-dom
import type { Session } from "@playcounter/shared";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { LibraryImportEntry } from "../../library/types";
import {
  getGameJournal,
  useAppStore,
  type ExeCacheEntry,
  type GameIdentityRef,
} from "../../store";
import type { ShelfHidePlace } from "../../personalLibrary";
import { LibraryTestShell } from "./libraryTestShell";

/* docs/hidden-shelves-plan.md: "My Games", "Shelf rail, menu, dialog",
   "Putting a game on a hiding shelf" and decisions 1 and 2. */

vi.mock("../../tracker");
vi.mock("../../platform", () => ({ currentPlatform: () => "windows" }));
vi.mock("../../gameDetails", () => ({
  useGameDetails: () => ({ status: "empty" }),
}));

const HOUR = 3_600_000;
const hoursAgo = (hours: number) =>
  new Date(Date.now() - hours * HOUR).toISOString();
const ALL_PLACES: ShelfHidePlace[] = [
  "all",
  "new",
  "history",
  "achievements",
  "nowPlaying",
];

const lethal = {
  gameId: -1,
  source: "custom" as const,
  gameName: "Lethal Company",
};
const elden = { gameId: -2, source: "custom" as const, gameName: "Elden Ring" };
const palworld = {
  gameId: -3,
  source: "custom" as const,
  gameName: "Palworld",
};
const hades = {
  gameId: 1,
  source: "igdb" as const,
  igdbId: 100,
  gameName: "Hades",
};
const dave = {
  gameId: 2,
  source: "igdb" as const,
  igdbId: 200,
  gameName: "Dave the Diver",
};

function ownGame(
  game: typeof lethal,
  addedAt: string,
): [string, ExeCacheEntry] {
  const exeName = `${game.gameName.replace(/\W+/g, "")}.exe`;
  return [
    exeName,
    {
      ...game,
      exeName,
      state: "matched",
      lastCheckedAt: addedAt,
      addedAt,
    },
  ];
}

function steamGame(game: typeof hades): [string, LibraryImportEntry] {
  return [
    `steam:${game.igdbId}`,
    {
      provider: "steam",
      externalId: String(game.igdbId),
      gameId: game.gameId,
      igdbId: game.igdbId,
      source: "igdb",
      name: game.gameName,
      coverUrl: "",
      importedAt: hoursAgo(30 * 24),
      lastReadAt: hoursAgo(30 * 24),
      providerSeconds: 0,
      linkedExeNames: [],
      linkedExeSources: [],
    },
  ];
}

function played(id: number, game: typeof lethal, hours: number): Session {
  const startedAt = hoursAgo(hours);
  return {
    id,
    gameId: game.gameId,
    source: game.source,
    gameName: game.gameName,
    coverUrl: "",
    exeName: `${game.gameName.replace(/\W+/g, "")}.exe`,
    startedAt,
    endedAt: new Date(Date.parse(startedAt) + HOUR).toISOString(),
    durationSeconds: 3600,
  };
}

let root: Root;
let container: HTMLDivElement;
let privateShelf: string;
let demos: string;
let coop: string;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(document, "elementFromPoint").mockReturnValue(null);
  localStorage.clear();
  useAppStore.setState(useAppStore.getInitialState(), true);
  useAppStore.setState({
    activeView: "games",
    settings: {
      ...useAppStore.getState().settings,
      gameLaunchingEnabled: false,
      libraryHideEmptyProviderTabs: true,
    },
    exeCache: new Map([
      ownGame(lethal, hoursAgo(30 * 24)),
      ownGame(elden, hoursAgo(30 * 24)),
      // Added two hours ago and never played: a New game.
      ownGame(palworld, hoursAgo(2)),
    ]),
    libraryImports: new Map([steamGame(hades), steamGame(dave)]),
    // Lethal Company was played last, so it would be the banner game.
    recentSessions: [played(1, lethal, 24), played(2, elden, 72)],
  });
  useAppStore.getState().setMyGamesCardSize("grid");
  const state = useAppStore.getState();
  privateShelf = state.savePersonalShelf({
    name: "Private",
    hiddenIn: ALL_PLACES,
  })!;
  demos = state.savePersonalShelf({ name: "Demos", hiddenIn: ["all"] })!;
  coop = state.savePersonalShelf({ name: "Co-op" })!;
  state.updateGameJournal(lethal, {
    favorite: true,
    shelfIds: [privateShelf, coop],
  });
  state.updateGameJournal(dave, { shelfIds: [privateShelf] });
  state.updateGameJournal(palworld, { shelfIds: [demos] });
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

const render = () => act(() => root.render(<LibraryTestShell />));
const shelf = (id: string) =>
  useAppStore.getState().personalShelves.find((entry) => entry.id === id)!;
const saveShelf = (id: string, change: Partial<ReturnType<typeof shelf>>) =>
  act(() => {
    useAppStore.getState().savePersonalShelf({ ...shelf(id), ...change });
  });
const journal = (game: GameIdentityRef) =>
  getGameJournal(useAppStore.getState(), game);

const newRow = () =>
  container.querySelector<HTMLElement>('section[aria-label="New games"]');
// Grid cards name the game in an h2, the New games row's smaller ones in an h3.
const shownName = (card: Element) =>
  card.querySelector("h2, h3")?.textContent ?? "";
/** The library grid's cards, without the New games row above it. */
const cardNames = () =>
  [...container.querySelectorAll<HTMLElement>(".game-library-card")]
    .filter((card) => !newRow()?.contains(card))
    .map(shownName)
    .sort();
const rowNames = () =>
  [...(newRow()?.querySelectorAll("article h3") ?? [])].map(
    (heading) => heading.textContent,
  );
const bannerTitle = () =>
  container.querySelector('[data-banner-variant="full"] h2')?.textContent;

function gameCard(name: string) {
  const card = [
    ...container.querySelectorAll<HTMLElement>(".game-library-card"),
  ].find((element) => shownName(element) === name);
  expect(card, `no game card for ${name}`).toBeDefined();
  return card!;
}

function shelfChip(label: string) {
  const chip = [
    ...container.querySelectorAll<HTMLButtonElement>(
      '[aria-label="Library shelf"] [role="tab"]',
    ),
  ].find((item) => item.textContent?.startsWith(label));
  expect(chip, `no shelf chip for ${label}`).toBeDefined();
  return chip!;
}

const shelfCount = (label: string) =>
  Number(shelfChip(label).lastElementChild?.textContent);

async function selectShelf(label: string) {
  await act(() => shelfChip(label).click());
}

function counts() {
  return Object.fromEntries(
    [
      ...container.querySelectorAll(
        '[aria-label="Game library source"] [role="tab"]',
      ),
    ].map((tab) => [
      tab.id.replace("library-tab-", ""),
      Number(tab.lastElementChild?.textContent),
    ]),
  );
}

const searchField = () =>
  container.querySelector<HTMLInputElement>('[placeholder="Search games..."]')!;

async function inputSearch(value: string) {
  const input = searchField();
  await act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function button(label: string, within: ParentNode = document) {
  const found = [...within.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) =>
      item.textContent?.trim() === label ||
      item.getAttribute("aria-label") === label,
  );
  expect(found, `no button for ${label}`).toBeDefined();
  return found!;
}

async function click(label: string, within: ParentNode = document) {
  await act(() => button(label, within).click());
}

async function openShelfMenu(label: string) {
  await act(() =>
    shelfChip(label).dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true }),
    ),
  );
}

async function openCardMenu(name: string) {
  await act(() =>
    gameCard(name).dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true }),
    ),
  );
}

/** A context menu row, found by the words it shows. */
function menuRow(label: string) {
  const row = [
    ...document.querySelectorAll<HTMLButtonElement>("[data-context-menu-item]"),
  ].find((item) => item.textContent?.trim() === label);
  expect(row, `no menu row labelled ${label}`).toBeDefined();
  return row!;
}

/** The items of an open submenu, found from its trigger. */
function submenu(label: string) {
  return document.getElementById(
    menuRow(label).getAttribute("aria-controls")!,
  )!;
}

const submenuItems = (label: string) => [
  ...submenu(label).querySelectorAll<HTMLButtonElement>(
    "[data-context-menu-item]",
  ),
];

function checkbox(label: string) {
  const row = [...document.querySelectorAll("label")].find((item) =>
    item.textContent?.trim().startsWith(label),
  );
  expect(row, `no checkbox labelled ${label}`).toBeDefined();
  return row!.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
}

const PLACE_LABELS = [
  "All games and search",
  "New games row and banner",
  "My History",
  "Achievements",
  "Now Playing",
];

/** Paused ticks are a small yellow warning, not a grey line (Phil, 2026-11-10). */
const pausedWarning = (scope: ParentNode) =>
  [...scope.querySelectorAll<HTMLElement>(".text-warning")].some(
    (element) =>
      element.textContent?.trim() ===
        "Hiding is paused while this shelf fills itself from filters. Remove the saved filters to hide its games again." &&
      element.querySelector(
        ".lucide-triangle-alert, .lucide-alert-triangle",
      ) !== null,
  );

const hint = () =>
  container.querySelector<HTMLElement>("[data-library-hidden-hint]");
const hintSentence = () =>
  hint()?.querySelector("[data-library-hidden-hint-text]")?.textContent;
const hintLinks = () =>
  [...(hint()?.querySelectorAll("button") ?? [])].map(
    (link) => link.textContent,
  );

// "My Games", first bullet; decision 2 for Favorites and hand-filled shelves.
it("keeps games on a shelf that hides All games out of All games, its count, the source tabs and its search; on their shelves they show and search finds them", async () => {
  await render();
  expect(cardNames()).toEqual(["Elden Ring", "Hades"]);
  expect(shelfCount("All games")).toBe(2);
  expect(counts()).toEqual({ all: 2, unimported: 1, steam: 1 });

  await inputSearch("Lethal");
  expect(cardNames()).toEqual([]);

  await selectShelf("Private");
  expect(cardNames()).toEqual(["Dave the Diver", "Lethal Company"]);
  expect(shelfCount("Private")).toBe(2);
  await inputSearch("Lethal");
  expect(cardNames()).toEqual(["Lethal Company"]);

  // Shelves the player filled, and Favorites, keep it.
  await selectShelf("Co-op");
  expect(cardNames()).toEqual(["Lethal Company"]);
  await selectShelf("Favorites");
  expect(cardNames()).toEqual(["Lethal Company"]);
});

// Decision 2.
it("leaves games hidden from All games off a shelf that fills itself from filters", async () => {
  useAppStore
    .getState()
    .savePersonalShelf({ name: "Played", filters: { played: "played" } });
  await render();
  await selectShelf("Played");
  expect(cardNames()).toEqual(["Elden Ring"]);
});

// "My Games", banner.
it("leaves a game hidden in the banner out of the library banner, also when pinned, and shows a shelf's own pinned game on that shelf", async () => {
  await saveShelf(privateShelf, { hiddenIn: ["all"] });
  await render();
  expect(bannerTitle()).toBe("Lethal Company");

  await saveShelf(privateShelf, { hiddenIn: ["all", "new"] });
  expect(bannerTitle()).toBe("Elden Ring");

  await act(() =>
    useAppStore
      .getState()
      .setLibraryFeaturedGame({ gameId: lethal.gameId, source: "custom" }),
  );
  expect(bannerTitle()).toBe("Elden Ring");

  await saveShelf(privateShelf, {
    featuredGame: { gameId: lethal.gameId, source: "custom" },
  });
  await selectShelf("Private");
  expect(bannerTitle()).toBe("Lethal Company");
});

// "My Games", New games row.
it("leaves a game hidden in the New games row out of that row on its own shelf", async () => {
  await render();
  await selectShelf("Demos");
  expect(rowNames()).toEqual(["Palworld"]);

  await saveShelf(demos, { hiddenIn: ["all", "new"] });
  expect(newRow()).toBeNull();
  expect(cardNames()).toEqual(["Palworld"]);
});

// "My Games", hint line.
it("says under All games how many games its shelves hide and opens a shelf from there, also with the shelf row switched off", async () => {
  await render();
  expect(hintSentence()).toBe("3 games are hidden here by:");
  expect(hintLinks().sort()).toEqual(["Demos", "Private"]);

  await inputSearch("Lethal");
  expect(hintSentence()).toBe("1 more match is hidden here by:");
  expect(hintLinks()).toEqual(["Private"]);

  await click("Private", hint()!);
  expect(shelfChip("Private").getAttribute("aria-selected")).toBe("true");
  expect(searchField().value).toBe("");
  expect(cardNames()).toEqual(["Dave the Diver", "Lethal Company"]);
  // Only All games has the line.
  expect(hint()).toBeNull();

  await selectShelf("All games");
  await act(() => useAppStore.getState().setMyGamesShowShelves(false));
  expect(container.querySelector('[aria-label="Library shelf"]')).toBeNull();
  await click("Private", hint()!);
  expect(useAppStore.getState().settings.libraryShowShelves).toBe(true);
  expect(shelfChip("Private").getAttribute("aria-selected")).toBe("true");
  expect(cardNames()).toEqual(["Dave the Diver", "Lethal Company"]);
});

// "Shelf rail, menu, dialog": the menu.
it("ticks places in the shelf menu's Hide in one at a time, keeps the menu open, and marks the shelf with the eye", async () => {
  await render();
  expect(
    shelfChip("Co-op").querySelector(".lucide-folder-heart"),
  ).not.toBeNull();
  await openShelfMenu("Co-op");
  await act(() => menuRow("Hide in").click());
  expect(
    submenuItems("Hide in").map((item) => item.textContent?.trim()),
  ).toEqual(PLACE_LABELS);

  await act(() => menuRow("My History").click());
  expect(shelf(coop).hiddenIn).toEqual(["history"]);
  expect(submenuItems("Hide in")).toHaveLength(5);
  await act(() => menuRow("All games and search").click());
  expect([...(shelf(coop).hiddenIn ?? [])].sort()).toEqual(["all", "history"]);
  expect(
    submenuItems("Hide in")
      .filter((item) => item.getAttribute("aria-checked") === "true")
      .map((item) => item.textContent?.trim()),
  ).toEqual(["All games and search", "My History"]);

  expect(shelfChip("Co-op").querySelector(".lucide-eye-off")).not.toBeNull();
  expect(shelfChip("Co-op").title).toContain("My History");
});

// Decision 1: a filter shelf's menu.
it("shows Hide in disabled with its line for a shelf that fills itself from filters", async () => {
  useAppStore
    .getState()
    .savePersonalShelf({ name: "Played", filters: { played: "played" } });
  await render();
  await openShelfMenu("Played");
  await act(() => menuRow("Hide in").click());
  expect(submenuItems("Hide in").every((item) => item.disabled)).toBe(true);
  expect(submenu("Hide in").textContent).toContain(
    "Only shelves you fill yourself can hide games.",
  );
});

// "Shelf rail, menu, dialog": the dialog; decision 1 for filter shelves.
it("saves the dialog's ticks with Save shelf, also for a new shelf; a filter shelf shows them disabled with its line", async () => {
  await render();
  await openShelfMenu("Co-op");
  await act(() => menuRow("Edit").click());
  expect(checkbox("Achievements").checked).toBe(false);
  await act(() => checkbox("Achievements").click());
  expect(shelf(coop).hiddenIn).toBeUndefined();
  await click("Save shelf");
  expect(shelf(coop).hiddenIn).toEqual(["achievements"]);

  await click("New shelf", container);
  const name = document.querySelector<HTMLInputElement>(
    '[aria-label="Shelf name"]',
  )!;
  await act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(name, "Junk");
    name.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(() => checkbox("All games and search").click());
  await click("Save shelf");
  expect(
    useAppStore.getState().personalShelves.find((s) => s.name === "Junk")
      ?.hiddenIn,
  ).toEqual(["all"]);

  // Ticks saved before stay, greyed out, while filters fill the shelf.
  await saveShelf(privateShelf, { filters: { played: "played" } });
  await openShelfMenu("Private");
  await act(() => menuRow("Edit").click());
  for (const label of PLACE_LABELS) {
    expect(checkbox(label).disabled).toBe(true);
    expect(checkbox(label).checked).toBe(true);
  }
  expect(pausedWarning(document.querySelector('[role="dialog"]')!)).toBe(true);
  await click("Close");

  // The menu shows the same warning.
  await openShelfMenu("Private");
  await act(() => menuRow("Hide in").click());
  expect(pausedWarning(submenu("Hide in"))).toBe(true);
  await act(() => {
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
  });

  await act(() => {
    useAppStore
      .getState()
      .savePersonalShelf({ name: "Played", filters: { played: "played" } });
  });
  await openShelfMenu("Played");
  await act(() => menuRow("Edit").click());
  expect(checkbox("Now Playing").disabled).toBe(true);
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
    "Only shelves you fill yourself can hide games.",
  );
});

// "Putting a game on a hiding shelf": the card menu.
it("marks hiding shelves in the card menu and says when a game leaves All games, with Undo", async () => {
  await render();
  await openCardMenu("Elden Ring");
  await act(() => menuRow("Shelves").click());
  const item = (label: string) =>
    submenuItems("Shelves").find((row) => row.textContent?.trim() === label)!;
  expect(item("Private").querySelector(".lucide-eye-off")).not.toBeNull();
  expect(item("Co-op").querySelector(".lucide-folder-heart")).not.toBeNull();

  // A shelf that hides nothing: the card stays, no message.
  await act(() => item("Co-op").click());
  expect(useAppStore.getState().toasts).toEqual([]);

  await openCardMenu("Elden Ring");
  await act(() => menuRow("Shelves").click());
  await act(() => item("Private").click());
  expect(cardNames()).toEqual(["Hades"]);
  const toast = useAppStore.getState().toasts[0];
  expect(toast.title).toBe("Added to Private. It's hidden from All games now.");
  expect(toast.action?.label).toBe("Undo");

  await act(() => toast.action!.run());
  expect(cardNames()).toEqual(["Elden Ring", "Hades"]);
  expect(journal(elden).shelfIds).toEqual([coop]);
});

async function pointer(
  target: EventTarget,
  type: string,
  options: PointerEventInit = {},
) {
  const event = new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    pointerId: 1,
    pointerType: "mouse",
    isPrimary: true,
    button: 0,
    buttons: type === "pointerup" ? 0 : 1,
    clientX: 120,
    clientY: 400,
    ...options,
  });
  await act(() => {
    target.dispatchEvent(event);
  });
}

async function dropGame(card: HTMLElement, label: string) {
  await pointer(card, "pointerdown");
  await pointer(window, "pointermove", { clientX: 140, clientY: 410 });
  vi.mocked(document.elementFromPoint).mockReturnValue(
    shelfChip(label).lastElementChild,
  );
  await pointer(window, "pointermove", { clientX: 220, clientY: 100 });
  await pointer(window, "pointerup", { clientX: 220, clientY: 100 });
  await act(
    () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
  );
}

// "Putting a game on a hiding shelf": drag.
it("says when a game dragged onto a shelf leaves All games, with Undo", async () => {
  await render();
  await dropGame(gameCard("Elden Ring"), "Private");
  expect(journal(elden).shelfIds).toEqual([privateShelf]);
  expect(cardNames()).toEqual(["Hades"]);
  const toast = useAppStore.getState().toasts[0];
  expect(toast.title).toBe("Added to Private. It's hidden from All games now.");
  expect(toast.action?.label).toBe("Undo");

  await act(() => toast.action!.run());
  expect(journal(elden).shelfIds).toEqual([]);
  expect(cardNames()).toEqual(["Elden Ring", "Hades"]);
});

// Decision 1: the user is told when hiding pauses and comes back.
it("pauses a shelf's hiding while it fills itself from filters, says so, and says when it hides again", async () => {
  await render();
  await selectShelf("Private");
  await act(() =>
    container
      .querySelector<HTMLButtonElement>('[aria-controls="library-filters"]')!
      .click(),
  );
  await click("Played", container);
  await click("Save filters to Private", container);
  expect(useAppStore.getState().toasts[0]).toMatchObject({
    title: "Hiding is paused for Private",
    detail:
      "Its games show everywhere again while it fills itself from filters.",
  });
  expect(
    shelfChip("Private").querySelector(".lucide-sliders-horizontal"),
  ).not.toBeNull();
  expect(shelfChip("Private").title).toContain("paused");
  await selectShelf("All games");
  expect(cardNames()).toEqual([
    "Dave the Diver",
    "Elden Ring",
    "Hades",
    "Lethal Company",
  ]);

  await selectShelf("Private");
  await act(() =>
    container
      .querySelector<HTMLButtonElement>('[aria-controls="library-filters"]')!
      .click(),
  );
  await click("Remove saved filters", container);
  expect(useAppStore.getState().toasts[0]?.title).toBe(
    "Private hides its games again",
  );
  await selectShelf("All games");
  expect(cardNames()).toEqual(["Elden Ring", "Hades"]);
});
