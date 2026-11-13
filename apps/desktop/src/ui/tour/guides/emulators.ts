import { Gamepad2 } from "lucide-react";
import { adapterFor, EMULATORS } from "../../../emulators/registry";
import { appLocale, getT } from "../../../i18n";
import type { TourDefinition } from "../tourTypes";
import { a } from "./shared";

const t = getT("tour");

/** Two emulators as an example, in the app's language: "Dolphin and PCSX2". */
function exampleEmulators() {
  const labels = (["dolphin", "pcsx2"] as const).map(
    (id) => adapterFor(id).label,
  );
  return new Intl.ListFormat(appLocale(), { type: "conjunction" }).format(
    labels,
  );
}

export function emulatorsGuide(): TourDefinition {
  return {
    id: "emulators",
    version: 5,
    release: "1.1.17",
    kind: "guide",
    category: "detection",
    icon: Gamepad2,
    title: t("Track emulator games"),
    description: t(
      "Learn how PlayCounter detects games running inside emulators.",
    ),
    duration: t("2 min"),
    demoGame: true,
    finishView: "games",
    nextTourId: "source-badges",
    steps: [
      {
        id: "intro",
        view: "settings",
        settingsGroup: "emulators",
        title: t("Games inside emulators"),
        body: t(
          "PlayCounter recognizes games inside {{count}} emulators, such as {{examples}}.",
          { count: EMULATORS.length, examples: exampleEmulators() },
        ),
      },
      {
        id: "settings",
        view: "settings",
        settingsGroup: "emulators",
        anchor: a("settings-emulators"),
        anchorTargets: ['[data-row="emulatorDetection"]'],
        title: t("Detection is on by default"),
        body: t(
          "<b>Detect emulator games</b> is on by default. Turn it off here if you never play in emulators. Lookups send the recognized title or disc ID, never a full local path or window title.",
        ),
      },
      {
        id: "menu",
        view: "keep",
        anchor: a("nav-dolphin"),
        additionalAnchors: [a("nav-emulator-group")],
        title: t("Emulator pages in the sidebar"),
        body: t(
          "An emulator page is added the first time PlayCounter sees it running. With two or more emulators, the sidebar folds them under one Emulators row.",
        ),
      },
      {
        id: "now-emulating",
        view: "emulating",
        anchor: a("demo-emulator-now"),
        additionalAnchors: [a("nav-emulating")],
        title: t("See the loaded game"),
        body: t(
          "<b>Now Emulating</b> shows the loaded game, its running timer and the emulator while one runs. If the game is unclear, a picker asks you to choose.",
        ),
      },
      {
        id: "emulator-page",
        view: "dolphin",
        anchor: a("nav-dolphin"),
        title: t("The emulator page stays"),
        body: t(
          "This page holds Dolphin's playtime, sessions and linked games, even when Dolphin is closed. Every supported emulator works the same way.",
        ),
      },
      {
        id: "linked-games",
        view: "dolphin",
        anchor: a("demo-emulator-linked"),
        title: t("Your linked games"),
        body: t(
          "Each card connects a game to a local file or disc ID. Once linked, PlayCounter recognizes that content again without asking every time.",
        ),
      },
      {
        id: "confirm",
        view: "dolphin",
        anchor: a("demo-emulator-confirm"),
        additionalAnchors: [a("demo-emulator-check-badge")],
        interactive: true,
        allow: [a("demo-emulator-confirm")],
        advanceOn: { type: "event", name: "demo.step-completed" },
        title: t("Check this once"),
        body: t(
          "A guessed match carries a check note. Make sure the title is the game you just started; its sessions stay intact.",
        ),
        task: t("Click <b>Looks right</b>."),
      },
      {
        id: "fix-match",
        view: "dolphin",
        anchor: a("demo-emulator-actions"),
        anchorTargets: [
          a("demo-emulator-confirmation"),
          a("demo-sample-search"),
          a("demo-emulator-result"),
          a("demo-emulator-actions"),
        ],
        interactive: true,
        allow: [
          a("demo-emulator-linked"),
          a("demo-emulator-result"),
          a("demo-library-modal"),
        ],
        advanceOn: { type: "event", name: "demo.step-completed" },
        title: t("Correct, forget, or preview sharing"),
        body: t(
          "<b>Change</b> picks another game. <b>Forget</b> removes the match and keeps History. <b>Share match</b> previews what Community review would get.",
        ),
        task: t("Press one of the three and finish its dialog."),
      },
      {
        id: "library",
        view: "games",
        anchor: a("demo-game-card"),
        title: t("One shared library"),
        body: t(
          "In the app, emulator sessions appear in My Games and History next to your PC games. The guide <b>Understand game badges</b> explains the badge on this card.",
        ),
      },
    ],
  };
}
