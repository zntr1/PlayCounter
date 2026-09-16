// @vitest-environment happy-dom
import { act, Profiler } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getGameJournal, useAppStore } from "../../store";
import { STORAGE_KEY } from "../../persistence";
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
    activeView: "games",
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

async function shelvesToggle() {
  if (!container.querySelector("#library-show-shelves"))
    await act(() =>
      container
        .querySelector<HTMLButtonElement>(
          '[aria-label="Customize library view"]',
        )!
        .click(),
    );
  return container.querySelector<HTMLInputElement>("#library-show-shelves")!;
}

async function setGridColumns(value: number) {
  const slider = container.querySelector<HTMLInputElement>(
    "#library-grid-columns",
  )!;
  await act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(slider, String(value));
    slider.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it.each(["grid", "large"] as const)(
  "customizes %s columns, saves them, and resets even when the active preset is clicked",
  async (view) => {
    useAppStore.getState().setMyGamesCardSize(view);
    await act(() => root.render(<MyGamesView />));
    await shelvesToggle(); // Open Customize.
    const slider = container.querySelector<HTMLInputElement>(
      "#library-grid-columns",
    )!;
    const grid = gameCard(local.gameName).parentElement!;
    const defaultColumns = view === "grid" ? "4" : "3";
    expect(slider.value).toBe(defaultColumns);
    await setGridColumns(6);
    expect(slider.value).toBe("6");
    expect(grid.style.gridTemplateColumns).toBe("repeat(6, minmax(0, 1fr))");
    expect(
      JSON.parse(localStorage.getItem(STORAGE_KEY)!).settings,
    ).toMatchObject({ libraryCardSize: view, libraryGridColumns: 6 });

    await selectSource("steam");
    await act(() => useAppStore.getState().setMyGamesSortKey("name"));
    expect(slider.value).toBe("6");
    expect(grid.style.gridTemplateColumns).toBe("repeat(6, minmax(0, 1fr))");

    // Reset via every preset, including the one that is already selected.
    for (const title of [
      view === "grid" ? "Standard cards" : "Large cards",
      view === "grid" ? "Large cards" : "Standard cards",
      "List",
    ]) {
      await setGridColumns(6);
      await act(() =>
        container
          .querySelector<HTMLButtonElement>(`[title="${title}"]`)!
          .click(),
      );
      expect(grid.style.gridTemplateColumns).toBe("");
      expect(
        JSON.parse(localStorage.getItem(STORAGE_KEY)!).settings
          .libraryGridColumns,
      ).toBeNull();
    }
    expect(container.querySelector("#library-grid-columns")).toBeNull();
  },
);

it("fits custom columns to the window and restores the saved count when it grows", async () => {
  useAppStore.getState().setMyGamesGridColumns(6);
  await act(() => root.render(<MyGamesView />));
  await shelvesToggle();
  const grid = gameCard(local.gameName).parentElement!;
  let width = 1100;
  Object.defineProperty(grid, "clientWidth", { get: () => width });
  grid.style.columnGap = "16px";
  const resize = () => act(() => window.dispatchEvent(new Event("resize")));
  await resize();
  expect(grid.style.gridTemplateColumns).toBe("repeat(6, minmax(0, 1fr))");

  width = 700;
  await resize();
  expect(grid.style.gridTemplateColumns).toBe("repeat(4, minmax(0, 1fr))");
  expect(
    container.querySelector<HTMLInputElement>("#library-grid-columns")!.value,
  ).toBe("6");
  expect(
    container.querySelector("#library-grid-columns-help")!.textContent,
  ).toContain("Showing 4 per row to fit this window.");
  expect(
    JSON.parse(localStorage.getItem(STORAGE_KEY)!).settings.libraryGridColumns,
  ).toBe(6);

  width = 1100;
  await resize();
  expect(grid.style.gridTemplateColumns).toBe("repeat(6, minmax(0, 1fr))");
});

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

function seedLargeLibrary(count = 120) {
  useAppStore.setState({
    exeCache: new Map(),
    gameJournals: {},
    personalShelves: [],
    libraryImports: new Map(
      Array.from({ length: count }, (_, index) => {
        const entry = {
          ...steam,
          externalId: String(index + 1),
          gameId: index + 1,
          igdbId: index + 1000,
          name: `Paged game ${String(index + 1).padStart(3, "0")}`,
        };
        return [`steam:${entry.externalId}`, entry];
      }),
    ),
  });
}

it.each(["grid", "large", "list"] as const)(
  "loads more %s cards near the viewport, pauses while hidden, and searches the entire library",
  async (view) => {
    const observers: Array<{
      callback: IntersectionObserverCallback;
      options?: IntersectionObserverInit;
      observe: ReturnType<typeof vi.fn>;
      disconnect: ReturnType<typeof vi.fn>;
    }> = [];
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        observe = vi.fn();
        disconnect = vi.fn();
        constructor(
          public callback: IntersectionObserverCallback,
          public options?: IntersectionObserverInit,
        ) {
          observers.push(this);
        }
      },
    );
    const intersect = async (
      observer = observers.at(-1)!,
      isIntersecting = true,
    ) =>
      act(() =>
        observer.callback(
          [{ isIntersecting } as IntersectionObserverEntry],
          observer as unknown as IntersectionObserver,
        ),
      );

    seedLargeLibrary();
    useAppStore.getState().setMyGamesCardSize(view);
    container.setAttribute("data-controller-content", "true");
    await act(() => root.render(<MyGamesView />));
    const card = gameCard("Paged game 001");
    expect(counts()).toEqual({ all: 120, unimported: 0, steam: 120 });
    expect(container.querySelectorAll(".game-library-card")).toHaveLength(12);
    expect(observers.at(-1)?.options?.root).toBe(container);

    // Waiting at the top must not gradually mount the rest of the library.
    await act(() => new Promise((resolve) => setTimeout(resolve, 40)));
    await intersect(undefined, false);
    expect(container.querySelectorAll(".game-library-card")).toHaveLength(12);
    await intersect();
    expect(container.querySelectorAll(".game-library-card")).toHaveLength(24);
    expect(gameCard("Paged game 001")).toBe(card);

    const queuedObserver = observers.at(-1)!;
    await act(() => useAppStore.getState().setActiveView("now"));
    expect(queuedObserver.disconnect).toHaveBeenCalled();
    await intersect(queuedObserver);
    expect(container.querySelectorAll(".game-library-card")).toHaveLength(24);
    await act(() => useAppStore.getState().setActiveView("games"));
    await intersect();
    expect(container.querySelectorAll(".game-library-card")).toHaveLength(36);

    const beforeSearch = observers.at(-1)!;
    await inputSearch("Paged game 120");
    await intersect(beforeSearch);
    expect(container.querySelectorAll(".game-library-card")).toHaveLength(1);
    expect(gameCard("Paged game 120")).toBeDefined();
    expect(counts()).toEqual({ all: 1, unimported: 0, steam: 1 });
    expect(container.textContent).not.toContain("Show more games");
    await inputSearch("");
    expect(container.querySelectorAll(".game-library-card")).toHaveLength(12);
  },
);

it("lets keyboard users load every result without IntersectionObserver", async () => {
  vi.stubGlobal("IntersectionObserver", undefined);
  seedLargeLibrary(25);
  await act(() => root.render(<MyGamesView />));
  expect(container.querySelectorAll(".game-library-card")).toHaveLength(12);
  const more = button("Show more games");
  expect(more.getAttribute("data-controller-item")).toBe("library-option");
  await act(() => more.click());
  expect(container.querySelectorAll(".game-library-card")).toHaveLength(24);
  await act(() => button("Show more games").click());
  expect(container.querySelectorAll(".game-library-card")).toHaveLength(25);
  expect(gameCard("Paged game 025")).toBeDefined();
  expect(container.textContent).not.toContain("Show more games");
});

it("defers hidden library session updates and refreshes on return while keeping shelf and search", async () => {
  const firstRun = useAppStore
    .getState()
    .createPlaythrough(local, "First run")!;
  const replay = useAppStore.getState().createPlaythrough(local, "Replay")!;
  const startedAt = new Date(Date.now() - 120_000).toISOString();
  useAppStore.setState({
    activeSessions: [
      {
        ...local,
        id: 7,
        playthroughId: firstRun,
        exeName: "game-1.exe",
        coverUrl: "",
        startedAt,
        checkpointedAt: new Date().toISOString(),
      },
    ],
  });
  const onRender = vi.fn();
  await act(() =>
    root.render(
      <Profiler id="library" onRender={onRender}>
        <MyGamesView />
      </Profiler>,
    ),
  );
  await selectShelf("Weekend");
  await inputSearch("favorite");
  const card = gameCard(local.gameName);
  const before = card.textContent;
  await act(() => useAppStore.getState().setActiveView("now"));
  onRender.mockClear();
  await act(() => {
    useAppStore.getState().assignSessionPlaythrough(7, replay);
    useAppStore.setState({
      recentSessions: [
        {
          ...local,
          id: 8,
          exeName: "game-1.exe",
          startedAt: "2026-09-13T10:00:00Z",
          endedAt: "2026-09-13T11:00:00Z",
          durationSeconds: 3600,
        },
      ],
      archivedGameSeconds: { "custom:-1": 3600 },
    });
  });
  expect(onRender).not.toHaveBeenCalled();
  expect(card.textContent).toBe(before);
  expect(useAppStore.getState().activeSessions[0].playthroughId).toBe(replay);

  await act(() => useAppStore.getState().setActiveView("games"));
  expect(onRender).toHaveBeenCalled();
  expect(gameCard(local.gameName)).toBe(card);
  expect(card.textContent).toContain("2h");
  expect(shelfChip("Weekend").getAttribute("aria-selected")).toBe("true");
  expect(
    container.querySelector<HTMLInputElement>(
      '[placeholder="Search games..."]',
    )!.value,
  ).toBe("favorite");
});

it.each(["All games", "Favorites", "Weekend", "Saved search"])(
  "lets users hide populated shelves from Customize while %s is selected",
  async (selection) => {
    useAppStore.getState().savePersonalShelf({
      name: "Saved search",
      filters: {
        status: "not-planned",
        source: "steam",
        search: "Steam favorite",
      },
    });
    const { personalShelves, gameJournals } = useAppStore.getState();
    expect(useAppStore.getState().settings.libraryShowShelves).toBe(true);
    await act(() => root.render(<MyGamesView />));
    await selectShelf(selection);
    const toggle = await shelvesToggle();
    expect(toggle.checked).toBe(true);
    expect(toggle.matches(":disabled")).toBe(false);
    expect(toggle.getAttribute("aria-disabled")).not.toBe("true");
    for (const label of ["All games", "Favorites", "Weekend", "Saved search"])
      expect(
        Number(shelfChip(label).lastElementChild?.textContent),
      ).toBeGreaterThan(0);

    await act(() =>
      container
        .querySelector<HTMLLabelElement>('label[for="library-show-shelves"]')!
        .click(),
    );
    expect(toggle.checked).toBe(false);
    expect(toggle.matches(":disabled")).toBe(false);
    expect(
      JSON.parse(localStorage.getItem(STORAGE_KEY)!).settings
        .libraryShowShelves,
    ).toBe(false);
    expect(container.querySelector('[aria-label="Library shelf"]')).toBeNull();
    expect(counts()).toEqual({ all: 4, unimported: 2, steam: 2 });
    expect(container.querySelectorAll(".game-library-card")).toHaveLength(4);
    expect(
      container.querySelector<HTMLInputElement>(
        '[placeholder="Search games..."]',
      )!.value,
    ).toBe("");
    expect(container.textContent).not.toContain("New shelf");
    expect(container.querySelector("[data-library-shelf]")).toBeNull();

    // Ordinary filtering still works, with no shelf actions left in the drawer.
    await setStatusFilter("Not planned");
    expect(counts()).toEqual({ all: 2, unimported: 1, steam: 1 });
    expect(container.textContent).not.toContain("Save as shelf");
    expect(container.textContent).not.toContain("Update Saved search");
    expect(useAppStore.getState().personalShelves).toBe(personalShelves);
    expect(useAppStore.getState().gameJournals).toBe(gameJournals);

    await act(() => toggle.click());
    expect(shelfChip("All games").getAttribute("aria-selected")).toBe("true");
    expect(shelfChip("Weekend").lastElementChild?.textContent).toBe("2");
    expect(shelfChip("Favorites").lastElementChild?.textContent).toBe("2");
    await selectShelf("Saved search");
    expect(container.querySelectorAll(".game-library-card")).toHaveLength(1);
    expect(gameCard(steam.name)).toBeDefined();
  },
);

it("shows shelves for older settings without a shelf preference", async () => {
  const settings = { ...useAppStore.getState().settings };
  delete settings.libraryShowShelves;
  useAppStore.setState({ settings });
  await act(() => root.render(<MyGamesView />));
  expect((await shelvesToggle()).checked).toBe(true);
  expect(shelfChip("Weekend").lastElementChild?.textContent).toBe("2");
});

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

function button(label: string, within: ParentNode = container) {
  const found = [...within.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) => item.textContent?.trim() === label,
  );
  expect(found, `no button for ${label}`).toBeDefined();
  return found!;
}

async function enterSelection() {
  await act(() =>
    container
      .querySelector<HTMLButtonElement>('[aria-label="Select games"]')!
      .click(),
  );
}

async function applyBulkStatus(label: string) {
  await act(() => button("Set status").click());
  const menu = document.querySelector("#library-bulk-status-menu")!;
  expect(menu).not.toBeNull();
  await act(() => button(label, menu).click());
}

function selectionCheckboxes() {
  return [
    ...container.querySelectorAll<HTMLButtonElement>(
      '.game-library-card [role="checkbox"]',
    ),
  ];
}

async function inputSearch(value: string) {
  const input = container.querySelector<HTMLInputElement>(
    '[placeholder="Search games..."]',
  )!;
  await act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it.each(["grid", "large", "list"] as const)(
  "selects ranges, applies statuses, and confirms with a toast in %s view",
  async (view) => {
    useAppStore.getState().setMyGamesCardSize(view);
    container.setAttribute("data-controller-content", "true");
    await act(() => root.render(<MyGamesView />));
    expect(selectionCheckboxes()).toHaveLength(0);
    await enterSelection();
    const checkboxes = selectionCheckboxes();
    expect(checkboxes).toHaveLength(4);
    expect(button("Set status").disabled).toBe(true);
    await act(() => checkboxes[0].click());
    await act(() =>
      checkboxes[3].dispatchEvent(
        new MouseEvent("click", { bubbles: true, shiftKey: true }),
      ),
    );
    expect(
      checkboxes.every((item) => item.getAttribute("aria-checked") === "true"),
    ).toBe(true);
    expect(container.textContent).toContain("4 selected");
    container.scrollTop = 350;
    await applyBulkStatus("Finished");
    expect(container.scrollTop).toBe(350);
    expect(useAppStore.getState().toasts).toEqual([
      expect.objectContaining({
        tone: "success",
        title: "4 games marked Finished",
      }),
    ]);
    expect(container.textContent).not.toContain("4 games marked Finished");
    expect(
      container.querySelector('[aria-label="Bulk status actions"]'),
    ).toBeNull();
    expect(container.textContent).not.toContain("0 selected");
    expect(selectionCheckboxes()).toHaveLength(0);
    const select = container.querySelector<HTMLButtonElement>(
      '[aria-label="Select games"]',
    )!;
    expect(select.getAttribute("aria-pressed")).toBe("false");
    expect(document.activeElement).toBe(select);
    expect(getGameJournal(useAppStore.getState(), local).status).toBe(
      "finished",
    );
    expect(getGameJournal(useAppStore.getState(), steam).status).toBe(
      "finished",
    );
  },
);

it("uses the current source, search, shelf, and status filters for bulk assignment", async () => {
  await act(() => root.render(<MyGamesView />));
  await selectShelf("Weekend");
  await selectSource("steam");
  await setStatusFilter("Not planned");
  await inputSearch("favorite");
  await enterSelection();
  expect(button("Select all 1 result")).toBeDefined();
  await act(() => button("Select all 1 result").click());
  await applyBulkStatus("Finished");
  expect(container.querySelectorAll(".game-library-card")).toHaveLength(0);
  expect(useAppStore.getState().toasts[0]).toMatchObject({
    tone: "success",
    title: "1 game marked Finished",
  });
  expect(
    container.querySelector('[aria-label="Bulk status actions"]'),
  ).toBeNull();
  expect(
    container
      .querySelector('[aria-label="Select games"]')
      ?.getAttribute("aria-pressed"),
  ).toBe("false");
  expect(document.activeElement).toBe(
    container.querySelector('[placeholder="Search games..."]'),
  );
  expect(getGameJournal(useAppStore.getState(), steam).status).toBe("finished");
  expect(getGameJournal(useAppStore.getState(), local).status).toBe(
    "not-planned",
  );
});

it("selects all results even while most cards have not rendered", async () => {
  vi.stubGlobal(
    "requestIdleCallback",
    vi.fn(() => 1),
  );
  vi.stubGlobal("cancelIdleCallback", vi.fn());
  const entries = Array.from({ length: 120 }, (_, index) => ({
    ...steam,
    externalId: String(1000 + index),
    gameId: 1000 + index,
    igdbId: 1000 + index,
    name: `Imported game ${index}`,
  }));
  useAppStore.setState({
    libraryImports: new Map(
      entries.map((entry) => [`steam:${entry.externalId}`, entry]),
    ),
  });
  await act(() => root.render(<MyGamesView />));
  await selectSource("steam");
  await enterSelection();
  expect(selectionCheckboxes().length).toBeLessThan(120);
  await act(() => button("Select all 120 results").click());
  await applyBulkStatus("Want to play");
  expect(
    entries.every(
      (entry) =>
        getGameJournal(useAppStore.getState(), entry).status === "want-to-play",
    ),
  ).toBe(true);
  expect(getGameJournal(useAppStore.getState(), local).status).toBe(
    "not-planned",
  );
});

it("works through No status games and offers explicit clearing", async () => {
  await act(() => root.render(<MyGamesView />));
  await setStatusFilter("No status");
  await enterSelection();
  expect(selectionCheckboxes()).toHaveLength(2);
  await act(() => button("Select all 2 results").click());
  await applyBulkStatus("Finished");
  expect(selectionCheckboxes()).toHaveLength(0);
  await setStatusFilter("Finished");
  await enterSelection();
  await act(() => button("Select all 2 results").click());
  await applyBulkStatus("Finished");
  expect(selectionCheckboxes()).toHaveLength(0);
  expect(useAppStore.getState().toasts[0]).toMatchObject({
    tone: "info",
    title: "Selected games are already marked Finished",
  });
  await enterSelection();
  await act(() => button("Select all 2 results").click());
  await applyBulkStatus("Clear status");
  expect(selectionCheckboxes()).toHaveLength(0);
  expect(useAppStore.getState().toasts[0]).toMatchObject({
    tone: "success",
    title: "Status cleared for 2 games",
  });
  expect(container.querySelectorAll(".game-library-card")).toHaveLength(0);
  expect(
    container.querySelector('[aria-label="Bulk status actions"]'),
  ).toBeNull();
});

it("clears selection on filter changes and preserves it across layouts", async () => {
  await act(() => root.render(<MyGamesView />));
  await enterSelection();
  await act(() => selectionCheckboxes()[0].click());
  await act(() => useAppStore.getState().setMyGamesCardSize("list"));
  expect(container.textContent).toContain("1 selected");
  const card = gameCard(local.gameName);
  expect(card.querySelector("[inert]")).not.toBeNull();
  await selectSource("steam");
  expect(container.textContent).toContain("0 selected");
  await act(() => button("Select all 2 results").click());
  await inputSearch("favorite");
  expect(container.textContent).toContain("0 selected");
  await inputSearch("");
  expect(
    selectionCheckboxes().every(
      (item) => item.getAttribute("aria-checked") === "false",
    ),
  ).toBe(true);
});

it("supports scoped Ctrl+A, keyboard menu navigation, and Escape without intercepting search editing", async () => {
  await act(() => root.render(<MyGamesView />));
  await enterSelection();
  const search = container.querySelector<HTMLInputElement>(
    '[placeholder="Search games..."]',
  )!;
  const editing = new KeyboardEvent("keydown", {
    key: "a",
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
  });
  await act(() => search.dispatchEvent(editing));
  expect(editing.defaultPrevented).toBe(false);
  expect(container.textContent).toContain("0 selected");
  await act(() =>
    selectionCheckboxes()[0].dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "a",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  expect(container.textContent).toContain("4 selected");
  await act(() => button("Set status").click());
  const menu = document.querySelector("#library-bulk-status-menu")!;
  await act(() => button("In progress", menu).focus());
  await act(() =>
    document.activeElement!.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "End",
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  expect(document.activeElement?.textContent).toBe("Clear status");
  await act(() =>
    document.activeElement!.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  expect(document.querySelector("#library-bulk-status-menu")).toBeNull();
  expect(selectionCheckboxes()).toHaveLength(0);
  expect(document.activeElement).toBe(
    container.querySelector('[aria-label="Select games"]'),
  );
});

it.each(["select button", "game", "search", "empty space"])(
  "shows selection mode clearly and exits with Escape from %s",
  async (focus) => {
    await act(() => root.render(<MyGamesView />));
    const select = container.querySelector<HTMLButtonElement>(
      '[aria-label="Select games"]',
    )!;
    expect(select.textContent).toBe("Select");
    expect(select.classList.contains("bg-accent")).toBe(false);
    await enterSelection();
    expect(select.getAttribute("aria-pressed")).toBe("true");
    expect(select.classList.contains("bg-accent")).toBe(true);
    expect(select.textContent).toBe("Selecting");
    expect(select.title).toBe("Exit selection mode (Esc)");
    await act(() => selectionCheckboxes()[0].click());
    const journals = useAppStore.getState().gameJournals;
    const target =
      focus === "select button"
        ? select
        : focus === "game"
          ? selectionCheckboxes()[0]
          : focus === "search"
            ? container.querySelector<HTMLInputElement>(
                '[placeholder="Search games..."]',
              )!
            : document.body;
    await act(() =>
      target.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(selectionCheckboxes()).toHaveLength(0);
    expect(select.getAttribute("aria-pressed")).toBe("false");
    expect(select.classList.contains("bg-accent")).toBe(false);
    expect(select.textContent).toBe("Select");
    expect(document.activeElement).toBe(select);
    expect(useAppStore.getState().gameJournals).toBe(journals);
    await enterSelection();
    expect(container.textContent).toContain("0 selected");
  },
);

it("keeps Escape scoped to the visible library and lets dialogs handle it first", async () => {
  await act(() => root.render(<MyGamesView />));
  await enterSelection();
  const escape = () =>
    act(() =>
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", cancelable: true }),
      ),
    );
  await act(() => useAppStore.getState().setActiveView("now"));
  await escape();
  expect(selectionCheckboxes()).toHaveLength(4);
  await act(() => useAppStore.getState().setActiveView("games"));
  const dialog = document.createElement("div");
  dialog.setAttribute("role", "dialog");
  document.body.append(dialog);
  try {
    await escape();
    expect(selectionCheckboxes()).toHaveLength(4);
  } finally {
    dialog.remove();
  }
  await escape();
  expect(selectionCheckboxes()).toHaveLength(0);
});

async function openFilters() {
  const toggle = container.querySelector<HTMLButtonElement>(
    '[aria-controls="library-filters"]',
  )!;
  if (toggle.getAttribute("aria-expanded") !== "true")
    await act(() => toggle.click());
}

it("creates a shelf first, previews the whole library, and saves filters to that same shelf", async () => {
  await act(() => root.render(<MyGamesView />));
  await act(() => button("New shelf").click());
  const name = document.querySelector<HTMLInputElement>(
    '[aria-label="Shelf name"]',
  )!;
  await act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(name, "Backlog");
    name.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(() => button("Save shelf", document).click());
  const id = useAppStore
    .getState()
    .personalShelves.find((s) => s.name === "Backlog")!.id;
  expect(shelfChip("Backlog").getAttribute("aria-selected")).toBe("true");
  expect(container.textContent).toContain("This shelf is empty");
  await act(() => button("Add filters").click());
  expect(container.textContent).toContain("Filters for Backlog");
  expect(container.querySelectorAll(".game-library-card")).toHaveLength(4);
  expect(button("Save filters").disabled).toBe(true);
  await setStatusFilter("No status");
  expect(container.querySelectorAll(".game-library-card")).toHaveLength(2);
  expect(button("Save filters").disabled).toBe(false);
  await act(() => button("Save filters").click());
  expect(container.querySelector("#library-filters")).toBeNull();
  expect(
    useAppStore.getState().personalShelves.find((s) => s.id === id),
  ).toEqual({ id, name: "Backlog", filters: { status: "none" } });
  expect(useAppStore.getState().personalShelves).toHaveLength(2);
  await selectShelf("All games");
  await selectShelf("Backlog");
  expect(container.querySelectorAll(".game-library-card")).toHaveLength(2);
  expect(
    JSON.parse(localStorage.getItem(STORAGE_KEY)!).personalShelves.find(
      (s: { id: string }) => s.id === id,
    ).filters,
  ).toEqual({ status: "none" });
  await openFilters();
  expect(button("Save filters").disabled).toBe(true);
  expect(container.textContent).not.toContain("Save as shelf");
});

it.each(["search", "source"] as const)(
  "saves a %s-only filter onto an existing shelf",
  async (rule) => {
    await act(() => root.render(<MyGamesView />));
    await selectShelf("Weekend");
    await openFilters();
    if (rule === "search") await inputSearch("  other  ");
    else await selectSource("steam");
    expect(button("Save filters").disabled).toBe(false);
    await act(() => button("Save filters").click());
    expect(
      useAppStore.getState().personalShelves.find((s) => s.id === shelf)
        ?.filters,
    ).toEqual(rule === "search" ? { search: "other" } : { source: "steam" });
    await selectShelf("All games");
    await selectShelf("Weekend");
    expect(container.querySelectorAll(".game-library-card")).toHaveLength(2);
    expect(
      container.querySelector<HTMLInputElement>(
        '[placeholder="Search games..."]',
      )!.value,
    ).toBe(rule === "search" ? "other" : "");
    expect(
      container.querySelector(
        '[aria-label="Game library source"] [aria-selected="true"]',
      )!.id,
    ).toBe(rule === "source" ? "library-tab-steam" : "library-tab-all");
  },
);

it("discards shelf filter previews on Cancel and restores the existing manual games", async () => {
  await act(() => root.render(<MyGamesView />));
  await selectShelf("Weekend");
  const journals = useAppStore.getState().gameJournals;
  await openFilters();
  await setStatusFilter("No status");
  await selectSource("steam");
  await inputSearch("other");
  expect(container.querySelectorAll(".game-library-card")).toHaveLength(1);
  expect(gameCard("Steam other")).toBeDefined();
  await act(() => button("Cancel").click());
  expect(container.querySelector("#library-filters")).toBeNull();
  expect(container.querySelectorAll(".game-library-card")).toHaveLength(2);
  expect(gameCard("Local favorite")).toBeDefined();
  expect(gameCard("Steam favorite")).toBeDefined();
  expect(
    useAppStore.getState().personalShelves.find((s) => s.id === shelf)?.filters,
  ).toBeUndefined();
  expect(useAppStore.getState().gameJournals).toBe(journals);
  expect(document.activeElement).toBe(
    container.querySelector('[aria-controls="library-filters"]'),
  );
});

it("edits an inactive shelf through its context menu and restores manual additions when filters are removed", async () => {
  await act(() => root.render(<MyGamesView />));
  await act(() =>
    shelfChip("Weekend").dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
    ),
  );
  await act(() => button("Edit filters", document).click());
  expect(shelfChip("Weekend").getAttribute("aria-selected")).toBe("true");
  expect(container.textContent).toContain("Filters for Weekend");
  await setStatusFilter("No status");
  await act(() => button("Save filters").click());
  expect(gameCard("Local other")).toBeDefined();
  expect(gameCard("Steam other")).toBeDefined();
  expect(getGameJournal(useAppStore.getState(), local).shelfIds).toContain(
    shelf,
  );
  await openFilters();
  await setStatusFilter("In progress");
  expect(container.querySelectorAll(".game-library-card")).toHaveLength(0);
  await act(() => button("Cancel").click());
  expect(container.querySelectorAll(".game-library-card")).toHaveLength(2);
  await openFilters();
  await act(() => button("Remove saved filters").click());
  expect(gameCard("Local favorite")).toBeDefined();
  expect(gameCard("Steam favorite")).toBeDefined();
  expect(
    useAppStore.getState().personalShelves.find((s) => s.id === shelf)?.filters,
  ).toBeUndefined();
  expect(shelfChip("Weekend").getAttribute("data-library-drop-shelf")).toBe(
    shelf,
  );
});

it("clears source and search with the other filters and offers shelf saving only on a custom shelf", async () => {
  await act(() => root.render(<MyGamesView />));
  await selectSource("steam");
  await inputSearch("favorite");
  await openFilters();
  expect(container.textContent).toContain(
    "Select a shelf to save these filters to it.",
  );
  expect(container.querySelector('[aria-label^="Save filters to"]')).toBeNull();
  expect(container.textContent).not.toContain("Save as shelf");
  await act(() => button("Clear filters").click());
  expect(container.querySelectorAll(".game-library-card")).toHaveLength(4);
  expect(
    container.querySelector<HTMLInputElement>(
      '[placeholder="Search games..."]',
    )!.value,
  ).toBe("");
  expect(button("Clear filters").disabled).toBe(true);
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

async function nextFrame() {
  await act(
    () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
  );
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
  "drags selected games with one card and an extra-game count in %s view",
  async (view) => {
    useAppStore.getState().setMyGamesCardSize(view);
    const target = useAppStore.getState().savePersonalShelf({ name: "Co-op" })!;
    await act(() => root.render(<MyGamesView />));
    await enterSelection();
    const names = [local.gameName, "Local other", steam.name];
    for (const name of names)
      await act(() =>
        gameCard(name)
          .querySelector<HTMLButtonElement>('[role="checkbox"]')!
          .click(),
      );
    const card = gameCard(steam.name);
    const checkbox =
      card.querySelector<HTMLButtonElement>('[role="checkbox"]')!;
    // Real pointer input starts on the full-card selection button.
    await startDrag(checkbox);
    expect(
      document.querySelectorAll(".library-game-drag-preview"),
    ).toHaveLength(1);
    expect(
      document.querySelector(".library-game-drag-preview")?.textContent,
    ).toContain(steam.name);
    expect(
      document.querySelector(".library-game-drag-preview [role=checkbox]"),
    ).toBeNull();
    expect(
      document.querySelector(".library-game-drag-count")?.textContent,
    ).toBe("+2");
    await releaseOnShelf("Co-op");
    expect(document.querySelector(".library-game-drag-count")).toBeNull();
    expect(document.querySelector(".library-game-drag-preview")).toBeNull();
    expect(card.hasAttribute("data-library-drag-source")).toBe(false);
    // The synthetic click following a drag must not deselect the source.
    await act(() => checkbox.click());
    expect(container.textContent).toContain("3 selected");
    expect(checkbox.getAttribute("aria-checked")).toBe("true");
    for (const game of [local, { ...local, gameId: -2 }, steam])
      expect(getGameJournal(useAppStore.getState(), game).shelfIds).toContain(
        target,
      );
    expect(
      getGameJournal(useAppStore.getState(), {
        ...steam,
        gameId: 2,
        igdbId: 200,
      }).shelfIds,
    ).not.toContain(target);
    expect(shelfChip("All games").getAttribute("aria-selected")).toBe("true");
    expect(shelfChip("Co-op").lastElementChild?.textContent).toBe("3");
    expect(useAppStore.getState().toasts).toEqual([
      expect.objectContaining({ title: "Added 3 games to Co-op" }),
    ]);
  },
);

it("keeps ordinary selection clicks and drags a single selected card without a count", async () => {
  await act(() => root.render(<MyGamesView />));
  await enterSelection();
  const checkbox = gameCard(local.gameName).querySelector<HTMLButtonElement>(
    '[role="checkbox"]',
  )!;
  await pointer(checkbox, "pointerdown");
  await pointer(window, "pointermove", { clientX: 140, clientY: 410 });
  expect(document.querySelector(".library-game-drag-preview")).toBeNull();
  await pointer(window, "pointerup");
  await act(() => checkbox.click());
  expect(checkbox.getAttribute("aria-checked")).toBe("true");
  await startDrag(checkbox);
  expect(document.querySelector(".library-game-drag-count")).toBeNull();
  await pointer(window, "pointercancel");
  await nextFrame();
  await pointer(checkbox, "pointerdown");
  await pointer(window, "pointermove", { clientX: 123, clientY: 402 });
  await pointer(window, "pointerup");
  await act(() => checkbox.click());
  expect(checkbox.getAttribute("aria-checked")).toBe("false");
});

it("adds only missing games to shelves and Favorites and explains when all are already added", async () => {
  useAppStore
    .getState()
    .savePersonalShelf({ name: "Unplayed", filters: { played: "unplayed" } });
  const onRender = vi.fn();
  await act(() =>
    root.render(
      <Profiler id="library" onRender={onRender}>
        <MyGamesView />
      </Profiler>,
    ),
  );
  await enterSelection();
  await act(() => button("Select all 4 results").click());
  onRender.mockClear();
  await startDrag(
    gameCard(local.gameName).querySelector<HTMLElement>('[role="checkbox"]')!,
  );
  expect(shelfChip("Weekend").hasAttribute("data-library-drag-blocked")).toBe(
    false,
  );
  expect(shelfChip("Favorites").hasAttribute("data-library-drag-blocked")).toBe(
    false,
  );
  expect(shelfChip("Unplayed").dataset.libraryDragBlocked).toBe("saved-filter");
  const measure = vi.spyOn(shelfChip("Weekend"), "getBoundingClientRect");
  await pointer(window, "pointermove", { clientX: 220, clientY: 100 });
  await nextFrame();
  expect(onRender).not.toHaveBeenCalled();
  expect(measure).not.toHaveBeenCalled();
  await releaseOnShelf("Weekend");
  expect(shelfChip("Weekend").lastElementChild?.textContent).toBe("4");
  expect(useAppStore.getState().toasts[0]).toMatchObject({
    title: "Added 2 games to Weekend",
    detail: "2 already in Weekend",
  });
  const journals = useAppStore.getState().gameJournals;
  await startDrag(gameCard(local.gameName));
  expect(shelfChip("Weekend").dataset.libraryDragBlocked).toBe("already-added");
  expect(
    shelfChip("Weekend").querySelector("[data-hint-title]")?.textContent,
  ).toBe("All selected games are already in Weekend");
  await releaseOnShelf("Weekend");
  expect(useAppStore.getState().gameJournals).toBe(journals);
  expect(useAppStore.getState().toasts).toHaveLength(1);
  await dropGame(gameCard(local.gameName), "Favorites");
  expect(shelfChip("Favorites").lastElementChild?.textContent).toBe("4");
  const favorites = useAppStore.getState().gameJournals;
  await dropGame(gameCard(local.gameName), "Unplayed");
  expect(useAppStore.getState().gameJournals).toBe(favorites);
});

it("rechecks every selected game's latest membership and keeps selection when Escape cancels a drag", async () => {
  const target = useAppStore.getState().savePersonalShelf({ name: "Co-op" })!;
  await act(() => root.render(<MyGamesView />));
  await enterSelection();
  await act(() => button("Select all 4 results").click());
  const journals = useAppStore.getState().gameJournals;
  await startDrag(gameCard(local.gameName));
  await act(() =>
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  await nextFrame();
  expect(document.querySelector(".library-game-drag-count")).toBeNull();
  expect(document.querySelector(".library-game-drag-preview")).toBeNull();
  expect(container.textContent).toContain("4 selected");
  expect(useAppStore.getState().gameJournals).toBe(journals);

  await startDrag(gameCard(local.gameName));
  await act(() =>
    useAppStore.getState().updateGameJournal(steam, {
      shelfIds: [shelf, target],
      note: "Written during the drag",
    }),
  );
  await releaseOnShelf("Co-op");
  expect(getGameJournal(useAppStore.getState(), steam)).toMatchObject({
    shelfIds: [shelf, target],
    note: "Written during the drag",
  });
  expect(shelfChip("Co-op").lastElementChild?.textContent).toBe("4");
  expect(useAppStore.getState().toasts[0]).toMatchObject({
    title: "Added 3 games to Co-op",
  });
});

it("drags all selected results from the current scope, including cards not yet rendered", async () => {
  vi.stubGlobal(
    "requestIdleCallback",
    vi.fn(() => 1),
  );
  vi.stubGlobal("cancelIdleCallback", vi.fn());
  const entries = Array.from({ length: 120 }, (_, index) => ({
    ...steam,
    externalId: String(1000 + index),
    gameId: 1000 + index,
    igdbId: 1000 + index,
    name: `Imported game ${index}`,
  }));
  useAppStore.setState({
    libraryImports: new Map(
      entries.map((entry) => [`steam:${entry.externalId}`, entry]),
    ),
  });
  await act(() => root.render(<MyGamesView />));
  await selectSource("steam");
  await enterSelection();
  await act(() => button("Select all 120 results").click());
  expect(selectionCheckboxes().length).toBeLessThan(120);
  await startDrag(selectionCheckboxes()[0]);
  expect(document.querySelector(".library-game-drag-count")?.textContent).toBe(
    "+119",
  );
  await releaseOnShelf("Favorites");
  expect(
    entries.every(
      (game) => getGameJournal(useAppStore.getState(), game).favorite,
    ),
  ).toBe(true);
  expect(
    getGameJournal(useAppStore.getState(), { ...local, gameId: -2 }).favorite,
  ).toBe(false);
  expect(container.textContent).toContain("120 selected");
});

it("cancels shelf dragging when shelves are disabled and allows it again when enabled", async () => {
  await act(() => root.render(<MyGamesView />));
  const card = gameCard(local.gameName);
  const { gameJournals } = useAppStore.getState();
  await startDrag(card);
  await act(() => useAppStore.getState().setMyGamesShowShelves(false));
  expect(document.querySelector(".library-game-drag-preview")).toBeNull();
  expect(card.hasAttribute("data-library-drag-source")).toBe(false);
  expect(
    document.documentElement.classList.contains("library-game-dragging"),
  ).toBe(false);
  await pointer(window, "pointerup");
  await pointer(card, "pointerdown");
  await pointer(window, "pointermove", { clientX: 140, clientY: 410 });
  expect(document.querySelector(".library-game-drag-preview")).toBeNull();
  await pointer(window, "pointerup");
  expect(useAppStore.getState().gameJournals).toBe(gameJournals);

  await act(() => useAppStore.getState().setMyGamesShowShelves(true));
  await startDrag(card);
  await pointer(window, "pointercancel");
  await nextFrame();
  expect(document.querySelector(".library-game-drag-preview")).toBeNull();
});

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
    const toasts = useAppStore.getState().toasts;
    await dropGame(gameCard(local.gameName), "Co-op");
    expect(useAppStore.getState().gameJournals).toBe(journals);
    expect(useAppStore.getState().toasts).toBe(toasts);
    expect(document.querySelector(".library-game-drop-hint")?.textContent).toBe(
      "Already in Co-op",
    );

    await dropGame(gameCard(local.gameName), "Favorites");
    expect(document.querySelector(".library-game-drop-hint")).toBeNull();
    expect(getGameJournal(useAppStore.getState(), local)).toEqual({
      ...original,
      favorite: true,
      shelfIds: [shelf, target],
    });
    expect(getGameJournal(useAppStore.getState(), steam)).toEqual(other);
  },
);

it("explains blocked shelf drops without changing data, and ignores external or cancelled drags", async () => {
  useAppStore.getState().savePersonalShelf({
    name: "Unplayed",
    filters: { played: "unplayed" },
  });
  await act(() => root.render(<MyGamesView />));
  const journals = useAppStore.getState().gameJournals;
  await act(() => {
    shelfChip("Weekend").dispatchEvent(new Event("drop", { bubbles: true }));
  });

  for (const [label, message] of [
    [
      "Unplayed",
      "This shelf fills itself from filtersGames are added automatically when they match. Right-click the shelf to edit its filters.",
    ],
    ["All games", "Already in All games"],
  ]) {
    await dropGame(gameCard("Local other"), label);
    expect(document.querySelector(".library-game-drop-hint")?.textContent).toBe(
      message,
    );
    expect(useAppStore.getState().gameJournals).toBe(journals);
    expect(useAppStore.getState().toasts).toHaveLength(0);
  }
  await startDrag(gameCard("Local other"));
  expect(document.querySelector(".library-game-drop-hint")).toBeNull();
  await act(() => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
  });
  await releaseOnShelf("Weekend");
  expect(useAppStore.getState().gameJournals).toBe(journals);
  expect(document.querySelector(".library-game-drop-hint")).toBeNull();
});

it("clears duplicate Favorites feedback when scrolling or leaving the library", async () => {
  useAppStore.setState({ activeView: "games" });
  await act(() => root.render(<MyGamesView />));
  const journals = useAppStore.getState().gameJournals;
  await dropGame(gameCard(local.gameName), "Favorites");
  expect(document.querySelector(".library-game-drop-hint")?.textContent).toBe(
    "Already in Favorites",
  );
  await act(() => container.dispatchEvent(new Event("scroll")));
  expect(document.querySelector(".library-game-drop-hint")).toBeNull();

  await dropGame(gameCard(local.gameName), "Favorites");
  await act(() => useAppStore.getState().setActiveView("history"));
  expect(document.querySelector(".library-game-drop-hint")).toBeNull();
  expect(useAppStore.getState().gameJournals).toBe(journals);
  expect(useAppStore.getState().toasts).toHaveLength(0);
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
  const journals = useAppStore.getState().gameJournals;
  await dropGame(gameCard(steam.name), "Co-op");
  expect(document.querySelector(".library-game-drop-hint")?.textContent).toBe(
    "Already in Co-op",
  );
  expect(useAppStore.getState().gameJournals).toBe(journals);
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

it("rechecks membership on drop when a shelf's prepared hover hint is no longer current", async () => {
  await act(() => root.render(<MyGamesView />));
  const card = gameCard(local.gameName);
  await startDrag(card);
  expect(shelfChip("Weekend").dataset.libraryDragBlocked).toBe("already-added");
  await act(() =>
    useAppStore.getState().updateGameJournal(local, { shelfIds: [] }),
  );
  await releaseOnShelf("Weekend");
  expect(getGameJournal(useAppStore.getState(), local).shelfIds).toEqual([
    shelf,
  ]);
  expect(document.querySelector(".library-game-drop-hint")).toBeNull();

  await act(() =>
    useAppStore.getState().updateGameJournal(local, { shelfIds: [] }),
  );
  await startDrag(card);
  expect(shelfChip("Weekend").hasAttribute("data-library-drag-blocked")).toBe(
    false,
  );
  await act(() =>
    useAppStore.getState().updateGameJournal(local, { shelfIds: [shelf] }),
  );
  const journals = useAppStore.getState().gameJournals;
  await releaseOnShelf("Weekend");
  expect(document.querySelector(".library-game-drop-hint")?.textContent).toBe(
    "Already in Weekend",
  );
  expect(useAppStore.getState().gameJournals).toBe(journals);
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

it.each(["before", "during"])(
  "keeps the returning card attached to its library slot when scrolling %s the animation",
  async (timing) => {
    // Match App's positioned scroll area, including its border and existing scroll.
    container.setAttribute("data-controller-content", "true");
    container.style.position = "absolute";
    container.style.overflow = "auto";
    Object.defineProperty(container, "clientLeft", { value: 2 });
    Object.defineProperty(container, "clientTop", { value: 3 });
    vi.spyOn(container, "getBoundingClientRect").mockReturnValue(
      new DOMRect(100, 80, 800, 600),
    );
    container.scrollLeft = 30;
    container.scrollTop = 500;
    await act(() => root.render(<MyGamesView />));
    const card = gameCard("Local other");
    const measureCard = vi
      .spyOn(card, "getBoundingClientRect")
      .mockImplementation(
        () =>
          new DOMRect(
            362 - container.scrollLeft,
            983 - container.scrollTop,
            200,
            300,
          ),
      );
    await startDrag(card);
    const preview = document.querySelector<HTMLElement>(
      ".library-game-drag-preview",
    )!;
    const animation = {
      cancel: vi.fn(),
      onfinish: null,
    } as unknown as Animation;
    const animate = vi.fn<HTMLElement["animate"]>(() => animation);
    Object.defineProperty(preview, "animate", { value: animate });
    const scroll = () => {
      container.scrollLeft = 70;
      container.scrollTop = 660;
      container.dispatchEvent(new Event("scroll"));
    };
    vi.mocked(document.elementFromPoint).mockReturnValue(shelfChip("Weekend"));
    await act(() => {
      window.dispatchEvent(
        new PointerEvent("pointerup", {
          pointerId: 1,
          pointerType: "mouse",
          clientX: 220,
          clientY: 100,
        }),
      );
      if (timing === "before") scroll();
    });
    await nextFrame();
    expect(preview.parentElement === container).toBe(true);
    expect(preview.style.position).toBe("absolute");
    expect(card.hasAttribute("data-library-drag-source")).toBe(true);
    // The destination is in content coordinates, independent of either scroll offset.
    const keyframes = animate.mock.calls[0]?.[0] as Keyframe[];
    expect(keyframes.at(-1)?.transform).toBe(
      "translate3d(260px, 900px, 0) scale(1, 1)",
    );
    const journals = useAppStore.getState().gameJournals;
    measureCard.mockClear();
    if (timing === "during") await act(scroll);
    await nextFrame();
    expect(animate).toHaveBeenCalledTimes(1);
    expect(measureCard).not.toHaveBeenCalled();
    expect(preview.isConnected).toBe(true);
    await act(() =>
      animation.onfinish?.call(
        animation,
        new Event("finish") as AnimationPlaybackEvent,
      ),
    );
    expect(animation.cancel).toHaveBeenCalledTimes(1);
    expect(preview.isConnected).toBe(false);
    expect(card.hasAttribute("data-library-drag-source")).toBe(false);
    expect(useAppStore.getState().gameJournals).toBe(journals);
  },
);

it.each(["pointercancel", "blur", "pointerleave"])(
  "restores the card without assigning it after %s",
  async (type) => {
    await act(() => root.render(<MyGamesView />));
    const journals = useAppStore.getState().gameJournals;
    const card = gameCard("Local other");
    await startDrag(card);
    await act(() => {
      const target =
        type === "pointerleave" ? document.documentElement : window;
      target.dispatchEvent(new Event(type));
    });
    await releaseOnShelf("Weekend");
    expect(useAppStore.getState().gameJournals).toBe(journals);
    expect(document.querySelector(".library-game-drag-preview")).toBeNull();
    expect(card.hasAttribute("data-library-drag-source")).toBe(false);
    expect(container.querySelector("[data-library-drag-blocked]")).toBeNull();
    expect(shelfChip("Weekend").getAttribute("title")).toBe(
      "Right-click to edit filters, rename, or delete",
    );
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
  expect(document.querySelector("[data-library-drag-blocked]")).toBeNull();
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
  expect(container.querySelector("[data-library-drag-blocked]")).toBeNull();
});

it("prepares blocked-shelf explanations before release without rerendering during hover", async () => {
  useAppStore
    .getState()
    .savePersonalShelf({ name: "Unplayed", filters: { played: "unplayed" } });
  useAppStore.getState().savePersonalShelf({ name: "Later" });
  const onRender = vi.fn();
  await act(() =>
    root.render(
      <Profiler id="library" onRender={onRender}>
        <MyGamesView />
      </Profiler>,
    ),
  );
  onRender.mockClear();
  await startDrag(gameCard(local.gameName));
  await nextFrame();
  expect(shelfChip("Later").hasAttribute("data-library-drag-blocked")).toBe(
    false,
  );
  for (const [label, reason, message] of [
    ["Weekend", "already-added", "Already in Weekend"],
    ["Favorites", "already-added", "Already in Favorites"],
    ["All games", "already-added", "Already in All games"],
    ["Unplayed", "saved-filter", "This shelf fills itself from filters"],
  ]) {
    const chip = shelfChip(label);
    const hint = chip.querySelector<HTMLElement>(".library-game-hover-hint")!;
    expect(chip.dataset.libraryDragBlocked).toBe(reason);
    expect(hint.textContent).toContain(message);
    expect(chip.getAttribute("aria-describedby")).toBe(hint.id);
    expect(chip.hasAttribute("title")).toBe(false);
    vi.mocked(document.elementFromPoint).mockReturnValue(shelfChip(label));
    await pointer(chip, "pointermove", { clientX: 220, clientY: 100 });
    await nextFrame();
  }
  expect(onRender).not.toHaveBeenCalled();
  expect(document.elementFromPoint).not.toHaveBeenCalled();
  expect(useAppStore.getState().toasts).toHaveLength(0);
});

it("waits for release to look up the shelf and change membership, without measuring layout during movement", async () => {
  await act(() => root.render(<MyGamesView />));
  const card = gameCard("Local other");
  const rail = container.querySelector<HTMLElement>(
    "[data-library-shelf-rail]",
  )!;
  const measureCard = vi.spyOn(card, "getBoundingClientRect");
  const measureRail = vi.spyOn(rail, "getBoundingClientRect");
  const journals = useAppStore.getState().gameJournals;
  await startDrag(card);
  await nextFrame();
  const measureHints = vi.spyOn(
    shelfChip("All games").querySelector<HTMLElement>(
      ".library-game-hover-hint",
    )!,
    "getBoundingClientRect",
  );
  const measureShelf = vi.spyOn(
    shelfChip("All games"),
    "getBoundingClientRect",
  );
  measureCard.mockClear();
  measureRail.mockClear();
  vi.mocked(document.elementFromPoint)
    .mockClear()
    .mockReturnValue(shelfChip("Weekend"));
  await act(() => {
    for (let x = 220; x < 250; x++) {
      window.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          pointerId: 1,
          pointerType: "mouse",
          isPrimary: true,
          buttons: 1,
          clientX: x,
          clientY: 100,
        }),
      );
    }
  });
  await nextFrame();
  expect(document.elementFromPoint).not.toHaveBeenCalled();
  expect(measureCard).not.toHaveBeenCalled();
  expect(measureRail).not.toHaveBeenCalled();
  expect(measureHints).not.toHaveBeenCalled();
  expect(measureShelf).not.toHaveBeenCalled();
  expect(useAppStore.getState().gameJournals).toBe(journals);
  expect(document.querySelector(".library-game-drop-hint")).toBeNull();

  await pointer(window, "pointerup", { clientX: 249, clientY: 100 });
  expect(document.elementFromPoint).toHaveBeenCalledTimes(1);
  expect(document.elementFromPoint).toHaveBeenLastCalledWith(249, 100);
  expect(
    getGameJournal(useAppStore.getState(), { gameId: -2, source: "custom" })
      .shelfIds,
  ).toEqual([shelf]);
  await nextFrame();
});

it("uses the release position when dropping before the next pointer frame", async () => {
  await act(() => root.render(<MyGamesView />));
  await startDrag(gameCard("Local other"));
  vi.mocked(document.elementFromPoint).mockImplementation((x) =>
    shelfChip(x >= 300 ? "Weekend" : "Favorites"),
  );
  await act(() => {
    window.dispatchEvent(
      new PointerEvent("pointermove", {
        pointerId: 1,
        pointerType: "mouse",
        buttons: 1,
        clientX: 220,
        clientY: 100,
      }),
    );
    window.dispatchEvent(
      new PointerEvent("pointerup", {
        pointerId: 1,
        pointerType: "mouse",
        clientX: 320,
        clientY: 100,
      }),
    );
  });
  await nextFrame();
  expect(
    getGameJournal(useAppStore.getState(), { gameId: -2, source: "custom" }),
  ).toMatchObject({
    favorite: false,
    shelfIds: [shelf],
  });
  expect(document.querySelector(".library-game-drag-preview")).toBeNull();
  expect(
    document.documentElement.classList.contains("library-game-dragging"),
  ).toBe(false);
});

it("discards queued pointer work when a drag is cancelled", async () => {
  await act(() => root.render(<MyGamesView />));
  await startDrag(gameCard("Local other"));
  const journals = useAppStore.getState().gameJournals;
  vi.mocked(document.elementFromPoint)
    .mockClear()
    .mockReturnValue(shelfChip("Weekend"));
  await act(() => {
    window.dispatchEvent(
      new PointerEvent("pointermove", {
        pointerId: 1,
        pointerType: "mouse",
        buttons: 1,
        clientX: 220,
        clientY: 100,
      }),
    );
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
  });
  await nextFrame();
  expect(document.elementFromPoint).not.toHaveBeenCalled();
  expect(useAppStore.getState().gameJournals).toBe(journals);
  expect(document.querySelector(".library-game-drag-preview")).toBeNull();
  expect(
    document.documentElement.classList.contains("library-game-dragging"),
  ).toBe(false);
});
