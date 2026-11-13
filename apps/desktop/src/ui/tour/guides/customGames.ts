import { FilePen } from "lucide-react";
import { getT } from "../../../i18n";
import type { TourDefinition } from "../tourTypes";
import { a, NEXT_RELEASE, sampleCardAllow, sampleCardDialogs } from "./shared";

const t = getT("tour");

/** A step that tries one entry of the sample card's Matching menu. */
const matchingEntry = {
  view: "games",
  anchor: a("demo-game-card"),
  interactive: true,
  manualAdvance: true,
  allow: sampleCardAllow,
  advanceOn: { type: "event", name: "demo.step-completed" },
} as const;

/** Custom games: when adding a game as custom helps, where one is made, and
 *  what its card's Matching menu offers. The sample card is a custom game. */
export function customGamesGuide(): TourDefinition {
  return {
    id: "custom-games",
    version: 1,
    release: NEXT_RELEASE,
    kind: "guide",
    category: "detection",
    icon: FilePen,
    title: t("Custom games"),
    description: t("When to add a game as custom, and how to fix or share it."),
    duration: t("2 min"),
    demoGame: true,
    finishView: "games",
    steps: [
      {
        id: "intro",
        view: "games",
        title: t("Games you name yourself"),
        body: t(
          "A custom game is a game file you named yourself. PlayCounter tracks it on this PC only; sharing it is up to you.",
        ),
      },
      {
        id: "when",
        view: "games",
        anchor: a("demo-game-card"),
        title: t("When adding as custom helps"),
        body: t(
          "When no database knows the file: a mod, a private build, a prototype, a fan game. Or when a file is matched wrong and the right game is in no database.",
        ),
      },
      {
        id: "where",
        view: "games",
        anchor: a("nav-discovered"),
        title: t("Where you make one"),
        body: t(
          "In <b>Discovered</b>, <b>Add as Custom</b> turns an unknown app into one. A card whose match is wrong has <b>Convert to Custom Game</b> under <b>Matching</b>.",
        ),
      },
      {
        ...matchingEntry,
        id: "change-game",
        anchorTargets: [
          ...sampleCardDialogs,
          a("demo-menu-change-game"),
          a("demo-matching-menu"),
          a("demo-menu-matching"),
        ],
        title: t("Fix a wrong game"),
        body: t(
          "If you picked the wrong game, the card's menu changes it. The playtime stays with the card.",
        ),
        task: t(
          "Right-click the sample card, open <b>Matching</b>, click <b>Change Game…</b>, pick a game and confirm.",
        ),
      },
      {
        ...matchingEntry,
        id: "suggest",
        anchorTargets: [
          ...sampleCardDialogs,
          a("demo-menu-suggest-community"),
          a("demo-matching-menu"),
          a("demo-menu-matching"),
        ],
        title: t("Share it with the community"),
        body: t(
          "A game you added yourself stays on this PC. Send its file to the community, and once it is approved everyone's PlayCounter knows it.",
        ),
        task: t(
          "Open <b>Matching</b>, click <b>Suggest to Community</b>, pick the game and confirm.",
        ),
      },
      {
        ...matchingEntry,
        id: "check-matches",
        anchorTargets: [
          ...sampleCardDialogs,
          a("demo-menu-check-matches"),
          a("demo-matching-menu"),
          a("demo-menu-matching"),
        ],
        title: t("Check for matches"),
        body: t(
          "PlayCounter looks the game file up again in IGDB and in the community's matches. A custom game can become a matched game this way.",
        ),
        task: t(
          "Open <b>Matching</b> and click <b>Check for Matches</b>. Pick the IGDB match, then click <b>Use this match</b>.",
        ),
      },
      {
        id: "finish",
        view: "games",
        anchor: a("demo-game-card"),
        title: t("Your own games"),
        body: t(
          "In the app, right-click a custom game and open <b>Matching</b>. The guide Understand game badges shows the Custom badge, its clock and its check.",
        ),
      },
    ],
  };
}
