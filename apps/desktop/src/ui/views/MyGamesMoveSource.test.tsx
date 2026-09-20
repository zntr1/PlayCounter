// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { commitLibraryImports } from "../../library/commit";
import { buildLibraryImportCommit } from "../../library/importPlan";
import { useAppStore } from "../../store";
import { MyGamesView } from "./MyGamesView";

vi.mock("../../tracker");
vi.mock("../../platform", () => ({ currentPlatform: () => "windows" }));
vi.mock("../../gameDetails", () => ({
  useGameDetails: () => ({ status: "empty" }),
}));

const NAME = "Transferred game";
const DATE = "2026-09-15T12:00:00.000Z";
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
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
function button(label: string, scope: ParentNode = document) {
  const target = [...scope.querySelectorAll<HTMLButtonElement>("button")].find(
    (entry) => entry.textContent?.trim() === label,
  );
  expect(target, `missing ${label}`).toBeDefined();
  return target!;
}
function importGame(provider: "steam" | "xbox", id = 1) {
  commitLibraryImports([
    buildLibraryImportCommit({
      provider,
      now: DATE,
      scanned: {
        externalId: String(id * 100),
        playtimeSeconds: 3600,
        lastPlayedUnix: Date.parse(DATE) / 1000,
        installed: false,
        executables: [],
      },
      resolved: {
        key: `${provider}:${id * 100}`,
        status: "resolved",
        game: {
          id,
          igdbId: id * 100,
          source: "igdb",
          name: id === 1 ? NAME : `Imported game ${id}`,
          coverUrl: "",
        },
        executables: [],
      },
    })!,
  ]);
}
async function contextMenu() {
  await act(() =>
    container
      .querySelector(".game-library-card")!
      .dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
      ),
  );
}
async function source(id: string) {
  await act(() =>
    container.querySelector<HTMLButtonElement>(`#library-tab-${id}`)!.click(),
  );
}

async function enterSelection() {
  await act(() =>
    container
      .querySelector<HTMLButtonElement>('[aria-label="Select games"]')!
      .click(),
  );
}
async function selectGame(name: string) {
  await act(() =>
    container
      .querySelector<HTMLButtonElement>(
        `[role="checkbox"][aria-label="Select ${name}"]`,
      )!
      .click(),
  );
}

it.each(["grid", "large", "list"] as const)(
  "moves only selected launcher games from a mixed selection in %s view",
  async (layout) => {
    importGame("steam");
    importGame("xbox", 2);
    importGame("steam", 3);
    useAppStore.setState({
      exeCache: new Map([
        [
          "local.exe",
          {
            exeName: "local.exe",
            state: "matched",
            gameId: -20,
            source: "custom",
            gameName: "Local game",
            lastCheckedAt: DATE,
          },
        ],
      ]),
    });
    useAppStore.getState().setMyGamesCardSize(layout);
    await act(() => root.render(<MyGamesView />));
    await enterSelection();
    expect(button("Move to PlayCounter").disabled).toBe(true);
    await selectGame("Local game");
    expect(button("Move to PlayCounter").disabled).toBe(true);
    expect(button("Move to PlayCounter").title).toContain(
      "already in PlayCounter",
    );
    await selectGame(NAME);
    await selectGame("Imported game 2");
    await act(() => button("Move to PlayCounter").click());
    let dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain("Move 2 games to PlayCounter?");
    expect(dialog.textContent).toContain(
      "1 selected game is already in PlayCounter",
    );
    const names = [
      ...dialog.querySelectorAll('ul[aria-label="Games to move"] li'),
    ].map((row) => row.textContent);
    expect(names).toHaveLength(2);
    expect(names.join(" ")).toContain(NAME);
    expect(names.join(" ")).toContain("Imported game 2");
    expect(dialog.textContent).not.toContain("Imported game 3");
    expect(useAppStore.getState().libraryImports.size).toBe(3);
    await act(() => button("Cancel", dialog).click());
    expect(container.textContent).toContain("3 selected");
    expect(useAppStore.getState().libraryImports.size).toBe(3);
    await act(() => button("Move to PlayCounter").click());
    dialog = document.querySelector('[role="dialog"]')!;
    await act(() => button("Move to PlayCounter", dialog).click());
    expect([...useAppStore.getState().libraryImports.keys()]).toEqual([
      "steam:300",
    ]);
    expect(useAppStore.getState().playcounterLibrary.size).toBe(2);
    expect(
      container.querySelector('[aria-label="Bulk game actions"]'),
    ).toBeNull();
    expect(useAppStore.getState().toasts.at(-1)?.title).toBe(
      "2 games moved to PlayCounter",
    );
    await source("unimported");
    expect(container.querySelectorAll(".game-library-card")).toHaveLength(3);
    expect(container.querySelector("#library-tabpanel")?.textContent).toContain(
      NAME,
    );
    expect(container.querySelector("#library-tabpanel")?.textContent).toContain(
      "Imported game 2",
    );
    expect(useAppStore.getState().recentSessions).toEqual([]);
  },
);

it("moves every selected game beyond the current render window and leaves filtered games alone", async () => {
  importGame("steam");
  const entry = useAppStore.getState().libraryImports.get("steam:100")!;
  const count = 120;
  useAppStore.setState({
    libraryImports: new Map(
      Array.from({ length: count + 1 }, (_, index) => [
        `steam:${index + 1}`,
        {
          ...entry,
          gameId: index + 1,
          igdbId: index + 1,
          externalId: String(index + 1),
          name: index === count ? "Unselected game" : `Batch game ${index + 1}`,
        },
      ]),
    ),
  });
  await act(() => root.render(<MyGamesView />));
  const search = container.querySelector<HTMLInputElement>(
    '[placeholder="Search games..."]',
  )!;
  await act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(search, "Batch game");
    search.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(container.querySelectorAll(".game-library-card").length).toBeLessThan(
    count,
  );
  await enterSelection();
  await act(() => button(`Select all ${count} results`).click());
  await act(() => button("Move to PlayCounter").click());
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(
    dialog.querySelectorAll('ul[aria-label="Games to move"] li'),
  ).toHaveLength(count);
  await act(() => button("Move to PlayCounter", dialog).click());
  expect(useAppStore.getState().playcounterLibrary.size).toBe(count);
  expect(
    [...useAppStore.getState().libraryImports.values()].map(
      (entry) => entry.name,
    ),
  ).toEqual(["Unselected game"]);
});

it("retains the entire bulk selection after a save error and allows retrying", async () => {
  importGame("steam");
  importGame("xbox", 2);
  await act(() => root.render(<MyGamesView />));
  await enterSelection();
  await act(() => button("Select all 2 results").click());
  await act(() => button("Move to PlayCounter").click());
  const dialog = document.querySelector('[role="dialog"]')!;
  const fail = vi.spyOn(localStorage, "setItem").mockImplementation(() => {
    throw new Error("Storage unavailable");
  });
  await act(() => button("Move to PlayCounter", dialog).click());
  expect(dialog.querySelector('[role="alert"]')?.textContent).toBe(
    "Storage unavailable",
  );
  expect(useAppStore.getState().libraryImports.size).toBe(2);
  expect(useAppStore.getState().playcounterLibrary.size).toBe(0);
  expect(container.textContent).toContain("2 selected");
  fail.mockRestore();
  await act(() => button("Move to PlayCounter", dialog).click());
  expect(useAppStore.getState().libraryImports.size).toBe(0);
  expect(useAppStore.getState().playcounterLibrary.size).toBe(2);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(
    container.querySelector('[aria-label="Bulk game actions"]'),
  ).toBeNull();
});

it.each([
  ["steam", "grid"],
  ["steam", "large"],
  ["steam", "list"],
  ["xbox", "grid"],
  ["xbox", "large"],
  ["xbox", "list"],
] as const)(
  "moves an import-only %s game to PlayCounter in %s view after confirmation",
  async (provider, layout) => {
    importGame(provider);
    useAppStore.getState().setMyGamesCardSize(layout);
    await act(() => root.render(<MyGamesView />));
    await source(provider);
    await contextMenu();
    await act(() => button("Move to PlayCounter").click());
    let dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain("1h");
    expect(dialog.textContent).toContain("Future sessions add to this total");
    expect(dialog.textContent).toContain("import the game from that launcher");
    await act(() => button("Cancel", dialog).click());
    expect(useAppStore.getState().libraryImports.size).toBe(1);
    await contextMenu();
    await act(() => button("Move to PlayCounter").click());
    dialog = document.querySelector('[role="dialog"]')!;
    await act(() => button("Move to PlayCounter", dialog).click());
    expect(useAppStore.getState().libraryImports.size).toBe(0);
    expect(container.querySelectorAll(".game-library-card")).toHaveLength(0);
    await source("unimported");
    expect(container.querySelectorAll(".game-library-card")).toHaveLength(1);
    expect(
      container.querySelector(".game-library-card")?.textContent,
    ).toContain(NAME);
    expect(
      container.querySelector(".game-library-card")?.textContent,
    ).toContain("1h");
    await contextMenu();
    expect(button("Open Details")).toBeDefined();
    const actions = [...document.querySelectorAll("button")].map((item) =>
      item.textContent?.trim(),
    );
    expect(actions).not.toContain("Move to PlayCounter");
    expect(actions).not.toContain("Open in Steam");
    await act(() => button("Open Details").click());
    dialog = document.querySelector('[role="dialog"]')!;
    const lastPlayed = [...dialog.querySelectorAll("div")].find(
      (element) => element.textContent === "Last played",
    );
    expect(lastPlayed?.nextElementSibling?.textContent).toBe(
      new Date(DATE).toLocaleDateString(),
    );
    expect(useAppStore.getState().recentSessions).toEqual([]);
  },
);

it("offers the same move from game details and merges an explicit re-import into one card", async () => {
  importGame("steam");
  await act(() => root.render(<MyGamesView />));
  await act(() =>
    container
      .querySelector<HTMLButtonElement>(
        `[aria-label="Open details for ${NAME}"]`,
      )!
      .click(),
  );
  await act(() => button("Move to PlayCounter").click());
  await act(() => button("Move to PlayCounter").click());
  expect(container.querySelectorAll(".game-library-card")).toHaveLength(1);
  await act(() => importGame("xbox"));
  await source("xbox");
  expect(container.querySelectorAll(".game-library-card")).toHaveLength(1);
  expect(container.querySelector(".game-library-card")?.textContent).toContain(
    "1h",
  );
  await source("unimported");
  expect(container.querySelectorAll(".game-library-card")).toHaveLength(0);
});

it("keeps archived hours from every former launcher identity in the same card", async () => {
  importGame("steam");
  const imported = useAppStore.getState().libraryImports.get("steam:100")!;
  useAppStore
    .getState()
    .setLibraryImport({ ...imported, provider: "xbox", gameId: 7 });
  useAppStore.setState({
    archivedSeconds: 7200,
    archivedGameSeconds: { "igdb:1": 3600, "igdb:7": 3600 },
  });
  await act(() => root.render(<MyGamesView />));
  expect(container.querySelector(".game-library-card")?.textContent).toContain(
    "2h",
  );
  await contextMenu();
  await act(() => button("Move to PlayCounter").click());
  await act(() => button("Move to PlayCounter").click());
  expect(container.querySelectorAll(".game-library-card")).toHaveLength(1);
  expect(container.querySelector(".game-library-card")?.textContent).toContain(
    "2h",
  );
});

it("keeps the confirmation open with a save error and preserves the launcher association", async () => {
  importGame("steam");
  await act(() => root.render(<MyGamesView />));
  await contextMenu();
  await act(() => button("Move to PlayCounter").click());
  const fail = vi.spyOn(localStorage, "setItem").mockImplementation(() => {
    throw new Error("Storage unavailable");
  });
  await act(() => button("Move to PlayCounter").click());
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    "Storage unavailable",
  );
  expect(useAppStore.getState().libraryImports.size).toBe(1);
  fail.mockRestore();
  await act(() => button("Move to PlayCounter").click());
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(useAppStore.getState().libraryImports.size).toBe(0);
});
