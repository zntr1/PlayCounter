// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../../store";
import { LibraryTestShell } from "../../views/libraryTestShell";
import { findTour } from "../tourDefinitions";
import { backStepIndex } from "../tourNavigation";
import { TourOverlay } from "../TourUI";
import { boldNames as bold, expectStepRules } from "./guideRules.test.kit";

vi.mock("../../../tracker");
vi.mock("../../../platform", () => ({ currentPlatform: () => "windows" }));

/* "Log missed playtime" (docs/tours-plan.md, WP4): the menu chain to the
   dialog, the clock button on the cover, Start timer, and the total. */

const guide = () => findTour("log-playtime")!;
const step = (id: string) => guide().steps.find((entry) => entry.id === id)!;
const index = (id: string) =>
  guide().steps.findIndex((entry) => entry.id === id);
const a = (name: string) => `[data-tour="${name}"]`;

describe("the guide's steps", () => {
  it("keep the menu chain and add the clock button, the timer and the total", () => {
    expect(guide().steps.map((entry) => entry.id)).toEqual([
      "intro",
      "open-menu",
      "open-playtime",
      "pick-item",
      "fill-dialog",
      "result",
      "clock",
      "timer",
      "total",
      "finish",
    ]);
    expect(guide().version).toBe(5);
    expect(guide().release).toBeUndefined();
  });

  it("follow the rules of every guide", () => {
    // Step count, text lengths, the app's own names for controls, one ring
    // per step, the sample said once, a last step for reading. Ten steps:
    // the total is an exercise of its own before the last step.
    expectStepRules(guide(), { maxSteps: 10 });
  });

  it("keep the chain's way back: closing a stage returns to the one before", () => {
    const steps = guide().steps;
    const backFrom = (id: string) =>
      steps[backStepIndex(steps, index(id), () => true)].id;
    expect(step("open-playtime").retreatWhenMissing).toBe(
      a("demo-context-menu"),
    );
    expect(backFrom("open-playtime")).toBe("open-menu");
    expect(step("pick-item").retreatWhenMissing).toBe(a("demo-playtime-menu"));
    expect(backFrom("pick-item")).toBe("open-playtime");
    expect(step("fill-dialog").retreatWhenMissing).toBe(
      a("demo-log-session-dialog"),
    );
    expect(backFrom("fill-dialog")).toBe("open-menu");
    // A skipped stage skips the rest of the chain, which builds on it.
    for (const id of ["open-menu", "open-playtime", "pick-item", "fill-dialog"])
      expect(step(id).skipTo, id).toBe("clock");
  });

  it("ring the confirm button in the dialog step, with the dialog's own backdrop", () => {
    expect(step("fill-dialog").anchor).toBe(a("demo-log-session-confirm"));
    expect(step("fill-dialog").ownBackdrop).toBe(true);
    expect(step("fill-dialog").advanceOn).toEqual({
      type: "event",
      name: "mygames.demo-session-logged",
    });
    expect(bold(step("fill-dialog").task!)).toEqual(["Log session"]);
  });

  it("teach the clock button, Start timer and Adjust total playtime", () => {
    expect(step("clock").anchor).toBe(a("demo-card-log-session"));
    expect(step("clock").body).toMatch(/clock button/);
    expect(bold(step("timer").body)).toEqual(["Start timer", "Now Playing"]);
    expect(step("timer").body).toMatch(/restarts/);
    expect(bold(step("timer").task!)).toEqual(["Playtime", "Start timer"]);
    expect(bold(step("total").body)).toContain("Adjust total playtime");
  });

  it("make Adjust total playtime an exercise that ends when the total is saved", () => {
    expect(bold(step("total").task!)).toEqual([
      "Playtime",
      "Adjust total playtime",
      "Save total",
    ]);
    expect(step("total").advanceOn).toEqual({
      type: "event",
      name: "demo.step-completed",
    });
  });

  it("say on the last step where the two ways are in the app", () => {
    const last = guide().steps.at(-1)!;
    expect(last.body).toMatch(/clock button/);
    expect(bold(last.body)).toContain("Playtime");
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

async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function start(at: string) {
  await act(async () => {
    useAppStore.getState().startTour("log-playtime");
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
  it("goes right-click → Playtime → Log missed session → dialog → result, each stage by itself", async () => {
    await start("open-menu");
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
    expect(stepNow()).toBe("open-playtime");
    await click(a("demo-menu-playtime"));
    await wait();
    expect(stepNow()).toBe("pick-item");
    await click(a("demo-menu-log-session"));
    await wait();
    expect(stepNow()).toBe("fill-dialog");
    const dialog = find(a("demo-log-session-dialog"))!;
    const confirm = find(a("demo-log-session-confirm")) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    await type(
      dialog.querySelectorAll<HTMLInputElement>('input[type="number"]')[1],
      "30",
    );
    await click(a("demo-log-session-confirm"));
    await wait(50);
    expect(stepNow()).toBe("result");
    expect(find(a("demo-playtime-result"))!.textContent).toContain("2h 30m");
    expect(find(a("demo-playtime-result"))!.textContent).toContain(
      "4 sessions",
    );
    // Sample only: no session reached the real history.
    expect(useAppStore.getState().recentSessions).toEqual([]);
  });

  it("sets the stage of a step entered cold, whatever its number", async () => {
    // "total" moved from step 7 to step 9: a sample that opened its
    // menu on step numbers would leave this one without the menu.
    await start("total");
    expect(find(a("demo-context-menu")), "total").not.toBeNull();
    await act(async () =>
      useAppStore.getState().goToTourStep(index("pick-item"), true),
    );
    await wait();
    expect(find(a("demo-playtime-menu")), "pick-item").not.toBeNull();
    expect(stepNow()).toBe("pick-item");
    await act(async () =>
      useAppStore.getState().goToTourStep(index("fill-dialog"), true),
    );
    await wait();
    expect(find(a("demo-log-session-dialog")), "fill-dialog").not.toBeNull();
    expect(find(a("demo-context-menu"))).toBeNull();
    expect(stepNow()).toBe("fill-dialog");
  });

  it("steps back to the right-click when the dialog is cancelled", async () => {
    await start("fill-dialog");
    const cancel = [
      ...find(a("demo-log-session-dialog"))!.querySelectorAll("button"),
    ].find((button) => button.textContent?.trim() === "Cancel")!;
    await wait(350);
    await act(async () => cancel.click());
    await wait(350);
    expect(stepNow()).toBe("open-menu");
  });

  it("opens the dialog from the clock button and waits until the player closes it", async () => {
    await start("clock");
    const clock = find(a("demo-card-log-session"));
    expect(clock, "missing the clock button").not.toBeNull();
    expect(clock!.getAttribute("title")).toBe("Log missed session");
    await act(async () => clock!.click());
    // The dialog, not the menu, and it stays open: opening it is not the task.
    expect(find(a("demo-log-session-dialog"))).not.toBeNull();
    expect(find(a("demo-context-menu"))).toBeNull();
    await wait(1000);
    expect(stepNow()).toBe("clock");
    expect(find(a("demo-log-session-dialog"))).not.toBeNull();
    const cancel = [
      ...find(
        a("demo-log-session-dialog"),
      )!.querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) => button.textContent?.trim() === "Cancel");
    expect(cancel, "missing Cancel").toBeDefined();
    await act(async () => cancel!.click());
    await wait(50);
    expect(stepNow()).toBe("timer");
    // The next step puts the dialog away and opens its menu.
    await wait();
    expect(find(a("demo-log-session-dialog"))).toBeNull();
    expect(find(a("demo-menu-playtime"))).not.toBeNull();
  });

  it("starts a sample timer from Playtime, without a real session", async () => {
    await start("timer");
    await click(a("demo-menu-playtime"));
    await click(a("demo-menu-start-timer"));
    await wait(50);
    expect(stepNow()).toBe("total");
    expect(useAppStore.getState().activeSessions).toEqual([]);
  });

  it("lets Adjust total playtime change the sample's total, and moves on once it is saved", async () => {
    await start("total");
    await click(a("demo-menu-playtime"));
    await click(a("demo-menu-adjust-playtime"));
    const dialog = find(a("demo-adjust-dialog"))!;
    // Opening the dialog is not the task.
    await wait(1000);
    expect(stepNow()).toBe("total");
    await type(
      dialog.querySelectorAll<HTMLInputElement>('input[type="number"]')[0],
      "10",
    );
    await act(async () =>
      document
        .getElementById("adjust-playtime-form")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        ),
    );
    await wait(50);
    expect(find(a("demo-playtime-result"))!.textContent).toContain("10h");
    expect(useAppStore.getState().playtimeAdjustments).toEqual({});
    await wait(1500);
    expect(stepNow()).toBe("finish");
  });
});
