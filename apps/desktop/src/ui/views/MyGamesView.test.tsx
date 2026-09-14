// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getGameJournal, useAppStore } from "../../store";
import type { LibraryImportEntry } from "../../library/types";
import { MyGamesView } from "./MyGamesView";

vi.mock("../../tracker");
vi.mock("../../platform", () => ({ currentPlatform: () => "windows" }));

const local = {
  gameId: -1,
  source: "custom" as const,
  gameName: "Local favorite",
};
const steam: LibraryImportEntry = {
  provider: "steam",
  externalId: "100",
  gameId: 1,
  igdbId: 100,
  source: "igdb",
  name: "Steam favorite",
  coverUrl: "",
  importedAt: "2026-09-13T12:00:00Z",
  lastReadAt: "2026-09-13T12:00:00Z",
  providerSeconds: 0,
  linkedExeNames: [],
  linkedExeSources: [],
};

let root: Root;
let container: HTMLDivElement;
let shelf: string;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(document, "elementFromPoint").mockReturnValue(null);
  localStorage.clear();
  useAppStore.setState(useAppStore.getInitialState(), true);
  useAppStore.setState({
    settings: {
      ...useAppStore.getState().settings,
      gameLaunchingEnabled: false,
      libraryHideEmptyProviderTabs: true,
    },
    exeCache: new Map(
      [local, { ...local, gameId: -2, gameName: "Local other" }].map((game) => {
        const exeName = `game${game.gameId}.exe`;
        return [
          exeName,
          {
            ...game,
            exeName,
            state: "matched" as const,
            lastCheckedAt: steam.importedAt,
          },
        ];
      }),
    ),
    libraryImports: new Map([
      ["steam:100", steam],
      [
        "steam:200",
        {
          ...steam,
          externalId: "200",
          gameId: 2,
          igdbId: 200,
          name: "Steam other",
        },
      ],
    ]),
  });
  shelf = useAppStore.getState().savePersonalShelf({ name: "Weekend" })!;
  for (const game of [local, steam]) {
    useAppStore.getState().updateGameJournal(game, {
      favorite: true,
      status: "not-planned",
      shelfIds: [shelf],
    });
  }
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

function shelfChip(label: string) {
  const chip = [
    ...container.querySelectorAll<HTMLButtonElement>(
      '[aria-label="Library shelf"] [role="tab"]',
    ),
  ].find((item) => item.textContent?.startsWith(label));
  expect(chip, `no shelf chip for ${label}`).toBeDefined();
  return chip!;
}

async function selectShelf(label: string) {
  await act(() => shelfChip(label).click());
}

async function setStatusFilter(label: string) {
  const toggle = [
    ...container.querySelectorAll<HTMLButtonElement>("button"),
  ].find((item) => item.textContent?.startsWith("Filters"))!;
  if (toggle.getAttribute("aria-expanded") !== "true")
    await act(() => toggle.click());
  const pill = [
    ...container.querySelectorAll<HTMLButtonElement>("button"),
  ].find((item) => item.textContent?.trim() === label);
  expect(pill, `no filter pill for ${label}`).toBeDefined();
  await act(() => pill!.click());
}
async function selectSource(source: string) {
  await act(() =>
    container
      .querySelector<HTMLButtonElement>(`#library-tab-${source}`)!
      .click(),
  );
}

it("counts favorites and manual shelves across sources, then updates when membership changes", async () => {
  await act(() => root.render(<MyGamesView />));
  expect(counts()).toEqual({ all: 4, unimported: 2, steam: 2 });
  await selectShelf("Favorites");
  expect(counts()).toEqual({ all: 2, unimported: 1, steam: 1 });
  await selectSource("steam");
  expect(counts()).toEqual({ all: 2, unimported: 1, steam: 1 });
  const panel = container.querySelector("#library-tabpanel")!;
  expect(panel.textContent).toContain("Steam favorite");
  expect(panel.textContent).not.toContain("Local favorite");
  expect(panel.textContent).not.toContain("Steam other");

  await act(() =>
    useAppStore.getState().updateGameJournal(steam, { favorite: false }),
  );
  expect(counts()).toEqual({ all: 1, unimported: 1, steam: 0 });
  expect(
    container.querySelector(
      '[aria-label="Game library source"] [aria-selected="true"]',
    )?.id,
  ).toBe("library-tab-steam");
  expect(panel.textContent).toContain("No games match this shelf");
  expect(panel.textContent).not.toContain("No Steam games imported yet");

  await selectShelf("Weekend");
  expect(counts()).toEqual({ all: 2, unimported: 1, steam: 1 });
  await selectShelf("All games");
  expect(counts()).toEqual({ all: 4, unimported: 2, steam: 2 });
});

it("counts status and saved filters independently of their selected source, including search", async () => {
  useAppStore.getState().savePersonalShelf({
    name: "Not planned imports",
    filters: { status: "not-planned", source: "steam" },
  });
  await act(() => root.render(<MyGamesView />));
  await setStatusFilter("Not planned");
  expect(counts()).toEqual({ all: 2, unimported: 1, steam: 1 });
  await selectShelf("Not planned imports");
  expect(
    container.querySelector(
      '[aria-label="Game library source"] [aria-selected="true"]',
    )?.id,
  ).toBe("library-tab-steam");
  expect(counts()).toEqual({ all: 2, unimported: 1, steam: 1 });

  const search = container.querySelector<HTMLInputElement>(
    '[placeholder="Search games..."]',
  )!;
  await act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(search, "Local");
    search.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(counts()).toEqual({ all: 1, unimported: 1, steam: 0 });
  await selectSource("unimported");
  expect(container.querySelector("#library-tabpanel")?.textContent).toContain(
    "Local favorite",
  );
  expect(counts()).toEqual({ all: 1, unimported: 1, steam: 0 });
});

it("counts a game once per source even with multiple imports", async () => {
  useAppStore.setState({
    libraryImports: new Map([
      ...useAppStore.getState().libraryImports,
      ["steam:101", { ...steam, externalId: "101" }],
      ["xbox:100", { ...steam, provider: "xbox", externalId: "100" }],
    ]),
  });
  await act(() => root.render(<MyGamesView />));
  await selectShelf("Favorites");
  expect(counts()).toEqual({ all: 2, unimported: 1, steam: 1, xbox: 1 });
});

function gameCard(name: string) {
  const card = [
    ...container.querySelectorAll<HTMLElement>(".game-library-card"),
  ].find((element) => element.textContent?.includes(name));
  expect(card, `no game card for ${name}`).toBeDefined();
  return card!;
}

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
  return event;
}

async function startDrag(card: HTMLElement) {
  await pointer(card, "pointerdown");
  await pointer(window, "pointermove", { clientX: 140, clientY: 410 });
  expect(document.querySelector(".library-game-drag-preview")).not.toBeNull();
}

async function releaseOnShelf(label: string) {
  vi.mocked(document.elementFromPoint).mockReturnValue(
    shelfChip(label).lastElementChild,
  );
  await pointer(window, "pointermove", { clientX: 220, clientY: 100 });
  await pointer(window, "pointerup", { clientX: 220, clientY: 100 });
  // happy-dom has no layout: the return animation restores the card on this frame.
  await act(
    () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
  );
}

async function dropGame(card: HTMLElement, label: string) {
  await startDrag(card);
  await releaseOnShelf(label);
  expect(document.querySelector(".library-game-drag-preview")).toBeNull();
  expect(card.hasAttribute("data-library-drag-source")).toBe(false);
}

it.each(["grid", "large", "list"] as const)(
  "adds a dragged game to shelves and Favorites in %s view without changing its other data",
  async (view) => {
    useAppStore.getState().setMyGamesCardSize(view);
    useAppStore.getState().updateGameJournal(local, {
      favorite: false,
      note: "Continue the quest",
    });
    const target = useAppStore.getState().savePersonalShelf({ name: "Co-op" })!;
    await act(() => root.render(<MyGamesView />));
    await selectShelf("Weekend");
    const original = getGameJournal(useAppStore.getState(), local);
    const other = getGameJournal(useAppStore.getState(), steam);

    await dropGame(gameCard(local.gameName), "Co-op");
    expect(getGameJournal(useAppStore.getState(), local)).toEqual({
      ...original,
      shelfIds: [shelf, target],
    });
    expect(shelfChip("Weekend").getAttribute("aria-selected")).toBe("true");
    expect(shelfChip("Co-op").lastElementChild?.textContent).toBe("1");
    const journals = useAppStore.getState().gameJournals;
    await dropGame(gameCard(local.gameName), "Co-op");
    expect(useAppStore.getState().gameJournals).toBe(journals);

    await dropGame(gameCard(local.gameName), "Favorites");
    expect(getGameJournal(useAppStore.getState(), local)).toEqual({
      ...original,
      favorite: true,
      shelfIds: [shelf, target],
    });
    expect(getGameJournal(useAppStore.getState(), steam)).toEqual(other);
  },
);

it("ignores external drops, saved-filter targets, and cancelled drags", async () => {
  useAppStore.getState().savePersonalShelf({
    name: "Unplayed",
    filters: { played: "unplayed" },
  });
  await act(() => root.render(<MyGamesView />));
  const journals = useAppStore.getState().gameJournals;
  await act(() => {
    shelfChip("Weekend").dispatchEvent(new Event("drop", { bubbles: true }));
  });

  for (const label of ["Unplayed", "All games"]) {
    await dropGame(gameCard("Local other"), label);
  }
  await startDrag(gameCard("Local other"));
  await act(() => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
  });
  await releaseOnShelf("Weekend");
  expect(useAppStore.getState().gameJournals).toBe(journals);
});

it("assigns an imported game to the same journal as its local alias", async () => {
  const alias = {
    gameId: -12,
    source: "custom" as const,
    igdbId: steam.igdbId,
    gameName: steam.name,
  };
  useAppStore.getState().updateGameJournal(alias, { note: "Steam campaign" });
  const target = useAppStore.getState().savePersonalShelf({ name: "Co-op" })!;
  await act(() => root.render(<MyGamesView />));
  await dropGame(gameCard(steam.name), "Co-op");
  for (const identity of [steam, alias]) {
    expect(getGameJournal(useAppStore.getState(), identity)).toMatchObject({
      note: "Steam campaign",
      shelfIds: [shelf, target],
    });
  }
  expect(
    Object.values(useAppStore.getState().gameJournals).filter(
      (journal) => journal.game.igdbId === steam.igdbId,
    ),
  ).toHaveLength(1);
});

it("preserves membership changes made during a drag and does not drag from card controls", async () => {
  useAppStore.getState().updateGameJournal(local, { note: "Read this note" });
  const target = useAppStore.getState().savePersonalShelf({ name: "Co-op" })!;
  const addedMeanwhile = useAppStore
    .getState()
    .savePersonalShelf({ name: "Later" })!;
  await act(() => root.render(<MyGamesView />));
  const card = gameCard(local.gameName);
  const control = card.querySelector('[title="Read note"]')!;
  await pointer(control, "pointerdown");
  await pointer(window, "pointermove", { clientX: 220, clientY: 100 });
  await pointer(window, "pointerup");
  expect(document.querySelector(".library-game-drag-preview")).toBeNull();

  await startDrag(card);
  await act(() =>
    useAppStore.getState().updateGameJournal(local, {
      shelfIds: [shelf, addedMeanwhile],
    }),
  );
  await releaseOnShelf("Co-op");
  expect(getGameJournal(useAppStore.getState(), local).shelfIds).toEqual([
    shelf,
    addedMeanwhile,
    target,
  ]);
});

it("keeps small pointer movements as clicks and suppresses the release click after a real drag", async () => {
  const target = useAppStore.getState().savePersonalShelf({ name: "Co-op" })!;
  await act(() => root.render(<MyGamesView />));
  const card = gameCard(local.gameName);
  await pointer(card, "pointerdown");
  await pointer(window, "pointermove", { clientX: 123, clientY: 402 });
  await pointer(window, "pointerup");
  expect(document.querySelector(".library-game-drag-preview")).toBeNull();

  await dropGame(card, "Co-op");
  await selectShelf("Co-op"); // Simulates the browser's click following pointerup.
  expect(shelfChip("All games").getAttribute("aria-selected")).toBe("true");
  expect(getGameJournal(useAppStore.getState(), local).shelfIds).toEqual([
    shelf,
    target,
  ]);
  await pointer(shelfChip("Co-op"), "pointerdown");
  await selectShelf("Co-op");
  expect(shelfChip("Co-op").getAttribute("aria-selected")).toBe("true");
});

it.each(["pointercancel", "blur"])(
  "restores the card without assigning it after %s",
  async (type) => {
    await act(() => root.render(<MyGamesView />));
    const journals = useAppStore.getState().gameJournals;
    const card = gameCard("Local other");
    await startDrag(card);
    await act(() => {
      window.dispatchEvent(new Event(type));
    });
    await releaseOnShelf("Weekend");
    expect(useAppStore.getState().gameJournals).toBe(journals);
    expect(document.querySelector(".library-game-drag-preview")).toBeNull();
    expect(card.hasAttribute("data-library-drag-source")).toBe(false);
  },
);

it("cleans up a card drag when the library unmounts", async () => {
  await act(() => root.render(<MyGamesView />));
  const card = gameCard("Local other");
  await startDrag(card);
  await act(() => root.render(null));
  expect(document.querySelector(".library-game-drag-preview")).toBeNull();
  expect(
    document.documentElement.classList.contains("library-game-dragging"),
  ).toBe(false);
  expect(card.hasAttribute("data-library-drag-source")).toBe(false);
});

it("cleans up a drag when navigating away from the mounted library", async () => {
  useAppStore.setState({ activeView: "games" });
  await act(() => root.render(<MyGamesView />));
  const card = gameCard("Local other");
  const journals = useAppStore.getState().gameJournals;
  await startDrag(card);
  await act(() => useAppStore.getState().setActiveView("history"));
  await releaseOnShelf("Weekend");
  expect(document.querySelector(".library-game-drag-preview")).toBeNull();
  expect(card.hasAttribute("data-library-drag-source")).toBe(false);
  expect(useAppStore.getState().gameJournals).toBe(journals);
});
