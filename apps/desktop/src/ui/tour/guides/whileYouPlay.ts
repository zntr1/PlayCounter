import { Timer } from "lucide-react";
import { getT } from "../../../i18n";
import type { TourDefinition } from "../tourTypes";
import { NEXT_RELEASE } from "./shared";

const t = getT("tour");

// Starting point only: the steps are still to be written (docs/tours-plan.md, WP6).
export function whileYouPlayGuide(): TourDefinition {
  return {
    id: "while-you-play",
    version: 1,
    release: NEXT_RELEASE,
    kind: "guide",
    category: "playtime",
    icon: Timer,
    title: t("While you play"),
    description: t("Live timer, reminder, pause and the hotkeys."),
    duration: t("2 min"),
    steps: [
      {
        id: "intro",
        view: "now",
        title: t("PlayCounter while a game runs"),
        body: t(
          "A timer on your game, a reminder, and keys that work without leaving it.",
        ),
      },
    ],
  };
}
