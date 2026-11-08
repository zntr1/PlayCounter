import type { Session } from "@playcounter/shared";
import { showPlaytimeReminderOverlay } from "./desktopOverlayBridge";
import { pausedAtMs, playedMs } from "./sessionTime";
import { useAppStore, type ActiveSession } from "./store";

/** The intervals Settings offers, in minutes. */
export const PLAYTIME_REMINDER_MINUTES = [30, 60, 120, 180, 240] as const;
const CHECK_INTERVAL_MS = 30_000;

export type ReminderProgress = {
  dayStartMs: number;
  minutes: number;
  /** How many intervals today's playtime had passed at the last check. */
  step: number;
};

function startOfLocalDay(nowMs: number) {
  const day = new Date(nowMs);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
}

/** Seconds played since local midnight, running games included. Games played
 *  at the same time count each, as in My History. */
export function todayPlaySeconds(
  sessions: Session[],
  activeSessions: ActiveSession[],
  nowMs: number,
) {
  const dayStartMs = startOfLocalDay(nowMs);
  let totalMs = 0;
  const add = (fromMs: number, toMs: number) => {
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) return;
    totalMs += Math.max(
      0,
      Math.min(toMs, nowMs) - Math.max(fromMs, dayStartMs),
    );
  };
  for (const session of sessions) {
    const fromMs = Date.parse(session.startedAt);
    add(
      fromMs,
      session.durationSeconds !== null
        ? fromMs + Math.max(0, session.durationSeconds) * 1000
        : Date.parse(session.endedAt ?? ""),
    );
  }
  for (const session of activeSessions) {
    // Restored after a crash: only the time up to the last checkpoint is
    // certain until the game is seen running again.
    const endMs = session.recoveredFromCheckpoint
      ? Date.parse(session.checkpointedAt)
      : nowMs;
    // Paused time is left out: the played time counts as one stretch up to
    // where the clock last ran (no pause times are kept).
    const lastCountedMs = Math.min(endMs, pausedAtMs(session) ?? endMs);
    add(lastCountedMs - playedMs(session, endMs), lastCountedMs);
  }
  return Math.floor(totalMs / 1000);
}

/**
 * Whether today's playtime just passed another multiple of the interval. A new
 * day, a changed interval or a fresh start only notes where today stands, so
 * switching the setting on after three hours does not pop up at once.
 */
export function advanceReminder(
  progress: ReminderProgress | null,
  {
    dayStartMs,
    minutes,
    todaySeconds,
    playing,
  }: {
    dayStartMs: number;
    minutes: number;
    todaySeconds: number;
    playing: boolean;
  },
): { progress: ReminderProgress; remind: boolean } {
  const step = Math.floor(todaySeconds / (minutes * 60));
  if (
    !progress ||
    progress.dayStartMs !== dayStartMs ||
    progress.minutes !== minutes
  ) {
    return { progress: { dayStartMs, minutes, step }, remind: false };
  }
  if (step <= progress.step) return { progress, remind: false };
  // A session added by hand while nothing runs is noted without a popup.
  return { progress: { ...progress, step }, remind: playing };
}

function reminderMinutes(value: number | null | undefined) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : null;
}

let timer: number | undefined;
let progress: ReminderProgress | null = null;

export function checkPlaytimeReminder(nowMs = Date.now()) {
  const store = useAppStore.getState();
  const minutes = reminderMinutes(store.settings.playtimeReminderMinutes);
  if (minutes === null) {
    progress = null;
    return;
  }
  const todaySeconds = todayPlaySeconds(
    store.recentSessions,
    store.activeSessions,
    nowMs,
  );
  const next = advanceReminder(progress, {
    dayStartMs: startOfLocalDay(nowMs),
    minutes,
    todaySeconds,
    playing: store.activeSessions.some(
      (session) => !session.recoveredFromCheckpoint,
    ),
  });
  progress = next.progress;
  if (next.remind) showPlaytimeReminderOverlay(todaySeconds);
}

export function initializePlaytimeReminder() {
  if (timer !== undefined) return;
  progress = null;
  checkPlaytimeReminder();
  timer = window.setInterval(() => checkPlaytimeReminder(), CHECK_INTERVAL_MS);
}

export function disposePlaytimeReminder() {
  if (timer === undefined) return;
  window.clearInterval(timer);
  timer = undefined;
  progress = null;
}
