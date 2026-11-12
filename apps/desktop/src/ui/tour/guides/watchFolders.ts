import { FolderSearch } from "lucide-react";
import { getT } from "../../../i18n";
import type { TourDefinition } from "../tourTypes";
import { a } from "./shared";

const t = getT("tour");

export function watchFoldersGuide(): TourDefinition {
  return {
    id: "watch-folders",
    version: 1,
    release: "1.2.2",
    kind: "guide",
    category: "library",
    icon: FolderSearch,
    title: t("Watch folders for new games"),
    description: t(
      "Let PlayCounter add games from your game folders and new launcher installs.",
    ),
    duration: t("2 min"),
    steps: [
      {
        id: "intro",
        view: "settings",
        settingsGroup: "library",
        title: t("Games outside any launcher"),
        body: t(
          "Not every game comes from a launcher. DRM-free downloads, itch.io games, old disc installs, and portable games often sit together in one folder. PlayCounter can watch that folder and add the games it finds. This guide only points at the controls; nothing is changed.",
        ),
      },
      {
        id: "add",
        view: "settings",
        settingsGroup: "library",
        anchor: a("settings-watch-folders-add"),
        optional: true,
        title: t("Add a folder you keep games in"),
        body: t(
          "Add folder lets you pick a folder such as D:\\Games. Every folder inside it counts as one game, so D:\\Games\\Celeste and D:\\Games\\Hollow Knight are two games. Watched folders need Remember launch paths, because PlayCounter saves where each game's file is.",
        ),
      },
      {
        id: "results",
        view: "settings",
        settingsGroup: "library",
        anchor: a("settings-watch-folders"),
        optional: true,
        title: t("What happens to each game folder"),
        body: t(
          "PlayCounter looks at new game folders right after you add a folder, when it starts, and when you come back to its window. If the files in a game folder point to exactly one game, that game is added to My Games with its launch file, ready to play. Anything unclear waits in Discovered, marked with the folder it was found in, so you can match it yourself.",
        ),
      },
      {
        id: "privacy",
        view: "settings",
        settingsGroup: "library",
        anchor: a("settings-watch-folders"),
        optional: true,
        title: t("Only file names leave your PC"),
        body: t(
          "To recognize a game, PlayCounter sends the names of the game files it finds to its game database. Your folders and launch files stay on this PC and are left out of backups.",
        ),
      },
      {
        id: "dismissed",
        view: "settings",
        settingsGroup: "library",
        anchor: a("settings-watch-folders"),
        additionalAnchors: [a("settings-watch-folders-dismissed")],
        optional: true,
        title: t("Stop watching, or bring a folder back"),
        body: t(
          "Remove stops watching a folder; games already in My Games stay. If you ignore a file from a watched folder in Discovered, its game folder moves to Dismissed game folders. Restore takes it off that list, and PlayCounter looks at it again.",
        ),
      },
      {
        id: "auto-add",
        view: "settings",
        settingsGroup: "library",
        anchor: a("settings-auto-add"),
        optional: true,
        title: t("Launcher games join on their own"),
        body: t(
          "Add new games automatically does the same for launchers. After your first import from Steam, Battle.net, Epic Games, or GOG, games you install there show up in My Games by themselves. Games you removed from PlayCounter are not added again. Xbox games still need an Xbox import.",
        ),
      },
    ],
  };
}
