// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as manualAdd from "../../../library/manualAdd";
import * as gameLookup from "../../../library/gameLookup";
import { useAppStore } from "../../../store";
import * as tracker from "../../../tracker";
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
vi.mock("../../../library/manualAdd");
vi.mock("../../../library/gameLookup");
const pickFile = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: pickFile }));

/* "Add a game yourself" (docs/tours-plan.md, WP6): most PC games add
   themselves; Add game, the title search, removing a wrong pick and the Quick
   add key, on a sample. Change Game… and Suggest to Community are left out:
   they belong to a game with a file of the player's own, which Add game
   without a file never makes. */

const guide = () => findTour("add-game")!;
const step = (id: string) => guide().steps.find((entry) => entry.id === id)!;
const index = (id: string) =>
  guide().steps.findIndex((entry) => entry.id === id);
const a = (name: string) => `[data-tour="${name}"]`;

describe("the guide's steps", () => {
  it("go from the button to the Quick add key", () => {
    expect(guide().steps.map((entry) => entry.id)).toEqual([
      "intro",
      "open",
      "search",
      "result",
      "wrong-game",
      "quick-add",
      "finish",
    ]);
    expect(guide().version).toBe(3);
    expect(guide().release).toBe(NEXT_RELEASE);
    expect(guide().demoGame).toBe(true);
  });

  it("follow the rules of every guide", () => {
    expectStepRules(guide());
  });

  it("make the player click Add game, search by title and add", () => {
    expect(bold(step("open").task!)).toEqual(["Add game"]);
    expect(step("open").anchor).toBe(a("demo-add-game-button"));
    expect(step("open").advanceOn).toEqual({
      type: "anchor-present",
      selector: a("demo-add-game-dialog"),
    });
    expect(step("search").anchor).toBe(a("demo-add-game-search"));
    expect(step("search").advanceOn).toEqual({
      type: "anchor-present",
      selector: a("demo-add-game-results"),
    });
    expect(bold(step("result").task!)).toContain("Add game");
  });

  it("explain that the game works with or without its .exe", () => {
    const body = step("result").body;
    expect(body).toMatch(/card/);
    expect(body).toMatch(/game file/);
    expect(body).toMatch(/first time you run it/);
  });

  it("say first that most PC games join by themselves", () => {
    expect(step("intro").body).toMatch(/by themselves/);
    expect(bold(step("intro").body)).toEqual(["Add game"]);
  });

  it("fix a wrong pick by removing it and adding the right one", () => {
    const entry = step("wrong-game");
    expect(bold(entry.task!)).toEqual(["Remove from Library"]);
    expect(entry.body).toMatch(/add the right one/i);
    expect(entry.anchorTargets).toContain(a("demo-menu-remove"));
    expect(entry.advanceOn).toEqual({
      type: "event",
      name: "demo.step-completed",
    });
  });

  it("name nothing that only a game with the player's own file has", () => {
    for (const entry of guide().steps)
      expect(
        `${entry.title} ${entry.body} ${entry.task ?? ""}`,
        entry.id,
      ).not.toMatch(/Change Game|Suggest to Community|Matching/);
  });

  it("send the player to Quick add game in the keyboard shortcuts and suggest no key", () => {
    const entry = step("quick-add");
    expect(entry.view).toBe("settings");
    expect(entry.settingsGroup).toBe("shortcuts");
    expect(entry.anchor).toBe(a("settings-row-quickAddHotkey"));
    expect(bold(entry.body)).toEqual(["Quick add game"]);
    // The player picks the key; the text names none.
    expect(`${entry.title} ${entry.body}`).not.toMatch(
      /ctrl|alt|shift|\bF\d+\b|<kbd>/i,
    );
  });

  it("finish with what to do in the real app", () => {
    expect(step("finish").anchor).toBe(a("demo-add-game-button"));
  });
});

let root: Root;
let container: HTMLDivElement;
let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  fetchSpy = vi.fn(() => Promise.reject(new Error("no network in a guide")));
  vi.stubGlobal("fetch", fetchSpy);
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
  vi.clearAllMocks();
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

async function typeInto(selector: string, value: string) {
  const input = find(selector) as HTMLInputElement;
  expect(input, `missing ${selector}`).not.toBeNull();
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
    useAppStore.getState().startTour("add-game");
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

/** Nothing reached the library, the network or a launcher. */
function expectNothingLeftThisPc() {
  expect(manualAdd.addGameWithoutFile).not.toHaveBeenCalled();
  expect(manualAdd.addAndShareGameFile).not.toHaveBeenCalled();
  expect(manualAdd.checkGameFile).not.toHaveBeenCalled();
  expect(gameLookup.searchLibraryGames).not.toHaveBeenCalled();
  expect(tracker.linkGameFileByHand).not.toHaveBeenCalled();
  expect(tracker.linkServerKnownFiles).not.toHaveBeenCalled();
  expect(pickFile).not.toHaveBeenCalled();
  expect(fetchSpy).not.toHaveBeenCalled();
}

describe("the walk through the guide", () => {
  it("has a usable Add game button on the sample, even offline", async () => {
    await start("open");
    const button = find(a("demo-add-game-button")) as HTMLButtonElement;
    expect(button).not.toBeNull();
    expect(button.disabled).toBe(false);
  });

  it("opens the dialog on the click and moves on", async () => {
    await start("open");
    expect(find(a("demo-add-game-dialog"))).toBeNull();
    await click(a("demo-add-game-button"));
    await wait(200);
    expect(stepNow()).toBe("search");
    expect(find(a("demo-add-game-dialog"))).not.toBeNull();
  });

  it("finds a sample title from bundled titles, with no network", async () => {
    await start("search");
    // Entering the step set the stage: the dialog is open.
    expect(find(a("demo-add-game-dialog"))).not.toBeNull();
    await typeInto(a("demo-add-game-search"), "World");
    await click(`${a("demo-add-game-dialog")} button[type="submit"]`);
    await wait(100);
    const results = find(a("demo-add-game-results"));
    expect(results?.textContent).toContain("World of Warcraft");
    expect(stepNow()).toBe("result");
    expectNothingLeftThisPc();
  });

  it("shows what Add game gives, adds nothing, and closes with Done", async () => {
    await start("result");
    // Entered from anywhere: the dialog is open with results to pick.
    expect(find(a("demo-add-game-results"))).not.toBeNull();
    await click(a("demo-add-game-confirm"));
    const result = find(a("demo-add-game-result"));
    expect(result, "missing the result").not.toBeNull();
    expect(result!.textContent).toMatch(/sample/i);
    expectNothingLeftThisPc();
    await click(a("demo-add-game-done"));
    await wait(200);
    expect(find(a("demo-add-game-dialog"))).toBeNull();
    expect(stepNow()).toBe("wrong-game");
    expectNothingLeftThisPc();
  });

  it("does not ask for a file picker: the sample file is made up", async () => {
    await start("result");
    const pick = [
      ...document.querySelectorAll<HTMLButtonElement>(
        `${a("demo-add-game-dialog")} button`,
      ),
    ].find((button) => button.textContent?.includes("Pick game file"));
    expect(pick).toBeDefined();
    await act(async () => pick!.click());
    expect(pickFile).not.toHaveBeenCalled();
    expect(find(a("demo-add-game-dialog"))!.textContent).toContain("Wow.exe");
  });

  it("closes the dialog when the step does not need it, entered from anywhere", async () => {
    await start("result");
    expect(find(a("demo-add-game-dialog"))).not.toBeNull();
    await act(async () =>
      useAppStore.getState().goToTourStep(index("wrong-game")),
    );
    await wait();
    expect(find(a("demo-add-game-dialog"))).toBeNull();
  });

  it("shows the sample as a game Add game makes: no Change Game…, no Suggest to Community", async () => {
    await start("wrong-game");
    // The step opened the card's menu.
    expect(find(a("demo-menu-remove"))).not.toBeNull();
    expect(find(a("demo-menu-change-game"))).toBeNull();
    expect(find(a("demo-menu-suggest-community"))).toBeNull();
  });

  it("removes the sample on Remove from Library and moves on, removing nothing for real", async () => {
    await start("wrong-game");
    await click(a("demo-menu-remove"));
    const dialog = find(a("demo-remove-dialog"));
    expect(dialog, "missing the remove dialog").not.toBeNull();
    await act(async () =>
      [...dialog!.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent?.trim() === "Remove")!
        .click(),
    );
    await wait(200);
    expect(stepNow()).toBe("quick-add");
    expect(tracker.untrackGame).not.toHaveBeenCalled();
    expectNothingLeftThisPc();
  });
});

describe("the empty My Games screen", () => {
  it("offers no Show me how for importing a library", async () => {
    await act(async () => {
      root.render(<LibraryTestShell />);
    });
    await wait();
    expect(find('[data-guide-link="import-library"]')).toBeNull();
  });
});
