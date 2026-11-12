import { Star } from "lucide-react";
import { getT } from "../../../i18n";
import type { TourDefinition } from "../tourTypes";
import { a, libraryTourCard } from "./shared";

const t = getT("tour");

export function organizeLibraryGuide(): TourDefinition {
  return {
    id: "organize-library",
    version: 2,
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
        anchor: a("demo-organization"),
        title: t("Make a library that fits you"),
        body: t(
          "Favorites keep the games you play most within reach. Shelves let you group games any way you like, and a game can sit on several shelves at once. Practice with the sample World of Warcraft and GTA V cards below. Nothing in this practice library is saved.",
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
        allow: [a("demo-library-stage"), a("demo-library-menu")],
        title: t("Keep a favorite close"),
        body: t(
          "Drag a sample card onto Favorites, or right-click the card and choose Add to Favorites. A star appears on its cover, and the guide moves on by itself.",
        ),
      },
      {
        id: "create-shelf",
        view: "games",
        anchor: a("demo-new-shelf"),
        anchorTargets: [a("demo-shelf-name")],
        additionalAnchors: [a("demo-shelf-save")],
        interactive: true,
        advanceOn: { type: "event", name: "library.demo-shelf-created" },
        skipTo: "fill-shelf",
        allow: [a("demo-organization"), a("demo-library-modal")],
        title: t("Create your own shelf"),
        body: t(
          "Click Favorites anytime to see only your favorites. Now click New shelf, type a name such as “Online Games”, and press Enter. The new shelf starts empty, ready for the games you choose.",
        ),
      },
      {
        id: "fill-shelf",
        view: "games",
        anchor: a("demo-personal-shelf"),
        anchorTargets: [
          a("demo-journal-shelf-choice"),
          a("demo-journal-shelf"),
          a("demo-menu-journal"),
        ],
        additionalAnchors: [libraryTourCard],
        interactive: true,
        manualAdvance: true,
        advanceOn: { type: "event", name: "demo.step-completed" },
        allow: [
          a("demo-library-stage"),
          a("demo-library-menu"),
          a("demo-shelf-menu"),
          a("demo-library-modal"),
        ],
        title: t("Put games on your shelf"),
        body: t(
          "We switched back to All games. Drag a sample card onto your new shelf. Without dragging: right-click a card, choose Journal, then Add to shelf. While you drag, a shelf that cannot take the game tells you why.",
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
          "A shelf can also fill itself from filters. We opened your shelf and its Filters. Under Progress, choose In progress. You can combine filters for progress, playtime, emulator, and how long a game has not been played.",
        ),
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
        title: t("Save the filters to your shelf"),
        body: t(
          "The cards below now preview every game with that status; the sample World of Warcraft already has it. Click Save filters. From now on, games join or leave this shelf on their own as they match the filters. To change them later, right-click the shelf and choose Edit filters. Remove saved filters brings back the games you added by hand. A shelf with saved filters does not accept dragged games, and tells you so when you try.",
        ),
      },
      {
        id: "finish",
        view: "games",
        anchor: a("demo-organization"),
        title: t("My Games remembers your view"),
        body: t(
          "Your search and the shelf you selected stay in place when you switch to another page and come back. Next up: give several games a progress status at once and choose what their cards show.",
        ),
      },
    ],
  };
}
