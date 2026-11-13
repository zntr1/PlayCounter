// @vitest-environment happy-dom
/* "Track software": what software tracking is, "Track as software" on a
   sample app in Discovered, the Software page with sample apps and one app's
   numbers, and where it is switched on or off. The guide works while
   tracking is off, and switches nothing on by itself. */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../../store";
import * as tracker from "../../../tracker";
import { DiscoveredView } from "../../views/DiscoveredView";
import { settingsGroups } from "../../views/settings/settingsTree";
import { SoftwareView } from "../../views/SoftwareView";
import { findTour, tours } from "../tourDefinitions";
import { findTourTarget } from "../tourTargetRect";
import { TourOverlay } from "../TourUI";
import {
  boldNames,
  expectStepRules,
  indexOf,
  stepOf,
} from "./guideRules.test.kit";
import { a, NEXT_RELEASE } from "./shared";
import { trackSoftwareGuide } from "./trackSoftware";

vi.mock("../../../tracker");
vi.mock("../../../platform", () => ({ currentPlatform: () => "windows" }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockRejectedValue(new Error("no file")),
  convertFileSrc: (value: string) => value,
}));

const guide = trackSoftwareGuide();

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

// Like App.tsx: the open view, and the guide over it.
function Shell() {
  const view = useAppStore((state) => state.activeView);
  return (
    <>
      {view === "discovered" ? <DiscoveredView /> : null}
      {view === "software" ? <SoftwareView /> : null}
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
    root.render(<Shell />);
    useAppStore.getState().startTour(guide.id);
  });
  await act(() =>
    useAppStore.getState().goToTourStep(indexOf(guide, stepId), true),
  );
  await frame();
}

const currentStep = () =>
  guide.steps[useAppStore.getState().activeTour!.stepIndex].id;

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

const trackerCalls = () =>
  Object.entries(tracker)
    .filter(
      ([, value]) => vi.isMockFunction(value) && value.mock.calls.length > 0,
    )
    .map(([name]) => name);

const cards = () => [
  ...document.querySelectorAll<HTMLElement>('[data-tour="demo-software-card"]'),
];

describe("the guide", () => {
  it("is new in the next release, listed, and follows the step rules", () => {
    expect(guide.version).toBe(1);
    expect(guide.release).toBe(NEXT_RELEASE);
    expect(tours().map((tour) => tour.id)).toContain("track-software");
    expectStepRules(guide);
  });

  it("starts with what software tracking is, on the page it fills", () => {
    const intro = guide.steps[0];
    expect(intro.view).toBe("software");
    expect(intro.anchor).toBeUndefined();
    expect(boldNames(intro.body)).toContain("Software");
    expect(intro.body).toContain("Now Playing");
    expect(intro.body).toContain("game stats");
  });

  it("goes from an app in Discovered to its page to the switch", () => {
    expect(guide.steps.map((step) => step.view)).toEqual([
      "software",
      "discovered",
      "software",
      "software",
      "settings",
    ]);
  });

  it("rings the sidebar entry only while its page is open", () => {
    // App.tsx shows Software in the sidebar while tracking is on, or while
    // the page is open. With tracking off, only the second is true.
    for (const step of guide.steps)
      if (
        [step.anchor, ...(step.anchorTargets ?? [])].includes(a("nav-software"))
      )
        expect(step.view, step.id).toBe("software");
  });

  it("points at the real switch without letting the guide flip it", () => {
    const step = guide.steps.at(-1)!;
    expect(step.view).toBe("settings");
    expect(step.settingsGroup).toBe("discovery");
    expect(step.interactive).toBeUndefined();
    expect(boldNames(step.body)).toContain("Track software");
    // The row it rings is that setting, on that Settings page.
    const row = /^\[data-row="([^"]+)"\]$/.exec(step.anchor!)?.[1];
    const discovery = settingsGroups(() => true).find(
      (group) => group.id === step.settingsGroup,
    )!;
    const node = discovery.sections
      .flatMap((section) => section.nodes)
      .find((candidate) => candidate.id === row);
    expect(node?.title()).toBe("Track software");
  });

  it("ends on the Software page, where tracking can be switched on", () => {
    expect(guide.finishView).toBe("software");
  });
});

describe.each([
  ["off", false],
  ["on", true],
])("with software tracking %s", (_label, trackTools) => {
  beforeEach(() => {
    useAppStore.setState((state) => ({
      settings: { ...state.settings, trackTools },
    }));
  });

  it("finds what every step on Discovered and Software rings", async () => {
    for (const step of guide.steps) {
      // Settings steps are checked elsewhere; the first step rings nothing.
      if (step.view === "settings" || !step.anchor) continue;
      await start(step.id);
      expect(findTourTarget(step), step.id).not.toBeNull();
    }
    expect(useAppStore.getState().settings.trackTools === true).toBe(
      trackTools,
    );
  });

  it("shows sample apps on the Software page, each with its time", async () => {
    await start("page");
    expect(container.textContent).not.toContain("Software tracking is off");
    expect(cards().length).toBeGreaterThanOrEqual(3);
    // The app tracked in the step before is one of them.
    expect(cards().map((card) => card.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining("Blender")]),
    );
    expect(container.textContent).toContain("Running");
    // The step rings the cards, not the whole page.
    const ring = findTourTarget(stepOf(guide, "page"))!;
    expect(
      ring.querySelectorAll('[data-tour="demo-software-card"]').length,
    ).toBe(cards().length);
  });

  it("finishes the Discovered step on Track as software, saving nothing", async () => {
    await start("track-app");
    const step = stepOf(guide, "track-app");
    expect(boldNames(step.task)).toEqual(["Track as software"]);
    // An app that is no game, and only this one button to press.
    expect(one('[data-tour="discovered-evidence"] h3').textContent).toBe(
      "Blender",
    );
    expect(step.allow).toEqual([
      `${a("demo-discovery")} ${a("discovered-software")}`,
    ]);
    await click(findTourTarget(step)!);
    expect(currentStep()).toBe("page");
    expect(trackerCalls()).toEqual([]);
    expect(document.getElementById("software-dialog-title")).toBeNull();
    expect(useAppStore.getState().settings.trackTools === true).toBe(
      trackTools,
    );
    expect(useAppStore.getState().exeCache.size).toBe(0);
  });

  it("opens one app's numbers and finishes when they are closed", async () => {
    await start("numbers");
    await click(cards()[0]);
    const dialog = one('[data-tour="demo-software-details"]');
    for (const label of ["Total", "This week", "Today", "Days used"])
      expect(dialog.textContent).toContain(label);
    // Looking is not done yet.
    await frame();
    expect(currentStep()).toBe("numbers");
    await click(buttonNamed("Close", dialog));
    expect(currentStep()).toBe(guide.steps[indexOf(guide, "numbers") + 1].id);
    expect(trackerCalls()).toEqual([]);
  });

  it("has no menu on a sample card that could change a real app", async () => {
    await start("numbers");
    await act(() => {
      cards()[0].dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 5,
          clientY: 5,
        }),
      );
    });
    expect(document.body.textContent).not.toContain("Ignore This App");
    expect(document.body.textContent).not.toContain("Change Art");
  });
});

describe("outside the guide", () => {
  it("leaves the Software page alone: off stays off, without samples", async () => {
    useAppStore.setState({ activeView: "software" });
    await act(() => root.render(<Shell />));
    expect(container.textContent).toContain("Software tracking is off");
    expect(cards()).toEqual([]);
  });

  it("is a guide another one can lead into", () => {
    expect(findTour("fix-detection")?.nextTourId).toBe(guide.id);
  });
});
