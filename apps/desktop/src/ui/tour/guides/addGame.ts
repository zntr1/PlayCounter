import { Plus } from "lucide-react";
import { getT } from "../../../i18n";
import type { TourDefinition } from "../tourTypes";
import { a, NEXT_RELEASE, sampleCardAllow, sampleCardDialogs } from "./shared";

const t = getT("tour");

/** The Add game dialog and its backdrop: what a step in the dialog may touch. */
const addGameDialog = [a("demo-add-game-dialog"), a("demo-add-game-backdrop")];

/** A step that tries one entry of the sample card's Matching menu. */
const matchingEntry = {
  view: "games",
  anchor: a("demo-game-card"),
  interactive: true,
  manualAdvance: true,
  allow: sampleCardAllow,
  advanceOn: { type: "event", name: "demo.step-completed" },
} as const;

export function addGameGuide(): TourDefinition {
  return {
    id: "add-game",
    version: 2,
    release: NEXT_RELEASE,
    kind: "guide",
    category: "library",
    icon: Plus,
    title: t("Add a game yourself"),
    description: t("Add any game by title, fix a wrong one, share it."),
    duration: t("2 min"),
    demoGame: true,
    finishView: "games",
    steps: [
      {
        id: "intro",
        view: "games",
        anchor: a("demo-add-game-button"),
        title: t("Any game, even without a launcher"),
        body: t(
          "Add a game by its title before you ever start it, with or without a launcher. This guide uses a sample library: nothing is saved or sent.",
        ),
      },
      {
        id: "open",
        view: "games",
        anchor: a("demo-add-game-button"),
        interactive: true,
        manualAdvance: true,
        allow: [a("demo-add-game-button")],
        advanceOn: {
          type: "anchor-present",
          selector: a("demo-add-game-dialog"),
        },
        title: t("Open Add game"),
        body: t(
          "The button sits above your cards in <b>My Games</b>. It works for any game, also one PlayCounter has never seen running.",
        ),
        task: t("Click <b>Add game</b>."),
      },
      {
        id: "search",
        view: "games",
        anchor: a("demo-add-game-search"),
        interactive: true,
        manualAdvance: true,
        allow: addGameDialog,
        advanceOn: {
          type: "anchor-present",
          selector: a("demo-add-game-results"),
        },
        title: t("Find it by title"),
        body: t(
          "Search by the game's title or its IGDB ID. This sample knows four titles, with no network.",
        ),
        task: t("Type World or Zelda and click <b>Search</b>."),
      },
      {
        id: "result",
        view: "games",
        anchorTargets: [a("demo-add-game-result"), a("demo-add-game-confirm")],
        anchor: a("demo-add-game-dialog"),
        interactive: true,
        manualAdvance: true,
        allow: addGameDialog,
        advanceOn: { type: "event", name: "demo.step-completed" },
        title: t("What you get"),
        body: t(
          "A card in My Games. With a game file, Play starts it right away; without one, the game is matched the first time you run it.",
        ),
        task: t(
          "Click <b>Add game</b>, then <b>Done</b>. The file is optional.",
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
        id: "quick-add",
        view: "settings",
        settingsGroup: "shortcuts",
        anchor: a("settings-row-quickAddHotkey"),
        title: t("Add from anywhere"),
        body: t(
          "<b>Quick add game</b> opens a small search box over any app. No key is set until you pick one: click the field and press the keys you want.",
        ),
      },
      {
        id: "finish",
        view: "games",
        anchor: a("demo-add-game-button"),
        title: t("Add your own"),
        body: t(
          "In the app, click Add game, search your game and add it. Its card gets the same menu as any other.",
        ),
      },
    ],
  };
}
