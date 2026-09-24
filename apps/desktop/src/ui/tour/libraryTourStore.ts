import { createStore } from "zustand";
import { emptyJournal, journalKey } from "../../personalLibrary";
import {
  createPersonalLibraryActions,
  type PersonalLibraryState,
} from "../../personalLibraryStore";
import type { Toast } from "../../store";
import { TOUR_DEMO_GAME } from "./tourDemoGame";

export const LIBRARY_TOUR_GRID_COLUMNS = 3;

export const LIBRARY_TOUR_GAME = {
  ...TOUR_DEMO_GAME,
  gameName: TOUR_DEMO_GAME.name,
  source: "community" as const,
};

export type LibraryTourState = PersonalLibraryState & { notice: Toast | null };

export function createLibraryTourStore(
  settings: PersonalLibraryState["settings"],
) {
  const now = Date.now();
  return createStore<LibraryTourState>((set, get) => ({
    ...createPersonalLibraryActions(set, get, () => {}),
    gameJournals: {
      [journalKey(LIBRARY_TOUR_GAME)]: emptyJournal(LIBRARY_TOUR_GAME),
    },
    personalShelves: [],
    archivedPlaythroughSeconds: {},
    archivedGameSeconds: {},
    playtimeAdjustments: {},
    journalTarget: null,
    gameMetadata: new Map(),
    exeCache: new Map(),
    libraryImports: new Map(),
    activeSessions: [],
    activeView: "games",
    recentSessions: [3600, 1800].map((durationSeconds, index) => ({
      id: -100 - index,
      gameId: LIBRARY_TOUR_GAME.gameId,
      gameName: LIBRARY_TOUR_GAME.gameName,
      source: LIBRARY_TOUR_GAME.source,
      coverUrl: LIBRARY_TOUR_GAME.coverUrl,
      exeName: LIBRARY_TOUR_GAME.exeName,
      startedAt: new Date(now - (index + 1) * 86_400_000).toISOString(),
      endedAt: new Date(
        now - (index + 1) * 86_400_000 + durationSeconds * 1000,
      ).toISOString(),
      durationSeconds,
    })),
    settings: {
      ...settings,
      libraryGridColumns: LIBRARY_TOUR_GRID_COLUMNS,
      libraryShowShelves: true,
      libraryShowOriginBadges: true,
      libraryShowMatchBadges: true,
      libraryShowStatusBadges: true,
      libraryShowNoteBadges: true,
    },
    notice: null,
    addToast: (toast) => set({ notice: { ...toast, id: -1 } }),
  }));
}
