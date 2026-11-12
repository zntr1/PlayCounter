import { Hash } from "lucide-react";
import { getT } from "../../../i18n";
import type { TourDefinition } from "../tourTypes";
import { NEXT_RELEASE } from "./shared";

const t = getT("tour");

// Starting point only: the steps are still to be written (docs/tours-plan.md, WP6).
export function countersGuide(): TourDefinition {
  return {
    id: "counters",
    version: 1,
    release: NEXT_RELEASE,
    kind: "guide",
    category: "playtime",
    icon: Hash,
    title: t("Count deaths and bosses"),
    description: t("Counters with their own keys, shown while you play."),
    duration: t("2 min"),
    steps: [
      {
        id: "intro",
        view: "games",
        title: t("Count what matters to you"),
        body: t(
          "Deaths, bosses, runs: a counter per game, raised with a key you pick.",
        ),
      },
    ],
  };
}
