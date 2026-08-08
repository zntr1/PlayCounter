import type { Session, Settings } from "@playcounter/shared";
import { describe, expect, it, vi } from "vitest";
import { persistAppState } from "./persistence";
import { MAX_STORED_SESSIONS, normalizeSessions } from "./sessionPersistence";

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
    const result = persistAppState({
      installUuid: null,
      settings,
      exeCache: new Map(),
      gameMetadata: new Map(),
      recentSessions: sessions,
      activeSessions: [],
      ambiguousMatches: [],
      blacklist: new Set(),
    });
    expect(result.status).toBe("trimmed");
    if (result.status === "trimmed") {
      expect(result.removed).toHaveLength(2);
      expect(result.sessions).toHaveLength(18);
    }
    expect(setItem).toHaveBeenCalledTimes(2);
  });
});
