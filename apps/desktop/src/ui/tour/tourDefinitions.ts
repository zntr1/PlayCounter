import { coreGuide } from "./guides/core";
import { importLibraryGuide } from "./guides/importLibrary";
import { watchFoldersGuide } from "./guides/watchFolders";
import { notesPlaythroughsGuide } from "./guides/notesPlaythroughs";
import { organizeLibraryGuide } from "./guides/organizeLibrary";
import { libraryProgressGuide } from "./guides/libraryProgress";
import { rateGamesGuide } from "./guides/rateGames";
import { launchGamesGuide } from "./guides/launchGames";
import { logPlaytimeGuide } from "./guides/logPlaytime";
import { gameActionsGuide } from "./guides/gameActions";
import { fixDetectionGuide } from "./guides/fixDetection";
import { statsGuide } from "./guides/stats";
import { settingsGuide } from "./guides/settings";
import { backupDataGuide } from "./guides/backupData";
import { feedbackRepliesGuide } from "./guides/feedbackReplies";
import { emulatorsGuide } from "./guides/emulators";
import { sourceBadgesGuide } from "./guides/sourceBadges";
import type { TourDefinition } from "./tourTypes";

export { isHandsOn, tourCategories } from "./tourTypes";
export type {
  TourAdvance,
  TourCategoryId,
  TourDefinition,
  TourEventName,
  TourStep,
} from "./tourTypes";

// One file per guide under ./guides. Built on each call, so a guide follows
// the current language. The order here is the order in the Help menu.
export function tours(): TourDefinition[] {
  return [
    coreGuide(),
    importLibraryGuide(),
    watchFoldersGuide(),
    notesPlaythroughsGuide(),
    organizeLibraryGuide(),
    libraryProgressGuide(),
    rateGamesGuide(),
    launchGamesGuide(),
    logPlaytimeGuide(),
    gameActionsGuide(),
    fixDetectionGuide(),
    statsGuide(),
    settingsGuide(),
    backupDataGuide(),
    feedbackRepliesGuide(),
    emulatorsGuide(),
    sourceBadgesGuide(),
  ];
}

export const CORE_TOUR_ID = "core";
export const findTour = (id: string) => tours().find((tour) => tour.id === id);
export const guideTours = () => tours().filter((tour) => tour.kind === "guide");
