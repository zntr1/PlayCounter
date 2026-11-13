import { History } from "lucide-react";
import { getT } from "../../../i18n";
import { HISTORY_SAMPLE, historySampleRow } from "../tourHistorySample";
import type { TourDefinition } from "../tourTypes";
import { NEXT_RELEASE, a } from "./shared";

const t = getT("tour");

export function correctHistoryGuide(): TourDefinition {
  // The sample history, its menus and its dialogs.
  const practice = [
    a("demo-library-stage"),
    a("demo-library-menu"),
    a("demo-history-playtime-menu"),
    a("demo-library-modal"),
  ];
  const exercise = {
    view: "history" as const,
    interactive: true,
    manualAdvance: true,
    allow: practice,
    advanceOn: { type: "event", name: "demo.step-completed" } as const,
  };
  return {
    id: "correct-history",
    version: 1,
    release: NEXT_RELEASE,
    kind: "guide",
    category: "playtime",
    icon: History,
    title: t("Correct your history"),
    description: t("Edit, split and combine saved sessions."),
    duration: t("2 min"),
    simulation: "stats",
    finishView: "history",
    nextTourId: "stats",
    steps: [
      {
        id: "intro",
        view: "history",
        title: t("Fix a session that went wrong"),
        body: t(
          "A session ran 14 hours: the game stayed open overnight. It is a sample, nothing is saved, and your own history stays as it is.",
        ),
      },
      {
        id: "edit",
        ...exercise,
        anchor: historySampleRow(HISTORY_SAMPLE.overnight),
        anchorTargets: [
          a("demo-history-edit-length"),
          a("demo-history-menu-edit"),
          a("demo-history-menu-playtime"),
        ],
        title: t("Change a session's times"),
        body: t(
          "A session has a start, an end and a length. Set any two and the third fills in. The pencil on the row opens the same dialog.",
        ),
        task: t(
          "Right-click the 14 hour session, open <b>Playtime</b>, choose <b>Edit session</b>, set <b>Length</b> to 2 hours and click <b>Save</b>.",
        ),
      },
      {
        id: "split",
        ...exercise,
        anchor: historySampleRow(HISTORY_SAMPLE.withBreak),
        anchorTargets: [
          a("demo-history-split-break"),
          a("demo-history-menu-split"),
          a("demo-history-menu-playtime"),
        ],
        title: t("Cut a break out of a session"),
        body: t(
          "Left the game running during dinner? Split the session and mark the break: it is cut out and doesn't count as playtime.",
        ),
        task: t(
          "Right-click the 4h 30m session, open <b>Playtime</b>, choose <b>Split session</b>, pick a <b>Break</b> of 1h and click <b>Split</b>.",
        ),
      },
      {
        id: "combine",
        ...exercise,
        anchor: historySampleRow(HISTORY_SAMPLE.afterRestart),
        anchorTargets: [
          a("demo-history-combine-result"),
          a("demo-history-menu-combine"),
          a("demo-history-menu-playtime"),
        ],
        title: t("Join two sessions into one"),
        body: t(
          "Restarted the game? Two sessions of one game become one. The time between them counts as playtime, and a preview shows the result.",
        ),
        task: t(
          "Right-click the marked session, open <b>Playtime</b>, choose <b>Combine with…</b> and click <b>Combine</b>.",
        ),
      },
      {
        id: "note",
        ...exercise,
        anchor: a("demo-history-row"),
        anchorTargets: [
          a("demo-history-session-note"),
          a("demo-history-menu-note"),
        ],
        title: t("Add a note to a session"),
        body: t(
          "A note is a line under the session: where you stopped, what happened. It stays with that session.",
        ),
        task: t(
          "Right-click a session, choose <b>Add session note</b>, type a line and press <kbd>Enter</kbd>.",
        ),
      },
      {
        id: "end",
        view: "history",
        anchor: a("demo-history-total"),
        title: t("Back to your own history"),
        body: t(
          "In the app, right-click any session in My History and open Playtime. Changes there are saved to your real history, so check the preview first.",
        ),
      },
    ],
  };
}
