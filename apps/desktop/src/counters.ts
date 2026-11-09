import type { Session } from "@playcounter/shared";
import { gameSecondsKey, gameSecondsRefFromKey } from "./gameSeconds";
import { getT } from "./i18n";

/* Counters (docs/counters-plan.md) ───────────────────────────────────────────
   A game has its own counters: Deaths to start with, then whatever the player
   adds ("Malenia", "Fish caught"). A count lives on the session it happened
   in, so History shows it and every total adds up from sessions. Sessions that
   age out of History leave their counts in an archive, so totals never
   shrink. */

const t = getT("nowPlaying");

export const DEATHS_COUNTER_ID = "deaths";
export const COUNTER_NAME_LIMIT = 60;
/** Per game; the box and Now Playing stay usable below this. */
export const COUNTER_LIMIT = 50;
const COUNT_LIMIT = 10_000_000;
const ID_LIMIT = 64;

export type GameCounter = {
  /** DEATHS_COUNTER_ID for the one every game starts with. */
  id: string;
  /** Absent for Deaths until it is renamed, so its name follows the app's
   *  language. */
  name?: string;
  /** Shown while you play: in the live timer and on Now Playing. */
  shown: boolean;
  /** The counter's own global key. It works while its game is running. */
  key?: string;
  createdAt: string;
};

/** Counter id -> count, only counts above 0. */
export type Counts = Record<string, number>;

/** The fields of GameJournal this module reads. */
export type CounterJournal = {
  /** Absent until the player changes them: Deaths, shown. */
  counters?: GameCounter[];
  /** The counter View + D-pad up counts. Absent = Deaths, null = none. */
  controllerCounterId?: string | null;
};

/** Older than anything the player adds, so it sorts last among its group. */
const DEATHS: GameCounter = Object.freeze({
  id: DEATHS_COUNTER_ID,
  shown: true,
  createdAt: "1970-01-01T00:00:00.000Z",
});
const DEFAULT_COUNTERS: readonly GameCounter[] = Object.freeze([DEATHS]);

export function journalCounters(
  journal: CounterJournal,
): readonly GameCounter[] {
  return journal.counters ?? DEFAULT_COUNTERS;
}

/** The order everywhere: the shown counters, then the hidden ones; newest
 *  first in each. */
export function orderedCounters(journal: CounterJournal): GameCounter[] {
  const rank = (counter: GameCounter) => (counter.shown ? 0 : 1);
  return [...journalCounters(journal)].sort(
    (left, right) =>
      rank(left) - rank(right) ||
      right.createdAt.localeCompare(left.createdAt) ||
      left.id.localeCompare(right.id),
  );
}

/** The counter the controller counts: one per game, Deaths until the player
 *  picks another or none. */
export function controllerCounterId(journal: CounterJournal): string | null {
  const id =
    journal.controllerCounterId === undefined
      ? DEATHS_COUNTER_ID
      : journal.controllerCounterId;
  return id !== null && journalCounters(journal).some((c) => c.id === id)
    ? id
    : null;
}

export function counterName(counter: Pick<GameCounter, "name">) {
  return counter.name ?? t("Deaths");
}

/** Same letters, any case: two counters of a game may not share a name. */
export function sameCounterName(left: string, right: string) {
  return (
    left.trim().localeCompare(right.trim(), undefined, {
      sensitivity: "accent",
    }) === 0
  );
}

/* Counts on a session ───────────────────────────────────────────────────── */

/** One counter moved by delta, never below 0; empty counts become absent. */
export function changedCounts(
  counts: Counts | undefined,
  counterId: string,
  delta: number,
): Counts | undefined {
  const next = { ...counts };
  const value = Math.min(
    COUNT_LIMIT,
    Math.max(0, (next[counterId] ?? 0) + Math.trunc(delta)),
  );
  if (value > 0) next[counterId] = value;
  else delete next[counterId];
  return Object.keys(next).length > 0 ? next : undefined;
}

/** The session with these counts; none removes the field. */
export function withCounts<T extends { counts?: Counts }>(
  session: T,
  counts: Counts | undefined,
): T {
  const { counts: _counts, ...rest } = session;
  return (counts ? { ...rest, counts } : rest) as T;
}

export function addCounts(
  left: Counts | undefined,
  right: Counts | undefined,
): Counts | undefined {
  if (!left) return right ? { ...right } : undefined;
  if (!right) return { ...left };
  const sum = { ...left };
  for (const [id, count] of Object.entries(right))
    sum[id] = Math.min(COUNT_LIMIT, (sum[id] ?? 0) + count);
  return sum;
}

export function withoutCounter(
  counts: Counts | undefined,
  counterId: string,
): Counts | undefined {
  if (!counts || !(counterId in counts)) return counts;
  const { [counterId]: _removed, ...rest } = counts;
  return Object.keys(rest).length > 0 ? rest : undefined;
}

function validCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function validId(id: string) {
  return id.length > 0 && id.length <= ID_LIMIT;
}

/** Saved or restored counts: anything that isn't a count above 0 is dropped. */
export function sanitizeCounts(value: unknown): Counts | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const counts: Counts = {};
  for (const [id, count] of Object.entries(value))
    if (validId(id) && validCount(count))
      counts[id] = Math.min(COUNT_LIMIT, count);
  return Object.keys(counts).length > 0 ? counts : undefined;
}

export function sanitizeGameCounters(value: unknown): GameCounter[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const seen = new Set<string>();
  const counters: GameCounter[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const entry = item as Record<string, unknown>;
    if (typeof entry.id !== "string" || !validId(entry.id)) continue;
    if (seen.has(entry.id)) continue;
    const name =
      typeof entry.name === "string"
        ? entry.name.trim().slice(0, COUNTER_NAME_LIMIT)
        : undefined;
    // Only Deaths may go without a name.
    if (!name && entry.id !== DEATHS_COUNTER_ID) continue;
    seen.add(entry.id);
    counters.push({
      id: entry.id,
      ...(name ? { name } : {}),
      shown: entry.shown !== false,
      ...(typeof entry.key === "string" && entry.key
        ? { key: entry.key.slice(0, 64) }
        : {}),
      createdAt:
        typeof entry.createdAt === "string" &&
        Number.isFinite(Date.parse(entry.createdAt))
          ? entry.createdAt
          : DEATHS.createdAt,
    });
  }
  return counters.slice(0, COUNTER_LIMIT);
}

/* The archive ─────────────────────────────────────────────────────────────
   Game (gameSecondsKey) -> `${playthroughId}:${counterId}` -> count. The
   default playthrough has an empty id. Like archivedGameSeconds, a game can
   have several keys (identities that became one game). */

export type ArchivedCounts = Record<string, Counts>;

function archiveKey(playthroughId: string | null | undefined, counterId: string) {
  return `${playthroughId ?? ""}:${counterId}`;
}

export function parseArchiveKey(
  key: string,
): { playthroughId: string | null; counterId: string } | null {
  const separator = key.indexOf(":");
  if (separator < 0) return null;
  const counterId = key.slice(separator + 1);
  if (!validId(counterId)) return null;
  return {
    playthroughId: separator === 0 ? null : key.slice(0, separator),
    counterId,
  };
}

/** Folds the counts of sessions leaving History into the archive. */
export function archiveCounts(
  current: ArchivedCounts,
  sessions: readonly Pick<
    Session,
    "gameId" | "source" | "playthroughId" | "counts"
  >[],
): ArchivedCounts {
  let next: ArchivedCounts | undefined;
  for (const session of sessions) {
    if (!session.counts) continue;
    next ??= { ...current };
    const game = gameSecondsKey(session);
    const entries = { ...next[game] };
    for (const [counterId, count] of Object.entries(session.counts)) {
      const key = archiveKey(session.playthroughId, counterId);
      entries[key] = Math.min(COUNT_LIMIT, (entries[key] ?? 0) + count);
    }
    next[game] = entries;
  }
  return next ?? current;
}

export function sanitizeArchivedCounts(value: unknown): ArchivedCounts {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const archive: ArchivedCounts = {};
  for (const [game, entries] of Object.entries(value)) {
    const ref = gameSecondsRefFromKey(game);
    if (!ref || !entries || typeof entries !== "object") continue;
    const clean: Counts = {};
    for (const [key, count] of Object.entries(entries))
      if (parseArchiveKey(key) && validCount(count))
        clean[key] = Math.min(COUNT_LIMIT, count);
    if (Object.keys(clean).length > 0) archive[gameSecondsKey(ref)] = clean;
  }
  return archive;
}

/** A game's archive moves with its seconds (rekeyGameSeconds). */
export function rekeyArchivedCounts(
  archive: ArchivedCounts,
  from: string,
  to: string,
): ArchivedCounts {
  const moving = archive[from];
  if (!moving || from === to) return archive;
  const next = { ...archive };
  delete next[from];
  const target = { ...next[to] };
  for (const [key, count] of Object.entries(moving))
    target[key] = Math.min(COUNT_LIMIT, (target[key] ?? 0) + count);
  next[to] = target;
  return next;
}

export function clearArchivedCounts(
  archive: ArchivedCounts,
  games: Iterable<string>,
): ArchivedCounts {
  let next: ArchivedCounts | undefined;
  for (const game of games) {
    if (!(game in archive)) continue;
    next ??= { ...archive };
    delete next[game];
  }
  return next ?? archive;
}

/** A deleted playthrough's sessions go to the default one; so do its
 *  archived counts. */
export function archivedCountsToDefault(
  archive: ArchivedCounts,
  playthroughId: string,
): ArchivedCounts {
  let next: ArchivedCounts | undefined;
  for (const [game, entries] of Object.entries(archive)) {
    let moved: Counts | undefined;
    for (const [key, count] of Object.entries(entries)) {
      const parsed = parseArchiveKey(key);
      if (parsed?.playthroughId !== playthroughId) continue;
      moved ??= { ...entries };
      delete moved[key];
      const target = archiveKey(null, parsed.counterId);
      moved[target] = Math.min(COUNT_LIMIT, (moved[target] ?? 0) + count);
    }
    if (!moved) continue;
    next ??= { ...archive };
    next[game] = moved;
  }
  return next ?? archive;
}

/** A deleted counter leaves nothing behind in the given games. */
export function archiveWithoutCounter(
  archive: ArchivedCounts,
  games: ReadonlySet<string>,
  counterId: string,
): ArchivedCounts {
  let next: ArchivedCounts | undefined;
  for (const game of games) {
    const entries = archive[game];
    if (!entries) continue;
    const kept = Object.fromEntries(
      Object.entries(entries).filter(
        ([key]) => parseArchiveKey(key)?.counterId !== counterId,
      ),
    );
    if (Object.keys(kept).length === Object.keys(entries).length) continue;
    next ??= { ...archive };
    if (Object.keys(kept).length > 0) next[game] = kept;
    else delete next[game];
  }
  return next ?? archive;
}

/* Totals ──────────────────────────────────────────────────────────────── */

type CountedSession = {
  id: number;
  playthroughId?: string;
  startedAt: string;
  counts?: Counts;
};

export type CounterTally = {
  /** In the session asked about (the running one). */
  session: number;
  /** In the playthrough asked about. */
  playthrough: number;
  /** All playthroughs. */
  all: number;
  /** The most in one retained session, and when it started. */
  best: { count: number; startedAt: string } | null;
};

const EMPTY_TALLY: CounterTally = Object.freeze({
  session: 0,
  playthrough: 0,
  all: 0,
  best: null,
});

export function emptyTally(): CounterTally {
  return EMPTY_TALLY;
}

/**
 * Every counter's numbers for one game. The caller scopes `sessions` (finished
 * and running) and `archived` (the game's archive entries) to this game, the
 * same way the journal dialog scopes seconds.
 */
export function counterTallies({
  sessions,
  archived,
  playthroughId,
  sessionId,
}: {
  sessions: readonly CountedSession[];
  archived: readonly Counts[];
  /** "This playthrough": null = the default one. */
  playthroughId: string | null;
  /** "This session". */
  sessionId?: number;
}): Map<string, CounterTally> {
  const tallies = new Map<string, CounterTally>();
  const tally = (id: string) => {
    let entry = tallies.get(id);
    if (!entry) tallies.set(id, (entry = { ...EMPTY_TALLY }));
    return entry;
  };
  for (const entries of archived) {
    for (const [key, count] of Object.entries(entries)) {
      const parsed = parseArchiveKey(key);
      if (!parsed) continue;
      const entry = tally(parsed.counterId);
      entry.all += count;
      if (parsed.playthroughId === playthroughId) entry.playthrough += count;
    }
  }
  for (const session of sessions) {
    if (!session.counts) continue;
    for (const [id, count] of Object.entries(session.counts)) {
      const entry = tally(id);
      entry.all += count;
      if ((session.playthroughId ?? null) === playthroughId)
        entry.playthrough += count;
      if (session.id === sessionId) entry.session += count;
      if (!entry.best || count > entry.best.count)
        entry.best = { count, startedAt: session.startedAt };
    }
  }
  return tallies;
}

/** One counter over the last sessions of a playthrough, oldest first; a
 *  session that didn't count it has 0. For the chart in Game Details. */
export function lastSessionCounts(
  sessions: readonly CountedSession[],
  counterId: string,
  playthroughId: string | null,
  limit = 12,
): { id: number; startedAt: string; count: number }[] {
  return sessions
    .filter((session) => (session.playthroughId ?? null) === playthroughId)
    .sort((left, right) => left.startedAt.localeCompare(right.startedAt))
    .slice(-limit)
    .map((session) => ({
      id: session.id,
      startedAt: session.startedAt,
      count: session.counts?.[counterId] ?? 0,
    }));
}

/** Whether a game has ever been counted: until then the live timer shows no
 *  counts and Now Playing only a quiet line. */
export function hasCounted(tallies: ReadonlyMap<string, CounterTally>) {
  for (const entry of tallies.values()) if (entry.all > 0) return true;
  return false;
}

type GameRef = { gameId: number; source?: Session["source"] | null };

/** The archive keys of one game: its own key, and any other key whose
 *  identity is the same game (identities that became one game). */
export function gameArchiveKeys(
  archive: ArchivedCounts,
  game: GameRef,
  identity: (ref: GameRef) => string,
): Set<string> {
  const own = gameSecondsKey(game);
  const gameKey = identity(game);
  return new Set(
    Object.keys(archive).filter((key) => {
      if (key === own) return true;
      const ref = gameSecondsRefFromKey(key);
      return ref !== null && identity(ref) === gameKey;
    }),
  );
}

/** The archive entries of one game, whatever key its identities left. */
export function gameArchivedCounts(
  archive: ArchivedCounts,
  game: GameRef,
  identity: (ref: GameRef) => string,
): Counts[] {
  return [...gameArchiveKeys(archive, game, identity)].map(
    (key) => archive[key],
  );
}
