import { ListChecks } from "lucide-react";
import { getT } from "../../../i18n";
import type { TourDefinition } from "../tourTypes";
import { a } from "./shared";

const t = getT("tour");

export function libraryProgressGuide(): TourDefinition {
  return {
    id: "library-progress",
    version: 2,
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
    release: "1.1.17",
    nextTourId: "rate-games",
    steps: [
      {
        id: "intro",
        view: "games",
        anchor: a("demo-library-cards"),
        title: t("Track what you want to play next"),
        body: t(
          "A progress status is your own label for a game: In progress, On hold, Finished, Want to play, and more. It has nothing to do with whether the game is running right now. This guide uses sample cards and temporary settings; your library and preferences stay unchanged.",
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
          "We opened Filters. Under Progress, choose No status to show only games that have no status yet. Both sample games start without one. In your own library, narrow the view with search, a shelf, or filters first, so you only select the games you really want to change.",
        ),
      },
      {
        id: "select",
        view: "games",
        anchor: a("demo-library-select"),
        interactive: true,
        allow: [a("demo-library-stage")],
        advanceOn: {
          type: "anchor-present",
          selector: a("demo-bulk-actions"),
        },
        skipTo: "select-games",
        title: t("Turn on selection"),
        body: t(
          "Click Select. A checkbox appears on every card so you can pick several games at once. The guide continues as soon as selection is on.",
        ),
      },
      {
        id: "select-games",
        view: "games",
        anchor: a("demo-library-select"),
        anchorTargets: [
          `${a("demo-library-cards")} [role="checkbox"][aria-checked="false"]`,
          a("demo-bulk-count"),
        ],
        additionalAnchors: [`${a("demo-bulk-select-all")}:not(:disabled)`],
        interactive: true,
        manualAdvance: true,
        advanceOn: { type: "event", name: "demo.step-completed" },
        allow: [a("demo-library-stage")],
        title: t("Select a few games or all of them"),
        body: t(
          "Click both sample cards to select them; the highlight moves on to the next card that is not selected yet. Shift-click selects everything between two cards. Select all results (or Ctrl/Cmd+A) selects every game in the current view. Changing the search, shelf, or filters clears your selection.",
        ),
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
          "Click Set status and choose In progress. If you skipped the last step, both samples are selected for you. Clear status removes the status from the selected games.",
        ),
      },
      {
        id: "open-customize",
        view: "games",
        anchor: a("demo-customize-toggle"),
        interactive: true,
        allow: [a("demo-library-stage")],
        advanceOn: {
          type: "anchor-present",
          selector: a("demo-library-customize"),
        },
        skipTo: "customize",
        title: t("Open the card options"),
        body: t(
          "Games with a status leave the No status view, so we cleared the filters and every sample game is back. Click Customize. This is where you set how many cards fit in a row and which details show on the covers.",
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
        allow: [a("demo-library-stage")],
        title: t("Choose how many cards fit in a row"),
        body: t(
          "Move the Cards per row slider. The sample grid starts at three, with fewer columns in small windows. Fewer cards per row means bigger covers; more cards fit more games on screen. These are the same controls as Customize in My Games, but here they only change the practice library.",
        ),
      },
      {
        id: "card-details",
        view: "games",
        anchor: a("demo-customize-toggle"),
        anchorTargets: [a("demo-show-status")],
        additionalAnchors: [a("demo-show-notes"), a("demo-show-shelves")],
        interactive: true,
        manualAdvance: true,
        advanceOn: { type: "event", name: "demo.step-completed" },
        allow: [a("demo-library-stage")],
        title: t("Choose which details to show"),
        body: t(
          "Switch Status on cards or Notes on cards off and on again to watch the badges on the sample covers disappear and return. Shelves hides or shows the whole shelf row above the library. Hiding a badge only changes what you see; your statuses, notes, and shelves are kept.",
        ),
      },
      {
        id: "finish",
        view: "games",
        anchor: a("demo-library-cards"),
        title: t("Ready for your own library"),
        body: t(
          "In My Games, use Select to change a batch of games at once, or right-click a single card and choose Journal. Choices you make in the real Customize panel are remembered the next time you open PlayCounter. Everything from this practice disappears when you finish.",
        ),
      },
    ],
  };
}
