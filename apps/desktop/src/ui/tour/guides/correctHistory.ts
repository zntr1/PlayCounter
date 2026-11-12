import { History } from "lucide-react";
import { getT } from "../../../i18n";
import type { TourDefinition } from "../tourTypes";
import { NEXT_RELEASE } from "./shared";

const t = getT("tour");

// Starting point only: the steps are still to be written (docs/tours-plan.md, WP6).
export function correctHistoryGuide(): TourDefinition {
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
    steps: [
      {
        id: "intro",
        view: "history",
        title: t("Fix a session that went wrong"),
        body: t(
          "Left the game open overnight? Change, split or combine saved sessions.",
        ),
      },
    ],
  };
}
