import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@playcounter/shared";
import {
  controllerCounterId,
  counterName,
  counterTallies,
  gameArchivedCounts,
  orderedCounters,
  sanitizeArchivedCounts,
  sanitizeGameCounters,
} from "./counters";
import { applyLanguage } from "./i18n";
import { emptyJournal, mergeJournals } from "./personalLibrary";
import { createPersistedPayload, persistAppState } from "./persistence";
import { combineSessions, splitSession } from "./sessionEdits";
import { MAX_STORED_SESSIONS } from "./sessionPersistence";
import { createTransferData } from "./backup";
import { validateBackupData } from "./backupValidation";
import {
  getGameJournal,
  personalGameIdentity,
  useAppStore,
  type ActiveSession,
} from "./store";

/* docs/counters-plan.md: the sentences under "Tests", with Elden Ring and the
   counters a souls player keeps: Deaths, then one per boss. */

const eldenRing = {
  gameId: 119133,
  source: "igdb" as const,
  igdbId: 119133,
  gameName: "Elden Ring",
  coverUrl: "",
};
const stardew = {
  gameId: 17000,
  source: "igdb" as const,
  igdbId: 17000,
  gameName: "Stardew Valley",
  coverUrl: "",
};
const HOUR = 3_600_000;
const finished = (
  id: number,
  counts?: Record<string, number>,
  extra: Partial<Session> = {},
): Session => ({
  ...eldenRing,
  id,
  exeName: "eldenring.exe",
  startedAt: new Date(Date.UTC(2026, 10, 1) + id * HOUR).toISOString(),
  endedAt: new Date(Date.UTC(2026, 10, 1) + id * HOUR + 50 * 60_000).toISOString(),
  durationSeconds: 50 * 60,
  ...(counts ? { counts } : {}),
  ...extra,
});
const running = (counts?: Record<string, number>): ActiveSession => ({
  ...eldenRing,
  id: 999_999,
  exeName: "eldenring.exe",
  startedAt: "2026-11-08T19:00:00.000Z",
  checkpointedAt: "2026-11-08T19:40:00.000Z",
  ...(counts ? { counts } : {}),
});

const initial = useAppStore.getInitialState();
beforeEach(() => {
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: vi.fn((key: string, value: string) => data.set(key, value)),
  });
  useAppStore.setState(initial, true);
});
afterEach(() => {
  applyLanguage("en");
  vi.unstubAllGlobals();
});

function tallies(playthroughId: string | null = null, sessionId?: number) {
  const state = useAppStore.getState();
  const identity = personalGameIdentity(state);
  const key = identity(eldenRing);
  return counterTallies({
    sessions: [...state.recentSessions, ...state.activeSessions].filter(
      (session) => identity(session) === key,
    ),
    archived: gameArchivedCounts(state.archivedCounts, eldenRing, identity),
    playthroughId,
    sessionId,
  });
}

describe("a new game", () => {
  it("starts with Deaths, shown, without a key, with the controller icon", () => {
    const journal = getGameJournal(useAppStore.getState(), eldenRing);
    expect(orderedCounters(journal)).toEqual([
      expect.objectContaining({ id: "deaths", shown: true }),
    ]);
    expect(orderedCounters(journal)[0].key).toBeUndefined();
    expect(controllerCounterId(journal)).toBe("deaths");
  });

  it("names Deaths in the app's language until it is renamed; an own counter keeps its name", () => {
    const store = useAppStore.getState();
    const malenia = store.addGameCounter(eldenRing, "Malenia")!;
    applyLanguage("de");
    const counters = () =>
      orderedCounters(getGameJournal(useAppStore.getState(), eldenRing));
    const names = () =>
      Object.fromEntries(counters().map((c) => [c.id, counterName(c)]));
    expect(names()).toEqual({ deaths: "Tode", [malenia]: "Malenia" });
    store.updateGameCounter(eldenRing, "deaths", { name: "Tries" });
    applyLanguage("en");
    expect(names().deaths).toBe("Tries");
  });
});

describe("counting on the running session", () => {
  it("never goes below 0: Take one back at 0 in this session stays 0, whatever the playthrough has", () => {
    useAppStore.setState({
      recentSessions: [finished(1, { deaths: 40 })],
      activeSessions: [running()],
    });
    const store = useAppStore.getState();
    expect(store.changeSessionCount(999_999, "deaths", -1)).toBe(0);
    expect(useAppStore.getState().activeSessions[0].counts).toBeUndefined();
    expect(store.changeSessionCount(999_999, "deaths", 1)).toBe(1);
    expect(tallies(null, 999_999).get("deaths")).toMatchObject({
      session: 1,
      playthrough: 41,
      all: 41,
    });
  });

  it("refuses a counter the game doesn't have", () => {
    useAppStore.setState({ activeSessions: [running()] });
    expect(
      useAppStore.getState().changeSessionCount(999_999, "malenia", 1),
    ).toBeNull();
  });
});

describe("counters of a game", () => {
  it("are ordered the same everywhere: shown, then hidden, newest first", () => {
    vi.useFakeTimers();
    const store = useAppStore.getState();
    vi.setSystemTime(Date.UTC(2026, 10, 2));
    const margit = store.addGameCounter(eldenRing, "Margit")!;
    vi.setSystemTime(Date.UTC(2026, 10, 3));
    const rageQuits = store.addGameCounter(eldenRing, "Rage quits")!;
    vi.setSystemTime(Date.UTC(2026, 10, 7));
    const malenia = store.addGameCounter(eldenRing, "Malenia")!;
    vi.useRealTimers();
    store.updateGameCounter(eldenRing, margit, { shown: false });
    const order = () =>
      orderedCounters(getGameJournal(useAppStore.getState(), eldenRing)).map(
        (c) => c.id,
      );
    expect(order()).toEqual([malenia, rageQuits, "deaths", margit]);
    // After the fight: Malenia's eye off, she goes down with the hidden.
    store.updateGameCounter(eldenRing, malenia, { shown: false });
    expect(order()).toEqual([rageQuits, "deaths", malenia, margit]);
  });

  it("give the controller icon to one counter at a time (Phil's call)", () => {
    const store = useAppStore.getState();
    const malenia = store.addGameCounter(eldenRing, "Malenia")!;
    const controller = () =>
      controllerCounterId(getGameJournal(useAppStore.getState(), eldenRing));
    expect(controller()).toBe("deaths");
    store.setControllerCounter(eldenRing, malenia);
    expect(controller()).toBe(malenia);
    store.setControllerCounter(eldenRing, null);
    expect(controller()).toBeNull();
    store.setControllerCounter(eldenRing, malenia);
    store.deleteGameCounter(eldenRing, malenia);
    expect(controller()).toBeNull();
    // Another game's icon stays where it was.
    expect(
      controllerCounterId(getGameJournal(useAppStore.getState(), stardew)),
    ).toBe("deaths");
  });

  it("can't share a name, in any case", () => {
    const store = useAppStore.getState();
    expect(store.addGameCounter(eldenRing, "Malenia")).toBeTruthy();
    expect(store.addGameCounter(eldenRing, "  malenia ")).toBeNull();
    expect(store.addGameCounter(eldenRing, "deaths")).toBeNull();
    // Another game may have its own Malenia.
    expect(store.addGameCounter(stardew, "Malenia")).toBeTruthy();
  });

  it("deleting one removes its counts from this game only, archive included", () => {
    useAppStore.setState({
      recentSessions: [
        finished(1, { deaths: 12 }),
        { ...finished(2, { deaths: 5 }), ...stardew, exeName: "Stardew Valley.exe" },
      ],
      activeSessions: [{ ...running({ deaths: 2 }), lastCounterId: "deaths" }],
      archivedCounts: {
        "igdb:119133": { ":deaths": 300 },
        "igdb:17000": { ":deaths": 9 },
      },
    });
    useAppStore.getState().deleteGameCounter(eldenRing, "deaths");
    const state = useAppStore.getState();
    expect(state.recentSessions[0].counts).toBeUndefined();
    expect(state.recentSessions[1].counts).toEqual({ deaths: 5 });
    expect(state.activeSessions[0].counts).toBeUndefined();
    expect(state.activeSessions[0].lastCounterId).toBeUndefined();
    expect(state.archivedCounts).toEqual({ "igdb:17000": { ":deaths": 9 } });
    const journal = getGameJournal(state, eldenRing);
    expect(orderedCounters(journal)).toEqual([]);
    // Deaths had the controller icon: no counter has it now.
    expect(controllerCounterId(journal)).toBeNull();
  });
});

describe("totals", () => {
  it("stay the same when sessions leave History past the limit: game, playthrough and default playthrough", () => {
    const ng = useAppStore.getState().createPlaythrough(eldenRing, "NG+")!;
    useAppStore.getState().setActivePlaythrough(eldenRing, null);
    const history = Array.from({ length: MAX_STORED_SESSIONS }, (_, i) =>
      finished(i + 10, { deaths: 1 }, i % 2 ? { playthroughId: ng } : {}),
    );
    useAppStore.setState({ recentSessions: history });
    const before = {
      main: tallies(null).get("deaths"),
      ng: tallies(ng).get("deaths"),
    };
    expect(before.main).toMatchObject({ playthrough: 1250, all: 2500 });
    // One more session: the oldest leaves History.
    useAppStore
      .getState()
      .addSession(finished(MAX_STORED_SESSIONS + 10, { deaths: 3 }));
    expect(useAppStore.getState().recentSessions).toHaveLength(
      MAX_STORED_SESSIONS,
    );
    expect(tallies(null).get("deaths")).toMatchObject({
      playthrough: 1253,
      all: 2503,
    });
    expect(tallies(ng).get("deaths")?.playthrough).toBe(
      before.ng!.playthrough,
    );
  });

  it("stay the same when the storage is full and persistence archives sessions itself", () => {
    useAppStore.setState({
      recentSessions: Array.from({ length: MAX_STORED_SESSIONS + 3 }, (_, i) =>
        finished(i + 1, { deaths: 2 }),
      ),
    });
    const payload = createPersistedPayload(useAppStore.getState());
    expect(payload.sessions).toHaveLength(MAX_STORED_SESSIONS);
    expect(payload.archivedCounts).toEqual({ "igdb:119133": { ":deaths": 6 } });
  });

  it("of a deleted playthrough go to the default one, archive included", () => {
    const ng = useAppStore.getState().createPlaythrough(eldenRing, "NG+")!;
    useAppStore.setState({
      recentSessions: [finished(1, { deaths: 4 }, { playthroughId: ng })],
      archivedCounts: { "igdb:119133": { [`${ng}:deaths`]: 20, ":deaths": 5 } },
    });
    useAppStore.getState().deletePlaythrough(eldenRing, ng);
    expect(useAppStore.getState().archivedCounts).toEqual({
      "igdb:119133": { ":deaths": 25 },
    });
    expect(tallies(null).get("deaths")?.playthrough).toBe(29);
  });

  it("know the most in one session and when it was", () => {
    useAppStore.setState({
      recentSessions: [finished(1, { deaths: 9 }), finished(2, { deaths: 41 })],
    });
    expect(tallies().get("deaths")?.best).toEqual({
      count: 41,
      startedAt: finished(2).startedAt,
    });
  });
});

describe("History edits", () => {
  it("split puts the counts on the later part only; combine adds them up", () => {
    const session = finished(1, { deaths: 23 });
    const start = Date.parse(session.startedAt);
    const split = splitSession(
      [session],
      session.id,
      { startMs: start + 20 * 60_000, endMs: start + 25 * 60_000 },
      77,
    );
    const later = split.find((entry) => entry.id === session.id)!;
    const earlier = split.find((entry) => entry.id === 77)!;
    expect(later.counts).toEqual({ deaths: 23 });
    expect(earlier.counts).toBeUndefined();

    const two = [
      finished(1, { deaths: 3, rq: 1 }),
      finished(2, { deaths: 23 }),
    ];
    const combined = combineSessions(two, 1, 2);
    expect(combined).toHaveLength(1);
    expect(combined[0].counts).toEqual({ deaths: 26, rq: 1 });
  });
});

describe("journals of one game", () => {
  it("joined keep one Deaths, with both games' counts, and both games' own counters", () => {
    const target = {
      ...emptyJournal(eldenRing),
      counters: [
        { id: "deaths", shown: true, createdAt: "1970-01-01T00:00:00.000Z" },
        { id: "a", name: "Malenia", shown: true, createdAt: "2026-11-07T10:00:00.000Z" },
      ],
    };
    const incoming = {
      ...emptyJournal(eldenRing),
      counters: [
        { id: "b", name: "Radahn", shown: false, createdAt: "2026-11-05T10:00:00.000Z" },
      ],
    };
    const merged = mergeJournals(target, incoming);
    // Incoming had no Deaths of its own; the target's stays, once.
    expect(merged.counters!.map((c) => c.id).sort()).toEqual([
      "a",
      "b",
      "deaths",
    ]);
  });

  it("joined, keep a Deaths the player hid or renamed (the other journal only has the default one)", () => {
    const changed = {
      ...emptyJournal(eldenRing),
      counters: [
        { id: "deaths", name: "Tries", shown: false, createdAt: "1970-01-01T00:00:00.000Z" },
      ],
    };
    expect(mergeJournals(emptyJournal(eldenRing), changed).counters).toEqual(
      changed.counters,
    );
    expect(mergeJournals(changed, emptyJournal(eldenRing)).counters).toEqual(
      changed.counters,
    );
  });
});

describe("saving and backups", () => {
  it("keep counters, eyes, own keys and archived counts", () => {
    const store = useAppStore.getState();
    const malenia = store.addGameCounter(eldenRing, "Malenia")!;
    store.updateGameCounter(eldenRing, malenia, { key: "Control+Digit1" });
    store.updateGameCounter(eldenRing, "deaths", { shown: false });
    useAppStore.setState({
      recentSessions: [finished(1, { deaths: 3, [malenia]: 12 })],
      archivedCounts: { "igdb:119133": { ":deaths": 300 } },
    });
    const data = createTransferData(
      createPersistedPayload(useAppStore.getState()),
    );
    expect(() => validateBackupData(data, "data")).not.toThrow();
    expect(data.archivedCounts).toEqual({ "igdb:119133": { ":deaths": 300 } });
    const sessions = data.sessions as Session[];
    expect(sessions[0].counts).toEqual({ deaths: 3, [malenia]: 12 });
    const journal = Object.values(data.gameJournals!)[0];
    expect(journal.counters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "deaths", shown: false }),
        expect.objectContaining({ id: malenia, key: "Control+Digit1" }),
      ]),
    );
    // A broken count is refused like any other broken backup data.
    expect(() =>
      validateBackupData(
        { ...data, sessions: [{ ...sessions[0], counts: { deaths: -1 } }] },
        "data",
      ),
    ).toThrow("counts");
  });

  it("drop broken counters and counts when the saved data loads", () => {
    expect(
      sanitizeGameCounters([
        { id: "deaths", shown: true, createdAt: "1970-01-01T00:00:00.000Z" },
        { id: "nameless", shown: true },
        { id: "deaths", name: "again", shown: true },
        "nonsense",
      ]),
    ).toEqual([
      { id: "deaths", shown: true, createdAt: "1970-01-01T00:00:00.000Z" },
    ]);
    expect(
      sanitizeArchivedCounts({
        "igdb:119133": { ":deaths": 5, "bad": 3, ":x": -1 },
        "not a game": { ":deaths": 1 },
      }),
    ).toEqual({ "igdb:119133": { ":deaths": 5 } });
  });

  it("go through a quota trim with the archive in step", () => {
    useAppStore.setState({
      recentSessions: Array.from({ length: 10 }, (_, i) =>
        finished(i + 1, { deaths: 1 }),
      ),
    });
    vi.mocked(localStorage.setItem).mockImplementationOnce(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    const result = persistAppState(useAppStore.getState());
    expect(result.status).toBe("trimmed");
    if (result.status !== "trimmed") return;
    const archived = result.archivedCounts["igdb:119133"]?.[":deaths"] ?? 0;
    const kept = result.sessions.reduce(
      (sum, session) => sum + (session.counts?.deaths ?? 0),
      0,
    );
    expect(kept + archived).toBe(10);
  });
});
