import { Clock } from "lucide-react";
import { getT } from "../../../i18n";
import type { TourDefinition } from "../tourTypes";
import { a, sampleCardAllow } from "./shared";

const t = getT("tour");

export function logPlaytimeGuide(): TourDefinition {
  return {
    id: "log-playtime",
    version: 4,
    kind: "guide",
    category: "playtime",
    icon: Clock,
    title: t("Log missed playtime"),
    description: t(
      "Add a session PlayCounter missed, time play on a console, or set a total.",
    ),
    duration: t("3 min"),
    demoGame: true,
    finishView: "games",
    steps: [
      {
        id: "intro",
        view: "games",
        anchor: a("demo-game-card"),
        title: t("Log playtime by hand"),
        body: t(
          "PlayCounter missed a session, or you played somewhere else? Add the time yourself. This World of Warcraft card is a sample: nothing is saved.",
        ),
      },
      // The menu chain: each stage waits for the next one to appear, and
      // closing the menu or the dialog steps back.
      {
        id: "open-menu",
        view: "games",
        interactive: true,
        anchor: a("demo-game-card"),
        // Whatever a cover button opens instead can be used and closed too.
        allow: sampleCardAllow,
        advanceOn: {
          type: "anchor-present",
          selector: a("demo-menu-playtime"),
        },
        skipTo: "clock",
        title: t("Right-click the sample card"),
        body: t("Every card's menu has a <b>Playtime</b> entry."),
        task: t("Right-click the sample card."),
      },
      {
        id: "open-playtime",
        view: "games",
        interactive: true,
        anchor: a("demo-menu-playtime"),
        allow: [a("demo-context-menu")],
        advanceOn: {
          type: "anchor-present",
          selector: a("demo-menu-log-session"),
        },
        retreatWhenMissing: a("demo-context-menu"),
        backTo: "open-menu",
        skipTo: "clock",
        title: t("Open Playtime"),
        body: t("Everything about a game's playtime sits in this flyout."),
        task: t("Click <b>Playtime</b>, or point at it."),
      },
      {
        id: "pick-item",
        view: "games",
        interactive: true,
        anchor: a("demo-menu-log-session"),
        allow: [a("demo-context-menu"), a("demo-playtime-menu")],
        advanceOn: {
          type: "anchor-present",
          selector: a("demo-log-session-dialog"),
        },
        retreatWhenMissing: a("demo-playtime-menu"),
        backTo: "open-playtime",
        skipTo: "clock",
        title: t("Choose Log missed session"),
        body: t("It adds one session with the length and end time you enter."),
        task: t("Click <b>Log missed session</b>."),
      },
      {
        id: "fill-dialog",
        ownBackdrop: true,
        view: "games",
        interactive: true,
        // The button that finishes the step, not the whole dialog.
        anchor: a("demo-log-session-confirm"),
        allow: [a("demo-log-session-backdrop")],
        advanceOn: { type: "event", name: "mygames.demo-session-logged" },
        retreatWhenMissing: a("demo-log-session-dialog"),
        backTo: "open-menu",
        skipTo: "clock",
        title: t("Enter length and end time"),
        body: t(
          "The length is how long you played. The end time decides which day the session counts for.",
        ),
        task: t("Enter how long you played, then click <b>Log session</b>."),
      },
      {
        id: "result",
        view: "games",
        anchor: a("demo-playtime-result"),
        backTo: "open-menu",
        title: t("Playtime and sessions grew"),
        body: t(
          "The card shows the added time and one more session. On your own games the session is in <b>My History</b> and counts for charts, streaks and achievements.",
        ),
      },
      {
        id: "clock",
        view: "games",
        anchor: a("demo-card-log-session"),
        interactive: true,
        manualAdvance: true,
        allow: sampleCardAllow,
        advanceOn: { type: "event", name: "demo.step-completed" },
        title: t("Faster: the clock button"),
        body: t(
          "Point at any cover and a clock button appears. It opens the same dialog in one click.",
        ),
        task: t("Click the clock button on the sample card."),
      },
      {
        id: "timer",
        view: "games",
        anchor: a("demo-game-card"),
        anchorTargets: [a("demo-menu-start-timer"), a("demo-menu-playtime")],
        interactive: true,
        manualAdvance: true,
        allow: sampleCardAllow,
        advanceOn: { type: "event", name: "demo.step-completed" },
        title: t("Time play on a console"),
        body: t(
          "<b>Start timer</b> counts until you stop it, from this menu or in <b>Now Playing</b>. It keeps counting when PlayCounter restarts.",
        ),
        task: t("Open <b>Playtime</b> and click <b>Start timer</b>."),
      },
      {
        id: "alternative",
        view: "games",
        anchor: a("demo-game-card"),
        anchorTargets: [
          a("demo-action-result"),
          a("demo-menu-adjust-playtime"),
          a("demo-menu-playtime"),
        ],
        interactive: true,
        manualAdvance: true,
        allow: sampleCardAllow,
        title: t("Only know the total?"),
        body: t(
          "<b>Adjust total playtime</b> sets a lifetime number and adds no session. In the app, use the clock button or <b>Playtime</b> in a card's menu.",
        ),
      },
    ],
  };
}
