import type { CommunityMetadataCandidate } from "@playcounter/shared";
import { useMemo, useState } from "react";
import { getT } from "../../i18n";
import { useAppStore } from "../../store";
import type { DiscoveredExecutable } from "../views/DiscoveredView";
import { findTour } from "./tourDefinitions";
import { TOUR_DEMO_GAME } from "./tourDemoGame";
import { emitTourEvent } from "./tourEvents";
import type { TourStep } from "./tourTypes";

const t = getT("tour");

/* The Discovered page of a guide: sample apps in place of the scanned ones,
   and buttons that only move the samples between the lists. Nothing reaches
   the tracker, the settings or the community. */

/** What a button on the sample page did. */
export type DiscoveredSampleAction =
  | "search"
  | "share"
  | "custom"
  | "software"
  | "ignore"
  | "restore"
  | "skip";

export type DiscoveredSample = {
  /** Changes when the page starts over: another step, Back, a jump. */
  scene: string;
  executables: DiscoveredExecutable[];
  /** The app the review opens on. */
  startKey: string;
  /** The file the sample search is open for. */
  searching: string | null;
  act: (action: DiscoveredSampleAction, exeName: string, name?: string) => void;
  closeSearch: () => void;
  confirmSearch: (choice: CommunityMetadataCandidate) => void;
};

// i18n-exempt: sample apps; their names and folders stay as a PC shows them.
const GAME = TOUR_DEMO_GAME.exeName.toLowerCase();
const APP = "blender.exe";
const HELPER = "fancontrol.exe";

/** The guides that practise on Discovered. */
const GUIDES = new Set(["fix-detection", "track-software"]);

/* The page sets itself up from what a step rings, never from the step's id
   or its place in the guide: the button of the review card a step rings is
   the step's exercise, and using it finishes the step. */
const BUTTON_TASKS: Record<string, DiscoveredSampleAction> = {
  "discovered-add-share": "share",
  "discovered-add-custom": "custom",
  "discovered-software": "software",
  "discovered-ignore": "ignore",
  "discovered-skip": "skip",
};

/** Exercises that fit another app better than the sample game. */
const TASK_APPS: Partial<Record<DiscoveredSampleAction, string>> = {
  software: APP,
  ignore: HELPER,
};

function taskOf(step: Pick<TourStep, "anchor"> | undefined) {
  const button = [...(step?.anchor ?? "").matchAll(/data-tour="([^"]+)"/g)]
    .map((match) => match[1])
    .find((name) => name in BUTTON_TASKS);
  return button ? BUTTON_TASKS[button] : undefined;
}

const SEEN = "2026-11-01T12:00:00.000Z";

function waiting(
  exeName: string,
  exePath: string,
  isRunning: boolean,
  trackedSeconds: number,
  details: DiscoveredExecutable["details"],
): DiscoveredExecutable {
  return {
    key: exeName.toLowerCase(),
    exeName,
    exePath,
    isRunning,
    status: "unmatched",
    cacheEntry: {
      exeName,
      state: "unmatched",
      lastCheckedAt: SEEN,
      trackedSeconds,
      exePath,
    },
    details,
    isTutorial: true,
  };
}

function sampleApps(): DiscoveredExecutable[] {
  return [
    waiting(TOUR_DEMO_GAME.exeName, TOUR_DEMO_GAME.exePath, true, 8_040, {
      productName: TOUR_DEMO_GAME.name,
      companyName: "Blizzard Entertainment",
    }),
    waiting(
      "blender.exe",
      "C:\\Program Files\\Blender Foundation\\Blender 4.2\\blender.exe",
      true,
      3_120,
      { productName: "Blender", companyName: "Blender Foundation" },
    ),
    waiting(
      "FanControl.exe",
      "C:\\Program Files\\FanControl\\FanControl.exe",
      false,
      900,
      { productName: "Fan Control" },
    ),
    {
      key: "diablo iv.exe",
      exeName: "Diablo IV.exe",
      exePath: "C:\\Games\\Diablo IV\\Diablo IV.exe",
      isRunning: false,
      status: "matched",
      cacheEntry: {
        exeName: "Diablo IV.exe",
        state: "matched",
        gameId: -4,
        gameName: "Diablo IV",
        source: "igdb",
        lastCheckedAt: SEEN,
      },
      isTutorial: true,
    },
    {
      key: "rgbsync.exe",
      exeName: "RGBSync.exe",
      exePath: "C:\\Program Files\\RGBSync\\RGBSync.exe",
      isRunning: false,
      status: "userIgnored",
      cacheEntry: null,
      isTutorial: true,
    },
  ];
}

/** The sample app as a game the player added. */
function tracked(
  app: DiscoveredExecutable,
  name: string,
): DiscoveredExecutable {
  return {
    ...app,
    status: "custom",
    cacheEntry: {
      exeName: app.exeName,
      state: "matched",
      gameId: -100,
      gameName: name,
      source: "custom",
      lastCheckedAt: SEEN,
    },
  };
}

/** The sample for the guide that is running, or null on the real page. */
export function useDiscoveredSample(): DiscoveredSample | null {
  const tourId = useAppStore((state) => state.activeTour?.tourId ?? null);
  const stepIndex = useAppStore((state) => state.activeTour?.stepIndex ?? 0);
  const resetToken = useAppStore((state) => state.demoResetToken);
  const guide = tourId && GUIDES.has(tourId) ? tourId : null;
  const step = useMemo(
    () => (guide ? findTour(guide)?.steps[stepIndex] : undefined),
    [guide, stepIndex],
  );
  const scene = guide ? `${guide}:${stepIndex}:${resetToken}` : null;
  const [apps, setApps] = useState(sampleApps);
  const [searching, setSearching] = useState<string | null>(null);
  // Every step starts on fresh samples, so it can be entered from anywhere.
  const [shownScene, setShownScene] = useState(scene);
  if (scene !== shownScene) {
    setShownScene(scene);
    setApps(sampleApps());
    setSearching(null);
  }
  if (!guide || !scene) return null;

  const task = taskOf(step);
  const change = (
    exeName: string,
    next: (app: DiscoveredExecutable) => DiscoveredExecutable | null,
  ) =>
    setApps((current) =>
      current.flatMap((app) => {
        if (app.key !== exeName.toLowerCase()) return [app];
        const changed = next(app);
        return changed ? [changed] : [];
      }),
    );
  // The step's own task finishes it; anything else is only reported.
  const report = (action: DiscoveredSampleAction, message: string) =>
    emitTourEvent(
      action === task ? "demo.step-completed" : "demo.action-completed",
      message,
    );

  return {
    scene,
    executables: apps,
    startKey: (task && TASK_APPS[task]) ?? GAME,
    searching,
    act(action, exeName, name) {
      switch (action) {
        case "search":
          setSearching(exeName);
          return;
        case "custom":
          if (!name) return;
          change(exeName, (app) => tracked(app, name));
          report(
            action,
            t(
              "Sample added as {{name}}. Custom games appear in My Games; no global filename match is created.",
              { name },
            ),
          );
          return;
        case "software":
          change(exeName, () => null);
          report(
            action,
            t(
              "Sample tracked as software. In your library, it leaves Discovered and counts on the Software page, never as a game.",
            ),
          );
          return;
        case "ignore":
          change(exeName, (app) => ({
            ...app,
            status: "userIgnored",
            cacheEntry: null,
          }));
          report(
            action,
            t(
              "Sample ignored. In the app, it is no longer tracked until you restore it under Ignored.",
            ),
          );
          return;
        case "restore":
          change(exeName, (app) => ({ ...app, status: "unmatched" }));
          report(action, t("Sample restored. It waits in Needs review again."));
          return;
        case "skip":
          report(
            action,
            t(
              "Skipped for now. In Discovered, this app stays in Needs review.",
            ),
          );
          return;
        case "share":
          return;
      }
    },
    closeSearch: () => setSearching(null),
    confirmSearch(choice) {
      if (!searching) return;
      change(searching, (app) => tracked(app, choice.name));
      setSearching(null);
      report(
        "share",
        t(
          "Sample matched to {{name}}. In the real flow, Add & Share sends a suggestion for review. Nothing was sent here.",
          { name: choice.name },
        ),
      );
    },
  };
}
