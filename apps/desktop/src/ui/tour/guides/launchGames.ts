import { Play } from "lucide-react";
import { getT } from "../../../i18n";
import type { TourDefinition } from "../tourTypes";
import { a, sampleCardAllow, sampleCardDialogs } from "./shared";

const t = getT("tour");

/** One row of a Settings page (`data-tour` set by SettingsKit.tsx). */
const row = (id: string) => a(`settings-row-${id}`);

export function launchGamesGuide(): TourDefinition {
  return {
    id: "launch-games",
    version: 5,
    release: "1.2.2",
    kind: "guide",
    category: "detection",
    icon: Play,
    title: t("Launch games directly"),
    description: t(
      "Try a sample launch and learn how Play, Stop and the controller work.",
    ),
    duration: t("2 min"),
    demoGame: true,
    steps: [
      {
        id: "intro",
        view: "settings",
        settingsGroup: "launching",
        anchor: row("rememberLaunchPaths"),
        title: t("PlayCounter can start games too"),
        body: t(
          "Play needs <b>Remember launch paths</b>: the game files PlayCounter has seen, kept on this PC. The card in this guide is a sample: nothing is saved.",
        ),
      },
      {
        id: "enable",
        view: "settings",
        settingsGroup: "launching",
        anchor: row("gameLaunching"),
        interactive: true,
        manualAdvance: true,
        persistentInteraction: true,
        allow: [row("gameLaunching")],
        title: t("Choose whether to switch it on"),
        body: t(
          "<b>Launch games directly</b> gives cards a <b>Play</b> button. It saves at once. Leave it as it is if you don't want it: the next steps use a sample.",
        ),
      },
      {
        id: "play",
        view: "games",
        anchor: a("demo-game-card"),
        anchorTargets: [...sampleCardDialogs, a("demo-launch-play")],
        interactive: true,
        manualAdvance: true,
        allow: sampleCardAllow,
        advanceOn: { type: "event", name: "mygames.demo-launch-attempted" },
        title: t("Press Play on the sample"),
        body: t(
          "A card gets <b>Play</b> once PlayCounter knows the game's file. The sample has a made-up one: no program is started.",
        ),
        task: t("Click <b>Play</b> on the sample card."),
      },
      {
        id: "launch-file",
        view: "games",
        anchor: a("demo-game-card"),
        anchorTargets: [
          ...sampleCardDialogs,
          a("demo-menu-launch-file"),
          a("demo-launch-menu"),
          a("demo-menu-launch-options"),
        ],
        interactive: true,
        manualAdvance: true,
        allow: sampleCardAllow,
        advanceOn: { type: "event", name: "demo.action-completed" },
        title: t("Change or forget a launch file"),
        body: t(
          "The card's menu has <b>Launch options</b> with <b>Change launch file…</b> (<b>Set launch file…</b> if none), <b>Open in Explorer</b> and <b>Forget launch file</b>. Paths stay on this PC.",
        ),
        task: t(
          "Right-click the sample card, open <b>Launch options</b>, click <b>Change launch file…</b> and use the sample file.",
        ),
      },
      {
        id: "starts",
        view: "settings",
        settingsGroup: "launching",
        anchor: row("gameLaunching"),
        title: t("How Play starts your games"),
        body: t(
          "Xbox games start via Xbox, unless you set a launch file. Steam and Epic Games start through their launcher until PlayCounter has seen them run, then directly. GOG starts its own file. Battle.net only opens the launcher.",
        ),
      },
      {
        id: "running",
        view: "settings",
        settingsGroup: "launching",
        anchor: row("hideToTray"),
        title: t("Stop a game, and hide to tray"),
        body: t(
          "A running game's card shows <b>Stop</b>; it asks, then closes the game. <b>Hide to tray when a game starts</b> is on by default: PlayCounter moves to the tray once the game runs.",
        ),
      },
      {
        id: "uninstalled",
        view: "settings",
        settingsGroup: "launching",
        anchor: a("settings-install-in-steam"),
        title: t("When a game is uninstalled"),
        body: t(
          "PlayCounter checks at start-up and when you return to its window whether imported launcher games are still installed. Uninstalled ones lose Play. <b>Show Install in Steam</b> adds an install button for Steam games.",
        ),
      },
      {
        id: "controller",
        view: "settings",
        settingsGroup: "launching",
        anchor: row("controllerNavigation"),
        interactive: true,
        manualAdvance: true,
        persistentInteraction: true,
        allow: [row("controllerNavigation")],
        title: t("Optional controller navigation"),
        body: t(
          "<b>Controller navigation</b> lets a pad move around PlayCounter. Hold View + RB for two seconds to bring PlayCounter to the front. PlayStation pads: Create + R1.",
        ),
      },
      {
        id: "keyboard",
        view: "games",
        anchor: a("demo-game-card"),
        title: t("Keyboard and fullscreen"),
        body: t(
          "In the app, arrow keys move between cards and Enter presses Play, while <b>Launch games directly</b> is on. F11 or the title bar's fullscreen button switches fullscreen.",
        ),
      },
    ],
  };
}
