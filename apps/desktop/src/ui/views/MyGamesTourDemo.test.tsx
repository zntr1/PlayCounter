// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useAppStore } from "../../store";
import { findTour } from "../tour/tourDefinitions";
import { TourOverlay } from "../tour/TourUI";
import { LibraryTestShell } from "./libraryTestShell";

vi.mock("../../tracker");
vi.mock("../../platform", () => ({ currentPlatform: () => "windows" }));

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(document, "elementFromPoint").mockReturnValue(null);
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

const click = (selector: string) =>
  act(() => document.querySelector<HTMLElement>(selector)!.click());

it.each(["grid", "list"] as const)(
  "keeps Report Wrong Match inside the sample review in the %s layout",
  async (size) => {
    useAppStore.getState().setMyGamesCardSize(size);
    const tour = findTour("game-actions")!;
    await act(() => {
      useAppStore.getState().startTour(tour.id);
      useAppStore
        .getState()
        .goToTourStep(
          tour.steps.findIndex((step) => step.id === "wrong-match"),
        );
      root.render(<LibraryTestShell />);
    });
    await act(() =>
      document.querySelector('[data-tour="demo-game-card"]')!.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          clientX: 10,
          clientY: 10,
        }),
      ),
    );
    await click('[data-tour="demo-menu-matching"]');
    await click('[data-tour="demo-menu-report-match"]');
    const differentGame = [
      ...document.querySelectorAll<HTMLButtonElement>(
        '[data-tour="demo-report-dialog"] button',
      ),
    ].find((button) => button.textContent?.includes("different game"))!;
    await act(() => differentGame.click());
    // The bundled sample search opens, never the real community form.
    expect(
      document.querySelector('[data-tour="demo-sample-search"]'),
    ).not.toBeNull();
    expect(document.body.textContent).toContain("Choose the sample game");
    expect(document.body.textContent).not.toContain("Suggest community game");
  },
);

const launchGames = findTour("launch-games")!;
const stepIndex = (id: string) =>
  launchGames.steps.findIndex((step) => step.id === id);

async function openSampleLaunchFile() {
  await act(() =>
    document.querySelector('[data-tour="demo-game-card"]')!.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        clientX: 10,
        clientY: 10,
      }),
    ),
  );
  await click('[data-tour="demo-menu-launch-options"]');
  await click('[data-tour="demo-menu-launch-file"]');
  expect(
    document.querySelector('[data-tour="demo-game-action-dialog"]'),
  ).not.toBeNull();
}

it("closes a dialog opened on a free-practice step when Next moves to another view", async () => {
  useAppStore.getState().setLauncherSetting("gameLaunchingEnabled", true);
  await act(() => {
    useAppStore.getState().startTour(launchGames.id);
    useAppStore.getState().goToTourStep(stepIndex("set-forget"));
    root.render(<LibraryTestShell />);
  });
  await openSampleLaunchFile();
  await act(() => useAppStore.getState().goToTourStep(stepIndex("limits")));
  expect(
    document.querySelector('[data-tour="demo-game-action-dialog"]'),
  ).toBeNull();
});

it("counts closing a free-practice dialog as Next", async () => {
  vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => {});
  useAppStore.getState().setLauncherSetting("gameLaunchingEnabled", true);
  await act(() => {
    useAppStore.getState().startTour(launchGames.id);
    useAppStore.getState().goToTourStep(stepIndex("set-forget"));
    root.render(
      <>
        <LibraryTestShell />
        <TourOverlay />
      </>,
    );
  });
  await openSampleLaunchFile();
  await act(() => new Promise((resolve) => setTimeout(resolve, 250)));
  const done = [
    ...document.querySelectorAll<HTMLButtonElement>(
      '[data-tour="demo-game-action-dialog"] button',
    ),
  ].find((button) => button.textContent === "Done")!;
  await act(() => done.click());
  await act(() => new Promise((resolve) => setTimeout(resolve, 600)));
  expect(useAppStore.getState().activeTour?.stepIndex).toBe(
    stepIndex("limits"),
  );
});

it("makes Space go to the next step instead of toggling a focused control", async () => {
  vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => {});
  const field = document.createElement("input");
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  document.body.append(field, checkbox);
  await act(() => {
    useAppStore.getState().startTour(launchGames.id);
    useAppStore.getState().goToTourStep(stepIndex("enable"));
    root.render(<TourOverlay />);
  });
  const space = (target: HTMLElement) => {
    const event = new KeyboardEvent("keydown", {
      key: " ",
      bubbles: true,
      cancelable: true,
    });
    act(() => target.dispatchEvent(event));
    return event.defaultPrevented;
  };
  // A text field still takes the space.
  expect(space(field)).toBe(false);
  expect(useAppStore.getState().activeTour?.stepIndex).toBe(
    stepIndex("enable"),
  );
  expect(space(checkbox)).toBe(true);
  expect(useAppStore.getState().activeTour?.stepIndex).toBe(
    stepIndex("enable") + 1,
  );
  field.remove();
  checkbox.remove();
});
