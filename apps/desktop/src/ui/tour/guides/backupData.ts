import { Archive } from "lucide-react";
import { getT } from "../../../i18n";
import type { TourDefinition } from "../tourTypes";
import { a } from "./shared";

const t = getT("tour");

export function backupDataGuide(): TourDefinition {
  return {
    id: "backup-data",
    version: 3,
    release: "1.1.17",
    kind: "guide",
    category: "settings",
    icon: Archive,
    title: t("Back up or move your data"),
    description: t(
      "Automatic backups, export, and restoring your data on another PC.",
    ),
    duration: t("2 min"),
    steps: [
      {
        id: "intro",
        view: "settings",
        settingsGroup: "backup",
        title: t("Your data stays portable"),
        body: t(
          "Open Settings and find Backup & transfer whenever you want to protect your local data or move PlayCounter to another PC. This guide explains both actions without opening a file dialog or changing your data.",
        ),
      },
      {
        id: "overview",
        view: "settings",
        settingsGroup: "backup",
        anchor: a("settings-backup"),
        title: t("Backup & transfer"),
        body: t(
          "A backup is a single JSON file. It contains your play history, your games, your notes, playthroughs, shelves, and app settings. Saved launch paths are not included; they stay on this PC.",
        ),
      },
      {
        id: "automatic",
        view: "settings",
        settingsGroup: "backup",
        anchor: a("settings-backup-enabled"),
        title: t("Automatic backups"),
        body: t(
          "By default, PlayCounter saves a backup once a week and keeps the last five. If a backup was missed because PlayCounter was not running, it is saved the next time you open the app. This guide only points at the controls; it does not change your settings or create a backup.",
        ),
      },
      {
        id: "schedule",
        view: "settings",
        settingsGroup: "backup",
        anchor: a("settings-backup-interval"),
        additionalAnchors: [
          a("settings-backup-keep"),
          a("settings-backup-now"),
        ],
        title: t("Choose how often, and how many to keep"),
        body: t(
          "Schedule switches between daily and weekly backups. Keep sets how many backups stay on disk; once the limit is reached, the oldest automatic backup is deleted. Back up now saves a backup right away.",
        ),
      },
      {
        id: "folder",
        view: "settings",
        settingsGroup: "backup",
        anchor: a("settings-backup-choose-folder"),
        additionalAnchors: [a("settings-backup-open-folder")],
        title: t("Know where your backups are"),
        body: t(
          "Automatic backups go to PlayCounter's app data folder unless you pick another one with Choose folder. Open folder shows the files. For extra safety, pick a folder that is synced to the cloud or included in your own backups.",
        ),
      },
      {
        id: "export",
        view: "settings",
        settingsGroup: "backup",
        anchor: a("settings-backup-export"),
        title: t("Export your data"),
        body: t(
          "Choose Export to save the current local data as a JSON file. Keep that file somewhere safe or copy it to the PC where you want to continue using PlayCounter.",
        ),
      },
      {
        id: "import",
        view: "settings",
        settingsGroup: "backup",
        anchor: a("settings-backup-import"),
        title: t("Import a backup"),
        body: t(
          "Choose Import and select a PlayCounter backup file. Import replaces the current local data; PlayCounter automatically creates a safety backup of the current state first. The button stays locked during this guide to avoid an accidental import.",
        ),
      },
    ],
  };
}
