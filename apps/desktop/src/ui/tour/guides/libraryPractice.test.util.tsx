import { readdirSync, readFileSync } from "node:fs";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { expect, vi } from "vitest";
import { useAppStore } from "../../../store";
import { LibraryTourPractice } from "../LibraryTourPractice";
import { TourOverlay } from "../TourUI";
import { findTour } from "../tourDefinitions";
import { findTourTarget } from "../tourTargetRect";
import type { TourDefinition } from "../tourTypes";
import { NEXT_RELEASE } from "./shared";

/* Shared by the tests of the four practice-library guides: the practice
   library mounted next to the guide, and the rules every step keeps
   (docs/tours-plan.md, section 2). Not a test file itself. */

export const WOW = -1;
export const GTA = -2;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function Harness() {
  const active = useAppStore((s) => s.activeTour);
  const tour = active ? findTour(active.tourId) : undefined;
  return (
    <>
      {active && tour?.practice ? (
        <LibraryTourPractice
          key={tour.id}
          tourId={tour.id}
          stepId={tour.steps[active.stepIndex].id}
        />
      ) : null}
      <TourOverlay />
    </>
  );
}

/** Call in beforeEach. The practice waits 700 ms before it reports a finished
 *  exercise, so setTimeout is faked: `finishStep()` runs that wait. */
export function mountPractice() {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => {});
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  localStorage.clear();
  useAppStore.setState(useAppStore.getInitialState(), true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
}

/** Call in afterEach. */
export async function unmountPractice() {
  await act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
}

async function frame() {
  await act(
    () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
  );
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

export function q<T extends HTMLElement = HTMLElement>(name: string) {
  const element = document.querySelector<T>(`[data-tour="${name}"]`);
  expect(element, name).not.toBeNull();
  return element!;
}

export const has = (name: string) =>
  document.querySelector(`[data-tour="${name}"]`) !== null;

export function card(gameId: number) {
  const element = document.querySelector<HTMLElement>(
    `[data-tour="demo-game-card"][data-tour-game-id="${gameId}"]`,
  );
  expect(element, `card ${gameId}`).not.toBeNull();
  return element!;
}

/** The sample cards in the order they show. */
export const cardIds = () =>
  [...document.querySelectorAll('[data-tour="demo-game-card"]')].map((entry) =>
    Number(entry.getAttribute("data-tour-game-id")),
  );

export async function click(element: Element) {
  await act(() => (element as HTMLElement).click());
}

export async function rightClick(element: Element) {
  await act(() =>
    element.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 10,
        clientY: 10,
      }),
    ),
  );
}

export async function type(element: Element, value: string) {
  const input = element as HTMLInputElement | HTMLTextAreaElement;
  await act(() => {
    Object.getOwnPropertyDescriptor(
      input instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

export async function press(element: Element, key: string) {
  await act(() =>
    element.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
    ),
  );
}

/** Lets the practice report a finished exercise (it waits 700 ms). */
export async function finishStep(ms = 800) {
  await act(() => vi.advanceTimersByTime(ms));
}

/** Real time, for the guide's own 100 ms check for an opened menu or dialog. */
export async function wait(ms: number) {
  await act(
    () =>
      new Promise<void>((resolve) => {
        const timer = setInterval(() => {
          clearInterval(timer);
          resolve();
        }, ms);
      }),
  );
}

/** The text a switch or checkbox is labelled with. */
export function labelOf(input: Element) {
  return (
    document.querySelector(`label[for="${input.id}"]`)?.textContent?.trim() ??
    input.closest("label")?.textContent?.trim() ??
    null
  );
}

/* Rules ────────────────────────────────────────────────────────────────── */

// Tests run from apps/desktop.
const enDir = "src/locales/en";
let englishTexts: Set<string> | null = null;
function english() {
  englishTexts ??= new Set(
    readdirSync(enDir)
      .filter((file) => file.endsWith(".json"))
      .flatMap((file) =>
        Object.values(
          JSON.parse(readFileSync(`${enDir}/${file}`, "utf8")) as Record<
            string,
            string
          >,
        ),
      ),
  );
  return englishTexts;
}

const bold = (text: string) =>
  [...text.matchAll(/<b>([\s\S]*?)<\/b>/g)].map((match) => match[1]);

// A ring on these frames instead of points.
const WHOLE_AREAS = [
  "demo-library-stage",
  "demo-library-cards",
  "demo-organization",
  "demo-popup-preview",
  "demo-journal",
];

/** Everything in `tour` that breaks the rules for a step. `composed` lists
 *  bold labels the app builds from two texts ("Sort: Tier"). */
export function guideProblems(
  tour: TourDefinition,
  {
    version,
    maxSteps = 9,
    composed = [],
    release = NEXT_RELEASE,
  }: {
    version: number;
    maxSteps?: number;
    composed?: string[];
    release?: string;
  },
) {
  const problems: string[] = [];
  const say = (step: string, problem: string) =>
    problems.push(`${tour.id}/${step}: ${problem}`);
  if (tour.version !== version) say("-", `version is ${tour.version}`);
  if (tour.release !== release) say("-", `release is ${tour.release}`);
  if (tour.steps.length < 4 || tour.steps.length > maxSteps)
    say("-", `${tour.steps.length} steps`);
  tour.steps.forEach((step, index) => {
    const first = index === 0;
    const last = index === tour.steps.length - 1;
    if (step.title.length > 40) say(step.id, `title has ${step.title.length}`);
    if (step.body.length > 220) say(step.id, `body has ${step.body.length}`);
    if ((step.task?.length ?? 0) > 160)
      say(step.id, `task has ${step.task!.length}`);
    for (const label of bold(`${step.body} ${step.task ?? ""}`))
      if (!english().has(label) && !composed.includes(label))
        say(step.id, `"${label}" is no label of the app`);
    // An action is a task, and a task finishes by itself.
    if (step.interactive && !step.task) say(step.id, "action without a task");
    if (step.task) {
      if (!step.interactive) say(step.id, "task but not interactive");
      if (!step.allow?.length) say(step.id, "task without allow");
      if (!step.advanceOn) say(step.id, "task that never finishes by itself");
    }
    // Something specific is ringed on every step, the first one included.
    if (!step.anchor) say(step.id, "no ring");
    for (const selector of [step.anchor, ...(step.additionalAnchors ?? [])])
      if (WHOLE_AREAS.some((name) => selector === `[data-tour="${name}"]`))
        say(step.id, `rings the whole ${selector}`);
    // Said once, in the first step.
    const sample = /nothing[^.]*\bsaved\b/i.test(step.body);
    if (first && !sample) say(step.id, "does not say that nothing is saved");
    if (!first && sample) say(step.id, "repeats that nothing is saved");
    if (last && step.interactive) say(step.id, "last step asks for an action");
  });
  return problems;
}
