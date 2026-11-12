import { ScanSearch } from "lucide-react";
import { getT } from "../../../i18n";
import type { TourDefinition, TourStep } from "../tourTypes";
import { a, discoveredAction, NEXT_RELEASE } from "./shared";

const t = getT("tour");

/** An exercise on the sample review card. The button a step rings is its
 *  exercise: using it finishes the step (discoveredSample.ts). */
const exercise = (button: string) =>
  ({
    view: "discovered",
    anchor: discoveredAction(button),
    interactive: true,
    manualAdvance: true,
    advanceOn: { type: "event", name: "demo.step-completed" },
    allow: [a("demo-discovery"), a("demo-library-modal")],
  }) satisfies Partial<TourStep>;

export function fixDetectionGuide(): TourDefinition {
  return {
    id: "fix-detection",
    version: 3,
    release: NEXT_RELEASE,
    kind: "guide",
    category: "detection",
    icon: ScanSearch,
    title: t("Fix an unrecognized game"),
    description: t(
      "Decide what an unknown app is: a game, software, or nothing to track.",
    ),
    duration: t("3 min"),
    simulation: "detection",
    finishView: "discovered",
    nextTourId: "track-software",
    steps: [
      {
        id: "intro",
        view: "discovered",
        anchor: discoveredAction("filters"),
        title: t("Unknown apps wait in Discovered"),
        body: t(
          "Apps PlayCounter can't match land in <b>Needs review</b>. <b>Tracked</b> and <b>Ignored</b> show what was decided. These are sample apps: nothing is saved or sent.",
        ),
      },
      {
        id: "look",
        view: "discovered",
        anchor: discoveredAction("app"),
        additionalAnchors: [discoveredAction("folder")],
        title: t("Is this a game?"),
        body: t(
          "The card shows the app's name, its file, whether it runs right now, and its folder. A hint appears when the folder looks like a game's.",
        ),
      },
      {
        id: "add-share",
        ...exercise("add-share"),
        anchorTargets: [a("demo-sample-search"), discoveredAction("add-share")],
        title: t("Match a game and share it"),
        body: t(
          "A shared match is reviewed. After that, PlayCounter recognizes this file for every player.",
        ),
        task: t(
          "Click <b>Add & Share</b>, pick the game and press <b>Add and share</b>.",
        ),
      },
      {
        id: "add-custom",
        ...exercise("add-custom"),
        anchorTargets: [
          discoveredAction("custom-entry"),
          discoveredAction("add-custom"),
        ],
        title: t("Keep a game to yourself"),
        body: t(
          "For mods, private builds and prototypes: a custom game is tracked on this PC and not shared.",
        ),
        task: t(
          "Click <b>Add as Custom</b>, give it a name and press <b>Save</b>.",
        ),
      },
      {
        id: "software",
        ...exercise("software"),
        title: t("Count an app that is no game"),
        body: t(
          "Discord, a launcher, a tool you work in: software is counted on its own page and never as a game.",
        ),
        task: t("Click <b>Track as software</b>."),
      },
      {
        id: "ignore",
        ...exercise("ignore"),
        title: t("Ignore a tool or helper"),
        body: t(
          "An ignored app is no longer tracked. It moves to <b>Ignored</b> and can be restored there. <b>Share apps you ignore</b> in Settings decides whether it is also reported.",
        ),
        task: t("Click <b>Ignore</b>."),
      },
      {
        id: "skip",
        ...exercise("skip"),
        title: t("Not sure? Skip it"),
        body: t(
          "A skipped app stays in <b>Needs review</b>. Nothing is matched or ignored, and the next app comes up.",
        ),
        task: t("Click <b>Skip for now</b>."),
      },
      {
        id: "ambiguous",
        view: "now",
        anchor: a("demo-ambiguous"),
        anchorTargets: [
          a("demo-sample-search"),
          a("demo-report-dialog"),
          `${a("demo-ambiguous")} ${a("ambiguous-candidates")}`,
        ],
        interactive: true,
        manualAdvance: true,
        advanceOn: { type: "event", name: "demo.step-completed" },
        allow: [a("demo-ambiguous"), a("demo-library-modal")],
        title: t("One file, several games"),
        body: t(
          "Some file names belong to several games. Now Playing then asks which one you started and remembers it on this PC. The buttons below cover every other case.",
        ),
        task: t("Click the cover of the game you started."),
      },
      {
        id: "finish",
        view: "discovered",
        anchor: discoveredAction("queue"),
        title: t("Check Discovered now and then"),
        body: t(
          "In the app, Discovered shows a number in the sidebar while apps wait. Go through them once, and PlayCounter remembers every answer.",
        ),
      },
    ],
  };
}
