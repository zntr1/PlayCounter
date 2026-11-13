// @vitest-environment happy-dom
/* "Track emulator games": how many emulators and a few names, detection is
   on from the start, the folded Emulators row, no step for one emulator, and
   the two exercises on the sample match finish by themselves. */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EMULATORS } from "../../../emulators/registry";
import { useAppStore } from "../../../store";
import * as tracker from "../../../tracker";
import { EmulatorView } from "../../views/EmulatorsView";
import { NowEmulatingView } from "../../views/NowEmulatingView";
import { settingsGroups } from "../../views/settings/settingsTree";
import { findTour } from "../tourDefinitions";
import { findTourTarget } from "../tourTargetRect";
import { TourOverlay } from "../TourUI";
import { emulatorsGuide } from "./emulators";
import {
  boldNames,
  expectStepRules,
  indexOf,
  stepOf,
} from "./guideRules.test.kit";
import { a } from "./shared";

vi.mock("../../../tracker");
vi.mock("../../../platform", () => ({ currentPlatform: () => "windows" }));

const guide = emulatorsGuide();

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
      {view === "emulating" ? <NowEmulatingView /> : null}
      {view === "dolphin" ? <EmulatorView emulatorId="dolphin" /> : null}
      <TourOverlay />
    </>
  );
}

const frame = () =>
  act(
    () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
  );

const wait = (ms: number) =>
  act(() => new Promise<void>((resolve) => setTimeout(resolve, ms)));

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
      ([name, value]) =>
        // Read while the card renders; it changes nothing.
        name !== "emulatorShareRuntimeContext" &&
        vi.isMockFunction(value) &&
        value.mock.calls.length > 0,
    )
    .map(([name]) => name);

const sampleCard = () => one('[data-tour="demo-emulator-linked"]');
const allText = () =>
  guide.steps.map((step) => `${step.title} ${step.body} ${step.task ?? ""}`);

describe("the guide", () => {
  it("is reworked for the next release and follows the step rules", () => {
    expect(guide.version).toBe(5);
    expect(guide.release).toBe("1.1.17");
    expectStepRules(guide);
  });

  it("says how many emulators there are and names two or three", () => {
    const intro = guide.steps[0].body;
    expect(intro).toContain(`${EMULATORS.length} emulators`);
    const named = EMULATORS.filter((adapter) => intro.includes(adapter.label));
    expect(named.length).toBeGreaterThanOrEqual(2);
    expect(named.length).toBeLessThanOrEqual(3);
    // A name in the text is a name in the registry.
    const examples = /such as (.+?)\./.exec(intro)![1].split(/, | and /);
    expect(examples.sort()).toEqual(
      named.map((adapter) => adapter.label).sort(),
    );
  });

  it("says detection is on by default, at the setting itself", () => {
    const step = stepOf(guide, "settings");
    expect(step.body).toMatch(/on by default/i);
    expect(`${step.title} ${step.body}`).not.toMatch(/\benable/i);
    expect(boldNames(step.body)).toEqual(["Detect emulator games"]);
    expect(step.view).toBe("settings");
    expect(step.settingsGroup).toBe("emulators");
    // The real switch is only pointed at.
    expect(step.interactive).toBeUndefined();
    const row = /^\[data-row="([^"]+)"\]$/.exec(step.anchorTargets![0])?.[1];
    const node = settingsGroups(() => true)
      .find((group) => group.id === "emulators")!
      .sections.flatMap((section) => section.nodes)
      .find((candidate) => candidate.id === row);
    expect(node?.title()).toBe("Detect emulator games");
    expect(node?.isOn?.(useAppStore.getInitialState().settings)).toBe(true);
  });

  it("says that two or more emulators fold under one Emulators row", () => {
    const step = guide.steps.find((candidate) =>
      /two or more/i.test(candidate.body),
    )!;
    expect(step.body).toMatch(/Emulators row/);
    // The row is ringed when the sidebar has one.
    expect(step.additionalAnchors).toContain(a("nav-emulator-group"));
    expect(step.anchor).toBe(a("nav-dolphin"));
  });

  it("has no step for a single emulator; all of them work alike", () => {
    expect(guide.steps.map((step) => step.id)).not.toContain("pcsx2");
    expect(
      guide.steps.slice(1).filter((step) => /PCSX2/.test(step.body)),
    ).toEqual([]);
    expect(allText().join(" ")).toMatch(/every supported emulator works/i);
  });

  it("ends in My Games and hands the badges to their own guide", () => {
    const last = guide.steps.at(-1)!;
    expect(last.view).toBe("games");
    expect(last.anchor).toBe(a("demo-game-card"));
    expect(allText().join(" ")).not.toMatch(/origins|file-match/i);
    expect(guide.nextTourId).toBe("source-badges");
    expect(findTour("source-badges")?.title).toBe("Understand game badges");
  });

  it("rings the button a task names, and lets the player press only that", () => {
    const confirm = stepOf(guide, "confirm");
    expect(boldNames(confirm.task)).toEqual(["Looks right"]);
    expect(confirm.anchor).toBe(a("demo-emulator-confirm"));
    expect(confirm.allow).toEqual([a("demo-emulator-confirm")]);
    const fix = stepOf(guide, "fix-match");
    expect(boldNames(fix.body)).toEqual(["Change", "Forget", "Share match"]);
    expect(fix.anchor).toBe(a("demo-emulator-actions"));
    // An open dialog wins over the buttons that opened it.
    expect(fix.anchorTargets?.at(-1)).toBe(a("demo-emulator-actions"));
    expect(fix.anchorTargets?.length).toBeGreaterThan(1);
  });
});

describe("the sample match", () => {
  it("can be entered at any step: each one finds what it rings", async () => {
    for (const step of guide.steps) {
      if (step.view !== "emulating" && step.view !== "dolphin") continue;
      if (step.anchor?.includes('"nav-')) continue;
      await start(step.id);
      expect(findTourTarget(step), step.id).not.toBeNull();
    }
  });

  it('moves on once "Looks right" is clicked', async () => {
    await start("confirm");
    expect(sampleCard().textContent).toContain("Check this once");
    await click(buttonNamed("Looks right", sampleCard()));
    expect(currentStep()).toBe("fix-match");
    // Confirmed stays confirmed in the step that follows.
    expect(sampleCard().textContent).not.toContain("Check this once");
    expect(sampleCard().textContent).not.toContain("Looks right");
    expect(trackerCalls()).toEqual([]);
  });

  it("does not bounce forward after Back, and asks for the check again", async () => {
    await start("confirm");
    await click(buttonNamed("Looks right", sampleCard()));
    await act(() =>
      useAppStore.getState().goToTourStep(indexOf(guide, "confirm"), true),
    );
    await frame();
    await frame();
    expect(currentStep()).toBe("confirm");
    expect(buttonNamed("Looks right", sampleCard()).disabled).toBe(false);
  });

  it("moves on after Change, with the bundled sample search", async () => {
    await start("fix-match");
    await click(buttonNamed("Change", sampleCard()));
    const search = one('[data-tour="demo-sample-search"]');
    await click(
      [...search.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
        button.textContent?.includes("Diablo IV"),
      )!,
    );
    await click(buttonNamed("Confirm sample match", search));
    expect(currentStep()).toBe("library");
    expect(trackerCalls()).toEqual([]);
  });

  it.each([
    ["Forget", "Forget sample"],
    ["Share match", "Finish preview"],
  ])("moves on after %s", async (action, confirm) => {
    await start("fix-match");
    await click(buttonNamed(action, sampleCard()));
    await click(
      buttonNamed(confirm, one('[data-tour="demo-emulator-confirmation"]')),
    );
    expect(currentStep()).toBe("library");
    expect(trackerCalls()).toEqual([]);
  });

  it("stays on the step when a dialog is cancelled", async () => {
    await start("fix-match");
    await click(buttonNamed("Forget", sampleCard()));
    // Long enough for the guide to notice the open dialog.
    await wait(250);
    await click(
      buttonNamed("Cancel", one('[data-tour="demo-emulator-confirmation"]')),
    );
    // Longer than the guide waits before it treats a closed dialog as Next.
    await wait(600);
    expect(currentStep()).toBe("fix-match");
    expect(sampleCard().textContent).toContain("Forget");
  });
});
