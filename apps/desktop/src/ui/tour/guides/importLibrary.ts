import { Download } from "lucide-react";
import { getT } from "../../../i18n";
import type { TourDefinition, TourStep } from "../tourTypes";
import { a, NEXT_RELEASE } from "./shared";

const t = getT("tour");
const importT = getT("import");

/** The practice importer (ImportTourPractice.tsx): its own control the step
 *  rings, or the sample around it. */
const on = (target: string) =>
  ({
    view: "games",
    anchor: a("demo-import"),
    anchorTargets: [a(target)],
  }) satisfies Partial<TourStep>;

/** A task on the sample. Doing it finishes the step; the practice sets the
 *  next step up when it is skipped. */
const task = {
  interactive: true,
  manualAdvance: true,
  advanceOn: { type: "event", name: "demo.step-completed" },
  allow: [a("demo-import")],
} satisfies Partial<TourStep>;

/** Games the sample has under Ready to import. */
const SAMPLE_READY_GAMES = 3;

export function importLibraryGuide(): TourDefinition {
  return {
    id: "import-library",
    version: 3,
    release: NEXT_RELEASE,
    kind: "guide",
    category: "library",
    icon: Download,
    title: t("Import a launcher library"),
    description: t(
      "Bring games and their playtime over from Steam, Xbox and other launchers.",
    ),
    duration: t("3 min"),
    simulation: "import",
    finishView: "games",
    nextTourId: "launcher-accounts",
    steps: [
      {
        id: "start",
        ...on("import-find-games"),
        ...task,
        title: t("Where imports start"),
        body: t(
          "In the app, right-click My Games in the sidebar, or open the Launcher accounts page. This is a sample Xbox account: nothing is scanned and nothing is saved.",
        ),
        task: t("Click <b>Find games</b>."),
      },
      {
        id: "ready",
        ...on("import-shelf-ready"),
        additionalAnchors: [a("import-wrong-game")],
        title: t("Games PlayCounter is sure about"),
        body: t(
          "<b>Ready to import</b> holds games PlayCounter knows. They are checked; uncheck one to leave it out. If a match is off, <b>Wrong game?</b> lets you pick another.",
        ),
      },
      {
        id: "pick-game",
        ...on("import-pick-game"),
        ...task,
        title: t("Say which game it is"),
        body: t(
          "<b>Needs you</b> holds games PlayCounter isn't sure about. Here the launcher's name fits more than one game. The search finds others.",
        ),
        task: t("Click the cover of the right game, then <b>Import</b>."),
      },
      {
        id: "pick-file",
        ...on("import-pick-file"),
        ...task,
        title: t("Pick the file that starts it"),
        body: t(
          "This game is installed, and PlayCounter needs the file that starts it. That file is how it notices when you play.",
        ),
        task: t("Pick a file, then click <b>Import</b>."),
      },
      {
        id: "import",
        ...on("import-selected"),
        ...task,
        title: t("Import the checked games"),
        body: t(
          "The button at the bottom imports every checked game of the open group at once.",
        ),
        task: t("Click <b>{{button}}</b>.", {
          button: importT("Import {{count}} games", {
            count: SAMPLE_READY_GAMES,
          }),
        }),
      },
      {
        id: "totals",
        ...on("import-done-playtime"),
        title: t("Playtime totals come along"),
        body: t(
          "Steam's totals are read on this PC. Xbox, Epic Games, GOG and PlayStation give theirs when you sign in. Battle.net has none. A total never turns into made-up sessions.",
        ),
      },
      {
        id: "again",
        ...on("import-shelf-imported"),
        title: t("Import again for new playtime"),
        body: t(
          "<b>Already in My Games</b> lists games you imported before. Importing again brings their new playtime. Several accounts of one launcher are added up.",
        ),
      },
      {
        id: "auto-add",
        ...on("import-done-open"),
        title: t("New installs join by themselves"),
        body: t(
          "In the app, after a first import, new installs from Steam, Battle.net, Epic Games and GOG join My Games, as do new PlayStation games you play. Xbox needs another import. Games you removed are not added again.",
        ),
      },
    ],
  };
}
