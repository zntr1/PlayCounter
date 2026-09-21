import type { StoreApi } from "zustand";
import { getGameJournal, personalGameIdentity, type AppState } from "./store";
import {
  NAME_LIMIT,
  NOTE_LIMIT,
  addJournalGamesToShelf,
  normalizeLibraryFilters,
  updateJournalStatuses,
  writeJournal,
} from "./personalLibrary";

export type PersonalLibraryActions = Pick<
  AppState,
  | "openGameJournal"
  | "updateGameJournal"
  | "addGamesToShelf"
  | "setGameStatuses"
  | "undoGameStatuses"
  | "createPlaythrough"
  | "updatePlaythrough"
  | "setActivePlaythrough"
  | "deletePlaythrough"
  | "assignSessionPlaythrough"
  | "savePersonalShelf"
  | "deletePersonalShelf"
>;

export type PersonalLibraryState = PersonalLibraryActions &
  Pick<
    AppState,
    | "gameJournals"
    | "personalShelves"
    | "archivedPlaythroughSeconds"
    | "journalTarget"
    | "recentSessions"
    | "activeSessions"
    | "gameMetadata"
    | "exeCache"
    | "libraryImports"
    | "archivedGameSeconds"
    | "playtimeAdjustments"
    | "settings"
    | "activeView"
    | "addToast"
  >;

// Both the library and the tutorial use the same actions. The tutorial supplies
// its own store and a no-op save callback; sample data never enters app storage.
export function createPersonalLibraryActions(
  set: StoreApi<PersonalLibraryState>["setState"],
  get: () => PersonalLibraryState,
  persistSoon: () => void,
): PersonalLibraryActions {
  return {
    openGameJournal: (journalTarget) => set({ journalTarget }),
    updateGameJournal: (game, patch) => {
      const state = get();
      const journal = getGameJournal(state, game);
      set({
        gameJournals: writeJournal(
          state.gameJournals,
          {
            ...journal,
            ...patch,
            note:
              patch.note === undefined
                ? journal.note
                : patch.note
                    .slice(0, Math.max(NOTE_LIMIT, journal.note.length))
                    .trim(),
            shelfIds:
              patch.shelfIds === undefined
                ? journal.shelfIds
                : [...new Set(patch.shelfIds)].filter((id) =>
                    state.personalShelves.some(
                      (s) =>
                        s.id === id &&
                        (!s.filters || journal.shelfIds.includes(id)),
                    ),
                  ),
          },
          personalGameIdentity(state),
        ),
      });
      persistSoon();
    },
    addGamesToShelf: (games, shelfId) => {
      const state = get();
      if (shelfId !== "favorites") {
        const shelf = state.personalShelves.find(
          (entry) => entry.id === shelfId,
        );
        if (!shelf || shelf.filters) return 0;
      }
      const result = addJournalGamesToShelf(
        state.gameJournals,
        games,
        shelfId,
        personalGameIdentity(state),
      );
      if (result.journals !== state.gameJournals) {
        set({ gameJournals: result.journals });
        persistSoon();
      }
      return result.added;
    },
    setGameStatuses: (games, status) => {
      const state = get();
      const result = updateJournalStatuses(
        state.gameJournals,
        games.map((game) => ({ game, status })),
        personalGameIdentity(state),
      );
      if (result.journals !== state.gameJournals) {
        set({ gameJournals: result.journals });
        persistSoon();
      }
      return result.changes;
    },
    undoGameStatuses: (changes) => {
      const state = get();
      const result = updateJournalStatuses(
        state.gameJournals,
        changes.map(({ game, before, after }) => ({
          game,
          status: before,
          expectedStatus: after,
        })),
        personalGameIdentity(state),
      );
      if (result.journals !== state.gameJournals) {
        set({ gameJournals: result.journals });
        persistSoon();
      }
      return result.changes.length;
    },
    createPlaythrough: (game, name) => {
      const normalized = name.trim().slice(0, NAME_LIMIT);
      if (!normalized) return null;
      const state = get();
      const journal = getGameJournal(state, game);
      const id = crypto.randomUUID();
      const playthrough = {
        id,
        name: normalized,
        note: "",
        createdAt: new Date().toISOString(),
        completedAt: null,
      };
      set({
        gameJournals: writeJournal(
          state.gameJournals,
          {
            ...journal,
            playthroughs: [...journal.playthroughs, playthrough],
            activePlaythroughId: id,
          },
          personalGameIdentity(state),
        ),
      });
      persistSoon();
      return id;
    },
    updatePlaythrough: (game, id, patch) => {
      const state = get();
      const journal = getGameJournal(state, game);
      if (!journal.playthroughs.some((p) => p.id === id)) return;
      if (patch.completedAt && !Number.isFinite(Date.parse(patch.completedAt)))
        return;
      const name = patch.name?.trim().slice(0, NAME_LIMIT);
      if (patch.name !== undefined && !name) return;
      set({
        gameJournals: writeJournal(
          state.gameJournals,
          {
            ...journal,
            activePlaythroughId:
              patch.completedAt && journal.activePlaythroughId === id
                ? null
                : journal.activePlaythroughId,
            playthroughs: journal.playthroughs.map((p) =>
              p.id === id
                ? {
                    ...p,
                    ...patch,
                    name: name ?? p.name,
                    note:
                      patch.note === undefined
                        ? p.note
                        : patch.note.slice(0, NOTE_LIMIT).trim(),
                  }
                : p,
            ),
          },
          personalGameIdentity(state),
        ),
      });
      persistSoon();
    },
    setActivePlaythrough: (game, id) => {
      const state = get();
      const journal = getGameJournal(state, game);
      if (
        id !== null &&
        !journal.playthroughs.some((p) => p.id === id && !p.completedAt)
      )
        return;
      set({
        gameJournals: writeJournal(
          state.gameJournals,
          { ...journal, activePlaythroughId: id },
          personalGameIdentity(state),
        ),
      });
      persistSoon();
    },
    deletePlaythrough: (game, id) => {
      const state = get();
      const journal = getGameJournal(state, game);
      if (!journal.playthroughs.some((p) => p.id === id)) return;
      const archivedPlaythroughSeconds = {
        ...state.archivedPlaythroughSeconds,
      };
      delete archivedPlaythroughSeconds[id];
      const moveToDefault = <T extends { playthroughId?: string }>(
        session: T,
      ): T =>
        session.playthroughId === id
          ? { ...session, playthroughId: undefined }
          : session;
      set({
        gameJournals: writeJournal(
          state.gameJournals,
          {
            ...journal,
            activePlaythroughId:
              journal.activePlaythroughId === id
                ? null
                : journal.activePlaythroughId,
            playthroughs: journal.playthroughs.filter((p) => p.id !== id),
          },
          personalGameIdentity(state),
        ),
        archivedPlaythroughSeconds,
        recentSessions: state.recentSessions.map(moveToDefault),
        activeSessions: state.activeSessions.map(moveToDefault),
      });
      persistSoon();
    },
    assignSessionPlaythrough: (sessionId, id) => {
      const state = get();
      const session =
        state.activeSessions.find((s) => s.id === sessionId) ??
        state.recentSessions.find((s) => s.id === sessionId);
      if (
        !session ||
        (id !== null &&
          !getGameJournal(state, session).playthroughs.some((p) => p.id === id))
      )
        return false;
      const assign = <T extends { id: number; playthroughId?: string }>(
        sessions: T[],
      ): T[] =>
        sessions.some(
          (s) => s.id === sessionId && (s.playthroughId ?? null) !== id,
        )
          ? sessions.map((s) =>
              s.id === sessionId ? { ...s, playthroughId: id ?? undefined } : s,
            )
          : sessions;
      const activeSessions = assign(state.activeSessions);
      const recentSessions = assign(state.recentSessions);
      if (
        activeSessions === state.activeSessions &&
        recentSessions === state.recentSessions
      )
        return true;
      set({
        activeSessions,
        recentSessions,
      });
      persistSoon();
      return true;
    },
    savePersonalShelf: (shelf) => {
      const name = shelf.name.trim().slice(0, NAME_LIMIT);
      if (!name) return null;
      const id = shelf.id ?? crypto.randomUUID();
      const state = get();
      const next = {
        ...state.personalShelves.find((saved) => saved.id === id),
        ...shelf,
        id,
        name,
        filters:
          shelf.filters === undefined
            ? undefined
            : normalizeLibraryFilters(shelf.filters),
      };
      set({
        personalShelves: state.personalShelves.some((s) => s.id === id)
          ? state.personalShelves.map((s) => (s.id === id ? next : s))
          : [...state.personalShelves, next],
      });
      persistSoon();
      return id;
    },
    deletePersonalShelf: (id) => {
      const state = get();
      set({
        personalShelves: state.personalShelves.filter((s) => s.id !== id),
        gameJournals: Object.fromEntries(
          Object.entries(state.gameJournals).map(([key, journal]) => [
            key,
            { ...journal, shelfIds: journal.shelfIds.filter((s) => s !== id) },
          ]),
        ),
      });
      persistSoon();
    },
  };
}
