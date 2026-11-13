// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getGameJournal, useAppStore, type ExeCacheEntry } from "../../store";
import { fitShelfRail } from "../LibraryOrganization";
import { LibraryTestShell } from "./libraryTestShell";

/* Phil, 2026-11-11: with many shelves the rail shows as many as fit in one
   row (it follows the window's width), and a "+N more" chip as the last
   shelf holds the rest. "+N more" opens a list of them with icon and count;
   right-click there opens the shelf's own menu; a shelf picked from the list
   moves into the row; dragging a game onto "+N more" opens the list, and the
   game can be dropped on a shelf there. */

vi.mock("../../tracker");
vi.mock("../../platform", () => ({ currentPlatform: () => "windows" }));
vi.mock("../../gameDetails", () => ({
  useGameDetails: () => ({ status: "empty" }),
}));

const HOUR = 3_600_000;
const hoursAgo = (hours: number) =>
  new Date(Date.now() - hours * HOUR).toISOString();

const elden = { gameId: -1, source: "custom" as const, gameName: "Elden Ring" };
const hades = { gameId: -2, source: "custom" as const, gameName: "Hades" };

function ownGame(game: typeof elden): [string, ExeCacheEntry] {
  const exeName = `${game.gameName.replace(/\W+/g, "")}.exe`;
  return [
    exeName,
    {
      ...game,
      exeName,
      state: "matched",
      lastCheckedAt: hoursAgo(30 * 24),
      addedAt: hoursAgo(30 * 24),
    },
  ];
}

/* A fake one-line layout: every chip in the rail is 100 px wide with 6 px
   between them, laid out in DOM order. Only the rail's width changes. */
const CHIP = 100;
const GAP = 6;
let railWidth = 0;
/** Room for All games, Favorites, `shelves` shelves, "+N more" and New shelf. */
const roomFor = (shelves: number) => (shelves + 4) * (CHIP + GAP) - GAP;

function rect(left: number, width: number) {
  return {
    left,
    right: left + width,
    width,
    top: 0,
    bottom: 30,
    height: width ? 30 : 0,
    x: left,
    y: 0,
    toJSON() {},
  } as DOMRect;
}

/* The toolbar re-fits from its ResizeObserver; this one lets a test say the
   library got wider or narrower. */
const observers: { callback: ResizeObserverCallback; targets: Element[] }[] =
  [];
class FakeResizeObserver {
  entry: (typeof observers)[number];
  constructor(callback: ResizeObserverCallback) {
    this.entry = { callback, targets: [] };
    observers.push(this.entry);
  }
  observe(target: Element) {
    this.entry.targets.push(target);
  }
  unobserve() {}
  disconnect() {
    observers.splice(observers.indexOf(this.entry), 1);
  }
}

async function resizeLibrary(width: number) {
  railWidth = width;
  await act(() => {
    for (const { callback, targets } of [...observers])
      if (targets.some((target) => target.matches(".library-organization")))
        callback([], {} as ResizeObserver);
  });
}

let root: Root;
let container: HTMLDivElement;
let ids: Record<string, string>;
const NAMES = [
  "Co-op",
  "Backlog",
  "Cozy",
  "Soulslike",
  "Couch",
  "Retro",
  "Unplayed",
  "Private",
];

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  vi.spyOn(document, "elementFromPoint").mockReturnValue(null);
  railWidth = roomFor(3);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      const rail = this.closest<HTMLElement>("[data-library-shelf-rail]");
      if (this === rail) return rect(0, railWidth);
      if (rail && this.parentElement === rail)
        return rect([...rail.children].indexOf(this) * (CHIP + GAP), CHIP);
      return rect(0, 0);
    },
  );
  localStorage.clear();
  useAppStore.setState(useAppStore.getInitialState(), true);
  useAppStore.setState({
    activeView: "games",
    settings: {
      ...useAppStore.getState().settings,
      gameLaunchingEnabled: false,
      libraryHideEmptyProviderTabs: true,
    },
    exeCache: new Map([ownGame(elden), ownGame(hades)]),
  });
  useAppStore.getState().setMyGamesCardSize("grid");
  const state = useAppStore.getState();
  ids = {};
  for (const name of NAMES)
    ids[name] = state.savePersonalShelf(
      name === "Unplayed"
        ? { name, filters: { played: "unplayed" } }
        : name === "Private"
          ? { name, hiddenIn: ["all"] }
          : { name },
    )!;
  state.updateGameJournal(elden, { shelfIds: [ids.Retro, ids.Couch] });
  state.updateGameJournal(hades, { shelfIds: [ids.Retro] });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  observers.length = 0;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const render = () => act(() => root.render(<LibraryTestShell />));
const rail = () =>
  container.querySelector<HTMLElement>("[data-library-shelf-rail]")!;
/** What the rail shows, in order. Chips beyond the row are not shown. */
const shownChips = () =>
  [...rail().children]
    .filter((chip) => !chip.hasAttribute("data-rail-hidden"))
    .map((chip) => chip.textContent?.replace(/\d+$/, "").trim());
const moreChip = () =>
  [...rail().querySelectorAll<HTMLButtonElement>("button")].find(
    (chip) =>
      !chip.hasAttribute("data-rail-hidden") &&
      /^\+\d+ more$/.test(chip.textContent?.trim() ?? ""),
  );
const list = () =>
  document.querySelector<HTMLElement>(
    '[role="menu"][aria-label="More shelves"]',
  );
const listRows = () => [
  ...(list()?.querySelectorAll<HTMLButtonElement>("[data-context-menu-item]") ??
    []),
];
function listRow(name: string) {
  const row = listRows().find((item) => item.textContent?.startsWith(name));
  expect(row, `no list row for ${name}`).toBeDefined();
  return row!;
}
const shelfIds = (game: typeof elden) =>
  getGameJournal(useAppStore.getState(), game).shelfIds;

async function openList() {
  await act(() => moreChip()!.click());
  expect(list()).not.toBeNull();
}

async function pointer(
  target: EventTarget,
  type: string,
  options: PointerEventInit = {},
) {
  await act(() => {
    target.dispatchEvent(
      new PointerEvent(type, {
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
      }),
    );
  });
}

function gameCard(name: string) {
  const card = [
    ...container.querySelectorAll<HTMLElement>(".game-library-card"),
  ].find((element) => element.querySelector("h2")?.textContent === name);
  expect(card, `no game card for ${name}`).toBeDefined();
  return card!;
}

async function startDrag(card: HTMLElement) {
  await pointer(card, "pointerdown");
  await pointer(window, "pointermove", { clientX: 140, clientY: 410 });
  expect(document.querySelector(".library-game-drag-preview")).not.toBeNull();
}

async function nextFrame() {
  await act(
    () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
  );
}

it("shows every shelf when they all fit in one row", async () => {
  // All games, Favorites, eight shelves and New shelf: no room for "+N more".
  railWidth = 11 * (CHIP + GAP) - GAP;
  await render();
  expect(shownChips()).toEqual([
    "All games",
    "Favorites",
    ...NAMES,
    "New shelf",
  ]);
});

it("shows as many shelves as fit in one row and puts the rest behind +N more, last before New shelf", async () => {
  await render();
  expect(shownChips()).toEqual([
    "All games",
    "Favorites",
    "Co-op",
    "Backlog",
    "Cozy",
    "+5 more",
    "New shelf",
  ]);
});

it("counts along when the library gets wider or narrower", async () => {
  await render();
  await resizeLibrary(roomFor(5));
  expect(shownChips()).toEqual([
    "All games",
    "Favorites",
    "Co-op",
    "Backlog",
    "Cozy",
    "Soulslike",
    "Couch",
    "+3 more",
    "New shelf",
  ]);
  await resizeLibrary(roomFor(1));
  expect(moreChip()?.textContent).toBe("+7 more");
  await resizeLibrary(roomFor(10));
  expect(moreChip()).toBeUndefined();
  expect(shownChips()).toContain("Private");
});

it("+N more opens a list of the other shelves with icon and count", async () => {
  await render();
  await openList();
  expect(listRows().map((row) => row.textContent)).toEqual([
    "Soulslike0",
    "Couch1",
    "Retro2",
    // The filter shelf counts the games it matches: neither was played.
    "Unplayed2",
    "Private0",
  ]);
  const icon = (name: string) =>
    listRow(name).querySelector("svg")?.getAttribute("class");
  expect(icon("Couch")).toContain("lucide-folder-heart");
  expect(icon("Unplayed")).toContain("lucide-sliders-horizontal");
  expect(icon("Private")).toContain("lucide-eye-off");
});

it("right-click in the list opens the shelf's own menu", async () => {
  await render();
  await openList();
  await act(() =>
    listRow("Retro").dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true }),
    ),
  );
  const menu = [...document.querySelectorAll('[role="menu"]')].at(-1)!;
  expect(menu.textContent).toContain("Retro");
  const rows = [...menu.querySelectorAll("[data-context-menu-item]")].map(
    (row) => row.textContent,
  );
  expect(rows).toEqual(["Edit filters", "Edit", "Hide in", "Delete"]);
  await act(() =>
    [...menu.querySelectorAll<HTMLButtonElement>("[data-context-menu-item]")]
      .find((row) => row.textContent === "Edit")!
      .click(),
  );
  expect(
    document.querySelector<HTMLInputElement>('[aria-label="Shelf name"]')
      ?.value,
  ).toBe("Retro");
});

it("a shelf picked from the list opens and moves into the row", async () => {
  await render();
  await openList();
  await act(() => listRow("Couch").click());
  expect(list()).toBeNull();
  const couch = [...rail().children].find((chip) =>
    chip.textContent?.startsWith("Couch"),
  )!;
  expect(couch.getAttribute("aria-selected")).toBe("true");
  expect(shownChips()).toEqual([
    "All games",
    "Favorites",
    "Co-op",
    "Backlog",
    "Couch",
    "+5 more",
    "New shelf",
  ]);
  await openList();
  expect(listRows().map((row) => row.textContent?.replace(/\d+$/, ""))).toEqual(
    ["Cozy", "Soulslike", "Retro", "Unplayed", "Private"],
  );
});

it("dragging a game onto +N more opens the list, and the game lands on the shelf it is dropped on", async () => {
  await render();
  await startDrag(gameCard("Hades"));
  await pointer(moreChip()!, "pointerover", { clientX: 600, clientY: 10 });
  expect(list()).not.toBeNull();
  const couch = listRow("Couch");
  vi.mocked(document.elementFromPoint).mockReturnValue(couch);
  await pointer(couch, "pointermove", { clientX: 620, clientY: 60 });
  await pointer(couch, "pointerup", { clientX: 620, clientY: 60 });
  await nextFrame();
  expect(shelfIds(hades)).toEqual([ids.Retro, ids.Couch]);
  // The list stays open on the shelf the game went to, with its new count.
  expect(listRow("Couch").textContent).toBe("Couch2");
});

it("a game already on the shelf it is dropped on in the list stays where it was", async () => {
  await render();
  await startDrag(gameCard("Elden Ring"));
  await pointer(moreChip()!, "pointerover", { clientX: 600, clientY: 10 });
  const couch = listRow("Couch");
  vi.mocked(document.elementFromPoint).mockReturnValue(couch);
  await pointer(couch, "pointerup", { clientX: 620, clientY: 60 });
  await nextFrame();
  expect(shelfIds(elden)).toEqual([ids.Retro, ids.Couch]);
  expect(document.querySelector(".library-game-drop-hint")?.textContent).toBe(
    "Already in Couch",
  );
  expect(list()).not.toBeNull();
});

it("closes the list a drag opened when the game is dropped somewhere else", async () => {
  await render();
  await startDrag(gameCard("Hades"));
  await pointer(moreChip()!, "pointerover", { clientX: 600, clientY: 10 });
  expect(list()).not.toBeNull();
  await pointer(window, "pointerup", { clientX: 300, clientY: 500 });
  await nextFrame();
  expect(list()).toBeNull();
  expect(shelfIds(hades)).toEqual([ids.Retro]);
});

/* The rule itself, with real widths: chips differ in size. */
it("fits shelves in order and keeps the open shelf in the row", () => {
  const fit = (selected: number, available: number) =>
    fitShelfRail({
      available,
      gap: 6,
      // All games, Favorites, New shelf
      fixed: [90, 100, 100],
      shelves: [80, 160, 60, 120, 70],
      more: 70,
      selected,
    });
  // Everything: 290 + 490 + 7 gaps = 822.
  expect(fit(-1, 822)).toEqual([0, 1, 2, 3, 4]);
  // One px short: "+N more" (70) takes a slot. 290 + 70 + 3 gaps = 378 before shelves.
  expect(fit(-1, 821)).toEqual([0, 1, 2]);
  expect(fit(-1, 378 + 6 + 80 - 1)).toEqual([]);
  expect(fit(-1, 378 + 6 + 80)).toEqual([0]);
  // The open shelf is kept; the shelves before it fill what room is left.
  expect(fit(4, 378 + 6 + 70 + 6 + 80)).toEqual([0, 4]);
  expect(fit(4, 378 + 6 + 70)).toEqual([4]);
  expect(fit(1, 821)).toEqual([0, 1, 2]);
});
