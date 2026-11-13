/* A running session's time: since its start, minus every pause. Everything
   that shows or saves how long a running game was played goes through here
   (sessionTime.test.ts checks that), so a pause is never counted. */

type PausableSession = {
  startedAt: string;
  /** Set while paused: when the pause began. */
  pausedAt?: string;
  /** Finished pauses, added up. */
  pausedMs?: number;
};

/** The moment the clock would have started without the finished pauses. A
 *  window that ticks on its own counts up from here. */
export function countFromMs(session: PausableSession) {
  return Date.parse(session.startedAt) + Math.max(0, session.pausedMs ?? 0);
}

/** When the running pause began, or null while the session counts. */
export function pausedAtMs(session: PausableSession) {
  const at = session.pausedAt ? Date.parse(session.pausedAt) : Number.NaN;
  return Number.isFinite(at) ? at : null;
}

/** Played milliseconds up to `atMs`. A pause that began after `atMs` (a
 *  session ended at an earlier checkpoint) takes nothing off. */
export function playedMs(session: PausableSession, atMs: number) {
  const pausedAt = pausedAtMs(session);
  const end = pausedAt === null ? atMs : Math.min(atMs, pausedAt);
  const played = end - countFromMs(session);
  return Number.isFinite(played) ? Math.max(0, played) : 0;
}

/** Whole played seconds up to `atMs`, as the clocks show them. */
export function playedSeconds(session: PausableSession, atMs: number) {
  return Math.floor(playedMs(session, atMs) / 1000);
}

/** Whole seconds the running pause has lasted; 0 while the session counts. */
export function pausedForSeconds(session: PausableSession, atMs: number) {
  const pausedAt = pausedAtMs(session);
  return pausedAt === null
    ? 0
    : Math.max(0, Math.floor((atMs - pausedAt) / 1000));
}
