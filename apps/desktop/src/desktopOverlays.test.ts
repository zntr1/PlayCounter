import type { Settings } from "@playcounter/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildOverlayMessage,
  compareOverlayMessages,
  DesktopOverlayQueue,
  DiscoveryAggregator,
  DISCOVERY_BURST_MS,
  overlayGate,
  passiveEligibleAt,
  resetOverlaySequenceForTests,
  type DesktopOverlayKind,
  type DesktopOverlayMessage,
} from "./desktopOverlays";

const settings: Settings = {
  launchOnStartup: false,
  showDurationDays: false,
  autoShareIgnoredProcesses: false,
  pollingIntervalSeconds: 5,
  unmatchedRetryDays: 30,
  apiEndpoint: "http://localhost",
  verboseLogs: false,
  theme: "dark",
  accentColor: null,
  desktopOverlaysEnabled: true,
};

class Scheduler {
  nowMs = 0;
  nextHandle = 1;
  timers = new Map<number, { at: number; callback: () => void }>();

  setTimer = (delayMs: number, callback: () => void) => {
    const handle = this.nextHandle++;
    this.timers.set(handle, { at: this.nowMs + delayMs, callback });
    return handle;
  };
  clearTimer = (handle: number) => void this.timers.delete(handle);
  advance(ms: number) {
    const target = this.nowMs + ms;
    while (true) {
      const due = [...this.timers.entries()]
        .filter(([, timer]) => timer.at <= target)
        .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!due) break;
      this.nowMs = due[1].at;
      this.timers.delete(due[0]);
      due[1].callback();
    }
    this.nowMs = target;
  }
}

function message(
  kind: DesktopOverlayKind,
  createdAtMs: number,
): DesktopOverlayMessage {
  return buildOverlayMessage(
    kind,
    kind === "discovery"
      ? { type: "discovery-burst", exeCount: 1 }
      : kind === "session-summary" || kind === "milestone"
        ? {
            type: "session-ended",
            gameName: "Game",
            durationSeconds: 700,
            totalSeconds: 3_700,
            ...(kind === "milestone"
              ? { milestoneTitle: "10 hours", milestoneMetric: "10 HRS" }
              : {}),
          }
        : {
            type: "session-started",
            gameName: "Game",
            firstAutoDetection: kind === "first-detection",
          },
    {
      nowMs: createdAtMs,
      theme: "dark",
      accentColor: null,
      reducedMotion: false,
    },
  );
}

beforeEach(() => resetOverlaySequenceForTests());

describe("desktop overlay policy", () => {
  it("keeps first detections and milestones mutually exclusive with routine cards", () => {
    expect(
      overlayGate(
        {
          type: "session-started",
          gameName: "Game",
          firstAutoDetection: true,
        },
        { ...settings, overlaySessionStarts: true },
      ),
    ).toBe("first-detection");
    expect(
      overlayGate(
        {
          type: "session-ended",
          gameName: "Game",
          durationSeconds: 700,
          totalSeconds: 700,
          milestoneTitle: "10 hours",
        },
        settings,
      ),
    ).toBe("milestone");
  });

  it("honours the master and child toggles", () => {
    const event = {
      type: "session-started" as const,
      gameName: "Game",
      firstAutoDetection: true,
    };
    expect(
      overlayGate(event, { ...settings, desktopOverlaysEnabled: false }),
    ).toBeNull();
    expect(
      overlayGate(event, { ...settings, overlayFirstDetections: false }),
    ).toBeNull();
  });

  it("keeps the launched process on session-start cards for monitor targeting", () => {
    const card = buildOverlayMessage(
      "session-start",
      {
        type: "session-started",
        gameName: "Game",
        firstAutoDetection: false,
        targetPids: [4242, 4343],
      },
      {
        nowMs: 100,
        theme: "dark",
        accentColor: null,
        reducedMotion: false,
      },
    );

    expect(card.targetPids).toEqual([4242, 4343]);
  });

  it.each([
    "session-start",
    "first-detection",
    "session-summary",
    "discovery",
    "milestone",
  ] satisfies DesktopOverlayKind[])(
    "keeps %s cards visible for ten seconds",
    (kind) => {
      expect(message(kind, 100).durationMs).toBe(10_000);
    },
  );

  it("makes session duration the sole playtime value in summary cards", () => {
    const card = message("session-summary", 100);

    expect(card.metric).toBe("11m");
    expect(card.body).toBeUndefined();
  });

  it("orders priority first, then newest, then sequence", () => {
    const old = message("session-start", 1);
    const newer = message("session-start", 2);
    const milestone = message("milestone", 0);
    expect([old, newer, milestone].sort(compareOverlayMessages)).toEqual([
      milestone,
      newer,
      old,
    ]);
  });

  it("distinguishes a passive card shown at t=0 from no card", () => {
    expect(passiveEligibleAt(1, [0], 0)).toBe(8_000);
  });
});

describe("DesktopOverlayQueue", () => {
  it("waits the full passive gap after a card shown at t=0", () => {
    const scheduler = new Scheduler();
    const shown: string[] = [];
    const queue = new DesktopOverlayQueue({
      now: () => scheduler.nowMs,
      setTimer: scheduler.setTimer,
      clearTimer: scheduler.clearTimer,
      show: (item) => shown.push(item.id),
      hide: vi.fn(),
    });
    const first = message("session-start", 0);
    queue.push(first);
    queue.handleFinished(first.id);
    scheduler.advance(1);
    const second = message("discovery", 1);
    queue.push(second);
    expect(shown).toEqual([first.id]);
    scheduler.advance(7_999);
    expect(shown).toEqual([first.id, second.id]);
  });

  it("uses the safety timeout only when no completion arrives", () => {
    const scheduler = new Scheduler();
    const hide = vi.fn();
    const item = message("milestone", 0);
    const queue = new DesktopOverlayQueue({
      now: () => scheduler.nowMs,
      setTimer: scheduler.setTimer,
      clearTimer: scheduler.clearTimer,
      show: vi.fn(),
      hide,
    });
    queue.push(item);
    scheduler.advance(item.durationMs + 1_799);
    expect(hide).not.toHaveBeenCalled();
    scheduler.advance(1);
    expect(hide).toHaveBeenCalledWith(item.id);
  });
});

describe("DiscoveryAggregator", () => {
  it("bundles unique executable names and arms cooldown only after acceptance", async () => {
    const scheduler = new Scheduler();
    const onBurst = vi.fn().mockResolvedValue(true);
    const aggregator = new DiscoveryAggregator({
      now: () => scheduler.nowMs,
      setTimer: scheduler.setTimer,
      clearTimer: scheduler.clearTimer,
      onBurst,
    });
    aggregator.note("A.exe");
    aggregator.note("a.EXE");
    aggregator.note("b.exe");
    scheduler.advance(DISCOVERY_BURST_MS);
    await Promise.resolve();
    expect(onBurst).toHaveBeenCalledWith(2, 0);
    expect(aggregator.cooldownUntilMs()).toBeGreaterThan(scheduler.nowMs);
  });

  it("does not arm cooldown on suppression and cancels in-flight results", async () => {
    const scheduler = new Scheduler();
    let resolve!: (accepted: boolean) => void;
    const onBurst = vi.fn(
      () => new Promise<boolean>((done) => (resolve = done)),
    );
    const aggregator = new DiscoveryAggregator({
      now: () => scheduler.nowMs,
      setTimer: scheduler.setTimer,
      clearTimer: scheduler.clearTimer,
      onBurst,
    });
    aggregator.note("a.exe");
    scheduler.advance(DISCOVERY_BURST_MS);
    aggregator.cancelOpenBurst();
    resolve(true);
    await Promise.resolve();
    expect(aggregator.cooldownUntilMs()).toBe(0);
  });
});
