// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../../store";
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

/* "Launch games directly" (docs/tours-plan.md, WP4): the settings as switches,
   Play on the sample, the launch-file entries as the menu shows them, how Play
   starts each kind of game, Stop, controller and keyboard. */

const guide = () => findTour("launch-games")!;
const step = (id: string) => guide().steps.find((entry) => entry.id === id)!;
const index = (id: string) =>
  guide().steps.findIndex((entry) => entry.id === id);
const a = (name: string) => `[data-tour="${name}"]`;
const text = (id: string) =>
  `${step(id).title} ${step(id).body} ${step(id).task ?? ""}`;

describe("the guide's steps", () => {
  it("are nine at most and in this order", () => {
    expect(guide().steps.map((entry) => entry.id)).toEqual([
      "intro",
      "enable",
      "play",
      "launch-file",
      "starts",
      "running",
      "uninstalled",
      "controller",
      "keyboard",
    ]);
    expect(guide().version).toBe(5);
    expect(guide().release).toBe(NEXT_RELEASE);
    expect(guide().demoGame).toBe(true);
  });

  it("follow the rules of every guide", () => {
    expectStepRules(guide());
  });

  it("call the settings switches, not checkboxes, and use no jargon", () => {
    for (const entry of guide().steps)
      expect(text(entry.id), entry.id).not.toMatch(
        /checkbox|prerequisite|prerequisites/i,
      );
  });

  it("ring the settings row, not the bare switch", () => {
    expect(step("enable").anchor).toBe(a("settings-row-gameLaunching"));
    expect(step("controller").anchor).toBe(
      a("settings-row-controllerNavigation"),
    );
    expect(step("running").anchor).toBe(a("settings-row-hideToTray"));
    for (const entry of guide().steps)
      expect(entry.anchor, entry.id).not.toBe(a("settings-launch-direct"));
  });

  it("ask for Play on the sample and finish when it was pressed", () => {
    expect(bold(step("play").task!)).toEqual(["Play"]);
    expect(step("play").advanceOn).toEqual({
      type: "event",
      name: "mygames.demo-launch-attempted",
    });
    expect(step("play").anchorTargets).toContain(a("demo-launch-play"));
  });

  it("name the launch-file entries as the real menu does, and say to right-click first", () => {
    const entry = step("launch-file");
    expect(bold(entry.body)).toEqual([
      "Launch options",
      "Change launch file…",
      "Set launch file…",
      "Open in Explorer",
      "Forget launch file",
    ]);
    expect(`${entry.body} ${entry.task}`).toMatch(/right-click/i);
    expect(entry.anchorTargets).toContain(a("demo-menu-launch-file"));
    expect(entry.anchorTargets).toContain(a("demo-menu-launch-options"));
    expect(entry.advanceOn).toEqual({
      type: "event",
      name: "demo.action-completed",
    });
  });

  it("say how Play starts each kind of game", () => {
    const body = step("starts").body;
    expect(body).toMatch(/Xbox/);
    expect(body).toMatch(/launch file/);
    expect(body).toMatch(/Steam/);
    expect(body).toMatch(/Epic Games/);
    expect(body).toMatch(/until PlayCounter has seen them run/);
    expect(body).toMatch(/GOG/);
    expect(body).toMatch(/Battle\.net/);
  });

  it("teach Stop and hide to tray, which is on by default", () => {
    expect(bold(step("running").body)).toEqual([
      "Stop",
      "Hide to tray when a game starts",
    ]);
    expect(step("running").body).toMatch(/default/);
  });

  it("describe the controller chord as it works: held two seconds, Create on PlayStation", () => {
    const body = step("controller").body;
    expect(body).toMatch(/two seconds/);
    expect(body).toMatch(/Create/);
    expect(body).not.toMatch(/a few seconds|release/i);
  });

  it("end on the keyboard and fullscreen, in the real app", () => {
    const last = step("keyboard");
    expect(last.body).toMatch(/Enter/);
    expect(last.body).toMatch(/arrow keys/i);
    expect(last.body).toMatch(/F11/);
    expect(last.body).toMatch(/fullscreen/i);
  });
});

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
    useAppStore.getState().startTour("launch-games");
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
  it("finishes the Play step by itself once the sample's Play was pressed", async () => {
    await start("play");
    expect(stepNow()).toBe("play");
    await click(a("demo-launch-play"));
    await wait(3000);
    expect(stepNow()).toBe("launch-file");
  });

  it("finishes the launch-file step once a sample file is chosen", async () => {
    await start("launch-file");
    // The step opened Launch options itself.
    expect(find(a("demo-menu-launch-file"))).not.toBeNull();
    await click(a("demo-menu-launch-file"));
    await clickButton("Use sample Wow.exe", a("demo-game-action-dialog"));
    await wait(50);
    expect(stepNow()).toBe("starts");
  });
});
