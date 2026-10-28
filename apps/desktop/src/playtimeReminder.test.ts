import type { Session } from "@playcounter/shared";
import { describe, expect, it } from "vitest";
import { advanceReminder, todayPlaySeconds } from "./playtimeReminder";
import type { ActiveSession } from "./store";

const at = (hours: number, minutes = 0) =>
  new Date(2026, 9, 28, hours, minutes).getTime();
const iso = (ms: number) => new Date(ms).toISOString();

function finished(fromMs: number, minutes: number): Session {
  return {
    id: fromMs,
    gameId: 1,
    exeName: "game.exe",
    startedAt: iso(fromMs),
    endedAt: iso(fromMs + minutes * 60_000),
    durationSeconds: minutes * 60,
  };
}

function running(
  fromMs: number,
  extra: Partial<ActiveSession> = {},
): ActiveSession {
  return {
    id: fromMs,
    gameId: 2,
    gameName: "Game",
    exeName: "game.exe",
    coverUrl: "",
    startedAt: iso(fromMs),
    checkpointedAt: iso(fromMs),
    ...extra,
  };
}

describe("today's playtime", () => {
  it("adds finished and running games since midnight", () => {
    const now = at(15);
    expect(
      todayPlaySeconds(
        [finished(at(10), 60), finished(at(9, 30) - 86_400_000, 120)],
        [running(at(14))],
        now,
      ),
    ).toBe(2 * 3600);
  });

  it("counts only the part of a session after midnight", () => {
    expect(
      todayPlaySeconds([finished(at(23) - 86_400_000, 120)], [], at(9)),
    ).toBe(3600);
  });

  it("counts a game restored after a crash up to its last checkpoint", () => {
    expect(
      todayPlaySeconds(
        [],
        [
          running(at(10), {
            recoveredFromCheckpoint: true,
            checkpointedAt: iso(at(10, 30)),
          }),
        ],
        at(12),
      ),
    ).toBe(1800);
  });
});

describe("reminder steps", () => {
  const day = at(0);
  const check = (
    progress: Parameters<typeof advanceReminder>[0],
    todaySeconds: number,
    extra: Partial<Parameters<typeof advanceReminder>[1]> = {},
  ) =>
    advanceReminder(progress, {
      dayStartMs: day,
      minutes: 120,
      todaySeconds,
      playing: true,
      ...extra,
    });

  it("only notes where today stands when it starts", () => {
    const first = check(null, 3 * 3600);
    expect(first.remind).toBe(false);
    expect(first.progress.step).toBe(1);
    // The next popup comes at 4 h, not right away.
    expect(check(first.progress, 3.9 * 3600).remind).toBe(false);
    expect(check(first.progress, 4 * 3600).remind).toBe(true);
  });

  it("reminds every interval, once each", () => {
    let progress = check(null, 0).progress;
    const reminded: number[] = [];
    for (let minute = 0; minute <= 6 * 60; minute += 1) {
      const next = check(progress, minute * 60);
      progress = next.progress;
      if (next.remind) reminded.push(minute);
    }
    expect(reminded).toEqual([120, 240, 360]);
  });

  it("starts over on a new day and after the interval changes", () => {
    const progress = check(null, 2 * 3600).progress;
    expect(
      check(progress, 2.5 * 3600, { dayStartMs: day + 86_400_000 }).remind,
    ).toBe(false);
    expect(check(progress, 5 * 3600, { minutes: 60 }).remind).toBe(false);
  });

  it("stays quiet for time added while nothing runs", () => {
    const progress = check(null, 0).progress;
    const added = check(progress, 2 * 3600, { playing: false });
    expect(added.remind).toBe(false);
    // Playing on afterwards does not fire the step that was skipped.
    expect(check(added.progress, 2.2 * 3600).remind).toBe(false);
  });
});
