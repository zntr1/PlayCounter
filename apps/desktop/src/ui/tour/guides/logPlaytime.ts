import { Clock } from "lucide-react";
import { getT } from "../../../i18n";
import type { TourDefinition } from "../tourTypes";
import { a, sampleCardAllow, sampleCardDialogs } from "./shared";

const t = getT("tour");

export function logPlaytimeGuide(): TourDefinition {
  return {
    id: "log-playtime",
    version: 3,
    kind: "guide",
    category: "playtime",
    icon: Clock,
    title: t("Log missed playtime"),
    description: t("Practice adding a session from a game's right-click menu."),
    duration: t("2 min"),
    demoGame: true,
    finishView: "games",
    steps: [
      {
        id: "intro",
        view: "games",
        title: t("Log playtime by hand"),
        body: t(
          "We'll use a sample World of Warcraft card. Nothing you do here is saved, and your real games can't be changed while the guide runs.",
        ),
      },
      {
        id: "open-menu",
        view: "games",
        interactive: true,
        anchor: a("demo-game-card"),
        allow: [a("demo-game-card")],
        advanceOn: {
          type: "anchor-present",
          selector: a("demo-menu-playtime"),
        },
        skipTo: "alternative",
        title: t("Right-click the sample card"),
        body: t(
          "Every game card has a right-click menu with advanced actions.",
        ),
      },
      {
        id: "open-playtime",
        view: "games",
        interactive: true,
        anchor: a("demo-menu-playtime"),
        allow: [a("demo-context-menu")],
        advanceOn: {
          type: "anchor-present",
          selector: a("demo-menu-log-session"),
        },
        retreatWhenMissing: a("demo-context-menu"),
        backTo: "open-menu",
        skipTo: "alternative",
        title: t("Open Playtime"),
        body: t(
          "Open this submenu to add a missed session or correct a total. You can also focus it and press the Right arrow key.",
        ),
      },
      {
        id: "pick-item",
        view: "games",
        interactive: true,
        anchor: a("demo-menu-log-session"),
        allow: [a("demo-context-menu"), a("demo-playtime-menu")],
        advanceOn: {
          type: "anchor-present",
          selector: a("demo-log-session-dialog"),
        },
        retreatWhenMissing: a("demo-playtime-menu"),
        backTo: "open-playtime",
        skipTo: "alternative",
        title: t("Choose “Log missed session”"),
        body: t(
          "For a real game, this adds a session to History and updates charts and achievements.",
        ),
      },
      {
        id: "fill-dialog",
        ownBackdrop: true,
        view: "games",
        interactive: true,
        anchor: a("demo-log-session-dialog"),
        allow: [a("demo-log-session-backdrop")],
        advanceOn: { type: "event", name: "mygames.demo-session-logged" },
        retreatWhenMissing: a("demo-log-session-dialog"),
        backTo: "open-menu",
        skipTo: "alternative",
        title: t("Enter length and end time"),
        body: t(
          "Choose how long you played and when the session ended, then press Log session.",
        ),
      },
      {
        id: "result",
        view: "games",
        anchor: a("demo-playtime-result"),
        backTo: "open-menu",
        title: t("Playtime and session updated"),
        body: t(
          "The duration you entered was added to the game's total playtime, and one new session was created. For a real game, that session also appears in History and contributes to charts and achievements.",
        ),
      },
      {
        id: "alternative",
        view: "games",
        anchor: a("demo-game-card"),
        anchorTargets: [
          ...sampleCardDialogs,
          a("demo-menu-adjust-playtime"),
          a("demo-menu-playtime"),
        ],
        interactive: true,
        manualAdvance: true,
        allow: sampleCardAllow,
        backTo: "open-menu",
        title: t("Only know a total?"),
        body: t(
          "Open Playtime and choose Adjust total playtime when you only know a lifetime total. It corrects the number without inventing history entries. You're now ready to try either option on one of your own games.",
        ),
      },
    ],
  };
}
