// @vitest-environment happy-dom
import { Star, Trophy } from "lucide-react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../store";
import { TourCard, type TourCardProps } from "./TourCard";
import { emitTourEvent, TourOverlay, tourDoneFlash } from "./TourUI";
import type { TourDefinition } from "./tourTypes";

/* The step card Phil picked (docs/tours-plan.md, section 5): the guide's
   steps as a checklist, the current one open; a task in a "Your turn" box
   that turns into "Done"; the last step offers the next guide. */

vi.mock("../../tracker");
vi.mock("../../platform", () => ({ currentPlatform: () => "windows" }));

// i18n-exempt: sample guides for the tests
const shelves: TourDefinition = {
  id: "test-shelves",
  version: 1,
  kind: "guide",
  category: "library",
  icon: Star,
  title: "Favorites & shelves",
  description: "Sample",
  duration: "3 min",
  finishView: "games",
  nextTourId: "test-next",
  steps: [
    {
      id: "intro",
      view: "keep",
      title: "Make a library that fits you",
      body: "<b>Favorites</b> keep the games you play most close.",
    },
    {
      id: "shelf",
      view: "keep",
      title: "Put games on your shelf",
      body: "A game can sit on several shelves at once.",
      task: "Right-click a card, open <b>Shelves</b> and press <kbd>Enter</kbd>.",
      anchor: '[data-tour="demo-sample"]',
      allow: ['[data-tour="demo-sample"]'],
      interactive: true,
      manualAdvance: true,
      advanceOn: { type: "event", name: "demo.step-completed" },
    },
    {
      id: "windows-only",
      view: "keep",
      title: "Only on some computers",
      body: "Hidden when its control is missing.",
      anchor: '[data-tour="not-on-this-pc"]',
      optional: true,
    },
    {
      id: "finish",
      view: "keep",
      title: "Your shelves are ready",
      body: "My Games keeps your shelf when you come back.",
    },
  ],
};
const nextGuide: TourDefinition = {
  id: "test-next",
  version: 1,
  kind: "guide",
  category: "library",
  icon: Trophy,
  title: "Progress & card layout",
  description: "Sample",
  duration: "2 min",
  steps: [{ id: "only", view: "keep", title: "One step", body: "Read only." }],
};

vi.mock("./tourDefinitions", async (importOriginal) => {
  const original = await importOriginal<typeof import("./tourDefinitions")>();
  return {
    ...original,
    tours: () => [shelves, nextGuide],
    findTour: (id: string) =>
      [shelves, nextGuide].find((tour) => tour.id === id),
  };
});

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => {});
  useAppStore.setState(useAppStore.getInitialState(), true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const calls = () => ({
  onBack: vi.fn(),
  onNext: vi.fn(),
  onSkip: vi.fn(),
  onExit: vi.fn(),
  onJump: vi.fn(),
  onShowStep: vi.fn(),
  onStartNext: vi.fn(),
  onMoreGuides: vi.fn(),
  onFinish: vi.fn(),
});

async function showCard(props: Partial<TourCardProps> = {}) {
  const handlers = calls();
  await act(async () =>
    root.render(
      <TourCard
        tour={shelves}
        stepIndex={0}
        // The optional step's control is missing on this computer.
        visibleSteps={[0, 1, 3]}
        done={false}
        skippedSteps={new Set()}
        missing={false}
        outcome={null}
        cardRef={{ current: null }}
        outcomeRef={{ current: null }}
        {...handlers}
        {...props}
      />,
    ),
  );
  return handlers;
}

const card = () => document.querySelector<HTMLElement>("[data-tour-card]")!;
const button = (name: string) =>
  [...card().querySelectorAll<HTMLButtonElement>("button")].find(
    (element) => element.textContent?.trim() === name,
  );
const stepRows = () => [...card().querySelectorAll<HTMLElement>(".tour-step")];
const row = (title: string) =>
  stepRows().find((element) => element.textContent?.includes(title))!;

describe("the checklist", () => {
  it("lists every step this computer can show and opens only the current one", async () => {
    await showCard({ stepIndex: 1 });
    expect(stepRows().map((element) => element.dataset.state)).toEqual([
      "was",
      "now",
      "next",
    ]);
    expect(card().textContent).toContain("Make a library that fits you");
    expect(card().textContent).toContain("Your shelves are ready");
    expect(card().textContent).not.toContain("Only on some computers");
    // Only the open step shows its text.
    expect(card().textContent).toContain("A game can sit on several shelves");
    expect(card().textContent).not.toContain("keep the games you play most");
    expect(card().textContent).not.toContain("My Games keeps your shelf");
  });

  it("counts the steps it shows, not the hidden one", async () => {
    await showCard({ stepIndex: 3 });
    expect(card().textContent).toContain("3 / 3");
    const bar = card().querySelector('[role="progressbar"]')!;
    expect(bar.getAttribute("aria-valuenow")).toBe("3");
    expect(bar.getAttribute("aria-valuemax")).toBe("3");
  });

  it("jumps back to a finished step from its title, and to no step ahead", async () => {
    const handlers = await showCard({ stepIndex: 1 });
    await act(async () => button("Make a library that fits you")!.click());
    expect(handlers.onJump).toHaveBeenCalledWith(0);
    // A step that is still ahead is plain text.
    expect(button("Your shelves are ready")).toBeUndefined();
  });

  it("ticks a finished step, but not an exercise that was stepped over", async () => {
    await showCard({ stepIndex: 3, skippedSteps: new Set([1]) });
    const tick = (title: string) =>
      row(title).querySelector(".tour-step-dot")!.className.includes("success");
    expect(tick("Make a library that fits you")).toBe(true);
    expect(tick("Put games on your shelf")).toBe(false);
    expect(card().textContent).toContain("You skipped an exercise");
  });
});

describe("a step's text", () => {
  it("shows the name of a control in bold and a key as a key", async () => {
    await showCard({ stepIndex: 1 });
    const task = card().querySelector('[data-tour-task="open"]')!;
    expect(task.textContent).toContain("Your turn");
    expect(task.querySelector("strong")?.textContent).toBe("Shelves");
    expect(task.querySelector("kbd")?.textContent).toBe("Enter");
    expect(task.textContent).not.toContain("<b>");
  });

  it("keeps other markup as plain text", async () => {
    const tour = {
      ...shelves,
      steps: [
        {
          ...shelves.steps[0],
          body: 'Watch <i>out</i> <img src="x" onerror="boom()"> here.',
        },
        ...shelves.steps.slice(1),
      ],
    };
    await showCard({ tour });
    expect(card().querySelector("img")).toBeNull();
    expect(card().querySelector("i")).toBeNull();
    expect(card().textContent).toContain('<img src="x" onerror="boom()">');
  });
});

describe("the buttons", () => {
  it("offers Next on a step without a task, and no Back on the first step", async () => {
    const handlers = await showCard({ stepIndex: 0 });
    expect(button("Back")!.disabled).toBe(true);
    expect(button("Skip step")).toBeUndefined();
    await act(async () => button("Next")!.click());
    expect(handlers.onNext).toHaveBeenCalledTimes(1);
  });

  it("offers Skip step, not Next, while a task is open", async () => {
    const handlers = await showCard({ stepIndex: 1 });
    expect(button("Next")).toBeUndefined();
    await act(async () => button("Skip step")!.click());
    expect(handlers.onSkip).toHaveBeenCalledTimes(1);
    expect(button("Back")!.disabled).toBe(false);
  });

  it("turns the task into Done with what happened, and offers nothing to skip", async () => {
    await showCard({
      stepIndex: 1,
      done: true,
      outcome: "World of Warcraft is on your shelf.",
    });
    const task = card().querySelector('[data-tour-task="done"]')!;
    expect(task.textContent).toContain("Done");
    expect(task.textContent).toContain("World of Warcraft is on your shelf.");
    expect(task.textContent).not.toContain("Your turn");
    expect(button("Skip step")).toBeUndefined();
    expect(button("Next")).toBeUndefined();
  });
});

describe("the last step", () => {
  it("offers the next guide, more guides and the page the guide was about", async () => {
    const handlers = await showCard({ stepIndex: 3 });
    expect(card().textContent).toContain("Next up");
    expect(card().textContent).toContain("Progress & card layout");
    expect(row("Your shelves are ready").textContent).not.toContain("Hands-on");
    await act(async () => button("Start")!.click());
    expect(handlers.onStartNext).toHaveBeenCalledTimes(1);
    await act(async () => button("More guides")!.click());
    expect(handlers.onMoreGuides).toHaveBeenCalledTimes(1);
    await act(async () => button("Open My Games")!.click());
    expect(handlers.onFinish).toHaveBeenCalledTimes(1);
    expect(button("Next")).toBeUndefined();
  });

  it("keeps More guides and the page button together, apart from Back", async () => {
    // A long language wraps the pair below Back as one, never one button
    // alone on a row.
    await showCard({ stepIndex: 3 });
    const pair = button("More guides")!.parentElement!;
    expect(pair).toBe(button("Open My Games")!.parentElement);
    expect(pair.contains(button("Back")!)).toBe(false);
  });

  it("says Finish when the guide ends where it started", async () => {
    await showCard({
      tour: { ...shelves, finishView: undefined, nextTourId: undefined },
      stepIndex: 3,
    });
    expect(button("Finish")).toBeTruthy();
    expect(card().textContent).not.toContain("Next up");
  });
});

describe("the head", () => {
  it("shows the title and how long the guide takes, no Hands-on mark", async () => {
    // Favorites & shelves has exercises.
    await showCard();
    const head = card().querySelector(".tour-card-head")!;
    expect(head.textContent).toContain("Favorites & shelves");
    expect(head.textContent).toContain("3 min");
    expect(head.textContent).not.toContain("Hands-on");
  });
});

describe("a running guide", () => {
  async function startGuide() {
    await act(async () => {
      root.render(
        <>
          <div data-tour="demo-sample" />
          <TourOverlay />
        </>,
      );
      useAppStore.getState().startTour("test-shelves");
    });
    await act(async () => useAppStore.getState().goToTourStep(1));
  }
  const stepIndex = () => useAppStore.getState().activeTour?.stepIndex;

  it("moves on by itself when the task is done, and shows Done for a moment", async () => {
    vi.useFakeTimers();
    const before = tourDoneFlash.ms;
    tourDoneFlash.ms = 900;
    try {
      await startGuide();
      await act(async () =>
        emitTourEvent("demo.step-completed", "Shelf filled."),
      );
      // The guide is on the last step at once (the optional one is skipped)…
      expect(stepIndex()).toBe(3);
      // …while the card still shows the finished task.
      const task = card().querySelector('[data-tour-task="done"]')!;
      expect(task.textContent).toContain("Shelf filled.");
      expect(card().textContent).not.toContain("My Games keeps your shelf");

      await act(async () => {
        vi.advanceTimersByTime(900);
      });
      expect(card().querySelector("[data-tour-task]")).toBeNull();
      expect(card().textContent).toContain("My Games keeps your shelf");
    } finally {
      tourDoneFlash.ms = before;
    }
  });

  it("remembers an exercise that was stepped over until it is done after all", async () => {
    await startGuide();
    await act(async () => button("Skip step")!.click());
    expect(stepIndex()).toBe(3);
    expect(card().textContent).toContain("You skipped an exercise");

    // Back to the exercise through the list, and do it this time.
    await act(async () => button("Put games on your shelf")!.click());
    expect(stepIndex()).toBe(1);
    await act(async () => emitTourEvent("demo.step-completed"));
    expect(stepIndex()).toBe(3);
    expect(card().textContent).not.toContain("You skipped an exercise");
  });

  it("starts the next guide from the last step and records this one as finished", async () => {
    await startGuide();
    await act(async () => useAppStore.getState().goToTourStep(3));
    await act(async () => button("Start")!.click());
    expect(useAppStore.getState().activeTour?.tourId).toBe("test-next");
    expect(useAppStore.getState().tourProgress.completed["test-shelves"]).toBe(
      1,
    );
  });
});
