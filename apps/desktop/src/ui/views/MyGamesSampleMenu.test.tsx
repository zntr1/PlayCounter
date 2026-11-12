// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useAppStore } from "../../store";
import {
  addManualSession,
  setGamePlaytime,
  startGameTimer,
} from "../../tracker";
import { LibraryTourPractice } from "../tour/LibraryTourPractice";
import { TOUR_EVENT } from "../tour/tourEvents";
import { LibraryTestShell } from "./libraryTestShell";

vi.mock("../../tracker");
vi.mock("../../platform", () => ({ currentPlatform: () => "windows" }));
vi.mock("../../gameDetails", () => ({
  useGameDetails: () => ({ status: "empty" }),
}));

/* The sample card of the guides is a real card: its right-click menu shows
   what a real card's menu shows (docs/tours-plan.md, rule 4). */

const DATE = "2026-09-28T12:00:00.000Z";
const WOW_PATH = "C:\\Games\\World of Warcraft\\_retail_\\Wow.exe";

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => {});
  localStorage.clear();
  useAppStore.setState(useAppStore.getInitialState(), true);
  useAppStore.setState({
    activeView: "games",
    settings: {
      ...useAppStore.getState().settings,
      gameLaunchingEnabled: true,
      libraryShowNewRow: false,
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

/** A real World of Warcraft as the sample pretends to be one: found by its
 *  game file, matched by the community, started once from PlayCounter. */
function addRealWorldOfWarcraft() {
  useAppStore.getState().setExeCacheEntry({
    exeName: "Wow.exe",
    state: "matched",
    gameId: 77,
    gameName: "World of Warcraft",
    coverUrl: "",
    source: "community",
    lastCheckedAt: DATE,
  });
  useAppStore.setState({
    recentSessions: [
      {
        id: 1,
        gameId: 77,
        gameName: "World of Warcraft",
        coverUrl: "",
        source: "community",
        exeName: "Wow.exe",
        startedAt: DATE,
        endedAt: DATE,
        durationSeconds: 3600,
      },
    ],
    launchTargets: new Map([
      [
        "wow.exe",
        {
          exeName: "Wow.exe",
          path: WOW_PATH,
          owner: { gameId: 77, source: "community" as const },
        },
      ],
    ]),
  });
}

const sampleCard = () =>
  document.querySelector<HTMLElement>(
    '[data-tour="demo-game-card"][data-tour-game-id="-1"]',
  )!;

async function rightClick(card: Element) {
  await act(async () =>
    card.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 10,
        clientY: 10,
      }),
    ),
  );
}

type Entry = { label: string; name: string | null };

/** Every entry of the open card menu, flyouts included: "Playtime" and
 *  "Playtime › Start timer". */
async function readMenu(): Promise<Entry[]> {
  const menu = document.querySelector('[role="menu"]');
  expect(menu, "no menu opened").not.toBeNull();
  const entries: Entry[] = [];
  const read = (item: Element) => ({
    label: item.textContent?.trim() ?? "",
    name: item.getAttribute("data-tour"),
  });
  for (const item of [...menu!.children].filter((child) =>
    child.matches("[data-context-menu-item]"),
  )) {
    const entry = read(item);
    entries.push(entry);
    if (item.getAttribute("aria-haspopup") !== "menu") continue;
    await act(async () => (item as HTMLElement).click());
    const flyout = document.getElementById(`${item.id}-menu`);
    expect(flyout, `${entry.label} has no flyout`).not.toBeNull();
    for (const inner of flyout!.querySelectorAll("[data-context-menu-item]")) {
      const innerEntry = read(inner);
      entries.push({
        ...innerEntry,
        label: `${entry.label} › ${innerEntry.label}`,
      });
    }
  }
  await act(async () =>
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })),
  );
  return entries;
}

async function realMenu() {
  addRealWorldOfWarcraft();
  await act(() => root.render(<LibraryTestShell />));
  await rightClick(container.querySelector(".game-library-card")!);
  const entries = await readMenu();
  await act(() => root.render(null));
  return entries;
}

async function guideSampleMenu() {
  await act(() => {
    useAppStore.getState().startTour("game-actions");
    root.render(<LibraryTestShell />);
  });
  await rightClick(sampleCard());
  const entries = await readMenu();
  await act(() => {
    useAppStore.getState().endTour("dismissed");
    root.render(null);
  });
  return entries;
}

async function practiceSampleMenu() {
  await act(() =>
    root.render(
      <LibraryTourPractice tourId="organize-library" stepId="intro" />,
    ),
  );
  await rightClick(sampleCard());
  const entries = await readMenu();
  await act(() => root.render(null));
  return entries;
}

/* What a sample's menu may differ in from the real card's. Keep it short:
   every line is something the guides cannot show. */

// On a real card only for a game from a launcher that reports achievements;
// the sample always has it, because its Details carries sample achievements.
const ONLY_ON_SAMPLES = ["Achievements"];

// Nothing so far: every entry that cannot work on a sample is still shown and
// answers with a sample result.
const NOT_ON_SAMPLES: string[] = [];

const labels = (entries: Entry[]) => entries.map((entry) => entry.label);

it("shows on both sample cards what a real card's menu shows, in the same order", async () => {
  const real = labels(await realMenu());
  // The fixture is a card with everything: a missing entry here would make
  // the comparison below worthless.
  expect(real).toEqual([
    "Play",
    "Open Details",
    "Show History",
    "Pin to banner",
    "Add to Favorites",
    "Journal",
    "Status",
    "Status › In progress",
    "Status › On hold",
    "Status › Finished",
    "Status › Want to play",
    "Status › Want to replay",
    "Status › Not planned",
    "Tier",
    "Tier › S – Best",
    "Tier › A",
    "Tier › B",
    "Tier › C",
    "Tier › D",
    "Tier › F – Worst",
    "Shelves",
    "Shelves › New shelf",
    "Launch options",
    "Launch options › Play",
    "Launch options › Change launch file…",
    "Launch options › Open in Explorer",
    "Launch options › Forget launch file",
    "Playtime",
    "Playtime › Log missed session",
    "Playtime › Adjust total playtime",
    "Playtime › Start timer",
    "Appearance",
    "Appearance › Choose banner…",
    "Appearance › Upload banner",
    "Appearance › Paste banner",
    "Appearance › Choose cover…",
    "Appearance › Upload cover",
    "Appearance › Paste Cover",
    "Matching",
    "Matching › Check for Matches",
    "Matching › Report Wrong Match",
    "Matching › Convert to Custom Game",
    "Ignore Game",
    "Remove from Library",
  ]);
  const expected = real.filter((label) => !NOT_ON_SAMPLES.includes(label));
  const onSample = (entries: Entry[]) =>
    labels(entries).filter((label) => !ONLY_ON_SAMPLES.includes(label));

  expect(onSample(await guideSampleMenu()), "sample in My Games").toEqual(
    expected,
  );
  expect(onSample(await practiceSampleMenu()), "practice library").toEqual(
    expected,
  );
});

it("gives every sample menu entry of the card a name a guide can ring", async () => {
  // The picks inside Status and Tier are named after what is picked
  // (demo-status-…, demo-tier-…); every shelf in Shelves is demo-menu-shelf;
  // everything else demo-menu-….
  const pick = /^(Status|Tier|Shelves) › /;
  for (const entries of [await guideSampleMenu(), await practiceSampleMenu()]) {
    const unnamed = entries
      .filter(
        (entry) =>
          !entry.name?.startsWith(
            pick.test(entry.label) && entry.label !== "Shelves › New shelf"
              ? "demo-"
              : "demo-menu-",
          ),
      )
      .map((entry) => entry.label);
    expect(unnamed).toEqual([]);
    // The shelves share one name on purpose; every other name is unique.
    const names = entries.flatMap((entry) =>
      entry.name && entry.name !== "demo-menu-shelf" ? entry.name : [],
    );
    expect(new Set(names).size, "a name twice").toBe(names.length);
  }
});

it("names no entry on a real card", async () => {
  expect((await realMenu()).filter((entry) => entry.name)).toEqual([]);
});

/** Opens the sample's menu in a running guide and clicks one entry, its
 *  flyout first when it sits in one. */
async function sampleAction(name: string, flyout?: string) {
  await rightClick(sampleCard());
  if (flyout)
    await act(async () =>
      document.querySelector<HTMLElement>(`[data-tour="${flyout}"]`)!.click(),
    );
  const item = document.querySelector<HTMLElement>(`[data-tour="${name}"]`);
  expect(item, `missing ${name}`).not.toBeNull();
  await act(async () => item!.click());
}

const result = () =>
  document.querySelector('[data-tour="demo-action-result"]')?.textContent ?? "";

async function startGuide(tourId = "game-actions") {
  await act(() => {
    useAppStore.getState().startTour(tourId);
    root.render(<LibraryTestShell />);
  });
}

it("answers an entry that cannot work on a sample with a sample result", async () => {
  await startGuide();
  const settings = useAppStore.getState().settings;

  await sampleAction("demo-menu-pin-banner");
  expect(result()).toContain("Sample: nothing was changed.");
  expect(result()).toContain("Pin to banner");
  // Not the player's banner.
  expect(useAppStore.getState().settings).toBe(settings);

  await sampleAction("demo-menu-upload-cover", "demo-menu-appearance");
  expect(result()).toContain("Upload cover");
  await sampleAction("demo-menu-open-explorer", "demo-menu-launch-options");
  expect(result()).toContain("Open in Explorer");
});

it("keeps Favorites, Status and Tier of the sample out of the player's library", async () => {
  await startGuide();
  const journals = useAppStore.getState().gameJournals;
  await sampleAction("demo-menu-favorite");
  // The sample shows it like a real card would: the star on the cover.
  expect(sampleCard().querySelector('[aria-label="Favorite"]')).not.toBeNull();
  await rightClick(sampleCard());
  expect(document.querySelector('[role="menu"]')!.textContent).toContain(
    "Remove from Favorites",
  );
  expect(useAppStore.getState().gameJournals).toBe(journals);
});

it("runs a sample timer from Playtime › Start timer and stops it from the same menu", async () => {
  await startGuide();
  await sampleAction("demo-menu-start-timer", "demo-menu-playtime");
  expect(startGameTimer).not.toHaveBeenCalled();
  expect(useAppStore.getState().activeSessions).toEqual([]);
  expect(result()).toContain("Sample timer started");

  await rightClick(sampleCard());
  await act(async () =>
    document
      .querySelector<HTMLElement>('[data-tour="demo-menu-playtime"]')!
      .click(),
  );
  const stop = document.querySelector<HTMLElement>(
    '[data-tour="demo-menu-stop-timer"]',
  );
  expect(stop?.textContent).toMatch(/^Stop timer · /);
  expect(
    document.querySelector('[data-tour="demo-menu-start-timer"]'),
  ).toBeNull();
  await act(async () => stop!.click());
  expect(result()).toContain("Sample timer stopped");
});

it.each(["grid", "list"] as const)(
  "opens the dialog from the sample's Log missed session button in the %s layout, like a real card",
  async (size) => {
    useAppStore.getState().setMyGamesCardSize(size);
    await startGuide("log-playtime");
    const clock = sampleCard().querySelector<HTMLElement>(
      '[data-tour="demo-card-log-session"]',
    );
    expect(clock?.getAttribute("title")).toBe("Log missed session");
    await act(async () => clock!.click());
    expect(
      document.querySelector('[data-tour="demo-log-session-dialog"]'),
    ).not.toBeNull();
    expect(document.querySelector('[role="menu"]')).toBeNull();
  },
);

it("logs a session and sets a total on a practice library card too, on the sample only", async () => {
  await act(() =>
    root.render(
      <LibraryTourPractice tourId="organize-library" stepId="intro" />,
    ),
  );
  await rightClick(sampleCard());
  await act(async () =>
    document
      .querySelector<HTMLElement>('[data-tour="demo-menu-playtime"]')!
      .click(),
  );
  await act(async () =>
    document
      .querySelector<HTMLElement>('[data-tour="demo-menu-log-session"]')!
      .click(),
  );
  const dialog = document.querySelector(
    '[data-tour="demo-log-session-dialog"]',
  )!;
  const minutes = dialog.querySelectorAll<HTMLInputElement>(
    'input[type="number"]',
  )[1];
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(minutes, "30");
    minutes.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const before = sampleCard().querySelector(
    '[data-tour="demo-playtime-result"]',
  )!.textContent;
  await act(async () =>
    document
      .querySelector<HTMLElement>('[data-tour="demo-log-session-confirm"]')!
      .click(),
  );
  expect(
    sampleCard().querySelector('[data-tour="demo-playtime-result"]')!
      .textContent,
  ).not.toBe(before);
  expect(addManualSession).not.toHaveBeenCalled();
  expect(setGamePlaytime).not.toHaveBeenCalled();
});

/* While a sample guide runs, My Games shows the sample only. */

function addRealLibrary() {
  addRealWorldOfWarcraft();
  // A game that runs right now: its card came first in the list.
  useAppStore.getState().setExeCacheEntry({
    exeName: "eldenring.exe",
    state: "matched",
    gameId: 5,
    igdbId: 119133,
    gameName: "Elden Ring",
    coverUrl: "",
    source: "igdb",
    lastCheckedAt: DATE,
  });
  useAppStore.setState({
    activeSessions: [
      {
        id: 9,
        gameId: 5,
        igdbId: 119133,
        gameName: "Elden Ring",
        coverUrl: "",
        source: "igdb",
        exeName: "eldenring.exe",
        startedAt: DATE,
        checkpointedAt: DATE,
      },
    ],
  });
}

it("shows only the sample in the grid, the header numbers and the shelf chips while a sample guide runs", async () => {
  addRealLibrary();
  await act(() => root.render(<LibraryTestShell />));
  expect(container.querySelectorAll(".game-library-card")).toHaveLength(2);

  await act(() => useAppStore.getState().startTour("game-actions"));
  const cards = [...container.querySelectorAll(".game-library-card")];
  expect(cards).toHaveLength(1);
  expect(cards[0].textContent).toContain("World of Warcraft");
  expect(container.textContent).not.toContain("Elden Ring");
  // One game, its two hours and three sessions; no number of the real library.
  const toolbar = container.querySelector('[data-tour="games-toolbar"]')!;
  expect(
    toolbar.querySelector("[title='1 of 1 tracked games']"),
  ).not.toBeNull();
  expect(
    toolbar.querySelector('[data-library-shelf="all"]')!.textContent,
  ).toMatch(/All games\s*1$/);
  expect(
    toolbar.querySelector('[data-library-shelf="favorites"]')!.textContent,
  ).toMatch(/Favorites\s*0$/);
  expect(container.querySelector("#library-tabpanel p")!.textContent).toBe(
    "Showing 1 game.",
  );

  await act(() => useAppStore.getState().endTour("dismissed"));
  expect(container.querySelectorAll(".game-library-card")).toHaveLength(2);
});

it("ends the sample Play with a result on the card and tells the guide", async () => {
  vi.useFakeTimers();
  const heard: Array<{ name?: string; message?: string }> = [];
  const listen = (event: Event) => heard.push((event as CustomEvent).detail);
  window.addEventListener(TOUR_EVENT, listen);
  try {
    useAppStore.getState().setLauncherSetting("gameLaunchingEnabled", false);
    await startGuide("launch-games");
    const play = sampleCard().querySelector<HTMLElement>(
      '[data-tour="demo-launch-play"]',
    );
    expect(
      play,
      "the launch guide shows Play without the setting",
    ).not.toBeNull();
    await act(async () => play!.click());
    expect(sampleCard().textContent).toContain("Starting World of Warcraft");
    expect(result()).toBe("");

    await act(async () => vi.advanceTimersByTime(3_000));
    expect(sampleCard().textContent).not.toContain(
      "Starting World of Warcraft",
    );
    expect(result()).toContain("No program was started");
    expect(
      heard.filter((detail) => detail.name === "mygames.demo-launch-attempted"),
    ).toHaveLength(1);
    // Still there well after the launch: it used to vanish without a trace.
    await act(async () => vi.advanceTimersByTime(10_000));
    expect(result()).toContain("No program was started");
  } finally {
    window.removeEventListener(TOUR_EVENT, listen);
    vi.useRealTimers();
  }
});
