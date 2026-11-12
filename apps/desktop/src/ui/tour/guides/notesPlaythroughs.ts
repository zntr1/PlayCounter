import { NotebookPen } from "lucide-react";
import { getT } from "../../../i18n";
import type { TourDefinition } from "../tourTypes";
import { a, libraryTourCard } from "./shared";

const t = getT("tour");

export function notesPlaythroughsGuide(): TourDefinition {
  return {
    id: "notes-playthroughs",
    version: 2,
    kind: "guide",
    category: "library",
    icon: NotebookPen,
    title: t("Notes & playthroughs"),
    description: t(
      "Write a note, start a new playthrough, and move a session into it.",
    ),
    duration: t("3 min"),
    practice: true,
    finishView: "games",
    release: "1.1.17",
    nextTourId: "organize-library",
    steps: [
      {
        id: "intro",
        view: "games",
        anchor: a("demo-library-cards"),
        title: t("Remember where you left off"),
        body: t(
          "Every game has a journal: a note, playthroughs, and the sessions that belong to each playthrough. Practice with the sample World of Warcraft card below. Everything you change here is thrown away when the guide ends. Your own games are not touched.",
        ),
      },
      {
        id: "open-journal",
        view: "games",
        anchor: libraryTourCard,
        anchorTargets: [a("demo-menu-journal")],
        interactive: true,
        allow: [libraryTourCard, a("demo-library-menu")],
        advanceOn: { type: "anchor-present", selector: a("demo-journal") },
        skipTo: "note",
        title: t("Right-click World of Warcraft"),
        body: t(
          "Choose Journal. Later you can also open it with the Journal button that appears when you point at a game's cover, or by clicking the note icon on the cover.",
        ),
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
          "Type something like “Finish the Westfall quests, then head to Stormwind.” Click Save note, or simply click somewhere else: the note is saved either way, and the guide moves on. This note belongs to Default playthrough, the playthrough every game starts with.",
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
          "Click Add playthrough under the list, type a name such as “Speedrun” and press Enter. Each playthrough gets its own note, its own playtime, and its own list of sessions. Everything you played before stays in Default playthrough.",
        ),
      },
      {
        id: "active-run",
        view: "games",
        anchor: a("demo-playthrough-active"),
        additionalAnchors: [a("demo-note-input")],
        interactive: true,
        manualAdvance: true,
        advanceOn: { type: "event", name: "demo.step-completed" },
        allow: [
          a("demo-playthrough-list"),
          a("demo-playthrough-actions"),
          a("demo-journal-note"),
        ],
        title: t("Choose where new sessions go"),
        body: t(
          "The playthrough marked Active is where your next sessions are counted. A new playthrough becomes active right away. Click any playthrough in the list to look at it, and use Make active to switch. Now write a note for your new playthrough. Each playthrough keeps its own note; the note from Default playthrough is not copied over.",
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
        title: t("Move an earlier session into your new playthrough"),
        body: t(
          "We switched to Default playthrough so you can see its sessions. Every session has a playthrough label on the right. Click the label on a sample session and choose the playthrough you created. The session and its playtime move over, and the game's total stays the same. The same label is available on every session in My History.",
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
          "Click Mark finished. The playthrough keeps its note and sessions, so you can look them up any time. If it was the active playthrough, new sessions go back to Default playthrough until you make another one active. Finishing a playthrough does not change the game's progress status; you set that separately.",
        ),
      },
      {
        id: "popups",
        view: "games",
        anchor: a("demo-popup-preview"),
        anchorTargets: [a("demo-note-input")],
        interactive: true,
        manualAdvance: true,
        allow: [a("demo-library-stage"), a("demo-library-modal")],
        title: t("Preview your note in desktop popups"),
        body: t(
          "Turn on Notes in game-start popups to preview the active playthrough's note. Playthrough names is a separate switch. Choose Session saved, turn on Session notes in popups, and try the button. In the real popup it opens a small box for a note about that session; here it opens the sample journal. All three real preferences are independent and off by default.",
        ),
      },
      {
        id: "finish",
        view: "games",
        anchor: a("demo-library-cards"),
        title: t("Use notes in your own games"),
        body: t(
          "When you start one of your own games, Now Playing shows the note of its active playthrough. In Settings → Desktop popups, turn on Notes in game-start popups to see it in the popup as well. Turn on Session notes in popups to add a button to saved-session popups so you can write down what happened. Both options are off by default. Under Keyboard shortcuts you can also set a Quick session note hotkey. Replay this guide any time from ? Help.",
        ),
      },
    ],
  };
}
