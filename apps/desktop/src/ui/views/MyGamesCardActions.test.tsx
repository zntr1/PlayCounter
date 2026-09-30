// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { commitLibraryImports } from "../../library/commit";
import { buildLibraryImportCommit } from "../../library/importPlan";
import { addGameWithoutFile } from "../../library/manualAdd";
import { useAppStore } from "../../store";
import type { Session } from "@playcounter/shared";
import {
  applyKnownGameMatch,
  changeCustomGameLocally,
  findGameMatches,
  rejectFileForGame,
  removeOwnGameFile,
  reportNegativeMatch,
  submitLocalLinkToCommunity,
  suggestTrackedGameToCommunity,
} from "../../tracker";
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
  // The tracker is mocked: each test starts with a clean call history.
  vi.clearAllMocks();
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

/** A real session of `exeName` as Dragon Age: proof it ran on this PC. */
function ranAs(id: number, exeName: string, extra: Partial<Session> = {}) {
  return {
    id,
    gameId: 1,
    igdbId: 100,
    gameName: DRAGON_AGE.name,
    coverUrl: "",
    source: "igdb" as const,
    exeName,
    startedAt: DATE,
    endedAt: DATE,
    durationSeconds: 600,
    ...extra,
  };
}

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

// The Files tab row, not a session line that names the same file.
function fileRow(exeName: string) {
  const name = [...document.querySelectorAll("span.font-mono")].find(
    (span) => span.textContent === exeName && span.closest(".rounded-lg"),
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

it("badges an IGDB game's file that only the community knows as Community", async () => {
  // The first bug of Add game: THAW.exe is known to the community only.
  useAppStore.getState().setExeCacheEntry({
    ...DATABASE_FILE,
    identifierSource: "community",
  });
  await act(() => root.render(<LibraryTestShell />));

  const legend = card().querySelector('[role="tooltip"]')!.textContent ?? "";
  expect(legend).toContain("Community");
  expect(legend).not.toContain("IGDB has this file name on record");
});

it("searches again for a Custom game the community turned down", async () => {
  useAppStore.getState().setExeCacheEntry({
    ...OWN_FILE,
    communitySuggestionId: 9,
    communitySuggestionStatus: "rejected",
    communitySuggestionNote: "Wrong game",
  });
  await act(() => root.render(<LibraryTestShell />));
  await suggestFromCard(DRAGON_AGE.name);

  expect(menuText()).toContain("Suggest community game");
  expect(menuText()).not.toContain("Suggest to community?");
  expect(submitLocalLinkToCommunity).not.toHaveBeenCalled();
});

it("changes the game of the user's own file to the picked result, sending nothing", async () => {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL) =>
    Response.json({
      candidates: [
        { igdbId: 300, name: "Dragon Age: Origins", coverUrl: "origins.jpg" },
      ],
      hasMore: false,
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  vi.mocked(changeCustomGameLocally).mockReturnValue({
    id: OWN_FILE.gameId,
    igdbId: 300,
    name: "Dragon Age: Origins",
    coverUrl: "origins.jpg",
    source: "custom",
  });
  useAppStore.getState().setExeCacheEntry(OWN_FILE);
  await act(() => root.render(<LibraryTestShell />));
  await openMatchingMenu();
  await act(async () =>
    [...document.querySelectorAll("button")]
      .find((button) => button.textContent?.trim() === "Change Game…")!
      .click(),
  );
  await act(async () => dialogButton("Search")!.click());
  const result = [...document.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("Dragon Age: Origins"),
  );
  expect(result, "missing search result").toBeDefined();
  await act(async () => result!.click());
  await act(async () =>
    document
      .getElementById("community-suggestion-form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );

  expect(changeCustomGameLocally).toHaveBeenCalledWith(
    { kind: "exe", key: "dragonageinquisition.exe" },
    expect.objectContaining({ igdbId: 300, name: "Dragon Age: Origins" }),
  );
  expect(useAppStore.getState().toasts.at(-1)?.title).toBe("Game changed");
  expect(
    fetchMock.mock.calls.some(([url]) =>
      String(url).includes("/api/community/suggestions"),
    ),
  ).toBe(false);
  expect(submitLocalLinkToCommunity).not.toHaveBeenCalled();
});

it("opens the search from Check for Matches without sending anything", async () => {
  vi.mocked(findGameMatches).mockResolvedValue({ games: [] });
  // Before, "Search the database" sent a not yet shared file right away.
  useAppStore.getState().setExeCacheEntry({
    ...OWN_FILE,
    shareState: "unshared",
  });
  await act(() => root.render(<LibraryTestShell />));
  await act(async () =>
    card()
      .querySelector<HTMLButtonElement>(
        `[aria-label="Check matches for ${DRAGON_AGE.name}"]`,
      )!
      .click(),
  );
  const searchDatabase = dialogButton("Search the database");
  expect(searchDatabase, "missing Search the database").toBeDefined();
  await act(async () => searchDatabase!.click());

  expect(menuText()).toContain("Suggest community game");
  expect(submitLocalLinkToCommunity).not.toHaveBeenCalled();
});

/** Another Dragon Age file the server knows, never started on this PC. */
const NEVER_RAN_FILE = { ...DATABASE_FILE, exeName: "DAOrigin.exe" };

function reportFromCard() {
  const report = card().querySelector<HTMLButtonElement>(
    `[aria-label="Report wrong match for ${DRAGON_AGE.name}"]`,
  );
  expect(report, "missing Report wrong match").not.toBeNull();
  return act(async () => report!.click());
}

function fileChoice(exeName: string) {
  return [...document.querySelectorAll("button")].find(
    (button) => button.querySelector("span.font-mono")?.textContent === exeName,
  );
}

function clickButtonWith(text: string) {
  const button = [...document.querySelectorAll("button")].find((item) =>
    item.textContent?.includes(text),
  );
  expect(button, `missing ${text}`).toBeDefined();
  return act(async () => button!.click());
}

it("offers Report and Check for an imported file that never ran here", async () => {
  useAppStore.getState().setExeCacheEntry(DATABASE_FILE);
  // A manual session only borrows the file name: it does not count as a run.
  useAppStore.setState({
    recentSessions: [ranAs(1, DATABASE_FILE.exeName, { origin: "manual" })],
  });
  await act(() => root.render(<LibraryTestShell />));

  expect(
    card().querySelector(
      `[aria-label="Report wrong match for ${DRAGON_AGE.name}"]`,
    ),
  ).not.toBeNull();
  expect(
    card().querySelector(`[aria-label="Check matches for ${DRAGON_AGE.name}"]`),
  ).not.toBeNull();
  await openFilesTab(DRAGON_AGE.name);
  expect(fileRow(DATABASE_FILE.exeName).textContent).toContain(
    "Never ran on this PC",
  );
});

it("asks which file is wrong and reports only that file", async () => {
  vi.mocked(reportNegativeMatch).mockResolvedValue({
    localBlockApplied: true,
    ignoreFileUpdated: true,
    report: "recorded",
  });
  useAppStore.getState().setExeCacheEntry(DATABASE_FILE);
  useAppStore
    .getState()
    .setExeCacheEntry({ ...DATABASE_FILE, exeName: "DAInquisition.exe" });
  useAppStore.getState().setExeCacheEntry(NEVER_RAN_FILE);
  useAppStore.setState({
    recentSessions: [
      ranAs(1, DATABASE_FILE.exeName),
      ranAs(2, "DAInquisition.exe"),
    ],
  });
  await act(() => root.render(<LibraryTestShell />));
  await reportFromCard();

  expect(menuText()).toContain("Which file is wrong?");
  expect(fileChoice("DAInquisition.exe")?.textContent).toContain("Last ran");
  // An imported file can be matched wrong too: shown, and it can be picked.
  expect(fileChoice(NEVER_RAN_FILE.exeName)?.textContent).toContain(
    "Never ran on this PC",
  );
  expect(fileChoice(NEVER_RAN_FILE.exeName)?.disabled).toBe(false);
  await act(async () => fileChoice(NEVER_RAN_FILE.exeName)!.click());
  await clickButtonWith("part of the game");
  await act(async () => dialogButton("Ignore and report")!.click());

  expect(reportNegativeMatch).toHaveBeenCalledOnce();
  expect(reportNegativeMatch).toHaveBeenCalledWith(NEVER_RAN_FILE.exeName, []);
});

it("shows how each file ran in Details and reports the file picked there", async () => {
  useAppStore.getState().setExeCacheEntry(DATABASE_FILE);
  useAppStore.getState().setExeCacheEntry(NEVER_RAN_FILE);
  useAppStore.getState().setExeCacheEntry(OWN_FILE);
  useAppStore.setState({
    recentSessions: [
      ranAs(1, DATABASE_FILE.exeName),
      ranAs(2, OWN_FILE.exeName, { gameId: OWN_FILE.gameId, source: "custom" }),
    ],
  });
  await act(() => root.render(<LibraryTestShell />));
  await openFilesTab(DRAGON_AGE.name);

  const databaseRow = fileRow(DATABASE_FILE.exeName);
  const neverRanRow = fileRow(NEVER_RAN_FILE.exeName);
  const ownRow = fileRow(OWN_FILE.exeName);
  expect(databaseRow.textContent).toContain("Last ran");
  expect(neverRanRow.textContent).toContain("Never ran on this PC");
  expect(rowButton(neverRanRow, "Report")).toBeDefined();
  // The user's own file is changed or removed, not reported.
  expect(rowButton(ownRow, "Report")).toBeUndefined();

  await act(async () => rowButton(databaseRow, "Report")!.click());
  expect(menuText()).not.toContain("Which file is wrong?");
  expect(menuText()).toContain(`${DATABASE_FILE.exeName} · Last ran`);
  expect(menuText()).toContain("It's a different game");
});

it("sends a different game for the reported file, not the user's own file on the card", async () => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
    String(input).includes("/api/community/suggestions")
      ? Response.json({ id: 5, verified: false })
      : Response.json({
          candidates: [
            { igdbId: 300, name: "Dragon Age: Origins", coverUrl: "o.jpg" },
          ],
          hasMore: false,
        }),
  );
  vi.stubGlobal("fetch", fetchMock);
  useAppStore.getState().setExeCacheEntry(DATABASE_FILE);
  useAppStore.getState().setExeCacheEntry(OWN_FILE);
  useAppStore.setState({ recentSessions: [ranAs(1, DATABASE_FILE.exeName)] });
  await act(() => root.render(<LibraryTestShell />));
  await reportFromCard();
  await clickButtonWith("a different game");
  const input = document.querySelector<HTMLInputElement>(
    'input[placeholder="Search by game title or IGDB ID..."]',
  )!;
  await act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, "Dragon Age");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => dialogButton("Search")!.click());
  await clickButtonWith("Dragon Age: Origins");
  await act(async () =>
    document
      .getElementById("community-suggestion-form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );

  const post = fetchMock.mock.calls.find(([url]) =>
    String(url).includes("/api/community/suggestions"),
  ) as unknown as [string, RequestInit] | undefined;
  expect(post, "missing suggestion request").toBeDefined();
  expect(JSON.parse(String(post![1].body)).exeName).toBe(DATABASE_FILE.exeName);
  // This PC records the suggestion on the same file, not on OWN_FILE.
  expect(suggestTrackedGameToCommunity).toHaveBeenCalledWith(
    DATABASE_FILE.exeName,
    "Dragon Age: Origins",
    "o.jpg",
    5,
    false,
    300,
  );
});

it("asks which file to check and checks only that file", async () => {
  vi.mocked(findGameMatches).mockResolvedValue({ games: [] });
  useAppStore.getState().setExeCacheEntry(DATABASE_FILE);
  useAppStore.getState().setExeCacheEntry(OWN_FILE);
  useAppStore.getState().setExeCacheEntry(NEVER_RAN_FILE);
  useAppStore.setState({ recentSessions: [ranAs(1, DATABASE_FILE.exeName)] });
  await act(() => root.render(<LibraryTestShell />));
  await act(async () =>
    card()
      .querySelector<HTMLButtonElement>(
        `[aria-label="Check matches for ${DRAGON_AGE.name}"]`,
      )!
      .click(),
  );

  expect(menuText()).toContain("Which file?");
  expect(fileChoice(NEVER_RAN_FILE.exeName)?.disabled).toBe(false);
  expect(fileChoice(OWN_FILE.exeName)?.disabled).toBe(false);
  expect(findGameMatches).not.toHaveBeenCalled();
  await act(async () => fileChoice(DATABASE_FILE.exeName)!.click());

  expect(findGameMatches).toHaveBeenCalledWith(DATABASE_FILE.exeName);
  expect(findGameMatches).not.toHaveBeenCalledWith(OWN_FILE.exeName);
});

it("lists cs2.exe once, however the import, the server and the session spell it", async () => {
  const CS2 = {
    id: 5,
    igdbId: 500,
    name: "Counter-Strike 2",
    coverUrl: "",
    source: "igdb" as const,
  };
  const importCs2 = (spelling: string) =>
    commitLibraryImports([
      buildLibraryImportCommit({
        provider: "steam",
        now: DATE,
        scanned: {
          externalId: "730",
          playtimeSeconds: 3600,
          lastPlayedUnix: Date.parse(DATE) / 1000,
          installed: true,
          executables: [],
        },
        resolved: {
          key: "steam:730",
          status: "resolved",
          game: CS2,
          executables: [
            {
              platform: "windows",
              kind: "exe",
              value: spelling,
              provenance: "igdb",
              verified: true,
            },
          ],
        },
      })!,
    ]);
  importCs2("CS2.exe");
  importCs2("cs2.exe");
  const imported = [...useAppStore.getState().libraryImports.values()].find(
    (entry) => entry.externalId === "730",
  );
  expect(imported?.linkedExeNames).toEqual(["CS2.exe"]);

  useAppStore.setState({
    recentSessions: [
      ranAs(1, "cs2.exe", {
        gameId: CS2.id,
        igdbId: CS2.igdbId,
        gameName: CS2.name,
      }),
    ],
  });
  await act(() => root.render(<LibraryTestShell />));
  await openFilesTab(CS2.name);

  const rows = [...document.querySelectorAll("span.font-mono")].filter(
    (span) =>
      span.textContent?.toLowerCase() === "cs2.exe" &&
      span.closest(".rounded-lg"),
  );
  expect(rows).toHaveLength(1);
  // The name the file ran as.
  expect(rows[0].textContent).toBe("cs2.exe");
});

it("takes the picked file off the game from the report picker", async () => {
  vi.mocked(rejectFileForGame).mockResolvedValue({ report: "recorded" });
  useAppStore.getState().setExeCacheEntry(DATABASE_FILE);
  useAppStore.getState().setExeCacheEntry(NEVER_RAN_FILE);
  await act(() => root.render(<LibraryTestShell />));
  await reportFromCard();
  await act(async () => fileChoice(NEVER_RAN_FILE.exeName)!.click());

  expect(menuText()).toContain(
    `${NEVER_RAN_FILE.exeName} isn't ${DRAGON_AGE.name}'s game file`,
  );
  await clickButtonWith(`doesn't belong to ${DRAGON_AGE.name}`);
  await act(async () => dialogButton("Remove from game")!.click());

  expect(rejectFileForGame).toHaveBeenCalledOnce();
  expect(rejectFileForGame).toHaveBeenCalledWith(
    NEVER_RAN_FILE.exeName,
    expect.objectContaining({ gameId: 1, source: "igdb", igdbId: 100 }),
  );
  expect(useAppStore.getState().toasts.at(-1)?.title).toBe(
    `${NEVER_RAN_FILE.exeName} removed from ${DRAGON_AGE.name}`,
  );
});

it("no longer lists a file taken off the game; its sessions stay", async () => {
  useAppStore.getState().setExeCacheEntry(DATABASE_FILE);
  useAppStore.setState({
    recentSessions: [ranAs(1, "SupportTool.exe")],
    rejectedGameFiles: [
      {
        exeName: "supporttool.exe",
        gameId: 1,
        source: "igdb",
        igdbId: 100,
        rejectedAt: DATE,
      },
    ],
  });
  await act(() => root.render(<LibraryTestShell />));
  expect(card().textContent).toContain("1 session");
  await openFilesTab(DRAGON_AGE.name);

  const rows = [...document.querySelectorAll("span.font-mono")].filter((span) =>
    span.closest(".rounded-lg"),
  );
  expect(rows.map((span) => span.textContent)).toEqual([DATABASE_FILE.exeName]);
});

it("opens Report wrong match for the checked file from Check for matches", async () => {
  vi.mocked(findGameMatches).mockResolvedValue({ games: [] });
  useAppStore.getState().setExeCacheEntry(DATABASE_FILE);
  await act(() => root.render(<LibraryTestShell />));
  await act(async () =>
    card()
      .querySelector<HTMLButtonElement>(
        `[aria-label="Check matches for ${DRAGON_AGE.name}"]`,
      )!
      .click(),
  );
  expect(menuText()).not.toContain("This is not a game");

  await clickButtonWith("Report wrong match…");

  expect(menuText()).toContain(
    `${DRAGON_AGE.name} is the wrong match for ${DATABASE_FILE.exeName}`,
  );
  expect(reportNegativeMatch).not.toHaveBeenCalled();
});

it("accepts a database match for the user's own file, not the card's IGDB file", async () => {
  // The Custom file a cancelled suggestion left on the IGDB game's card.
  vi.mocked(findGameMatches).mockResolvedValue({
    games: [
      {
        id: DRAGON_AGE.id,
        igdbId: DRAGON_AGE.igdbId,
        name: DRAGON_AGE.name,
        coverUrl: "",
        source: "igdb",
      },
    ],
  });
  useAppStore.getState().setExeCacheEntry(DATABASE_FILE);
  useAppStore.getState().setExeCacheEntry(OWN_FILE);
  await act(() => root.render(<LibraryTestShell />));
  await act(async () =>
    card()
      .querySelector<HTMLButtonElement>(
        `[aria-label="Check matches for ${DRAGON_AGE.name}"]`,
      )!
      .click(),
  );
  await act(async () => fileChoice(OWN_FILE.exeName)!.click());
  expect(findGameMatches).toHaveBeenCalledWith(OWN_FILE.exeName);

  await act(async () => dialogButton("Use this match")!.click());

  expect(applyKnownGameMatch).toHaveBeenCalledOnce();
  expect(applyKnownGameMatch).toHaveBeenCalledWith(
    OWN_FILE.exeName,
    expect.objectContaining({ source: "igdb", id: DRAGON_AGE.id }),
  );
});
