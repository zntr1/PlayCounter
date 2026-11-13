import { Star } from "lucide-react";
import { getT } from "../../../i18n";
import type { TourDefinition } from "../tourTypes";
import { a, libraryTourCard } from "./shared";

const t = getT("tour");

// The practice card's menu.
const cardMenu = [a("demo-library-menu"), a("demo-context-menu")];

export function organizeLibraryGuide(): TourDefinition {
  return {
    id: "organize-library",
    version: 3,
    kind: "guide",
    category: "library",
    icon: Star,
    title: t("Favorites & shelves"),
    description: t(
      "Mark favorites, build a shelf by hand, and let filters fill one automatically.",
    ),
    duration: t("3 min"),
    practice: true,
    finishView: "games",
    release: "1.1.17",
    nextTourId: "library-progress",
    steps: [
      {
        id: "intro",
        view: "games",
        title: t("Make a library that fits you"),
        body: t(
          "<b>Favorites</b> keep the games you play most within reach. Shelves group games any way you like.",
        ),
      },
      {
        id: "favorite",
        view: "games",
        anchor: a("demo-favorites"),
        anchorTargets: [a("demo-menu-favorite")],
        additionalAnchors: [libraryTourCard],
        interactive: true,
        manualAdvance: true,
        advanceOn: { type: "event", name: "demo.step-completed" },
        allow: [a("demo-library-stage"), ...cardMenu],
        title: t("Keep a favorite close"),
        body: t(
          "A favorite gets a star on its cover and shows under <b>Favorites</b>.",
        ),
        task: t(
          "Right-click a card and choose <b>Add to Favorites</b>. Dragging the card onto <b>Favorites</b> works too.",
        ),
      },
      {
        id: "create-shelf",
        view: "games",
        anchor: a("demo-new-shelf"),
        anchorTargets: [a("demo-shelf-name")],
        additionalAnchors: [a("demo-shelf-save")],
        interactive: true,
        manualAdvance: true,
        advanceOn: { type: "event", name: "library.demo-shelf-created" },
        allow: [a("demo-organization"), a("demo-library-modal")],
        title: t("Create your own shelf"),
        body: t(
          "A shelf is a list you name yourself: co-op games, the backlog, anything. It starts empty.",
        ),
        task: t(
          "Click <b>New shelf</b>, type a name such as “Online Games” and press <kbd>Enter</kbd>.",
        ),
      },
      {
        id: "fill-shelf",
        view: "games",
        anchor: a("demo-personal-shelf"),
        // The dialog of New shelf, the shelf in the open flyout, then Shelves.
        anchorTargets: [
          a("demo-shelf-name"),
          a("demo-menu-shelf"),
          a("demo-menu-shelves"),
        ],
        additionalAnchors: [libraryTourCard],
        interactive: true,
        manualAdvance: true,
        advanceOn: { type: "event", name: "demo.step-completed" },
        allow: [
          a("demo-library-stage"),
          ...cardMenu,
          a("demo-shelf-menu"),
          a("demo-library-modal"),
        ],
        title: t("Put games on your shelf"),
        body: t(
          "A game can sit on several shelves at once. <b>New shelf</b> in the same menu creates a shelf with the game already on it.",
        ),
        task: t(
          "Right-click a card, open <b>Shelves</b> and pick your shelf. Dragging the card onto the shelf works too.",
        ),
      },
      {
        id: "hide-shelf",
        view: "games",
        anchor: a("demo-personal-shelf"),
        anchorTargets: [a("demo-shelf-hide-all"), a("demo-shelf-hide")],
        interactive: true,
        manualAdvance: true,
        advanceOn: { type: "event", name: "demo.step-completed" },
        allow: [
          a("demo-organization"),
          a("demo-library-menu"),
          a("demo-shelf-hide-menu"),
        ],
        title: t("Hide a shelf's games"),
        body: t(
          "Only a shelf you fill yourself can keep its games out of All games, My History and other places. The games stay on the shelf.",
        ),
        task: t(
          "Right-click your shelf, open <b>Hide in</b> and tick <b>All games and search</b>.",
        ),
      },
      {
        id: "filters",
        view: "games",
        anchor: a("demo-filters-toggle"),
        anchorTargets: [a("demo-filter-status-playing")],
        interactive: true,
        manualAdvance: true,
        advanceOn: { type: "event", name: "demo.step-completed" },
        allow: [a("demo-organization")],
        title: t("Let a shelf fill itself"),
        body: t(
          "A shelf can also fill itself from filters. We opened your shelf and its <b>Filters</b>; the cards below show what matches.",
        ),
        task: t("Under <b>Progress</b>, choose <b>In progress</b>."),
      },
      {
        id: "save-filters",
        view: "games",
        anchor: a("demo-filters-toggle"),
        anchorTargets: [
          `${a("demo-save-filters")}:not(:disabled)`,
          a("demo-filtered-shelf"),
        ],
        interactive: true,
        manualAdvance: true,
        advanceOn: { type: "event", name: "demo.step-completed" },
        allow: [a("demo-organization"), a("demo-library-menu")],
        title: t("Save the filters"),
        body: t(
          "From now on, games join or leave this shelf on their own, and its hiding pauses until you remove the filters.",
        ),
        task: t("Click <b>Save filters</b>."),
      },
      {
        id: "finish",
        view: "games",
        anchor: a("demo-favorites"),
        // The player's shelf, if the guide left one.
        anchorTargets: [a("demo-filtered-shelf"), a("demo-personal-shelf")],
        title: t("Shelves in your own library"),
        body: t(
          "In My Games, right-click a game and open <b>Shelves</b>, or drag it onto a shelf. With many shelves, the ones that do not fit one row wait behind “+N more”.",
        ),
      },
    ],
  };
}
