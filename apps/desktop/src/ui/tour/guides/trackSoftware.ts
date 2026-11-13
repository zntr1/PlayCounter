import { AppWindow } from "lucide-react";
import { getT } from "../../../i18n";
import type { TourDefinition } from "../tourTypes";
import { a, discoveredAction, NEXT_RELEASE } from "./shared";

const t = getT("tour");

export function trackSoftwareGuide(): TourDefinition {
  return {
    id: "track-software",
    version: 1,
    release: NEXT_RELEASE,
    kind: "guide",
    category: "detection",
    icon: AppWindow,
    title: t("Track software"),
    description: t("Count how long apps like Discord run, apart from games."),
    duration: t("1 min"),
    finishView: "software",
    steps: [
      {
        id: "intro",
        view: "software",
        title: t("Count apps, apart from games"),
        body: t(
          "<b>Software</b> counts how long apps like Discord or Spotify run. It never shows in Now Playing or your game stats.",
        ),
      },
      {
        id: "track-app",
        view: "discovered",
        anchor: discoveredAction("software"),
        interactive: true,
        manualAdvance: true,
        allow: [`${a("demo-discovery")} ${a("discovered-software")}`],
        advanceOn: { type: "event", name: "demo.step-completed" },
        title: t("Track an app as software"),
        body: t(
          "Not every app is a game. An app in <b>Discovered</b> that you only want to time can be tracked as software instead.",
        ),
        task: t("Click <b>Track as software</b> on the sample app."),
      },
      {
        id: "page",
        view: "software",
        anchor: a("demo-software-cards"),
        title: t("Every app gets its own time"),
        body: t(
          "Each card shows an app's total time and today's. A <b>Running</b> badge marks apps that run right now. Blender, which you just tracked, is on the page.",
        ),
      },
      {
        id: "numbers",
        view: "software",
        anchor: a("demo-software-card"),
        anchorTargets: [a("demo-software-details"), a("demo-software-card")],
        interactive: true,
        manualAdvance: true,
        allow: [a("demo-software-card"), a("demo-software-details")],
        advanceOn: { type: "event", name: "demo.step-completed" },
        title: t("Open one app's numbers"),
        body: t(
          "Software keeps no sessions, only time per day: total, this week, today and the days an app was used.",
        ),
        task: t("Click a card to see its numbers, then close it."),
      },
      {
        id: "switch",
        view: "settings",
        settingsGroup: "discovery",
        anchor: '[data-row="trackTools"]',
        title: t("Where to switch it off"),
        body: t(
          "In the app, <b>Track software</b> in Settings under Discovery turns this on or off. With it off, the Software page leaves the sidebar.",
        ),
      },
    ],
  };
}
