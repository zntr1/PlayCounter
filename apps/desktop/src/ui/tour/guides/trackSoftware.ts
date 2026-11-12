import { AppWindow } from "lucide-react";
import { getT } from "../../../i18n";
import type { TourDefinition } from "../tourTypes";
import { NEXT_RELEASE } from "./shared";

const t = getT("tour");

// Starting point only: the steps are still to be written (docs/tours-plan.md, WP6).
export function trackSoftwareGuide(): TourDefinition {
  return {
    id: "track-software",
    version: 1,
    release: NEXT_RELEASE,
    kind: "guide",
    category: "detection",
    icon: AppWindow,
    title: t("Track software"),
    description: t("Count how long apps like Discord run, apart from games."),
    duration: t("1 min"),
    steps: [
      {
        id: "intro",
        view: "discovered",
        title: t("Not a game, still worth counting"),
        body: t("Apps get their own page and never mix into your game stats."),
      },
    ],
  };
}
