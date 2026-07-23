type PlaytimeSession = {
  durationSeconds: number | null;
  startedAt: string;
  endedAt: string | null;
};

function withDuration<T extends PlaytimeSession>(
  session: T,
  durationSeconds: number,
): T {
  const endedAt = session.endedAt ?? session.startedAt;
  return {
    ...session,
    durationSeconds,
    startedAt: new Date(
      Date.parse(endedAt) - durationSeconds * 1000,
    ).toISOString(),
  };
}

export function adjustPlaytimeSessions<T extends PlaytimeSession>(
  sessions: T[],
  targetSeconds: number,
): T[] {
  const target = Math.max(0, Math.round(targetSeconds));
  const current = sessions.reduce(
    (total, session) => total + (session.durationSeconds ?? 0),
    0,
  );

  if (sessions.length === 0 || target === current) return sessions;
  if (target > current) {
    return [
      withDuration(
        sessions[0],
        (sessions[0].durationSeconds ?? 0) + target - current,
      ),
      ...sessions.slice(1),
    ];
  }

  if (target === 0) return [];

  const adjusted: T[] = [];
  let remaining = target;

  for (const session of sessions) {
    if (remaining === 0) break;
    const durationSeconds = session.durationSeconds ?? 0;

    if (durationSeconds <= remaining) {
      if (durationSeconds > 0) adjusted.push(session);
      remaining -= durationSeconds;
      continue;
    }

    if (remaining < 60 && adjusted.length > 0) {
      const previous = adjusted.pop()!;
      adjusted.push(
        withDuration(previous, (previous.durationSeconds ?? 0) + remaining),
      );
      remaining = 0;
      continue;
    }

    adjusted.push(withDuration(session, remaining));
    remaining = 0;
  }

  return adjusted;
}
