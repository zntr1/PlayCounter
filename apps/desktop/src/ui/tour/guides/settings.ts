import { Settings } from "lucide-react";
import { emulatorLabelList } from "../../../emulators/registry";
import { getT } from "../../../i18n";
import type { TourDefinition } from "../tourTypes";
import { a } from "./shared";

const t = getT("tour");

export function settingsGuide(): TourDefinition {
  return {
    id: "settings",
    version: 4,
    kind: "guide",
    category: "settings",
    icon: Settings,
    title: t("Personalize PlayCounter"),
    description: t("Walk through key settings and adjust them as you go."),
    duration: t("3 min"),
    steps: [
      {
        id: "intro",
        view: "settings",
        settingsGroup: "general",
        title: t("Settings, your way"),
        body: t(
          "This guide walks through the most useful preferences. Controls inside each highlighted panel stay active, and any changes you make are real and saved immediately.",
        ),
      },
      {
        id: "general",
        view: "settings",
        settingsGroup: "general",
        anchor: a("settings-general"),
        interactive: true,
        manualAdvance: true,
        persistentInteraction: true,
        allow: [a("settings-general")],
        title: t("General behavior"),
        body: t(
          "Turn on Launch on startup if you want tracking ready when you sign in. PlayCounter records sessions while it is running.\n\nBelow that you can switch long playtimes to days and hours.",
        ),
      },
      {
        id: "appearance",
        view: "settings",
        settingsGroup: "appearance",
        anchor: a("settings-appearance"),
        interactive: true,
        manualAdvance: true,
        persistentInteraction: true,
        allow: [a("settings-appearance")],
        title: t("Theme, color, and size"),
        body: t(
          "Switch between the dark and light theme, and pick the accent color used for buttons, highlights, and focus states. Reset returns to the PlayCounter default.\n\nContent size and Menu size make text, covers, and the sidebar larger or smaller.",
        ),
      },
      {
        id: "shortcuts",
        view: "settings",
        settingsGroup: "shortcuts",
        anchor: a("settings-shortcuts"),
        interactive: true,
        manualAdvance: true,
        persistentInteraction: true,
        allow: [a("settings-shortcuts")],
        title: t("Keyboard shortcuts"),
        body: t(
          "Set a hotkey that brings PlayCounter to the front from any app, one that shows your current session time in a small popup without leaving your game, and one that opens a note box for the session you're playing. All three work while PlayCounter runs in the tray.",
        ),
      },
      {
        id: "notifications",
        view: "settings",
        settingsGroup: "popups",
        anchor: a("settings-notifications"),
        optional: true,
        interactive: true,
        manualAdvance: true,
        persistentInteraction: true,
        allow: [a("settings-notifications")],
        title: t("Desktop popups"),
        body: t(
          "Short popups on your desktop while you play. Turn the main switch on first, then pick which events are worth a popup: first-time detections, every game start, session summaries, milestones, or new discoveries.",
        ),
      },
      {
        id: "launcher",
        view: "settings",
        settingsGroup: "launching",
        anchor: a("settings-launcher"),
        optional: true,
        interactive: true,
        manualAdvance: true,
        persistentInteraction: true,
        allow: [a("settings-launcher")],
        title: t("Game launching"),
        body: t(
          "Remember launch paths lets PlayCounter keep the location of the games it recognizes on this PC. With it on, Launch games directly adds Play buttons to My Games, Hide to tray when a game starts tucks PlayCounter away once a game you started is running, and Controller navigation lets you move through PlayCounter with a gamepad. Show Install in Steam puts an install button on imported Steam games that are no longer installed.\n\nSaved paths stay on this PC and are left out of backups.",
        ),
      },
      {
        id: "emulators",
        view: "settings",
        settingsGroup: "emulators",
        anchor: a("settings-emulators"),
        interactive: true,
        manualAdvance: true,
        persistentInteraction: true,
        allow: [a("settings-emulators")],
        title: t("Emulator games"),
        body: t(
          "Detect emulator games finds the game running inside {{emulatorLabelList}}, so it gets its own cover and playtime instead of counting as the emulator. Look up recognized content sends only the recognized file name or disc ID to find the game.\n\nThe Track emulator games guide shows this in action.",
          { emulatorLabelList: emulatorLabelList("or") },
        ),
      },
      {
        id: "sharing",
        view: "settings",
        settingsGroup: "discovery",
        anchor: a("settings-sharing"),
        interactive: true,
        manualAdvance: true,
        persistentInteraction: true,
        allow: [a("settings-sharing")],
        title: t("Help improve detection"),
        body: t(
          "When enabled, ignoring an unknown app sends its filename, platform, and anonymous install ID to help improve detection. This setting controls ignore reports; those reports do not include your playtime, history, or notes.",
        ),
      },
      {
        id: "library-import",
        view: "settings",
        settingsGroup: "library",
        anchor: a("settings-library-import"),
        title: t("Keep your library up to date"),
        body: t(
          "Add new games automatically brings in games you install in Steam, Battle.net, Epic Games, or GOG after your first import from there. Watched folders find games that no launcher knows about. Below them, you can forget everything a launcher import added.\n\nThe Watch folders for new games guide explains both.",
        ),
      },
      {
        id: "backup",
        view: "settings",
        settingsGroup: "backup",
        anchor: a("settings-backup"),
        title: t("Backups"),
        body: t(
          "PlayCounter backs up your history, games, and notes automatically: once a week by default, keeping the last five. After the guide, you can change the schedule and folder here, back up right away, or export your data for another PC.\n\nThe Back up or move your data guide walks through each option.",
        ),
      },
      {
        id: "updates",
        view: "settings",
        settingsGroup: "about",
        anchor: a("settings-updates"),
        title: t("Keep PlayCounter current"),
        body: t(
          "After the guide, use Check for updates whenever you like. This panel shows which version you are running, whether a new one is available, and the release notes.",
        ),
      },
    ],
  };
}
