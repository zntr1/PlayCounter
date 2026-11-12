import { NotebookPen } from "lucide-react";
import { getT } from "../../../i18n";
import type { TourDefinition } from "../tourTypes";
import { a, libraryTourCard, NEXT_RELEASE } from "./shared";

const t = getT("tour");

export function notesPlaythroughsGuide(): TourDefinition {
  return {
    id: "notes-playthroughs",
    version: 3,
    kind: "guide",
    category: "library",
    icon: NotebookPen,
    title: t("Notes & playthroughs"),
    description: t(
      "Write a note, start a new playthrough, and move a session into it.",
    ),
    duration: t("4 min"),
    practice: true,
    finishView: "games",
    release: NEXT_RELEASE,
    nextTourId: "organize-library",
    steps: [
      {
        id: "open-journal",
        view: "games",
        anchor: libraryTourCard,
        anchorTargets: [a("demo-menu-journal")],
        interactive: true,
        manualAdvance: true,
        allow: [
          libraryTourCard,
          a("demo-library-menu"),
          a("demo-context-menu"),
        ],
        advanceOn: { type: "anchor-present", selector: a("demo-journal") },
        title: t("Open a game's journal"),
        body: t(
          "Every game has a journal for notes and playthroughs. This is a sample card: nothing is saved, and your own games stay as they are.",
        ),
        task: t("Right-click the card and choose <b>Journal</b>."),
        keyboardHint: t("Keyboard: focus the card and press Shift+F10."),
      },
      {
        id: "note",
        view: "games",
        anchor: a("demo-note-input"),
        additionalAnchors: [a("demo-note-save")],
        interactive: true,
        manualAdvance: true,
        advanceOn: { type: "event", name: "demo.step-completed" },
        allow: [a("demo-journal-note")],
        title: t("Write a note for next time"),
        body: t(
          "This note belongs to <b>Default playthrough</b>, the one every game starts with. Clicking somewhere else saves it too.",
        ),
        task: t(
          "Type where you stopped, for example “Finish the Westfall quests”, and click <b>Save note</b>.",
        ),
      },
      {
        id: "create-run",
        view: "games",
        anchor: a("demo-playthrough-name"),
        additionalAnchors: [a("demo-playthrough-create")],
        interactive: true,
        manualAdvance: true,
        advanceOn: { type: "event", name: "demo.step-completed" },
        allow: [a("demo-new-playthrough")],
        title: t("Start a new playthrough"),
        body: t(
          "Each playthrough has its own note, playtime and sessions. What you played before stays in <b>Default playthrough</b>.",
        ),
        task: t(
          "Click <b>Add playthrough</b>, type a name such as “Speedrun” and press <kbd>Enter</kbd>.",
        ),
      },
      {
        id: "active-run",
        view: "games",
        // Default playthrough in the list, then Make active once it is open.
        anchor: `${a("demo-playthrough-list")} [role="option"]:first-child`,
        anchorTargets: [`${a("demo-playthrough-active")}:not(:disabled)`],
        interactive: true,
        manualAdvance: true,
        advanceOn: { type: "event", name: "demo.step-completed" },
        allow: [a("demo-playthrough-list"), a("demo-playthrough-actions")],
        title: t("Choose where new sessions go"),
        body: t(
          "New sessions count towards the playthrough marked <b>Active</b>. A new playthrough becomes active right away.",
        ),
        task: t(
          "Click <b>Default playthrough</b> in the list, then <b>Make active</b>.",
        ),
      },
      {
        id: "run-note",
        view: "games",
        anchor: a("demo-note-input"),
        additionalAnchors: [a("demo-note-save")],
        interactive: true,
        manualAdvance: true,
        advanceOn: { type: "event", name: "demo.step-completed" },
        allow: [a("demo-journal-note")],
        title: t("Give the playthrough its own note"),
        body: t(
          "Each playthrough keeps its own note. The note of <b>Default playthrough</b> is not copied over.",
        ),
        task: t(
          "Write a line for your new playthrough and click <b>Save note</b>.",
        ),
      },
      {
        id: "move-session",
        view: "games",
        anchor: `${a("demo-playthrough-list")} [role="option"]:last-child`,
        anchorTargets: [
          a("demo-session-named-playthrough"),
          a("demo-session-playthrough"),
        ],
        interactive: true,
        manualAdvance: true,
        advanceOn: { type: "event", name: "demo.step-completed" },
        allow: [
          a("demo-playthrough-sessions"),
          a("demo-playthrough-list"),
          a("demo-library-menu"),
        ],
        title: t("Move a session to your playthrough"),
        body: t(
          "Each session shows its playthrough. Moving a session moves its playtime; the game's total stays the same. My History shows the label once a game has a second playthrough.",
        ),
        task: t(
          "Click <b>Default playthrough</b> on a session and pick the playthrough you created.",
        ),
      },
      {
        id: "session-note",
        view: "games",
        anchor: a("demo-playthrough-sessions"),
        // The open note, then the pen that opens it.
        anchorTargets: [a("demo-session-note-editor"), a("demo-session-note")],
        interactive: true,
        manualAdvance: true,
        advanceOn: { type: "event", name: "demo.step-completed" },
        allow: [a("demo-playthrough-sessions")],
        title: t("Write a note for one session"),
        body: t(
          "A session can carry its own note, the log entry for that evening. My History shows it under the session too.",
        ),
        task: t(
          "Click <b>Add session note</b>, the pen on a session row, write a line and press <kbd>Enter</kbd>.",
        ),
      },
      {
        id: "finish-run",
        view: "games",
        anchor: a("demo-playthrough-actions"),
        anchorTargets: [a("demo-playthrough-finish")],
        interactive: true,
        manualAdvance: true,
        advanceOn: { type: "event", name: "demo.step-completed" },
        allow: [a("demo-playthrough-actions")],
        title: t("Finish a playthrough"),
        body: t(
          "A finished playthrough keeps its note and sessions. If it was active, new sessions go to <b>Default playthrough</b> again. The game's progress status does not change.",
        ),
        task: t("Click <b>Mark finished</b>."),
      },
      {
        id: "popups",
        view: "games",
        anchor: a("demo-popup-session-notes"),
        // The note box, then the button that opens it, once they are there.
        anchorTargets: [
          a("demo-popup-note-box"),
          `${a("demo-popup-saved")} .desktop-overlay-action`,
        ],
        interactive: true,
        manualAdvance: true,
        advanceOn: { type: "event", name: "demo.step-completed" },
        allow: [a("demo-popup-preview")],
        title: t("Take notes from the popup"),
        body: t(
          "A popup can show your note when a game starts and offer a note box when a session is saved. The real switches are in Settings under Desktop popups, and off until you turn them on.",
        ),
        task: t(
          "Turn on <b>Session notes in popups</b>, click <b>Add session note</b> in the popup and write a line.",
        ),
      },
      {
        id: "finish",
        view: "games",
        anchor: libraryTourCard,
        title: t("Use it with your own games"),
        body: t(
          "In My Games, right-click a game and choose <b>Journal</b>. While you play, Now Playing shows the active playthrough's note, and a hotkey from Settings opens a quick session note.",
        ),
      },
    ],
  };
}
