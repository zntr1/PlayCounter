import { Gamepad2 } from "lucide-react";
import { emulatorLabelList } from "../../../emulators/registry";
import { getT } from "../../../i18n";
import type { TourDefinition } from "../tourTypes";
import { a } from "./shared";

const t = getT("tour");

export function emulatorsGuide(): TourDefinition {
  return {
    id: "emulators",
    version: 4,
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
    steps: [
      {
        id: "intro",
        view: "settings",
        settingsGroup: "emulators",
        title: t("Games inside emulators"),
        body: t(
          "PlayCounter can recognize games inside {{emulatorLabelList}}. This guide uses a sample Dolphin setup. You can confirm and change its match; nothing is saved or shared.",
          { emulatorLabelList: emulatorLabelList("and") },
        ),
      },
      {
        id: "settings",
        view: "settings",
        settingsGroup: "emulators",
        anchor: a("settings-emulators"),
        title: t("Enable emulator detection"),
        body: t(
          "This is where you enable emulator detection. PlayCounter uses local launch details to identify the loaded game. Lookups send the recognized title or disc ID, never a full local path or window title. This step only shows the setting.",
        ),
      },
      {
        id: "menu",
        view: "keep",
        anchor: a("nav-emulators"),
        title: t("Live view and saved emulator pages"),
        body: t(
          "An emulator page is added the first time PlayCounter sees that emulator running, and stays afterward. Now Emulating works differently: it appears while an emulator is running. Both sit under Library and are hidden if detection is off or all known emulators are ignored. This guide supplies Dolphin as an example.",
        ),
      },
      {
        id: "now-emulating",
        view: "emulating",
        anchor: a("demo-emulator-now"),
        additionalAnchors: [a("nav-emulating")],
        title: t("See the loaded game"),
        body: t(
          "Now Emulating shows the loaded game, its running timer, and the emulator. If the game cannot be identified, a picker asks you to choose it. This session is a sample.",
        ),
      },
      {
        id: "emulator-page",
        view: "dolphin",
        anchor: a("nav-dolphin"),
        title: t("The Dolphin page stays"),
        body: t(
          "This page holds Dolphin playtime, sessions, and all of its game matches. You can open it even when Dolphin is not running.",
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
        anchor: a("demo-emulator-linked"),
        anchorTargets: [
          a("demo-emulator-confirmation"),
          a("demo-sample-search"),
          a("demo-emulator-result"),
          a("demo-emulator-confirm"),
        ],
        interactive: true,
        manualAdvance: true,
        allow: [
          a("demo-emulator-linked"),
          a("demo-emulator-result"),
          a("demo-library-modal"),
        ],
        additionalAnchors: [a("demo-emulator-check-badge")],
        title: t("Check this once"),
        body: t(
          "Check that the title is the game you just started. Click Looks right on the sample. The check badge disappears and its sessions stay intact.",
        ),
      },
      {
        id: "fix-match",
        view: "dolphin",
        anchor: a("demo-emulator-linked"),
        anchorTargets: [
          a("demo-emulator-confirmation"),
          a("demo-sample-search"),
          a("demo-emulator-result"),
          a("demo-emulator-actions"),
        ],
        interactive: true,
        manualAdvance: true,
        allow: [
          a("demo-emulator-linked"),
          a("demo-emulator-result"),
          a("demo-library-modal"),
        ],
        title: t("Correct, forget, or preview sharing"),
        body: t(
          "Try Change to review a different game. Forget removes the match and keeps recorded History. Share match previews what would go to Community review; it sends nothing here. Cancel leaves the sample as it is.",
        ),
      },
      {
        id: "pcsx2",
        view: "settings",
        settingsGroup: "emulators",
        anchor: a("settings-emulators"),
        title: t("PlayStation 2 with PCSX2"),
        body: t(
          "With emulator detection enabled on Windows, start a game in PCSX2. PlayCounter records the loaded PS2 game. Its page appears after the emulator is first seen. A learned game file can also support direct launching.",
        ),
      },
      {
        id: "library",
        view: "games",
        anchor: a("demo-game-card"),
        title: t("One shared library"),
        body: t(
          "Completed emulator sessions appear in My Games and History with native PC games. This sample card carries a Dolphin badge. Provider origins, emulator badges, and file-match sources describe different things.",
        ),
      },
    ],
  };
}
