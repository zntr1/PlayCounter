/* Time the PC slept (standby or hibernation) is never played time. Nothing
   runs while the PC sleeps, also not PlayCounter's clock, so a long silence
   between two ticks of the scan clock means it slept; afterwards the game
   simply runs on, and without this every counter would add the whole night.
   Same rule as the software counter (toolUsage.ts): a gap longer than five
   minutes. A slow app (timers held back in the background) stays under it. */

export const ASLEEP_AFTER_MS = 5 * 60 * 1000;

export type SleepGap = { fromMs: number; toMs: number };

let lastAwakeAtMs: number | undefined;

/** One tick of the scan clock. Returns the stretch the PC slept since the
 *  previous tick, or null. The first tick only starts the watch. */
export function noticeSleep(nowMs: number): SleepGap | null {
  const previous = lastAwakeAtMs;
  lastAwakeAtMs = nowMs;
  if (previous === undefined || nowMs - previous <= ASLEEP_AFTER_MS) {
    return null;
  }
  return { fromMs: previous, toMs: nowMs };
}

/** The tracker stopped: its next start begins a new watch. */
export function resetSleepWatch() {
  lastAwakeAtMs = undefined;
}

type PausableSession = {
  startedAt: string;
  pausedAt?: string;
  pausedMs?: number;
  resumedAt?: string;
  timer?: true;
  console?: unknown;
};

type Sleepable = { pausedMs?: number; resumedAt?: string };

/** Adds the part of the sleep after `startIso` as a finished pause. */
function withSleepOff<T extends Sleepable>(
  counted: T,
  startIso: string,
  gap: SleepGap,
): T {
  const startMs = Date.parse(startIso);
  const fromMs = Number.isFinite(startMs)
    ? Math.max(gap.fromMs, startMs)
    : gap.fromMs;
  if (!(gap.toMs > fromMs)) return counted;
  return {
    ...counted,
    pausedMs: (counted.pausedMs ?? 0) + (gap.toMs - fromMs),
    // A pause dated back (auto pause) must not reach into the sleep again.
    resumedAt: new Date(gap.toMs).toISOString(),
  };
}

/** A session takes the sleep off as a finished pause. A timer or a
 *  PlayStation session counts play away from this PC, which goes on while
 *  the PC sleeps; a paused session is already not counting. */
export function skipSleepInSession<T extends PausableSession>(
  session: T,
  gap: SleepGap,
): T {
  if (session.timer || session.console || session.pausedAt) return session;
  return withSleepOff(session, session.startedAt, gap);
}

type OpenStretch = { runningSince?: string; trackedSeconds?: number };

/** Something counted from `runningSince` on (a Discovered app, an emulator
 *  game not yet known): keeps the time before the sleep, starts over at the
 *  wake. */
export function skipSleepInStretch<T extends OpenStretch>(
  entry: T,
  gap: SleepGap,
): T {
  if (!entry.runningSince) return entry;
  const sinceMs = Date.parse(entry.runningSince);
  const beforeMs = Number.isFinite(sinceMs)
    ? Math.max(0, gap.fromMs - sinceMs)
    : 0;
  return {
    ...entry,
    ...(beforeMs > 0
      ? { trackedSeconds: (entry.trackedSeconds ?? 0) + beforeMs / 1000 }
      : {}),
    runningSince: new Date(gap.toMs).toISOString(),
  };
}

type PickerWait = {
  detectedAt: string;
  endedAt?: string;
  pausedMs?: number;
  resumedAt?: string;
};

/** An exe waiting in the picker counts from its detection; a sleep while it
 *  runs comes off the session it becomes. */
export function skipSleepInPicker<T extends PickerWait>(
  ambiguous: T,
  gap: SleepGap,
): T {
  if (ambiguous.endedAt) return ambiguous;
  return withSleepOff(ambiguous, ambiguous.detectedAt, gap);
}
