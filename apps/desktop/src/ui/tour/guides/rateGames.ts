import { Layers } from "lucide-react";
import { getT } from "../../../i18n";
import type { TourDefinition } from "../tourTypes";
import { a, gtaTourCard } from "./shared";

const t = getT("tour");

// The practice card's menu, and its flyout for tiers.
const cardMenu = [a("demo-library-menu"), a("demo-context-menu")];

export function rateGamesGuide(): TourDefinition {
  return {
    id: "rate-games",
    version: 2,
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
        anchor: gtaTourCard,
        title: t("Rank your games, S to F"),
        body: t(
          "A tier is your own verdict on a game: S is the best, F the worst. It stays on this PC. These are sample games: nothing is saved.",
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
        allow: [a("demo-library-stage"), ...cardMenu, a("demo-tier-menu")],
        title: t("Give GTA V a tier"),
        body: t(
          "The letter appears on the cover. The same menu changes or clears it.",
        ),
        task: t(
          "Right-click the GTA V card, open <b>Tier</b> and pick a letter, for example <b>S – Best</b>.",
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
          "Games without a tier go last. Inside a tier, the most played game comes first.",
        ),
        task: t("Open the sort menu and choose <b>Sort: Tier</b>."),
      },
      {
        id: "filter",
        view: "games",
        anchor: a("demo-filters-toggle"),
        // The letter the player picked, whichever it was.
        anchorTargets: [a("demo-filter-tier-picked")],
        interactive: true,
        manualAdvance: true,
        advanceOn: { type: "event", name: "demo.step-completed" },
        allow: [a("demo-organization")],
        title: t("Show one tier"),
        body: t(
          "We opened <b>Filters</b>. <b>No tier</b> shows the games you have not rated. Saved on a shelf, a tier filter makes a shelf that keeps itself up to date.",
        ),
        task: t("Under <b>Tier</b>, click the letter you gave GTA V."),
      },
      {
        id: "finish",
        view: "games",
        anchor: gtaTourCard,
        title: t("Your verdict, everywhere"),
        body: t(
          "In My Games, right-click a game and open <b>Tier</b>. Game details shows your tier next to the IGDB rating. <b>Tiers on cards</b> under <b>Customize</b> hides the letters.",
        ),
      },
    ],
  };
}
