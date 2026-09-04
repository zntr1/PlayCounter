import type { Session } from "@playcounter/shared";
import { getSessionGameKey } from "../historyStats";
import type { GameIdentityResolver } from "../store";

/* Per-game session statistics for the details view ───────────────────────────
   The card shows a total and a session count; this is everything else you can
   ask about one game's history. Sessions are picked with exactly the key
   History filters on (getSessionGameKey), so the two views can never disagree
   about which sessions belong to a game.

   Caveat the UI has to state rather than hide: only the newest
   MAX_STORED_SESSIONS sessions survive on disk, older ones are folded into
   archivedGameSeconds. Totals stay right; "first played" and "longest session"
   describe the retained window. */

export type GameSessionStats = {
  sessionCount: number;
  trackedSeconds: number;
  averageSeconds: number;
  longestSeconds: number;
  longestSessionStartedAt: string | null;
  firstPlayedAt: string | null;
  lastPlayedAt: string | null;
  daysPlayed: number;
  last30DaysSeconds: number;
  last30DaysSessions: number;
  /** True when older sessions were dropped, so the window is partial. */
  truncated: boolean;
};

export const RECENT_WINDOW_DAYS = 30;
const RECENT_WINDOW_MS = RECENT_WINDOW_DAYS * 86_400_000;

export const EMPTY_GAME_SESSION_STATS: GameSessionStats = {
  sessionCount: 0,
  trackedSeconds: 0,
  averageSeconds: 0,
  longestSeconds: 0,
  longestSessionStartedAt: null,
  firstPlayedAt: null,
  lastPlayedAt: null,
  daysPlayed: 0,
  last30DaysSeconds: 0,
  last30DaysSessions: 0,
  truncated: false,
};

function dayKey(startedAtMs: number) {
  const date = new Date(startedAtMs);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

export function summarizeGameSessions(
  sessions: readonly Session[],
  options: {
    /** The summary's historyGameKey. Null for a game with no sessions yet. */
    gameKey: string | null;
    resolveIgdbId?: GameIdentityResolver;
    /** Seconds rolled into the archive because their sessions aged out. */
    archivedSeconds?: number;
    nowMs: number;
  },
): GameSessionStats {
  if (!options.gameKey) return EMPTY_GAME_SESSION_STATS;

  const mine = sessions
    .filter(
      (session) =>
        getSessionGameKey(session, options.resolveIgdbId) === options.gameKey,
    )
    .sort(
      (left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt),
    );

  if (mine.length === 0) {
    return {
      ...EMPTY_GAME_SESSION_STATS,
      truncated: (options.archivedSeconds ?? 0) > 0,
    };
  }

  const recentSince = options.nowMs - RECENT_WINDOW_MS;
  const days = new Set<string>();
  let trackedSeconds = 0;
  let longestSeconds = 0;
  let longestSessionStartedAt: string | null = null;
  let last30DaysSeconds = 0;
  let last30DaysSessions = 0;

  for (const session of mine) {
    const seconds = Math.max(0, session.durationSeconds ?? 0);
    trackedSeconds += seconds;
    if (seconds > longestSeconds) {
      longestSeconds = seconds;
      longestSessionStartedAt = session.startedAt;
    }
    const startedAtMs = Date.parse(session.startedAt);
    if (!Number.isFinite(startedAtMs)) continue;
    days.add(dayKey(startedAtMs));
    if (startedAtMs >= recentSince) {
      last30DaysSeconds += seconds;
      last30DaysSessions += 1;
    }
  }

  return {
    sessionCount: mine.length,
    trackedSeconds,
    averageSeconds: Math.round(trackedSeconds / mine.length),
    longestSeconds,
    longestSessionStartedAt,
    // Sorted newest first, so the oldest retained session is the last one.
    firstPlayedAt: mine[mine.length - 1].startedAt,
    lastPlayedAt: mine[0].endedAt ?? mine[0].startedAt,
    daysPlayed: days.size,
    last30DaysSeconds,
    last30DaysSessions,
    truncated: (options.archivedSeconds ?? 0) > 0,
  };
}
