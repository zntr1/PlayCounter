import { Trophy } from "lucide-react";
import { getT } from "../../../i18n";
import type { TourDefinition } from "../tourTypes";
import { NEXT_RELEASE } from "./shared";

const t = getT("tour");

// Starting point only: the steps are still to be written (docs/tours-plan.md, WP6).
export function gameAchievementsGuide(): TourDefinition {
  return {
    id: "game-achievements",
    version: 1,
    release: NEXT_RELEASE,
    kind: "guide",
    category: "playtime",
    icon: Trophy,
    title: t("Achievements & trophies"),
    description: t("Milestones, game ladders and launcher achievements."),
    duration: t("2 min"),
    steps: [
      {
        id: "intro",
        view: "achievements",
        title: t("Two kinds of achievements"),
        body: t(
          "PlayCounter has its own milestones and shows the achievements your launchers know.",
        ),
      },
    ],
  };
}
