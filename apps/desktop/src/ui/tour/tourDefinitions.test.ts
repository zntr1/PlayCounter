import { describe, expect, it } from "vitest";
import { tours, type TourStep } from "./tourDefinitions";
import { backStepIndex, nextStepIndex, stepView } from "./tourNavigation";

describe("tour definitions", () => {
  it("use unique ids and safe demo-only selectors for interactive steps", () => {
    expect(new Set(tours().map((tour) => tour.id)).size).toBe(tours().length);
    for (const tour of tours()) {
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
          expect(
            Boolean(step.advanceOn) ||
              (Boolean(tour.practice || tour.simulation || tour.demoGame) &&
                step.manualAdvance),
          ).toBe(true);
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
    const step = (id: string, optional = false): TourStep => ({
      id,
      title: id,
      body: id,
      view: "keep",
      anchor: optional ? `[data-tour="${id}"]` : undefined,
      optional,
    });
    const steps = [step("before"), step("optional", true), step("after")];
    const absent = () => false;
    expect(nextStepIndex(steps, 0, 1, absent)).toBe(2);
    expect(nextStepIndex(steps, 2, -1, absent)).toBe(0);
  });

  it("does not make demo-backed steps optional", () => {
    expect(
      tours()
        .flatMap((tour) => tour.steps)
        .filter(
          (step) => step.optional && step.anchor?.includes('data-tour="demo-'),
        ),
    ).toEqual([]);
  });

  it("honours backTo and deterministic view directives", () => {
    const guide = tours().find((tour) => tour.id === "log-playtime")!;
    const fill = guide.steps.findIndex((step) => step.id === "fill-dialog");
    expect(guide.steps[backStepIndex(guide.steps, fill, () => true)].id).toBe(
      "open-menu",
    );
    expect(stepView(guide.steps[0], "now", "history")).toBe("games");
    expect(stepView(tours()[0].steps.at(-1)!, "settings", "history")).toBe(
      "history",
    );
  });

  it("walks through the Playtime submenu before choosing a session action", () => {
    const guide = tours().find((tour) => tour.id === "log-playtime")!;
    const opening = guide.steps.find((step) => step.id === "open-playtime")!;
    const action = guide.steps.find((step) => step.id === "pick-item")!;
    expect(opening.anchor).toBe('[data-tour="demo-menu-playtime"]');
    expect(opening.advanceOn).toEqual({
      type: "anchor-present",
      selector: '[data-tour="demo-menu-log-session"]',
    });
    // The flyout is portalled outside the parent menu. It needs its own
    // allowed region, and closing it should return to the submenu step.
    expect(action.allow).toContain('[data-tour="demo-playtime-menu"]');
    expect(action.retreatWhenMissing).toBe('[data-tour="demo-playtime-menu"]');
    expect(action.backTo).toBe("open-playtime");
  });

  it("rings the action a step names once its flyout or dialog is open", () => {
    const flyouts: Record<string, string[]> = {
      "demo-menu-playtime": [
        "demo-playtime-menu",
        "demo-menu-log-session",
        "demo-menu-adjust-playtime",
        "demo-menu-start-timer",
      ],
      "demo-menu-launch-options": ["demo-launch-menu", "demo-menu-launch-file"],
      "demo-menu-matching": [
        "demo-matching-menu",
        "demo-menu-check-matches",
        "demo-menu-report-match",
        "demo-menu-convert-custom",
      ],
      "demo-menu-tier": ["demo-tier-menu", "demo-tier-S"],
    };
    for (const tour of tours()) {
      for (const step of tour.steps) {
        const targets = step.anchorTargets ?? [];
        for (const [trigger, items] of Object.entries(flyouts)) {
          const at = targets.indexOf(`[data-tour="${trigger}"]`);
          if (at < 0) continue;
          // Something inside the open flyout must win over its trigger.
          expect(
            targets
              .slice(0, at)
              .some((target) =>
                items.some((item) => target === `[data-tour="${item}"]`),
              ),
            `${tour.id}/${step.id}`,
          ).toBe(true);
        }
        // Every dialog the practice menu opens is followed, Ignore included.
        if (targets.includes('[data-tour="demo-remove-dialog"]'))
          expect(targets, `${tour.id}/${step.id}`).toContain(
            '[data-tour="demo-ignore-dialog"]',
          );
      }
    }
    const step = (tourId: string, id: string) =>
      tours()
        .find((tour) => tour.id === tourId)!
        .steps.find((entry) => entry.id === id)!;
    expect(step("log-playtime", "total").anchorTargets).toContain(
      '[data-tour="demo-menu-adjust-playtime"]',
    );
    expect(step("emulators", "fix-match").anchorTargets).toContain(
      '[data-tour="demo-emulator-actions"]',
    );
  });

  it("keeps skip, back, and follow-up destinations reachable", () => {
    for (const tour of tours()) {
      if (tour.nextTourId)
        expect(tours().some((next) => next.id === tour.nextTourId)).toBe(true);
      for (const step of tour.steps) {
        for (const destination of [step.skipTo, step.backTo].filter(Boolean)) {
          expect(
            tour.steps.some((candidate) => candidate.id === destination),
          ).toBe(true);
        }
      }
    }
  });

  it("offers read-only backup and feedback guides alongside the practice tours", () => {
    const release = tours().filter((tour) => tour.release === "1.1.17");
    expect(
      release.filter((tour) => tour.practice).map((tour) => tour.id),
    ).toEqual(["notes-playthroughs", "organize-library", "library-progress"]);
  });
});
