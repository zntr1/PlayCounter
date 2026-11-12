// @vitest-environment happy-dom
import { Archive, Image, Sparkles, Star, Timer } from "lucide-react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../store";
import { NEXT_RELEASE } from "./guides/shared";
import { HelpButton } from "./HelpHub";
import { tours, type TourDefinition } from "./tourDefinitions";
import { defaultTourProgress } from "./tourState";

const { getVersionMock, sample } = vi.hoisted(() => ({
  getVersionMock: vi.fn(),
  // The guides the hub shows; null = the app's real ones.
  sample: { tours: null as unknown[] | null },
}));

vi.mock("../../tracker");
vi.mock("../../platform", () => ({ currentPlatform: () => "windows" }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
  convertFileSrc: (value: string) => value,
}));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: getVersionMock }));
vi.mock("./tourDefinitions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./tourDefinitions")>();
  const list = () =>
    (sample.tours as TourDefinition[] | null) ?? actual.tours();
  return {
    ...actual,
    tours: list,
    findTour: (id: string) => list().find((tour) => tour.id === id),
    guideTours: () => list().filter((tour) => tour.kind === "guide"),
  };
});

const RUNNING_RELEASE = "1.6.0";

function guide(
  id: string,
  extra: Partial<TourDefinition> & Pick<TourDefinition, "category" | "title">,
): TourDefinition {
  return {
    id,
    version: 1,
    kind: "guide",
    description: "",
    duration: "2 min",
    icon: Star,
    steps: [{ id: "one", title: "Step", body: "Body", view: "keep" }],
    ...extra,
  };
}

// Five guides in four topics; no guide for "Detection & launching".
function sampleGuides(): TourDefinition[] {
  return [
    guide("core", {
      kind: "core",
      version: 2,
      category: "getting-started",
      title: "Quick tour",
      description: "The essentials in about a minute.",
      duration: "1 min",
      icon: Sparkles,
    }),
    guide("shelves", {
      version: 2,
      category: "library",
      title: "Favorites & shelves",
      description: "Mark favorites and build a shelf.",
      duration: "3 min",
      icon: Star,
      steps: [
        {
          id: "try",
          title: "Try it",
          body: "Body",
          view: "keep",
          interactive: true,
        },
      ],
    }),
    guide("timer", {
      category: "playtime",
      title: "While you play",
      description: "Live timer, reminder and pause.",
      icon: Timer,
      release: NEXT_RELEASE,
    }),
    guide("backup", {
      version: 3,
      category: "settings",
      title: "Back up your data",
      description: "Export a file and import it on another PC.",
      icon: Archive,
      release: "1.1.17",
      // Real settings the guide only walks through: not hands-on.
      steps: [
        {
          id: "export",
          title: "Export",
          body: "Body",
          view: "keep",
          interactive: true,
          persistentInteraction: true,
        },
      ],
    }),
    guide("covers", {
      version: 2,
      category: "library",
      title: "Covers and banners",
      description: "Pick, upload or paste artwork.",
      icon: Image,
      release: NEXT_RELEASE,
    }),
  ];
}

const ALL_DONE = { core: 2, shelves: 2, timer: 1, backup: 3, covers: 2 };

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  useAppStore.setState(useAppStore.getInitialState(), true);
  sample.tours = sampleGuides();
  getVersionMock.mockReset();
  getVersionMock.mockResolvedValue(RUNNING_RELEASE);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const trigger = () =>
  document.querySelector<HTMLButtonElement>(
    '[aria-label="Help and tutorials"]',
  )!;
const hub = () => document.getElementById("help-tutorials");
const tile = (id: string) =>
  hub()!.querySelector<HTMLButtonElement>(`[data-guide-tile="${id}"]`);
const shownTiles = () =>
  [...hub()!.querySelectorAll<HTMLElement>("[data-guide-tile]")].map(
    (element) => element.dataset.guideTile,
  );
const shownTopics = () =>
  [...hub()!.querySelectorAll<HTMLElement>("[data-guide-topic]")].map(
    (element) => element.dataset.guideTopic,
  );
/** A topic's name and the count next to it: "Your library 1/2". */
function topicHeading(id: string) {
  const name = hub()!.querySelector(`[data-guide-topic="${id}"] h3`)!;
  const count = name
    .parentElement!.textContent!.slice(name.textContent!.length)
    .trim();
  return `${name.textContent!.trim()} ${count}`;
}
const nextCard = () => hub()!.querySelector<HTMLElement>("[data-guide-next]");
/** The words next to the progress ring, read line by line. */
function progress() {
  const box = hub()!.querySelector("[data-guide-progress]")!;
  const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
  const words: string[] = [];
  while (walker.nextNode()) words.push(walker.currentNode.textContent ?? "");
  return words.join(" ").replace(/\s+/g, " ").trim();
}
const search = () =>
  hub()!.querySelector<HTMLInputElement>(
    'input[placeholder="Search guides…"]',
  )!;
/** A pill or label that reads exactly this, e.g. "New". */
const says = (element: Element | null, text: string) =>
  [...(element?.querySelectorAll("span, div, h2, h3, button") ?? [])].some(
    (node) => node.textContent?.trim() === text,
  );

async function openHub(
  completed: Record<string, number> = {},
  version = RUNNING_RELEASE,
) {
  getVersionMock.mockResolvedValue(version);
  useAppStore.setState({
    tourProgress: { ...defaultTourProgress(), completed },
  });
  await act(async () => root.render(<HelpButton />));
  // The app version arrives after the first render.
  await act(async () => {});
  await act(async () => trigger().click());
}

async function type(value: string) {
  await act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(search(), value);
    search().dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const press = (key: string) =>
  act(() =>
    (document.activeElement ?? document.body).dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true }),
    ),
  );

describe("the guide to do next", () => {
  it("starts a new player at the quick tour", async () => {
    await openHub();
    expect(says(nextCard(), "Start here")).toBe(true);
    expect(says(nextCard(), "Continue")).toBe(false);
    expect(says(nextCard(), "Quick tour")).toBe(true);
    const start = nextCard()!.querySelector("button")!;
    expect(start.textContent?.trim()).toBe("Start · 1 min");

    await act(async () => start.click());
    expect(useAppStore.getState().activeTour?.tourId).toBe("core");
    expect(hub()).toBeNull();
  });

  it("continues with the first guide the player has not finished", async () => {
    await openHub({ core: 2 });
    expect(says(nextCard(), "Continue")).toBe(true);
    expect(says(nextCard(), "Start here")).toBe(false);
    expect(says(nextCard(), "Favorites & shelves")).toBe(true);
    expect(nextCard()!.querySelector("button")!.textContent?.trim()).toBe(
      "Start · 3 min",
    );
  });

  it("follows the order of the guides, not of what was finished last", async () => {
    await openHub({ core: 2, shelves: 2, covers: 2 });
    expect(says(nextCard(), "While you play")).toBe(true);
  });

  it("offers the quick tour until it is done, even after other guides", async () => {
    await openHub({ shelves: 2, timer: 1 });
    expect(says(nextCard(), "Quick tour")).toBe(true);
    // Something is done already, so this is no first start.
    expect(says(nextCard(), "Continue")).toBe(true);
  });

  it("skips a guide that was finished in an older version", async () => {
    await openHub({ core: 2, shelves: 1 });
    expect(says(nextCard(), "Favorites & shelves")).toBe(false);
    expect(says(nextCard(), "While you play")).toBe(true);
  });

  it("offers nothing to start when every guide is done", async () => {
    await openHub(ALL_DONE);
    expect(nextCard()!.querySelector("button")).toBeNull();
    expect(says(nextCard(), "Continue")).toBe(false);
    expect(says(nextCard(), "Start here")).toBe(false);
    expect(nextCard()!.textContent).toContain("You finished every guide");
    expect(progress()).toBe("5 of 5 guides done");
  });
});

describe("New", () => {
  it("is not shown for a guide written for a later release", async () => {
    await openHub({}, RUNNING_RELEASE);
    expect(says(tile("timer"), "New")).toBe(false);
    expect(says(tile("covers"), "New")).toBe(false);
    expect(progress()).toBe("0 of 5 guides done");
  });

  it("marks the guides written for the running release", async () => {
    await openHub({}, NEXT_RELEASE);
    expect(says(tile("timer"), "New")).toBe(true);
    expect(says(tile("covers"), "New")).toBe(true);
    // An older release and a guide without one.
    expect(says(tile("backup"), "New")).toBe(false);
    expect(says(tile("core"), "New")).toBe(false);
    expect(progress()).toBe("0 of 5 guides done · 2 new");
  });

  it("goes away once the player has finished the guide", async () => {
    await openHub({ timer: 1 }, NEXT_RELEASE);
    expect(says(tile("timer"), "New")).toBe(false);
    expect(says(tile("covers"), "New")).toBe(true);
    expect(progress()).toBe("1 of 5 guides done · 1 new");
  });

  it("shows nothing as new while the app version is unknown", async () => {
    getVersionMock.mockRejectedValue(new Error("no Tauri"));
    useAppStore.setState({ tourProgress: defaultTourProgress() });
    await act(async () => root.render(<HelpButton />));
    await act(async () => {});
    await act(async () => trigger().click());
    expect(shownTiles()).toHaveLength(5);
    expect(shownTiles().some((id) => says(tile(id!), "New"))).toBe(false);
  });
});

describe("Updated", () => {
  it("marks a guide finished in an older version and still counts it as done", async () => {
    await openHub({ shelves: 1, backup: 3 });
    expect(says(tile("shelves"), "Updated")).toBe(true);
    expect(says(tile("shelves"), "Replay")).toBe(true);
    expect(says(tile("shelves"), "Start")).toBe(false);
    expect(tile("shelves")!.querySelector("svg.lucide-check")).not.toBeNull();
    expect(topicHeading("library")).toBe("Your library 1/2");
    expect(progress()).toBe("2 of 5 guides done");
    // A guide finished in its current version is not "updated".
    expect(says(tile("backup"), "Updated")).toBe(false);
    // Never started: nothing to update.
    expect(says(tile("timer"), "Updated")).toBe(false);
  });

  it("wins over New: the player knows the guide already", async () => {
    await openHub({ covers: 1 }, NEXT_RELEASE);
    expect(says(tile("covers"), "Updated")).toBe(true);
    expect(says(tile("covers"), "New")).toBe(false);
    expect(progress()).toBe("1 of 5 guides done · 1 new");
  });

  it("counts in the ring, the topics and the next guide", async () => {
    await openHub({ core: 2, shelves: 1, timer: 1, backup: 3, covers: 1 });
    expect(progress()).toBe("5 of 5 guides done");
    expect(topicHeading("library")).toBe("Your library 2/2");
    expect(nextCard()!.textContent).toContain("You finished every guide");
  });
});

describe("tiles", () => {
  it("show a guide's title, description, duration and own icon", async () => {
    await openHub();
    const shelves = tile("shelves")!;
    expect(says(shelves, "Favorites & shelves")).toBe(true);
    expect(says(shelves, "Mark favorites and build a shelf.")).toBe(true);
    expect(says(shelves, "3 min")).toBe(true);
    expect(shelves.querySelector("svg.lucide-star")).not.toBeNull();
    expect(tile("timer")!.querySelector("svg.lucide-timer")).not.toBeNull();
    expect(says(shelves, "Start")).toBe(true);
  });

  it("show a check and Replay once the guide is done", async () => {
    await openHub({ shelves: 2 });
    const shelves = tile("shelves")!;
    expect(shelves.querySelector("svg.lucide-check")).not.toBeNull();
    expect(shelves.querySelector("svg.lucide-star")).toBeNull();
    expect(says(shelves, "Replay")).toBe(true);
    expect(says(shelves, "Start")).toBe(false);
  });

  it("mark guides the player tries things in as Hands-on", async () => {
    await openHub();
    expect(says(tile("shelves"), "Hands-on")).toBe(true);
    // Only real settings to click, and nothing to click at all.
    expect(says(tile("backup"), "Hands-on")).toBe(false);
    expect(says(tile("timer"), "Hands-on")).toBe(false);
  });

  it("start their guide and close the hub", async () => {
    await openHub({ core: 2 });
    await act(async () => tile("covers")!.click());
    expect(useAppStore.getState().activeTour?.tourId).toBe("covers");
    expect(useAppStore.getState().helpMenuOpen).toBe(false);
    expect(hub()).toBeNull();
  });

  it("replay a finished guide", async () => {
    await openHub(ALL_DONE);
    await act(async () => tile("backup")!.click());
    expect(useAppStore.getState().activeTour?.tourId).toBe("backup");
  });
});

describe("topics", () => {
  it("list their guides in order, with how many are done", async () => {
    await openHub({ core: 2, covers: 2 });
    expect(shownTopics()).toEqual([
      "getting-started",
      "library",
      "playtime",
      "settings",
    ]);
    expect(shownTiles()).toEqual([
      "core",
      "shelves",
      "covers",
      "timer",
      "backup",
    ]);
    expect(topicHeading("getting-started")).toBe("Getting started 1/1");
    expect(topicHeading("library")).toBe("Your library 1/2");
    expect(topicHeading("playtime")).toBe("Playtime & stats 0/1");
    expect(topicHeading("settings")).toBe("Settings & support 0/1");
    expect(progress()).toBe("2 of 5 guides done");
  });
});

describe("search", () => {
  it("finds guides by title and description, whatever the case, across topics", async () => {
    await openHub();
    // "your" is in one title and "another" only in that guide's description;
    // "you" is in two titles of two topics.
    await type("YOU");
    expect(shownTiles()).toEqual(["timer", "backup"]);
    expect(shownTopics()).toEqual(["playtime", "settings"]);

    await type("  artwork ");
    expect(shownTiles()).toEqual(["covers"]);
    expect(shownTopics()).toEqual(["library"]);
  });

  it("hides the progress and the next guide while a search is typed", async () => {
    await openHub();
    expect(nextCard()).not.toBeNull();
    await type("shelf");
    expect(nextCard()).toBeNull();
    expect(hub()!.querySelector("[data-guide-progress]")).toBeNull();
    await type("");
    expect(nextCard()).not.toBeNull();
    expect(hub()!.querySelector("[data-guide-progress]")).not.toBeNull();
  });

  it("keeps a topic's count over all its guides", async () => {
    await openHub({ shelves: 2 });
    await type("artwork");
    expect(topicHeading("library")).toBe("Your library 1/2");
  });

  it("says so when no guide matches", async () => {
    await openHub();
    await type("zzz");
    expect(shownTiles()).toEqual([]);
    expect(shownTopics()).toEqual([]);
    expect(hub()!.textContent).toContain("No guide matches that.");
    await type("timer");
    expect(hub()!.textContent).not.toContain("No guide matches that.");
  });

  it("is cleared by Escape first; the next Escape closes the hub", async () => {
    await openHub();
    await type("timer");
    expect(shownTiles()).toEqual(["timer"]);

    await press("Escape");
    expect(hub()).not.toBeNull();
    expect(search().value).toBe("");
    expect(shownTiles()).toHaveLength(5);

    await press("Escape");
    expect(hub()).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it("starts empty every time the hub opens", async () => {
    await openHub();
    await type("timer");
    await act(async () => trigger().click());
    expect(hub()).toBeNull();
    await act(async () => trigger().click());
    expect(search().value).toBe("");
    expect(shownTiles()).toHaveLength(5);
  });
});

describe("opening and closing", () => {
  it("opens under the ? button, which keeps its guide marker", async () => {
    await openHub();
    expect(trigger().closest('[data-tour="help"]')).not.toBeNull();
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    expect(says(hub(), "Help & guides")).toBe(true);
    expect(hub()!.textContent).toContain(
      "Short guides with sample games. Nothing you try changes your library.",
    );
  });

  it("closes on a click outside, not on a click inside", async () => {
    await openHub();
    await act(async () => {
      hub()!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(hub()).not.toBeNull();
    await act(async () => {
      document.body.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true }),
      );
    });
    expect(hub()).toBeNull();
  });

  it("closes with its close button and gives focus back to the ? button", async () => {
    await openHub();
    await act(async () =>
      hub()!
        .querySelector<HTMLButtonElement>('[aria-label="Close help"]')!
        .click(),
    );
    expect(hub()).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it("closes with Escape and gives focus back to the ? button", async () => {
    await openHub();
    await press("Escape");
    expect(hub()).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });
});

describe("the app's real guides", () => {
  beforeEach(() => {
    sample.tours = null;
  });

  it("each get a tile, and the counts cover all of them", async () => {
    await openHub();
    const ids = tours().map((tour) => tour.id);
    expect(ids.length).toBeGreaterThan(20);
    expect([...shownTiles()].sort()).toEqual([...ids].sort());
    expect(progress().startsWith(`0 of ${ids.length} guides done`)).toBe(true);
    expect(says(nextCard(), "Start here")).toBe(true);
  });

  it("are New in the next release exactly when they were written for it", async () => {
    await openHub({}, NEXT_RELEASE);
    const written = tours().filter((tour) => tour.release === NEXT_RELEASE);
    expect(written.length).toBeGreaterThan(0);
    for (const tour of tours()) {
      expect(says(tile(tour.id), "New"), tour.id).toBe(
        tour.release === NEXT_RELEASE,
      );
    }
  });

  it("are not New in a release none of them was written for", async () => {
    await openHub({}, "0.0.1");
    expect(shownTiles()).toHaveLength(tours().length);
    expect(shownTiles().some((id) => says(tile(id!), "New"))).toBe(false);
  });
});
