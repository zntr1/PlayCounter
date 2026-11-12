// @vitest-environment happy-dom
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../../store";
import { rateGamesGuide } from "./rateGames";
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
  mountPractice,
  q,
  rightClick,
  startGuide,
  stepId,
  target,
  unmountPractice,
} from "./libraryPractice.test.util";

/* "Rate your games" (docs/tours-plan.md, WP4 row): the filter step rings the
   tier the player picked, whichever letter that was. */

vi.mock("../../../tracker");
vi.mock("../../../platform", () => ({ currentPlatform: () => "windows" }));

beforeEach(mountPractice);
afterEach(unmountPractice);

const guide = rateGamesGuide();
const label = (element: Element) => element.textContent?.trim();

async function rate(tier: string) {
  await rightClick(card(GTA));
  await click(q("demo-menu-tier"));
  await click(q(`demo-tier-${tier}`));
}

async function sortBy(key: string) {
  const sort = q<HTMLSelectElement>("demo-sort");
  await act(() => {
    sort.value = key;
    sort.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

describe("Rate your games", () => {
  it("keeps the rules for every step", () => {
    expect(
      guideProblems(guide, {
        version: 2,
        release: "1.4.3",
        // Built by the app: "Sort: {{label}}" and "<tier>S</tier> – Best".
        composed: ["Sort: Tier", "S – Best"],
      }),
    ).toEqual([]);
  });

  it("rings the tier the player picked, not always S", async () => {
    await startGuide("rate-games", "rate");
    expect(target()).toBe(card(GTA));
    await rate("B");
    await finishStep();
    expect(stepId()).toBe("sort");
    await goTo("filter");
    expect(label(target())).toBe("B");
    expect(
      target().closest('[data-tour="demo-library-filters"]'),
    ).not.toBeNull();
    await click(target());
    expect(cardIds()).toEqual([GTA]);
    await finishStep();
    expect(stepId()).toBe("finish");
    expect(cardIds()).toEqual([GTA, WOW]);
    expect(useAppStore.getState().gameJournals).toEqual({});
  });

  it("rings S when the rating was skipped, because the practice gives it S", async () => {
    await startGuide("rate-games", "filter");
    expect(label(target())).toBe("S");
    await click(target());
    await finishStep();
    expect(stepId()).toBe("finish");
  });

  it("can sort by tier again after coming back", async () => {
    await startGuide("rate-games", "sort");
    expect(cardIds()).toEqual([WOW, GTA]);
    await sortBy("tier");
    expect(cardIds()).toEqual([GTA, WOW]);
    await finishStep();
    expect(stepId()).toBe("filter");
    await goTo("sort", true);
    await finishStep(2000);
    expect(stepId()).toBe("sort");
    expect(q<HTMLSelectElement>("demo-sort").value).not.toBe("tier");
    await sortBy("tier");
    await finishStep();
    expect(stepId()).toBe("filter");
  });

  it("can pick the tier filter again after coming back", async () => {
    await startGuide("rate-games", "filter");
    await click(target());
    await finishStep();
    await goTo("filter", true);
    await finishStep(2000);
    expect(stepId()).toBe("filter");
    expect(target().getAttribute("aria-pressed")).toBe("false");
    expect(cardIds()).toEqual([GTA, WOW]);
    await click(target());
    await finishStep();
    expect(stepId()).toBe("finish");
  });

  it.each(guide.steps.map((entry) => entry.id))(
    "shows its control when %s is entered directly",
    async (id) => {
      await startGuide("rate-games", id);
      expect(currentStep().id).toBe(id);
      target();
      await finishStep(2000);
      expect(stepId()).toBe(id);
    },
  );
});
