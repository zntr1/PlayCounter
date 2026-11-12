import { ScanSearch } from "lucide-react";
import { getT } from "../../../i18n";
import type { TourDefinition } from "../tourTypes";
import { a, discoveredAction } from "./shared";

const t = getT("tour");

export function fixDetectionGuide(): TourDefinition {
  return {
    id: "fix-detection",
    version: 2,
    kind: "guide",
    category: "detection",
    icon: ScanSearch,
    title: t("Fix an unrecognized game"),
    description: t("Search, review a match, and try a local filename choice."),
    duration: t("3 min"),
    simulation: "detection",
    finishView: "discovered",
    steps: [
      {
        id: "intro",
        resetsDiscoveredSample: true,
        view: "discovered",
        anchor: a("demo-discovery"),
        title: t("When a game isn't recognized"),
        body: t(
          "You'll use the real review controls with a sample Wow.exe. Search results are bundled for practice, so this works offline. Nothing here is saved or submitted.",
        ),
      },
      {
        id: "filters",
        view: "discovered",
        anchor: a("demo-discovery"),
        title: t("Start in Needs review"),
        body: t(
          "Discovered groups apps into Needs review, Tracked, and Ignored. The wizard reviews one executable at a time. This sample is running but has no game match yet.",
        ),
      },
      {
        id: "wizard",
        view: "discovered",
        anchor: a("demo-discovery"),
        title: t("Is this a game?"),
        body: t(
          "Check the executable name and running status. A file found in a watched folder also shows the folder it came from. You can search and share a game match, keep a custom name only on this PC, ignore a tool, or skip an app you are unsure about.",
        ),
      },
      {
        id: "add-share",
        view: "discovered",
        anchor: a("demo-discovery"),
        anchorTargets: [a("demo-sample-search"), discoveredAction("add-share")],
        interactive: true,
        manualAdvance: true,
        allow: [a("demo-library-stage"), a("demo-library-modal")],
        title: t("Search, check, and confirm"),
        body: t(
          "Click Add & Share. Search for World of Warcraft, choose its cover, then confirm the sample match. In your real library, Add & Share submits a suggestion for review. Here the result stays in this guide.",
        ),
      },
      {
        id: "add-custom",
        view: "discovered",
        anchor: a("demo-discovery"),
        anchorTargets: [
          discoveredAction("custom-entry"),
          discoveredAction("add-custom"),
        ],
        interactive: true,
        manualAdvance: true,
        allow: [a("demo-library-stage")],
        title: t("Keep a custom game local"),
        body: t(
          "Try Add as Custom, enter a name, and save it. This is useful for private builds, mods, and prototypes. It creates no shared filename match.",
        ),
      },
      {
        id: "ignore",
        view: "discovered",
        anchor: a("demo-discovery"),
        anchorTargets: [discoveredAction("ignore")],
        interactive: true,
        manualAdvance: true,
        allow: [a("demo-library-stage")],
        title: t("Ignore a tool or launcher"),
        body: t(
          "Try Ignore. In Discovered, this stops tracking the executable. You can restore it later from Ignored. Your sharing preference separately controls anonymous ignore reports.",
        ),
      },
      {
        id: "skip",
        view: "discovered",
        anchor: a("demo-discovery"),
        anchorTargets: [discoveredAction("skip")],
        interactive: true,
        manualAdvance: true,
        allow: [a("demo-library-stage")],
        title: t("Leave an uncertain app for later"),
        body: t(
          "Try Skip for now. The app stays in Needs review; skipping does not create a match or ignore it.",
        ),
      },
      {
        id: "ambiguous",
        view: "now",
        anchor: a("demo-ambiguous"),
        interactive: true,
        manualAdvance: true,
        allow: [a("demo-library-stage")],
        title: t("One filename, several possible games"),
        body: t(
          "Choose a game from the sample picker. Now Playing asks this when a filename could belong to several games. Your choice is remembered on this PC; it does not become a global match for everyone else.",
        ),
      },
    ],
  };
}
