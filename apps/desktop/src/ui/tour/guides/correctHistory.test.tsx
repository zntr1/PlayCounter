// @vitest-environment happy-dom
/* "Correct your history" (docs/tours-plan.md, WP6): Edit session, Split
   session, Combine with… and a note for one session, each as an exercise on
   a sample history. The sample has a session that is plainly wrong (14
   hours) and two sessions of one game close together. Every exercise works
   on the sample only, finishes by itself, and finds what it needs from
   wherever its step is entered. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../tracker");
vi.mock("../../../platform", () => ({ currentPlatform: () => "windows" }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => []),
  convertFileSrc: (value: string) => value,
}));

import { useAppStore } from "../../../store";
import * as tracker from "../../../tracker";
import { HISTORY_SAMPLE, historySampleSessions } from "../tourHistorySample";
import { correctHistoryGuide } from "./correctHistory";
import { boldNames, expectStepRules, stepOf } from "./guideRules.test.kit";
import {
  all,
  click,
  control,
  goTo,
  mountHistory,
  named,
  ownSession,
  press,
  q,
  rightClick,
  row,
  rows,
  startGuide,
  stepId,
  target,
  type,
  unmountHistory,
} from "./historyPractice.test.util";
import { NEXT_RELEASE } from "./shared";

beforeEach(mountHistory);
afterEach(unmountHistory);

const guide = correctHistoryGuide();
const ids = guide.steps.map((step) => step.id);
const { overnight, withBreak, beforeRestart, afterRestart } = HISTORY_SAMPLE;

/** Opens an entry of a row's Playtime menu, the way the guide asks for it. */
async function openFromPlaytime(sessionId: number, entry: string) {
  await rightClick(row(sessionId));
  await click(control("Playtime"));
  await click(control(entry));
}

/** The player's own history, to prove that nothing reaches it. */
function ownHistory() {
  useAppStore.setState({ recentSessions: [ownSession] });
  return useAppStore.getState().recentSessions;
}

function expectOwnHistoryUntouched(before: unknown) {
  expect(useAppStore.getState().recentSessions).toBe(before);
  expect(tracker.editHistorySession).not.toHaveBeenCalled();
  expect(tracker.splitHistorySession).not.toHaveBeenCalled();
  expect(tracker.combineHistorySessions).not.toHaveBeenCalled();
  expect(tracker.removeHistorySession).not.toHaveBeenCalled();
}

describe("Correct your history: the guide", () => {
  it("keeps the rules every step follows", () => {
    expectStepRules(guide);
  });

  it("is new in the next release and leads on to Read your stats", () => {
    expect(guide.version).toBe(1);
    expect(guide.release).toBe(NEXT_RELEASE);
    expect(guide.simulation).toBe("stats");
    expect(guide.nextTourId).toBe("stats");
    expect(guide.finishView).toBe("history");
  });

  it("teaches edit, split, combine and a session note, each as a task", () => {
    expect(ids).toEqual(["intro", "edit", "split", "combine", "note", "end"]);
    const names = (id: string) => [
      ...boldNames(stepOf(guide, id).body),
      ...boldNames(stepOf(guide, id).task),
    ];
    // Where they are: the row's right-click menu, under Playtime.
    expect(names("edit")).toEqual(
      expect.arrayContaining(["Playtime", "Edit session", "Length", "Save"]),
    );
    expect(names("split")).toEqual(
      expect.arrayContaining(["Playtime", "Split session", "Break", "Split"]),
    );
    expect(names("combine")).toEqual(
      expect.arrayContaining(["Playtime", "Combine with…", "Combine"]),
    );
    expect(names("note")).toContain("Add session note");
    for (const id of ["edit", "split", "combine", "note"]) {
      expect(stepOf(guide, id).advanceOn, id).toEqual({
        type: "event",
        name: "demo.step-completed",
      });
      // An exercise can be stepped over: the next one doesn't need it.
      expect(stepOf(guide, id).manualAdvance, id).toBe(true);
    }
  });
});

describe("Correct your history: the sample", () => {
  const now = new Date(2026, 10, 12, 9, 30);
  const sample = historySampleSessions("correct-history", now);
  const find = (id: number) => sample.find((session) => session.id === id)!;

  it("has one session that is plainly wrong: 14 hours", () => {
    expect(find(overnight).durationSeconds).toBe(14 * 3600);
    expect(
      sample.filter((session) => (session.durationSeconds ?? 0) > 5 * 3600),
    ).toHaveLength(1);
  });

  it("has two sessions of one game, 15 minutes apart", () => {
    const first = find(beforeRestart);
    const second = find(afterRestart);
    expect(first.gameId).toBe(second.gameId);
    expect(Date.parse(second.startedAt) - Date.parse(first.endedAt!)).toBe(
      15 * 60_000,
    );
  });

  it("has a session long enough to cut an hour out of", () => {
    expect(find(withBreak).durationSeconds).toBeGreaterThan(3 * 3600);
  });

  it("lies in the past, newest first", () => {
    for (const session of sample)
      expect(Date.parse(session.endedAt!)).toBeLessThan(now.getTime());
    const starts = sample.map((session) => Date.parse(session.startedAt));
    expect(starts).toEqual([...starts].sort((left, right) => right - left));
  });
});

describe("Correct your history: the practice", () => {
  it("rings something in every step after the first, entered in any order", async () => {
    await startGuide("correct-history");
    // The first step is for reading and rings nothing.
    const ringed = ids.slice(1);
    for (const id of [...ringed].reverse()) {
      await goTo(id);
      expect(target(), id).toBeTruthy();
    }
    for (const id of ringed) {
      await goTo(id, true);
      expect(target(), id).toBeTruthy();
    }
  });

  it("starts on the session that is wrong", async () => {
    await startGuide("correct-history");
    expect(target()).toBe(row(overnight));
    expect(row(overnight).textContent).toContain("14h 0m");
  });

  it("follows the player from the row into Playtime and into the dialog", async () => {
    await startGuide("correct-history", "edit");
    expect(target()).toBe(row(overnight));
    await rightClick(row(overnight));
    expect(target().textContent).toBe("Playtime");
    await click(control("Playtime"));
    expect(target().textContent).toBe("Edit session");
    await click(control("Edit session"));
    expect(q(named("demo-history-edit")).contains(target())).toBe(true);
    expect(target().textContent).toContain("Length");
  });

  it("edit: a shorter length finishes the step, on the sample only", async () => {
    const own = ownHistory();
    await startGuide("correct-history", "edit");
    await openFromPlaytime(overnight, "Edit session");
    // Started hours, minutes, Ended hours, minutes, Length hours, minutes.
    const drums = all<HTMLInputElement>('input[inputmode="numeric"]');
    expect(drums[4].value).toBe("14");
    await type(drums[4], "2");
    // The third one fills in: 21:00 + 2 hours.
    expect(drums.map((drum) => drum.value).slice(0, 4)).toEqual([
      "21",
      "00",
      "23",
      "00",
    ]);
    await click(control("Save"));
    expect(row(overnight).textContent).toContain("2h 0m");
    expect(stepId()).toBe("split");
    expectOwnHistoryUntouched(own);
  });

  it("edit: the pencil on the row opens the same dialog", async () => {
    await startGuide("correct-history", "edit");
    await click(row(overnight).querySelector('[aria-label="Edit session"]')!);
    expect(q(named("demo-history-edit")).textContent).toContain("Started");
  });

  it("split: cutting an hour out makes two sessions and finishes the step", async () => {
    const own = ownHistory();
    await startGuide("correct-history", "split");
    expect(target()).toBe(row(withBreak));
    await openFromPlaytime(withBreak, "Split session");
    expect(q(named("demo-history-split")).contains(target())).toBe(true);
    await click(control("1h"));
    expect(q(named("demo-history-split")).textContent).toContain(
      "The 1h 0m break doesn't count as playtime.",
    );
    await click(control("Split"));
    expect(rows()).toHaveLength(7);
    // 4h 30m without the hour, in two halves.
    expect(
      rows().filter((entry) => entry.textContent?.includes("1h 45m")),
    ).toHaveLength(2);
    expect(stepId()).toBe("combine");
    expectOwnHistoryUntouched(own);
  });

  it("combine: the preview shows the result, the time between included", async () => {
    const own = ownHistory();
    await startGuide("correct-history", "combine");
    expect(target()).toBe(row(afterRestart));
    await openFromPlaytime(afterRestart, "Combine with…");
    const dialog = q(named("demo-history-combine"));
    expect(dialog.contains(target())).toBe(true);
    expect(target().textContent).toContain("Combined session");
    expect(target().textContent).toContain("2h 10m");
    expect(dialog.textContent).toContain(
      "The 15m between them count as playtime.",
    );
    await click(control("Combine"));
    expect(rows()).toHaveLength(5);
    expect(row(afterRestart).textContent).toContain("2h 10m");
    expect(stepId()).toBe("note");
    expectOwnHistoryUntouched(own);
  });

  it("note: a line under the session finishes the step", async () => {
    const own = ownHistory();
    await startGuide("correct-history", "note");
    await rightClick(rows()[0]);
    expect(target().textContent).toBe("Add session note");
    await click(control("Add session note"));
    const field = q<HTMLTextAreaElement>('textarea[aria-label="Session note"]');
    expect(target().contains(field)).toBe(true);
    await type(field, "Stopped at the harbor");
    await press(field, "Enter");
    expect(rows()[0].textContent).toContain("Stopped at the harbor");
    expect(stepId()).toBe("end");
    expectOwnHistoryUntouched(own);
  });

  it("does not take a deleted session for a finished exercise", async () => {
    for (const id of ["edit", "split", "combine", "note"]) {
      await startGuide("correct-history", id);
      await click(
        rows().at(-1)!.querySelector('[aria-label^="Remove history entry"]')!,
      );
      await click(
        all(`${named("demo-history-delete")} button`).find(
          (button) => button.textContent === "Delete session",
        )!,
      );
      expect(rows(), id).toHaveLength(5);
      expect(stepId(), id).toBe(id);
    }
  });

  it("brings the two sessions back when their step is entered again", async () => {
    await startGuide("correct-history", "combine");
    await openFromPlaytime(afterRestart, "Combine with…");
    await click(control("Combine"));
    expect(stepId()).toBe("note");
    // Back, or a click on the finished step in the checklist.
    await goTo("combine", true);
    expect(rows()).toHaveLength(6);
    expect(row(beforeRestart)).toBeTruthy();
    expect(target()).toBe(row(afterRestart));
  });

  it("gives a step its session back when an earlier step used it up", async () => {
    await startGuide("correct-history", "split");
    // The player combines the two sessions here already, then moves on.
    await openFromPlaytime(afterRestart, "Combine with…");
    await click(control("Combine"));
    expect(stepId()).toBe("split");
    expect(rows()).toHaveLength(5);
    await goTo("combine");
    expect(row(beforeRestart)).toBeTruthy();
    expect(target()).toBe(row(afterRestart));
  });

  it("keeps what the player did when the guide moves on", async () => {
    await startGuide("correct-history", "edit");
    await openFromPlaytime(overnight, "Edit session");
    await type(all<HTMLInputElement>('input[inputmode="numeric"]')[4], "2");
    await click(control("Save"));
    expect(stepId()).toBe("split");
    expect(row(overnight).textContent).toContain("2h 0m");
  });
});
