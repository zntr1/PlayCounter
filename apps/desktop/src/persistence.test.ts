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
    gameMetadata: new Map(),
    recentSessions,
    activeSessions: [],
    ambiguousMatches: [],
    blacklist: new Set<string>(),
    notifications,
    seenContributionStatus: {},
    contributionCounts: {
      suggested: 0,
      verified: 0,
      pending: 0,
      rejected: 0,
    },
    awardedMilestoneIds: [],
    milestonesInitializedAt: null,
    archivedSeconds: 0,
    archivedGameSeconds: {},
    playtimeAdjustments: { "community:42": 600 },
  };
}

describe("session persistence", () => {
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
  });
});
