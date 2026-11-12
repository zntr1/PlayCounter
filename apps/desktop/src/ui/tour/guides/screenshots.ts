import { Camera } from "lucide-react";
import { getT } from "../../../i18n";
import type { TourDefinition } from "../tourTypes";
import { NEXT_RELEASE } from "./shared";

const t = getT("tour");

// Starting point only: the steps are still to be written (docs/tours-plan.md, WP6).
export function screenshotsGuide(): TourDefinition {
  return {
    id: "screenshots",
    version: 1,
    release: NEXT_RELEASE,
    kind: "guide",
    category: "playtime",
    icon: Camera,
    title: t("Screenshots"),
    description: t(
      "Take pictures with a hotkey and find them on your sessions.",
    ),
    duration: t("1 min"),
    steps: [
      {
        id: "intro",
        view: "history",
        title: t("Pictures of your sessions"),
        body: t(
          "A key takes a picture of your game; it shows up on the session it belongs to.",
        ),
      },
    ],
  };
}
