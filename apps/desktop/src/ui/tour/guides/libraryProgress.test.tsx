// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../../store";
import { libraryProgressGuide } from "./libraryProgress";
import {
  GTA,
  WOW,
  card,
  click,
  currentStep,
  finishStep,
  goTo,
  guideProblems,
  has,
  labelOf,
  mountPractice,
  q,
  rightClick,
  startGuide,
  stepId,
  target,
  type,
  unmountPractice,
} from "./libraryPractice.test.util";

/* "Progress & card layout" on today's My Games (docs/tours-plan.md 1.3 and
   the WP4 row): one game's status comes from its menu's Status, and Customize
   is the gear with its popover and the three view buttons. */

vi.mock("../../../tracker");
vi.mock("../../../platform", () => ({ currentPlatform: () => "windows" }));

beforeEach(mountPractice);
afterEach(unmountPractice);

const guide = libraryProgressGuide();
const step = (id: string) => guide.steps.find((entry) => entry.id === id)!;
const label = (element: Element) => element.textContent?.trim();
const status = (gameId: number) =>
  card(gameId)
    .querySelector('[aria-label^="Status: "]')
    ?.getAttribute("aria-label") ?? null;
const viewButton = (title: string) => {
  const button = q("demo-library-stage").querySelector<HTMLButtonElement>(
    `button[title="${title}"]`,
  );
  expect(button, title).not.toBeNull();
  return button!;
};
const columns = () => q("demo-library-cards").style.gridTemplateColumns;

describe("Progress & card layout", () => {
  it("keeps the rules for every step", () => {
    expect(guideProblems(guide, { version: 3, release: "1.1.17" })).toEqual([]);
    expect(guide.nextTourId).toBe("rate-games");
  });

  it("quotes no button the bulk bar does not have", () => {
    // The button reads "Select all 2 results".
    for (const entry of guide.steps)
      expect(`${entry.body} ${entry.task ?? ""}`, entry.id).not.toContain(
        "Select all results",
      );
  });

  it("turns selection on and selects both samples in one step", async () => {
    await startGuide("library-progress", "select");
    expect(label(target())).toBe("Select");
    await click(target());
    const first = target();
    expect(first.getAttribute("role")).toBe("checkbox");
    await click(first);
    const second = target();
    expect(second).not.toBe(first);
    expect(second.getAttribute("role")).toBe("checkbox");
    await click(second);
    await finishStep();
    expect(stepId()).toBe("apply");
    expect(label(target())).toBe("Set status");
  });

  it("can set the status together again after coming back", async () => {
    await startGuide("library-progress", "apply");
    await click(q("demo-bulk-set-status"));
    await click(q("demo-bulk-status-playing"));
    expect(status(WOW)).toBe("Status: In progress");
    await finishStep();
    expect(stepId()).toBe("status-menu");
    await goTo("apply", true);
    await finishStep(2000);
    expect(stepId()).toBe("apply");
    // Both samples are selected again and wait for the same pick.
    expect(label(q("demo-bulk-count"))).toBe("2 selected");
    await click(q("demo-bulk-set-status"));
    await click(q("demo-bulk-status-playing"));
    await finishStep();
    expect(stepId()).toBe("status-menu");
  });

  it("has an exercise that sets one game's status from its menu", async () => {
    await startGuide("library-progress", "status-menu");
    expect(step("status-menu").task).toContain("<b>Status</b>");
    await rightClick(card(WOW));
    expect(target().getAttribute("data-tour")).toBe("demo-menu-status");
    expect(label(target())).toBe("Status");
    await click(target());
    expect(label(target())).toBe("Finished");
    await click(target());
    expect(status(WOW)).toBe("Status: Finished");
    expect(status(GTA)).toBeNull();
    await finishStep();
    expect(stepId()).toBe("customize");
    expect(useAppStore.getState().gameJournals).toEqual({});
  });

  it("can set the status from the menu again after coming back", async () => {
    await startGuide("library-progress", "status-menu");
    await rightClick(card(WOW));
    await click(q("demo-menu-status"));
    await click(q("demo-status-finished"));
    await finishStep();
    await goTo("status-menu", true);
    await finishStep(2000);
    expect(stepId()).toBe("status-menu");
    await rightClick(card(WOW));
    await click(q("demo-menu-status"));
    expect(q("demo-status-finished").getAttribute("aria-checked")).toBe(
      "false",
    );
    await click(q("demo-status-finished"));
    await finishStep();
    expect(stepId()).toBe("customize");
  });

  it("sends the last step to Status in the menu, not to the Journal", () => {
    const finish = guide.steps.at(-1)!.body;
    expect(finish).toContain("<b>Status</b>");
    expect(finish).not.toContain("Journal");
  });

  it("shows the sample cards in My Games' default grid, not three per row", async () => {
    await startGuide("library-progress");
    expect(columns()).toBe("");
    expect(q("demo-library-cards").className).toContain(
      "2xl:grid-cols-[repeat(auto-fill,minmax(216px,1fr))]",
    );
  });

  it("opens Customize from a gear with a tooltip, into Layout and Card details", async () => {
    await startGuide("library-progress", "customize");
    const before = useAppStore.getState().settings;
    const gear = target();
    expect(gear.getAttribute("data-tour")).toBe("demo-customize-toggle");
    expect(gear.getAttribute("title")).toBe("Customize");
    expect(gear.getAttribute("aria-label")).toBe("Customize library view");
    expect(gear.textContent).toBe("");
    expect(has("demo-library-customize")).toBe(false);
    await click(gear);
    expect(
      [...q("demo-library-customize").querySelectorAll("h3")].map(label),
    ).toEqual(["Layout", "Card details"]);
    const slider = target() as HTMLInputElement;
    expect(slider.type).toBe("range");
    expect(labelOf(slider)).toBe("Cards per row");
    await type(slider, "6");
    expect(columns()).toBe("repeat(6, minmax(0, 1fr))");
    await finishStep();
    expect(stepId()).toBe("card-details");
    // The popover stays open for the next step.
    const toggle = target() as HTMLInputElement;
    expect(labelOf(toggle)).toBe("Status on cards");
    expect(toggle.checked).toBe(true);
    await click(toggle);
    expect(toggle.checked).toBe(false);
    expect(status(WOW)).toBeNull();
    await finishStep(2000);
    expect(stepId()).toBe("card-details");
    await click(toggle);
    expect(status(WOW)).not.toBeNull();
    await finishStep();
    expect(stepId()).toBe("finish");
    expect(useAppStore.getState().settings).toBe(before);
  });

  it("has Standard, Large and List buttons, and a card size resets Cards per row", async () => {
    await startGuide("library-progress", "customize");
    expect(viewButton("Standard cards").getAttribute("aria-pressed")).toBe(
      "true",
    );
    await click(target());
    await type(target(), "6");
    expect(columns()).toBe("repeat(6, minmax(0, 1fr))");
    await click(viewButton("Large cards"));
    expect(viewButton("Large cards").getAttribute("aria-pressed")).toBe("true");
    expect(columns()).toBe("");
    await click(viewButton("List"));
    expect(viewButton("List").getAttribute("aria-pressed")).toBe("true");
    // A list has no cards per row.
    expect(has("demo-grid-columns")).toBe(false);
    await click(viewButton("Standard cards"));
    expect(has("demo-grid-columns")).toBe(true);
    expect(columns()).toBe("");
  });

  it("opens Customize with the slider when its step is entered in list view", async () => {
    await startGuide("library-progress", "customize");
    await click(viewButton("List"));
    await goTo("customize", true);
    await click(target());
    expect(target().getAttribute("data-tour")).toBe("demo-grid-columns");
  });

  it.each(guide.steps.map((entry) => entry.id))(
    "shows its control when %s is entered directly",
    async (id) => {
      await startGuide("library-progress", id);
      expect(currentStep().id).toBe(id);
      target();
      await finishStep(2000);
      expect(stepId()).toBe(id);
    },
  );
});
