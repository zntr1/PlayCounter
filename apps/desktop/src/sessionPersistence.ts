export const MIN_SESSION_DURATION_SECONDS = 60;
// 2,500 representative sessions plus 300 cache/metadata entries serialize to
// ~0.80M characters (~1.59 MiB at a conservative two bytes per code unit),
// leaving substantial headroom under both 5 MiB and 10 MiB WebView budgets.
export const MAX_STORED_SESSIONS = 2_500;

export function filterPersistableSessions<
  T extends { durationSeconds: number | null },
>(sessions: T[]): T[] {
  return sessions.filter(
    (session) =>
      session.durationSeconds !== null &&
      session.durationSeconds >= MIN_SESSION_DURATION_SECONDS,
  );
}

export function normalizeSessions<
  T extends { durationSeconds: number | null; startedAt: string },
>(sessions: T[], limit = MAX_STORED_SESSIONS): T[] {
  return splitStoredSessions(sessions, limit).kept;
}

export function splitStoredSessions<
  T extends { durationSeconds: number | null; startedAt: string },
>(sessions: T[], limit = MAX_STORED_SESSIONS) {
  const normalized = filterPersistableSessions(sessions).sort(
    (left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt),
  );
  return {
    kept: normalized.slice(0, limit),
    removed: normalized.slice(limit),
  };
}
