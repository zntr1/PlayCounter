import { Trophy } from "lucide-react";
import { getT } from "../../../i18n";
import { currentPlatform } from "../../../platform";
import type { TourDefinition, TourStep } from "../tourTypes";
import { a, NEXT_RELEASE } from "./shared";

const t = getT("tour");

// Two kinds of achievements: PlayCounter's own milestones and game ladders on
// the Achievements page (sample milestones while the guide runs, see
// AchievementsView.tsx), and the achievements the launchers know, shown in a
// game's Details (the sample game has a bundled list, see tourDemoDetails.ts).
export function gameAchievementsGuide(): TourDefinition {
  // Epic Games, GOG and PlayStation have their sign-ins on Windows only.
  const signIns = currentPlatform() === "windows";
  const detailsStep = {
    view: "games",
    sampleDetails: "achievements",
    interactive: true,
  } as const;
  const signInStep: TourStep[] = signIns
    ? [
        {
          ...detailsStep,
          id: "sign-in",
          anchor: a("demo-achievements-sign-in"),
          allow: [a("demo-achievements-sign-in")],
          advanceOn: { type: "event", name: "demo.step-completed" },
          skipTo: "finish",
          title: t("When a sign-in runs out"),
          body: t(
            "Steam is read from this PC. The other launchers use your sign-in; when it runs out, the list says so. Your sign-ins live on the <b>Launcher accounts</b> page.",
          ),
          task: t("Click <b>Sign in again</b>."),
        },
      ]
    : [];
  return {
    id: "game-achievements",
    version: 1,
    release: NEXT_RELEASE,
    kind: "guide",
    category: "playtime",
    icon: Trophy,
    title: t("Achievements & trophies"),
    description: t("Milestones, game ladders and launcher achievements."),
    duration: t("2 min"),
    demoGame: true,
    finishView: "games",
    nextTourId: "launcher-accounts",
    steps: [
      {
        id: "page",
        view: "achievements",
        title: t("Your achievements at a glance"),
        body: t(
          "This page is a sample, nothing is saved. The ring shows how many of PlayCounter's own milestones you have, and what comes next.",
        ),
      },
      {
        id: "tabs",
        view: "achievements",
        anchor: a("demo-achievements-tab-games"),
        interactive: true,
        allow: [a("demo-achievements-tab-games")],
        advanceOn: { type: "event", name: "demo.step-completed" },
        skipTo: "ladders",
        title: t("Milestones and game ladders"),
        body: t(
          "<b>Milestones</b> count everything you play. <b>Game ladders</b> give every game a trophy ladder of its own.",
        ),
        task: t("Open <b>Game ladders</b>."),
      },
      {
        id: "ladders",
        view: "achievements",
        anchor: a("achievements-first-ladder"),
        title: t("One ladder per game"),
        body: t(
          "A game climbs its ladder with the hours you play it: 10, 25, 50 and more. Every rung is a trophy, and the next one shows how far away it is.",
        ),
      },
      {
        id: "open",
        view: "games",
        anchor: a("demo-game-card"),
        anchorTargets: [a("demo-menu-achievements")],
        interactive: true,
        allow: [a("demo-game-card"), a("demo-context-menu")],
        advanceOn: {
          type: "anchor-present",
          selector: a("demo-details-panel-achievements"),
        },
        skipTo: "sort",
        title: t("A game's own achievements"),
        body: signIns
          ? t(
              "The launchers know achievements per game: Steam, Xbox, GOG, Epic Games and PlayStation. A game that has some shows them in its Details.",
            )
          : t(
              "The launchers know achievements per game: Steam and Xbox. A game that has some shows them in its Details.",
            ),
        task: t("Right-click the sample card and pick <b>Achievements</b>."),
      },
      {
        ...detailsStep,
        id: "sort",
        anchor: a("demo-achievement-sort"),
        additionalAnchors: [a("demo-achievement-filters")],
        allow: [a("demo-achievement-sort"), a("demo-achievement-filters")],
        advanceOn: { type: "event", name: "demo.step-completed" },
        skipTo: signIns ? "sign-in" : "finish",
        title: t("Unlocked, locked and sorted"),
        body: t(
          "<b>Unlocked</b> and <b>Locked</b> split the list. Each one shows when you unlocked it and how many players did.",
        ),
        task: t("Change the sort order: pick another one in the list."),
      },
      ...signInStep,
      {
        id: "finish",
        view: "games",
        anchor: a("demo-game-card"),
        title: t("Find them in the app"),
        body: t(
          "In the app, open a game's <b>Achievements</b> from its right-click menu. The Achievements page in the sidebar shows your milestones and ladders.",
        ),
      },
    ],
  };
}
