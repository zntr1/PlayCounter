import { Camera } from "lucide-react";
import { getT } from "../../../i18n";
import { HISTORY_SAMPLE, historySampleRow } from "../tourHistorySample";
import type { TourDefinition } from "../tourTypes";
import { NEXT_RELEASE, a } from "./shared";

const t = getT("tour");

// No practice surface: while this guide runs, My History shows its sample
// history (TourScreenshotsPractice.tsx) and Settings is the real page. Where
// a computer cannot take screenshots (macOS) the two Settings steps are
// skipped.
export function screenshotsGuide(): TourDefinition {
  return {
    id: "screenshots",
    version: 2,
    release: NEXT_RELEASE,
    kind: "guide",
    category: "playtime",
    icon: Camera,
    title: t("Screenshots"),
    description: t(
      "Take pictures with a hotkey and find them on your sessions.",
    ),
    duration: t("1 min"),
    finishView: "history",
    steps: [
      {
        id: "intro",
        view: "history",
        title: t("Pictures of your sessions"),
        body: t(
          "A key takes a picture of the game you play, and it lands on its session. This is a sample history: nothing is saved, and your own history stays as it is.",
        ),
      },
      {
        id: "keys",
        view: "settings",
        settingsGroup: "shortcuts",
        anchor: a("settings-row-screenshotHotkey"),
        additionalAnchors: [a("settings-row-screenshotCaptionHotkey")],
        optional: true,
        title: t("Pick your screenshot keys"),
        body: t(
          "<b>Take a screenshot</b> saves a picture at once. <b>Screenshot with caption</b> also opens a small box for a line of text. No key is set until you pick one: click a field and press the keys you want.",
        ),
      },
      {
        id: "pictures",
        view: "history",
        anchor: a("demo-history-screenshots"),
        interactive: true,
        manualAdvance: true,
        allow: [a("demo-history-screenshots"), a("demo-screenshot-viewer")],
        advanceOn: {
          type: "anchor-present",
          selector: a("demo-screenshot-viewer"),
        },
        title: t("Pictures sit on their session"),
        body: t(
          "Under a session you see small pictures of it. A small mark on a picture means it has a caption.",
        ),
        task: t("Click one of the pictures."),
      },
      {
        id: "viewer",
        view: "history",
        anchor: a("demo-screenshot-caption"),
        interactive: true,
        manualAdvance: true,
        allow: [a("demo-screenshot-viewer")],
        advanceOn: { type: "event", name: "demo.step-completed" },
        title: t("Look closer and add a caption"),
        body: t(
          "The viewer shows one picture at a time; the arrow keys page through the session's pictures. A caption is one line under the picture.",
        ),
        task: t(
          "Click <b>Add a caption</b>, type a line and press <kbd>Enter</kbd>.",
        ),
      },
      {
        id: "folder",
        view: "settings",
        settingsGroup: "play",
        anchor: a("settings-row-screenshotFolder"),
        optional: true,
        title: t("Where the files are"),
        body: t(
          "The pictures are normal files in your Pictures folder, one folder per game. <b>Open folder</b> takes you there.",
        ),
      },
      {
        id: "end",
        view: "history",
        anchor: historySampleRow(HISTORY_SAMPLE.withPictures),
        title: t("Try it in a game"),
        body: t(
          "In the app, start a game and press your screenshot key. The picture shows up under that session in My History.",
        ),
      },
    ],
  };
}
