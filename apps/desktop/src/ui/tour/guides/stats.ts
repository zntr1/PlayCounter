import { ChartColumn } from "lucide-react";
import { getT } from "../../../i18n";
import type { TourDefinition } from "../tourTypes";
import { a } from "./shared";

const t = getT("tour");

export function statsGuide(): TourDefinition {
  return {
    id: "stats",
    version: 2,
    kind: "guide",
    category: "playtime",
    icon: ChartColumn,
    title: t("Read your stats"),
    description: t("Explore sample sessions, ranges, and charts."),
    duration: t("2 min"),
    simulation: "stats",
    finishView: "history",
    steps: [
      {
        id: "intro",
        view: "history",
        anchor: a("demo-stats"),
        title: t("Your history, with sample sessions"),
        body: t(
          "This practice history contains six completed sessions spread over several weeks. Next you'll explore ranges, charts, and session actions; your own history stays unchanged.",
        ),
      },
      {
        id: "sessions",
        view: "history",
        anchor: a("demo-stats"),
        anchorTargets: [`${a("demo-stats")} ${a("history-hero")}`],
        interactive: true,
        manualAdvance: true,
        allow: [
          a("demo-library-stage"),
          a("demo-library-menu"),
          a("demo-library-modal"),
        ],
        title: t("Compare a week with all time"),
        body: t(
          "Use the range chips to scope the page. Notice how hours and session count change. A highlight takes you to the sessions behind it. Right-click a session to filter by game, open its journal, or practice deleting it.",
        ),
      },
      {
        id: "charts",
        view: "history",
        anchor: a("demo-stats"),
        interactive: true,
        manualAdvance: true,
        allow: [
          a("demo-library-stage"),
          a("demo-library-menu"),
          a("demo-library-modal"),
        ],
        title: t("Explore Insights and Games"),
        body: t(
          "Insights is open now. Change the range and inspect the charts. Games ranks your playtime by game. Sessions returns to the timeline. Imported launcher totals do not invent past sessions for these charts.",
        ),
      },
      {
        id: "milestones",
        view: "history",
        anchor: a("demo-stats"),
        title: t("Milestones and launcher achievements"),
        body: t(
          "PlayCounter milestones reward local tracking, such as reaching a playtime goal. Provider achievements come from supported launcher imports and belong to individual games. They are separate systems. Find local milestones under Achievements. Imported provider achievements appear in the details of supported games.",
        ),
      },
    ],
  };
}
