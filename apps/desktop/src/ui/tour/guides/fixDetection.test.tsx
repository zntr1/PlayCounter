// @vitest-environment happy-dom
/* "Fix an unrecognized game": the practice shows the real Discovered page
   (lists, review list, card) with sample apps and the real "which game is
   this" card; every exercise finishes by itself and nothing reaches the
   tracker. Discovered offers the guide when nothing waits for review. */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../../store";
import * as tracker from "../../../tracker";
import { DiscoveredView } from "../../views/DiscoveredView";
import { findTour } from "../tourDefinitions";
import { TourPracticeSurface } from "../TourPracticeSurface";
import { findTourTarget } from "../tourTargetRect";
import { TourOverlay, tourDoneFlash } from "../TourUI";
import { fixDetectionGuide } from "./fixDetection";
import {
  boldNames,
  expectStepRules,
  indexOf,
  stepOf,
} from "./guideRules.test.kit";
import { a, discoveredAction } from "./shared";

vi.mock("../../../tracker");
vi.mock("../../../platform", () => ({ currentPlatform: () => "windows" }));

const guide = fixDetectionGuide();

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
});

function Practice() {
  const active = useAppStore((state) => state.activeTour);
  const tour = active ? findTour(active.tourId) : undefined;
  return (
    <>
      {active && tour?.simulation ? (
        <TourPracticeSurface
          key={tour.id}
          tour={tour}
          stepId={tour.steps[active.stepIndex].id}
        />
      ) : null}
      <TourOverlay />
    </>
  );
}

const frame = () =>
  act(
    () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
  );

async function start(stepId: string) {
  await act(() => {
    root.render(<Practice />);
    useAppStore.getState().startTour(guide.id);
  });
  // The way the card's list jumps to a step.
  await act(() =>
    useAppStore.getState().goToTourStep(indexOf(guide, stepId), true),
  );
  await frame();
}

const currentStep = () =>
  guide.steps[useAppStore.getState().activeTour!.stepIndex].id;

const stage = () =>
  document.querySelector<HTMLElement>('[data-tour="demo-library-stage"]')!;

const one = (selector: string) => {
  const element = document.querySelector<HTMLElement>(selector);
  expect(element, selector).not.toBeNull();
  return element!;
};

const click = async (element: HTMLElement) => {
  await act(async () => element.click());
};

const buttonNamed = (name: string, within: ParentNode = document) => {
  const button = [...within.querySelectorAll<HTMLButtonElement>("button")].find(
    (candidate) => candidate.textContent?.trim() === name,
  );
  expect(button, `button "${name}"`).toBeDefined();
  return button!;
};

async function typeInto(input: HTMLInputElement, value: string) {
  await act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** Tracker functions the sample called. It must call none. */
const trackerCalls = () =>
  Object.entries(tracker)
    .filter(
      ([, value]) => vi.isMockFunction(value) && value.mock.calls.length > 0,
    )
    .map(([name]) => name);

/** The name on the review card: the app the step is about. */
const reviewedApp = () => one('[data-tour="discovered-app"] h3').textContent;

/* How the player does each exercise. */
const exercises: Record<string, () => Promise<void>> = {
  "add-share": async () => {
    await click(one('[data-tour="discovered-add-share"]'));
    const search = one('[data-tour="demo-sample-search"]');
    await click(
      [...search.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
        button.textContent?.includes("Diablo IV"),
      )!,
    );
    await click(buttonNamed("Add and share", search));
  },
  "add-custom": async () => {
    await click(one('[data-tour="discovered-add-custom"]'));
    const entry = one('[data-tour="discovered-custom-entry"]');
    await typeInto(entry.querySelector("input")!, "My modded game");
    await click(buttonNamed("Save", entry));
  },
  software: () => click(one('[data-tour="discovered-software"]')),
  ignore: () => click(one('[data-tour="discovered-ignore"]')),
  skip: () => click(one('[data-tour="discovered-skip"]')),
  ambiguous: () =>
    click(one('[data-tour="demo-ambiguous"] [aria-label^="Track "]')),
};

describe("the guide", () => {
  it("is reworked for the next release and follows the step rules", () => {
    expect(guide.version).toBe(3);
    expect(guide.release).toBeUndefined();
    expectStepRules(guide);
  });

  it("has a task for every decision the review offers, and for the picker", () => {
    expect(
      guide.steps.filter((step) => step.task).map((step) => step.id),
    ).toEqual(Object.keys(exercises));
    // Each can be stepped over without losing the ones after it.
    for (const id of Object.keys(exercises))
      expect(stepOf(guide, id).manualAdvance, id).toBe(true);
  });

  it("names the button a task is about, and rings it", () => {
    const names: Record<string, [string, string]> = {
      "add-share": ["Add & Share", "discovered-add-share"],
      "add-custom": ["Add as Custom", "discovered-add-custom"],
      software: ["Track as software", "discovered-software"],
      ignore: ["Ignore", "discovered-ignore"],
      skip: ["Skip for now", "discovered-skip"],
    };
    for (const [id, [label, target]] of Object.entries(names)) {
      const step = stepOf(guide, id);
      expect(boldNames(step.task), id).toContain(label);
      expect(step.anchor, id).toBe(`${a("demo-discovery")} ${a(target)}`);
    }
    // An open dialog or entry field wins over the button that opened it.
    expect(stepOf(guide, "add-share").anchorTargets?.[0]).toBe(
      a("demo-sample-search"),
    );
    expect(stepOf(guide, "add-custom").anchorTargets?.[0]).toBe(
      `${a("demo-discovery")} ${a("discovered-custom-entry")}`,
    );
  });

  it("names the setting that decides whether an ignored app is reported", () => {
    expect(boldNames(stepOf(guide, "ignore").body)).toContain(
      "Share apps you ignore",
    );
  });

  it("leads into the guide about software", () => {
    expect(guide.nextTourId).toBe("track-software");
    expect(findTour("track-software")).toBeDefined();
  });
});

describe("the practice page", () => {
  it("shows the three lists where the first step names them", async () => {
    await start("intro");
    const step = stepOf(guide, "intro");
    expect(boldNames(step.body)).toEqual([
      "Needs review",
      "Tracked",
      "Ignored",
    ]);
    // The first step rings nothing; the lists are on the page behind it.
    const lists = one(discoveredAction("filters"));
    expect(
      [...lists.querySelectorAll("button")].map((button) =>
        button.textContent?.replace(/\d+$/, ""),
      ),
    ).toEqual(["Needs review", "Tracked", "Ignored"]);
    // The review list beside the card, as on the real page.
    expect(
      [...stage().querySelectorAll('[role="option"]')].length,
    ).toBeGreaterThan(1);
  });

  it("teaches reading the card: name, file, folder and whether it runs", async () => {
    await start("look");
    const step = stepOf(guide, "look");
    for (const word of ["name", "file", "folder", "runs"])
      expect(step.body).toContain(word);
    // What every real card shows about an app.
    const app = findTourTarget(step)!.textContent!;
    expect(app).toContain("Diablo IV");
    expect(app).toContain("Diablo IV.exe");
    expect(app).toContain("Blizzard Entertainment");
    expect(app).toContain("Running now");
    // The folder trail and its hint are ringed with it; the buttons are not.
    expect(step.additionalAnchors).toHaveLength(1);
    const folder = one(step.additionalAnchors![0]).textContent!;
    expect(folder).toContain("Diablo IV");
    expect(folder).toContain("Probably a game");
    expect(app + folder).not.toContain("Add & Share");
  });

  it("can be entered at any step: each one finds what it rings", async () => {
    for (const step of guide.steps.slice(1)) {
      await start(step.id);
      expect(findTourTarget(step), step.id).not.toBeNull();
    }
  });

  it.each(Object.keys(exercises))(
    'finishes "%s" by itself once its task is done',
    async (id) => {
      await start(id);
      await exercises[id]();
      expect(currentStep()).toBe(guide.steps[indexOf(guide, id) + 1].id);
      expect(trackerCalls()).toEqual([]);
    },
  );

  it("opens each exercise on an app that fits it", async () => {
    await start("add-share");
    expect(reviewedApp()).toBe("Diablo IV");
    await start("software");
    expect(reviewedApp()).toBe("Blender");
    await start("ignore");
    expect(reviewedApp()).toBe("Fan Control");
  });

  it("tells the card what happened, so it can show it as done", async () => {
    tourDoneFlash.ms = 60_000;
    try {
      await start("ignore");
      await exercises.ignore();
      expect(one('[data-tour-task="done"]').textContent).toContain(
        "Sample ignored",
      );
    } finally {
      tourDoneFlash.ms = 0;
    }
  });

  it("does not bounce forward after Back, and starts the exercise over", async () => {
    await start("ignore");
    await exercises.ignore();
    expect(currentStep()).toBe("skip");
    // Back.
    await act(() =>
      useAppStore.getState().goToTourStep(indexOf(guide, "ignore"), true),
    );
    await frame();
    await frame();
    expect(currentStep()).toBe("ignore");
    expect(reviewedApp()).toBe("Fan Control");
    expect(
      one('[data-tour="discovered-ignore"]').hasAttribute("disabled"),
    ).toBe(false);
  });

  it("only finishes a step for its own task", async () => {
    await start("skip");
    await exercises.ignore();
    expect(currentStep()).toBe("skip");
    // The ignored sample sits under Ignored, where it can be restored.
    await click(
      [
        ...one('[data-tour="discovered-filters"]').querySelectorAll("button"),
      ].find((button) => button.textContent?.startsWith("Ignored"))!,
    );
    expect(stage().textContent).toContain("Diablo IV.exe");
    await click(buttonNamed("Restore", stage()));
    expect(currentStep()).toBe("skip");
    expect(trackerCalls()).toEqual([]);
  });

  it("saves nothing: no app, no setting, no message", async () => {
    for (const id of Object.keys(exercises)) {
      await start(id);
      await exercises[id]();
    }
    const state = useAppStore.getState();
    expect(trackerCalls()).toEqual([]);
    expect(state.exeCache.size).toBe(0);
    expect(state.userIgnoredProcesses.size).toBe(0);
    expect(state.settings.trackTools).not.toBe(true);
    expect(state.toasts).toEqual([]);
    // "Track as software" opens no dialog that could save.
    expect(document.getElementById("software-dialog-title")).toBeNull();
  });
});

describe("the picker card", () => {
  it("is the real card: covers, search, own name and Not a game", async () => {
    await start("ambiguous");
    const card = one('[data-tour="demo-ambiguous"]');
    expect(card.querySelectorAll('[aria-label^="Track "]').length).toBe(2);
    for (const label of [
      "Search for yours",
      "Search database",
      "Custom name",
      "Not a game…",
    ])
      expect(buttonNamed(label, card)).toBeDefined();
    // The ring is on the covers the task is about, not on the whole card.
    const ring = findTourTarget(stepOf(guide, "ambiguous"))!;
    expect(ring.querySelectorAll('[aria-label^="Track "]').length).toBe(2);
    expect(ring.textContent).not.toContain("Search database");
  });

  it("searches the bundled samples, never the database", async () => {
    await start("ambiguous");
    await click(
      buttonNamed("Search database", one('[data-tour="demo-ambiguous"]')),
    );
    const search = one('[data-tour="demo-sample-search"]');
    expect(document.body.textContent).toContain(
      "Practice · nothing is submitted",
    );
    // Closing the search is not a decision.
    await click(buttonNamed("Cancel", search));
    await frame();
    expect(currentStep()).toBe("ambiguous");
    expect(trackerCalls()).toEqual([]);
  });

  it("finishes with a name the player types", async () => {
    await start("ambiguous");
    const card = one('[data-tour="demo-ambiguous"]');
    await click(buttonNamed("Custom name", card));
    await typeInto(
      card.querySelector<HTMLInputElement>("form input")!,
      "My fan game",
    );
    await click(buttonNamed("Add", card));
    expect(currentStep()).toBe("finish");
    expect(trackerCalls()).toEqual([]);
  });

  it("finishes with Not a game, inside a practice dialog", async () => {
    await start("ambiguous");
    await click(
      buttonNamed("Not a game…", one('[data-tour="demo-ambiguous"]')),
    );
    const dialog = one('[data-tour="demo-report-dialog"]');
    expect(dialog.textContent).toContain(
      "Practice only · no report will be submitted.",
    );
    await click(
      [...dialog.querySelectorAll("button")].find((button) =>
        button.textContent?.includes("Not sure, just ignore it"),
      )!,
    );
    await click(buttonNamed("Ignore on this PC", dialog));
    expect(currentStep()).toBe("finish");
    expect(trackerCalls()).toEqual([]);
    expect(useAppStore.getState().toasts).toEqual([]);
  });
});

describe("Discovered itself", () => {
  it('offers "Show me how" when nothing waits for review', async () => {
    useAppStore.setState({ activeView: "discovered" });
    await act(() => root.render(<DiscoveredView />));
    expect(container.textContent).toContain("You're all caught up.");
    // The real page, not the sample.
    expect(container.querySelector('[data-tour="demo-discovery"]')).toBeNull();
    await click(one('[data-guide-link="fix-detection"]'));
    expect(useAppStore.getState().activeTour?.tourId).toBe("fix-detection");
  });
});
