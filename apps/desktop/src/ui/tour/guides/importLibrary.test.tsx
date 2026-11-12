// @vitest-environment happy-dom
/* "Import a launcher library": the guide practises on the real importer's
   screens with sample games (ImportTourPractice). It starts where imports
   start in the app, asks the player to find games, pick a game, pick the file
   that starts one and import the checked games, and then says what comes
   along (playtime totals) and what comes by itself (new installs). Nothing
   is scanned, signed in, searched on the server or saved. */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  run: vi.fn(),
  fetch: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
  convertFileSrc: (value: string) => value,
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("../../../library/importRun", () => ({
  runLibraryImport: mocks.run,
  importNowShareLater: mocks.run,
}));
vi.mock("../../../platform", () => ({ currentPlatform: () => "windows" }));

import { applyLanguage } from "../../../i18n";
import { useImportSession } from "../../../library/importSession";
import { useAppStore } from "../../../store";
import { findTour } from "../tourDefinitions";
import { TourPracticeSurface } from "../TourPracticeSurface";
import { findTourTarget } from "../tourTargetRect";
import { TourOverlay } from "../TourUI";
import {
  boldNames,
  expectStepRules,
  indexOf,
  stepOf,
} from "./guideRules.test.kit";
import { importLibraryGuide } from "./importLibrary";
import { a } from "./shared";

const guide = importLibraryGuide();

/** The import bar's button on the sample: it counts the checked games. */
const IMPORT_BUTTON = "Import 3 games";

let root: Root;
let container: HTMLDivElement;

beforeAll(async () => {
  // The practice is loaded lazily; have it ready before the first render.
  await import("../ImportTourPractice");
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", mocks.fetch);
  vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => {});
  applyLanguage("en");
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

const sample = () =>
  document.querySelector<HTMLElement>('[data-tour="demo-import"]');

async function start(stepId: string) {
  await act(() => {
    root.render(<Practice />);
    useAppStore.getState().startTour(guide.id);
  });
  // The way the card's list jumps to a step.
  await act(() =>
    useAppStore.getState().goToTourStep(indexOf(guide, stepId), true),
  );
  for (let tries = 0; !sample() && tries < 20; tries += 1) await frame();
  expect(sample(), "the sample is shown").not.toBeNull();
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

/* How the player does each task. */
const tasks: Record<string, () => Promise<void>> = {
  start: () => click(one(a("import-find-games"))),
  "pick-game": async () => {
    const tile = [
      ...one(a("import-pick-game")).querySelectorAll<HTMLButtonElement>(
        "[aria-pressed]",
      ),
    ].find((item) => item.textContent?.includes("Grand Theft Auto V"));
    expect(tile).toBeDefined();
    await click(tile!);
    await click(one(a("import-game-import")));
  },
  "pick-file": async () => {
    await click(
      one(a("import-pick-file")).querySelector<HTMLInputElement>(
        'input[type="radio"]',
      )!,
    );
    await click(one(a("import-game-import")));
  },
  import: () => click(one(a("import-selected"))),
};

describe("the guide", () => {
  it("is reworked for the next release and follows the step rules", () => {
    expect(guide.version).toBe(3);
    expect(guide.release).toBe("1.2.2");
    expect(guide.simulation).toBe("import");
    // The bar's button carries its count; the app's texts know it by its key.
    expectStepRules({
      ...guide,
      steps: guide.steps.map((step) => ({
        ...step,
        task: step.task?.replace(
          `<b>${IMPORT_BUTTON}</b>`,
          "<b>Import {{count}} games</b>",
        ),
      })),
    });
  });

  it("goes from where imports start to what comes in by itself", () => {
    expect(guide.steps.map((step) => step.id)).toEqual([
      "start",
      "ready",
      "pick-game",
      "pick-file",
      "import",
      "totals",
      "again",
      "auto-add",
    ]);
  });

  it("lets the player find games, pick a game, pick a file and import", () => {
    expect(
      guide.steps.filter((step) => step.task).map((step) => step.id),
    ).toEqual(Object.keys(tasks));
    for (const id of Object.keys(tasks)) {
      const step = stepOf(guide, id);
      expect(step.advanceOn, id).toEqual({
        type: "event",
        name: "demo.step-completed",
      });
      // Each can be stepped over: the practice sets the next step up anyway.
      expect(step.manualAdvance, id).toBe(true);
      expect(step.allow, id).toEqual([a("demo-import")]);
    }
    expect(boldNames(stepOf(guide, "start").task)).toEqual(["Find games"]);
    expect(boldNames(stepOf(guide, "pick-game").task)).toContain("Import");
    expect(boldNames(stepOf(guide, "pick-file").task)).toContain("Import");
    expect(boldNames(stepOf(guide, "import").task)).toEqual([IMPORT_BUTTON]);
  });

  it("says where imports start in the app, and that this sample scans nothing", () => {
    const { body } = stepOf(guide, "start");
    for (const words of [
      "right-click",
      "My Games",
      "sidebar",
      "Launcher accounts",
    ])
      expect(body).toContain(words);
    expect(body).toMatch(/nothing is scanned/i);
  });

  it("names the groups of the importer where the player sees them", () => {
    expect(boldNames(stepOf(guide, "ready").body)).toContain("Ready to import");
    expect(boldNames(stepOf(guide, "ready").body)).toContain("Wrong game?");
    expect(boldNames(stepOf(guide, "pick-game").body)).toContain("Needs you");
    expect(boldNames(stepOf(guide, "again").body)).toContain(
      "Already in My Games",
    );
  });

  it("tells which launchers bring playtime totals, and that no sessions are made up", () => {
    const { body } = stepOf(guide, "totals");
    expect(body).toMatch(/Steam[^.]*this PC/);
    expect(body).toMatch(/Xbox, Epic Games, GOG and PlayStation[^.]*sign in/);
    expect(body).toMatch(/Battle\.net[^.]*none/);
    expect(body).toMatch(/made-up sessions/);
  });

  it("tells that importing again updates playtime, for every account", () => {
    const { body } = stepOf(guide, "again");
    expect(body).toMatch(/import(ing)? again/i);
    expect(body).toContain("playtime");
    expect(body).toMatch(/accounts/);
  });

  it("tells which launchers add new games by themselves, and which don't", () => {
    const { body } = stepOf(guide, "auto-add");
    for (const launcher of ["Steam", "Battle.net", "Epic Games", "GOG"])
      expect(body).toContain(launcher);
    expect(body).toMatch(/PlayStation games you play/);
    expect(body).toMatch(/Xbox needs another import/);
    expect(body).toMatch(/removed[^.]*not added again/i);
  });

  it("says launcher and file, never provider or executable", () => {
    const texts = [
      guide.title,
      guide.description,
      ...guide.steps.flatMap((step) => [step.title, step.body, step.task]),
    ].join(" ");
    expect(texts).not.toMatch(/provider|executable|wizard/i);
  });

  it("leads into the guide about launcher accounts", () => {
    expect(guide.nextTourId).toBe("launcher-accounts");
    expect(findTour("launcher-accounts")).toBeDefined();
  });
});

describe("the practice", () => {
  it("can be entered at any step: each one rings a control, not the whole sample", async () => {
    for (const step of guide.steps) {
      await start(step.id);
      const ring = findTourTarget(step);
      expect(ring, step.id).not.toBeNull();
      expect(ring, step.id).not.toBe(sample());
    }
  });

  it("rings what each step names", async () => {
    const rings: Record<string, string> = {
      start: "Find games",
      ready: "Ready to import",
      "pick-game": "Which game is",
      "pick-file": "Which file starts the game?",
      import: IMPORT_BUTTON,
      totals: "Their playtime is in My Games now.",
      again: "Already in My Games",
      "auto-add": "Open My Games",
    };
    for (const [id, text] of Object.entries(rings)) {
      await start(id);
      expect(findTourTarget(stepOf(guide, id))?.textContent, id).toContain(
        text,
      );
    }
  });

  it("names the import button exactly as the sample shows it", async () => {
    await start("import");
    expect(one(a("import-selected")).textContent?.trim()).toBe(IMPORT_BUTTON);
  });

  it("shows Wrong game? where the step about sure matches names it", async () => {
    await start("ready");
    const step = stepOf(guide, "ready");
    expect(step.additionalAnchors).toEqual([a("import-wrong-game")]);
    expect(one(a("import-wrong-game")).textContent).toBe("Wrong game?");
  });

  it.each(Object.keys(tasks))(
    'finishes "%s" by itself once its task is done',
    async (id) => {
      await start(id);
      await tasks[id]();
      expect(currentStep()).toBe(guide.steps[indexOf(guide, id) + 1].id);
    },
  );

  it("does not bounce forward after Back, and starts the task over", async () => {
    await start("pick-game");
    await tasks["pick-game"]();
    expect(currentStep()).toBe("pick-file");
    await act(() =>
      useAppStore.getState().goToTourStep(indexOf(guide, "pick-game"), true),
    );
    await frame();
    await frame();
    expect(currentStep()).toBe("pick-game");
    expect(one(a("import-pick-game")).textContent).toContain(
      "Grand Theft Auto V Enhanced",
    );
  });

  it("only finishes a step for its own task", async () => {
    await start("pick-game");
    // Importing the checked games is the task of a later step.
    await click(one(a("import-shelf-ready")));
    await tasks.import();
    expect(currentStep()).toBe("pick-game");
  });

  it("saves nothing: no game, no import, no request", async () => {
    for (const id of Object.keys(tasks)) {
      await start(id);
      await tasks[id]();
    }
    expect(useAppStore.getState().libraryImports.size).toBe(0);
    expect(useAppStore.getState().toasts).toEqual([]);
    expect(useImportSession.getState().session.scan).toBeNull();
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(mocks.run).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
