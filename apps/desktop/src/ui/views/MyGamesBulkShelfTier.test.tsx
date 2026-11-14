// @vitest-environment happy-dom
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
import { LibraryTestShell } from "./libraryTestShell";

/* Multi-select in My Games (Phil, 2026-11-14): the bulk bar gets "Set tier"
   and "Add to shelf".
   - Set tier works like Set status: S to F and Clear tier, for every
     selected game.
   - Add to shelf lists the hand-filled shelves and a New shelf row. A pick
     puts every selected game on the shelf; games already on it stay on it.
   - New shelf opens the shelf row's New shelf dialog; Save shelf puts every
     selected game on the new shelf. */

vi.mock("../../tracker");
vi.mock("../../platform", () => ({ currentPlatform: () => "windows" }));
vi.mock("../../gameDetails", () => ({
  useGameDetails: () => ({ status: "empty" }),
}));

const MONTH_AGO = new Date(Date.now() - 30 * 86_400_000).toISOString();

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

function ownGame(game: typeof lethal): [string, ExeCacheEntry] {
  const exeName = `${game.gameName.replace(/\W+/g, "")}.exe`;
  return [
    exeName,
    {
      ...game,
      exeName,
      state: "matched",
      lastCheckedAt: MONTH_AGO,
      addedAt: MONTH_AGO,
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
      importedAt: MONTH_AGO,
      lastReadAt: MONTH_AGO,
      providerSeconds: 0,
      linkedExeNames: [],
      linkedExeSources: [],
    },
  ];
}

let root: Root;
let container: HTMLDivElement;
let coop: string;
let demos: string;

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
    exeCache: new Map([ownGame(lethal), ownGame(elden), ownGame(palworld)]),
    libraryImports: new Map([steamGame(hades)]),
  });
  useAppStore.getState().setMyGamesCardSize("grid");
  const state = useAppStore.getState();
  coop = state.savePersonalShelf({ name: "Co-op" })!;
  demos = state.savePersonalShelf({ name: "Demos", hiddenIn: ["all"] })!;
  // Fills itself from filters: nothing to put games on.
  state.savePersonalShelf({
    name: "Not planned",
    filters: { status: "not-planned" },
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

const render = () => act(() => root.render(<LibraryTestShell />));
const journal = (game: GameIdentityRef) =>
  getGameJournal(useAppStore.getState(), game);
const toasts = () => useAppStore.getState().toasts;
/** New toasts go on top. */
const latestToast = () => toasts()[0];
const bulkBar = () =>
  container.querySelector<HTMLElement>('[aria-label="Bulk game actions"]');

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

async function select(...games: GameIdentityRef[]) {
  await click("Select games", container);
  for (const game of games) await click(`Select ${game.gameName}`, container);
}

const tierMenu = () => document.querySelector("#library-bulk-tier-menu");
const shelfMenu = () => document.querySelector("#library-bulk-shelf-menu");
const menuLabels = (menu: Element | null) =>
  [...(menu?.querySelectorAll('[role="menuitem"]') ?? [])].map((item) =>
    item.textContent?.trim(),
  );

async function setTier(label: string) {
  await click("Set tier", bulkBar()!);
  expect(tierMenu()).not.toBeNull();
  await click(label, tierMenu()!);
}

async function addToShelf(label: string) {
  await click("Add to shelf", bulkBar()!);
  expect(shelfMenu()).not.toBeNull();
  await click(label, shelfMenu()!);
}

async function nameShelf(value: string) {
  const name = document.querySelector<HTMLInputElement>(
    '[aria-label="Shelf name"]',
  )!;
  await act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(name, value);
    name.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it("keeps Set tier and Add to shelf off until a game is selected", async () => {
  await render();
  await click("Select games", container);
  expect(button("Set tier", bulkBar()!).disabled).toBe(true);
  expect(button("Add to shelf", bulkBar()!).disabled).toBe(true);
  await click("Select Elden Ring", container);
  expect(button("Set tier", bulkBar()!).disabled).toBe(false);
  expect(button("Add to shelf", bulkBar()!).disabled).toBe(false);
});

it("offers S to F and Clear tier, like Set status offers its statuses", async () => {
  await render();
  await select(elden);
  await click("Set tier", bulkBar()!);
  expect(menuLabels(tierMenu())).toEqual([
    "S – Best",
    "A",
    "B",
    "C",
    "D",
    "F – Worst",
    "Clear tier",
  ]);
});

it("gives every selected game the picked tier, and no other game", async () => {
  useAppStore.getState().setGameTier(elden, "B");
  await render();
  await select(lethal, elden, hades);
  await setTier("S – Best");
  expect(journal(lethal).tier).toBe("S");
  expect(journal(elden).tier).toBe("S");
  expect(journal(hades).tier).toBe("S");
  expect(journal(palworld).tier).toBeUndefined();
  expect(toasts()).toEqual([
    expect.objectContaining({
      tone: "success",
      title: "Tier S set for 3 games",
    }),
  ]);
  // Done after one pick, like Set status.
  expect(bulkBar()).toBeNull();
});

it("counts only the games whose tier changed, and says so when none did", async () => {
  useAppStore.getState().setGameTier(elden, "A");
  const ratedAt = journal(elden).tierAt;
  await render();
  await select(lethal, elden);
  await setTier("A");
  expect(latestToast()).toMatchObject({
    tone: "success",
    title: "Tier A set for 1 game",
  });
  // A game that had the tier keeps the day it got it.
  expect(journal(elden).tierAt).toBe(ratedAt);

  await select(lethal, elden);
  await setTier("A");
  expect(latestToast()).toMatchObject({
    tone: "info",
    title: "Selected games already have tier A",
  });
});

it("clears the tier of the selected games only", async () => {
  const state = useAppStore.getState();
  state.setGameTier(lethal, "S");
  state.setGameTier(elden, "B");
  state.setGameTier(palworld, "C");
  await render();
  await select(lethal, elden);
  await setTier("Clear tier");
  expect(journal(lethal).tier).toBeUndefined();
  expect(journal(lethal).tierAt).toBeUndefined();
  expect(journal(elden).tier).toBeUndefined();
  expect(journal(palworld).tier).toBe("C");
  expect(latestToast()).toMatchObject({
    tone: "success",
    title: "Tier cleared for 2 games",
  });

  await select(lethal, hades);
  await setTier("Clear tier");
  expect(latestToast()).toMatchObject({
    tone: "info",
    title: "Selected games already have no tier",
  });
});

it("lists the hand-filled shelves and New shelf, not Favorites or a filter shelf", async () => {
  await render();
  await select(elden);
  await click("Add to shelf", bulkBar()!);
  expect(menuLabels(shelfMenu())).toEqual(["Co-op", "Demos", "New shelf"]);
});

it("shows only New shelf while there is no hand-filled shelf", async () => {
  const state = useAppStore.getState();
  state.deletePersonalShelf(coop);
  state.deletePersonalShelf(demos);
  await render();
  await select(elden);
  await click("Add to shelf", bulkBar()!);
  expect(menuLabels(shelfMenu())).toEqual(["New shelf"]);
});

it("has no Add to shelf with shelves turned off in Appearance", async () => {
  useAppStore.setState({
    settings: {
      ...useAppStore.getState().settings,
      libraryShowShelves: false,
    },
  });
  await render();
  await select(elden);
  expect(
    [...bulkBar()!.querySelectorAll("button")].some(
      (item) => item.textContent?.trim() === "Add to shelf",
    ),
  ).toBe(false);
  expect(button("Set tier", bulkBar()!).disabled).toBe(false);
});

it("puts every selected game on the picked shelf, and a game already on it stays on it once", async () => {
  useAppStore.getState().updateGameJournal(lethal, { shelfIds: [coop] });
  await render();
  await select(lethal, elden, hades);
  await addToShelf("Co-op");
  expect(journal(lethal).shelfIds).toEqual([coop]);
  expect(journal(elden).shelfIds).toEqual([coop]);
  expect(journal(hades).shelfIds).toEqual([coop]);
  expect(journal(palworld).shelfIds).toEqual([]);
  expect(latestToast()).toMatchObject({
    tone: "success",
    title: "Added 2 games to Co-op",
    detail: "1 already in Co-op",
  });
  expect(bulkBar()).toBeNull();
});

it("says so when every selected game is on the shelf already", async () => {
  const state = useAppStore.getState();
  state.updateGameJournal(lethal, { shelfIds: [coop] });
  state.updateGameJournal(elden, { shelfIds: [coop] });
  await render();
  await select(lethal, elden);
  await addToShelf("Co-op");
  expect(latestToast()).toMatchObject({
    tone: "info",
    title: "All selected games are already in Co-op",
  });
  expect(bulkBar()).toBeNull();
});

it("tells when the shelf hides its games from All games, and Undo takes them off again", async () => {
  await render();
  await select(lethal, elden);
  await addToShelf("Demos");
  expect(journal(lethal).shelfIds).toEqual([demos]);
  expect(journal(elden).shelfIds).toEqual([demos]);
  const toast = latestToast()!;
  expect(toast).toMatchObject({
    title: "Added 2 games to Demos. They're hidden from All games now.",
    action: { label: "Undo" },
  });
  await act(() => toast.action!.run());
  expect(journal(lethal).shelfIds).toEqual([]);
  expect(journal(elden).shelfIds).toEqual([]);
});

it("makes a new shelf with every selected game on it", async () => {
  await render();
  await select(elden, hades);
  await addToShelf("New shelf");
  const dialog = document.querySelector('[role="dialog"]');
  expect(dialog?.textContent).toContain("New shelf");
  await nameShelf("Souls");
  await click("Save shelf");
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  const souls = useAppStore
    .getState()
    .personalShelves.find((entry) => entry.name === "Souls");
  expect(souls).toBeDefined();
  expect(journal(elden).shelfIds).toEqual([souls!.id]);
  expect(journal(hades).shelfIds).toEqual([souls!.id]);
  expect(journal(lethal).shelfIds).toEqual([]);
  expect(latestToast()).toMatchObject({
    tone: "success",
    title: "Added 2 games to Souls",
  });
  // Saved: done, like a shelf pick.
  expect(bulkBar()).toBeNull();
});

it("keeps the selection when the New shelf dialog is closed without saving", async () => {
  await render();
  await select(elden, hades);
  await addToShelf("New shelf");
  await click("Close");
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(useAppStore.getState().personalShelves).toHaveLength(3);
  expect(bulkBar()?.textContent).toContain("2 selected");
});
