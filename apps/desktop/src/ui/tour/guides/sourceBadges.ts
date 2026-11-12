import { Tag } from "lucide-react";
import { getT } from "../../../i18n";
import type { TourDefinition } from "../tourTypes";
import { a } from "./shared";

const t = getT("tour");

export function sourceBadgesGuide(): TourDefinition {
  return {
    id: "source-badges",
    version: 2,
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
        title: t("How was this game recognized?"),
        body: t(
          "A badge tells you how PlayCounter connected the file you started to a game. There are three ways, and we'll show all of them on this sample card - nothing is added to your library.",
        ),
      },
      {
        id: "origins",
        view: "games",
        anchor: a("demo-origin-examples"),
        title: t("Where it came from, and how it was recognized"),
        body: t(
          "Steam, Xbox, Battle.net, Epic Games, GOG, and PlayStation badges describe a library's launcher origin. Dolphin and other emulator badges describe how the game ran. Community, IGDB, and Custom describe the file match. A game can have both kinds of badge. These examples do not claim that any launcher or game is installed.",
        ),
      },
      {
        id: "community",
        view: "games",
        anchor: a("demo-source-community"),
        title: t("Community"),
        body: t(
          "The PlayCounter community database links file names to the right games. You can share a match that's missing - once it's reviewed and approved, everyone's PlayCounter recognizes that file automatically.",
        ),
      },
      {
        id: "igdb",
        view: "games",
        anchor: a("demo-source-igdb"),
        title: "IGDB",
        body: t(
          "IGDB is a large public game database. Some of its entries record the name of the game's .exe file - bg3.exe for Baldur's Gate 3, for example. When it's there, PlayCounter finds the game right away.\n\nPlenty of entries don't have it, though. That's the gap the Community database fills.",
        ),
      },
      {
        id: "custom",
        view: "games",
        anchor: a("demo-source-custom"),
        title: t("Custom"),
        body: t(
          "You added this game yourself. The name and the file it points to stay on this PC, unless you send it to the Community database later.",
        ),
      },
    ],
  };
}
