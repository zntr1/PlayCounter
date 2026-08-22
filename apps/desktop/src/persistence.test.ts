import type { Session, Settings } from "@playcounter/shared";
import { describe, expect, it, vi } from "vitest";
import { persistAppState } from "./persistence";
import type { AppNotification } from "./notifications";
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

describe("session persistence", () => {
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
