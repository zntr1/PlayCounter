// @vitest-environment happy-dom
import { act } from "react";
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

import { useAppStore } from "../../../store";
import { AchievementsView } from "../../views/AchievementsView";
import {
  achievementSources,
  GameAchievementsTab,
} from "../../views/games/GameAchievementsTab";
import { findTour } from "../tourDefinitions";
import { TOUR_ACHIEVEMENTS_PAGE_TABS } from "../tourDemoDetails";
import { TOUR_DEMO_GAME } from "../tourDemoGame";
import { findTourElement } from "../tourTargetRect";
import { TourOverlay } from "../TourUI";
import { saysSample } from "./guideRules.test.kit";
import { NEXT_RELEASE } from "./shared";

/* Achievements & trophies (docs/tours-plan.md, WP6): PlayCounter's own
   milestones and game ladders on the Achievements page, and the achievements
   or trophies the launchers know, shown per game. */

const guide = () => findTour("game-achievements")!;
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
const buttonNamed = (name: string, within: ParentNode = document) =>
  [...within.querySelectorAll("button")].find(
    (entry) => entry.textContent?.trim() === name,
  );

describe("Achievements & trophies: the rules for every step", () => {
  it("is a new hands-on guide of the next release", () => {
    expect(guide().version).toBe(1);
    expect(guide().release).toBe(NEXT_RELEASE);
    expect(guide().kind).toBe("guide");
    // The sample card is where a game's own achievements are opened.
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

  it("never says that it uses a sample: the help hub says so", () => {
    expect(guide().steps.filter((entry) => saysSample(entry.body))).toEqual([]);
  });

  it("gives every task a step that finishes by itself and can be stepped over", () => {
    const tasks = guide().steps.filter((entry) => entry.task);
    expect(tasks.length).toBeGreaterThanOrEqual(3);
    for (const entry of tasks) {
      expect(entry.interactive, entry.id).toBe(true);
      expect(entry.advanceOn, entry.id).toBeTruthy();
      expect(entry.allow?.length, entry.id).toBeGreaterThan(0);
      // Skip moves one step on, not past every later exercise.
      expect(entry.skipTo, entry.id).toBe(
        guide().steps[indexOf(entry.id) + 1].id,
      );
      // Only sample controls can be clicked.
      for (const selector of [entry.anchor, ...(entry.allow ?? [])])
        expect(
          names(selector).every((name) => name.startsWith("demo-")),
          `${entry.id} ${selector}`,
        ).toBe(true);
    }
  });

  it("ends with what to do in the app, and offers the launcher sign-ins next", () => {
    const last = guide().steps.at(-1)!;
    expect(last.task).toBeUndefined();
    expect(last.interactive).toBeUndefined();
    expect(last.body).toMatch(/in the app/i);
    expect(guide().nextTourId).toBe("launcher-accounts");
    expect(findTour("launcher-accounts")).toBeTruthy();
  });
});

describe("Achievements & trophies: the steps", () => {
  it("goes from the page over the two kinds to a game's own achievements", () => {
    expect(guide().steps.map((entry) => entry.id)).toEqual([
      "page",
      "tabs",
      "ladders",
      "open",
      "sort",
      "sign-in",
      "finish",
    ]);
    expect(
      guide()
        .steps.slice(0, 3)
        .map((entry) => entry.view),
    ).toEqual(["achievements", "achievements", "achievements"]);
    expect(
      guide()
        .steps.slice(3)
        .every((entry) => entry.view === "games"),
    ).toBe(true);
  });

  it("names both kinds: milestones and game ladders, then the launchers", () => {
    expect(bold(step("tabs").body)).toEqual(["Milestones", "Game ladders"]);
    expect(bold(step("tabs").task)).toEqual(["Game ladders"]);
    for (const launcher of [
      "Steam",
      "Xbox",
      "GOG",
      "Epic Games",
      "PlayStation",
    ])
      expect(step("open").body, launcher).toContain(launcher);
  });

  it("opens a game's achievements from the sample card's menu, ringing the menu entry once the menu is open", () => {
    const open = step("open");
    expect(bold(open.task)).toEqual(["Achievements"]);
    expect(open.task).toMatch(/right-click/i);
    expect(open.anchor).toBe('[data-tour="demo-game-card"]');
    // First present wins: the entry before the card.
    expect(open.anchorTargets).toEqual([
      '[data-tour="demo-menu-achievements"]',
    ]);
    expect(open.allow).toEqual([
      '[data-tour="demo-game-card"]',
      '[data-tour="demo-context-menu"]',
    ]);
    // Done once the tab is on screen.
    expect(open.advanceOn).toEqual({
      type: "anchor-present",
      selector: '[data-tour="demo-details-panel-achievements"]',
    });
    // The menu must be closed when the step starts.
    expect(open.sampleDetails).toBeUndefined();
  });

  it("names Unlocked, Locked and the sort, and asks to change the sort", () => {
    expect(bold(step("sort").body)).toEqual(["Unlocked", "Locked"]);
    expect(step("sort").task).toMatch(/sort|order/i);
    expect(names(step("sort").anchor)).toEqual(["demo-achievement-sort"]);
    expect(step("sort").additionalAnchors).toEqual([
      '[data-tour="demo-achievement-filters"]',
    ]);
  });

  it("opens the sample's Details by itself in every step that works inside it", () => {
    for (const id of ["sort", "sign-in"])
      expect(step(id).sampleDetails, id).toBe("achievements");
    expect(step("finish").sampleDetails).toBeUndefined();
  });

  it("says for every step on the Achievements page which tab it needs", () => {
    for (const entry of guide().steps.filter(
      (candidate) => candidate.view === "achievements",
    ))
      expect(TOUR_ACHIEVEMENTS_PAGE_TABS[entry.id], entry.id).toMatch(
        /^(milestones|games)$/,
      );
    expect(TOUR_ACHIEVEMENTS_PAGE_TABS.ladders).toBe("games");
    expect(TOUR_ACHIEVEMENTS_PAGE_TABS.tabs).toBe("milestones");
  });

  it("leaves “Sign in again” out where launchers have no sign-in (not on Windows)", () => {
    platform.value = "linux";
    expect(guide().steps.map((entry) => entry.id)).toEqual([
      "page",
      "tabs",
      "ladders",
      "open",
      "sort",
      "finish",
    ]);
    expect(guide().steps.map(texts).join(" ")).not.toContain("Sign in again");
    // Only the launchers that have achievements there.
    expect(step("open").body).toContain("Steam");
    expect(step("open").body).toContain("Xbox");
    for (const launcher of ["GOG", "Epic Games", "PlayStation"])
      expect(step("open").body, launcher).not.toContain(launcher);
  });
});

describe("the Achievements page while the guide runs", () => {
  async function showPage() {
    await act(async () => {
      root.render(
        <>
          <AchievementsView />
          <TourOverlay />
        </>,
      );
    });
  }
  const tabNamed = (name: string) =>
    [...container.querySelectorAll<HTMLElement>('[role="tab"]')].find((tab) =>
      tab.textContent?.startsWith(name),
    )!;
  const ladders = () =>
    container.querySelectorAll("#achievements-panel-games article");

  it("shows sample milestones and ladders to a newcomer, from the first step on", async () => {
    await act(async () => store().startTour("game-achievements"));
    await showPage();
    // An empty library: 0 of 29 without the sample.
    expect(tabNamed("Milestones").textContent).not.toMatch(/Milestones0\//);
    expect(tabNamed("Game ladders").textContent).not.toMatch(/ladders0\//);
    for (const id of ["page", "tabs", "ladders"]) {
      await act(async () => store().goToTourStep(indexOf(id), true));
      // The first step rings nothing; the sample hero is behind it.
      const shown = step(id).anchor ?? '[data-tour="achievements-hero"]';
      expect(findTourElement(shown), id).toBeTruthy();
    }
    // Nothing of it is the player's.
    expect(store().awardedMilestones).toEqual([]);
    expect(store().recentSessions).toEqual([]);
  });

  it("finishes “Milestones and game ladders” when the player opens Game ladders, and shows the ladders next", async () => {
    await act(async () => store().startTour("game-achievements"));
    await showPage();
    await act(async () => store().goToTourStep(indexOf("tabs")));
    expect(tabNamed("Milestones").getAttribute("aria-selected")).toBe("true");
    await click(findTourElement(step("tabs").anchor!));
    expect(stepId()).toBe("ladders");
    expect(tabNamed("Game ladders").getAttribute("aria-selected")).toBe("true");
    expect(ladders().length).toBeGreaterThanOrEqual(3);
    expect(container.textContent).toContain(TOUR_DEMO_GAME.name);
  });

  it("does not finish that step for the tab that is already open", async () => {
    await act(async () => store().startTour("game-achievements"));
    await showPage();
    await act(async () => store().goToTourStep(indexOf("tabs")));
    await click(tabNamed("Milestones"));
    expect(stepId()).toBe("tabs");
  });

  it("shows the ladders by itself when “One ladder per game” is entered from anywhere", async () => {
    await act(async () => store().startTour("game-achievements"));
    await showPage();
    await act(async () => store().goToTourStep(indexOf("ladders"), true));
    expect(tabNamed("Game ladders").getAttribute("aria-selected")).toBe("true");
    expect(findTourElement(step("ladders").anchor!)).toBeTruthy();
    // And back: the tab step starts on Milestones, so it does not bounce.
    await act(async () => store().goToTourStep(indexOf("tabs"), true));
    expect(tabNamed("Milestones").getAttribute("aria-selected")).toBe("true");
    expect(stepId()).toBe("tabs");
  });

  it("shows the player's own page again when the guide ends", async () => {
    await act(async () => store().startTour("game-achievements"));
    await showPage();
    await act(async () => store().endTour("dismissed"));
    await click(tabNamed("Game ladders"));
    expect(container.textContent).toContain("No game trophies yet");
    expect(tabNamed("Game ladders").textContent).toMatch(/ladders0\/0/);
  });

  it("offers “Show me how” under “No game trophies yet”, which starts this guide", async () => {
    await showPage();
    await click(tabNamed("Game ladders"));
    const link = container.querySelector<HTMLElement>(
      '[data-guide-link="game-achievements"]',
    );
    expect(link?.textContent).toBe("Show me how");
    const panel = container.querySelector("#achievements-panel-games")!;
    expect(panel.textContent).toContain("No game trophies yet");
    expect(panel.contains(link)).toBe(true);
    await click(link);
    expect(store().activeTour?.tourId).toBe("game-achievements");
    expect(store().activeView).toBe("achievements");
  });
});

describe("a game's own achievements in the sample Details", () => {
  const sampleSources = () =>
    achievementSources({
      kind: "tour-demo",
      gameId: TOUR_DEMO_GAME.gameId,
      libraryImports: [],
    });
  async function showTab(id: string) {
    await act(async () => {
      root.render(
        <>
          <GameAchievementsTab sources={sampleSources()} />
          <TourOverlay />
        </>,
      );
      store().startTour("game-achievements");
    });
    await act(async () => store().goToTourStep(indexOf(id)));
  }
  const sort = () =>
    container.querySelector<HTMLSelectElement>(
      'select[aria-label="Sort achievements"]',
    )!;

  it("makes the sample card offer “Achievements”: the sample has one launcher's list", () => {
    expect(sampleSources()).toHaveLength(1);
    // A real game without a launcher entry still has none.
    expect(achievementSources({ libraryImports: [] })).toEqual([]);
  });

  it("finishes “sort” when the player changes the sort, not when they filter", async () => {
    await showTab("sort");
    expect(findTourElement(step("sort").anchor!)).toBe(sort());
    expect(
      findTourElement(step("sort").additionalAnchors![0])?.textContent,
    ).toContain("Unlocked");
    await click(
      [...container.querySelectorAll("button")].find((entry) =>
        entry.textContent?.startsWith("Locked"),
      ),
    );
    expect(stepId()).toBe("sort");
    await act(async () => {
      sort().value = "rarest";
      sort().dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(stepId()).toBe(guide().steps[indexOf("sort") + 1].id);
  });

  it("shows “Sign in again” in its own step only, and signing in there opens nothing", async () => {
    await showTab("sort");
    expect(container.textContent).not.toContain("needs you to sign in again");
    expect(buttonNamed("Sign in again", container)).toBeUndefined();
    expect(buttonNamed("Refresh", container)).toBeTruthy();

    await act(async () => store().goToTourStep(indexOf("sign-in")));
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(
      /needs you to sign in again\.$/,
    );
    const button = buttonNamed("Sign in again", container)!;
    expect(findTourElement(step("sign-in").anchor!)).toBe(button);
    expect(bold(step("sign-in").task)).toEqual(["Sign in again"]);
    await click(button);
    expect(stepId()).toBe("finish");
    expect(invokeMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("needs you to sign in again");

    // Back on the step, it asks again.
    await act(async () => store().goToTourStep(indexOf("sign-in"), true));
    expect(buttonNamed("Sign in again", container)).toBeTruthy();
  });

  it("names a launcher that has achievements on this computer", async () => {
    await showTab("sort");
    expect(container.textContent).toMatch(/From GOG, updated \d/);
    await act(async () => root.render(null));
    platform.value = "linux";
    await act(async () => {
      root.render(<GameAchievementsTab sources={sampleSources()} />);
    });
    expect(container.textContent).toContain("From Steam on this PC");
    expect(container.textContent).not.toContain("GOG");
  });
});
