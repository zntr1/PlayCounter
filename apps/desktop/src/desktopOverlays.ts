import type { Settings } from "@playcounter/shared";
import type { AppNotification } from "./notifications";
import { parseMilestoneId } from "./milestones";
import { formatDuration } from "./ui/components";
import type {
  DesktopOverlayKind,
  DesktopOverlayMessage,
  OverlayRenderContext,
} from "./desktopOverlayProtocol";
export {
  OVERLAY_CLEAR_EVENT,
  OVERLAY_FINISHED_EVENT,
  OVERLAY_SHOW_EVENT,
} from "./desktopOverlayProtocol";
export type {
  DesktopOverlayKind,
  DesktopOverlayMessage,
  OverlayRenderContext,
} from "./desktopOverlayProtocol";

export const OVERLAY_PRIORITY: Record<DesktopOverlayKind, number> = {
  milestone: 5,
  "first-detection": 4,
  "session-summary": 3,
  "session-start": 2,
  discovery: 1,
};

export const PASSIVE_KINDS: ReadonlySet<DesktopOverlayKind> = new Set([
  "session-start",
  "discovery",
]);
export const PASSIVE_MIN_GAP_MS = 8_000;
export const PASSIVE_BUDGET_WINDOW_MS = 600_000;
export const PASSIVE_BUDGET_COUNT = 3;
export const MAX_PENDING = 3;
export const SAFETY_MARGIN_MS = 1_800;
export const DISCOVERY_BURST_MS = 30_000;
export const DISCOVERY_COOLDOWN_MS = 1_800_000;

const HOLD_MS: Record<DesktopOverlayKind, number> = {
  "session-start": 5_000,
  "first-detection": 5_000,
  "session-summary": 4_200,
  discovery: 4_200,
  milestone: 4_800,
};

const TTL_MS: Record<DesktopOverlayKind, number> = {
  "session-start": 20_000,
  "session-summary": 15 * 60_000,
  "first-detection": 5 * 60_000,
  discovery: 5 * 60_000,
  milestone: 5 * 60_000,
};

export type OverlayEvent =
  | {
      type: "session-started";
      gameName: string;
      coverUrl?: string;
      firstAutoDetection: boolean;
      targetPids?: number[];
    }
  | {
      type: "session-ended";
      gameName: string;
      coverUrl?: string;
      durationSeconds: number;
      totalSeconds: number;
      milestoneTitle?: string;
      milestoneMetric?: string;
      milestoneGameScoped?: boolean;
    }
  | { type: "discovery-burst"; exeCount: number };

export type TrackerOverlayEvent = Exclude<
  OverlayEvent,
  { type: "discovery-burst" }
>;

let nextSequence = 0;

export function resetOverlaySequenceForTests() {
  nextSequence = 0;
}

export function overlayGate(
  event: OverlayEvent,
  settings: Settings,
): DesktopOverlayKind | null {
  if (settings.desktopOverlaysEnabled !== true) return null;
  if (event.type === "session-started") {
    if (event.firstAutoDetection) {
      return settings.overlayFirstDetections !== false
        ? "first-detection"
        : null;
    }
    return settings.overlaySessionStarts === true ? "session-start" : null;
  }
  if (event.type === "session-ended") {
    if (event.milestoneTitle) {
      return settings.overlayMilestones !== false ? "milestone" : null;
    }
    return event.durationSeconds >= 600 &&
      settings.overlaySessionSummaries !== false
      ? "session-summary"
      : null;
  }
  return settings.overlayDiscoveries === true ? "discovery" : null;
}

export function buildOverlayMessage(
  kind: DesktopOverlayKind,
  event: OverlayEvent,
  context: OverlayRenderContext,
): DesktopOverlayMessage {
  const sequence = nextSequence++;
  const copy = overlayCopy(kind, event);
  return {
    id: `${kind}:${context.nowMs}:${sequence}`,
    sequence,
    kind,
    targetPids: event.type === "session-started" ? event.targetPids : undefined,
    priority: OVERLAY_PRIORITY[kind],
    ...copy,
    theme: context.theme,
    accentColor: context.accentColor,
    reducedMotion: context.reducedMotion,
    durationMs: HOLD_MS[kind],
    createdAtMs: context.nowMs,
    expiresAtMs: context.nowMs + TTL_MS[kind],
  };
}

function overlayCopy(
  kind: DesktopOverlayKind,
  event: OverlayEvent,
): Pick<
  DesktopOverlayMessage,
  "kicker" | "title" | "body" | "metric" | "status" | "coverUrl"
> {
  if (kind === "discovery" && event.type === "discovery-burst") {
    return event.exeCount === 1
      ? {
          kicker: "NEW APP FOUND",
          title: "PlayCounter doesn't know this one",
          body: "Open Discovered to sort it out.",
        }
      : {
          kicker: "NEW APPS FOUND",
          title: `${event.exeCount} new apps found`,
          body: "Open Discovered to sort them out.",
        };
  }
  if (event.type === "session-started") {
    return kind === "first-detection"
      ? {
          kicker: "NEW GAME DETECTED",
          title: event.gameName,
          body: "Found automatically. Tracking starts now.",
          status: "live",
          coverUrl: event.coverUrl,
        }
      : {
          kicker: "TRACKING STARTED",
          title: event.gameName,
          status: "live",
          coverUrl: event.coverUrl,
        };
  }
  if (event.type === "session-ended") {
    if (kind === "milestone") {
      return {
        kicker: "MILESTONE UNLOCKED",
        title: event.milestoneGameScoped
          ? event.gameName
          : (event.milestoneTitle ?? event.gameName),
        body: event.milestoneGameScoped
          ? `Session saved · ${formatDuration(event.durationSeconds)}`
          : `${event.gameName} · Session saved`,
        metric: event.milestoneMetric,
        coverUrl: event.coverUrl,
      };
    }
    return {
      kicker: "SESSION SAVED",
      title: event.gameName,
      body: `${formatDuration(event.totalSeconds)} total playtime`,
      metric: formatDuration(event.durationSeconds),
      coverUrl: event.coverUrl,
    };
  }
  throw new Error(`Event ${event.type} cannot render ${kind}`);
}

export function pickTopMilestone(
  notifications: AppNotification[],
): AppNotification | null {
  let top: AppNotification | null = null;
  let threshold = Number.NEGATIVE_INFINITY;
  for (const notification of notifications) {
    const parsed = parseMilestoneId(notification.id);
    if (!parsed || parsed.threshold <= threshold) continue;
    top = notification;
    threshold = parsed.threshold;
  }
  return top;
}

export function milestoneMetricLabel(id: string) {
  const parsed = parseMilestoneId(id);
  if (!parsed) return undefined;
  const unit =
    parsed.category === "verified" || parsed.category === "emulator"
      ? "APPROVED"
      : parsed.category === "streak"
        ? "DAYS"
        : "HRS";
  return `${parsed.threshold.toLocaleString()} ${unit}`;
}

export function compareOverlayMessages(
  left: DesktopOverlayMessage,
  right: DesktopOverlayMessage,
) {
  if (left.priority !== right.priority) {
    return right.priority - left.priority;
  }
  if (left.createdAtMs !== right.createdAtMs) {
    return right.createdAtMs - left.createdAtMs;
  }
  return right.sequence - left.sequence;
}

export function passiveEligibleAt(
  now: number,
  passiveShownAt: number[],
  lastPassiveAt: number | null,
) {
  const window = passiveShownAt.filter(
    (timestamp) => timestamp > now - PASSIVE_BUDGET_WINDOW_MS,
  );
  const gapFreeAt =
    lastPassiveAt === null
      ? Number.NEGATIVE_INFINITY
      : lastPassiveAt + PASSIVE_MIN_GAP_MS;
  const budgetFreeAt =
    window.length < PASSIVE_BUDGET_COUNT
      ? Number.NEGATIVE_INFINITY
      : window[window.length - PASSIVE_BUDGET_COUNT] + PASSIVE_BUDGET_WINDOW_MS;
  return Math.max(gapFreeAt, budgetFreeAt);
}

export function messageEligibleAt(
  message: DesktopOverlayMessage,
  now: number,
  passiveShownAt: number[],
  lastPassiveAt: number | null,
) {
  return PASSIVE_KINDS.has(message.kind)
    ? passiveEligibleAt(now, passiveShownAt, lastPassiveAt)
    : Number.NEGATIVE_INFINITY;
}

export type QueueDeps = {
  now: () => number;
  setTimer: (delayMs: number, callback: () => void) => number;
  clearTimer: (handle: number) => void;
  show: (message: DesktopOverlayMessage) => void;
  hide: (id: string) => void;
};

export class DesktopOverlayQueue {
  private state: "idle" | "showing" = "idle";
  private visible: DesktopOverlayMessage | null = null;
  private pending: DesktopOverlayMessage[] = [];
  private passiveShownAt: number[] = [];
  private lastPassiveAt: number | null = null;
  private safetyTimer: number | null = null;
  private drainTimer: number | null = null;
  private disposed = false;

  constructor(private readonly deps: QueueDeps) {}

  push(message: DesktopOverlayMessage) {
    if (this.disposed) return false;
    const now = this.deps.now();
    this.prune(now);
    if (message.expiresAtMs <= now) {
      this.scheduleDrain();
      return false;
    }
    this.pending.push(message);
    this.pending.sort(compareOverlayMessages);
    let accepted = true;
    while (this.pending.length > MAX_PENDING) {
      if (this.pending.pop() === message) accepted = false;
    }
    this.drainNow();
    return accepted;
  }

  handleFinished(id: string) {
    if (this.state !== "showing" || this.visible?.id !== id) return;
    this.clearSafetyTimer();
    this.visible = null;
    this.state = "idle";
    this.drainNow();
  }

  clear() {
    if (this.state === "showing" && this.visible) {
      this.deps.hide(this.visible.id);
    }
    this.visible = null;
    this.state = "idle";
    this.pending = [];
    this.clearSafetyTimer();
    this.clearDrainTimer();
  }

  dispose() {
    if (this.disposed) return;
    this.clear();
    this.disposed = true;
  }

  private drainNow() {
    if (this.disposed) return;
    if (this.state === "showing") {
      this.scheduleDrain();
      return;
    }
    const now = this.deps.now();
    this.prune(now);
    const index = this.pending.findIndex(
      (message) =>
        messageEligibleAt(
          message,
          now,
          this.passiveShownAt,
          this.lastPassiveAt,
        ) <= now,
    );
    if (index < 0) {
      this.scheduleDrain();
      return;
    }
    const [message] = this.pending.splice(index, 1);
    if (PASSIVE_KINDS.has(message.kind)) {
      this.passiveShownAt.push(now);
      this.lastPassiveAt = now;
      this.prunePassiveHistory(now);
    }
    this.visible = message;
    this.state = "showing";
    this.clearDrainTimer();
    this.deps.show(message);
    const id = message.id;
    this.safetyTimer = this.deps.setTimer(
      message.durationMs + SAFETY_MARGIN_MS,
      () => {
        this.safetyTimer = null;
        if (this.visible?.id !== id) return;
        this.deps.hide(id);
        this.handleFinished(id);
      },
    );
    this.scheduleDrain();
  }

  private prune(now: number) {
    this.pending = this.pending.filter((message) => message.expiresAtMs > now);
    this.prunePassiveHistory(now);
  }

  private prunePassiveHistory(now: number) {
    this.passiveShownAt = this.passiveShownAt.filter(
      (timestamp) => timestamp > now - PASSIVE_BUDGET_WINDOW_MS,
    );
  }

  private scheduleDrain() {
    this.clearDrainTimer();
    if (
      this.disposed ||
      this.state === "showing" ||
      this.pending.length === 0
    ) {
      return;
    }
    const now = this.deps.now();
    let target = Number.POSITIVE_INFINITY;
    for (const message of this.pending) {
      target = Math.min(
        target,
        Math.max(
          now,
          messageEligibleAt(
            message,
            now,
            this.passiveShownAt,
            this.lastPassiveAt,
          ),
        ),
        message.expiresAtMs,
      );
    }
    if (!Number.isFinite(target)) return;
    this.drainTimer = this.deps.setTimer(Math.max(0, target - now), () => {
      this.drainTimer = null;
      this.drainNow();
    });
  }

  private clearSafetyTimer() {
    if (this.safetyTimer === null) return;
    this.deps.clearTimer(this.safetyTimer);
    this.safetyTimer = null;
  }

  private clearDrainTimer() {
    if (this.drainTimer === null) return;
    this.deps.clearTimer(this.drainTimer);
    this.drainTimer = null;
  }
}

export type DiscoveryAggregatorDeps = {
  now: () => number;
  setTimer: (delayMs: number, callback: () => void) => number;
  clearTimer: (handle: number) => void;
  onBurst: (exeCount: number, burstStartedAtMs: number) => Promise<boolean>;
};

export class DiscoveryAggregator {
  private burstExes = new Set<string>();
  private burstStartedAtMs: number | null = null;
  private burstTimer: number | null = null;
  private cooldownUntil = 0;
  private flushing = false;
  private epoch = 0;
  private disposed = false;

  constructor(private readonly deps: DiscoveryAggregatorDeps) {}

  note(exeName: string) {
    if (
      this.disposed ||
      this.flushing ||
      this.deps.now() < this.cooldownUntil
    ) {
      return;
    }
    this.burstExes.add(exeName.toLowerCase());
    if (this.burstTimer !== null) return;
    this.burstStartedAtMs = this.deps.now();
    this.burstTimer = this.deps.setTimer(DISCOVERY_BURST_MS, () =>
      this.onWindowElapsed(),
    );
  }

  cancelOpenBurst() {
    if (this.burstTimer !== null) this.deps.clearTimer(this.burstTimer);
    this.burstTimer = null;
    this.burstExes.clear();
    this.burstStartedAtMs = null;
    this.epoch += 1;
    this.flushing = false;
  }

  dispose() {
    if (this.disposed) return;
    this.cancelOpenBurst();
    this.disposed = true;
  }

  hasOpenBurst() {
    return this.burstTimer !== null || this.flushing;
  }

  cooldownUntilMs() {
    return this.cooldownUntil;
  }

  private onWindowElapsed() {
    this.burstTimer = null;
    const count = this.burstExes.size;
    const startedAt = this.burstStartedAtMs ?? this.deps.now();
    this.burstExes.clear();
    this.burstStartedAtMs = null;
    if (count === 0 || this.disposed) return;

    this.flushing = true;
    const epoch = this.epoch;
    void this.deps.onBurst(count, startedAt).then(
      (queued) => {
        if (this.disposed || this.epoch !== epoch) return;
        this.flushing = false;
        if (queued) {
          this.cooldownUntil = this.deps.now() + DISCOVERY_COOLDOWN_MS;
        }
      },
      () => {
        if (this.disposed || this.epoch !== epoch) return;
        this.flushing = false;
      },
    );
  }
}
