import type { StoreApi } from "zustand";
import {
  getGameJournal,
  personalGameIdentity,
  type AppState,
  type GameIdentityRef,
} from "./store";
import {
  COUNTER_LIMIT,
  COUNTER_NAME_LIMIT,
  DEATHS_COUNTER_ID,
  archiveWithoutCounter,
  archivedCountsToDefault,
  changedCounts,
  counterName,
  gameArchiveKeys,
  journalCounters,
  sameCounterName,
  withCounts,
  withoutCounter,
  type GameCounter,
} from "./counters";
import {
  NAME_LIMIT,
  NOTE_LIMIT,
  SESSION_NOTE_LIMIT,
  addJournalGamesToShelf,
  normalizeLibraryFilters,
  updateJournalStatuses,
  writeJournal,
} from "./personalLibrary";

export type PersonalLibraryActions = Pick<
  AppState,
  | "openGameJournal"
  | "updateGameJournal"
  | "setGameTier"
  | "addGamesToShelf"
  | "setGameStatuses"
  | "undoGameStatuses"
  | "createPlaythrough"
  | "updatePlaythrough"
  | "setActivePlaythrough"
  | "deletePlaythrough"
  | "assignSessionPlaythrough"
  | "setSessionNote"
  | "changeSessionCount"
  | "addGameCounter"
  | "updateGameCounter"
  | "setControllerCounter"
  | "deleteGameCounter"
  | "savePersonalShelf"
  | "deletePersonalShelf"
>;

export type PersonalLibraryState = PersonalLibraryActions &
  Pick<
    AppState,
    | "gameJournals"
    | "personalShelves"
    | "archivedPlaythroughSeconds"
    | "archivedCounts"
    | "journalTarget"
    | "recentSessions"
    | "activeSessions"
    | "gameMetadata"
    | "exeCache"
    | "libraryImports"
    | "archivedGameSeconds"
    | "archivedConsoleSeconds"
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
    setGameTier: (game, tier) => {
      const state = get();
      const {
        tier: _tier,
        tierAt: _tierAt,
        ...journal
      } = getGameJournal(state, game);
      set({
        gameJournals: writeJournal(
          state.gameJournals,
          tier
            ? { ...journal, tier, tierAt: new Date().toISOString() }
            : journal,
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
        archivedCounts: archivedCountsToDefault(state.archivedCounts, id),
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
    setSessionNote: (sessionId, note) => {
      const state = get();
      const text = note.slice(0, SESSION_NOTE_LIMIT).trim() || undefined;
      const write = <T extends { id: number; note?: string }>(
        sessions: T[],
      ): T[] =>
        sessions.map((s) => {
          if (s.id !== sessionId || s.note === text) return s;
          const { note: _note, ...rest } = s;
          return (text ? { ...rest, note: text } : rest) as T;
        });
      const found = [...state.activeSessions, ...state.recentSessions].some(
        (s) => s.id === sessionId,
      );
      if (!found) return false;
      const activeSessions = write(state.activeSessions);
      const recentSessions = write(state.recentSessions);
      if (
        activeSessions.some((s, i) => s !== state.activeSessions[i]) ||
        recentSessions.some((s, i) => s !== state.recentSessions[i])
      ) {
        set({ activeSessions, recentSessions });
        persistSoon();
      }
      return true;
    },
    changeSessionCount: (sessionId, counterId, delta) => {
      const state = get();
      const session = state.activeSessions.find((s) => s.id === sessionId);
      if (
        !session ||
        !journalCounters(getGameJournal(state, session)).some(
          (c) => c.id === counterId,
        )
      )
        return null;
      const counts = changedCounts(session.counts, counterId, delta);
      const changed = withCounts(session, counts);
      // "Take one back" takes from the counter counted last.
      if (delta > 0) changed.lastCounterId = counterId;
      set({
        activeSessions: state.activeSessions.map((s) =>
          s.id === sessionId ? changed : s,
        ),
      });
      persistSoon();
      return counts?.[counterId] ?? 0;
    },
    addGameCounter: (game, name) => {
      const normalized = name.trim().slice(0, COUNTER_NAME_LIMIT);
      if (!normalized) return null;
      const state = get();
      const journal = getGameJournal(state, game);
      const counters = journalCounters(journal);
      if (
        counters.length >= COUNTER_LIMIT ||
        counters.some((c) => sameCounterName(counterName(c), normalized))
      )
        return null;
      const id = crypto.randomUUID();
      set({
        gameJournals: writeJournal(
          state.gameJournals,
          {
            ...journal,
            counters: [
              ...counters,
              {
                id,
                name: normalized,
                shown: true,
                createdAt: new Date().toISOString(),
              },
            ],
          },
          personalGameIdentity(state),
        ),
      });
      persistSoon();
      return id;
    },
    updateGameCounter: (game, counterId, patch) => {
      const state = get();
      const journal = getGameJournal(state, game);
      const counters = journalCounters(journal);
      const counter = counters.find((c) => c.id === counterId);
      if (!counter) return false;
      const name = patch.name?.trim().slice(0, COUNTER_NAME_LIMIT);
      if (patch.name !== undefined) {
        if (!name) return false;
        if (
          counters.some(
            (c) => c.id !== counterId && sameCounterName(counterName(c), name),
          )
        )
          return false;
      }
      const next: GameCounter = {
        ...counter,
        ...(name !== undefined ? { name } : {}),
        ...(patch.shown !== undefined ? { shown: patch.shown } : {}),
      };
      if (patch.key !== undefined) {
        delete next.key;
        if (patch.key) next.key = patch.key;
      }
      set({
        gameJournals: writeJournal(
          state.gameJournals,
          {
            ...journal,
            counters: counters.map((c) => (c.id === counterId ? next : c)),
          },
          personalGameIdentity(state),
        ),
      });
      persistSoon();
      return true;
    },
    setControllerCounter: (game, counterId) => {
      const state = get();
      const journal = getGameJournal(state, game);
      if (
        counterId !== null &&
        !journalCounters(journal).some((c) => c.id === counterId)
      )
        return;
      set({
        gameJournals: writeJournal(
          state.gameJournals,
          { ...journal, controllerCounterId: counterId },
          personalGameIdentity(state),
        ),
      });
      persistSoon();
    },
    deleteGameCounter: (game, counterId) => {
      const state = get();
      const identity = personalGameIdentity(state);
      const journal = getGameJournal(state, game);
      const counters = journalCounters(journal);
      if (!counters.some((c) => c.id === counterId)) return;
      const gameKey = identity(game);
      // Only this game's counts go: another game's Deaths has the same id.
      const strip = <
        T extends GameIdentityRef & {
          counts?: Record<string, number>;
          lastCounterId?: string;
        },
      >(
        sessions: T[],
      ): T[] =>
        sessions.map((s) => {
          if (identity(s) !== gameKey || !s.counts?.[counterId]) return s;
          const next = withCounts(s, withoutCounter(s.counts, counterId));
          if (next.lastCounterId === counterId) delete next.lastCounterId;
          return next;
        });
      set({
        gameJournals: writeJournal(
          state.gameJournals,
          {
            ...journal,
            counters: counters.filter((c) => c.id !== counterId),
            // The controller's counter went with it: none until one is picked.
            ...(journal.controllerCounterId === counterId ||
            (journal.controllerCounterId === undefined &&
              counterId === DEATHS_COUNTER_ID)
              ? { controllerCounterId: null }
              : {}),
          },
          identity,
        ),
        activeSessions: strip(state.activeSessions),
        recentSessions: strip(state.recentSessions),
        archivedCounts: archiveWithoutCounter(
          state.archivedCounts,
          gameArchiveKeys(state.archivedCounts, game, identity),
          counterId,
        ),
      });
      persistSoon();
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
