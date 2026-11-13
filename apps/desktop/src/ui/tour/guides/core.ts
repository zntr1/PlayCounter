import { Sparkles } from "lucide-react";
import { getT } from "../../../i18n";
import type { TourDefinition } from "../tourTypes";
import { a } from "./shared";

const t = getT("tour");

// The steps follow the sidebar: Now Playing, My Games, Achievements and
// My History, Discovered, Launcher accounts, Software (only while tracking
// is on), then Help. TourUI shows the sample cards on the step "games" and
// Now Playing the sample session on "now": keep those two ids.
export function coreGuide(): TourDefinition {
  return {
    id: "core",
    version: 3,
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
        anchor: a("header"),
        title: t("PlayCounter in 60 seconds"),
        body: t(
          "PlayCounter records how long you play, whatever the game came from. Closing the window keeps it tracking in the tray. The cards and sessions in this tour are samples: nothing is saved.",
        ),
      },
      {
        id: "now",
        view: "now",
        anchor: a("now-playing-demo"),
        additionalAnchors: [a("nav-now")],
        title: t("Now Playing"),
        body: t(
          "A game you are playing shows up here with a running timer, its total playtime and its session count. This is a sample session.",
        ),
      },
      {
        id: "games",
        view: "games",
        anchor: a("demo-card-details"),
        additionalAnchors: [
          a("demo-card-journal"),
          a("demo-card-log-session"),
          a("demo-card-more"),
          a("title-search"),
        ],
        title: t("My Games"),
        body: t(
          "Every game you play gets a card. Point at one for <b>Open details</b>, <b>Journal</b>, <b>Log missed session</b> and <b>More</b>. The search in the title bar finds a game by name.",
        ),
      },
      {
        id: "progress",
        view: "achievements",
        anchor: a("achievements-hero"),
        additionalAnchors: [a("nav-history")],
        title: t("Achievements and history"),
        body: t(
          "<b>Achievements</b> unlock as your hours add up, just for fun. <b>My History</b> lists every past session, with charts of when and how much you play.",
        ),
      },
      {
        id: "discovered",
        view: "discovered",
        anchor: a("discovered-wizard"),
        anchorTargets: [
          a("discovered-wizard"),
          a("discovered-filters"),
          a("nav-discovered"),
        ],
        additionalAnchors: [a("nav-discovered")],
        title: t("Discovered"),
        body: t(
          "Apps PlayCounter could not identify wait here. For each one you can match it to a game, add it yourself, count it as software, or ignore it.",
        ),
      },
      {
        id: "accounts",
        view: "accounts",
        anchor: a("accounts-card"),
        additionalAnchors: [a("nav-accounts")],
        title: t("Import from your launchers"),
        body: t(
          "<b>Launcher accounts</b> is where you import games and past playtime from your launchers. It is optional: PlayCounter finds games by itself too.",
        ),
      },
      {
        id: "software",
        view: "software",
        anchor: a("software-intro"),
        additionalAnchors: [a("nav-software")],
        optional: true,
        shownWhen: a("nav-software"),
        title: t("Apps that are not games"),
        body: t(
          "<b>Software</b> counts how long apps like Discord run, apart from your game stats. It shows once you turn on Track software.",
        ),
      },
      {
        id: "help",
        view: "return",
        anchor: a("help"),
        title: t("You're set up"),
        body: t(
          "In the app, <b>Help and tutorials</b> opens a guide for every part of PlayCounter. Start with the Settings guide: it comes next.",
        ),
      },
    ],
  };
}
