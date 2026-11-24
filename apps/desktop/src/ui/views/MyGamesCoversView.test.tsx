// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { validateBackupData } from "../../backupValidation";
import { commitLibraryImports } from "../../library/commit";
import { buildLibraryImportCommit } from "../../library/importPlan";
import { STORAGE_KEY } from "../../persistence";
import { useAppStore, type ActiveSession } from "../../store";
import { resolveMyGamesPresentation } from "../myGamesPresentation";
import { LibraryTestShell } from "./libraryTestShell";

/* The Covers view (Phil, 2026-11-22): only the cover; name, playtime, Play
   and ⋯ on hover; a running game and anything to do stay visible. A click on
   a cover opens its Details (Phil, 2026-11-24: the banner selection it had
   at first brought nothing, and further down nobody saw it). */

vi.mock("../../tracker");
vi.mock("../../platform", () => ({ currentPlatform: () => "windows" }));
vi.mock("../../gameDetails", () => ({
  useGameDetails: () => ({ status: "empty" }),
}));

const DATE = "2026-11-20T12:00:00.000Z";
// Added long ago, so none of them sits in the New games row as well.
const ADDED = "2025-06-01T12:00:00.000Z";
let root: Root;
let container: HTMLDivElement;

const game = (gameId: number, gameName: string) => ({
  exeName: `${gameName}.exe`,
  state: "matched" as const,
  gameId,
  gameName,
  coverUrl: "",
  source: "custom" as const,
  identifierSource: "custom" as const,
  lastCheckedAt: DATE,
  addedAt: ADDED,
});
const HADES = game(-1, "Hades");
const CELESTE = game(-2, "Celeste");

beforeEach(() => {
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
      libraryCardSize: "covers",
    },
    manualLaunchTargets: new Map(
      [HADES, CELESTE].map((entry) => [
        `${entry.gameId}:custom`,
        {
          exeName: entry.exeName,
          path: `C:/Games/${entry.exeName}`,
          owner: { gameId: entry.gameId, source: "custom" as const },
        },
      ]),
    ),
  });
  useAppStore.getState().setExeCacheEntry(HADES);
  useAppStore.getState().setExeCacheEntry(CELESTE);
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

function card(name: string) {
  const found = [...container.querySelectorAll(".game-library-card")].find(
    (item) => item.textContent?.includes(name),
  );
  expect(found, `no card for ${name}`).toBeDefined();
  return found!;
}

const labelled = (scope: ParentNode, label: string) =>
  scope.querySelector<HTMLElement>(`[aria-label="${label}"]`);

const bannerTitle = () =>
  container.querySelector('[data-banner-variant="full"] h2')?.textContent;

function running(): ActiveSession {
  return {
    id: 7,
    gameId: HADES.gameId,
    gameName: HADES.gameName,
    exeName: HADES.exeName,
    coverUrl: "",
    source: "custom",
    startedAt: DATE,
    checkpointedAt: DATE,
  };
}

it("switches My Games to Covers from the view buttons and remembers it", async () => {
  useAppStore.getState().setMyGamesCardSize("grid");
  await render();
  const covers = labelled(container, "Covers view")!;
  expect(covers.getAttribute("aria-pressed")).toBe("false");
  await act(async () => covers.click());
  expect(useAppStore.getState().settings.libraryCardSize).toBe("covers");
  expect(labelled(container, "Covers view")!.getAttribute("aria-pressed")).toBe(
    "true",
  );
});

it("keeps Covers through a restart and a backup", () => {
  expect(
    resolveMyGamesPresentation({ libraryCardSize: "covers" }).cardSize,
  ).toBe("covers");
  expect(() =>
    validateBackupData({ settings: { libraryCardSize: "covers" } }, "data"),
  ).not.toThrow();
});

it("shows only the cover: no badges, seal, source mark or hover column", async () => {
  useAppStore
    .getState()
    .updateGameJournal(
      { gameId: HADES.gameId, source: "custom", gameName: "Hades" },
      { favorite: true, status: "playing" },
    );
  await render();
  const hades = card("Hades");
  expect(hades.querySelector('[aria-label="Favorite"]')).toBeNull();
  expect(hades.querySelector('[aria-label^="Status: "]')).toBeNull();
  expect(hades.textContent).not.toContain("How this file was matched");
  expect(labelled(hades, "Open journal for Hades")).toBeNull();
  expect(labelled(hades, "Log a missed session for Hades")).toBeNull();
});

it("has the name, playtime, Play and ⋯ on the cover for hover", async () => {
  await render();
  const hades = card("Hades");
  expect(hades.querySelector("h2")?.textContent).toBe("Hades");
  expect(hades.textContent).toContain("0 sessions");
  expect(labelled(hades, "Play Hades")).not.toBeNull();
  await act(async () => labelled(hades, "More actions for Hades")!.click());
  expect(document.querySelector('[role="menu"]')).not.toBeNull();
});

it("opens Details on a click, and leaves the banner as it was", async () => {
  await render();
  const before = bannerTitle();
  const other = before === "Hades" ? "Celeste" : "Hades";

  await act(async () =>
    labelled(card(other), `Open details for ${other}`)!.click(),
  );

  expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
    other,
  );
  expect(bannerTitle()).toBe(before);
  expect(container.textContent).not.toContain("Selected");
});

it("opens Details from a click when the banner is off", async () => {
  useAppStore.setState((state) => ({
    settings: { ...state.settings, libraryShowHero: false },
  }));
  await render();
  expect(bannerTitle()).toBeUndefined();

  await act(async () =>
    labelled(card("Celeste"), "Open details for Celeste")!.click(),
  );

  const dialog = document.querySelector('[role="dialog"]');
  expect(dialog?.textContent).toContain("Celeste");
});

it("shows a running game without hover, with Stop on the cover", async () => {
  useAppStore.setState({ activeSessions: [running()] });
  await render();
  const hades = card("Hades");
  expect(hades.querySelector("[data-cover-running]")?.textContent).toBe(
    "Running",
  );
  expect(labelled(hades, "Stop Hades")?.textContent).toContain("Stop");
  expect(card("Celeste").querySelector("[data-cover-running]")).toBeNull();
});

it("marks a game with something to do, and says what on hover", async () => {
  // A Steam import with no known .exe: new sessions won't be tracked.
  const commit = buildLibraryImportCommit({
    provider: "steam",
    now: ADDED,
    scanned: {
      externalId: "620",
      playtimeSeconds: 0,
      installed: false,
      executables: [],
    },
    resolved: {
      key: "steam:620",
      status: "resolved",
      game: {
        id: 72,
        igdbId: 72,
        name: "Portal 2",
        coverUrl: "",
        source: "igdb",
      },
      executables: [],
    },
  });
  commitLibraryImports([commit!]);
  await render();

  const portal = card("Portal 2");
  const dot = portal.querySelector('[data-cover-attention][role="img"]');
  expect(dot?.getAttribute("title")).toBe("New sessions won't be tracked yet");
  expect(portal.textContent).toContain("New sessions won't be tracked yet");
  expect(card("Hades").querySelector("[data-cover-attention]")).toBeNull();

  // Turning tracking warnings off in Customize hides the dot too.
  useAppStore.getState().setMyGamesShowTrackingWarnings(false);
  await render();
  expect(card("Portal 2").querySelector("[data-cover-attention]")).toBeNull();
});

it("says in Customize that card details don't apply to Covers", async () => {
  await render();
  await act(async () => labelled(container, "Customize library view")!.click());
  expect(document.body.textContent).toContain(
    "The Covers view shows only the cover, so these apply to Standard and Large cards.",
  );
  for (const id of [
    "show-origin",
    "show-match",
    "show-status",
    "show-notes",
    "show-tiers",
  ])
    expect(
      document.querySelector<HTMLInputElement>(`#library-${id}`)?.disabled,
      id,
    ).toBe(true);
  expect(
    document.querySelector<HTMLInputElement>("#library-show-tracking-warnings")
      ?.disabled,
  ).toBe(false);

  await act(async () => useAppStore.getState().setMyGamesCardSize("grid"));
  expect(document.body.textContent).not.toContain(
    "The Covers view shows only the cover",
  );
  expect(
    document.querySelector<HTMLInputElement>("#library-show-status")?.disabled,
  ).toBe(false);
});

/* The polish (Phil, 2026-11-22, docs/cover-view-polish-mockups.html): 4
   covers per row with a lot of room, covers at least Sharp, a glow in the
   cover's own colors behind the cover under the pointer (two glow images for
   the whole grid, however many games), and Spotlight as a switch in
   Customize, off until turned on. Depth, the calm hover edge, no zoom and
   the hover text growing with the tile are styles only: checked in the app. */

const igdbCover = (size: string, id: string) =>
  `https://images.igdb.com/igdb/image/upload/${size}/${id}.jpg`;

/** Hades and Celeste with IGDB covers; Tunic has none. */
function withCovers() {
  const store = useAppStore.getState();
  store.setExeCacheEntry({
    ...HADES,
    coverUrl: igdbCover("t_cover_big", "hades"),
  });
  store.setExeCacheEntry({
    ...CELESTE,
    coverUrl: igdbCover("t_cover_big", "celeste"),
  });
  store.setExeCacheEntry(game(-3, "Tunic"));
}

const coverImage = (name: string) =>
  card(name).querySelector<HTMLImageElement>(".game-card-cover-image")!;
const openCustomize = () =>
  act(async () => labelled(container, "Customize library view")!.click());
const glows = () => [
  ...container.querySelectorAll<HTMLImageElement>("[data-cover-glow]"),
];
const litGlows = () =>
  glows()
    .filter((glow) => glow.hasAttribute("data-on"))
    .map((glow) => glow.getAttribute("src"));
// The pointer enters a cover: it lands on the cover's full-size button.
const pointAt = (name: string) =>
  act(async () => {
    labelled(card(name), `Open details for ${name}`)!.dispatchEvent(
      new MouseEvent("pointerover", { bubbles: true }),
    );
  });

it("shows 4 covers per row unless you pick another count", async () => {
  await render();
  await openCustomize();
  expect(
    document.querySelector<HTMLInputElement>("#library-grid-columns")!.value,
  ).toBe("4");
});

it("loads the covers at least Sharp, even with Cover quality on Standard", async () => {
  withCovers();
  useAppStore.getState().setCoverQuality("standard");
  await render();
  expect(coverImage("Hades").getAttribute("src")).toBe(
    igdbCover("t_cover_big_2x", "hades"),
  );

  // Standard cards keep the quality the player picked.
  await act(async () => useAppStore.getState().setMyGamesCardSize("grid"));
  expect(coverImage("Hades").getAttribute("src")).toBe(
    igdbCover("t_cover_big", "hades"),
  );
});

// Phil, 2026-11-24: arrow keys and a controller get the same as the mouse.
// Both mark the card (data-controller-selected) and focus it, as the
// controller bridge's focusItem does.
async function selectWithKeys(name: string) {
  for (const item of container.querySelectorAll("[data-controller-selected]"))
    item.removeAttribute("data-controller-selected");
  const target = card(name) as HTMLElement;
  target.setAttribute("data-controller-selected", "true");
  await act(async () => target.focus());
}

it("glows behind the cover picked with the arrow keys or a controller, and stops when the pick leaves the grid", async () => {
  withCovers();
  await render();
  await selectWithKeys("Hades");
  expect(litGlows()).toEqual([coverImage("Hades").getAttribute("src")]);

  await selectWithKeys("Celeste");
  expect(litGlows()).toEqual([coverImage("Celeste").getAttribute("src")]);

  // Escape or Tab out of the grid.
  await act(async () => (card("Celeste") as HTMLElement).blur());
  expect(litGlows()).toEqual([]);
});

it("glows in the colors of the cover under the pointer, and stops when the pointer leaves", async () => {
  withCovers();
  await render();
  // Two glow images for three games: they take turns, never one per game.
  expect(glows()).toHaveLength(2);
  expect(litGlows()).toEqual([]);

  await pointAt("Hades");
  expect(litGlows()).toEqual([coverImage("Hades").getAttribute("src")]);

  await pointAt("Celeste");
  expect(litGlows()).toEqual([coverImage("Celeste").getAttribute("src")]);

  // No cover, nothing to glow.
  await pointAt("Tunic");
  expect(litGlows()).toEqual([]);

  await pointAt("Hades");
  const grid = card("Hades").parentElement!;
  await act(async () => {
    grid.dispatchEvent(
      new MouseEvent("pointerout", {
        bubbles: true,
        relatedTarget: document.body,
      }),
    );
  });
  expect(litGlows()).toEqual([]);

  // Standard cards have no glow.
  await act(async () => useAppStore.getState().setMyGamesCardSize("grid"));
  expect(glows()).toHaveLength(0);
});

it("has Spotlight in Customize for the Covers view, off until you turn it on", async () => {
  await render();
  await openCustomize();
  const spotlight = () =>
    document.querySelector<HTMLInputElement>("#library-cover-spotlight");
  const spotlightOn = () =>
    card("Hades").parentElement!.hasAttribute("data-cover-spotlight");
  expect(spotlight()!.checked).toBe(false);
  expect(spotlightOn()).toBe(false);

  await act(async () => spotlight()!.click());

  expect(spotlight()!.checked).toBe(true);
  expect(spotlightOn()).toBe(true);
  expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).settings).toMatchObject(
    { libraryCoverSpotlight: true },
  );

  // Only the Covers view has it.
  await act(async () => useAppStore.getState().setMyGamesCardSize("grid"));
  expect(spotlight()).toBeNull();
});

it("keeps Spotlight in a backup", () => {
  expect(() =>
    validateBackupData({ settings: { libraryCoverSpotlight: true } }, "data"),
  ).not.toThrow();
  expect(() =>
    validateBackupData({ settings: { libraryCoverSpotlight: "on" } }, "data"),
  ).toThrow();
});

/* The space between covers (Phil, 2026-11-24): a slider in Customize for the
   Covers view, 8 to 128 px, at 44 (the polish's room to breathe) until the
   player moves it. Rows get a little more than columns. */
const gapSlider = () =>
  document.querySelector<HTMLInputElement>("#library-cover-gap");
const coverGrid = () => card("Hades").parentElement!;

async function setGap(value: number) {
  const slider = gapSlider()!;
  await act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(slider, String(value));
    slider.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it("has a slider for the space between covers in Customize, at 44 until you move it", async () => {
  await render();
  await openCustomize();
  const slider = gapSlider()!;
  expect([slider.min, slider.max, slider.value]).toEqual(["8", "128", "44"]);
  expect(coverGrid().style.columnGap).toBe("44px");
  expect(coverGrid().style.rowGap).toBe("56px");

  await setGap(12);

  expect(gapSlider()!.value).toBe("12");
  expect(coverGrid().style.columnGap).toBe("12px");
  expect(coverGrid().style.rowGap).toBe("15px");
  expect(
    JSON.parse(localStorage.getItem(STORAGE_KEY)!).settings,
  ).toMatchObject({ libraryCoverGap: 12 });

  // Only the Covers view has it, and only there are the gaps set.
  await act(async () => useAppStore.getState().setMyGamesCardSize("grid"));
  expect(gapSlider()).toBeNull();
  expect(coverGrid().style.columnGap).toBe("");
});

it("keeps the space between covers in a backup", () => {
  expect(() =>
    validateBackupData({ settings: { libraryCoverGap: 24 } }, "data"),
  ).not.toThrow();
  for (const junk of [4, 132, "wide", 12.5])
    expect(() =>
      validateBackupData({ settings: { libraryCoverGap: junk } }, "data"),
    ).toThrow();
});
