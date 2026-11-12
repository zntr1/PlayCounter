// @vitest-environment happy-dom
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(async () => undefined),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("../../tracker");
vi.mock("../../platform", () => ({ currentPlatform: () => "windows" }));

import { counterName, journalCounters } from "../../counters";
import { getGameJournal, useAppStore } from "../../store";
import {
  buildAchievementCatalog,
  buildGameLadders,
  summarizeAchievements,
} from "../views/achievements/achievementCatalog";
import { findTour } from "./tourDefinitions";
import { TOUR_DEMO_GAME, TOUR_GTA_GAME_ID } from "./tourDemoGame";
import {
  completeTourStep,
  tourCounters,
  tourDemoDetails,
  tourSampleAchievementsPage,
} from "./tourDemoDetails";
import { TOUR_EVENT } from "./tourEvents";

/* The sample data behind the sample game's Details and the sample
   Achievements page (docs/tours-plan.md, WP5): bundled, never loaded, and
   thrown away when the guide ends. */

const wow = { kind: "tour-demo", gameId: TOUR_DEMO_GAME.gameId } as const;
const store = () => useAppStore.getState();

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  useAppStore.setState(useAppStore.getInitialState(), true);
  invokeMock.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the sample game's details", () => {
  it("has a description, facts and three times to beat for World of Warcraft", () => {
    const sample = tourDemoDetails(wow)!;
    expect(sample.details.summary?.length).toBeGreaterThan(80);
    expect(sample.details.developers).toEqual(["Blizzard Entertainment"]);
    expect(sample.details.publishers.length).toBeGreaterThan(0);
    expect(sample.details.genres.length).toBeGreaterThan(0);
    expect(sample.details.gameModes.length).toBeGreaterThan(0);
    expect(sample.details.platforms.length).toBeGreaterThan(0);
    expect(sample.details.releaseDate).toBe("2004-11-23");
    const time = sample.details.timeToBeat!;
    expect(time.hastilySeconds).toBeGreaterThan(0);
    expect(time.normallySeconds).toBeGreaterThan(time.hastilySeconds!);
    expect(time.completelySeconds).toBeGreaterThan(time.normallySeconds!);
    expect(time.count).toBeGreaterThan(0);
  });

  it("uses only bundled pictures, so nothing is loaded", () => {
    const { details, achievements } = tourDemoDetails(wow)!;
    for (const url of [
      ...(details.heroUrls ?? []),
      ...(details.artworkUrls ?? []),
      ...(details.screenshotUrls ?? []),
    ])
      expect(url.startsWith("/tour/"), url).toBe(true);
    expect(
      achievements.filter((entry) => entry.iconUrl || entry.lockedIconUrl),
    ).toEqual([]);
  });

  it("has achievements of one launcher: some unlocked with dates, some locked", () => {
    const { achievements } = tourDemoDetails(wow)!;
    const unlocked = achievements.filter((entry) => entry.unlocked);
    const locked = achievements.filter((entry) => !entry.unlocked);
    expect(unlocked.length).toBeGreaterThanOrEqual(3);
    expect(locked.length).toBeGreaterThanOrEqual(3);
    for (const entry of unlocked) {
      expect(entry.unlockedAt, entry.id).toBeGreaterThan(0);
      expect(entry.unlockedAt, entry.id).toBeLessThanOrEqual(Date.now());
    }
    expect(locked.every((entry) => entry.unlockedAt === undefined)).toBe(true);
    expect(new Set(achievements.map((entry) => entry.id)).size).toBe(
      achievements.length,
    );
    // No cups, Gamerscore or XP mixed in from other launchers.
    expect(
      achievements.filter(
        (entry) =>
          entry.trophyType !== undefined ||
          entry.gamerscore !== undefined ||
          entry.xp !== undefined,
      ),
    ).toEqual([]);
  });

  it("gives every sort something to sort by", () => {
    const { achievements } = tourDemoDetails(wow)!;
    const dates = achievements.flatMap((entry) => entry.unlockedAt ?? []);
    expect(new Set(dates).size).toBe(dates.length);
    const shares = achievements.map((entry) => entry.globalPercent);
    expect(shares.every((share) => share !== undefined)).toBe(true);
    expect(new Set(shares).size).toBe(shares.length);
  });

  it("has nothing for the other sample games and for real games", () => {
    expect(
      tourDemoDetails({ kind: "tour-demo", gameId: TOUR_GTA_GAME_ID }),
    ).toBeNull();
    // An own game may carry the same id as the sample.
    expect(
      tourDemoDetails({ kind: "tracked", gameId: TOUR_DEMO_GAME.gameId }),
    ).toBeNull();
    expect(tourDemoDetails({ gameId: 119133 })).toBeNull();
  });
});

describe("the sample counters", () => {
  const start = () => act(async () => store().startTour("counters"));

  it("start with Deaths and counts over several sessions, one of them running", async () => {
    await start();
    const { store: sample, game } = tourCounters();
    const state = sample.getState();
    const counters = journalCounters(getGameJournal(state, game));
    expect(counters.map(counterName)).toContain("Deaths");
    expect(counters.length).toBeGreaterThanOrEqual(2);
    // Nothing is preset: the player picks every key.
    expect(counters.filter((counter) => counter.key)).toEqual([]);
    const counted = state.recentSessions.filter((session) => session.counts);
    expect(counted.length).toBeGreaterThanOrEqual(3);
    expect(state.activeSessions).toHaveLength(1);
    expect(state.activeSessions[0].gameId).toBe(TOUR_DEMO_GAME.gameId);
  });

  it("keep what the player adds out of the real library", async () => {
    await start();
    const before = store().gameJournals;
    const { store: sample, game } = tourCounters();
    const id = sample.getState().addGameCounter(game, "Runs");
    expect(id).toBeTruthy();
    sample.getState().updateGameCounter(game, id!, { key: "Control+Alt+KeyK" });
    sample
      .getState()
      .changeSessionCount(sample.getState().activeSessions[0].id, id!, 1);
    expect(
      journalCounters(getGameJournal(sample.getState(), game)).some(
        (counter) => counter.name === "Runs" && counter.key,
      ),
    ).toBe(true);
    // The real library: no journal, no session, no key registered.
    expect(store().gameJournals).toBe(before);
    expect(store().activeSessions).toEqual([]);
    expect(store().recentSessions).toEqual([]);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("are the same while the guide runs, and thrown away when it ends", async () => {
    await start();
    const first = tourCounters();
    first.store.getState().addGameCounter(first.game, "Runs");
    // A step later it is still there.
    await act(async () => store().goToTourStep(1));
    expect(tourCounters().store).toBe(first.store);

    await act(async () => store().endTour("dismissed"));
    await start();
    const again = tourCounters();
    expect(again.store).not.toBe(first.store);
    expect(
      journalCounters(getGameJournal(again.store.getState(), again.game)).map(
        counterName,
      ),
    ).not.toContain("Runs");
  });

  it("start over when the guide puts the sample back (Back, a jump, Skip)", async () => {
    await start();
    const first = tourCounters();
    await act(async () => store().goToTourStep(2, true));
    expect(tourCounters().store).not.toBe(first.store);
  });
});

describe("the sample Achievements page", () => {
  it("has unlocked milestones, locked ones ahead, and game ladders with trophies", () => {
    const sample = tourSampleAchievementsPage();
    const catalog = buildAchievementCatalog(
      sample.awardedMilestones,
      sample.metrics,
      sample.gameLabels,
    );
    const summary = summarizeAchievements(catalog, sample.metrics.monthKey);
    expect(summary.fixedUnlocked).toBeGreaterThanOrEqual(5);
    expect(summary.fixedUnlocked).toBeLessThan(summary.fixedTotal);
    const ladders = buildGameLadders(catalog);
    expect(ladders.length).toBeGreaterThanOrEqual(3);
    expect(ladders.map((ladder) => ladder.name)).toContain(TOUR_DEMO_GAME.name);
    // A ladder with trophies and one still without.
    const earned = ladders.map(
      (ladder) => ladder.rungs.filter((rung) => rung.milestone).length,
    );
    expect(Math.max(...earned)).toBeGreaterThanOrEqual(3);
    expect(Math.min(...earned)).toBe(0);
  });

  it("is built without the player's own data", () => {
    useAppStore.setState({ archivedSeconds: 9_999_999 });
    const first = tourSampleAchievementsPage(new Date(2026, 10, 12, 12));
    useAppStore.setState({ archivedSeconds: 0 });
    const second = tourSampleAchievementsPage(new Date(2026, 10, 12, 12));
    expect(second.metrics.totalHours).toBe(first.metrics.totalHours);
    expect(store().awardedMilestones).toEqual([]);
  });
});

describe("a sample tells its guide that the task is done", () => {
  const heard: Array<{ name: string; message?: string }> = [];
  const listen = (event: Event) =>
    heard.push((event as CustomEvent<{ name: string }>).detail);
  beforeEach(() => {
    heard.length = 0;
    window.addEventListener(TOUR_EVENT, listen);
  });
  afterEach(() => window.removeEventListener(TOUR_EVENT, listen));

  it("only for the step it belongs to", async () => {
    await act(async () => store().startTour("counters"));
    const ids = tourSteps("counters").map((step) => step.id);
    // Adding a counter is not what the first step asks for.
    completeTourStep("counters", "add");
    expect(heard).toEqual([]);
    await act(async () => store().goToTourStep(ids.indexOf("add")));
    completeTourStep("counters", "add", "Added.");
    expect(heard).toEqual([{ name: "demo.step-completed", message: "Added." }]);
  });

  it("not in another guide and not without a guide", async () => {
    completeTourStep("counters", "add");
    await act(async () => store().startTour("game-actions"));
    completeTourStep("counters", "add");
    expect(heard).toEqual([]);
  });
});

function tourSteps(tourId: string) {
  // The real guide definitions: the steps name the tabs they need.
  return findTour(tourId)!.steps;
}
