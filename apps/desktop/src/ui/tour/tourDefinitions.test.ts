import { describe, expect, it } from "vitest";
import { TOURS } from "./tourDefinitions";
import { backStepIndex, nextStepIndex, stepView } from "./tourNavigation";

describe("tour definitions", () => {
  it("use unique ids and safe demo-only selectors for interactive steps", () => {
    expect(new Set(TOURS.map((tour) => tour.id)).size).toBe(TOURS.length);
    for (const tour of TOURS) {
      expect(new Set(tour.steps.map((step) => step.id)).size).toBe(
        tour.steps.length,
      );
      for (const step of tour.steps.filter(
        (candidate) => candidate.interactive,
      )) {
        expect(step.allow?.length).toBeGreaterThan(0);
        if (step.persistentInteraction) {
          expect(step.manualAdvance).toBe(true);
          expect(step.anchor).toContain('data-tour="settings-');
          expect(
            step.allow?.every((selector) =>
              selector.includes('data-tour="settings-'),
            ),
          ).toBe(true);
        } else {
          expect(step.advanceOn).toBeDefined();
          expect(step.anchor).toContain('data-tour="demo-');
          expect(
            step.allow?.every((selector) =>
              selector.includes('data-tour="demo-'),
            ),
          ).toBe(true);
        }
      }
    }
  });

  it("skips unavailable optional steps in both directions", () => {
    const steps = TOURS.find((tour) => tour.id === "emulators")!.steps;
    const settings = steps.findIndex((step) => step.id === "settings");
    const library = steps.findIndex((step) => step.id === "library");
    const absent = () => false;
    expect(nextStepIndex(steps, settings, 1, absent)).toBe(library);
    expect(nextStepIndex(steps, library, -1, absent)).toBe(settings);
  });

  it("honours backTo and deterministic view directives", () => {
    const guide = TOURS.find((tour) => tour.id === "log-playtime")!;
    const fill = guide.steps.findIndex((step) => step.id === "fill-dialog");
    expect(guide.steps[backStepIndex(guide.steps, fill, () => true)].id).toBe(
      "open-menu",
    );
    expect(stepView(guide.steps[0], "now", "history")).toBe("games");
    expect(stepView(TOURS[0].steps.at(-1)!, "settings", "history")).toBe(
      "history",
    );
  });
});
