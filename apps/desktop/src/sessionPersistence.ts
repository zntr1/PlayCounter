export const MIN_SESSION_DURATION_SECONDS = 60;

export function filterPersistableSessions<
  T extends { durationSeconds: number | null },
>(sessions: T[]): T[] {
  return sessions.filter(
    (session) =>
      session.durationSeconds !== null &&
      session.durationSeconds >= MIN_SESSION_DURATION_SECONDS,
  );
}
