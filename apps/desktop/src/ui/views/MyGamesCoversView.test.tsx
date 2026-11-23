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
   and ⋯ on hover; a running game and anything to do stay visible; a click
   puts the game in the banner until you leave My Games, without scrolling;
   with the banner off, a click opens Details. */

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

it("puts a clicked cover in the banner without pinning it", async () => {
  await render();
  const before = bannerTitle();
  const other = before === "Hades" ? "Celeste" : "Hades";
  const cover = labelled(card(other), `Show ${other} in the banner`)!;

  await act(async () => cover.click());

  expect(bannerTitle()).toBe(other);
  expect(useAppStore.getState().settings.libraryFeaturedGame ?? null).toBe(
    null,
  );
});

// Phil, 2026-11-23: the second click on the game already in the banner opens
// its Details.
it("opens Details when you click the cover that is already in the banner", async () => {
  await render();
  const other = bannerTitle() === "Hades" ? "Celeste" : "Hades";
  await act(async () =>
    labelled(card(other), `Show ${other} in the banner`)!.click(),
  );
  expect(document.querySelector('[role="dialog"]')).toBeNull();

  // The same cover now says what a click does.
  expect(labelled(card(other), `Show ${other} in the banner`)).toBeNull();
  await act(async () =>
    labelled(card(other), `Open details for ${other}`)!.click(),
  );

  expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
    other,
  );
  expect(bannerTitle()).toBe(other);
});

it("gives the banner back once you leave My Games", async () => {
  await render();
  const before = bannerTitle();
  const other = before === "Hades" ? "Celeste" : "Hades";
  await act(async () =>
    labelled(card(other), `Show ${other} in the banner`)!.click(),
  );
  expect(bannerTitle()).toBe(other);

  await act(async () => useAppStore.getState().setActiveView("now"));
  await act(async () => useAppStore.getState().setActiveView("games"));

  expect(bannerTitle()).toBe(before);
});

it("opens Details from a click when the banner is off", async () => {
  useAppStore.setState((state) => ({
    settings: { ...state.settings, libraryShowHero: false },
  }));
  await render();
  expect(bannerTitle()).toBeUndefined();
  expect(labelled(card("Celeste"), "Show Celeste in the banner")).toBeNull();

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
    labelled(card(name), `Show ${name} in the banner`)!.dispatchEvent(
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
  expect(
    JSON.parse(localStorage.getItem(STORAGE_KEY)!).settings,
  ).toMatchObject({ libraryCoverSpotlight: true });

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
