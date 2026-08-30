import { describe, expect, it } from "vitest";
import { TOURS, type TourStep } from "./tourDefinitions";
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
      TOURS.flatMap((tour) => tour.steps).filter(
        (step) => step.optional && step.anchor?.includes('data-tour="demo-'),
      ),
    ).toEqual([]);
  });

  it("documents the emulator live view and management page", () => {
    const guide = TOURS.find((tour) => tour.id === "emulators")!;
    expect(guide.version).toBe(2);
    expect(guide.steps.map((step) => step.id)).toEqual([
      "intro",
      "settings",
      "menu",
      "now-emulating",
      "emulator-page",
      "linked-games",
      "confirm",
      "fix-match",
      "library",
    ]);
    expect(guide.steps.every((step) => !step.optional)).toBe(true);
    const menu = guide.steps.find((step) => step.id === "menu")!;
    expect(
      guide.steps.find((step) => step.id === "settings")?.scrollIntoView,
    ).toBe(true);
    expect(menu.body).toContain("first time PlayCounter sees");
    expect(menu.body).toContain("Now Emulating works differently");
    expect(
      guide.steps.find((step) => step.id === "emulator-page")?.body,
    ).toContain("all of its game matches");
    const confirm = guide.steps.find((step) => step.id === "confirm")!;
    expect(confirm.anchor).toBe('[data-tour="demo-emulator-confirm"]');
    expect(confirm.body).toContain("the game you just started");
    expect(confirm.body).not.toContain("the file");
    const fixMatch = guide.steps.find((step) => step.id === "fix-match")!;
    expect(fixMatch.body).toContain("Change game");
    expect(fixMatch.body).toContain("Forget game");
    expect(fixMatch.body).toContain("Share match");
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

  it("documents the My Games context-menu action groups", () => {
    const guide = TOURS.find((tour) => tour.id === "game-actions")!;
    expect(guide.demoGame).toBe(true);
    expect(guide.steps.map((step) => step.id)).toEqual([
      "intro",
      "open-menu",
      "history",
      "playtime",
      "matches",
      "wrong-match",
      "remove",
    ]);
    expect(
      guide.steps.slice(2).every((step) => step.backTo === "open-menu"),
    ).toBe(true);
  });

  it("explains the opt-in launcher and its controller flow", () => {
    const guide = TOURS.find((tour) => tour.id === "launch-games")!;
    expect(guide.demoGame).toBe(true);
    expect(guide.steps.map((step) => step.id)).toEqual([
      "intro",
      "enable",
      "learned",
      "set-forget",
      "limits",
      "privacy",
      "controller",
    ]);
    expect(
      guide.steps.find((step) => step.id === "controller")?.body,
    ).toContain("View + RB");
  });
});
