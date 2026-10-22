import type { Session } from "@playcounter/shared";
import { SESSION_NOTE_LIMIT } from "./personalLibrary";

/* Edit, split and combine History sessions. A session stays "start to end":
   its played time is always end − start, so none of these store anything new
   on a session. Pure functions on the session list; the tracker saves the
   result, the tour runs them on its sample store. Every result is sorted
   newest first, like the store keeps it. */

export type SessionTimes = { startMs: number; endMs: number };

const minuteMs = 60_000;

export function sessionTimes(session: Session): SessionTimes {
  const startMs = Date.parse(session.startedAt);
  // Old sessions without an end: the length says where it ended, as the
  // stats already count it.
  const endMs =
    session.durationSeconds !== null && Number.isFinite(session.durationSeconds)
      ? startMs + Math.max(0, session.durationSeconds) * 1000
      : Date.parse(session.endedAt ?? "");
  return { startMs, endMs };
}

function withTimes(
  session: Session,
  { startMs, endMs }: SessionTimes,
): Session {
  return {
    ...session,
    startedAt: new Date(startMs).toISOString(),
    endedAt: new Date(endMs).toISOString(),
    durationSeconds: Math.round((endMs - startMs) / 1000),
  };
}

function newestFirst(sessions: Session[]) {
  return sessions.sort(
    (left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt),
  );
}

/** Moves a session's start and end. Everything else on it stays. */
export function editSession(
  sessions: Session[],
  sessionId: number,
  times: SessionTimes,
): Session[] {
  if (!(times.endMs - times.startMs >= minuteMs)) return sessions;
  return newestFirst(
    sessions.map((session) =>
      session.id === sessionId ? withTimes(session, times) : session,
    ),
  );
}

/** Cuts a break out of a session. The later part keeps the id and the note
 *  (the session-ended popup points at that id); the earlier part gets
 *  `newId` and no note. Each part needs at least a minute. */
export function splitSession(
  sessions: Session[],
  sessionId: number,
  pause: SessionTimes,
  newId: number,
): Session[] {
  const session = sessions.find((entry) => entry.id === sessionId);
  if (!session) return sessions;
  const { startMs, endMs } = sessionTimes(session);
  if (
    !(pause.endMs >= pause.startMs) ||
    !(pause.startMs - startMs >= minuteMs) ||
    !(endMs - pause.endMs >= minuteMs)
  )
    return sessions;
  const { note: _note, ...withoutNote } = session;
  const earlier = withTimes(
    { ...withoutNote, id: newId },
    { startMs, endMs: pause.startMs },
  );
  const later = withTimes(session, { startMs: pause.endMs, endMs });
  return newestFirst([
    ...sessions.filter((entry) => entry.id !== sessionId),
    earlier,
    later,
  ]);
}

/** Joins two sessions into one, the time between them included. The later
 *  one stays (id, playthrough, file) and starts where the earlier one did.
 *  Notes are joined, earlier first; "Manual" if either was. */
export function combineSessions(
  sessions: Session[],
  firstId: number,
  secondId: number,
): Session[] {
  const pair = sessions.filter(
    (session) => session.id === firstId || session.id === secondId,
  );
  if (firstId === secondId || pair.length !== 2) return sessions;
  const [earlier, later] = pair.sort(
    (left, right) => sessionTimes(left).startMs - sessionTimes(right).startMs,
  );
  const note =
    [earlier.note, later.note]
      .filter(Boolean)
      .join("\n")
      .slice(0, SESSION_NOTE_LIMIT)
      .trim() || undefined;
  const { note: _note, ...laterWithoutNote } = later;
  const combined = withTimes(
    {
      ...laterWithoutNote,
      ...(note ? { note } : {}),
      ...(earlier.origin === "manual" || later.origin === "manual"
        ? { origin: "manual" as const }
        : {}),
    },
    {
      startMs: sessionTimes(earlier).startMs,
      endMs: Math.max(sessionTimes(earlier).endMs, sessionTimes(later).endMs),
    },
  );
  return newestFirst([
    ...sessions.filter(
      (session) => session.id !== earlier.id && session.id !== later.id,
    ),
    combined,
  ]);
}

/* The split slider's knob marks where the session splits, in whole minutes
   since the epoch. A break sits centred on the knob. */

/** Where the knob may go so that each part keeps at least a minute; null
 *  when a break of that length doesn't fit. */
export function splitKnobRange(
  { startMs, endMs }: SessionTimes,
  breakMinutes: number,
): { min: number; max: number } | null {
  const before = Math.floor(breakMinutes / 2);
  const min = Math.ceil((startMs + minuteMs) / minuteMs) + before;
  const max = Math.floor((endMs - minuteMs) / minuteMs) - breakMinutes + before;
  return min <= max ? { min, max } : null;
}

/** The break of `breakMinutes` centred on the knob. */
export function breakAround(
  knobMinute: number,
  breakMinutes: number,
): SessionTimes {
  const startMs = (knobMinute - Math.floor(breakMinutes / 2)) * minuteMs;
  return { startMs, endMs: startMs + breakMinutes * minuteMs };
}

export type SessionNeighbours = { before?: Session; after?: Session };

/** Each session's neighbours of the same game: the one right before it and
 *  the one right after, by start. */
export function sessionNeighbours(
  sessions: Session[],
  gameKey: (session: Session) => string,
): Map<number, SessionNeighbours> {
  const byGame = new Map<string, Session[]>();
  for (const session of sessions) {
    const key = gameKey(session);
    byGame.set(key, [...(byGame.get(key) ?? []), session]);
  }
  const neighbours = new Map<number, SessionNeighbours>();
  for (const games of byGame.values()) {
    games.sort(
      (left, right) =>
        sessionTimes(left).startMs - sessionTimes(right).startMs ||
        left.id - right.id,
    );
    games.forEach((session, index) =>
      neighbours.set(session.id, {
        before: games[index - 1],
        after: games[index + 1],
      }),
    );
  }
  return neighbours;
}

/** The earliest other session of the same game that new times would
 *  overlap. */
export function overlappingSession(
  sessions: Session[],
  session: Session,
  times: SessionTimes,
  gameKey: (session: Session) => string,
): Session | undefined {
  const key = gameKey(session);
  return sessions
    .filter((other) => {
      if (other.id === session.id || gameKey(other) !== key) return false;
      const { startMs, endMs } = sessionTimes(other);
      return startMs < times.endMs && endMs > times.startMs;
    })
    .sort(
      (left, right) => sessionTimes(left).startMs - sessionTimes(right).startMs,
    )[0];
}

/* The edit box has Started, Ended and Length. The two fields typed last win
   and the third one is filled in. Before the first change it acts as if
   Started was typed last (Ended before it), so changing only Length moves
   the end, only Ended or only Started changes the length. */

export type SessionTimeField = "start" | "end" | "length";
export type ChangedFields = readonly [SessionTimeField, SessionTimeField];
export type SessionTimeValues = {
  startMs: number;
  endMs: number;
  lengthSeconds: number;
};

export const UNCHANGED_FIELDS: ChangedFields = ["end", "start"];

export function changedFields(
  changed: ChangedFields,
  field: SessionTimeField,
): ChangedFields {
  return field === changed[1] ? changed : [changed[1], field];
}

/** Fills in the field that was not among the two typed last. */
export function fillSessionTimes(
  changed: ChangedFields,
  values: SessionTimeValues,
): SessionTimeValues {
  const filled = (["start", "end", "length"] as const).find(
    (field) => !changed.includes(field),
  );
  if (filled === "start")
    return { ...values, startMs: values.endMs - values.lengthSeconds * 1000 };
  if (filled === "end")
    return { ...values, endMs: values.startMs + values.lengthSeconds * 1000 };
  return {
    ...values,
    lengthSeconds: Math.round((values.endMs - values.startMs) / 1000),
  };
}
