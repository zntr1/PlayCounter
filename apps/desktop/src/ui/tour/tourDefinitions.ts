import { addGameGuide } from "./guides/addGame";
import { backupDataGuide } from "./guides/backupData";
import { coreGuide } from "./guides/core";
import { correctHistoryGuide } from "./guides/correctHistory";
import { countersGuide } from "./guides/counters";
import { coversBannersGuide } from "./guides/coversBanners";
import { customGamesGuide } from "./guides/customGames";
import { emulatorsGuide } from "./guides/emulators";
import { feedbackRepliesGuide } from "./guides/feedbackReplies";
import { fixDetectionGuide } from "./guides/fixDetection";
import { gameAchievementsGuide } from "./guides/gameAchievements";
import { gameActionsGuide } from "./guides/gameActions";
import { importLibraryGuide } from "./guides/importLibrary";
import { launcherAccountsGuide } from "./guides/launcherAccounts";
import { launchGamesGuide } from "./guides/launchGames";
import { libraryProgressGuide } from "./guides/libraryProgress";
import { logPlaytimeGuide } from "./guides/logPlaytime";
import { notesPlaythroughsGuide } from "./guides/notesPlaythroughs";
import { organizeLibraryGuide } from "./guides/organizeLibrary";
import { rateGamesGuide } from "./guides/rateGames";
import { screenshotsGuide } from "./guides/screenshots";
import { settingsGuide } from "./guides/settings";
import { sourceBadgesGuide } from "./guides/sourceBadges";
import { statsGuide } from "./guides/stats";
import { trackSoftwareGuide } from "./guides/trackSoftware";
import { watchFoldersGuide } from "./guides/watchFolders";
import { whileYouPlayGuide } from "./guides/whileYouPlay";
import type { TourDefinition } from "./tourTypes";

export { tourCategories } from "./tourTypes";
export type {
  TourAdvance,
  TourCategoryId,
  TourDefinition,
  TourEventName,
  TourStep,
} from "./tourTypes";

// One file per guide under ./guides. Built on each call, so a guide follows
// the current language. The order here is the order inside each topic of the
// Help menu.
export function tours(): TourDefinition[] {
  return [
    coreGuide(),
    launcherAccountsGuide(),
    importLibraryGuide(),
    watchFoldersGuide(),
    addGameGuide(),
    notesPlaythroughsGuide(),
    organizeLibraryGuide(),
    libraryProgressGuide(),
    rateGamesGuide(),
    coversBannersGuide(),
    gameActionsGuide(),
    logPlaytimeGuide(),
    whileYouPlayGuide(),
    correctHistoryGuide(),
    statsGuide(),
    gameAchievementsGuide(),
    countersGuide(),
    screenshotsGuide(),
    launchGamesGuide(),
    fixDetectionGuide(),
    trackSoftwareGuide(),
    emulatorsGuide(),
    sourceBadgesGuide(),
    customGamesGuide(),
    settingsGuide(),
    backupDataGuide(),
    feedbackRepliesGuide(),
  ];
}

export const CORE_TOUR_ID = "core";
export const findTour = (id: string) => tours().find((tour) => tour.id === id);
export const guideTours = () => tours().filter((tour) => tour.kind === "guide");
