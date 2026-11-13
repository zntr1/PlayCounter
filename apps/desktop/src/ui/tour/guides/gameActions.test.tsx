// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../../store";
import { LibraryTestShell } from "../../views/libraryTestShell";
import { findTour } from "../tourDefinitions";
import { TourOverlay } from "../TourUI";
import { boldNames as bold, expectStepRules } from "./guideRules.test.kit";

vi.mock("../../../tracker");
vi.mock("../../../platform", () => ({ currentPlatform: () => "windows" }));
vi.mock("../../../gameDetails", () => ({
  useGameDetails: () => ({ status: "empty" }),
}));

/* "Manage a game in your library" (docs/tours-plan.md, WP4): the guide shows
   the card's right-click menu as it is, on the sample card. */

const guide = () => findTour("game-actions")!;
const step = (id: string) => guide().steps.find((entry) => entry.id === id)!;
const index = (id: string) =>
  guide().steps.findIndex((entry) => entry.id === id);
const a = (name: string) => `[data-tour="${name}"]`;

describe("the guide's steps", () => {
  it("go through the menu from top to bottom", () => {
    expect(guide().steps.map((entry) => entry.id)).toEqual([
      "intro",
      "open-menu",
      "details",
      "history",
      "playtime",
      "wrong-match",
      "remove",
    ]);
    expect(guide().version).toBe(6);
    expect(guide().release).toBeUndefined();
    expect(guide().demoGame).toBe(true);
  });

  it("follow the rules of every guide", () => {
    // Step count, text lengths, the app's own names for controls, one ring
    // per step, the sample said once, a last step for reading.
    expectStepRules(guide());
  });

  it("ring nothing on the first step, which is for reading", () => {
    expect(guide().steps[0].anchor).toBeUndefined();
  });

  it("say that the More button opens the same menu", () => {
    expect(step("open-menu").body).toContain("<b>More</b>");
    expect(step("open-menu").advanceOn).toEqual({
      type: "anchor-present",
      selector: a("demo-context-menu"),
    });
  });

  it("name only Details tabs the sample has with or without its sample data", () => {
    expect(bold(step("details").body)).toEqual([
      "General",
      "Files",
      "How long to beat",
    ]);
  });

  it("show the three Playtime entries in one step", () => {
    expect(bold(step("playtime").body)).toEqual([
      "Log missed session",
      "Adjust total playtime",
      "Start timer",
    ]);
    expect(step("playtime").task).toBeUndefined();
  });

  it("describe the report dialog as it is: what the file is, and which file", () => {
    expect(step("wrong-match").body).not.toMatch(/review of the correct game/);
    expect(step("wrong-match").body).toMatch(/what the file really is/);
    expect(step("wrong-match").body).toMatch(/which file/);
  });

  it("say that Ignore can be undone under Discovered → Ignored, and what to do on real cards", () => {
    const last = guide().steps.at(-1)!;
    expect(last.id).toBe("remove");
    expect(bold(last.body)).toEqual([
      "Remove from Library",
      "Ignore Game",
      "Discovered",
      "Ignored",
    ]);
    // For reading; Ignore and Remove can still be tried.
    expect(last.task).toBeUndefined();
    expect(last.interactive).toBe(true);
  });

  it("finish every task by itself, and Skip step only steps over that one", () => {
    const tasks = guide().steps.filter((entry) => entry.task);
    expect(tasks.map((entry) => entry.id)).toEqual([
      "open-menu",
      "details",
      "history",
      "wrong-match",
    ]);
    for (const entry of tasks) {
      expect(entry.interactive, entry.id).toBe(true);
      expect(entry.manualAdvance, entry.id).toBe(true);
      expect(entry.advanceOn, entry.id).toBeDefined();
      expect(entry.allow?.length, entry.id).toBeGreaterThan(0);
    }
  });

  it("ring one menu entry per step, never two neighbours", () => {
    for (const entry of guide().steps)
      expect(entry.additionalAnchors ?? [], entry.id).toEqual([]);
    // The entry before its flyout's trigger: first present wins.
    expect(step("remove").anchorTargets).toEqual([
      a("demo-action-result"),
      a("demo-menu-ignore"),
    ]);
  });

  it("leave custom games to a guide of their own", () => {
    // Check for Matches and Convert to Custom Game are about custom games.
    for (const entry of guide().steps)
      expect(
        `${entry.title} ${entry.body} ${entry.task ?? ""}`,
        entry.id,
      ).not.toMatch(/Check for Matches|Convert to Custom Game|custom game/i);
  });

  it("lead on to logging playtime", () => {
    expect(guide().nextTourId).toBe("log-playtime");
  });
});

/* The walk: every try-it step done the way the player would, with the guide's
   own click blocking in place. */

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(document, "elementFromPoint").mockReturnValue(null);
  vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => {});
  localStorage.clear();
  useAppStore.setState(useAppStore.getInitialState(), true);
  useAppStore.setState({ activeView: "games" });
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

const wait = (ms = 250) =>
  act(() => new Promise((resolve) => setTimeout(resolve, ms)));
const find = (selector: string) =>
  document.querySelector<HTMLElement>(selector);
const stepNow = () =>
  guide().steps[useAppStore.getState().activeTour!.stepIndex].id;

async function click(selector: string) {
  const element = find(selector);
  expect(element, `missing ${selector}`).not.toBeNull();
  await act(async () => element!.click());
}

async function clickButton(text: string, within = "body") {
  const button = [
    ...document.querySelectorAll<HTMLButtonElement>(`${within} button`),
  ].find((item) => item.textContent?.trim().includes(text));
  expect(button, `missing button ${text}`).toBeDefined();
  await act(async () => button!.click());
}

async function start(at: string) {
  await act(async () => {
    useAppStore.getState().startTour("game-actions");
    useAppStore.getState().goToTourStep(index(at));
    root.render(
      <>
        <LibraryTestShell />
        <TourOverlay />
      </>,
    );
  });
  await wait();
}

describe("the walk through the guide", () => {
  it("opens the menu on the right-click and moves on", async () => {
    await start("open-menu");
    expect(find(a("demo-context-menu"))).toBeNull();
    await act(async () =>
      find(a("demo-game-card"))!.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 10,
          clientY: 10,
        }),
      ),
    );
    await wait();
    expect(stepNow()).toBe("details");
    expect(find(a("demo-menu-details"))).not.toBeNull();
  });

  it("finishes Open Details when the dialog is closed, not when it opens", async () => {
    await start("details");
    // The step set the stage itself: the menu is open.
    await click(a("demo-menu-details"));
    expect(find(a("demo-game-details"))).not.toBeNull();
    await wait(500);
    expect(stepNow()).toBe("details");
    await click(`${a("demo-game-details")} button[aria-label="Close"]`);
    await wait(50);
    expect(stepNow()).toBe("history");
    // The next step's menu is open again.
    await wait();
    expect(find(a("demo-menu-show-history"))).not.toBeNull();
  });

  it("finishes Show History with Done", async () => {
    await start("history");
    await click(a("demo-menu-show-history"));
    expect(find(a("demo-game-action-dialog"))).not.toBeNull();
    await click(a("demo-game-action-done"));
    await wait(50);
    expect(stepNow()).toBe("playtime");
  });

  it("shows the Playtime flyout with its three entries, Start timer included", async () => {
    await start("playtime");
    const flyout = find(a("demo-playtime-menu"));
    expect(flyout, "Playtime flyout is not open").not.toBeNull();
    expect(
      [...flyout!.querySelectorAll("button")].map((button) =>
        button.textContent?.trim(),
      ),
    ).toEqual(["Log missed session", "Adjust total playtime", "Start timer"]);
  });

  it("asks what the file really is, with the five answers of the real dialog", async () => {
    await start("wrong-match");
    await click(a("demo-menu-matching"));
    await click(a("demo-menu-report-match"));
    const dialog = find(a("demo-report-dialog"))!;
    for (const answer of [
      "It's a different game",
      "It's an app, ignore it",
      "It's an app, count its time",
      "It doesn't belong to World of Warcraft",
      "It's part of the game, not the game",
    ])
      expect(dialog.textContent, answer).toContain(answer);
    await clickButton("It doesn't belong to", a("demo-report-dialog"));
    await clickButton("Remove from game", a("demo-report-dialog"));
    await wait(50);
    expect(stepNow()).toBe("remove");
    // Nothing left this PC and the sample is still there.
    expect(useAppStore.getState().rejectedGameFiles ?? []).toEqual([]);
    expect(find(a("demo-game-card"))).not.toBeNull();
  });

  it("shows on Ignore Game where it can be undone, and gives the sample back", async () => {
    await start("remove");
    await click(a("demo-menu-ignore"));
    const dialog = find(a("demo-ignore-dialog"))!;
    expect(dialog.textContent).toContain("Discovered → Ignored");
    await clickButton("Ignore game", a("demo-ignore-dialog"));
    const result = find(a("demo-action-result"))!;
    expect(result.textContent).toContain("Sample removed");
    await clickButton("Restore sample card", a("demo-action-result"));
    expect(find(a("demo-game-card"))).not.toBeNull();
  });

  it("does not bounce forward after Back: only what is done on the step counts", async () => {
    await start("history");
    await click(a("demo-menu-show-history"));
    await click(a("demo-game-action-done"));
    await wait(50);
    expect(stepNow()).toBe("playtime");
    await clickButton("Back", "[data-tour-card]");
    await wait(600);
    expect(stepNow()).toBe("history");
  });

  it("steps over one exercise with Skip step, not over the rest", async () => {
    await start("details");
    await clickButton("Skip step", "[data-tour-card]");
    await wait();
    expect(stepNow()).toBe("history");
    expect(find(a("demo-menu-show-history"))).not.toBeNull();
  });
});
