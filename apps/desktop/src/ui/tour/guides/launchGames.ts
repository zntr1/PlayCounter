import { Play } from "lucide-react";
import { getT } from "../../../i18n";
import type { TourDefinition } from "../tourTypes";
import { a, sampleCardAllow, sampleCardDialogs } from "./shared";

const t = getT("tour");

export function launchGamesGuide(): TourDefinition {
  return {
    id: "launch-games",
    version: 4,
    release: "1.2.2",
    kind: "guide",
    category: "detection",
    icon: Play,
    title: t("Launch games directly"),
    description: t(
      "Try a sample launch and learn the optional controller controls.",
    ),
    duration: t("2 min"),
    demoGame: true,
    steps: [
      {
        id: "intro",
        view: "settings",
        settingsGroup: "launching",
        anchor: a("settings-launcher"),
        title: t("PlayCounter can start games too"),
        body: t(
          "Direct launching is optional. When enabled, My Games shows Play for games with a usable local launch file or a supported launcher shortcut. Recognition by name alone does not mean a game is installed.",
        ),
      },
      {
        id: "enable",
        view: "settings",
        settingsGroup: "launching",
        anchor: a("settings-launch-direct"),
        interactive: true,
        manualAdvance: true,
        persistentInteraction: true,
        allow: [a("settings-launch-direct")],
        title: t("Choose whether to enable it"),
        body: t(
          "This checkbox controls direct launching and saves immediately. It requires Remember launch paths. If disabled, you can enable that prerequisite after the guide. You can leave your settings as they are and continue.",
        ),
      },
      {
        id: "learned",
        view: "games",
        anchor: a("demo-game-card"),
        anchorTargets: [...sampleCardDialogs, a("demo-launch-play")],
        interactive: true,
        manualAdvance: true,
        allow: sampleCardAllow,
        title: t("PlayCounter learns launch files locally"),
        body: t(
          "Start a game the usual way. If PlayCounter can learn a usable launch path, its card gets a Play button. Try Play on this sample; no program is started.",
        ),
      },
      {
        id: "set-forget",
        view: "games",
        anchor: a("demo-game-card"),
        anchorTargets: [
          ...sampleCardDialogs,
          a("demo-menu-launch-file"),
          a("demo-menu-launch-options"),
        ],
        interactive: true,
        manualAdvance: true,
        allow: sampleCardAllow,
        backTo: "learned",
        title: t("Change or forget a launch file"),
        body: t(
          "Open Launch options and try Set or change launch file. The sample lets you choose or forget a bundled example path. For real games, select the game executable. A missing or forgotten launch path removes direct Play until a usable path is available again.",
        ),
      },
      {
        id: "limits",
        view: "settings",
        settingsGroup: "launching",
        anchor: a("settings-launcher"),
        title: t("How Play starts your games"),
        body: t(
          "Imported Xbox games always start through Xbox. Imported Steam and Epic Games games start through their launcher until PlayCounter has seen them running; after that, Play starts the game's .exe directly, like any other game. Games that need extra startup steps or administrator rights may still need their normal shortcut.",
        ),
      },
      {
        id: "uninstalled",
        view: "settings",
        settingsGroup: "launching",
        anchor: a("settings-install-in-steam"),
        title: t("When a game is uninstalled"),
        body: t(
          "While Launch games directly is on, PlayCounter checks whether your imported launcher games are still installed when it starts and when you come back to its window. An uninstalled game loses its Play button and gets it back once you install it again. Turn on Show Install in Steam to get an Install in Steam button on uninstalled Steam games instead.",
        ),
      },
      {
        id: "privacy",
        view: "settings",
        settingsGroup: "launching",
        anchor: a("settings-launcher"),
        title: t("Paths stay on this PC"),
        body: t(
          "Saved launch paths never leave your device and aren't included in backups. Turn Remember launch paths off to clear them and stop learning new ones without touching your games or history.",
        ),
      },
      {
        id: "controller",
        view: "settings",
        settingsGroup: "launching",
        anchor: a("settings-controller-navigation"),
        interactive: true,
        manualAdvance: true,
        persistentInteraction: true,
        allow: [a("settings-controller-navigation")],
        title: t("Optional controller navigation"),
        body: t(
          "This checkbox enables controller navigation and saves immediately. It requires direct launching. With a controller connected, you can move around PlayCounter. To bring PlayCounter to the front, hold Select/View + R1/RB a few seconds and then release.",
        ),
      },
    ],
  };
}
