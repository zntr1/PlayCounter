import { describe, expect, it } from "vitest";
import { isShareableEmulatorMapping } from "../../emulators/share";
import { tours } from "./tourDefinitions";
import {
  emulatorTourDemoActive,
  sampleStageForStep,
  stepAsksForSampleEntry,
  tourDemoEmulatorMapping,
  tourDemoEmulatorSession,
  tourSampleMatches,
} from "./tourDemoGame";

const a = (name: string) => `[data-tour="${name}"]`;

describe("what the sample card shows when a step starts", () => {
  const closed = {
    menu: false,
    flyout: null,
    logSession: false,
    hoverButtons: false,
    details: null,
  };

  it("leaves the menu closed on the step that asks for the right-click", () => {
    // The step finishes when the menu appears: naming the menu as the goal
    // must not open it.
    expect(
      sampleStageForStep({
        anchor: a("demo-game-card"),
      }),
    ).toEqual(closed);
    expect(sampleStageForStep(undefined)).toEqual(closed);
  });

  it("opens the menu for a step that rings one of its entries", () => {
    expect(
      sampleStageForStep({
        anchor: a("demo-game-card"),
        anchorTargets: [a("demo-game-details"), a("demo-menu-details")],
      }),
    ).toEqual({ ...closed, menu: true });
    expect(
      sampleStageForStep({
        anchor: a("demo-menu-playtime"),
        retreatWhenMissing: a("demo-context-menu"),
      }),
    ).toEqual({ ...closed, menu: true });
  });

  it("opens the flyout a step rings or holds on to", () => {
    expect(
      sampleStageForStep({
        anchor: a("demo-menu-log-session"),
        retreatWhenMissing: a("demo-playtime-menu"),
      }),
    ).toEqual({ ...closed, menu: true, flyout: "demo-playtime-menu" });
    expect(
      sampleStageForStep({
        anchor: a("demo-game-card"),
        anchorTargets: [a("demo-matching-menu"), a("demo-menu-matching")],
      }),
    ).toEqual({ ...closed, menu: true, flyout: "demo-matching-menu" });
  });

  it("opens Log a missed session for the step about that dialog, without the menu", () => {
    expect(
      sampleStageForStep({
        anchor: a("demo-log-session-confirm"),
        retreatWhenMissing: a("demo-log-session-dialog"),
      }),
    ).toEqual({ ...closed, logSession: true });
  });

  it("shows the cover's hover buttons for a step that rings one", () => {
    expect(sampleStageForStep({ anchor: a("demo-card-log-session") })).toEqual({
      ...closed,
      hoverButtons: true,
    });
  });

  it("opens Details on the tab a step asks for", () => {
    expect(
      sampleStageForStep({
        anchor: a("demo-game-details"),
        sampleDetails: "counters",
      }),
    ).toEqual({ ...closed, details: "counters" });
  });

  it("finds the stage from the step itself, wherever the step sits in its guide", () => {
    // The old sample opened its menu on step numbers 2, 3 and 6 of
    // log-playtime, on every step from 2 of game-actions and on step 3 of
    // launch-games: one more step in a guide moved the menu to the wrong one.
    for (const tour of tours().filter((guide) => guide.demoGame)) {
      for (const step of tour.steps) {
        const ringsMenuEntry = [step.anchor, ...(step.anchorTargets ?? [])]
          .join(" ")
          .includes('data-tour="demo-menu-');
        const stage = sampleStageForStep(step);
        if (ringsMenuEntry)
          expect(stage.menu, `${tour.id}/${step.id}`).toBe(true);
      }
    }
    const stageOf = (tourId: string, stepId: string) =>
      sampleStageForStep(
        tours()
          .find((tour) => tour.id === tourId)!
          .steps.find((step) => step.id === stepId),
      );
    expect(stageOf("log-playtime", "intro").menu).toBe(false);
    expect(stageOf("log-playtime", "open-menu").menu).toBe(false);
    expect(stageOf("log-playtime", "open-playtime").menu).toBe(true);
    expect(stageOf("log-playtime", "pick-item")).toMatchObject({
      menu: true,
      flyout: "demo-playtime-menu",
    });
    expect(stageOf("log-playtime", "fill-dialog")).toMatchObject({
      menu: false,
      logSession: true,
    });
    expect(stageOf("log-playtime", "result").menu).toBe(false);
    expect(stageOf("log-playtime", "alternative").menu).toBe(true);
    expect(stageOf("game-actions", "open-menu").menu).toBe(false);
    expect(stageOf("launch-games", "play").menu).toBe(false);
    expect(stageOf("launch-games", "launch-file").menu).toBe(true);
  });

  it("knows which entry of the sample card a step asks for", () => {
    const step = {
      anchor: a("demo-game-card"),
      anchorTargets: [a("demo-menu-check-matches"), a("demo-menu-matching")],
    };
    expect(stepAsksForSampleEntry(step, "check-matches")).toBe(true);
    expect(stepAsksForSampleEntry(step, "report-match")).toBe(false);
    expect(
      stepAsksForSampleEntry(
        { anchor: a("demo-card-log-session") },
        "log-session",
      ),
    ).toBe(true);
    expect(stepAsksForSampleEntry(undefined, "details")).toBe(false);
  });
});

describe("sample matches for Check for Matches", () => {
  it("are the sample's community match and IGDB's entry, with ids no real game has", () => {
    const matches = tourSampleMatches();
    expect(matches.map((match) => match.source)).toEqual(["community", "igdb"]);
    expect(matches.every((match) => match.id < 0)).toBe(true);
    expect(matches.every((match) => match.igdbId === undefined)).toBe(true);
  });
});

describe("emulator tour demo", () => {
  it("is active only for the Dolphin emulator guide", () => {
    expect(emulatorTourDemoActive(null)).toBe(false);
    expect(emulatorTourDemoActive("core")).toBe(false);
    expect(emulatorTourDemoActive("emulators")).toBe(true);
    expect(emulatorTourDemoActive("emulators", "dolphin")).toBe(true);
    expect(emulatorTourDemoActive("emulators", "dosbox")).toBe(false);
  });

  it("uses non-persistable identities", () => {
    const mapping = tourDemoEmulatorMapping();
    const session = tourDemoEmulatorSession("2026-08-21T08:00:00.000Z");

    expect(mapping.gameId).toBeLessThan(0);
    expect(mapping.igdbId).toBeUndefined();
    expect(mapping.contentKey).toMatch(/^playcounter-tour:/);
    expect(mapping.decision).toBe("game");
    expect(mapping.needsConfirmation).toBe(true);
    expect(mapping.coverUrl).toBe("/tour/zelda-wind-waker-cover.webp");
    expect(session.id).toBeLessThan(0);
    expect(session.igdbId).toBeUndefined();
    expect(
      isShareableEmulatorMapping(mapping, {
        privateTokens: [],
        privacyReady: true,
      }),
    ).toBe(false);
  });
});
