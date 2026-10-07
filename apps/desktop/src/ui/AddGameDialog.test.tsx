// @vitest-environment happy-dom
import type { Game } from "@playcounter/shared";
import { open } from "@tauri-apps/plugin-dialog";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
// Known files are platform files: these tests cover Windows on any host.
vi.mock("../platform", () => ({ currentPlatform: () => "windows" }));
import { canSuggestCustomGameToCommunity, useAppStore } from "../store";
import { AddGameDialog } from "./AddGameDialog";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
  convertFileSrc: (value: string) => value,
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

const HADES: Game = {
  id: 1,
  igdbId: 100,
  name: "Hades",
  coverUrl: "hades.jpg",
  source: "igdb",
};
const HADES_II: Game = {
  id: 2,
  igdbId: 200,
  name: "Hades II",
  coverUrl: "hades2.jpg",
  source: "igdb",
};
const HADES_EXE = "D:\\Games\\Hades\\Hades.exe";

let container: HTMLDivElement;
let root: Root;
let sequence = 0;
let fetchMock: ReturnType<typeof vi.fn>;
/** The file the server knows for Hades, if any. */
let knownFile: string | null = null;
const onClose = vi.fn();

function serve(match: Partial<Game> | null | "unknown") {
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/api/games/search")) {
      return Response.json({ games: [HADES, HADES_II] });
    }
    if (url.endsWith("/api/match-processes")) {
      const body = JSON.parse(String(init?.body)) as {
        processes: { key: string }[];
      };
      return Response.json({
        matches: body.processes.map(({ key }) => ({
          key,
          game: match === "unknown" ? null : match,
        })),
      });
    }
    if (url.endsWith("/api/community/suggestions")) {
      return Response.json({ id: 55, verified: false });
    }
    if (url.endsWith("/api/library/reverse-resolve") && knownFile) {
      return Response.json({
        game: HADES,
        executables: [
          {
            platform: "windows",
            kind: "exe",
            value: knownFile,
            provenance: "community",
            verified: true,
          },
        ],
      });
    }
    return Response.json({}, { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  useAppStore.setState(useAppStore.getInitialState(), true);
  useAppStore.setState({
    settings: {
      ...useAppStore.getState().settings,
      apiEndpoint: `https://add-game-${sequence++}.example`,
    },
  });
  onClose.mockReset();
  knownFile = null;
  vi.mocked(open).mockReset();
  serve(null);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function render(libraryIgdbIds: number[] = []) {
  await act(() =>
    root.render(
      createElement(AddGameDialog, {
        libraryIgdbIds: new Set(libraryIgdbIds),
        onClose,
      }),
    ),
  );
}

function button(text: string) {
  return [...document.querySelectorAll("button")].find(
    (item) => item.textContent?.trim() === text,
  );
}

async function click(text: string) {
  const found = button(text);
  expect(found, text).toBeDefined();
  await act(async () => found!.click());
}

async function search(title: string) {
  const input = document.querySelector<HTMLInputElement>(
    'input[aria-label="Game title"]',
  )!;
  await act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, title);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await click("Search");
}

async function pickFile(path: string) {
  vi.mocked(open).mockResolvedValue(path);
  await click("Pick game file…");
}

function text() {
  return document.body.textContent ?? "";
}

/** What was sent for community review. */
function suggestionRequests() {
  return fetchMock.mock.calls
    .filter(([url]) => String(url).endsWith("/api/community/suggestions"))
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)));
}

it("adds the first result without a file and closes", async () => {
  await render();
  await search("Hades");
  expect(
    document.querySelector('[role="option"][aria-selected="true"]')
      ?.textContent,
  ).toContain("Hades");
  await click("Add game");

  expect([...useAppStore.getState().playcounterLibrary.values()]).toEqual([
    expect.objectContaining({ gameId: 1, igdbId: 100, name: "Hades" }),
  ]);
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(useAppStore.getState().toasts.at(-1)?.title).toBe("Hades added");
});

it("links the file the server knows when adding without a file", async () => {
  knownFile = "Hades.exe";
  await render();
  await search("Hades");
  await click("Add game");

  expect(useAppStore.getState().exeCache.get("hades.exe")).toMatchObject({
    state: "matched",
    gameId: 1,
    identifierSource: "community",
  });
  expect(onClose).toHaveBeenCalledTimes(1);
});

it("links a picked file the community knows to the community game", async () => {
  serve({ ...HADES, id: 130, source: "community" });
  await render();
  await search("Hades");
  await pickFile(HADES_EXE);
  await click("Add game");

  expect(useAppStore.getState().exeCache.get("hades.exe")).toMatchObject({
    gameId: 130,
    igdbId: 100,
    source: "community",
  });
  expect(onClose).toHaveBeenCalledTimes(1);
});

it("does not add a game from the library again without a file", async () => {
  await render([100]);
  await search("Hades");
  expect(button("Add game")?.disabled).toBe(true);
  expect(text()).toContain("Hades is already in your library.");
});

it("asks when the server knows the file as another game, and keeps the pick", async () => {
  serve(HADES_II);
  await render();
  await search("Hades");
  await pickFile(HADES_EXE);
  await click("Add game");

  expect(text()).toContain(
    "IGDB knows Hades.exe as Hades II. Which game is it?",
  );
  // Both games side by side, each with where it comes from.
  expect(text()).toContain("Your search");
  expect(text()).toContain("IGDB match for Hades.exe");
  expect(button("Use Hades II")).toBeDefined();
  await click("Keep Hades on this PC only");

  const state = useAppStore.getState();
  const entry = state.exeCache.get("hades.exe");
  // Nobody knows Hades.exe as Hades: a Custom game, not IGDB, that the card
  // can still suggest to the community, and never offers Hades II again.
  expect(entry).toMatchObject({
    state: "matched",
    igdbId: 100,
    source: "custom",
    identifierSource: "custom",
    shareState: "unshared",
    dismissedCommunityUpgradeGameId: 2,
    dismissedCommunityUpgradeSource: "igdb",
  });
  expect(canSuggestCustomGameToCommunity(entry!)).toBe(true);
  expect(state.launchTargets.get("hades.exe")?.path).toBe(HADES_EXE);
  expect(suggestionRequests()).toEqual([]);
  expect(onClose).toHaveBeenCalledTimes(1);
});

it("shares the user's pick when the server knows the file as another game", async () => {
  serve(HADES_II);
  await render();
  await search("Hades");
  await pickFile(HADES_EXE);
  await click("Add game");
  await click("Keep Hades and share");

  expect(suggestionRequests()).toEqual([
    expect.objectContaining({ exeName: "Hades.exe", igdbId: 100 }),
  ]);
  expect(useAppStore.getState().exeCache.get("hades.exe")).toMatchObject({
    source: "custom",
    igdbId: 100,
    communitySuggestionId: 55,
    dismissedCommunityUpgradeGameId: 2,
  });
  expect(onClose).toHaveBeenCalledTimes(1);
});

it("links the server's game with its own source when the user takes it", async () => {
  serve(HADES_II);
  await render();
  await search("Hades");
  await pickFile(HADES_EXE);
  await click("Add game");
  await click("Use Hades II");

  const entry = useAppStore.getState().exeCache.get("hades.exe");
  expect(entry).toMatchObject({ gameId: 2, source: "igdb" });
  expect(entry?.identifierSource).toBeUndefined();
});

it("makes a Game.exe the server does not list for the game a Custom game", async () => {
  serve("unknown");
  await render();
  await search("Hades");
  await pickFile("D:\\Games\\Hades\\Game.exe");
  await click("Add game");

  expect([...useAppStore.getState().scopedExeLinks.values()]).toEqual([
    expect.objectContaining({
      exeName: "Game.exe",
      igdbId: 100,
      source: "custom",
    }),
  ]);
});

it("shows why a file is refused and writes nothing", async () => {
  useAppStore.setState({ ignoredProcesses: new Set(["hades.exe"]) });
  await render();
  await search("Hades");
  await pickFile(HADES_EXE);
  await click("Add game");

  expect(document.querySelector('[role="alert"]')?.textContent).toBe(
    "Hades.exe is on PlayCounter's ignore list, so it cannot be the game file.",
  );
  expect(useAppStore.getState().exeCache.size).toBe(0);
  expect(useAppStore.getState().playcounterLibrary.size).toBe(0);
  expect(onClose).not.toHaveBeenCalled();
});

it("confirms before sharing an unknown file, then shares it", async () => {
  serve("unknown");
  await render();
  await search("Hades");
  await pickFile(HADES_EXE);
  await click("Add game");

  expect(text()).toContain("PlayCounter does not know Hades.exe yet.");
  expect(
    fetchMock.mock.calls.some(([url]) =>
      String(url).endsWith("/api/community/suggestions"),
    ),
  ).toBe(false);
  await click("Add and share");

  expect(useAppStore.getState().exeCache.get("hades.exe")).toMatchObject({
    source: "custom",
    communitySuggestionId: 55,
  });
  expect(useAppStore.getState().toasts.at(-1)?.title).toBe(
    "Hades added and shared",
  );
  expect(onClose).toHaveBeenCalledTimes(1);
});

it("adds an unknown file on this PC only without sending it", async () => {
  serve("unknown");
  await render();
  await search("Hades");
  await pickFile(HADES_EXE);
  await click("Add game");
  await click("Add on this PC only");

  const entry = useAppStore.getState().exeCache.get("hades.exe");
  expect(entry).toMatchObject({
    igdbId: 100,
    source: "custom",
    shareState: "unshared",
  });
  // The card offers "Suggest to Community" for it later.
  expect(canSuggestCustomGameToCommunity(entry!)).toBe(true);
  expect(suggestionRequests()).toEqual([]);
  expect(onClose).toHaveBeenCalledTimes(1);
});

it("keeps the game's known files next to a picked file", async () => {
  knownFile = "Hades.exe";
  serve("unknown");
  await render();
  await search("Hades");
  await pickFile("D:\\Games\\Hades\\HadesMod.exe");
  await click("Add game");
  await click("Add and share");

  const exeCache = useAppStore.getState().exeCache;
  expect(exeCache.get("hadesmod.exe")).toMatchObject({ source: "custom" });
  expect(exeCache.get("hades.exe")).toMatchObject({
    gameId: 1,
    identifierSource: "community",
  });
});

async function renderSetLaunchFile() {
  await act(() =>
    root.render(
      createElement(AddGameDialog, {
        forGame: { ...HADES, source: "igdb" },
        onClose,
      }),
    ),
  );
}

it("sets the launch file of a library game with the same file check", async () => {
  serve("unknown");
  await renderSetLaunchFile();
  expect(document.querySelector('input[aria-label="Game title"]')).toBeNull();
  expect(button("Set launch file")?.disabled).toBe(true);
  await pickFile(HADES_EXE);
  await click("Set launch file");
  await click("Add on this PC only");

  const state = useAppStore.getState();
  expect(state.exeCache.get("hades.exe")).toMatchObject({
    igdbId: 100,
    source: "custom",
  });
  expect(state.launchTargets.get("hades.exe")?.path).toBe(HADES_EXE);
  expect(state.toasts.at(-1)?.title).toBe("Launch file set for Hades");
  expect(onClose).toHaveBeenCalledTimes(1);
});

it("links a launch file the server knows for the library game directly", async () => {
  serve(HADES);
  await renderSetLaunchFile();
  await pickFile(HADES_EXE);
  await click("Set launch file");

  expect(useAppStore.getState().exeCache.get("hades.exe")).toMatchObject({
    gameId: 1,
    source: "igdb",
  });
  expect(suggestionRequests()).toEqual([]);
  expect(onClose).toHaveBeenCalledTimes(1);
});
