// @vitest-environment happy-dom
import type { GameDetails, Session } from "@playcounter/shared";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
  convertFileSrc: (path: string) => `asset://${path}`,
}));
vi.mock("../../../tracker");
vi.mock("../../../platform", () => ({ currentPlatform: () => "windows" }));
const detailsState = vi.hoisted(() => ({
  value: { status: "empty" } as unknown,
}));
vi.mock("../../../gameDetails", () => ({
  useGameDetails: () => detailsState.value,
}));

import { commitLibraryImports } from "../../../library/commit";
import {
  toScreenshot,
  useScreenshots,
  useScreenshotViewer,
  type ScreenshotFile,
} from "../../../screenshots";
import { useAppStore } from "../../../store";
import { ScreenshotViewer } from "../../ScreenshotViewer";
import { MyGamesView } from "../MyGamesView";

/* Screenshots in the game details (Phil, 2026-11-23, variant C of
   docs/game-details-screenshots-mockups.html): a "Screenshots" tab with the
   player's own pictures first (taken with PlayCounter's screenshot key) and
   IGDB's below, a strip of both on General with "Show all" leading to the
   tab, and one viewer that steps through both. Own pictures are those of
   the game's sessions, plus those in the game's own folder. */

const NAME = "Elden Ring";
const IGDB_ID = 119133;
const IMPORTED_AT = "2026-08-01T12:00:00.000Z";
const igdb = (size: string, id: string) =>
  `https://images.igdb.com/igdb/image/upload/${size}/${id}.jpg`;
const IGDB_SHOTS = ["sc1", "sc2", "sc3"].map((id) => igdb("t_1080p", id));

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
      libraryShowHero: false,
    },
  });
  useScreenshots.setState({ files: [] });
  useScreenshotViewer.setState({ shots: [], index: 0, title: undefined });
  invokeMock.mockResolvedValue(undefined);
  detailsState.value = { status: "empty" };
  importFromSteam();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  invokeMock.mockReset();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function details(fields: Partial<GameDetails> = {}) {
  detailsState.value = {
    status: "ready",
    details: {
      igdbId: IGDB_ID,
      developers: [],
      publishers: [],
      genres: [],
      gameModes: [],
      platforms: [],
      ...fields,
    } satisfies GameDetails,
  };
}

function importFromSteam() {
  commitLibraryImports([
    {
      entry: {
        provider: "steam",
        externalId: "1245620",
        gameId: 1,
        igdbId: IGDB_ID,
        source: "igdb",
        name: NAME,
        coverUrl: "",
        importedAt: IMPORTED_AT,
        lastReadAt: IMPORTED_AT,
        providerSeconds: 0,
        linkedExeNames: [],
        linkedExeSources: [],
      },
      metadata: {
        id: 1,
        igdbId: IGDB_ID,
        name: NAME,
        coverUrl: "",
        source: "igdb",
      },
      exeCacheEntries: [],
      scopedLinks: [],
    },
  ]);
}

// Local times, like the names the screenshot key gives its pictures.
const at = (day: number, hour: number, minute = 0) =>
  new Date(2026, 10, day, hour, minute).getTime();

function session(
  id: number,
  startMs: number,
  hours: number,
  game = { gameId: 1, igdbId: IGDB_ID, gameName: NAME },
): Session {
  return {
    id,
    ...game,
    source: "igdb",
    coverUrl: "",
    exeName: "game.exe", // i18n-exempt: sample game file
    startedAt: new Date(startMs).toISOString(),
    endedAt: new Date(startMs + hours * 3_600_000).toISOString(),
    durationSeconds: hours * 3600,
  };
}

function picture(
  folder: string,
  ms: number,
  caption: string | null = null,
): ScreenshotFile {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  const name = `${folder} ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}-${pad(d.getMinutes())}-00.jpg`;
  return {
    path: `C:\\Pictures\\PlayCounter\\${folder}\\${name}`,
    folder,
    name,
    bytes: 1000,
    modifiedMs: ms,
    previewPath: `C:\\previews\\${name}`,
    caption,
  };
}

/** Two Elden Ring sessions with three pictures, one more picture only in
 *  its folder, and a Hades session with one picture of its own. */
function ownPictures() {
  useAppStore.setState({
    recentSessions: [
      session(1, at(17, 19), 1),
      session(2, at(22, 20), 2),
      session(3, at(21, 18), 1, { gameId: 2, igdbId: 1, gameName: "Hades" }),
    ],
  });
  useScreenshots.setState({
    files: [
      picture(NAME, at(17, 19, 30), "First look at the Erdtree"),
      picture(NAME, at(22, 20, 2)),
      picture(NAME, at(22, 21, 14), "Finally beat Margit"),
      // A session that is no longer kept: only the folder says whose it is.
      picture(NAME, at(1, 12)),
      picture("Hades", at(21, 18, 30)),
    ].map(toScreenshot),
  });
}

async function openDetails() {
  await act(() =>
    root.render(
      <>
        <MyGamesView />
        <ScreenshotViewer />
      </>,
    ),
  );
  await act(() =>
    container
      .querySelector<HTMLButtonElement>(
        `[aria-label="Open details for ${NAME}"]`,
      )!
      .click(),
  );
}

const tabButton = () =>
  document.querySelector<HTMLButtonElement>("#game-details-tab-screenshots");
const panel = () =>
  document.querySelector<HTMLElement>("#game-details-panel-screenshots")!;
async function openTab() {
  await openDetails();
  await act(() => tabButton()!.click());
}
const section = (label: string) =>
  panel().querySelector<HTMLElement>(`section[aria-label="${label}"]`)!;
const images = (scope: ParentNode) =>
  [...scope.querySelectorAll("img")].map((img) => img.getAttribute("src"));
const viewer = () => document.querySelector<HTMLElement>('[role="dialog"][aria-labelledby="screenshot-viewer-title"]');

describe("the Screenshots tab", () => {
  it("sits after How long to beat and counts your pictures and IGDB's", async () => {
    ownPictures();
    details({ screenshotUrls: IGDB_SHOTS });
    await openDetails();

    const tabs = [...document.querySelectorAll('[role="tab"]')].map(
      (tab) => tab.id,
    );
    expect(tabs.indexOf("game-details-tab-screenshots")).toBe(
      tabs.indexOf("game-details-tab-howLongToBeat") + 1,
    );
    // 4 of yours (3 from sessions, 1 from the folder) and 3 from IGDB.
    expect(tabButton()!.textContent).toBe("Screenshots7");
  });

  it("isn't there for a game without any pictures", async () => {
    details({});
    await openDetails();
    expect(tabButton()).toBeNull();
    expect(
      document.querySelector('[aria-label="Screenshots"][data-screenshot-strip]'),
    ).toBeNull();
  });

  it("shows your pictures first, newest first, with their captions, then IGDB's", async () => {
    ownPictures();
    details({ screenshotUrls: IGDB_SHOTS });
    await openTab();

    // Newest first: 22 Nov 21:14 and 20:02, 17 Nov, then 1 Nov from the
    // folder alone, whose session is no longer kept. (happy-dom can't load
    // the previews, so the order shows in the captions and session lines.)
    const items = [...section("Your screenshots").querySelectorAll("li")];
    expect(items).toHaveLength(4);
    expect(items[0].textContent).toContain("Finally beat Margit");
    expect(items[2].textContent).toContain("First look at the Erdtree");
    for (const item of items.slice(0, 3))
      expect(item.textContent).toContain("session of");
    expect(items[3].textContent).not.toContain("session of");
    // Hades' picture stays with Hades.
    expect(panel().textContent).not.toContain("Hades");

    // IGDB's pictures load small here; the viewer loads them full size.
    expect(images(section("From IGDB"))).toEqual(
      ["sc1", "sc2", "sc3"].map((id) => igdb("t_screenshot_med", id)),
    );
  });

  it("says how to get pictures of your own while you have none, and still shows IGDB's", async () => {
    details({ screenshotUrls: IGDB_SHOTS });
    await openTab();
    expect(section("Your screenshots").textContent).toContain(
      "No screenshots of yours yet.",
    );
    expect(images(section("From IGDB"))).toHaveLength(3);
  });
});

describe("the strip on General", () => {
  it("shows yours first, marked as yours, then IGDB's, and Show all opens the tab", async () => {
    ownPictures();
    details({ screenshotUrls: IGDB_SHOTS });
    await openDetails();

    const strip = document.querySelector<HTMLElement>(
      '[data-screenshot-strip]',
    )!;
    const tiles = [...strip.querySelectorAll("li")];
    expect(tiles).toHaveLength(7);
    expect(
      tiles.slice(0, 4).every((tile) => tile.textContent?.includes("Yours")),
    ).toBe(true);
    expect(
      tiles.slice(4).some((tile) => tile.textContent?.includes("Yours")),
    ).toBe(false);

    // "Show all" sits in the strip's header.
    const showAll = [
      ...strip.closest("section")!.querySelectorAll("button"),
    ].find(
      (button) => button.textContent === "Show all 7",
    )!;
    await act(() => showAll.click());
    expect(tabButton()!.getAttribute("aria-selected")).toBe("true");
  });
});

describe("the viewer", () => {
  it("opens at the picture you click and runs through yours and IGDB's in one row", async () => {
    ownPictures();
    details({ screenshotUrls: IGDB_SHOTS });
    await openTab();

    const igdbTiles = section("From IGDB").querySelectorAll("button");
    await act(() => igdbTiles[0].click());

    const { shots, index } = useScreenshotViewer.getState();
    expect(shots).toHaveLength(7);
    expect(index).toBe(4);
    // IGDB's largest rendition in the viewer, at any screen scaling.
    expect(viewer()!.querySelector("img")?.getAttribute("src")).toBe(
      igdb("t_1080p_2x", "sc1"),
    );
  });

  it("gives an IGDB picture no caption or file buttons", async () => {
    ownPictures();
    details({ screenshotUrls: IGDB_SHOTS });
    await openTab();
    await act(() => section("From IGDB").querySelector("button")!.click());

    const box = viewer()!;
    expect(box.textContent).toContain("Screenshot from IGDB");
    for (const label of [
      "Show in folder",
      "Open in your picture app",
      "Move to the Recycle Bin",
    ])
      expect(box.querySelector(`[aria-label="${label}"]`)).toBeNull();
    expect(box.textContent).not.toContain("Add a caption");
  });

  it("keeps the file buttons and the caption on your own pictures", async () => {
    ownPictures();
    details({ screenshotUrls: IGDB_SHOTS });
    await openTab();
    await act(() =>
      section("Your screenshots")
        .querySelector<HTMLButtonElement>("button[data-shot]")!
        .click(),
    );
    const box = viewer()!;
    expect(box.querySelector('[aria-label="Show in folder"]')).not.toBeNull();
    expect(box.textContent).toContain("Finally beat Margit");
  });

  it("has a row of all pictures below; a click on one shows it", async () => {
    ownPictures();
    details({ screenshotUrls: IGDB_SHOTS });
    await openTab();
    await act(() =>
      section("Your screenshots")
        .querySelector<HTMLButtonElement>("button[data-shot]")!
        .click(),
    );
    const film = viewer()!.querySelector<HTMLElement>(
      '[aria-label="All screenshots"]',
    )!;
    const thumbs = film.querySelectorAll("button");
    expect(thumbs).toHaveLength(7);
    await act(() => thumbs[5].click());
    expect(useScreenshotViewer.getState().index).toBe(5);
    expect(viewer()!.querySelector("img")?.getAttribute("src")).toBe(
      igdb("t_1080p_2x", "sc2"),
    );
  });
});

/* Phil, 2026-11-24: a click into the dark space around the picture closes
   the viewer; the game details behind it stay open. */
describe("closing the viewer", () => {
  it("closes on a click beside the picture, not on the picture, and keeps the details open", async () => {
    ownPictures();
    details({ screenshotUrls: IGDB_SHOTS });
    await openTab();
    await act(() => section("From IGDB").querySelector("button")!.click());

    const mouseDown = (target: Element) =>
      act(() => {
        target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      });
    await mouseDown(viewer()!.querySelector("img")!);
    expect(viewer()).not.toBeNull();

    await mouseDown(viewer()!);
    expect(viewer()).toBeNull();
    expect(tabButton()).not.toBeNull();
  });
});

/* Phil, 2026-11-24 (variant A of docs/image-loading-mockups.html): a picture
   that is still loading shimmers in its place, then fades in, like covers. */
describe("pictures that are still loading", () => {
  it("shimmer in the strip and the tab until they have loaded", async () => {
    ownPictures();
    details({ screenshotUrls: IGDB_SHOTS });
    await openDetails();
    // IGDB's three: happy-dom fails your previews' asset:// files at once.
    const stripImages = document.querySelectorAll<HTMLImageElement>(
      '[data-screenshot-strip] img[src^="https://"]',
    );
    expect(stripImages).toHaveLength(3);
    for (const img of stripImages)
      expect(img.hasAttribute("data-img-loading")).toBe(true);

    await act(async () => {
      stripImages[0].dispatchEvent(new Event("load"));
    });
    expect(stripImages[0].hasAttribute("data-img-loading")).toBe(false);
    expect(stripImages[0].hasAttribute("data-img-fade-in")).toBe(true);
  });

  it("shimmer in the viewer, in a box of their own, and again for the next picture", async () => {
    ownPictures();
    details({ screenshotUrls: IGDB_SHOTS });
    await openTab();
    await act(() => section("From IGDB").querySelector("button")!.click());

    const first = viewer()!.querySelector("img")!;
    expect(first.hasAttribute("data-img-loading")).toBe(true);
    // No size of its own yet: it holds a 16:9 box.
    expect(first.className).toContain("data-[img-loading]:aspect-video");
    await act(async () => {
      first.dispatchEvent(new Event("load"));
    });
    expect(first.hasAttribute("data-img-loading")).toBe(false);

    await act(() => useScreenshotViewer.setState({ index: 5 }));
    expect(
      viewer()!.querySelector("img")!.hasAttribute("data-img-loading"),
    ).toBe(true);
  });
});
