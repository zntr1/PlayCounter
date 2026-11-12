import { SlidersHorizontal } from "lucide-react";
import { getT } from "../../../i18n";
import type { TourDefinition } from "../tourTypes";
import { a, sampleCardAllow, sampleCardDialogs } from "./shared";

const t = getT("tour");

export function gameActionsGuide(): TourDefinition {
  return {
    id: "game-actions",
    version: 4,
    kind: "guide",
    category: "library",
    icon: SlidersHorizontal,
    title: t("Manage a game in your library"),
    description: t(
      "Practice history, playtime, matching, and removal actions.",
    ),
    duration: t("2 min"),
    demoGame: true,
    finishView: "games",
    steps: [
      {
        id: "intro",
        view: "games",
        anchor: a("demo-game-card"),
        title: t("More actions for every game"),
        body: t(
          "Every card in My Games has a right-click menu. It's where you fix playtime, correct a wrong match, or get rid of a game.\n\nWe'll use a sample card, so nothing in your library can change.",
        ),
      },
      {
        id: "open-menu",
        view: "games",
        interactive: true,
        anchor: a("demo-game-card"),
        allow: [a("demo-game-card")],
        advanceOn: {
          type: "anchor-present",
          selector: a("demo-menu-show-history"),
        },
        skipTo: "history",
        title: t("Right-click the sample card"),
        body: t(
          "Which items you get depends on where the game came from. This sample is a community match, so you see what a matched game offers. A game you added yourself has a few different items.",
        ),
      },
      {
        id: "details",
        view: "games",
        anchor: a("demo-game-card"),
        anchorTargets: [a("demo-game-details"), a("demo-menu-details")],
        interactive: true,
        manualAdvance: true,
        allow: [
          a("demo-game-card"),
          a("demo-context-menu"),
          a("demo-library-modal"),
          a("demo-library-menu"),
        ],
        title: t("Look inside the game details"),
        body: t(
          "Choose Open Details and try General and Files. General brings together the game's information and playtime. Files separates known executable matches from saved local launch paths. A known filename alone does not mean the game is installed. This sample uses local data only.",
        ),
      },
      {
        id: "history",
        view: "games",
        anchor: a("demo-game-card"),
        anchorTargets: [...sampleCardDialogs, a("demo-menu-show-history")],
        interactive: true,
        manualAdvance: true,
        allow: sampleCardAllow,
        title: t("See only this game's sessions"),
        body: t(
          "Try Show History to open sample sessions. In your library, it opens My History filtered to the game you chose.",
        ),
      },
      {
        id: "playtime",
        view: "games",
        anchor: a("demo-game-card"),
        anchorTargets: [
          ...sampleCardDialogs,
          a("demo-playtime-menu"),
          a("demo-menu-playtime"),
        ],
        interactive: true,
        manualAdvance: true,
        allow: sampleCardAllow,
        title: t("Add playtime that's missing"),
        body: t(
          "Open Playtime for two options: Log missed session adds one session with the date and length you enter. Adjust total playtime changes only the lifetime number - useful when you carry a total over from a launcher.",
        ),
      },
      {
        id: "matches",
        view: "games",
        anchor: a("demo-game-card"),
        anchorTargets: [
          ...sampleCardDialogs,
          a("demo-menu-check-matches"),
          a("demo-menu-matching"),
        ],
        interactive: true,
        manualAdvance: true,
        allow: sampleCardAllow,
        title: t("Look the game up again"),
        body: t(
          "Open Matching and choose Check for Matches. This sample opens bundled results for you to review. In the real library, it checks IGDB and Community matches for the filename again; a custom game can become a matched game.",
        ),
      },
      {
        id: "wrong-match",
        view: "games",
        anchor: a("demo-game-card"),
        anchorTargets: [
          ...sampleCardDialogs,
          a("demo-menu-report-match"),
          a("demo-menu-matching"),
        ],
        additionalAnchors: [a("demo-menu-convert-custom")],
        interactive: true,
        manualAdvance: true,
        allow: sampleCardAllow,
        title: t("Fix a wrong match"),
        body: t(
          "Report Wrong Match starts a review of the correct game. Try the sample review; nothing is submitted. You can also try Convert to Custom Game and enter a name. The sample keeps its playtime and shows your custom name.",
        ),
      },
      {
        id: "remove",
        view: "games",
        anchor: a("demo-game-card"),
        anchorTargets: [...sampleCardDialogs, a("demo-menu-remove")],
        additionalAnchors: [a("demo-menu-ignore")],
        interactive: true,
        manualAdvance: true,
        allow: sampleCardAllow,
        title: t("Remove is not the same as ignore"),
        body: t(
          "Remove from Library takes the game out of My Games and asks whether to keep its sessions. If you keep them, notes, playthroughs, and shelf membership stay too. The game can return the next time you play it.\n\nIgnore Game does the same, and blocks the file on top - so PlayCounter never picks it up again. Try both on the sample; nothing is removed or blocked for real.",
        ),
      },
    ],
  };
}
