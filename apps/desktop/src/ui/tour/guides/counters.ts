import { Hash } from "lucide-react";
import { getT } from "../../../i18n";
import { currentPlatform } from "../../../platform";
import type { TourDefinition } from "../tourTypes";
import { a, NEXT_RELEASE } from "./shared";

const t = getT("tour");

// Counters live in a game's Details and on Now Playing; the keys for the
// counter box are in Settings. The sample game's counters are a library of
// their own that is thrown away with the guide (tourDemoDetails.ts), so no
// key is registered and nothing reaches the player's games.
export function countersGuide(): TourDefinition {
  // The controller only counts on Windows.
  const controller = currentPlatform() === "windows";
  const inCounters = {
    view: "games",
    sampleDetails: "counters",
    interactive: true,
  } as const;
  return {
    id: "counters",
    version: 1,
    release: NEXT_RELEASE,
    kind: "guide",
    category: "playtime",
    icon: Hash,
    title: t("Count deaths and bosses"),
    description: t("Counters with their own keys, shown while you play."),
    duration: t("2 min"),
    demoGame: true,
    finishView: "games",
    nextTourId: "screenshots",
    steps: [
      {
        id: "intro",
        view: "games",
        title: t("Count what matters to you"),
        body: t("Deaths, bosses, runs: every game can count what you like."),
      },
      {
        id: "open-details",
        view: "games",
        anchor: a("demo-game-card"),
        anchorTargets: [a("demo-menu-details")],
        interactive: true,
        allow: [a("demo-game-card"), a("demo-context-menu")],
        advanceOn: { type: "anchor-present", selector: a("demo-game-details") },
        skipTo: "counters-tab",
        title: t("Counters live in Details"),
        body: t("Every game has its counters in its Details."),
        task: t("Right-click the sample card and pick <b>Open Details</b>."),
      },
      {
        id: "counters-tab",
        view: "games",
        sampleDetails: "general",
        anchor: a("demo-details-tab-counters"),
        interactive: true,
        allow: [a("demo-details-tab-counters")],
        advanceOn: {
          type: "anchor-present",
          selector: a("demo-details-panel-counters"),
        },
        skipTo: "add",
        title: t("Open the Counters tab"),
        body: t(
          "Deaths is there from the start. This card also has Bosses, with a few sessions behind it.",
        ),
        task: t("Click the <b>Counters</b> tab."),
      },
      {
        ...inCounters,
        id: "add",
        anchor: a("demo-counter-add"),
        anchorTargets: [a("demo-counter-name")],
        allow: [a("demo-counter-add"), a("demo-counter-name")],
        advanceOn: { type: "event", name: "demo.step-completed" },
        skipTo: "key",
        title: t("Add a counter"),
        body: t(
          "A counter can be anything: a boss, a fish, a run. Each one has its own numbers and its own chart.",
        ),
        task: t(
          "Click <b>Add counter</b>, type a name and press <kbd>Enter</kbd>.",
        ),
      },
      {
        ...inCounters,
        id: "key",
        anchor: a("demo-counter-key"),
        allow: [a("demo-counter-key")],
        advanceOn: { type: "event", name: "demo.step-completed" },
        skipTo: "shown",
        title: t("Give it a key of its own"),
        body: t(
          "While the game runs, the key counts this counter, even when PlayCounter is in the background. The key is yours to choose.",
        ),
        task: t("Click <b>Set a key</b>, then press a key of your own choice."),
      },
      {
        view: "games",
        sampleDetails: "counters",
        id: "shown",
        anchor: a("demo-counter-shown"),
        ...(controller
          ? { additionalAnchors: [a("demo-counter-controller")] }
          : {}),
        title: t("Show it while you play"),
        body: controller
          ? t(
              "<b>Show in the live timer and on Now Playing</b> puts the counter where you can see it. <b>Count with View/Create/Share + D-pad up</b> lets a controller count one counter per game.",
            )
          : t(
              "<b>Show in the live timer and on Now Playing</b> puts the counter where you can see it while you play.",
            ),
      },
      {
        id: "count",
        view: "now",
        anchor: a("demo-session-counter-plus"),
        interactive: true,
        allow: [a("demo-session-counter-plus")],
        advanceOn: { type: "event", name: "demo.step-completed" },
        skipTo: "box",
        title: t("Count while you play"),
        body: t(
          "On Now Playing every shown counter is a tile. The number is for this session, the line below adds up the whole playthrough.",
        ),
        task: t("Click <b>Add one</b>."),
      },
      {
        id: "box",
        view: "settings",
        settingsGroup: "shortcuts",
        anchor: a("settings-section-counters"),
        title: t("Keys for the counter box"),
        body: t(
          "Under Keyboard shortcuts, <b>Open counter box</b> opens all counters over your game. <b>Take one back</b> undoes a press made by mistake.",
        ),
      },
      {
        id: "finish",
        view: "games",
        anchor: a("demo-game-card"),
        title: t("Try it in a game"),
        body: t(
          "In the app, open a game's Details, add a counter and set its key. Start the game and press the key whenever it happens.",
        ),
      },
    ],
  };
}
