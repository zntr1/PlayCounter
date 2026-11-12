// @vitest-environment happy-dom
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../../store";
import { organizeLibraryGuide } from "./organizeLibrary";
import {
  GTA,
  WOW,
  card,
  cardIds,
  click,
  currentStep,
  finishStep,
  goTo,
  guideProblems,
  has,
  mountPractice,
  q,
  rightClick,
  startGuide,
  stepId,
  target,
  type,
  unmountPractice,
} from "./libraryPractice.test.util";

/* "Favorites & shelves" on today's My Games (docs/tours-plan.md 1.3, 1.4 and
   the WP4 row): shelves are filled from the card menu's Shelves, a shelf can
   hide its games, and coming back from a later step never leaves a step
   that cannot be done. */

vi.mock("../../../tracker");
vi.mock("../../../platform", () => ({ currentPlatform: () => "windows" }));

beforeEach(mountPractice);
afterEach(unmountPractice);

const guide = organizeLibraryGuide();
const step = (id: string) => guide.steps.find((entry) => entry.id === id)!;
const text = (id: string) => `${step(id).body} ${step(id).task ?? ""}`;
const label = (element: Element) => element.textContent?.trim();
/** The hand-filled shelves in the row: name and game count. */
const shelves = () =>
  [...document.querySelectorAll('[data-tour="demo-personal-shelf"]')].map(
    (chip) => [
      chip.querySelector("span[title]")?.textContent,
      Number(chip.lastElementChild?.textContent),
    ],
  );

describe("Favorites & shelves", () => {
  it("keeps the rules for every step", () => {
    expect(guideProblems(guide, { version: 3 })).toEqual([]);
    expect(guide.nextTourId).toBe("library-progress");
  });

  it("teaches Shelves in the card menu, not the way through the Journal", () => {
    expect(step("fill-shelf").task).toContain("<b>Shelves</b>");
    expect(text("fill-shelf")).not.toContain("Journal");
    // Dragging stays as the other way.
    expect(text("fill-shelf")).toMatch(/drag/i);
  });

  it("rings Shelves, then the shelf in its flyout, and moves on", async () => {
    await startGuide("organize-library", "fill-shelf");
    expect(target().getAttribute("data-tour")).toBe("demo-personal-shelf");
    await rightClick(card(WOW));
    expect(target().getAttribute("data-tour")).toBe("demo-menu-shelves");
    expect(label(target())).toBe("Shelves");
    await click(target());
    expect(target().getAttribute("data-tour")).toBe("demo-menu-shelf");
    expect(label(target())).toBe("Online Games");
    await click(target());
    expect(shelves()).toEqual([["Online Games", 1]]);
    await finishStep();
    expect(stepId()).toBe("hide-shelf");
    expect(useAppStore.getState().gameJournals).toEqual({});
  });

  it("has New shelf in the card menu's Shelves, and it puts the game on the new shelf", async () => {
    await startGuide("organize-library", "fill-shelf");
    await rightClick(card(GTA));
    await click(q("demo-menu-shelves"));
    expect(label(q("demo-menu-new-shelf"))).toBe("New shelf");
    await click(q("demo-menu-new-shelf"));
    // The guide follows into the dialog and lets it through.
    const name = q<HTMLInputElement>("demo-shelf-name");
    expect(target()).toBe(name);
    await type(name, "Heists");
    await act(() => name.form!.requestSubmit());
    expect(has("demo-shelf-editor")).toBe(false);
    expect(shelves()).toEqual([
      ["Online Games", 0],
      ["Heists", 1],
    ]);
    await finishStep();
    expect(stepId()).toBe("hide-shelf");
    expect(useAppStore.getState().personalShelves).toEqual([]);
  });

  it("gives the shelf back to hand-picked games when coming back from saved filters", async () => {
    await startGuide("organize-library", "save-filters");
    expect(label(target())).toBe("Save filters");
    await click(target());
    expect(has("demo-filtered-shelf")).toBe(true);
    await goTo("fill-shelf", true);
    expect(has("demo-filtered-shelf")).toBe(false);
    expect(target().getAttribute("data-tour")).toBe("demo-personal-shelf");
    await rightClick(card(WOW));
    await click(q("demo-menu-shelves"));
    expect(label(q("demo-menu-shelf"))).toBe("Online Games");
    await click(q("demo-menu-shelf"));
    await finishStep();
    expect(stepId()).toBe("hide-shelf");
  });

  it("can fill the shelf again when every sample is on it already", async () => {
    await startGuide("organize-library", "fill-shelf");
    for (const id of [WOW, GTA]) {
      await rightClick(card(id));
      await click(q("demo-menu-shelves"));
      await click(q("demo-menu-shelf"));
    }
    await goTo("fill-shelf", true);
    await finishStep(2000);
    expect(stepId()).toBe("fill-shelf");
    await rightClick(card(WOW));
    await click(q("demo-menu-shelves"));
    expect(q("demo-menu-shelf").getAttribute("aria-checked")).toBe("false");
    await click(q("demo-menu-shelf"));
    await finishStep();
    expect(stepId()).toBe("hide-shelf");
  });

  it("can mark a favorite again when both samples are favorites already", async () => {
    await startGuide("organize-library", "favorite");
    for (const id of [WOW, GTA]) {
      await rightClick(card(id));
      await click(q("demo-menu-favorite"));
    }
    await goTo("favorite", true);
    await finishStep(2000);
    expect(stepId()).toBe("favorite");
    await rightClick(card(WOW));
    expect(target().getAttribute("data-tour")).toBe("demo-menu-favorite");
    expect(label(target())).toBe("Add to Favorites");
    await click(target());
    await finishStep();
    expect(stepId()).toBe("create-shelf");
  });

  it("has a step that hides a shelf's games through the shelf's Hide in menu", async () => {
    await startGuide("organize-library", "hide-shelf");
    expect(step("hide-shelf").task).toContain("<b>Hide in</b>");
    const shelf = target();
    expect(shelf.getAttribute("data-tour")).toBe("demo-personal-shelf");
    // Something is on the shelf, so hiding shows.
    expect(shelves()).toEqual([["Online Games", 1]]);
    expect(cardIds()).toEqual([WOW, GTA]);
    await rightClick(shelf);
    expect(label(target())).toBe("Hide in");
    await click(target());
    expect(label(target())).toBe("All games and search");
    await click(target());
    // World of Warcraft leaves All games and stays on its shelf.
    expect(cardIds()).toEqual([GTA]);
    expect(shelves()).toEqual([["Online Games", 1]]);
    await finishStep();
    expect(stepId()).toBe("filters");
    expect(useAppStore.getState().personalShelves).toEqual([]);
  });

  it("can hide again after coming back, and the next steps show every game", async () => {
    await startGuide("organize-library", "hide-shelf");
    await rightClick(target());
    await click(q("demo-shelf-hide"));
    await click(q("demo-shelf-hide-all"));
    await finishStep();
    // Saving filters to a hiding shelf would only say "hiding is paused".
    expect(stepId()).toBe("filters");
    expect(cardIds()).toEqual([WOW, GTA]);
    await goTo("hide-shelf", true);
    expect(cardIds()).toEqual([WOW, GTA]);
    await rightClick(target());
    await click(q("demo-shelf-hide"));
    expect(q("demo-shelf-hide-all").getAttribute("aria-checked")).toBe("false");
  });

  it("does not list the kinds of filters", () => {
    expect(text("filters")).not.toMatch(/emulator|playtime/i);
    expect(step("filters").task).toContain("<b>In progress</b>");
  });

  it("can pick the filter again after coming back", async () => {
    await startGuide("organize-library", "filters");
    expect(label(target())).toBe("In progress");
    await click(target());
    await finishStep();
    expect(stepId()).toBe("save-filters");
    await goTo("filters", true);
    await finishStep(2000);
    expect(stepId()).toBe("filters");
    expect(target().getAttribute("aria-pressed")).toBe("false");
    await click(target());
    await finishStep();
    expect(stepId()).toBe("save-filters");
  });

  it("keeps the click and one sentence for saving the filters", async () => {
    expect(step("save-filters").task).toBe("Click <b>Save filters</b>.");
    expect(step("save-filters").body.match(/[.!?]/g)).toHaveLength(1);
    await startGuide("organize-library", "save-filters");
    await click(target());
    await finishStep();
    expect(stepId()).toBe("finish");
    // Once more after Back.
    await goTo("save-filters", true);
    expect(label(target())).toBe("Save filters");
    expect((target() as HTMLButtonElement).disabled).toBe(false);
  });

  it("says in the last step where shelves past one row go", () => {
    expect(guide.steps.at(-1)!.body).toContain("+N more");
  });

  it.each(guide.steps.map((entry) => entry.id))(
    "shows its control when %s is entered directly",
    async (id) => {
      await startGuide("organize-library", id);
      expect(currentStep().id).toBe(id);
      target();
      await finishStep(2000);
      expect(stepId()).toBe(id);
    },
  );
});
