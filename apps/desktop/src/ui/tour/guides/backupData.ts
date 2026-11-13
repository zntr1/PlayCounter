import { Archive } from "lucide-react";
import { getT } from "../../../i18n";
import type { TourDefinition } from "../tourTypes";
import { a } from "./shared";

const t = getT("tour");

// Every step only points: Import replaces data and Reset deletes it.
export function backupDataGuide(): TourDefinition {
  return {
    id: "backup-data",
    version: 4,
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
        title: t("What a backup holds"),
        body: t(
          "A backup is one JSON file with your play history, games, notes, playthroughs, shelves and settings. This guide only points at <b>Backup & transfer</b>: nothing is saved, imported or reset.",
        ),
      },
      {
        id: "automatic",
        view: "settings",
        settingsGroup: "backup",
        anchor: a("settings-backup-automatic"),
        title: t("Backups happen by themselves"),
        body: t(
          "Unless you change it, <b>Automatic backups</b> save one backup a week and keep the last five. A backup missed while PlayCounter was closed is caught up the next time it opens.",
        ),
      },
      {
        id: "schedule",
        view: "settings",
        settingsGroup: "backup",
        anchor: a("settings-backup-interval"),
        additionalAnchors: [a("settings-backup-keep")],
        title: t("How often, and how many"),
        body: t(
          "<b>Schedule</b> switches between daily and weekly. <b>Keep</b> sets how many automatic backups stay in the folder: when a new one is saved, the oldest one goes.",
        ),
      },
      {
        id: "folder",
        view: "settings",
        settingsGroup: "backup",
        anchor: a("settings-backup-folder"),
        title: t("Where your backups are"),
        body: t(
          "Backups go to PlayCounter's own folder until <b>Choose folder</b> picks another one. A folder that syncs to the cloud keeps them safe if this PC breaks. <b>Open folder</b> shows the files.",
        ),
      },
      {
        id: "stays",
        view: "settings",
        settingsGroup: "backup",
        anchor: a("settings-section-transfer"),
        title: t("What stays on this PC"),
        body: t(
          "Before you use <b>Move to another PC</b>: saved launch paths, ignored apps, watched folders and launcher sign-ins are not in a backup. They stay on this PC.",
        ),
      },
      {
        id: "export",
        view: "settings",
        settingsGroup: "backup",
        anchor: a("settings-backup-export"),
        title: t("Take your data with you"),
        body: t(
          "<b>Export</b> saves the same file wherever you like, for example on a USB stick or in a cloud folder. Copy it to the other PC.",
        ),
      },
      {
        id: "import",
        view: "settings",
        settingsGroup: "backup",
        anchor: a("settings-backup-import"),
        title: t("Bring a backup back"),
        body: t(
          "<b>Import</b> replaces everything on this PC with the file you pick. PlayCounter first saves a safety backup of what is there now.",
        ),
      },
      {
        id: "reset",
        view: "settings",
        settingsGroup: "backup",
        anchor: a("settings-section-reset"),
        title: t("Reset, if you ever need it"),
        body: t(
          "<b>Restore default settings</b> resets your preferences and keeps games and history. <b>Start over</b> clears the library, the history and the settings. Your backup files stay either way.",
        ),
      },
      {
        id: "finish",
        view: "settings",
        settingsGroup: "backup",
        anchor: a("settings-backup-now"),
        title: t("Make your first backup"),
        body: t(
          "After the guide, click <b>Back up now</b> once. Then you know where the file lands, and a fresh backup already exists.",
        ),
      },
    ],
  };
}
