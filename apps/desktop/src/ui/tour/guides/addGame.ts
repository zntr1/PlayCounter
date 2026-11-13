import { Plus } from "lucide-react";
import { getT } from "../../../i18n";
import type { TourDefinition } from "../tourTypes";
import { a, NEXT_RELEASE, sampleCardAllow, sampleCardDialogs } from "./shared";

const t = getT("tour");

/** The Add game dialog and its backdrop: what a step in the dialog may touch. */
const addGameDialog = [a("demo-add-game-dialog"), a("demo-add-game-backdrop")];

export function addGameGuide(): TourDefinition {
  return {
    id: "add-game",
    version: 3,
    release: NEXT_RELEASE,
    kind: "guide",
    category: "library",
    icon: Plus,
    title: t("Add a game yourself"),
    description: t("Add a game by title that PlayCounter hasn't seen yet."),
    duration: t("2 min"),
    demoGame: true,
    finishView: "games",
    steps: [
      {
        id: "intro",
        view: "games",
        anchor: a("demo-add-game-button"),
        title: t("Most games add themselves"),
        body: t(
          "Most PC games join My Games by themselves the first time you play them. <b>Add game</b> is for the rest, like a game you haven't started yet or one you play on a console. This is a sample library: nothing is saved.",
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
        title: t("Add the game"),
        body: t(
          "A card in My Games. With a game file, Play starts it right away; without one, the game is matched the first time you run it.",
        ),
        task: t(
          "Click <b>Add game</b>, then <b>Done</b>. The file is optional.",
        ),
      },
      {
        id: "wrong-game",
        view: "games",
        anchor: a("demo-game-card"),
        anchorTargets: [...sampleCardDialogs, a("demo-menu-remove")],
        interactive: true,
        manualAdvance: true,
        allow: sampleCardAllow,
        advanceOn: { type: "event", name: "demo.step-completed" },
        title: t("Picked the wrong game?"),
        body: t(
          "Then remove it and add the right one. The dialog asks whether to keep the sessions it already has.",
        ),
        task: t(
          "Right-click the sample card, choose <b>Remove from Library</b> and confirm.",
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
