import { Layers } from "lucide-react";
import { getT } from "../../../i18n";
import type { TourDefinition } from "../tourTypes";
import { a, gtaTourCard } from "./shared";

const t = getT("tour");

export function rateGamesGuide(): TourDefinition {
  return {
    id: "rate-games",
    version: 1,
    kind: "guide",
    category: "library",
    icon: Layers,
    title: t("Rate your games"),
    description: t(
      "Give your games a tier from S to F, then sort and filter your library by it.",
    ),
    duration: t("2 min"),
    practice: true,
    finishView: "games",
    release: "1.4.3",
    steps: [
      {
        id: "intro",
        view: "games",
        anchor: a("demo-library-cards"),
        title: t("Rank your games, S to F"),
        body: t(
          "A tier is your own verdict on a game: S is the best, F the worst. It stays on this PC. Practice with the sample World of Warcraft and GTA V cards below. Nothing in this practice library is saved.",
        ),
      },
      {
        id: "rate",
        view: "games",
        anchor: gtaTourCard,
        anchorTargets: [a("demo-tier-S"), a("demo-menu-tier")],
        interactive: true,
        manualAdvance: true,
        advanceOn: { type: "event", name: "demo.step-completed" },
        allow: [
          a("demo-library-stage"),
          a("demo-library-menu"),
          a("demo-tier-menu"),
        ],
        title: t("Give GTA V a tier"),
        body: t(
          "Right-click the GTA V card, open Tier and choose S – Best, or any letter you like. The letter appears on the cover, and the guide moves on by itself.",
        ),
      },
      {
        id: "sort",
        view: "games",
        anchor: a("demo-sort"),
        interactive: true,
        manualAdvance: true,
        advanceOn: { type: "event", name: "demo.step-completed" },
        allow: [a("demo-library-stage")],
        title: t("Sort by tier"),
        body: t(
          "Open the sort menu and choose Sort: Tier. GTA V moves ahead of World of Warcraft, because games without a tier go last. Inside a tier, the most played game comes first. My Games has the same menu.",
        ),
      },
      {
        id: "filter",
        view: "games",
        anchor: a("demo-filters-toggle"),
        anchorTargets: [a("demo-filter-tier-S")],
        interactive: true,
        manualAdvance: true,
        advanceOn: { type: "event", name: "demo.step-completed" },
        allow: [a("demo-organization")],
        title: t("Show one tier"),
        body: t(
          "We opened Filters. Under Tier, choose the letter you gave GTA V. Only GTA V stays, because World of Warcraft has no tier yet; No tier shows exactly the games you have not rated. Saved on a shelf, these filters make an “S tier” shelf that keeps itself up to date.",
        ),
      },
      {
        id: "finish",
        view: "games",
        anchor: a("demo-library-cards"),
        title: t("Your verdict, everywhere"),
        body: t(
          "Both samples are back, sorted by tier. In your own library, Game details shows your tier next to the IGDB rating, and you can change it there too. Customize → Tiers on cards hides the letters without deleting them. Everything from this practice disappears when you finish.",
        ),
      },
    ],
  };
}
