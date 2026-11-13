// @vitest-environment happy-dom
/* "Read your stats" (docs/tours-plan.md, WP4): one step for the ranges that
   finishes when the player changes the range, one for stepping back and the
   comparison, one for what a session row offers, one that names the charts
   and finishes on the Games tab, and a last step that keeps the history in
   view and hands over to "Achievements & trophies". Every ring sits on a
   control, never on the whole practice. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../tracker");
vi.mock("../../../platform", () => ({ currentPlatform: () => "windows" }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => []),
  convertFileSrc: (value: string) => value,
}));

import { useAppStore } from "../../../store";
import * as tracker from "../../../tracker";
import { boldNames, expectStepRules, stepOf } from "./guideRules.test.kit";
import {
  all,
  click,
  control,
  goTo,
  mountHistory,
  named,
  ownSession,
  q,
  rightClick,
  rows,
  startGuide,
  stepId,
  target,
  unmountHistory,
} from "./historyPractice.test.util";
import { a } from "./shared";
import { statsGuide } from "./stats";

beforeEach(mountHistory);
afterEach(unmountHistory);

const guide = statsGuide();
const ids = guide.steps.map((step) => step.id);

describe("Read your stats: the guide", () => {
  it("keeps the rules every step follows", () => {
    expectStepRules(guide);
  });

  it("is reworked for the next release and leads on to Achievements & trophies", () => {
    expect(guide.version).toBe(3);
    expect(guide.release).toBeUndefined();
    expect(guide.nextTourId).toBe("game-achievements");
  });

  it("has one step for the ranges and one for what a row offers", () => {
    expect(ids.indexOf("ranges")).toBeGreaterThan(0);
    expect(ids.indexOf("sessions")).toBeGreaterThan(ids.indexOf("ranges"));
    // The range step asks for a change and finishes on it.
    expect(stepOf(guide, "ranges").task).toBeTruthy();
    expect(stepOf(guide, "ranges").advanceOn).toEqual({
      type: "event",
      name: "demo.step-completed",
    });
    expect(boldNames(stepOf(guide, "ranges").body)).toContain("Pick dates");
    // The row step rings a row.
    expect(stepOf(guide, "sessions").anchor).toContain(
      'data-tour="demo-history-row"',
    );
  });

  it("never rings the whole practice", () => {
    for (const step of guide.steps) {
      for (const selector of [step.anchor, ...(step.anchorTargets ?? [])]) {
        expect(selector, step.id).not.toBe(a("demo-stats"));
        expect(selector, step.id).not.toBe(a("demo-library-stage"));
      }
    }
  });

  it("names the charts and the row menu in the app's own words", () => {
    expect(boldNames(stepOf(guide, "charts").body)).toEqual(
      expect.arrayContaining([
        "Playtime over time",
        "Game seasons",
        "Cover calendar",
        "Pace",
        "Play habits",
        "When you play",
      ]),
    );
    expect(boldNames(stepOf(guide, "charts").task)).toEqual(["Games"]);
    expect(boldNames(stepOf(guide, "sessions").body)).toEqual(
      expect.arrayContaining([
        "Playthroughs",
        "Filter for this game",
        "Playtime",
        "Delete Session",
      ]),
    );
    // "open its journal" matched no label of the menu.
    expect(stepOf(guide, "sessions").body).not.toMatch(/journal/i);
  });
});

describe("Read your stats: the practice", () => {
  it("rings something in every step after the first, entered in any order", async () => {
    await startGuide("stats");
    // The first step is for reading and rings nothing.
    const ringed = ids.slice(1);
    for (const id of [...ringed].reverse()) {
      await goTo(id);
      expect(target(), id).toBeTruthy();
    }
    // Back and a jump from the checklist reset the sample.
    for (const id of ringed) {
      await goTo(id, true);
      expect(target(), id).toBeTruthy();
    }
  });

  it("starts with the big number in view, before any ring", async () => {
    await startGuide("stats");
    const total = document.querySelector('[data-tour="demo-history-total"]');
    expect(total?.tagName).toBe("H1");
    expect(total?.textContent).toContain("played in total");
  });

  it("finishes the range step when the player changes the range", async () => {
    await startGuide("stats", "ranges");
    expect(target().getAttribute("aria-label")).toBe("Range");
    // The range it is on already is no change.
    await click(q('[data-chip="all"]'));
    expect(stepId()).toBe("ranges");
    await click(q('[data-chip="last7"]'));
    expect(stepId()).toBe("compare");
  });

  it("does not bounce forward after Back", async () => {
    await startGuide("stats", "ranges");
    await click(q('[data-chip="last7"]'));
    expect(stepId()).toBe("compare");
    await goTo("ranges", true);
    expect(stepId()).toBe("ranges");
    // The sample is back on All time.
    expect(q('[data-chip="all"]').getAttribute("aria-pressed")).toBe("true");
  });

  it("shows the comparison on 7 days and finishes when the player steps back", async () => {
    await startGuide("stats", "compare");
    // Entered directly: the step sets up its own range.
    expect(q("[data-history-range]").textContent).toBe("7 days");
    expect(q("[data-history-compare]").textContent).toMatch(/than|as much/);
    expect(target().contains(q('[aria-label="Previous period"]'))).toBe(true);
    await click(q('[aria-label="Previous period"]'));
    expect(stepId()).toBe("sessions");
  });

  it("shows the six sample sessions and lets the player try a row", async () => {
    useAppStore.setState({ recentSessions: [ownSession] });
    const before = useAppStore.getState().recentSessions;
    await startGuide("stats", "sessions");
    expect(rows()).toHaveLength(6);
    expect(target()).toBe(rows()[0]);
    expect(stepOf(guide, "sessions").task).toBeUndefined();

    // The row's menu works on the sample: the filter stays a badge here.
    await rightClick(rows()[0]);
    await click(control("Filter for this game"));
    expect(
      q(`${named("demo-stats")} [aria-label="Clear game filter"]`),
    ).toBeTruthy();
    expect(useAppStore.getState().historyGameKey).toBeNull();
    expect(stepId()).toBe("sessions");

    // Deleting a sample session leaves the player's own history alone.
    await click(q('[aria-label="Clear game filter"]'));
    await click(q('[aria-label^="Remove history entry for"]'));
    await click(
      all(`${named("demo-history-delete")} button`).find(
        (button) => button.textContent === "Delete session",
      )!,
    );
    expect(rows()).toHaveLength(5);
    expect(tracker.removeHistorySession).not.toHaveBeenCalled();
    expect(useAppStore.getState().recentSessions).toBe(before);
    expect(stepId()).toBe("sessions");
  });

  it("opens the Playtime flyout's entries while the guide runs", async () => {
    await startGuide("stats", "sessions");
    await rightClick(rows()[0]);
    await click(control("Playtime"));
    await click(control("Edit session"));
    expect(q(named("demo-history-edit")).textContent).toContain("Length");
  });

  it("names only charts that Insights shows, and finishes on the Games tab", async () => {
    await startGuide("stats", "charts");
    expect(q('[role="tab"][aria-selected="true"]').textContent).toContain(
      "Insights",
    );
    const headings = all("h2").map((heading) => heading.textContent);
    for (const name of boldNames(stepOf(guide, "charts").body).filter(
      (entry) => entry !== "Insights",
    ))
      expect(headings, name).toContain(name);
    expect(target().textContent).toContain("Playtime over time");

    // Only the tab the step asks for finishes it.
    await click(q("#history-tab-sessions"));
    expect(stepId()).toBe("charts");
    await goTo("charts", true);
    await click(q("#history-tab-games"));
    expect(stepId()).toBe("games");
  });

  it("keeps the sections of the player's own Insights as they are", async () => {
    await startGuide("stats", "charts");
    await click(q('[aria-label="Collapse Playtime over time"]'));
    expect(
      document.querySelector('[aria-label="Expand Playtime over time"]'),
    ).not.toBeNull();
    expect(useAppStore.getState().collapsedSections).toEqual([]);
  });

  it("ends on the Games tab with the history still in view", async () => {
    await startGuide("stats", "games");
    expect(q('[role="tab"][aria-selected="true"]').id).toBe(
      "history-tab-games",
    );
    expect(target().id).toBe("history-panel-games");
    expect(q(`${named("demo-stats")} ${named("history-hero")}`)).toBeTruthy();
  });
});
