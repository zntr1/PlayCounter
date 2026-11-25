/* The server allows a route 30 requests a minute per address. Request 31 gets
   a 429, and a 429 pauses every call of the app for a minute
   (rateLimitedFetch.ts). Work that sends many requests in a row waits its
   turn instead (docs/cover-refresh-plan.md, "Never past the limit"). */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetRequestPaceForTests, waitForRequestTurn } from "./requestPace";

const route = "https://api.example.test/api/games/covers";
const MINUTE = 60_000;

/** Starts `count` requests one after another, as a loader does, and records
 *  when each one was let through. */
function send(count: number, to = route, perMinute = 25) {
  const sentAt: number[] = [];
  const done = (async () => {
    for (let index = 0; index < count; index += 1) {
      await waitForRequestTurn(to, perMinute);
      sentAt.push(Date.now());
    }
  })();
  return { sentAt, done };
}

/** The most requests let through in any 60 seconds. */
function busiestMinute(sentAt: number[]) {
  return Math.max(
    ...sentAt.map(
      (from) => sentAt.filter((at) => at >= from && at < from + MINUTE).length,
    ),
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  resetRequestPaceForTests();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("many requests in a row to one route", () => {
  it("lets 25 through at once and holds the next until a minute has passed", async () => {
    const start = Date.now();
    const { sentAt, done } = send(26);

    await vi.advanceTimersByTimeAsync(0);
    expect(sentAt).toHaveLength(25);

    await vi.advanceTimersByTimeAsync(59_000);
    expect(sentAt).toHaveLength(25);

    await vi.advanceTimersByTimeAsync(5_000);
    await done;
    expect(sentAt).toHaveLength(26);
    expect(sentAt[25] - start).toBeGreaterThanOrEqual(MINUTE);
  });

  it("a library of 3,000 games (30 requests) never sends more than 25 in a minute", async () => {
    const { sentAt, done } = send(30);

    await vi.advanceTimersByTimeAsync(3 * MINUTE);
    await done;

    expect(sentAt).toHaveLength(30);
    expect(busiestMinute(sentAt)).toBeLessThanOrEqual(25);
  });

  it("a second burst right after the first waits too", async () => {
    const first = send(20);
    await vi.advanceTimersByTimeAsync(0);
    await first.done;

    const second = send(20);
    await vi.advanceTimersByTimeAsync(5 * MINUTE);
    await second.done;

    expect(
      busiestMinute([...first.sentAt, ...second.sentAt]),
    ).toBeLessThanOrEqual(25);
  });

  it("counts every route on its own", async () => {
    const covers = send(25);
    const changes = send(1, "https://api.example.test/api/games/cover-changes");

    await vi.advanceTimersByTimeAsync(0);

    expect(covers.sentAt).toHaveLength(25);
    expect(changes.sentAt).toHaveLength(1);
  });

  it("gives up the wait when the work is stopped", async () => {
    const full = send(25);
    await vi.advanceTimersByTimeAsync(0);
    await full.done;
    const controller = new AbortController();

    const waiting = waitForRequestTurn(route, 25, controller.signal);
    const outcome = expect(waiting).rejects.toThrow();
    controller.abort();

    await outcome;
    // The stopped request took no turn: one more goes once a turn is free.
    const next = send(1);
    await vi.advanceTimersByTimeAsync(2 * MINUTE);
    await next.done;
    expect(next.sentAt).toHaveLength(1);
  });
});
