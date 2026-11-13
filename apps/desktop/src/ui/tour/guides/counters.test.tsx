// @vitest-environment happy-dom
import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(async () => undefined),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("../../../tracker");
const platform = vi.hoisted(() => ({ value: "windows" }));
vi.mock("../../../platform", () => ({
  currentPlatform: () => platform.value,
  detectPlatformFrom: () => platform.value,
}));

import { journalCounters } from "../../../counters";
import {
  getGameJournal,
  useAppStore,
  type ActiveSession,
} from "../../../store";
import { NowPlayingCounters } from "../../counters/CounterParts";
import { GameCountersTab } from "../../views/games/GameCountersTab";
import { sampleSessionForStep } from "../../views/NowPlayingView";
import {
  GameDetailsDialog,
  type DetailsTab,
} from "../../views/games/GameDetailsDialog";
import type { GameSummary } from "../../views/MyGamesView";
import { findTour } from "../tourDefinitions";
import { tourCounters } from "../tourDemoDetails";
import { sampleStageForStep } from "../tourDemoGame";
import { TOUR_DEMO_GAME } from "../tourDemoGame";
import { findTourElement } from "../tourTargetRect";
import { TourOverlay, tourDoneFlash } from "../TourUI";
import { NEXT_RELEASE } from "./shared";

/* Count deaths and bosses (docs/tours-plan.md, WP6): counters of a game, a
   key of its own per counter, shown while you play, counted on Now Playing,
   and the keys for the counter box. The feature is in develop, not released. */

const guide = () => findTour("counters")!;
const step = (id: string) => guide().steps.find((entry) => entry.id === id)!;
const indexOf = (id: string) =>
  guide().steps.findIndex((entry) => entry.id === id);
const store = () => useAppStore.getState();
const stepId = () => guide().steps[store().activeTour?.stepIndex ?? -1]?.id;
const texts = (entry: { title: string; body: string; task?: string }) =>
  `${entry.title} ${entry.body} ${entry.task ?? ""}`;
const bold = (text: string | undefined) =>
  [...(text ?? "").matchAll(/<b>([\s\S]*?)<\/b>/g)].map((match) => match[1]);
const names = (selector: string | undefined) =>
  [...(selector ?? "").matchAll(/data-tour="([^"]+)"/g)].map(
    (match) => match[1],
  );

// Every English text the app can show, from all area files.
const english = new Set(
  Object.values(
    import.meta.glob<Record<string, string>>("../../../locales/en/*.json", {
      eager: true,
      import: "default",
    }),
  ).flatMap((area) => Object.values(area)),
);

/** My Games builds the sample card again whenever the guide puts the sample
 *  back to its start. */
function SampleCards() {
  const resetToken = useAppStore((state) => state.demoResetToken);
  return <SampleCard key={resetToken} />;
}

let root: Root;
let container: HTMLDivElement;
const fetchMock = vi.fn(async () => {
  throw new Error("offline");
});

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => {});
  localStorage.clear();
  useAppStore.setState(useAppStore.getInitialState(), true);
  platform.value = "windows";
  invokeMock.mockClear();
  fetchMock.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function click(element: Element | null | undefined) {
  expect(element).toBeTruthy();
  await act(async () => {
    (element as HTMLElement).click();
  });
}
async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
/** The guide looks for an opened tab or dialog ten times a second. */
const tick = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 260));
  });
const buttonNamed = (name: string, within: ParentNode = document) =>
  [...within.querySelectorAll("button")].find(
    (entry) => entry.textContent?.trim() === name,
  );
const dialog = () =>
  document.querySelector<HTMLElement>(
    '[role="dialog"][data-tour="demo-game-details"]',
  );
const selectedTab = () =>
  dialog()?.querySelector('[role="tab"][aria-selected="true"]')?.textContent;
const counterNames = () =>
  [...document.querySelectorAll<HTMLElement>('[role="option"]')].map(
    (entry) => entry.textContent ?? "",
  );

async function startAt(id: string, jump = true) {
  await act(async () => {
    root.render(
      <>
        <SampleCards />
        <TourOverlay />
      </>,
    );
    store().startTour("counters");
  });
  await act(async () => store().goToTourStep(indexOf(id), jump));
}

describe("Count deaths and bosses: the rules for every step", () => {
  it("is a new hands-on guide of the next release", () => {
    expect(guide().version).toBe(1);
    expect(guide().release).toBe(NEXT_RELEASE);
    expect(guide().kind).toBe("guide");
    expect(guide().demoGame).toBe(true);
  });

  it("has 4 to 9 short steps", () => {
    for (const os of ["windows", "linux"]) {
      platform.value = os;
      expect(guide().steps.length, os).toBeGreaterThanOrEqual(4);
      expect(guide().steps.length, os).toBeLessThanOrEqual(9);
      for (const entry of guide().steps) {
        const at = `${os} ${entry.id}`;
        expect(entry.title.length, `${at} title`).toBeLessThanOrEqual(40);
        expect(entry.body.length, `${at} body`).toBeLessThanOrEqual(220);
        expect(entry.task?.length ?? 0, `${at} task`).toBeLessThanOrEqual(160);
      }
    }
  });

  it("rings something on every step after the first, which is for reading", () => {
    expect(
      guide()
        .steps.slice(1)
        .filter((entry) => !entry.anchor)
        .map((entry) => entry.id),
    ).toEqual([]);
  });

  it("names controls exactly as the app shows them", () => {
    for (const os of ["windows", "linux"]) {
      platform.value = os;
      for (const entry of guide().steps)
        for (const name of [...bold(entry.body), ...bold(entry.task)])
          expect(english.has(name), `${entry.id} names "${name}"`).toBe(true);
    }
  });

  it("uses the app's words", () => {
    for (const entry of guide().steps)
      expect(texts(entry), entry.id).not.toMatch(
        /\b(providers?|wizard|executables?|checkbox)\b/i,
      );
  });

  it("says once, in the first step, that this is a sample and nothing is saved", () => {
    const [first, ...rest] = guide().steps;
    expect(first.body).toMatch(/sample/i);
    expect(first.body).toMatch(/nothing is saved/i);
    expect(
      rest.filter((entry) => /nothing is saved/i.test(texts(entry))),
    ).toEqual([]);
  });

  it("gives every task a step that finishes by itself and can be stepped over", () => {
    const tasks = guide().steps.filter((entry) => entry.task);
    expect(tasks.map((entry) => entry.id)).toEqual([
      "open-details",
      "counters-tab",
      "add",
      "key",
      "count",
    ]);
    for (const entry of tasks) {
      expect(entry.interactive, entry.id).toBe(true);
      expect(entry.advanceOn, entry.id).toBeTruthy();
      expect(entry.allow?.length, entry.id).toBeGreaterThan(0);
      // Skip moves one step on, not past every later exercise.
      expect(entry.skipTo, entry.id).toBe(
        guide().steps[indexOf(entry.id) + 1].id,
      );
      for (const selector of [entry.anchor, ...(entry.allow ?? [])])
        expect(
          names(selector).every((name) => name.startsWith("demo-")),
          `${entry.id} ${selector}`,
        ).toBe(true);
    }
  });

  it("never suggests a key: the player picks it", () => {
    const all = guide().steps.map(texts).join(" ");
    expect(all).not.toMatch(
      /\b(Ctrl|Control|Alt|Shift|Numpad|Num \d|F\d{1,2})\b/,
    );
    // The only key named is the one that confirms a name.
    expect([...all.matchAll(/<kbd>(.*?)<\/kbd>/g)].map((m) => m[1])).toEqual([
      "Enter",
    ]);
    expect(step("key").task).toMatch(/you like|your choice|of your own/i);
  });

  it("ends with what to do in the app, and offers Screenshots next", () => {
    const last = guide().steps.at(-1)!;
    expect(last.task).toBeUndefined();
    expect(last.interactive).toBeUndefined();
    expect(last.body).toMatch(/in the app/i);
    expect(guide().nextTourId).toBe("screenshots");
    expect(findTour("screenshots")).toBeTruthy();
  });
});

describe("Count deaths and bosses: the steps", () => {
  it("sets a counter up in Details, counts on Now Playing, then shows the keys in Settings", () => {
    expect(
      guide().steps.map((entry) => [entry.id, entry.view, entry.sampleDetails]),
    ).toEqual([
      ["intro", "games", undefined],
      ["open-details", "games", undefined],
      ["counters-tab", "games", "general"],
      ["add", "games", "counters"],
      ["key", "games", "counters"],
      ["shown", "games", "counters"],
      ["count", "now", undefined],
      ["box", "settings", undefined],
      ["finish", "games", undefined],
    ]);
  });

  it("says what a counter is for: deaths, bosses, runs", () => {
    const intro = texts(step("intro")).toLowerCase();
    for (const word of ["deaths", "boss", "runs"])
      expect(intro, word).toContain(word);
  });

  it("opens Details from the sample card's menu, ringing the entry once the menu is open", () => {
    const open = step("open-details");
    expect(bold(open.task)).toEqual(["Open Details"]);
    expect(open.task).toMatch(/right-click/i);
    expect(open.anchor).toBe('[data-tour="demo-game-card"]');
    expect(open.anchorTargets).toEqual(['[data-tour="demo-menu-details"]']);
    expect(open.allow).toEqual([
      '[data-tour="demo-game-card"]',
      '[data-tour="demo-context-menu"]',
    ]);
    expect(open.advanceOn).toEqual({
      type: "anchor-present",
      selector: '[data-tour="demo-game-details"]',
    });
  });

  it("names the controls of each exercise", () => {
    expect(bold(step("counters-tab").task)).toEqual(["Counters"]);
    expect(bold(step("add").task)).toEqual(["Add counter"]);
    expect(bold(step("key").task)).toEqual(["Set a key"]);
    expect(bold(step("shown").body)).toContain(
      "Show in the live timer and on Now Playing",
    );
    expect(bold(step("count").task)).toEqual(["Add one"]);
    expect(bold(step("box").body)).toEqual([
      "Open counter box",
      "Take one back",
    ]);
  });

  it("points at the counter keys in Settings → Keyboard shortcuts without changing anything", () => {
    const box = step("box");
    expect(box.settingsGroup).toBe("shortcuts");
    expect(box.anchor).toBe('[data-tour="settings-section-counters"]');
    expect(box.interactive).toBeUndefined();
  });

  it("mentions the controller only where it can count (Windows)", () => {
    expect(bold(step("shown").body)).toContain("Count with View + D-pad up");
    expect(step("shown").additionalAnchors).toEqual([
      '[data-tour="demo-counter-controller"]',
    ]);
    platform.value = "linux";
    expect(step("shown").body).not.toMatch(/controller|D-pad/i);
  });
});

describe("the sample's Counters tab during the guide", () => {
  it("opens Details on General for “Open the Counters tab” when the step before was skipped, and finishes on the tab", async () => {
    await startAt("counters-tab");
    expect(selectedTab()).toBe("General");
    const tab = findTourElement(step("counters-tab").anchor!)!;
    expect(tab.getAttribute("role")).toBe("tab");
    expect(tab.textContent).toBe("Counters");
    await tick();
    // Nothing done yet: the step waits.
    expect(stepId()).toBe("counters-tab");
    await click(tab);
    await tick();
    expect(stepId()).toBe("add");
    expect(selectedTab()).toBe("Counters");
  });

  it("does not bounce forward when the player comes back to that step", async () => {
    await startAt("add");
    expect(selectedTab()).toBe("Counters");
    // Back: the guide puts the sample back to its start.
    await act(async () => store().goToTourStep(indexOf("counters-tab"), true));
    await tick();
    expect(stepId()).toBe("counters-tab");
    expect(selectedTab()).toBe("General");
  });

  it("opens the Counters tab by itself for “Add a counter”, and finishes when a counter is added", async () => {
    await startAt("add");
    expect(selectedTab()).toBe("Counters");
    const add = findTourElement(step("add").anchor!)!;
    expect(add.textContent).toBe("Add counter");
    await click(add);
    // The ring follows to the name field.
    const field = findTourElement(step("add").anchorTargets![0])!;
    const input = field.querySelector("input") as HTMLInputElement;
    await type(input, "Runs");
    await act(async () => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(counterNames().some((name) => name.startsWith("Runs"))).toBe(true);
    expect(stepId()).toBe("key");
    // Sample only.
    expect(store().gameJournals).toEqual({});
  });

  it("finishes “Give it a key of its own” with the key the player presses, and registers nothing", async () => {
    await startAt("key");
    const button = findTourElement(step("key").anchor!)!;
    expect(button.textContent).toBe("Set a key");
    await click(button);
    await act(async () => {
      findTourElement(step("key").anchor!)!.dispatchEvent(
        new KeyboardEvent("keydown", {
          code: "Numpad7",
          key: "7",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(stepId()).toBe("shown");
    expect(dialog()?.querySelector("kbd")?.textContent).toBe("Num 7");
    expect(invokeMock).not.toHaveBeenCalled();
    expect(store().gameJournals).toEqual({});
  });

  it("rings the switch that shows a counter while you play, and the controller row on Windows", async () => {
    await startAt("shown");
    const row = findTourElement(step("shown").anchor!)!;
    expect(row.textContent).toContain(
      "Show in the live timer and on Now Playing",
    );
    expect(
      findTourElement(step("shown").additionalAnchors![0])?.textContent,
    ).toContain("Count with View + D-pad up");
  });

  it("closes Details for the last step", async () => {
    await startAt("shown");
    expect(dialog()).toBeTruthy();
    await act(async () => store().goToTourStep(indexOf("finish")));
    expect(dialog()).toBeNull();
  });
});

describe("counting on Now Playing during the guide", () => {
  // The sample session NowPlayingView shows while a guide runs.
  const session: ActiveSession = {
    id: -1,
    gameId: TOUR_DEMO_GAME.gameId,
    gameName: TOUR_DEMO_GAME.name,
    exeName: TOUR_DEMO_GAME.exeName,
    coverUrl: TOUR_DEMO_GAME.coverUrl,
    startedAt: new Date(Date.now() - 137_000).toISOString(),
    checkpointedAt: new Date(Date.now() - 137_000).toISOString(),
  };
  async function showNowPlaying() {
    await act(async () => {
      root.render(
        <>
          <NowPlayingCounters session={session} />
          <TourOverlay />
        </>,
      );
    });
  }
  const sessionCount = () =>
    Number(
      container.querySelector(".tabular-nums.text-\\[32px\\]")?.textContent,
    );

  it("has Now Playing show the sample session on “Count while you play”, with or without a game running", () => {
    expect(sampleSessionForStep(step("count")).shown).toBe(true);
  });

  it("keeps Now Playing in view while the card says Done, then opens the next page", async () => {
    // The next step is on Settings: the counted tile must stay in sight
    // for a moment, not vanish with the click.
    const before = tourDoneFlash.ms;
    tourDoneFlash.ms = 900;
    try {
      await act(async () => store().startTour("counters"));
      await act(async () => store().goToTourStep(indexOf("count")));
      await showNowPlaying();
      const counted = sessionCount();
      await click(findTourElement(step("count").anchor!)!);
      expect(sessionCount()).toBe(counted + 1);
      expect(stepId()).toBe("count");
      expect(store().activeView).toBe("now");
      // The card says Done meanwhile.
      expect(
        document.querySelector("[data-tour-card]")?.textContent,
      ).toContain("Done");
      await act(() => new Promise((resolve) => setTimeout(resolve, 1100)));
      expect(stepId()).toBe("box");
      expect(store().activeView).toBe("settings");
    } finally {
      tourDoneFlash.ms = before;
    }
  });

  it("drops the waiting page switch when the player goes back meanwhile", async () => {
    const before = tourDoneFlash.ms;
    tourDoneFlash.ms = 900;
    try {
      await act(async () => store().startTour("counters"));
      await act(async () => store().goToTourStep(indexOf("count")));
      await showNowPlaying();
      await click(findTourElement(step("count").anchor!)!);
      await act(async () => store().goToTourStep(indexOf("shown"), true));
      await act(() => new Promise((resolve) => setTimeout(resolve, 1100)));
      expect(stepId()).toBe("shown");
    } finally {
      tourDoneFlash.ms = before;
    }
  });

  it("shows the sample's counters as tiles and finishes “Count while you play” on Add one", async () => {
    await act(async () => store().startTour("counters"));
    await act(async () => store().goToTourStep(indexOf("count")));
    await showNowPlaying();
    expect(container.textContent).toContain("Deaths");
    expect(container.textContent).toContain("this session");
    const before = sessionCount();
    const plus = findTourElement(step("count").anchor!)!;
    expect(plus.getAttribute("title")).toBe("Add one");
    await click(plus);
    expect(sessionCount()).toBe(before + 1);
    expect(stepId()).toBe("box");
    // The real library has no session and no count.
    expect(store().activeSessions).toEqual([]);
    expect(store().gameJournals).toEqual({});
  });

  it("shows a counter the player added in Details", async () => {
    await act(async () => store().startTour("counters"));
    const sample = tourCounters();
    sample.store.getState().addGameCounter(sample.game, "Runs");
    await act(async () => store().goToTourStep(indexOf("count")));
    await showNowPlaying();
    expect(container.textContent).toContain("Runs");
  });

  it("takes one back without finishing the step", async () => {
    await act(async () => store().startTour("counters"));
    await act(async () => store().goToTourStep(indexOf("count")));
    await showNowPlaying();
    // Only "Add one" is ringed and allowed; the count stays the player's.
    const minus = container.querySelector<HTMLElement>(
      'button[title="Take one back"]',
    );
    await click(minus);
    expect(stepId()).toBe("count");
  });

  it("uses the real library for the same session outside the guide", async () => {
    await showNowPlaying();
    // Never counted: the quiet line, not the sample's tiles.
    expect(container.textContent).toContain("Count Deaths here");
    expect(container.textContent).not.toContain("this session");
  });
});

describe("“Show me how” on the empty Counters tab", () => {
  const eldenRing = {
    gameId: 119133,
    source: "igdb" as const,
    igdbId: 119133,
    gameName: "Elden Ring",
    coverUrl: "",
  };
  const game = { ...eldenRing, name: "Elden Ring" } as unknown as GameSummary;
  const link = () =>
    container.querySelector<HTMLElement>('[data-guide-link="counters"]');

  it("starts this guide from a game without counters", async () => {
    store().deleteGameCounter(eldenRing, "deaths");
    expect(journalCounters(getGameJournal(store(), eldenRing))).toEqual([]);
    await act(async () => root.render(<GameCountersTab game={game} />));
    expect(container.textContent).toContain("No counters.");
    expect(link()?.textContent).toBe("Show me how");
    await click(link());
    expect(store().activeTour?.tourId).toBe("counters");
  });

  it("is not there while a game still has a counter, and not while a guide runs", async () => {
    await act(async () => root.render(<GameCountersTab game={game} />));
    expect(link()).toBeNull();
    store().deleteGameCounter(eldenRing, "deaths");
    await act(async () => store().startTour("counters"));
    await act(async () => root.render(<GameCountersTab game={game} />));
    expect(container.textContent).toContain("No counters.");
    expect(link()).toBeNull();
  });
}); // The sample card of the guides (MyGamesView's makeTourDemoGame).
const sampleGame: GameSummary = {
  kind: "tour-demo",
  gameId: TOUR_DEMO_GAME.gameId,
  name: TOUR_DEMO_GAME.name,
  coverUrl: TOUR_DEMO_GAME.coverUrl,
  source: null,
  sources: [],
  aliases: [],
  totalSeconds: 7_200,
  sessionSeconds: 7_200,
  archivedSeconds: 0,
  adjustmentSeconds: 0,
  recordedSeconds: 7_200,
  sessionCount: 3,
  historyGameKey: null,
  lastPlayedAt: new Date().toISOString(),
  exeNames: [TOUR_DEMO_GAME.exeName],
  emulatorLabels: [],
  emulatorIds: [],
  emulatorContentKeys: [],
  libraryImports: [],
  providerFloorSeconds: 0,
};

/** What the sample card in My Games does with its Details (MyGamesView's
 *  stage, sampleStageForStep): it opens them on the tab the running step
 *  asks for, and closes them on a step that asks for none. "Open Details" in
 *  its menu opens General. */
function SampleCard() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<DetailsTab>("general");
  const activeTour = useAppStore((state) => state.activeTour);
  const tourStep = activeTour
    ? findTour(activeTour.tourId)?.steps[activeTour.stepIndex]
    : undefined;
  useEffect(() => {
    const { details } = sampleStageForStep(tourStep);
    if (details) {
      setTab(details);
      setOpen(true);
    } else setOpen(false);
  }, [activeTour?.tourId, tourStep?.id]);
  return (
    <>
      <button
        type="button"
        data-tour="demo-game-card"
        onClick={() => {
          setTab("general");
          setOpen(true);
        }}
      />
      {open ? (
        <GameDetailsDialog
          key={tab}
          game={sampleGame}
          initialTab={tab}
          launchKey="test"
          launchBlocked={false}
          onAcquireLaunch={() => true}
          onReleaseLaunch={() => {}}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}
