// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useAppStore } from "../../store";
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
  shelf = useAppStore
    .getState()
    .savePersonalShelf({ name: "Weekend", pinned: false })!;
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
  vi.unstubAllGlobals();
});

function counts() {
  return Object.fromEntries(
    [...container.querySelectorAll('[role="tab"]')].map((tab) => [
      tab.id.replace("library-tab-", ""),
      Number(tab.lastElementChild?.textContent),
    ]),
  );
}

async function selectShelf(value: string) {
  const select = container.querySelector<HTMLSelectElement>(
    '[aria-label="Library shelf"]',
  )!;
  await act(() => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
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
  await selectShelf("favorites");
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
  expect(container.querySelector('[aria-selected="true"]')?.id).toBe(
    "library-tab-steam",
  );
  expect(panel.textContent).toContain("No games match this shelf");
  expect(panel.textContent).not.toContain("No Steam games imported yet");

  await selectShelf(shelf);
  expect(counts()).toEqual({ all: 2, unimported: 1, steam: 1 });
  await selectShelf("all");
  expect(counts()).toEqual({ all: 4, unimported: 2, steam: 2 });
});

it("counts status and saved filters independently of their selected source, including search", async () => {
  const saved = useAppStore.getState().savePersonalShelf({
    name: "Not planned imports",
    pinned: false,
    filters: { status: "not-planned", source: "steam" },
  })!;
  await act(() => root.render(<MyGamesView />));
  await selectShelf("status:not-planned");
  expect(counts()).toEqual({ all: 2, unimported: 1, steam: 1 });
  await selectShelf(saved);
  expect(container.querySelector('[aria-selected="true"]')?.id).toBe(
    "library-tab-steam",
  );
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
  await selectShelf("favorites");
  expect(counts()).toEqual({ all: 2, unimported: 1, steam: 1, xbox: 1 });
});
