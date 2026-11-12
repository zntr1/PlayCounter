import { FolderSearch } from "lucide-react";
import { getT } from "../../../i18n";
import type { TourDefinition } from "../tourTypes";
import { a } from "./shared";

const t = getT("tour");

// While this guide runs, Settings shows a sample folder and a sample
// dismissed game folder (WatchFoldersSettings.tsx), so every control a step
// names is on screen. Watched folders exist on Windows only: every step but
// the first is skipped elsewhere.
export function watchFoldersGuide(): TourDefinition {
  return {
    id: "watch-folders",
    version: 2,
    release: "1.2.2",
    kind: "guide",
    category: "library",
    icon: FolderSearch,
    title: t("Watch folders for new games"),
    description: t(
      "Let PlayCounter add games from your game folders and new launcher installs.",
    ),
    duration: t("2 min"),
    nextTourId: "add-game",
    steps: [
      {
        id: "intro",
        view: "settings",
        settingsGroup: "library",
        anchor: a("settings-page-head"),
        title: t("Games outside any launcher"),
        body: t(
          "DRM-free downloads, itch.io games and old disc installs often sit together in one folder. PlayCounter can watch it. The folders in this guide are samples: nothing is added or changed.",
        ),
      },
      {
        id: "folder",
        view: "settings",
        settingsGroup: "library",
        anchor: a("settings-watch-folders-folder"),
        optional: true,
        title: t("One folder, many games"),
        body: t(
          "You watch the folder your games sit in, like the sample D:\\Games. Every folder inside it counts as one game: D:\\Games\\Celeste and D:\\Games\\Hollow Knight are two.",
        ),
      },
      {
        id: "when",
        view: "settings",
        settingsGroup: "library",
        anchor: a("settings-watch-folders-folder"),
        optional: true,
        title: t("When PlayCounter looks"),
        body: t(
          "PlayCounter looks for new game folders right after you add a folder, every time it starts, and when you come back to its window. There is no button to press.",
        ),
      },
      {
        id: "results",
        view: "settings",
        settingsGroup: "library",
        anchor: a("settings-watch-folders-folder"),
        additionalAnchors: [a("nav-games"), a("nav-discovered")],
        optional: true,
        title: t("Where the games show up"),
        body: t(
          "A game folder whose files point to exactly one game lands in <b>My Games</b> with its launch file, ready to play. Anything unclear waits in <b>Discovered</b>, marked with its folder.",
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
          "To recognize a game, PlayCounter sends the names of its game files to the game database, nothing else. Your folders and launch files stay on this PC and are left out of backups.",
        ),
      },
      {
        id: "remove",
        view: "settings",
        settingsGroup: "library",
        anchor: a("settings-watch-folders-remove"),
        optional: true,
        title: t("Stop watching a folder"),
        body: t(
          "<b>Remove</b> stops watching a folder. The games it already brought into My Games stay there, with their playtime.",
        ),
      },
      {
        id: "dismissed",
        view: "settings",
        settingsGroup: "library",
        anchor: a("settings-watch-folders-dismissed"),
        optional: true,
        title: t("Bring a game folder back"),
        body: t(
          "Ignore a file from a watched folder in Discovered, and its game folder moves to <b>Dismissed game folders</b>. <b>Restore</b> takes it off the list, and PlayCounter looks at it again.",
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
          "<b>Add new games automatically</b> does the same for launchers: after a first import, new Steam, Battle.net, Epic Games and GOG installs join by themselves, and so do new PlayStation games. Xbox needs another import.",
        ),
      },
      {
        id: "finish",
        view: "settings",
        settingsGroup: "library",
        anchor: a("settings-watch-folders-add"),
        optional: true,
        title: t("Watch your own folder"),
        body: t(
          "After the guide, click <b>Add folder</b> and pick the folder your games without a launcher sit in. PlayCounter looks into it right away.",
        ),
      },
    ],
  };
}
