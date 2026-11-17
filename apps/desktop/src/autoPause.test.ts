import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  AWAY_AFTER_MS,
  awayStep,
  checkAway,
  disposeAutoPause,
  type GameActivity,
} from "./autoPause";
import { useAppStore, type ActiveSession } from "./store";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const invokeMock = vi.mocked(invoke);
const MIN = 60_000;
const now = Date.parse("2026-11-17T20:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();

function game(overrides: Partial<ActiveSession> = {}): ActiveSession {
  return {
    id: 1,
    gameId: 7,
    gameName: "Elden Ring",
    exeName: "eldenring.exe",
    coverUrl: "",
    startedAt: iso(now - 2 * 60 * MIN),
    checkpointedAt: iso(now - MIN),
    ...overrides,
  };
}

function inFront(
  lastInputAtMs: number,
  overrides: Partial<GameActivity> = {},
): GameActivity {
  return {
    lastInputAtMs,
    inFront: true,
    hasWindow: true,
    leftFrontAtMs: null,
    ...overrides,
  };
}

function awayPaused(atMs: number) {
  return game({ pausedAt: iso(atMs), pauseKind: "away" });
}

// docs/auto-pause-plan.md, "What counts as away" and "Rules".
describe("when a game counts as played", () => {
  it("waits 10 minutes", () => {
    expect(AWAY_AFTER_MS).toBe(10 * MIN);
  });

  it("no input for 10 minutes with the game in front: pauses from the last input", () => {
    expect(awayStep(game(), inFront(now - 10 * MIN), now)).toEqual({
      pause: now - 10 * MIN,
    });
  });

  it("away for 9 minutes: nothing changes, it all counts", () => {
    expect(awayStep(game(), inFront(now - 9 * MIN), now)).toBeNull();
  });

  it("another app in front for 10 minutes while you type there: pauses from when the game left the front", () => {
    const typingElsewhere = inFront(now - 2000, {
      inFront: false,
      leftFrontAtMs: now - 10 * MIN,
    });
    expect(awayStep(game(), typingElsewhere, now)).toEqual({
      pause: now - 10 * MIN,
    });
  });

  it("another app in front for 9 minutes: nothing changes", () => {
    const quickLook = inFront(now - 2000, {
      inFront: false,
      leftFrontAtMs: now - 9 * MIN,
    });
    expect(awayStep(game(), quickLook, now)).toBeNull();
  });

  it("no input and not in front: the pause starts at the earlier one", () => {
    const both = inFront(now - 25 * MIN, {
      inFront: false,
      leftFrontAtMs: now - 12 * MIN,
    });
    expect(awayStep(game(), both, now)).toEqual({ pause: now - 25 * MIN });
  });

  it("a game without a window of its own is judged on input only", () => {
    const noWindow = { inFront: false, hasWindow: false };
    expect(
      awayStep(
        game(),
        inFront(now - 2000, { ...noWindow, leftFrontAtMs: now - 30 * MIN }),
        now,
      ),
    ).toBeNull();
    expect(
      awayStep(game(), inFront(now - 10 * MIN, noWindow), now),
    ).toEqual({ pause: now - 10 * MIN });
  });

  it("the pause never starts before the session did", () => {
    const justStarted = game({ startedAt: iso(now - 15 * MIN) });
    expect(awayStep(justStarted, inFront(now - 40 * MIN), now)).toEqual({
      pause: now - 15 * MIN,
    });
  });

  it("the manual timer and PlayStation sessions are never paused", () => {
    const idleHour = inFront(now - 60 * MIN, { hasWindow: false });
    expect(awayStep(game({ timer: true }), idleHour, now)).toBeNull();
    expect(awayStep(game({ console: "PS5" }), idleHour, now)).toBeNull();
  });
});

describe("coming back", () => {
  it("auto-paused, game in front, new input: counts on from that input", () => {
    expect(
      awayStep(awayPaused(now - 30 * MIN), inFront(now - 3000), now),
    ).toEqual({ resume: now - 3000 });
  });

  it("auto-paused, input in another app: stays paused", () => {
    const elsewhere = inFront(now - 1000, {
      inFront: false,
      leftFrontAtMs: now - 40 * MIN,
    });
    expect(awayStep(awayPaused(now - 30 * MIN), elsewhere, now)).toBeNull();
  });

  it("auto-paused, no new input: stays paused, also when the clocks differ a little", () => {
    // The input time is worked out from a tick count each check: it can come
    // out a few milliseconds later than the pause without anyone touching.
    const pausedAt = now - 30 * MIN;
    expect(
      awayStep(awayPaused(pausedAt), inFront(pausedAt + 40), now),
    ).toBeNull();
  });

  it("a pause you made yourself never resumes by itself", () => {
    const manual = game({ pausedAt: iso(now - 30 * MIN) });
    expect(awayStep(manual, inFront(now - 1000), now)).toBeNull();
  });
});

describe("the check every few seconds", () => {
  const pause = vi.fn();
  const resume = vi.fn();
  const pids: Record<number, number[]> = { 1: [10], 2: [20] };
  const deps = {
    gamePids: (session: ActiveSession) => pids[session.id] ?? [],
    pause,
    resume,
  };
  let activity: {
    inputIdleMs: number;
    padIdleMs: number | null;
    inFront: boolean[];
    hasWindow: boolean[];
  };

  function setSessions(activeSessions: ActiveSession[]) {
    useAppStore.setState({ activeSessions });
  }

  function setAutoPause(enabled: boolean) {
    useAppStore.setState((state) => ({
      settings: { ...state.settings, autoPauseEnabled: enabled },
    }));
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    pause.mockReset();
    resume.mockReset();
    activity = {
      inputIdleMs: 1000,
      padIdleMs: null,
      inFront: [true, true],
      hasWindow: [true, true],
    };
    invokeMock.mockReset().mockImplementation(async (command) => {
      if (command === "play_activity") return activity;
      return undefined;
    });
    setAutoPause(true);
    setSessions([]);
  });

  afterEach(() => {
    disposeAutoPause();
    vi.useRealTimers();
  });

  it("asks for each game's own processes", async () => {
    setSessions([game({ id: 1 }), game({ id: 2, gameId: 8 })]);
    await checkAway(deps);
    expect(invokeMock).toHaveBeenCalledWith("play_activity", {
      pidGroups: [[10], [20]],
    });
  });

  it("two games: the one in front counts, the other pauses", async () => {
    setSessions([game({ id: 1 }), game({ id: 2, gameId: 8 })]);
    activity.inFront = [true, false];
    await checkAway(deps);
    expect(pause).not.toHaveBeenCalled();

    vi.setSystemTime(now + 10 * MIN);
    await checkAway(deps);
    expect(pause).toHaveBeenCalledOnce();
    expect(pause).toHaveBeenCalledWith(2, now);
  });

  it("controller input counts as input", async () => {
    setSessions([game()]);
    activity.inputIdleMs = 40 * MIN;
    activity.padIdleMs = 2000;
    await checkAway(deps);
    expect(pause).not.toHaveBeenCalled();

    activity.padIdleMs = 10 * MIN;
    await checkAway(deps);
    expect(pause).toHaveBeenCalledWith(1, now - 10 * MIN);
  });

  it("resuming by hand while another app is in front starts the 10 minutes over", async () => {
    setSessions([game()]);
    activity.inFront = [false];
    await checkAway(deps);
    vi.setSystemTime(now + 10 * MIN);
    await checkAway(deps);
    expect(pause).toHaveBeenCalledWith(1, now);

    // Paused, then resumed with the pill while the game is still behind.
    setSessions([awayPaused(now)]);
    await checkAway(deps);
    setSessions([game()]);
    vi.setSystemTime(now + 11 * MIN);
    await checkAway(deps);
    vi.setSystemTime(now + 20 * MIN);
    await checkAway(deps);
    expect(pause).toHaveBeenCalledOnce();

    vi.setSystemTime(now + 21 * MIN);
    await checkAway(deps);
    expect(pause).toHaveBeenLastCalledWith(1, now + 11 * MIN);
  });

  it("no game on this PC: asks nothing", async () => {
    setSessions([game({ timer: true }), game({ id: 2, console: "PS5" })]);
    await checkAway(deps);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("setting off: never pauses, and an auto pause resumes at once", async () => {
    setAutoPause(false);
    setSessions([game()]);
    activity.inputIdleMs = 60 * MIN;
    await checkAway(deps);
    expect(invokeMock).not.toHaveBeenCalled();
    expect(pause).not.toHaveBeenCalled();

    setSessions([awayPaused(now - 30 * MIN)]);
    await checkAway(deps);
    expect(resume).toHaveBeenCalledWith(1, now);
  });
});
