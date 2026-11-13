import { ChartColumn } from "lucide-react";
import { getT } from "../../../i18n";
import type { TourDefinition } from "../tourTypes";
import { a } from "./shared";

const t = getT("tour");

export function statsGuide(): TourDefinition {
  // The sample history, its menus and its dialogs.
  const practice = [
    a("demo-library-stage"),
    a("demo-library-menu"),
    a("demo-history-playtime-menu"),
    a("demo-library-modal"),
  ];
  return {
    id: "stats",
    version: 3,
    kind: "guide",
    category: "playtime",
    icon: ChartColumn,
    title: t("Read your stats"),
    description: t("Explore sample sessions, ranges, and charts."),
    duration: t("2 min"),
    simulation: "stats",
    finishView: "history",
    nextTourId: "game-achievements",
    steps: [
      {
        id: "intro",
        view: "history",
        anchor: a("demo-history-total"),
        title: t("Your playtime in one number"),
        body: t(
          "The big number is what you played in the range you picked. This is a sample history with six sessions: nothing is saved, and your own history stays as it is.",
        ),
      },
      {
        id: "ranges",
        view: "history",
        anchor: a("demo-history-ranges"),
        interactive: true,
        manualAdvance: true,
        allow: practice,
        advanceOn: { type: "event", name: "demo.step-completed" },
        title: t("Pick a time span"),
        body: t(
          "The range decides what the whole page counts: the number, the sessions and the charts. <b>Pick dates</b> takes any days, months or years you like.",
        ),
        task: t("Click <b>7 days</b>."),
      },
      {
        id: "compare",
        view: "history",
        anchor: a("demo-history-ranges"),
        anchorTargets: [a("demo-history-stepper")],
        additionalAnchors: [a("demo-history-compare")],
        interactive: true,
        manualAdvance: true,
        allow: practice,
        advanceOn: { type: "event", name: "demo.step-completed" },
        title: t("Compare with the time before"),
        body: t(
          "The line under the number compares the range with the one before it. The arrows beside the active range step one period back or forward.",
        ),
        task: t("Click the left arrow next to <b>7 days</b>."),
      },
      {
        id: "sessions",
        view: "history",
        anchor: a("demo-history-row"),
        interactive: true,
        manualAdvance: true,
        allow: practice,
        title: t("One row per session"),
        body: t(
          "A row shows the game, when you played and for how long. Its right-click menu holds notes, <b>Playthroughs</b>, <b>Filter for this game</b>, <b>Playtime</b> and <b>Delete Session</b>.",
        ),
      },
      {
        id: "charts",
        view: "history",
        anchor: a("demo-history-tab-insights"),
        anchorTargets: [a("demo-history-chart-playtime")],
        additionalAnchors: [a("demo-history-tab-games")],
        interactive: true,
        manualAdvance: true,
        allow: practice,
        advanceOn: { type: "event", name: "demo.step-completed" },
        title: t("Charts for your range"),
        body: t(
          "<b>Insights</b> draws the range: <b>Playtime over time</b>, <b>Game seasons</b>, <b>Cover calendar</b>, <b>Pace</b>, <b>Play habits</b> and <b>When you play</b>.",
        ),
        task: t("Open the <b>Games</b> tab."),
      },
      {
        id: "games",
        view: "history",
        anchor: a("demo-history-games"),
        title: t("Your most played games"),
        body: t(
          "<b>Games</b> ranks your playtime by game. In the app, a click on a game shows its sessions. Your own numbers are one click away: <b>Open My History</b>. Milestones come in the next guide.",
        ),
      },
    ],
  };
}
