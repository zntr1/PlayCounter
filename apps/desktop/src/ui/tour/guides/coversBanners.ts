import { Image } from "lucide-react";
import { getT } from "../../../i18n";
import type { TourDefinition } from "../tourTypes";
import { a, NEXT_RELEASE, sampleCardAllow, sampleCardDialogs } from "./shared";

const t = getT("tour");

/** A step the player tries on the sample card's Appearance menu. */
const tryIt = {
  view: "games",
  anchor: a("demo-game-card"),
  interactive: true,
  manualAdvance: true,
  allow: sampleCardAllow,
  advanceOn: { type: "event", name: "demo.step-completed" },
} as const;

export function coversBannersGuide(): TourDefinition {
  return {
    id: "covers-banners",
    version: 2,
    release: NEXT_RELEASE,
    kind: "guide",
    category: "library",
    icon: Image,
    title: t("Covers and banners"),
    description: t("Pick, upload or paste artwork for any game."),
    duration: t("2 min"),
    demoGame: true,
    finishView: "games",
    steps: [
      {
        id: "intro",
        view: "games",
        title: t("Artwork you pick"),
        body: t("Every game can get a cover and a banner you choose."),
      },
      {
        ...tryIt,
        id: "appearance",
        advanceOn: {
          type: "anchor-present",
          selector: a("demo-appearance-menu"),
        },
        // Not the flyout: opening it is the task.
        anchorTargets: [a("demo-menu-appearance")],
        title: t("Open Appearance"),
        body: t(
          "The card's right-click menu has <b>Appearance</b>: cover, banner and name in one place.",
        ),
        task: t("Right-click the sample card and open <b>Appearance</b>."),
      },
      {
        ...tryIt,
        id: "choose-cover",
        anchorTargets: [
          ...sampleCardDialogs,
          a("demo-menu-choose-cover"),
          a("demo-appearance-menu"),
          a("demo-menu-appearance"),
        ],
        title: t("Choose a cover"),
        body: t("The picker normally searches SteamGridDB."),
        task: t("Click <b>Choose cover…</b> and pick a picture."),
      },
      {
        id: "other-ways",
        view: "games",
        anchor: a("demo-game-card"),
        anchorTargets: [
          a("demo-menu-upload-cover"),
          a("demo-appearance-menu"),
          a("demo-menu-appearance"),
        ],
        interactive: true,
        manualAdvance: true,
        allow: sampleCardAllow,
        title: t("Your own picture"),
        body: t(
          "<b>Upload cover</b> takes a picture file from your PC. <b>Paste Cover</b> uses a picture you copied.",
        ),
      },
      {
        ...tryIt,
        id: "restore",
        anchorTargets: [
          a("demo-menu-restore-cover"),
          a("demo-appearance-menu"),
          a("demo-menu-appearance"),
        ],
        title: t("Go back to the automatic cover"),
        body: t(
          "<b>Restore Cover</b> brings back the cover PlayCounter found on its own. It shows once you picked one.",
        ),
        task: t("Click <b>Restore Cover</b>."),
      },
      {
        ...tryIt,
        id: "banner",
        anchorTargets: [
          ...sampleCardDialogs,
          a("demo-menu-choose-banner"),
          a("demo-appearance-menu"),
          a("demo-menu-appearance"),
        ],
        title: t("Banners work the same way"),
        body: t(
          "The banner is the wide picture behind a game's name. <b>Upload banner</b> and <b>Paste banner</b> sit next to the picker.",
        ),
        task: t("Click <b>Choose banner…</b> and pick a picture."),
      },
      {
        ...tryIt,
        id: "pin",
        anchorTargets: [a("demo-menu-pin-banner"), a("demo-context-menu")],
        title: t("Show a game in the banner"),
        body: t(
          "<b>Pin to banner</b> puts this game in the banner at the top of My Games, until you pin another.",
        ),
        task: t("Click <b>Pin to banner</b>."),
      },
      {
        id: "finish",
        view: "games",
        anchor: a("demo-game-card"),
        title: t("Make your library yours"),
        body: t(
          "In the app, right-click any card and open Appearance. The art stays on this PC.",
        ),
      },
    ],
  };
}
