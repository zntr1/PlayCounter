import { SlidersHorizontal } from "lucide-react";
import { getT } from "../../../i18n";
import type { TourDefinition } from "../tourTypes";
import { a, sampleCardAllow } from "./shared";

const t = getT("tour");

/** A step the player tries on the sample: it finishes once the entry it
 *  rings was used, and "Skip step" only steps over this one. */
const tryIt = {
  view: "games",
  anchor: a("demo-game-card"),
  interactive: true,
  manualAdvance: true,
  allow: sampleCardAllow,
  advanceOn: { type: "event", name: "demo.step-completed" },
} as const;

export function gameActionsGuide(): TourDefinition {
  return {
    id: "game-actions",
    version: 5,
    kind: "guide",
    category: "library",
    icon: SlidersHorizontal,
    title: t("Manage a game in your library"),
    description: t(
      "Try a card's right-click menu on a sample: details, history, playtime, matching, removing.",
    ),
    duration: t("3 min"),
    demoGame: true,
    finishView: "games",
    nextTourId: "log-playtime",
    steps: [
      {
        id: "intro",
        view: "games",
        anchor: a("demo-game-card"),
        title: t("A menu for every game"),
        body: t(
          "Every card in <b>My Games</b> has a right-click menu with all its actions. This World of Warcraft card is a sample: nothing is saved.",
        ),
      },
      {
        ...tryIt,
        id: "open-menu",
        advanceOn: {
          type: "anchor-present",
          selector: a("demo-context-menu"),
        },
        title: t("Open the card's menu"),
        body: t(
          "Point at a cover and its <b>More</b> button opens the same menu.",
        ),
        task: t("Right-click the sample card."),
      },
      {
        ...tryIt,
        id: "details",
        // The tab row once Details is open, not the whole dialog.
        anchorTargets: [
          `${a("demo-game-details")} [role="tablist"]`,
          a("demo-menu-details"),
        ],
        title: t("Open Details"),
        body: t(
          "<b>General</b> shows the game's facts and playtime. <b>Files</b> lists the game files PlayCounter tracks it by. <b>How long to beat</b> shows how long others needed.",
        ),
        task: t(
          "Click <b>Open Details</b>, look through the tabs, then close the dialog.",
        ),
      },
      {
        ...tryIt,
        id: "history",
        anchorTargets: [
          a("demo-game-action-done"),
          a("demo-menu-show-history"),
        ],
        title: t("Show History"),
        body: t(
          "On your own games this opens <b>My History</b> with only this game's sessions. The sample shows sample sessions.",
        ),
        task: t("Click <b>Show History</b>, then <b>Done</b>."),
      },
      {
        id: "playtime",
        view: "games",
        anchor: a("demo-game-card"),
        anchorTargets: [a("demo-playtime-menu"), a("demo-menu-playtime")],
        interactive: true,
        manualAdvance: true,
        allow: sampleCardAllow,
        title: t("Three ways to fix playtime"),
        body: t(
          "<b>Log missed session</b> adds one session to your history. <b>Adjust total playtime</b> sets the lifetime number. <b>Start timer</b> counts play on a console or another PC.",
        ),
      },
      {
        ...tryIt,
        id: "matches",
        anchorTargets: [
          a("demo-match-check-use"),
          a("demo-menu-check-matches"),
          a("demo-menu-matching"),
        ],
        title: t("Check for matches"),
        body: t(
          "PlayCounter looks the game file up again in IGDB and in the community's matches. A custom game can become a matched game this way.",
        ),
        task: t(
          "Open <b>Matching</b> and click <b>Check for Matches</b>. Pick the IGDB match, then click <b>Use this match</b>.",
        ),
      },
      {
        ...tryIt,
        id: "wrong-match",
        // The answers once the report is open; "It's a different game" hands
        // over to the sample search.
        anchorTargets: [
          a("demo-action-result"),
          a("demo-report-dialog"),
          a("demo-sample-search"),
          a("demo-menu-report-match"),
          a("demo-menu-matching"),
        ],
        title: t("Report a wrong match"),
        body: t(
          "The report asks what the file really is: another game, an app, or a file that is not the game. For a game with several files it first asks which file.",
        ),
        task: t(
          "Open <b>Matching</b>, click <b>Report Wrong Match</b> and pick an answer.",
        ),
      },
      {
        ...tryIt,
        id: "convert",
        anchorTargets: [a("demo-menu-convert-custom"), a("demo-menu-matching")],
        title: t("Convert to a custom game"),
        body: t(
          "For a game file no database knows correctly: you name the game yourself. Its playtime stays, and the change is only on this PC.",
        ),
        task: t(
          "Open <b>Matching</b>, click <b>Convert to Custom Game</b> and confirm the name.",
        ),
      },
      {
        // The last step is for reading; either entry can still be tried.
        id: "remove",
        view: "games",
        anchor: a("demo-game-card"),
        anchorTargets: [a("demo-action-result"), a("demo-menu-ignore")],
        interactive: true,
        manualAdvance: true,
        allow: sampleCardAllow,
        title: t("Remove or ignore"),
        body: t(
          "<b>Remove from Library</b> takes a game out until you play it again. <b>Ignore Game</b> also blocks its file; undo that under <b>Discovered</b> → <b>Ignored</b>. In the app, every card has this menu.",
        ),
      },
    ],
  };
}
