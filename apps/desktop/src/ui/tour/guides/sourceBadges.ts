import { Tag } from "lucide-react";
import { getT } from "../../../i18n";
import type { TourDefinition } from "../tourTypes";
import { a, NEXT_RELEASE } from "./shared";

const t = getT("tour");

// The panel above the sample card (MyGamesView.tsx, `demo-origin-examples`)
// shows every badge. The guide rings those, not the 29 px seals on the card,
// which can sit below the window's edge.
export function sourceBadgesGuide(): TourDefinition {
  return {
    id: "source-badges",
    version: 3,
    release: NEXT_RELEASE,
    kind: "guide",
    category: "detection",
    icon: Tag,
    title: t("Understand game badges"),
    description: t("Learn how PlayCounter recognized each of your games."),
    duration: t("1 min"),
    demoGame: true,
    finishView: "games",
    steps: [
      {
        id: "intro",
        view: "games",
        anchor: a("demo-match-examples"),
        title: t("How was this game recognized?"),
        body: t(
          "A badge tells you how PlayCounter connected a game's file to a game: Community, IGDB and Custom. This is a sample: nothing is saved.",
        ),
      },
      {
        id: "community",
        view: "games",
        anchor: a("demo-legend-community"),
        title: t("Community"),
        body: t(
          "The PlayCounter community database links file names to the right games. You can share a match that's missing - once it's reviewed and approved, everyone's PlayCounter recognizes that file automatically.",
        ),
      },
      {
        id: "igdb",
        view: "games",
        anchor: a("demo-legend-igdb"),
        title: "IGDB",
        body: t(
          "IGDB is a large public game database. Some entries record the game's .exe name, like bg3.exe for Baldur's Gate 3, and PlayCounter finds those right away. Many don't; the Community database fills that gap.",
        ),
      },
      {
        id: "custom",
        view: "games",
        anchor: a("demo-legend-custom"),
        title: t("Custom"),
        body: t(
          "You added this game yourself. Once you send the match to the community, a clock means it is waiting to be reviewed, and a check means it was approved.",
        ),
      },
      {
        id: "where",
        view: "games",
        anchor: a("library-customize"),
        title: t("Where badges sit, and hiding them"),
        body: t(
          "Match badges are the seals at the top left of a cover; rest the pointer on one to read it. <b>Customize</b> › <b>Card details</b> has <b>File match info</b> and <b>Source badges</b> to hide them.",
        ),
      },
      {
        id: "origins",
        view: "games",
        anchor: a("demo-launcher-examples"),
        title: t("Launcher and emulator badges"),
        body: t(
          "In the app, a launcher badge sits beside a game's name: Steam, Xbox, Battle.net, Epic Games, GOG or PlayStation. An emulator badge like Dolphin shows how it ran. Neither means the game is installed.",
        ),
      },
    ],
  };
}
