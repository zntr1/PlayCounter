import { Image } from "lucide-react";
import { getT } from "../../../i18n";
import type { TourDefinition } from "../tourTypes";
import { NEXT_RELEASE } from "./shared";

const t = getT("tour");

// Starting point only: the steps are still to be written (docs/tours-plan.md, WP6).
export function coversBannersGuide(): TourDefinition {
  return {
    id: "covers-banners",
    version: 1,
    release: NEXT_RELEASE,
    kind: "guide",
    category: "library",
    icon: Image,
    title: t("Covers and banners"),
    description: t("Pick, upload or paste artwork for any game."),
    duration: t("2 min"),
    steps: [
      {
        id: "intro",
        view: "games",
        title: t("Your library, your artwork"),
        body: t("Every game can get a cover and a banner you choose."),
      },
    ],
  };
}
