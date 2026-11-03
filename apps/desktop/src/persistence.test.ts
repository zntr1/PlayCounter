import type { Session, Settings } from "@playcounter/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createPersistedPayload,
  LIVE_STORAGE_KEY,
  persistAppState,
  readPersistedRecord,
  readPersistedText,
  STORAGE_KEY,
  writePersistedRecord,
} from "./persistence";
import * as sessionPersistence from "./sessionPersistence";
import type { AppNotification } from "./notifications";
import type { ExeCacheEntry } from "./store";
import { creditToolUsage, localDayKey, type ToolUsage } from "./toolUsage";
import type {
  EmulatorMapping,
  EmulatorObservation,
  KnownEmulator,
} from "./emulators/types";
import {
  MAX_STORED_SESSIONS,
  normalizeSessions,
  splitStoredSessions,
} from "./sessionPersistence";

function makeSession(index: number): Session {
  const startedAt = new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString();
  return {
    id: index,
    gameId: 1,
    exeName: "game.exe",
    startedAt,
    endedAt: new Date(Date.parse(startedAt) + 60_000).toISOString(),
    durationSeconds: 60,
  };
}

const settings: Settings = {
  launchOnStartup: true,
  showDurationDays: false,
  autoShareIgnoredProcesses: false,
  pollingIntervalSeconds: 5,
  unmatchedRetryDays: 30,
  apiEndpoint: "http://localhost",
  verboseLogs: false,
  theme: "dark",
  accentColor: null,
};

function makeState(
  recentSessions: Session[],
  notifications: AppNotification[] = [],
) {
  return {
    installUuid: null,
    contributionOwnerUuid: null,
    settings,
    exeCache: new Map(),
    launchTargets: new Map(),
    manualLaunchTargets: new Map(),
    gameMetadata: new Map(),
    recentSessions,
    activeSessions: [],
    ambiguousMatches: [],
    blacklist: new Set<string>(),
    notifications,
    discoveredReviewReminder: null,
    seenContributionStatus: {},
    contributionCounts: {
      suggested: 0,
      verified: 0,
      pending: 0,
      rejected: 0,
    },
    emulatorContributionCounts: {
      suggested: 2,
      verified: 1,
      pending: 1,
      rejected: 0,
    },
    awardedMilestones: [
      {
        id: "milestone:total:10",
        kind: "milestone-total" as const,
        title: "You've played 10 hours in total",
        awardedAt: "2026-08-09T00:00:00.000Z",
      },
    ],
    milestonesInitializedAt: null,
    archivedSeconds: 0,
    archivedGameSeconds: {},
    playtimeAdjustments: { "community:42": 600 },
    collapsedSections: [],
    autoDetectedGameKeys: [],
    lastSeenReleaseNotesVersion: null,
  };
}

afterEach(() => vi.restoreAllMocks());

describe("session persistence", () => {
  it("skips unchanged saves and reuses history normalization and serialization", () => {
    const setItem = vi.fn();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: { setItem },
    });
    const session = makeSession(1);
    const state = makeState([session]);
    const expected = JSON.parse(JSON.stringify(createPersistedPayload(state)));
    const normalize = vi.spyOn(sessionPersistence, "normalizeSessions");
    const stringify = vi.spyOn(JSON, "stringify");
    expect(persistAppState(state).status).toBe("saved");
    expect(setItem).toHaveBeenCalledTimes(1);
    expect(setItem.mock.calls[0][0]).toBe(STORAGE_KEY);
    expect(JSON.parse(setItem.mock.calls[0][1])).toMatchObject(expected);
    expect(normalize).toHaveBeenCalledTimes(1);
    normalize.mockClear();
    stringify.mockClear();

    // Scans replace some collections even when their contents are unchanged.
    persistAppState({
      ...state,
      exeCache: new Map(),
      recentSessions: [...state.recentSessions],
    });
    expect(setItem).toHaveBeenCalledTimes(1);
    expect(normalize).not.toHaveBeenCalled();
    expect(
      stringify.mock.calls.some(
        ([value]) => Array.isArray(value) && value.includes(session),
      ),
    ).toBe(false);

    persistAppState({
      ...state,
      activeSessions: [{ checkpointedAt: "2026-09-06T10:00:00Z" }],
    });
    expect(setItem).toHaveBeenCalledTimes(2);
    expect(normalize).not.toHaveBeenCalled();
    expect(
      stringify.mock.calls.some(
        ([value]) => Array.isArray(value) && value.includes(session),
      ),
    ).toBe(false);
    // A running session's progress goes to the small save.
    expect(setItem.mock.calls[1][0]).toBe(LIVE_STORAGE_KEY);
    expect(setItem.mock.calls[1][1]).toContain("2026-09-06T10:00:00Z");
  });

  it("immediately saves settings and history changes", () => {
    const setItem = vi.fn();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: { setItem },
    });
    const state = makeState([makeSession(1)]);
    persistAppState(state);
    const updated = {
      ...state,
      settings: { ...state.settings, pollingIntervalSeconds: 10 },
    };
    persistAppState(updated);
    expect(
      JSON.parse(setItem.mock.calls[1][1]).settings.pollingIntervalSeconds,
    ).toBe(10);
    persistAppState({
      ...updated,
      recentSessions: [makeSession(2), ...state.recentSessions],
    });
    expect(JSON.parse(setItem.mock.calls[2][1]).sessions).toHaveLength(2);
  });

  it("retries identical state after a failed write", () => {
    const setItem = vi.fn().mockImplementationOnce(() => {
      throw new Error("Unavailable");
    });
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: { setItem },
    });
    const state = makeState([makeSession(1)]);
    expect(persistAppState(state).status).toBe("failed");
    expect(persistAppState(state).status).toBe("saved");
    expect(setItem).toHaveBeenCalledTimes(2);
  });

  it("invalidates cached saves when backup data replaces storage", () => {
    const setItem = vi.fn();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: { setItem },
    });
    const state = makeState([makeSession(1)]);
    persistAppState(state);
    writePersistedRecord({ sessions: [] });
    persistAppState(state);
    expect(setItem).toHaveBeenCalledTimes(3);
    expect(JSON.parse(setItem.mock.calls[2][1]).sessions).toHaveLength(1);
  });

  it("persists launch targets as machine-local records", () => {
    const setItem = vi.fn();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: { setItem },
    });

    persistAppState({
      ...makeState([]),
      launchTargets: new Map([
        [
          "game.exe",
          {
            exeName: "Game.exe",
            path: String.raw`C:\Games\Game.exe`,
            owner: { gameId: 42, source: "igdb" },
          },
        ],
      ]),
    });

    expect(JSON.parse(setItem.mock.calls[0][1]).launchTargets).toEqual([
      {
        exeName: "Game.exe",
        path: String.raw`C:\Games\Game.exe`,
        owner: { gameId: 42, source: "igdb" },
      },
    ]);
  });

  it("persists game-owned manual launcher overrides separately", () => {
    const setItem = vi.fn();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: { setItem },
    });
    const target = {
      exeName: "Launcher.exe",
      path: String.raw`C:\Games\Launcher.exe`,
      owner: { gameId: 42, source: "igdb" as const },
    };

    persistAppState({
      ...makeState([]),
      manualLaunchTargets: new Map([["42:igdb", target]]),
    });

    expect(JSON.parse(setItem.mock.calls[0][1]).manualLaunchTargets).toEqual([
      target,
    ]);
  });

  it("persists emulator binaries and game files as device-local records", () => {
    const setItem = vi.fn();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: { setItem },
    });
    const binary = {
      emulatorId: "dolphin",
      exePath: String.raw`C:\Emulators\Dolphin.exe`,
      setAt: "2026-08-24T00:00:00.000Z",
    };
    const target = {
      emulatorId: "dolphin",
      contentKey: "dolphin:rom:the sims 2.rvz",
      filePath: String.raw`D:\Games\The Sims 2.rvz`,
      setAt: "2026-08-24T00:00:00.000Z",
    };
    const candidate = {
      ...target,
      contentKey: "dolphin:title_id:g4op69",
      displayName: "The Sims 2.rvz",
    };

    persistAppState({
      ...makeState([]),
      emulatorAutoBinaries: new Map([["dolphin", binary]]),
      emulatorManualLaunchTargets: new Map([[target.contentKey, target]]),
      emulatorLaunchCandidates: new Map([[candidate.contentKey, candidate]]),
    });

    const payload = JSON.parse(setItem.mock.calls[0][1]);
    expect(payload.emulatorAutoBinaries).toEqual([binary]);
    expect(payload.emulatorManualLaunchTargets).toEqual([target]);
    expect(payload.emulatorLaunchCandidates).toEqual([candidate]);
  });

  it("persists the last acknowledged release notes version when present", () => {
    const setItem = vi.fn();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: { setItem },
    });

    persistAppState({
      ...makeState([]),
      lastSeenReleaseNotesVersion: "1.1.5",
    });
    expect(
      JSON.parse(setItem.mock.calls[0][1]).lastSeenReleaseNotesVersion,
    ).toBe("1.1.5");

    setItem.mockClear();
    persistAppState(makeState([]));
    expect(JSON.parse(setItem.mock.calls[0][1])).not.toHaveProperty(
      "lastSeenReleaseNotesVersion",
    );
  });

  it("persists tutorial progress with local data", () => {
    const setItem = vi.fn();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: { setItem },
    });

    persistAppState({
      ...makeState([]),
      tourProgress: {
        version: 1,
        welcomeVersion: 1,
        completed: { core: 1 },
      },
    });

    const payload = JSON.parse(setItem.mock.calls[0][1]);
    expect(payload.tours).toEqual({
      version: 1,
      welcomeVersion: 1,
      completed: { core: 1 },
    });
    expect(payload.emulatorContributionCounts).toEqual({
      suggested: 2,
      verified: 1,
      pending: 1,
      rejected: 0,
    });
  });

  it("retains structured emulator provenance on completed sessions", () => {
    const setItem = vi.fn();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: { setItem },
    });
    const session: Session = {
      ...makeSession(7),
      gameName: "Doom",
      emulator: {
        emulatorId: "dosbox",
        label: "DOSBox",
        contentKey: "dosbox:program:doom.exe",
        display: "DOOM.EXE",
        trust: "recognized",
      },
    };

    persistAppState({ ...makeState([session]) });

    expect(JSON.parse(setItem.mock.calls[0][1]).sessions[0].emulator).toEqual({
      emulatorId: "dosbox",
      label: "DOSBox",
      contentKey: "dosbox:program:doom.exe",
      display: "DOOM.EXE",
      trust: "recognized",
    });
  });

  it("persists known emulators after they stop running", () => {
    const setItem = vi.fn();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: { setItem },
    });

    persistAppState({
      ...makeState([]),
      knownEmulators: new Map([
        [
          "dosbox",
          {
            emulatorId: "dosbox",
            label: "DOSBox",
            firstSeenAt: "2026-08-13T10:00:00.000Z",
            lastSeenAt: "2026-08-13T11:00:00.000Z",
            hostExeNames: ["dosbox.exe"],
          },
        ],
      ]),
    });

    expect(JSON.parse(setItem.mock.calls[0][1]).knownEmulators).toEqual([
      expect.objectContaining({ emulatorId: "dosbox", label: "DOSBox" }),
    ]);
  });

  it("persists the discovered review reminder cooldown", () => {
    const reminder = {
      notifiedAt: "2026-08-10T00:00:00.000Z",
      notifiedCount: 12,
    };
    const setItem = vi.fn();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: { setItem },
    });

    persistAppState({
      ...makeState([]),
      discoveredReviewReminder: reminder,
    });

    expect(
      JSON.parse(setItem.mock.calls[0][1]).discoveredReviewReminder,
    ).toEqual(reminder);
  });

  it("persists collapsed section preferences", () => {
    const setItem = vi.fn();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: { setItem },
    });

    persistAppState({
      ...makeState([]),
      collapsedSections: ["history.timeline", "achievements.total"],
    });

    expect(JSON.parse(setItem.mock.calls[0][1]).collapsedSections).toEqual([
      "history.timeline",
      "achievements.total",
    ]);
  });

  it("persists de-duplicated automatic detection aliases", () => {
    const setItem = vi.fn();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: { setItem },
    });

    persistAppState({
      ...makeState([]),
      autoDetectedGameKeys: ["igdb#42", "community:7", "igdb#42"],
    });

    expect(JSON.parse(setItem.mock.calls[0][1]).autoDetectedGameKeys).toEqual([
      "igdb#42",
      "community:7",
    ]);
  });

  it("sorts newest-first and enforces the measured cap", () => {
    const sessions = Array.from(
      { length: MAX_STORED_SESSIONS + 10 },
      (_, index) => makeSession(index),
    );
    const normalized = normalizeSessions(sessions.reverse());
    expect(normalized).toHaveLength(MAX_STORED_SESSIONS);
    expect(normalized[0].id).toBe(MAX_STORED_SESSIONS + 9);
  });

  it("partitions a sorted full window without keeping and archiving a backdated session", () => {
    const sessions = Array.from({ length: MAX_STORED_SESSIONS }, (_, index) =>
      makeSession(index + 1),
    );
    const backdated = makeSession(0);
    const { kept, removed } = splitStoredSessions([backdated, ...sessions]);
    expect(kept).toHaveLength(MAX_STORED_SESSIONS);
    expect(removed).toEqual([backdated]);
    expect(new Set([...kept, ...removed])).toHaveProperty(
      "size",
      MAX_STORED_SESSIONS + 1,
    );
  });

  it("reports exactly which sessions were trimmed on quota retry", () => {
    const setItem = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new DOMException("full", "QuotaExceededError");
      })
      .mockImplementationOnce(() => undefined);
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: { setItem },
    });
    const sessions = Array.from({ length: 20 }, (_, index) =>
      makeSession(index),
    );
    const result = persistAppState(makeState(sessions));
    expect(result.status).toBe("trimmed");
    if (result.status === "trimmed") {
      expect(result.removed).toHaveLength(2);
      expect(result.sessions).toHaveLength(18);
      expect(result.archivedSeconds).toBe(120);
      expect(result.archivedGameSeconds["unknown:1"]).toBe(120);
      const serialized = JSON.parse(setItem.mock.calls[1][1]);
      expect(serialized.archivedSeconds).toBe(120);
      expect(serialized.archivedGameSeconds["unknown:1"]).toBe(120);
      expect(serialized.playtimeAdjustments).toEqual({
        "community:42": 600,
      });
      expect(serialized.awardedMilestones).toHaveLength(1);
      expect(serialized.awardedMilestoneIds).toEqual(["milestone:total:10"]);
    }
    expect(setItem).toHaveBeenCalledTimes(2);
  });

  it("drops notifications before trimming sessions under quota pressure", () => {
    const setItem = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new DOMException("full", "QuotaExceededError");
      })
      .mockImplementationOnce(() => undefined);
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: { setItem },
    });
    const notification: AppNotification = {
      id: "suggestion-rejected:test",
      kind: "suggestion-rejected",
      title: "Reviewed",
      createdAt: "2026-08-09T00:00:00.000Z",
    };

    const result = persistAppState(
      makeState([makeSession(1), makeSession(2)], [notification]),
    );

    expect(result.status).toBe("trimmed");
    expect(result.sessions).toHaveLength(2);
    expect(result.notifications).toEqual([]);
    const serialized = JSON.parse(setItem.mock.calls[1][1]);
    expect(serialized.notifications).toEqual([]);
    expect(serialized.sessions).toHaveLength(2);
    expect(serialized.playtimeAdjustments).toEqual({
      "community:42": 600,
    });
    expect(serialized.awardedMilestones).toHaveLength(1);
    expect(serialized.awardedMilestoneIds).toEqual(["milestone:total:10"]);
  });
});

describe("saves while games, software and emulators run", () => {
  // The rule: what changes on every scan or every minute while things run
  // (software time, a running session's progress, the time of Discovered apps
  // and unrecognized emulator games, emulator "last seen") never rewrites the
  // whole saved state. Every other PlayCounter window (the live timer,
  // overlays) gets a copy of each write, so these writes stay small.
  const T0 = Date.parse("2026-11-03T18:00:00.000Z");
  const iso = (ms: number) => new Date(ms).toISOString();

  function installMemoryStorage() {
    const values = new Map<string, string>();
    const storage = {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        values.set(key, value);
      }),
      removeItem: vi.fn((key: string) => {
        values.delete(key);
      }),
    };
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: storage,
    });
    const writesTo = (key: string) =>
      storage.setItem.mock.calls
        .filter(([written]) => written === key)
        .map(([, value]) => value);
    return { storage, values, writesTo };
  }

  function savedPayload(state: Parameters<typeof createPersistedPayload>[0]) {
    return JSON.parse(JSON.stringify(createPersistedPayload(state)));
  }

  // Ten months of history: the whole save is about half a megabyte.
  function playingState() {
    const days = Object.fromEntries(
      Array.from({ length: 300 }, (_, index) => [
        localDayKey(T0 - index * 86_400_000),
        3_600 + index / 3,
      ]),
    );
    const toolUsage: ToolUsage = Object.fromEntries(
      Array.from({ length: 20 }, (_, index) => [
        `tool${index}.exe`,
        { exePath: `C:\\Tools\\tool${index}.exe`, days: { ...days } },
      ]),
    );
    const exeCache = new Map(
      Array.from({ length: 2_000 }, (_, index): [string, ExeCacheEntry] => [
        `app${index}.exe`,
        {
          exeName: `App${index}.exe`,
          state: "unmatched",
          lastCheckedAt: iso(T0),
        },
      ]),
    );
    const emulatorMappings = new Map(
      Array.from({ length: 300 }, (_, index): [string, EmulatorMapping] => {
        const contentKey = `pcsx2:rom:game ${index}.iso`;
        return [
          contentKey,
          {
            contentKey,
            emulatorId: "pcsx2",
            label: "PCSX2",
            contentKind: "rom",
            contentValue: `game ${index}.iso`,
            display: `Game ${index}.iso`,
            trust: "recognized",
            decision: "game",
            gameId: 1_000 + index,
            gameName: `Game ${index}`,
            confidence: "user",
            decidedAt: iso(T0),
            lastSeenAt: iso(T0),
          },
        ];
      }),
    );
    const knownEmulators = new Map<string, KnownEmulator>([
      [
        "pcsx2",
        {
          emulatorId: "pcsx2",
          label: "PCSX2",
          firstSeenAt: iso(T0),
          lastSeenAt: iso(T0),
          hostExeNames: ["pcsx2-qt.exe"],
        },
      ],
    ]);
    const emulatorObservations: EmulatorObservation[] = [
      {
        kind: "content",
        key: "duckstation:rom:mystery.cue",
        emulatorId: "duckstation",
        label: "DuckStation",
        hostExeName: "duckstation-qt.exe",
        contentKind: "rom",
        contentValue: "mystery.cue",
        display: "Mystery.cue",
        trust: "recognized",
        shareable: true,
        state: "unknown",
        detectedAt: iso(T0),
        runningSince: iso(T0),
        trackedSeconds: 60,
      },
    ];
    return {
      ...makeState(
        Array.from({ length: 500 }, (_, index) => makeSession(index)),
      ),
      toolUsage,
      exeCache,
      emulatorMappings,
      knownEmulators,
      emulatorObservations,
      activeSessions: [
        {
          id: 9_001,
          gameId: 42,
          gameName: "Game",
          exeName: "game.exe",
          coverUrl: "",
          startedAt: iso(T0),
          checkpointedAt: iso(T0),
        },
      ],
    };
  }
  type PlayingState = ReturnType<typeof playingState>;

  // One minute of a game, software, a Discovered app, an emulator game and an
  // unrecognized emulator game, all running at once.
  function playOneMinute(state: PlayingState, now: number): PlayingState {
    const exeCache = new Map(state.exeCache);
    const discovered = exeCache.get("app7.exe")!;
    exeCache.set("app7.exe", {
      ...discovered,
      trackedSeconds: (discovered.trackedSeconds ?? 0) + 60,
      runningSince: iso(now),
    });
    const mappingKey = "pcsx2:rom:game 7.iso";
    const emulatorMappings = new Map(state.emulatorMappings);
    emulatorMappings.set(mappingKey, {
      ...emulatorMappings.get(mappingKey)!,
      lastSeenAt: iso(now),
    });
    const knownEmulators = new Map(state.knownEmulators);
    knownEmulators.set("pcsx2", {
      ...knownEmulators.get("pcsx2")!,
      lastSeenAt: iso(now),
    });
    return {
      ...state,
      activeSessions: state.activeSessions.map((session) => ({
        ...session,
        checkpointedAt: iso(now),
      })),
      toolUsage: creditToolUsage(
        state.toolUsage,
        [
          {
            toolKey: "tool3",
            exeKey: "tool3.exe",
            exePath: "C:\\Tools\\tool3.exe",
          },
        ],
        now - 60_000,
        now,
      ),
      exeCache,
      emulatorMappings,
      knownEmulators,
      emulatorObservations: state.emulatorObservations.map((observation) =>
        observation.kind === "content"
          ? {
              ...observation,
              trackedSeconds: (observation.trackedSeconds ?? 0) + 60,
              runningSince: iso(now),
            }
          : observation,
      ),
    };
  }

  function playMinutes(state: PlayingState, minutes: number) {
    for (let minute = 1; minute <= minutes; minute++) {
      state = playOneMinute(state, T0 + minute * 60_000);
      expect(persistAppState(state).status).toBe("saved");
    }
    return state;
  }

  it("leaves the big save alone and writes a few hundred characters per change", () => {
    const { writesTo } = installMemoryStorage();
    const state = playingState();
    expect(persistAppState(state).status).toBe("saved");
    expect(writesTo(STORAGE_KEY)).toHaveLength(1);
    expect(writesTo(STORAGE_KEY)[0].length).toBeGreaterThan(400_000);

    playMinutes(state, 30);

    expect(writesTo(STORAGE_KEY)).toHaveLength(1);
    const playSaves = writesTo(LIVE_STORAGE_KEY);
    expect(playSaves).toHaveLength(30);
    for (const save of playSaves) expect(save.length).toBeLessThan(2_000);
  });

  it("loads everything after a restart, the play data included", () => {
    installMemoryStorage();
    let state = playingState();
    persistAppState(state);
    state = playMinutes(state, 30);

    expect(readPersistedRecord()).toEqual(savedPayload(state));
  });

  it("saves a change the user makes to the big save at once, play data included", () => {
    const { values, writesTo } = installMemoryStorage();
    let state = playingState();
    persistAppState(state);
    state = playMinutes(state, 3);

    state = { ...state, settings: { ...state.settings, theme: "light" } };
    persistAppState(state);

    expect(writesTo(STORAGE_KEY)).toHaveLength(2);
    // Theme and language are read from the big save alone before the app loads.
    expect(JSON.parse(values.get(STORAGE_KEY)!)).toMatchObject(
      savedPayload(state),
    );
    expect(readPersistedRecord()).toEqual(savedPayload(state));
  });

  it("ignores play data saved for a big save that was replaced since", () => {
    const { values } = installMemoryStorage();
    let state = playingState();
    persistAppState(state);
    state = playMinutes(state, 1);

    // A restored backup.
    writePersistedRecord({ sessions: [] });
    expect(readPersistedRecord()).toEqual({ sessions: [] });

    // An older PlayCounter, which saves everything in the big save.
    persistAppState(state);
    playMinutes(state, 2);
    const older = savedPayload({ ...state, recentSessions: [makeSession(1)] });
    values.set(STORAGE_KEY, JSON.stringify(older));
    expect(readPersistedRecord()).toEqual(older);
  });

  it("keeps the play data a few KB however much changes", () => {
    const { writesTo } = installMemoryStorage();
    let state = playingState();
    persistAppState(state);

    // A new Discovered app on every scan for an hour.
    for (let index = 0; index < 720; index++) {
      const exeCache = new Map(state.exeCache);
      exeCache.set(`new${index}.exe`, {
        exeName: `New${index}.exe`,
        exePath: `C:\\Program Files\\New ${index}\\New${index}.exe`,
        state: "unmatched",
        lastCheckedAt: iso(T0),
      });
      state = { ...state, exeCache };
      expect(persistAppState(state).status).toBe("saved");
    }

    const playSaves = writesTo(LIVE_STORAGE_KEY);
    expect(playSaves.length).toBeGreaterThan(0);
    for (const save of playSaves)
      expect(save.length).toBeLessThanOrEqual(8_192);
    expect(readPersistedRecord()).toEqual(savedPayload(state));
  });

  it("retries play data that could not be saved", () => {
    const { storage } = installMemoryStorage();
    let state = playingState();
    persistAppState(state);
    state = playOneMinute(state, T0 + 60_000);
    storage.setItem.mockImplementationOnce(() => {
      throw new Error("Unavailable");
    });

    expect(persistAppState(state).status).toBe("failed");
    expect(persistAppState(state).status).toBe("saved");
    expect(readPersistedRecord()).toEqual(savedPayload(state));
  });

  it("gives backups the play data too", () => {
    installMemoryStorage();
    let state = playingState();
    persistAppState(state);
    state = playMinutes(state, 2);

    expect(JSON.parse(readPersistedText()!)).toEqual(savedPayload(state));
  });
});
