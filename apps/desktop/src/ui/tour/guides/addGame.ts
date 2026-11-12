import { Plus } from "lucide-react";
import { getT } from "../../../i18n";
import type { TourDefinition } from "../tourTypes";
import { NEXT_RELEASE } from "./shared";

const t = getT("tour");

// Starting point only: the steps are still to be written (docs/tours-plan.md, WP6).
export function addGameGuide(): TourDefinition {
  return {
    id: "add-game",
    version: 1,
    release: NEXT_RELEASE,
    kind: "guide",
    category: "library",
    icon: Plus,
    title: t("Add a game yourself"),
    description: t("Add any game by title, fix a wrong one, share it."),
    duration: t("2 min"),
    steps: [
      {
        id: "intro",
        view: "games",
        title: t("Any game, even without a launcher"),
        body: t("Add a game by its title before you ever start it."),
      },
    ],
  };
}
