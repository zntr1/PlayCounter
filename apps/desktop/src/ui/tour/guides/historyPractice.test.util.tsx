import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { expect, vi } from "vitest";
import { useAppStore } from "../../../store";
import { ScreenshotViewer } from "../../ScreenshotViewer";
import { HistoryView } from "../../views/HistoryView";
import { StatsPractice } from "../TourStatsPractice";
import { TourOverlay } from "../TourUI";
import { findTour } from "../tourDefinitions";
import { findTourTarget } from "../tourTargetRect";

/* Shared by the tests of the three guides on My History (stats,
   correct-history, screenshots): the sample history mounted next to the
   guide, the way App.tsx does it. Not a test file itself.

   Each test file mocks the tracker, the platform and Tauri's `invoke` itself,
   since vi.mock only works in the file it is written in. */

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function Harness() {
  const active = useAppStore((s) => s.activeTour);
  const view = useAppStore((s) => s.activeView);
  const tour = active ? findTour(active.tourId) : undefined;
  return (
    <>
      {active && tour?.simulation === "stats" ? (
        // A practice guide: its surface takes the place of every real page.
        <div key={tour.id} data-tour="demo-library-stage">
          <StatsPractice />
        </div>
      ) : view === "history" ? (
        <HistoryView />
      ) : null}
      <ScreenshotViewer />
      <TourOverlay />
    </>
  );
}

/** Call in beforeEach. */
export function mountHistory() {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => {});
  localStorage.clear();
  useAppStore.setState(useAppStore.getInitialState(), true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
}

/** Call in afterEach. */
export async function unmountHistory() {
  await act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
}

export async function frame() {
  await act(
    () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
  );
}

/** Renders the app's pages without starting a guide. */
export async function renderApp() {
  await act(() => root!.render(<Harness />));
  await frame();
}

function activeTour() {
  return findTour(useAppStore.getState().activeTour!.tourId)!;
}

export function currentStep() {
  return activeTour().steps[useAppStore.getState().activeTour!.stepIndex];
}

export const stepId = () => currentStep().id;

/** Jumps to a step the way the guide does: `back` is Back or a click on a
 *  finished step in the card's list. */
export async function goTo(id: string, back = false) {
  const index = activeTour().steps.findIndex((step) => step.id === id);
  expect(index, id).toBeGreaterThanOrEqual(0);
  await act(() => useAppStore.getState().goToTourStep(index, back));
  await frame();
}

/** Starts the guide and enters `id` directly, with nothing done before. */
export async function startGuide(tourId: string, id?: string) {
  await act(() => {
    root!.render(<Harness />);
    useAppStore.getState().startTour(tourId);
  });
  await frame();
  if (id) await goTo(id);
}

/** What the guide rings right now. */
export function target() {
  const element = findTourTarget(currentStep());
  expect(element, `nothing to ring in ${stepId()}`).not.toBeNull();
  return element!;
}

export const all = <T extends HTMLElement = HTMLElement>(selector: string) => [
  ...document.querySelectorAll<T>(selector),
];

export function q<T extends HTMLElement = HTMLElement>(selector: string) {
  const element = document.querySelector<T>(selector);
  expect(element, selector).not.toBeNull();
  return element!;
}

export const named = (name: string) => `[data-tour="${name}"]`;

export const rows = () => all("[data-history-session-row]");

export const row = (sessionId: number) =>
  q(`[data-history-session-id="${sessionId}"]`);

export async function click(element: Element) {
  await act(() => (element as HTMLElement).click());
}

export async function rightClick(element: Element) {
  await act(() =>
    element.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 40,
        clientY: 40,
      }),
    ),
  );
}

/** A button, tab or menu entry by the text it shows. */
export function control(text: string) {
  const found = all('button, [role="menuitem"], [role="tab"]').find(
    (element) => element.textContent?.trim() === text,
  );
  expect(found, `no control "${text}"`).toBeDefined();
  return found!;
}

/** Types into a field the way React hears it. */
export async function type(
  field: HTMLInputElement | HTMLTextAreaElement,
  value: string,
) {
  await act(() => {
    Object.getOwnPropertyDescriptor(
      field instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype,
      "value",
    )!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

export async function press(element: Element, key: string) {
  await act(() =>
    element.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
    ),
  );
}

/** A session of the player's own, for "the real history stays as it is". */
export const ownSession = {
  id: 42,
  gameId: 42,
  gameName: "Hollow Knight", // i18n-exempt: sample game name
  exeName: "hollow_knight.exe",
  startedAt: "2026-09-15T10:00:00Z",
  endedAt: "2026-09-15T11:00:00Z",
  durationSeconds: 3600,
};
