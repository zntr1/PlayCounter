import type { Session } from "@playcounter/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (value: string) => value,
  invoke: vi.fn(),
}));
import { milestoneMetrics } from "./milestones";
import { MAX_STORED_SESSIONS } from "./sessionPersistence";
import { createGameIdentityResolver, useAppStore } from "./store";
import {
  combineHistorySessions,
  editHistorySession,
  splitHistorySession,
} from "./tracker";

// Edit, split and combine store like a new session: sorted newest first, the
// oldest beyond the limit archived, and every total follows.

const H = 3600;
const at = (time: string, day = "2026-10-20") =>
  Date.parse(`${day}T${time}:00.000Z`);

let nextId = 1;
function session(start: string, end: string, day?: string): Session {
  return {
    id: nextId++,
    gameId: 7,
    source: "community",
    gameName: "Hollow Knight",
    exeName: "hollow_knight.exe",
    startedAt: new Date(at(start, day)).toISOString(),
    endedAt: new Date(at(end, day)).toISOString(),
    durationSeconds: (at(end, day) - at(start, day)) / 1000,
  };
}

/** The game's total My Games shows, in hours. */
function shownHours() {
  const state = useAppStore.getState();
  return milestoneMetrics({
    sessions: state.recentSessions,
    archivedSeconds: state.archivedSeconds,
    archivedGameSeconds: state.archivedGameSeconds,
    playtimeAdjustments: state.playtimeAdjustments,
    resolveIgdbId: createGameIdentityResolver(
      state.gameMetadata,
      state.exeCache,
      state.libraryImports,
    ),
    verifiedContributions: 0,
  }).games.get("community:7")?.hours;
}

const ids = () => useAppStore.getState().recentSessions.map((s) => s.id);

beforeEach(() => {
  useAppStore.setState(useAppStore.getInitialState(), true);
  vi.stubGlobal("localStorage", {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("changing History sessions", () => {
  it("edits a session, sorts it again and changes the total", () => {
    const early = session("10:00", "11:00");
    const late = session("20:00", "21:00");
    useAppStore.setState({ recentSessions: [late, early] });

    editHistorySession(early.id, { startMs: at("22:00"), endMs: at("23:30") });

    expect(ids()).toEqual([early.id, late.id]);
    expect(shownHours()).toBe(2.5);
  });

  it("splits a session, removes the break and changes the total", () => {
    const whole = session("14:00", "20:00");
    useAppStore.setState({ recentSessions: [whole] });

    splitHistorySession(whole.id, { startMs: at("15:00"), endMs: at("19:00") });

    const sessions = useAppStore.getState().recentSessions;
    expect(sessions).toHaveLength(2);
    expect(sessions[0]).toMatchObject({
      id: whole.id,
      durationSeconds: H,
    });
    expect(sessions[1]!.id).not.toBe(whole.id);
    expect(sessions[1]!.durationSeconds).toBe(H);
    expect(shownHours()).toBe(2);
  });

  it("combines two sessions, counting the gap in the total", () => {
    const first = session("20:00", "21:10");
    const second = session("21:13", "22:30");
    useAppStore.setState({ recentSessions: [second, first] });

    combineHistorySessions(first.id, second.id);

    expect(ids()).toEqual([second.id]);
    expect(shownHours()).toBe(2.5);
  });

  it("archives the oldest session when a split goes over the limit", () => {
    const sessions = Array.from({ length: MAX_STORED_SESSIONS }, (_, index) =>
      session(
        "10:00",
        "11:00",
        new Date(at("00:00", "2020-01-01") + index * 86_400_000)
          .toISOString()
          .slice(0, 10),
      ),
    ).reverse();
    const oldest = sessions.at(-1)!;
    const newest = sessions[0]!;
    useAppStore.setState({ recentSessions: sessions });

    splitHistorySession(newest.id, {
      startMs: Date.parse(newest.startedAt) + 20 * 60_000,
      endMs: Date.parse(newest.startedAt) + 30 * 60_000,
    });

    const state = useAppStore.getState();
    expect(state.recentSessions).toHaveLength(MAX_STORED_SESSIONS);
    expect(state.recentSessions.some((s) => s.id === oldest.id)).toBe(false);
    expect(state.archivedSeconds).toBe(H);
    expect(state.archivedGameSeconds).toEqual({ "community:7": H });
    // Only the 10-minute break is gone from the total.
    expect(shownHours()).toBeCloseTo(MAX_STORED_SESSIONS - 10 / 60, 6);
  });
});
