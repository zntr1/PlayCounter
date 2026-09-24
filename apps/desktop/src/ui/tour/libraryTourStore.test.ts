// @vitest-environment happy-dom
import { beforeEach, expect, it } from "vitest";
import {
  emptyJournal,
  journalKey,
  playthroughSeconds,
} from "../../personalLibrary";
import { getGameJournal, useAppStore } from "../../store";
import { createLibraryTourStore, LIBRARY_TOUR_GAME } from "./libraryTourStore";

beforeEach(() => {
  localStorage.clear();
  useAppStore.setState(useAppStore.getInitialState(), true);
});

it("keeps every practice action out of the real store and persistence, even with the same game ID", () => {
  const realJournal = {
    ...emptyJournal(LIBRARY_TOUR_GAME),
    note: "Real note",
    status: "on-hold" as const,
  };
  useAppStore.setState({
    gameJournals: { [journalKey(LIBRARY_TOUR_GAME)]: realJournal },
  });
  const before = useAppStore.getState();
  const demo = createLibraryTourStore(before.settings);
  expect(demo.getState().settings.libraryGridColumns).toBe(3);
  const shelf = demo.getState().savePersonalShelf({ name: "Weekend" })!;
  demo.getState().updateGameJournal(LIBRARY_TOUR_GAME, {
    note: "Practice note",
    favorite: true,
    shelfIds: [shelf],
  });
  const run = demo.getState().createPlaythrough(LIBRARY_TOUR_GAME, "Co-op")!;
  demo
    .getState()
    .updatePlaythrough(LIBRARY_TOUR_GAME, run, { note: "Run note" });
  demo.getState().assignSessionPlaythrough(-100, run);
  const changes = demo
    .getState()
    .setGameStatuses([LIBRARY_TOUR_GAME], "finished");
  expect(demo.getState().undoGameStatuses(changes)).toBe(1);
  demo.getState().updatePlaythrough(LIBRARY_TOUR_GAME, run, {
    completedAt: new Date().toISOString(),
  });
  demo.getState().deletePlaythrough(LIBRARY_TOUR_GAME, run);
  demo.getState().deletePersonalShelf(shelf);
  demo.setState((state) => ({
    settings: { ...state.settings, libraryShowShelves: false },
  }));
  expect(getGameJournal(demo.getState(), LIBRARY_TOUR_GAME).note).toBe(
    "Practice note",
  );
  expect(useAppStore.getState()).toBe(before);
  expect(getGameJournal(before, LIBRARY_TOUR_GAME)).toEqual(realJournal);
  expect(localStorage.length).toBe(0);
});

it("uses real playthrough behavior: independent notes, reassigned time, and finished active runs", () => {
  const demo = createLibraryTourStore(useAppStore.getState().settings);
  demo
    .getState()
    .updateGameJournal(LIBRARY_TOUR_GAME, { note: "Default reminder" });
  const run = demo.getState().createPlaythrough(LIBRARY_TOUR_GAME, "Co-op")!;
  expect(
    getGameJournal(demo.getState(), LIBRARY_TOUR_GAME).playthroughs[0].note,
  ).toBe("");
  const total = () =>
    demo
      .getState()
      .recentSessions.reduce((sum, s) => sum + (s.durationSeconds ?? 0), 0);
  const before = total();
  expect(demo.getState().assignSessionPlaythrough(-100, run)).toBe(true);
  expect(playthroughSeconds(run, demo.getState().recentSessions, {})).toBe(
    3600,
  );
  expect(total()).toBe(before);
  demo.getState().updatePlaythrough(LIBRARY_TOUR_GAME, run, {
    completedAt: new Date().toISOString(),
  });
  expect(
    getGameJournal(demo.getState(), LIBRARY_TOUR_GAME).activePlaythroughId,
  ).toBeNull();
  expect(demo.getState().recentSessions[0].playthroughId).toBe(run);
});

it("starts a fresh practice library on replay", () => {
  const first = createLibraryTourStore(useAppStore.getState().settings);
  first.getState().createPlaythrough(LIBRARY_TOUR_GAME, "Old practice");
  first.getState().savePersonalShelf({ name: "Old shelf" });
  const next = createLibraryTourStore(useAppStore.getState().settings);
  expect(
    getGameJournal(next.getState(), LIBRARY_TOUR_GAME).playthroughs,
  ).toEqual([]);
  expect(next.getState().personalShelves).toEqual([]);
  expect(next.getState().recentSessions).not.toBe(
    first.getState().recentSessions,
  );
});
