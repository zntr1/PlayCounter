// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../../store";
import * as tracker from "../../../tracker";
import { LibraryTestShell } from "../../views/libraryTestShell";
import { findTour } from "../tourDefinitions";
import { TourOverlay } from "../TourUI";
import { boldNames as bold, expectStepRules } from "./guideRules.test.kit";
import { NEXT_RELEASE } from "./shared";

vi.mock("../../../tracker");
vi.mock("../../../platform", () => ({ currentPlatform: () => "windows" }));
vi.mock("../../../gameDetails", () => ({
  useGameDetails: () => ({ status: "empty" }),
}));

/* "Custom games" (Phil, 2026-11-13): when adding a game as custom helps,
   where one is made, and what its card's Matching menu offers: Change Game…,
   Suggest to Community, Check for Matches. The sample is a custom game. */

const guide = () => findTour("custom-games")!;
const step = (id: string) => guide().steps.find((entry) => entry.id === id)!;
const index = (id: string) =>
  guide().steps.findIndex((entry) => entry.id === id);
const a = (name: string) => `[data-tour="${name}"]`;

describe("the guide's steps", () => {
  it("go from when it helps to the card's Matching menu", () => {
    expect(guide().steps.map((entry) => entry.id)).toEqual([
      "intro",
      "when",
      "where",
      "change-game",
      "suggest",
      "check-matches",
      "finish",
    ]);
    expect(guide().release).toBe(NEXT_RELEASE);
    expect(guide().category).toBe("detection");
    expect(guide().demoGame).toBe(true);
  });

  it("follow the rules of every guide", () => {
    expectStepRules(guide());
  });

  it("say when adding as custom is useful", () => {
    const body = step("when").body;
    for (const use of ["mod", "private build", "prototype", "no database"])
      expect(body).toContain(use);
  });

  it("name where a custom game is made", () => {
    expect(bold(step("where").body)).toEqual([
      "Discovered",
      "Add as Custom",
      "Convert to Custom Game",
      "Matching",
    ]);
  });

  it("practise Change Game…, Suggest to Community and Check for Matches", () => {
    expect(bold(step("change-game").task!)).toEqual([
      "Matching",
      "Change Game…",
    ]);
    expect(bold(step("suggest").task!)).toEqual([
      "Matching",
      "Suggest to Community",
    ]);
    expect(bold(step("check-matches").task!)).toContain("Check for Matches");
    for (const id of ["change-game", "suggest", "check-matches"])
      expect(step(id).advanceOn, id).toEqual({
        type: "event",
        name: "demo.step-completed",
      });
  });

  it("is offered after the badges guide, which shows the Custom badge", () => {
    expect(findTour("source-badges")!.nextTourId).toBe("custom-games");
    expect(guide().nextTourId).toBeUndefined();
  });
});

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.reject(new Error("no network in a guide"))),
  );
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
  vi.clearAllMocks();
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

async function clickText(scope: string, text: string) {
  const button = [
    ...find(scope)!.querySelectorAll<HTMLButtonElement>("button"),
  ].find((entry) => entry.textContent?.includes(text));
  expect(button, `missing ${text}`).toBeDefined();
  await act(async () => button!.click());
}

async function start(at: string) {
  await act(async () => {
    useAppStore.getState().startTour("custom-games");
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
  it("shows a custom sample, with Change Game… and Suggest to Community", async () => {
    await start("change-game");
    await click(a("demo-menu-matching"));
    expect(find(a("demo-menu-change-game"))).not.toBeNull();
    expect(find(a("demo-menu-suggest-community"))).not.toBeNull();
    expect(find(a("demo-menu-check-matches"))).not.toBeNull();
  });

  it("finishes Change Game… once a game is picked and confirmed", async () => {
    await start("change-game");
    await click(a("demo-menu-matching"));
    await click(a("demo-menu-change-game"));
    await clickText(a("demo-sample-search"), "Diablo IV");
    await clickText(a("demo-sample-search"), "Confirm sample match");
    await wait(200);
    expect(stepNow()).toBe("suggest");
    expect(tracker.linkGameFileByHand).not.toHaveBeenCalled();
  });

  it("finishes Suggest to Community and sends nothing", async () => {
    await start("suggest");
    await click(a("demo-menu-matching"));
    await click(a("demo-menu-suggest-community"));
    await clickText(a("demo-sample-search"), "Diablo IV");
    await clickText(a("demo-sample-search"), "Confirm sample match");
    await wait(200);
    expect(stepNow()).toBe("check-matches");
  });

  it("finishes Check for Matches once the IGDB match is used", async () => {
    await start("check-matches");
    await click(a("demo-menu-matching"));
    await click(a("demo-menu-check-matches"));
    const dialog = find(a("demo-match-check-dialog"));
    expect(dialog, "missing the match check dialog").not.toBeNull();
    const igdb = [
      ...dialog!.querySelectorAll<HTMLButtonElement>("button[aria-pressed]"),
    ].find((button) => button.textContent?.includes("IGDB"));
    expect(igdb, "missing the IGDB match").toBeDefined();
    await act(async () => igdb!.click());
    await click(a("demo-match-check-use"));
    await wait(50);
    expect(stepNow()).toBe("finish");
  });
});
