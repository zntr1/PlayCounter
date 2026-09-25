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
      TOURS.flatMap((tour) => tour.steps).filter(
        (step) => step.optional && step.anchor?.includes('data-tour="demo-'),
      ),
    ).toEqual([]);
  });

  it("documents the emulator live view and management page", () => {
    const guide = TOURS.find((tour) => tour.id === "emulators")!;
    expect(guide.version).toBe(4);
    expect(guide.steps.map((step) => step.id)).toEqual([
      "intro",
      "settings",
      "menu",
      "now-emulating",
      "emulator-page",
      "linked-games",
      "confirm",
      "fix-match",
      "pcsx2",
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
    expect(confirm.anchorTargets).toContain(
      '[data-tour="demo-emulator-confirm"]',
    );
    expect(confirm.body).toContain("the game you just started");
    expect(confirm.body).not.toContain("the file");
    const fixMatch = guide.steps.find((step) => step.id === "fix-match")!;
    expect(fixMatch.body).toContain("Change");
    expect(fixMatch.body).toContain("Forget");
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

  it("walks through the Playtime submenu before choosing a session action", () => {
    const guide = TOURS.find((tour) => tour.id === "log-playtime")!;
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

  it("documents the My Games context-menu action groups", () => {
    const guide = TOURS.find((tour) => tour.id === "game-actions")!;
    expect(guide.demoGame).toBe(true);
    expect(guide.steps.map((step) => step.id)).toEqual([
      "intro",
      "open-menu",
      "details",
      "history",
      "playtime",
      "matches",
      "wrong-match",
      "remove",
    ]);
    // Back returns to the previous action, not all the way to the menu step.
    const index = (id: string) =>
      guide.steps.findIndex((step) => step.id === id);
    expect(backStepIndex(guide.steps, index("playtime"), () => true)).toBe(
      index("history"),
    );
    // Targets follow the open flyout to the action a step is about.
    const step = (id: string) => guide.steps.find((entry) => entry.id === id)!;
    expect(step("matches").anchorTargets).toContain(
      '[data-tour="demo-menu-check-matches"]',
    );
    expect(step("remove").additionalAnchors).toContain(
      '[data-tour="demo-menu-ignore"]',
    );
  });

  it("rings the action a step names once its flyout or dialog is open", () => {
    const flyouts: Record<string, string[]> = {
      "demo-menu-playtime": [
        "demo-playtime-menu",
        "demo-menu-log-session",
        "demo-menu-adjust-playtime",
      ],
      "demo-menu-launch-options": ["demo-launch-menu", "demo-menu-launch-file"],
      "demo-menu-matching": [
        "demo-matching-menu",
        "demo-menu-check-matches",
        "demo-menu-report-match",
      ],
    };
    for (const tour of TOURS) {
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
      TOURS.find((tour) => tour.id === tourId)!.steps.find(
        (entry) => entry.id === id,
      )!;
    expect(step("log-playtime", "alternative").anchorTargets).toContain(
      '[data-tour="demo-menu-adjust-playtime"]',
    );
    expect(step("launch-games", "set-forget").anchorTargets).toContain(
      '[data-tour="demo-menu-launch-file"]',
    );
    for (const [id, button] of [
      ["add-share", "add-share"],
      ["add-custom", "add-custom"],
      ["ignore", "ignore"],
      ["skip", "skip"],
    ])
      expect(step("fix-detection", id).anchorTargets).toContain(
        `[data-tour="demo-discovery"] [data-tour="discovered-${button}"]`,
      );
    expect(step("emulators", "fix-match").anchorTargets).toContain(
      '[data-tour="demo-emulator-actions"]',
    );
    expect(step("import-library", "confirm").anchorTargets).toContain(
      '[data-tour="demo-import-match"]',
    );
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
    ).toContain("Select/View + R1/RB");
  });

  it("keeps skip, back, and follow-up destinations reachable", () => {
    for (const tour of TOURS) {
      if (tour.nextTourId)
        expect(TOURS.some((next) => next.id === tour.nextTourId)).toBe(true);
      for (const step of tour.steps) {
        for (const destination of [step.skipTo, step.backTo].filter(Boolean)) {
          expect(
            tour.steps.some((candidate) => candidate.id === destination),
          ).toBe(true);
        }
      }
    }
  });

  it("walks through every preference section in Personalize PlayCounter", () => {
    const guide = TOURS.find((tour) => tour.id === "settings")!;
    expect(guide.steps.map((step) => step.id)).toEqual([
      "intro",
      "general",
      "appearance",
      "shortcuts",
      "notifications",
      "launcher",
      "emulators",
      "sharing",
      "backup",
      "updates",
    ]);
    // Windows-only panels are skipped elsewhere instead of showing an empty step.
    for (const id of ["notifications", "launcher"])
      expect(guide.steps.find((step) => step.id === id)?.optional).toBe(true);
    // Import replaces data: the backup step only points at the panel.
    expect(guide.steps.find((step) => step.id === "backup")?.interactive).toBe(
      undefined,
    );
  });

  it("offers read-only backup and feedback guides alongside the practice tours", () => {
    const release = TOURS.filter((tour) => tour.release === "1.1.17");
    expect(
      release.filter((tour) => tour.practice).map((tour) => tour.id),
    ).toEqual(["notes-playthroughs", "organize-library", "library-progress"]);
    for (const id of ["backup-data", "feedback-replies"]) {
      expect(
        release
          .find((tour) => tour.id === id)
          ?.steps.every((step) => !step.interactive),
      ).toBe(true);
    }
  });
});
