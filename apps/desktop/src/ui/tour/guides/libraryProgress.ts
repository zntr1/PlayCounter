import { ListChecks } from "lucide-react";
import { getT } from "../../../i18n";
import type { TourDefinition } from "../tourTypes";
import { a, gtaTourCard, libraryTourCard, NEXT_RELEASE } from "./shared";

const t = getT("tour");

// The practice card's menu.
const cardMenu = [a("demo-library-menu"), a("demo-context-menu")];

export function libraryProgressGuide(): TourDefinition {
  return {
    id: "library-progress",
    version: 3,
    kind: "guide",
    category: "library",
    icon: ListChecks,
    title: t("Progress & card layout"),
    description: t(
      "Set a progress status for several games at once and choose what game cards show.",
    ),
    duration: t("3 min"),
    practice: true,
    finishView: "games",
    release: NEXT_RELEASE,
    nextTourId: "rate-games",
    steps: [
      {
        id: "intro",
        view: "games",
        anchor: libraryTourCard,
        additionalAnchors: [gtaTourCard],
        title: t("Track what you want to play next"),
        body: t(
          "A progress status is your own label for a game: In progress, On hold, Finished, Want to play and more. These are sample games and sample settings: nothing is saved.",
        ),
      },
      {
        id: "filter",
        view: "games",
        anchor: a("demo-filters-toggle"),
        anchorTargets: [a("demo-filter-status-none")],
        interactive: true,
        manualAdvance: true,
        advanceOn: { type: "event", name: "demo.step-completed" },
        allow: [a("demo-organization")],
        title: t("Find games without a status"),
        body: t(
          "We opened <b>Filters</b>. Narrow the view first, so you only change the games you mean. Both sample games start without a status.",
        ),
        task: t("Under <b>Progress</b>, choose <b>No status</b>."),
      },
      {
        id: "select",
        view: "games",
        anchor: a("demo-library-select"),
        // The next card to tick, then the count once both are ticked.
        anchorTargets: [
          `${a("demo-library-cards")} [role="checkbox"][aria-checked="false"]`,
          a("demo-bulk-count"),
        ],
        interactive: true,
        manualAdvance: true,
        advanceOn: { type: "event", name: "demo.step-completed" },
        allow: [a("demo-library-stage")],
        title: t("Select several games"),
        body: t(
          "In selection mode a click ticks a card. <kbd>Shift</kbd>-click takes everything in between, <kbd>Ctrl</kbd>/<kbd>Cmd</kbd>+<kbd>A</kbd> every game in view.",
        ),
        task: t("Click <b>Select</b>, then click both sample cards."),
      },
      {
        id: "apply",
        view: "games",
        anchor: a("demo-library-select"),
        anchorTargets: [
          a("demo-bulk-status-playing"),
          a("demo-bulk-set-status"),
          a("demo-library-result"),
        ],
        interactive: true,
        manualAdvance: true,
        advanceOn: { type: "event", name: "demo.step-completed" },
        allow: [a("demo-library-stage"), a("demo-library-menu")],
        title: t("Set their status together"),
        body: t(
          "The bar counts the selected games. <b>Clear status</b> in the same menu takes a status away again.",
        ),
        task: t("Click <b>Set status</b> and choose <b>In progress</b>."),
      },
      {
        id: "status-menu",
        view: "games",
        anchor: libraryTourCard,
        anchorTargets: [a("demo-status-finished"), a("demo-menu-status")],
        additionalAnchors: [gtaTourCard],
        interactive: true,
        manualAdvance: true,
        advanceOn: { type: "event", name: "demo.step-completed" },
        allow: [a("demo-library-stage"), ...cardMenu, a("demo-status-menu")],
        title: t("Change one game from its menu"),
        body: t(
          "A single game needs no selection: its right-click menu has the same statuses.",
        ),
        task: t(
          "Right-click a card, open <b>Status</b> and choose <b>Finished</b>.",
        ),
      },
      {
        id: "customize",
        view: "games",
        anchor: a("demo-customize-toggle"),
        anchorTargets: [a("demo-grid-columns")],
        interactive: true,
        manualAdvance: true,
        advanceOn: { type: "event", name: "demo.step-completed" },
        allow: [a("demo-library-stage"), a("demo-library-menu")],
        title: t("Choose how many cards fit in a row"),
        body: t(
          "Fewer cards per row means bigger covers. <b>Standard cards</b> and <b>Large cards</b>, the buttons beside the gear, bring back their own layout.",
        ),
        task: t(
          "Click the gear, <b>Customize</b>, and move the <b>Cards per row</b> slider.",
        ),
      },
      {
        id: "card-details",
        view: "games",
        anchor: a("demo-customize-toggle"),
        anchorTargets: [a("demo-show-status")],
        interactive: true,
        manualAdvance: true,
        advanceOn: { type: "event", name: "demo.step-completed" },
        allow: [a("demo-library-stage"), a("demo-library-menu")],
        title: t("Choose what the cards show"),
        body: t(
          "Hiding a badge only changes what you see. Your statuses, notes and shelves are kept.",
        ),
        task: t(
          "Switch <b>Status on cards</b> off and on again and watch the sample covers.",
        ),
      },
      {
        id: "finish",
        view: "games",
        anchor: a("demo-library-select"),
        additionalAnchors: [a("demo-customize-toggle")],
        title: t("Ready for your own library"),
        body: t(
          "In My Games, use <b>Select</b> for several games, or right-click one and open <b>Status</b>. What you set under <b>Customize</b> stays for the next start.",
        ),
      },
    ],
  };
}
