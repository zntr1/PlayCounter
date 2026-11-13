import { Settings } from "lucide-react";
import { getT } from "../../../i18n";
import type { TourDefinition } from "../tourTypes";
import { a } from "./shared";

const t = getT("tour");

/** One row of a Settings page, by its `data-row` id (SettingsKit.tsx). */
const row = (id: string) => a(`settings-row-${id}`);

// The controls in a ring are the player's real settings. Pages that have a
// guide of their own (library import, emulators, backup) are left to it; the
// last step says where those guides are.
export function settingsGuide(): TourDefinition {
  return {
    id: "settings",
    version: 5,
    kind: "guide",
    category: "settings",
    icon: Settings,
    title: t("Personalize PlayCounter"),
    description: t("Walk through key settings and adjust them as you go."),
    duration: t("3 min"),
    nextTourId: "backup-data",
    steps: [
      {
        id: "intro",
        view: "settings",
        anchor: a("settings-search"),
        settingsGroup: "general",
        title: t("Real settings, saved at once"),
        body: t(
          "This guide walks through your real settings: what you change here is saved at once. <b>Search settings</b> finds a setting on any page by a word, like popup or backup.",
        ),
      },
      {
        id: "general",
        view: "settings",
        settingsGroup: "general",
        anchor: row("launchOnStartup"),
        interactive: true,
        manualAdvance: true,
        persistentInteraction: true,
        allow: [row("launchOnStartup"), row("startView"), row("language")],
        title: t("Start with your computer"),
        body: t(
          "PlayCounter only counts while it runs, so leave <b>Launch on startup</b> on. Right below, <b>Start page</b> and <b>Language</b> set what opens first and which language you read.",
        ),
      },
      {
        id: "appearance",
        view: "settings",
        settingsGroup: "appearance",
        anchor: row("theme"),
        interactive: true,
        manualAdvance: true,
        persistentInteraction: true,
        allow: [
          row("theme"),
          row("accentColor"),
          row("contentScale"),
          row("menuScale"),
        ],
        title: t("Theme, color and size"),
        body: t(
          "<b>Theme</b> switches between dark and light, <b>Accent color</b> tints buttons and highlights. <b>Content size</b> and <b>Menu size</b> make text, covers and the sidebar larger or smaller.",
        ),
      },
      {
        id: "shortcuts",
        view: "settings",
        settingsGroup: "shortcuts",
        anchor: row("showWindowHotkey"),
        interactive: true,
        manualAdvance: true,
        persistentInteraction: true,
        allow: [a("settings-shortcuts")],
        title: t("Shortcuts with your own keys"),
        body: t(
          "No shortcut has a key until you give it one. Click a field, like the one next to <b>Bring PlayCounter to front</b>, and press the keys you want. They work from any app.",
        ),
      },
      {
        id: "play",
        view: "settings",
        settingsGroup: "play",
        anchor: row("liveTimerEnabled"),
        optional: true,
        interactive: true,
        manualAdvance: true,
        persistentInteraction: true,
        allow: [
          row("liveTimerEnabled"),
          row("liveTimerCorner"),
          row("playtimeReminder"),
        ],
        title: t("A clock over your game"),
        body: t(
          "<b>Live timer</b> puts a small clock into your game's window, and <b>Playtime reminder</b> says when a break is due. Both stay off until you turn them on. The guide “{{guide}}” shows them.",
          { guide: t("While you play") },
        ),
      },
      {
        id: "launcher",
        view: "settings",
        settingsGroup: "launching",
        anchor: row("rememberLaunchPaths"),
        optional: true,
        interactive: true,
        manualAdvance: true,
        persistentInteraction: true,
        allow: [row("rememberLaunchPaths"), row("gameLaunching")],
        title: t("Start games from PlayCounter"),
        body: t(
          "<b>Remember launch paths</b> lets PlayCounter keep where your games are on this PC. With it on, <b>Launch games directly</b> adds Play buttons to My Games. The guide “{{guide}}” shows the rest.",
          { guide: t("Launch games directly") },
        ),
      },
      {
        id: "library",
        view: "settings",
        settingsGroup: "library",
        anchor: a("settings-auto-add"),
        optional: true,
        interactive: true,
        manualAdvance: true,
        persistentInteraction: true,
        allow: [a("settings-auto-add")],
        title: t("New games join by themselves"),
        body: t(
          "After a first import, new installs from Steam, Battle.net, Epic Games and GOG join your library on their own, and so do new PlayStation games you play. Xbox needs another import. Sign-ins are in <b>Launcher accounts</b>.",
        ),
      },
      {
        id: "sharing",
        view: "settings",
        settingsGroup: "discovery",
        anchor: row("trackTools"),
        interactive: true,
        manualAdvance: true,
        persistentInteraction: true,
        allow: [row("trackTools"), a("settings-sharing")],
        title: t("Software and what you share"),
        body: t(
          "<b>Track software</b> counts apps like Discord on their own page, apart from your games. <b>Share apps you ignore</b> sends an ignored app's file name, your platform and an anonymous ID, never your playtime.",
        ),
      },
      {
        id: "updates",
        view: "settings",
        settingsGroup: "about",
        anchor: a("settings-updates"),
        additionalAnchors: [a("settings-help")],
        title: t("Updates and more guides"),
        body: t(
          "<b>Check</b> looks for a new version right away. Backups, library import and emulators have guides of their own: <b>Help & tutorials</b> says where to find them.",
        ),
      },
    ],
  };
}
