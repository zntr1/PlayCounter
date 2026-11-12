import { Sparkles } from "lucide-react";
import { getT } from "../../../i18n";
import type { TourDefinition } from "../tourTypes";
import { a } from "./shared";

const t = getT("tour");

export function coreGuide(): TourDefinition {
  return {
    id: "core",
    version: 2,
    kind: "core",
    nextTourId: "settings",
    category: "getting-started",
    icon: Sparkles,
    title: t("Quick tour"),
    description: t("The essentials of PlayCounter in about a minute."),
    duration: t("1 min"),
    steps: [
      {
        id: "intro",
        view: "keep",
        title: t("PlayCounter in 60 seconds"),
        body: t(
          "PlayCounter runs in the background and records how long you play. It doesn't matter where the game came from: a launcher, a disc, an emulator, or a single .exe file on your desktop.",
        ),
      },
      {
        id: "now",
        view: "now",
        anchor: a("now-playing-demo"),
        additionalAnchors: [a("nav-now")],
        title: t("Now Playing"),
        body: t(
          "This is a sample session, not a real one.\n\nThe green Now playing badge and the running timer mean PlayCounter is tracking right now. The timer and total playtime increase while you play. The session count records separate play sessions.",
        ),
      },
      {
        id: "games",
        view: "games",
        anchor: a("core-library-demo"),
        additionalAnchors: [a("nav-games")],
        title: t("My Games"),
        body: t(
          "Every game you play shows up here with cover, total playtime, and session count. These two cards are only samples. Right-click any real card to edit it, or right-click My Games in the sidebar to import games from your launchers.",
        ),
      },
      {
        id: "history",
        view: "history",
        anchor: a("nav-history"),
        title: t("My History"),
        body: t(
          "Search every past session and explore charts of when and how much you play.",
        ),
      },
      {
        id: "achievements",
        view: "achievements",
        anchor: a("nav-achievements"),
        title: t("Achievements"),
        body: t(
          "Local milestones unlock as your hours add up - purely for fun.",
        ),
      },
      {
        id: "discovered",
        view: "discovered",
        anchor: a("nav-discovered"),
        title: t("Discovered"),
        body: t(
          "Sort out any app PlayCounter couldn't identify: match it to a game, add it yourself, or ignore it. The badge counts what still needs review.",
        ),
      },
      {
        id: "settings",
        view: "settings",
        anchor: a("nav-settings"),
        title: t("Settings"),
        body: t(
          "Tune startup, desktop popups, colors, emulators, backups, and updates.",
        ),
      },
      {
        id: "help",
        view: "return",
        anchor: a("help"),
        title: t("You're set up"),
        body: t(
          "Before you start playing, take a minute for Settings: make sure Launch on startup is on, pick the popups you want, and choose your accent color.",
        ),
      },
    ],
  };
}
