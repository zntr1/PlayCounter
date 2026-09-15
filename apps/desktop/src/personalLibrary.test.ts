import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@playcounter/shared";
import {
  getGameJournal,
  reconcileSessionPlaythroughs,
  useAppStore,
  type ActiveSession,
} from "./store";
import {
  archivePlaythroughSeconds,
  defaultPlaythroughTime,
  emptyJournal,
  journalNote,
  matchesLibraryFilters,
  playthroughSeconds,
  type FilterableLibraryGame,
} from "./personalLibrary";
import {
  createPersistedPayload,
  persistAppState,
  STORAGE_KEY,
} from "./persistence";
import { MAX_STORED_SESSIONS } from "./sessionPersistence";
import { createTransferData } from "./backup";
import { validateBackupData } from "./backupValidation";

const game = {
  gameId: 42,
  source: "igdb" as const,
  igdbId: 123,
  gameName: "Campaign",
};
const other = {
  gameId: 42,
  source: "community" as const,
  gameName: "Different game",
};
const session = (id = 1, playthroughId?: string): Session => ({
  ...game,
  id,
  playthroughId,
  exeName: "game.exe",
  startedAt: new Date(id * 120000).toISOString(),
  endedAt: new Date(id * 120000 + 90000).toISOString(),
  durationSeconds: 90,
});
const initial = useAppStore.getInitialState();
beforeEach(() => {
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: vi.fn((key: string, value: string) => {
      data.set(key, value);
    }),
  });
  useAppStore.setState(initial, true);
});
afterEach(async () => {
  await Promise.resolve();
  vi.unstubAllGlobals();
});

describe("personal game journals", () => {
  it("keeps new and cleared playthrough notes empty while preserving the default note", () => {
    useAppStore
      .getState()
      .updateGameJournal(game, { note: "Default reminder" });
    const id = useAppStore.getState().createPlaythrough(game, "Replay")!;
    const readNote = () =>
      journalNote(getGameJournal(useAppStore.getState(), game));

    expect(readNote()).toBe("");
    useAppStore
      .getState()
      .updatePlaythrough(game, id, { note: "Replay reminder" });
    expect(readNote()).toBe("Replay reminder");
    useAppStore.getState().updatePlaythrough(game, id, { note: "" });
    expect(readNote()).toBe("");

    useAppStore.getState().setActivePlaythrough(game, null);
    expect(readNote()).toBe("Default reminder");
  });

  it("keeps existing and running sessions unchanged when selecting or creating a playthrough", () => {
    const first = useAppStore.getState().createPlaythrough(game, "First run")!;
    const running: ActiveSession = {
      ...session(2, first),
      gameName: game.gameName,
      coverUrl: "",
      checkpointedAt: new Date().toISOString(),
    };
    useAppStore.setState({
      recentSessions: [session(1)],
      activeSessions: [running],
    });
    const second = useAppStore.getState().createPlaythrough(game, "Co-op")!;
    expect(
      getGameJournal(useAppStore.getState(), game).activePlaythroughId,
    ).toBe(second);
    expect(
      useAppStore.getState().recentSessions[0].playthroughId,
    ).toBeUndefined();
    expect(useAppStore.getState().activeSessions[0].playthroughId).toBe(first);
    expect(
      useAppStore.getState().assignSessionPlaythrough(running.id, second),
    ).toBe(true);
    expect(useAppStore.getState().activeSessions[0]).toEqual({
      ...running,
      playthroughId: second,
    });
  });

  it("rejects cross-game assignments even when numeric game ids collide", () => {
    const id = useAppStore
      .getState()
      .createPlaythrough(other, "Other campaign")!;
    useAppStore.setState({ recentSessions: [session()] });
    expect(useAppStore.getState().assignSessionPlaythrough(1, id)).toBe(false);
    expect(useAppStore.getState().recentSessions[0]).toEqual(session());
  });

  it("completes and reopens without moving time; deletion unassigns and keeps game totals", () => {
    const id = useAppStore.getState().createPlaythrough(game, "First run")!;
    useAppStore.setState({
      recentSessions: [session(1, id)],
      archivedSeconds: 600,
      archivedGameSeconds: { "igdb:42": 600 },
      archivedPlaythroughSeconds: { [id]: 600 },
    });
    useAppStore
      .getState()
      .updatePlaythrough(game, id, { completedAt: "2026-09-13T12:00:00Z" });
    expect(
      getGameJournal(useAppStore.getState(), game).activePlaythroughId,
    ).toBeNull();
    useAppStore.getState().setActivePlaythrough(game, id);
    expect(
      getGameJournal(useAppStore.getState(), game).activePlaythroughId,
    ).toBeNull();
    useAppStore.getState().updatePlaythrough(game, id, { completedAt: null });
    useAppStore.getState().setActivePlaythrough(game, id);
    expect(
      playthroughSeconds(
        id,
        useAppStore.getState().recentSessions,
        useAppStore.getState().archivedPlaythroughSeconds,
      ),
    ).toBe(690);
    useAppStore.getState().deletePlaythrough(game, id);
    expect(useAppStore.getState()).toMatchObject({
      archivedSeconds: 600,
      archivedGameSeconds: { "igdb:42": 600 },
      archivedPlaythroughSeconds: {},
      recentSessions: [{ durationSeconds: 90, playthroughId: undefined }],
    });
  });

  it("preserves annotations and playthroughs when provider identities merge or local ids change", () => {
    useAppStore.getState().updateGameJournal(game, { note: "Keep this note" });
    const id = useAppStore.getState().createPlaythrough(game, "First run")!;
    const alias = {
      gameId: -5,
      source: "custom" as const,
      igdbId: 123,
      gameName: game.gameName,
    };
    useAppStore.getState().updateGameJournal(alias, { favorite: true });
    expect(Object.keys(useAppStore.getState().gameJournals)).toEqual([
      "custom:-5",
    ]);
    expect(getGameJournal(useAppStore.getState(), game)).toMatchObject({
      note: "Keep this note",
      favorite: true,
      playthroughs: [{ id }],
    });
    useAppStore.getState().rekeyGameSeconds("custom:-5", "community:99");
    expect(
      getGameJournal(useAppStore.getState(), {
        gameId: 99,
        source: "community",
      }),
    ).toMatchObject({
      note: "Keep this note",
      favorite: true,
      playthroughs: [{ id }],
    });
  });

  it("unassigns sessions moved to another game by a partial match correction", () => {
    const id = useAppStore.getState().createPlaythrough(game, "First run")!;
    const original = session(1, id);
    const corrected = { ...session(2, id), ...other, igdbId: undefined };
    useAppStore.setState({ recentSessions: [original, corrected] });
    const result = reconcileSessionPlaythroughs(useAppStore.getState());
    expect(result.recentSessions).toEqual([
      original,
      { ...corrected, playthroughId: undefined },
    ]);
  });

  it("removes shelf memberships when deleting a shelf without removing annotations", () => {
    const shelf = useAppStore
      .getState()
      .savePersonalShelf({ name: "Weekend" })!;
    useAppStore
      .getState()
      .updateGameJournal(game, { note: "Next quest", shelfIds: [shelf] });
    useAppStore.getState().deletePersonalShelf(shelf);
    expect(getGameJournal(useAppStore.getState(), game)).toMatchObject({
      note: "Next quest",
      shelfIds: [],
    });
  });

  it("persists only game identity, never device fields passed by a library card", () => {
    useAppStore.getState().updateGameJournal(
      {
        ...game,
        libraryImports: [{ installPath: "C:/Private/Library" }],
        exePath: "C:/Private/Game.exe",
      } as typeof game,
      { note: "Private note" },
    );
    const saved = createPersistedPayload(useAppStore.getState());
    expect(JSON.stringify(saved.gameJournals)).not.toContain("Private/Library");
    expect(JSON.stringify(saved.gameJournals)).not.toContain("exePath");
  });
});

describe("bulk progress status", () => {
  it("saves a batch once, resolves duplicate identities, and preserves journals and time", async () => {
    const state = useAppStore.getState();
    const shelfId = state.savePersonalShelf({ name: "Weekend" })!;
    state.updateGameJournal(game, {
      note: "Keep",
      favorite: true,
      shelfIds: [shelfId],
    });
    const run = state.createPlaythrough(game, "Replay")!;
    state.updateGameJournal(other, { status: "finished" });
    useAppStore.setState({ recentSessions: [session(1, run)] });
    const before = getGameJournal(useAppStore.getState(), game);
    const sessionsBefore = useAppStore.getState().recentSessions;
    await Promise.resolve();
    vi.mocked(localStorage.setItem).mockClear();
    const listener = vi.fn();
    const unsubscribe = useAppStore.subscribe(listener);
    const alias = { ...game, gameId: -5, source: "custom" as const };
    const changes = state.setGameStatuses([game, alias, other], "finished");
    expect(changes).toEqual([
      { game: before.game, before: null, after: "finished" },
    ]);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    await Promise.resolve();
    expect(localStorage.setItem).toHaveBeenCalledTimes(1);
    expect(getGameJournal(useAppStore.getState(), alias)).toEqual({
      ...before,
      game: expect.objectContaining(alias),
      status: "finished",
    });
    expect(useAppStore.getState().recentSessions).toEqual(sessionsBefore);
    expect(Object.keys(useAppStore.getState().gameJournals)).toHaveLength(2);
    expect(
      JSON.parse(localStorage.getItem(STORAGE_KEY)!).gameJournals["igdb:42"]
        .status,
    ).toBe("finished");
  });

  it("assigns the requested status consistently and clears it only explicitly", async () => {
    const state = useAppStore.getState();
    state.setGameStatuses([game, other], "finished");
    const journals = useAppStore.getState().gameJournals;
    await Promise.resolve();
    vi.mocked(localStorage.setItem).mockClear();
    expect(state.setGameStatuses([game, other], "finished")).toEqual([]);
    expect(useAppStore.getState().gameJournals).toBe(journals);
    await Promise.resolve();
    expect(localStorage.setItem).not.toHaveBeenCalled();
    const changes = state.setGameStatuses([game, other], null);
    expect(changes).toHaveLength(2);
    expect(getGameJournal(useAppStore.getState(), game).status).toBeNull();
    expect(state.undoGameStatuses(changes)).toBe(2);
    expect(getGameJournal(useAppStore.getState(), other).status).toBe(
      "finished",
    );
  });

  it("consolidates previously separate journals when their game identities become linked", () => {
    const alias = { ...game, gameId: -5, source: "custom" as const };
    useAppStore.setState({
      gameJournals: {
        "igdb:42": {
          ...emptyJournal(game),
          status: "finished",
          note: "Original note",
        },
        "custom:-5": {
          ...emptyJournal(alias),
          status: "on-hold",
          note: "Import note",
          favorite: true,
        },
      },
    });
    useAppStore.getState().setGameStatuses([game, alias], "finished");
    expect(Object.keys(useAppStore.getState().gameJournals)).toEqual([
      "igdb:42",
    ]);
    expect(getGameJournal(useAppStore.getState(), alias)).toMatchObject({
      status: "finished",
      favorite: true,
      note: "Original note\n\nImport note",
    });
  });

  it("undoes just the batch statuses and skips subsequent status changes or removed journals", () => {
    const state = useAppStore.getState();
    const removed = { ...game, gameId: 80, igdbId: 800 };
    state.updateGameJournal(game, { status: "on-hold" });
    const changes = state.setGameStatuses([game, other, removed], "finished");
    state.updateGameJournal(game, {
      note: "Written after the batch",
      favorite: true,
    });
    state.updateGameJournal(other, { status: "playing" });
    const journals = { ...useAppStore.getState().gameJournals };
    delete journals["igdb:80"];
    useAppStore.setState({ gameJournals: journals });
    expect(state.undoGameStatuses(changes)).toBe(1);
    expect(getGameJournal(useAppStore.getState(), game)).toMatchObject({
      status: "on-hold",
      note: "Written after the batch",
      favorite: true,
    });
    expect(getGameJournal(useAppStore.getState(), other).status).toBe(
      "playing",
    );
    expect(useAppStore.getState().gameJournals["igdb:80"]).toBeUndefined();
    expect(state.undoGameStatuses(changes)).toBe(0);
  });
});

describe("durable playthrough time", () => {
  it("keeps default time through the session cap and returns deleted playthrough time to it", () => {
    const readDefault = () => {
      const state = useAppStore.getState();
      return defaultPlaythroughTime(
        getGameJournal(state, game),
        state.recentSessions,
        state.archivedGameSeconds["igdb:42"] ?? 0,
        state.archivedPlaythroughSeconds,
      );
    };
    useAppStore.setState({
      recentSessions: Array.from({ length: MAX_STORED_SESSIONS }, (_, i) =>
        session(i + 1),
      ),
    });
    const initialSeconds = MAX_STORED_SESSIONS * 90;
    expect(readDefault().seconds).toBe(initialSeconds);
    const replay = useAppStore.getState().createPlaythrough(game, "Replay")!;
    expect(readDefault().seconds).toBe(initialSeconds);
    useAppStore.getState().addSession(session(MAX_STORED_SESSIONS + 1, replay));
    expect(readDefault()).toEqual({
      seconds: initialSeconds,
      archivedSeconds: 90,
    });
    useAppStore.setState({
      archivedSeconds: 590,
      archivedGameSeconds: { "igdb:42": 590 },
      archivedPlaythroughSeconds: { [replay]: 500 },
    });
    expect(readDefault()).toEqual({
      seconds: initialSeconds,
      archivedSeconds: 90,
    });
    useAppStore.getState().deletePlaythrough(game, replay);
    expect(readDefault()).toEqual({
      seconds: initialSeconds + 590,
      archivedSeconds: 590,
    });
    expect(
      useAppStore.getState().recentSessions.every((s) => !s.playthroughId),
    ).toBe(true);
    const data = createTransferData(
      createPersistedPayload(useAppStore.getState()),
    );
    expect(() => validateBackupData(data, "data")).not.toThrow();
    expect(data.sessions).toEqual(useAppStore.getState().recentSessions);
  });

  it("keeps totals through the session cap and storage quota fallback", () => {
    const id = useAppStore.getState().createPlaythrough(game, "First run")!;
    const history = Array.from({ length: MAX_STORED_SESSIONS }, (_, i) =>
      session(i + 1, id),
    );
    useAppStore.setState({ recentSessions: history });
    useAppStore.getState().addSession(session(MAX_STORED_SESSIONS + 1, id));
    let state = useAppStore.getState();
    expect(state.archivedPlaythroughSeconds[id]).toBe(90);
    expect(
      playthroughSeconds(
        id,
        state.recentSessions,
        state.archivedPlaythroughSeconds,
      ),
    ).toBe((MAX_STORED_SESSIONS + 1) * 90);
    vi.mocked(localStorage.setItem).mockImplementationOnce(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    const result = persistAppState(state);
    expect(result.status).toBe("trimmed");
    expect(
      playthroughSeconds(
        id,
        result.sessions,
        result.archivedPlaythroughSeconds,
      ),
    ).toBe((MAX_STORED_SESSIONS + 1) * 90);
    expect(
      JSON.parse(localStorage.getItem(STORAGE_KEY)!).archivedPlaythroughSeconds[
        id
      ],
    ).toBe(result.archivedPlaythroughSeconds[id]);
  });

  it("archives overflow passed directly to persistence rather than losing the excess time", () => {
    const id = useAppStore.getState().createPlaythrough(game, "First run")!;
    useAppStore.setState({
      recentSessions: Array.from({ length: MAX_STORED_SESSIONS + 3 }, (_, i) =>
        session(i + 1, id),
      ),
    });
    const payload = createPersistedPayload(useAppStore.getState());
    expect(payload.sessions).toHaveLength(MAX_STORED_SESSIONS);
    expect(payload.archivedPlaythroughSeconds[id]).toBe(270);
    expect(payload.archivedSeconds).toBe(270);
  });

  it("transfers complete journals in backups and rejects broken references", () => {
    const id = useAppStore.getState().createPlaythrough(game, "First run")!;
    useAppStore.getState().updateGameJournal(game, { status: "not-planned" });
    useAppStore.getState().savePersonalShelf({
      name: "Not planned",
      filters: { status: "not-planned" },
    });
    useAppStore
      .getState()
      .updatePlaythrough(game, id, { note: "Northern ruins" });
    useAppStore.setState({
      recentSessions: [session(1, id)],
      archivedPlaythroughSeconds: archivePlaythroughSeconds({}, [
        session(2, id),
      ]),
    });
    const data = createTransferData(
      createPersistedPayload(useAppStore.getState()),
    );
    expect(() => validateBackupData(data, "data")).not.toThrow();
    expect(data.gameJournals).toEqual(useAppStore.getState().gameJournals);
    expect(data.personalShelves).toEqual(
      useAppStore.getState().personalShelves,
    );
    // Backups from before shelf pinning was removed still import normally.
    expect(() =>
      validateBackupData(
        {
          ...data,
          personalShelves: useAppStore
            .getState()
            .personalShelves.map((shelf) => ({ ...shelf, pinned: true })),
        },
        "data",
      ),
    ).not.toThrow();
    expect(() =>
      validateBackupData(
        { ...data, sessions: [session(1, "missing")] },
        "data",
      ),
    ).toThrow("playthroughId");
    expect(() =>
      validateBackupData(
        { ...data, archivedPlaythroughSeconds: { missing: 90 } },
        "data",
      ),
    ).toThrow("archivedPlaythroughSeconds");
    expect(() => validateBackupData({}, "data")).not.toThrow();
  });
});

describe("saved library filters", () => {
  const candidate: FilterableLibraryGame = {
    name: "RPG",
    totalSeconds: 0,
    lastPlayedAt: "",
    emulatorIds: ["pcsx2"],
    libraryImports: [
      { provider: "xbox", installed: true, entry: { providerSeconds: null } },
    ],
  };
  it("filters unassigned games and retains the No status rule in saved shelves and backups", () => {
    const journal = emptyJournal(game);
    expect(matchesLibraryFilters(candidate, journal, { status: "none" })).toBe(
      true,
    );
    expect(
      matchesLibraryFilters(
        candidate,
        { ...journal, status: "not-planned" },
        { status: "none" },
      ),
    ).toBe(false);
    useAppStore.getState().savePersonalShelf({
      name: "Unsorted",
      filters: { status: "none", source: "xbox" },
    });
    const data = createTransferData(
      createPersistedPayload(useAppStore.getState()),
    );
    expect(data.personalShelves).toEqual([
      expect.objectContaining({ filters: { status: "none", source: "xbox" } }),
    ]);
    expect(() => validateBackupData(data, "data")).not.toThrow();
    expect(() =>
      validateBackupData(
        {
          ...data,
          gameJournals: { "igdb:42": { ...journal, status: "none" } },
        },
        "data",
      ),
    ).toThrow("status");
  });
  it("does not call unknown provider time unplayed", () => {
    expect(
      matchesLibraryFilters(candidate, emptyJournal(game), {
        installed: true,
        played: "unplayed",
      }),
    ).toBe(false);
    const known = {
      ...candidate,
      libraryImports: [
        { provider: "steam", installed: true, entry: { providerSeconds: 0 } },
      ],
    };
    expect(
      matchesLibraryFilters(known, emptyJournal(game), {
        installed: true,
        played: "unplayed",
      }),
    ).toBe(true);
  });
  it("excludes never-played games from old last-played filters and combines rules", () => {
    const now = Date.parse("2026-09-13T12:00:00Z");
    const journal = {
      ...emptyJournal(game),
      favorite: true,
      status: "on-hold" as const,
    };
    expect(
      matchesLibraryFilters(candidate, journal, { lastPlayedDays: 180 }, now),
    ).toBe(false);
    const played = {
      ...candidate,
      totalSeconds: 3600,
      lastPlayedAt: "2025-01-01T12:00:00Z",
    };
    expect(
      matchesLibraryFilters(
        { ...played, hasLastPlayedEvidence: false },
        journal,
        { lastPlayedDays: 180 },
        now,
      ),
    ).toBe(false);
    expect(
      matchesLibraryFilters(
        played,
        journal,
        {
          favorite: true,
          status: "on-hold",
          lastPlayedDays: 180,
          emulator: "pcsx2",
          source: "xbox",
        },
        now,
      ),
    ).toBe(true);
    expect(
      matchesLibraryFilters(played, journal, { source: "steam" }, now),
    ).toBe(false);
  });
});
