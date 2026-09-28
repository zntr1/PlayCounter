// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { commitLibraryImports } from "../../library/commit";
import { buildLibraryImportCommit } from "../../library/importPlan";
import { addGameWithoutFile } from "../../library/manualAdd";
import { useAppStore } from "../../store";
import { removeOwnGameFile, submitLocalLinkToCommunity } from "../../tracker";
import { LibraryTestShell } from "./libraryTestShell";

vi.mock("../../tracker");
vi.mock("../../platform", () => ({ currentPlatform: () => "windows" }));
vi.mock("../../gameDetails", () => ({
  useGameDetails: () => ({ status: "empty" }),
}));

const DATE = "2026-09-28T12:00:00.000Z";
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
      gameLaunchingEnabled: true,
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

function card() {
  return container.querySelector(".game-library-card")!;
}

function cardButton(label: string) {
  return [...card().querySelectorAll("button")].find(
    (button) => button.textContent?.trim() === label,
  );
}

it("offers Set launch file instead of Not launchable, with the Add game file check", async () => {
  addGameWithoutFile({
    id: 1,
    igdbId: 100,
    name: "Dragon Age: Inquisition",
    coverUrl: "",
    source: "igdb",
  });
  await act(() => root.render(<LibraryTestShell />));

  expect(card().textContent).not.toContain("Not launchable");
  const setFile = cardButton("Set launch file");
  expect(setFile).toBeDefined();
  await act(async () => setFile!.click());

  expect(document.body.textContent).toContain(
    "Pick the .exe that starts Dragon Age: Inquisition. PlayCounter tracks it too.",
  );
  // No search: the card's game is fixed, and a file is required.
  expect(document.querySelector('input[aria-label="Game title"]')).toBeNull();
  const confirm = [...document.querySelectorAll("button")].find(
    (button) =>
      button.textContent?.trim() === "Set launch file" &&
      !card().contains(button),
  );
  expect(confirm?.disabled).toBe(true);
});

it("offers Open in Xbox for an Xbox game without a known .exe", async () => {
  commitLibraryImports([
    buildLibraryImportCommit({
      provider: "xbox",
      now: DATE,
      scanned: {
        externalId: "9XBOX",
        playtimeSeconds: 3600,
        lastPlayedUnix: Date.parse(DATE) / 1000,
        installed: false,
        executables: [],
      },
      resolved: {
        key: "xbox:9XBOX",
        status: "resolved",
        game: {
          id: 2,
          igdbId: 200,
          source: "igdb",
          name: "Forza Horizon 5",
          coverUrl: "",
        },
        executables: [],
      },
    })!,
  ]);
  await act(() => root.render(<LibraryTestShell />));

  expect(cardButton("Open in Xbox")).toBeDefined();
  expect(cardButton("Set launch file")).toBeUndefined();
  expect(card().textContent).not.toContain("Not launchable");
});

async function openMatchingMenu() {
  await act(() =>
    card().dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 10,
        clientY: 10,
      }),
    ),
  );
  const matching = [...document.querySelectorAll("button")].find(
    (button) => button.textContent?.trim() === "Matching",
  );
  expect(matching, "missing Matching").toBeDefined();
  await act(async () => matching!.click());
}

function menuText() {
  return document.body.textContent ?? "";
}

const DRAGON_AGE = {
  id: 1,
  igdbId: 100,
  name: "Dragon Age: Inquisition",
  coverUrl: "",
  source: "igdb" as const,
};

it("offers no Report or Convert for the user's own .exe on a card with the database game", async () => {
  addGameWithoutFile(DRAGON_AGE);
  useAppStore.getState().setExeCacheEntry({
    exeName: "DragonAgeInquisition.exe",
    state: "matched",
    gameId: -7,
    igdbId: 100,
    gameName: DRAGON_AGE.name,
    coverUrl: "",
    source: "custom",
    identifierSource: "custom",
    shareState: "unshared",
    lastCheckedAt: DATE,
  });
  await act(() => root.render(<LibraryTestShell />));

  expect(
    card().querySelector(
      `[aria-label="Report wrong match for ${DRAGON_AGE.name}"]`,
    ),
  ).toBeNull();
  await openMatchingMenu();
  expect(menuText()).toContain("Suggest to Community");
  expect(menuText()).not.toContain("Report Wrong Match");
  expect(menuText()).not.toContain("Convert to Custom Game");
});

it("offers Report and Convert for an .exe the database matched", async () => {
  useAppStore.getState().setExeCacheEntry({
    exeName: "DragonAgeInquisition.exe",
    state: "matched",
    gameId: 1,
    igdbId: 100,
    gameName: DRAGON_AGE.name,
    coverUrl: "",
    source: "igdb",
    lastCheckedAt: DATE,
  });
  await act(() => root.render(<LibraryTestShell />));

  expect(
    card().querySelector(
      `[aria-label="Report wrong match for ${DRAGON_AGE.name}"]`,
    ),
  ).not.toBeNull();
  await openMatchingMenu();
  expect(menuText()).toContain("Report Wrong Match");
  expect(menuText()).toContain("Convert to Custom Game");
  // Nothing of the user's own to change: the database matched this file.
  expect(menuText()).not.toContain("Change Game…");
});

/** The user's own file for Dragon Age, as Discovered or Add game save it. */
const OWN_FILE = {
  exeName: "DragonAgeInquisition.exe",
  state: "matched" as const,
  gameId: -7,
  igdbId: 100,
  gameName: DRAGON_AGE.name,
  coverUrl: "",
  source: "custom" as const,
  identifierSource: "custom" as const,
  lastCheckedAt: DATE,
};

function dialogButton(label: string) {
  return [...document.querySelectorAll("button")].find(
    (button) =>
      button.textContent?.trim() === label && !card().contains(button),
  );
}

async function suggestFromCard(name: string) {
  const send = card().querySelector<HTMLButtonElement>(
    `[aria-label="Suggest ${name} to the community"]`,
  );
  expect(send, "missing Suggest to community").not.toBeNull();
  await act(async () => send!.click());
}

it("suggests a Custom game that already names its game without a search", async () => {
  vi.mocked(submitLocalLinkToCommunity).mockResolvedValue({
    kind: "submitted",
  });
  useAppStore.getState().setExeCacheEntry(OWN_FILE);
  await act(() => root.render(<LibraryTestShell />));
  await suggestFromCard(DRAGON_AGE.name);

  expect(menuText()).toContain("Suggest to community?");
  expect(menuText()).not.toContain("Suggest community game");
  expect(submitLocalLinkToCommunity).not.toHaveBeenCalled();
  await act(async () => dialogButton("Suggest")!.click());
  expect(submitLocalLinkToCommunity).toHaveBeenCalledWith({
    kind: "exe",
    key: "dragonageinquisition.exe",
  });
});

it("still searches for a Custom game that names no database game", async () => {
  useAppStore.getState().setExeCacheEntry({
    ...OWN_FILE,
    igdbId: undefined,
    gameName: "My Mod",
  });
  await act(() => root.render(<LibraryTestShell />));
  await suggestFromCard("My Mod");

  expect(menuText()).toContain("Suggest community game");
  expect(menuText()).not.toContain("Suggest to community?");
});

it("offers Change Game for the user's own file, as a search on this PC only", async () => {
  useAppStore.getState().setExeCacheEntry(OWN_FILE);
  await act(() => root.render(<LibraryTestShell />));
  await openMatchingMenu();
  const change = [...document.querySelectorAll("button")].find(
    (button) => button.textContent?.trim() === "Change Game…",
  );
  expect(change, "missing Change Game").toBeDefined();
  await act(async () => change!.click());

  expect(menuText()).toContain("This PC only");
  expect(dialogButton("Change game")).toBeDefined();
  expect(menuText()).not.toContain("Add and share");
});

it("hides Change Game while a suggestion for the file waits for review", async () => {
  useAppStore.getState().setExeCacheEntry({
    ...OWN_FILE,
    pendingCommunityGame: {
      id: 9,
      igdbId: 100,
      name: DRAGON_AGE.name,
      coverUrl: "",
      source: "community",
    },
    communitySuggestionId: 9,
    communitySuggestionVerified: false,
    communitySuggestionStatus: "pending",
  });
  await act(() => root.render(<LibraryTestShell />));
  await openMatchingMenu();

  expect(menuText()).toContain("Cancel Suggestion");
  expect(menuText()).not.toContain("Change Game…");
});

/** A Dragon Age file the database matched, next to the user's own. */
const DATABASE_FILE = {
  exeName: "DragonAge.exe",
  state: "matched" as const,
  gameId: 1,
  igdbId: 100,
  gameName: DRAGON_AGE.name,
  coverUrl: "",
  source: "igdb" as const,
  lastCheckedAt: DATE,
};

async function openFilesTab(name: string) {
  const details = card().querySelector<HTMLButtonElement>(
    `[aria-label="Open details for ${name}"]`,
  );
  expect(details, "missing details button").not.toBeNull();
  await act(async () => details!.click());
  const files = [
    ...document.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
  ].find((tab) => tab.textContent?.startsWith("Files"));
  expect(files, "missing Files tab").toBeDefined();
  await act(async () => files!.click());
}

function fileRow(exeName: string) {
  const name = [...document.querySelectorAll("span.font-mono")].find(
    (span) => span.textContent === exeName,
  );
  expect(name, `missing ${exeName}`).toBeDefined();
  return name!.closest(".rounded-lg")!;
}

function rowButton(row: Element, label: string) {
  return [...row.querySelectorAll("button")].find(
    (button) => button.textContent?.trim() === label,
  );
}

it("shows who matched each file and offers Remove only for the user's own", async () => {
  vi.mocked(removeOwnGameFile).mockReturnValue(true);
  useAppStore.getState().setExeCacheEntry(DATABASE_FILE);
  useAppStore.getState().setExeCacheEntry(OWN_FILE);
  await act(() => root.render(<LibraryTestShell />));
  await openFilesTab(DRAGON_AGE.name);

  const databaseRow = fileRow("DragonAge.exe");
  const ownRow = fileRow("DragonAgeInquisition.exe");
  expect(databaseRow.textContent).toContain("IGDB");
  expect(ownRow.textContent).toContain("Custom");
  expect(rowButton(databaseRow, "Remove")).toBeUndefined();
  await act(async () => rowButton(ownRow, "Remove")!.click());
  expect(removeOwnGameFile).toHaveBeenCalledWith({
    kind: "exe",
    key: "dragonageinquisition.exe",
  });
});

it("keeps the hours of a removed own file on the game's card", async () => {
  useAppStore.getState().setExeCacheEntry(DATABASE_FILE);
  useAppStore.getState().setExeCacheEntry(OWN_FILE);
  useAppStore.setState({
    recentSessions: [
      {
        id: 1,
        gameId: OWN_FILE.gameId,
        igdbId: 100,
        gameName: DRAGON_AGE.name,
        coverUrl: "",
        source: "custom",
        exeName: OWN_FILE.exeName,
        startedAt: DATE,
        endedAt: DATE,
        durationSeconds: 3600,
      },
    ],
  });
  await act(() => root.render(<LibraryTestShell />));
  expect(container.querySelectorAll(".game-library-card")).toHaveLength(1);
  expect(card().textContent).toContain("1 session");

  await act(async () =>
    useAppStore.getState().removeExeCacheEntry(OWN_FILE.exeName),
  );
  expect(container.querySelectorAll(".game-library-card")).toHaveLength(1);
  expect(card().textContent).toContain("1 session");
});

it("badges a card by who matched each file, the database's and the user's own", async () => {
  // DATABASE_FILE was matched while running: no identifierSource, its
  // source says who matched it. It must not lose its badge to OWN_FILE.
  useAppStore.getState().setExeCacheEntry(DATABASE_FILE);
  useAppStore.getState().setExeCacheEntry(OWN_FILE);
  await act(() => root.render(<LibraryTestShell />));

  const legend = card().querySelector('[role="tooltip"]')!.textContent ?? "";
  expect(legend).toContain("How this file was matched");
  expect(legend).toContain("IGDB");
  expect(legend).toContain("Custom");
});
