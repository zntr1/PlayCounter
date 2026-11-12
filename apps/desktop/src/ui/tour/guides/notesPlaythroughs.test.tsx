// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../../store";
import { notesPlaythroughsGuide } from "./notesPlaythroughs";
import {
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
  press,
  q,
  rightClick,
  startGuide,
  stepId,
  target,
  type,
  unmountPractice,
  wait,
} from "./libraryPractice.test.util";

/* "Notes & playthroughs" on today's journal (docs/tours-plan.md 1.2, 1.5 and
   the WP4 row): the active playthrough and the playthrough's own note are
   two steps, a session can be moved again after Back, a session gets its own
   note, and the popup step finishes by itself. */

vi.mock("../../../tracker");
vi.mock("../../../platform", () => ({ currentPlatform: () => "windows" }));

beforeEach(mountPractice);
afterEach(unmountPractice);

const guide = notesPlaythroughsGuide();
const step = (id: string) => guide.steps.find((entry) => entry.id === id)!;
const sessionField = (root: HTMLElement) =>
  root.querySelector<HTMLTextAreaElement>(
    'textarea[aria-label="Session note"]',
  )!;

describe("Notes & playthroughs", () => {
  it("keeps the rules for every step", () => {
    // Ten steps: the brief's split and the session note are one more than
    // the rule's nine (reported to the lead).
    expect(guideProblems(guide, { version: 3, maxSteps: 10 })).toEqual([]);
    expect(guide.nextTourId).toBe("organize-library");
  });

  it("has a step for the active playthrough and one for the playthrough's note", () => {
    const ids = guide.steps.map((entry) => entry.id);
    expect(ids.indexOf("run-note")).toBe(ids.indexOf("active-run") + 1);
    expect(step("active-run").task).toContain("<b>Make active</b>");
    expect(step("active-run").task).not.toMatch(/note/i);
    expect(step("run-note").task).toContain("<b>Save note</b>");
  });

  it("opens the journal from the card's menu and moves on", async () => {
    await startGuide("notes-playthroughs");
    expect(stepId()).toBe("open-journal");
    expect(target()).toBe(card(WOW));
    await rightClick(card(WOW));
    expect(target().getAttribute("data-tour")).toBe("demo-menu-journal");
    expect(target().textContent?.trim()).toBe("Journal");
    await click(target());
    await wait(150);
    expect(stepId()).toBe("note");
    expect(target().tagName).toBe("TEXTAREA");
  });

  it("rings the list, then Make active, and moves on once the active playthrough changed", async () => {
    await startGuide("notes-playthroughs", "active-run");
    // The practice makes a playthrough and marks it active. That is not the
    // player's doing, so the step waits.
    await finishStep(2000);
    expect(stepId()).toBe("active-run");
    expect(target().getAttribute("role")).toBe("option");
    expect(target().textContent).toContain("Default playthrough");
    await click(target());
    expect(target().textContent).toBe("Make active");
    await click(target());
    await finishStep();
    expect(stepId()).toBe("run-note");
  });

  it("rings the note box for the playthrough's own note", async () => {
    await startGuide("notes-playthroughs", "note");
    await type(target(), "Finish the Westfall quests");
    await click(q("demo-note-save"));
    await goTo("run-note");
    const note = target() as HTMLTextAreaElement;
    expect(note.tagName).toBe("TEXTAREA");
    // The new playthrough's note, not a copy of Default playthrough's.
    expect(note.value).toBe("");
    await type(note, "Any% route");
    await click(q("demo-note-save"));
    await finishStep();
    expect(stepId()).toBe("move-session");
  });

  it("can be practised again: Make active after it was done once", async () => {
    await startGuide("notes-playthroughs", "active-run");
    await click(target());
    await click(target());
    await finishStep();
    await goTo("active-run", true);
    await finishStep(2000);
    expect(stepId()).toBe("active-run");
    expect(target().textContent).toContain("Default playthrough");
    await click(target());
    expect(target().textContent).toBe("Make active");
    await click(target());
    await finishStep();
    expect(stepId()).toBe("run-note");
  });

  it("does not claim the label is on every History session", () => {
    const text = step("move-session").body + step("move-session").task;
    expect(text).not.toMatch(/every session in My History/i);
  });

  it("puts a session back when both were moved, so the step can be done again", async () => {
    await startGuide("notes-playthroughs", "move-session");
    for (let index = 0; index < 2; index++) {
      expect(target().getAttribute("aria-label")).toMatch(
        /^Playthrough for session/,
      );
      await click(target());
      expect(target().textContent).toBe("Speedrun");
      await click(target());
    }
    // Back, or a click on the finished step in the card's list.
    await goTo("move-session", true);
    await finishStep(2000);
    expect(stepId()).toBe("move-session");
    expect(target().getAttribute("aria-label")).toMatch(
      /^Playthrough for session/,
    );
    await click(target());
    await click(target());
    await finishStep();
    expect(stepId()).toBe("session-note");
  });

  it("has a step that writes a note for one session and notices it", async () => {
    await startGuide("notes-playthroughs", "session-note");
    expect(step("session-note").task).toContain("<b>Add session note</b>");
    expect(target().getAttribute("aria-label")).toBe("Add session note");
    await click(target());
    expect(target().getAttribute("data-tour")).toBe("demo-session-note-editor");
    const field = sessionField(target());
    await type(field, "Stopped at the bridge");
    await press(field, "Enter");
    expect(q("demo-playthrough-sessions").textContent).toContain(
      "Stopped at the bridge",
    );
    await finishStep();
    expect(stepId()).toBe("finish-run");
    // The note went to the sample session, not to the player's history.
    expect(useAppStore.getState().recentSessions).toEqual([]);
  });

  it("finds a session to note even when every session was moved", async () => {
    await startGuide("notes-playthroughs", "move-session");
    for (let index = 0; index < 2; index++) {
      await click(target());
      await click(target());
    }
    await goTo("session-note");
    expect(target().getAttribute("aria-label")).toBe("Add session note");
  });

  it("lets Mark finished be done again after coming back", async () => {
    await startGuide("notes-playthroughs", "finish-run");
    expect(target().textContent).toBe("Mark finished");
    await click(target());
    await finishStep();
    expect(stepId()).toBe("popups");
    await goTo("finish-run", true);
    expect(target().textContent).toBe("Mark finished");
    await click(target());
    await finishStep();
    expect(stepId()).toBe("popups");
  });

  it("shows the popups the size of the real ones, with the real texts", async () => {
    await startGuide("notes-playthroughs", "popups");
    for (const name of ["demo-popup-start", "demo-popup-saved"]) {
      expect(q(name).style.width).toBe("440px");
      expect(q(name).querySelectorAll(".desktop-overlay-card")).toHaveLength(1);
    }
    expect(q("demo-popup-start").textContent).toContain("TRACKING STARTED");
    expect(q("demo-popup-saved").textContent).toContain("SESSION SAVED");
  });

  it("shows the learner's note in the game-start popup when that switch is on", async () => {
    await startGuide("notes-playthroughs", "note");
    await type(target(), "Remember the bridge quest");
    await click(q("demo-note-save"));
    await goTo("popups");
    expect(q("demo-popup-start").textContent).not.toContain(
      "Remember the bridge quest",
    );
    const notes = q<HTMLInputElement>("demo-popup-game-notes");
    expect(labelOf(notes)).toBe("Notes in game-start popups");
    await click(notes);
    expect(q("demo-popup-start").textContent).toContain(
      "Remember the bridge quest",
    );
    const names = q<HTMLInputElement>("demo-popup-names");
    expect(labelOf(names)).toBe("Playthrough names in popups");
    await click(names);
    expect(q("demo-popup-start").textContent).toContain("Default playthrough");
  });

  it("rings the switch, then the popup's button, and finishes once the note box was used", async () => {
    await startGuide("notes-playthroughs", "popups");
    const toggle = target() as HTMLInputElement;
    expect(toggle.type).toBe("checkbox");
    expect(labelOf(toggle)).toBe("Session notes in popups");
    expect(toggle.checked).toBe(false);
    expect(q("demo-popup-saved").textContent).not.toContain("Add session note");
    // Only the note box finishes the step, not the switches.
    await click(toggle);
    await finishStep(2000);
    expect(stepId()).toBe("popups");
    expect(target().textContent).toBe("Add session note");
    expect(q("demo-popup-saved").contains(target())).toBe(true);
    await click(target());
    expect(target().getAttribute("data-tour")).toBe("demo-popup-note-box");
    const field = sessionField(target());
    await type(field, "Beat the raid boss");
    await press(field, "Enter");
    expect(has("demo-popup-note-box")).toBe(false);
    await finishStep();
    expect(stepId()).toBe("finish");
    expect(useAppStore.getState().recentSessions).toEqual([]);
    expect(useAppStore.getState().gameJournals).toEqual({});
  });

  it("starts the popup step fresh after coming back", async () => {
    await startGuide("notes-playthroughs", "popups");
    await click(target());
    await click(target());
    await press(sessionField(target()), "Escape");
    await finishStep();
    expect(stepId()).toBe("finish");
    await goTo("popups", true);
    expect((target() as HTMLInputElement).checked).toBe(false);
    expect(has("demo-popup-note-box")).toBe(false);
  });

  it("ends with what to do in the real app", () => {
    const finish = guide.steps.at(-1)!;
    expect(finish.body).toContain("<b>Journal</b>");
    // It was 82 words about four settings.
    expect(finish.body.split(/\s+/).length).toBeLessThanOrEqual(35);
    expect(finish.interactive).toBeUndefined();
  });

  it.each(guide.steps.map((entry) => entry.id))(
    "shows its control when %s is entered directly",
    async (id) => {
      await startGuide("notes-playthroughs", id);
      expect(currentStep().id).toBe(id);
      target();
      await finishStep(2000);
      // Setting the step up never counts as the player's work.
      expect(stepId()).toBe(id);
    },
  );
});
