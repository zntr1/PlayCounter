import { Timer } from "lucide-react";
import { getT } from "../../../i18n";
import { settingsGroupAvailable } from "../../views/settings/settingsGroups";
import type { TourDefinition, TourStep } from "../tourTypes";
import { a, NEXT_RELEASE } from "./shared";

const t = getT("tour");

/** One row of a Settings page, by its `data-row` id (SettingsKit.tsx). */
const row = (id: string) => a(`settings-row-${id}`);

// Now Playing shows a sample session for every step that rings a part of it
// (NowPlayingView.tsx, `sampleSessionForStep`): a detected game, which has
// Pause only, and for the Stop step a timer started by hand, the one session
// Now Playing can stop. The steps in Settings only point: the live timer, the
// reminder and their keys don't exist on a Mac and are skipped there.
export function whileYouPlayGuide(): TourDefinition {
  // The last step sends the player to Settings only where it has those pages.
  const finish: TourStep = settingsGroupAvailable("play")
    ? {
        id: "finish",
        view: "now",
        anchor: a("nav-settings"),
        title: t("Turn on what you liked"),
        body: t(
          "Start a game and try Pause. If you liked the clock, the reminder or the keys, turn them on under <b>Settings</b>, on the pages While you play and Keyboard shortcuts.",
        ),
      }
    : {
        id: "finish",
        view: "now",
        anchor: a("demo-session-clock"),
        title: t("Try it in a game"),
        body: t(
          "Start a game and look here: Pause sits next to the clock for as long as the game runs, and the session is saved by itself when you close the game.",
        ),
      };
  return {
    id: "while-you-play",
    version: 1,
    release: NEXT_RELEASE,
    kind: "guide",
    category: "playtime",
    icon: Timer,
    title: t("While you play"),
    description: t("Live timer, reminder, pause and the hotkeys."),
    duration: t("2 min"),
    nextTourId: "counters",
    steps: [
      {
        id: "intro",
        view: "now",
        title: t("A sample game is running"),
        body: t(
          "This game is a sample: nothing here is saved. A real game shows up in Now Playing by itself, and <b>This session</b> counts for as long as it runs.",
        ),
      },
      {
        id: "pause",
        view: "now",
        anchor: a("demo-session-pause"),
        interactive: true,
        manualAdvance: true,
        allow: [a("demo-session-pause")],
        advanceOn: { type: "event", name: "demo.step-completed" },
        title: t("Pause when you step away"),
        body: t(
          "A paused session stops counting while the game stays open. It goes on from the same time when you come back.",
        ),
        task: t(
          "Click <b>Pause</b> next to the clock, then click the same button again: it is <b>Resume</b> now.",
        ),
      },
      {
        id: "stop",
        view: "now",
        anchor: a("demo-session-stop"),
        interactive: true,
        manualAdvance: true,
        allow: [a("demo-session-stop")],
        advanceOn: { type: "event", name: "demo.step-completed" },
        title: t("Stop a timer you started"),
        body: t(
          "A PC game needs no stop: its session ends and is saved when you close the game. Only a timer you started by hand, for console play, has <b>Stop</b> here. The sample is such a timer now.",
        ),
        task: t("Click <b>Stop</b> next to the clock."),
      },
      {
        id: "timer",
        view: "settings",
        settingsGroup: "play",
        anchor: row("liveTimerEnabled"),
        optional: true,
        title: t("A clock in your game"),
        body: t(
          "<b>Live timer</b> puts a small clock into your game's window, so you see the session time without leaving the game. It is off until you turn it on. Games in exclusive fullscreen hide it.",
        ),
      },
      {
        id: "corner",
        view: "settings",
        settingsGroup: "play",
        anchor: row("liveTimerCorner"),
        optional: true,
        title: t("Its corner, and its own pause"),
        body: t(
          "<b>Timer position</b> picks the corner. In the game, clicks go through the clock; rest the mouse on it and it shows a pause button of its own.",
        ),
      },
      {
        id: "reminder",
        view: "settings",
        settingsGroup: "play",
        anchor: row("playtimeReminder"),
        optional: true,
        title: t("A reminder to take a break"),
        body: t(
          "<b>Playtime reminder</b> is off until you pick a span. Then a popup comes every time today's playtime, all games together, has grown by that much.",
        ),
      },
      {
        id: "keys",
        view: "settings",
        settingsGroup: "shortcuts",
        anchor: a("settings-section-playing"),
        optional: true,
        title: t("Keys that work inside the game"),
        body: t(
          "The shortcuts under <b>While you play</b> show the session time, open a note box, move the clock and pause, all without leaving the game. You pick the keys: click a field and press them.",
        ),
      },
      finish,
    ],
  };
}
