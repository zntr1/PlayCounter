import type { GameIdentityRef } from "./store";
import type { Session } from "@playcounter/shared";

export const NOTE_LIMIT = 4000;
export const NAME_LIMIT = 80;
export const DEFAULT_PLAYTHROUGH_NAME = "Default playthrough";
export const GAME_STATUSES = {
  playing: "Playing",
  "on-hold": "On hold",
  finished: "Finished",
  "want-to-play": "Want to play",
  "want-to-replay": "Want to replay",
  "not-planned": "Not planned",
} as const;
export type GameStatus = keyof typeof GAME_STATUSES;
export type Playthrough = {
  id: string;
  name: string;
  note: string;
  createdAt: string;
  completedAt: string | null;
};
export type GameJournal = {
  game: GameIdentityRef;
  note: string;
  favorite: boolean;
  status: GameStatus | null;
  shelfIds: string[];
  /** Null selects the built-in default playthrough. */
  activePlaythroughId: string | null;
  playthroughs: Playthrough[];
};
export type LibraryFilters = {
  search?: string;
  source?: "all" | "steam" | "xbox" | "unimported";
  status?: GameStatus | "none";
  favorite?: boolean;
  installed?: boolean;
  played?: "played" | "unplayed";
  emulator?: "dosbox" | "dolphin" | "pcsx2";
  lastPlayedDays?: number;
};
export type PersonalShelf = {
  id: string;
  name: string;
  /** Absent for a shelf with manually selected games. */
  filters?: LibraryFilters;
};
export type JournalTarget = {
  game: GameIdentityRef;
  tab?: "note" | "playthroughs" | "organize";
  playthroughId?: string | null;
};

export function journalKey(game: GameIdentityRef) {
  return `${game.source ?? "unknown"}:${game.gameId}`;
}

export function emptyJournal(game: GameIdentityRef): GameJournal {
  const identity = {
    gameId: game.gameId,
    source: game.source,
    igdbId: game.igdbId,
    gameName: game.gameName,
    coverUrl: game.coverUrl,
  };
  return {
    game: identity,
    note: "",
    favorite: false,
    status: null,
    shelfIds: [],
    activePlaythroughId: null,
    playthroughs: [],
  };
}

export function mergeJournals(
  target: GameJournal,
  incoming: GameJournal,
): GameJournal {
  const notes = [...new Set([target.note, incoming.note].filter(Boolean))];
  return {
    ...target,
    // Preserve both notes when separately organized identities are unified.
    note: notes.join("\n\n"),
    favorite: target.favorite || incoming.favorite,
    status: target.status ?? incoming.status,
    shelfIds: [...new Set([...target.shelfIds, ...incoming.shelfIds])],
    activePlaythroughId:
      target.activePlaythroughId ?? incoming.activePlaythroughId,
    playthroughs: [
      ...new Map(
        [...incoming.playthroughs, ...target.playthroughs].map((p) => [
          p.id,
          p,
        ]),
      ).values(),
    ],
  };
}

export function matchingJournalKeys(
  journals: Record<string, GameJournal>,
  game: GameIdentityRef,
  identity: (game: GameIdentityRef) => string,
) {
  const canonical = identity(game);
  return Object.keys(journals).filter(
    (key) => identity(journals[key].game) === canonical,
  );
}

export function readJournal(
  journals: Record<string, GameJournal>,
  game: GameIdentityRef,
  identity: (game: GameIdentityRef) => string,
): GameJournal {
  const keys = matchingJournalKeys(journals, game, identity);
  // Prefer the directly addressed record when two identities become one game.
  keys.sort(
    (a, b) => Number(b === journalKey(game)) - Number(a === journalKey(game)),
  );
  return keys.reduce(
    (result, key) => mergeJournals(result, journals[key]),
    emptyJournal(game),
  );
}

export function writeJournal(
  journals: Record<string, GameJournal>,
  journal: GameJournal,
  identity: (game: GameIdentityRef) => string,
) {
  const next = { ...journals };
  for (const key of matchingJournalKeys(journals, journal.game, identity))
    delete next[key];
  next[journalKey(journal.game)] = journal;
  return next;
}

export type GameStatusChange = {
  game: GameIdentityRef;
  before: GameStatus | null;
  after: GameStatus | null;
};

/** Index once and copy once, even when assigning a whole imported library. */
export function updateJournalStatuses(
  journals: Record<string, GameJournal>,
  updates: readonly {
    game: GameIdentityRef;
    status: GameStatus | null;
    expectedStatus?: GameStatus | null;
  }[],
  identity: (game: GameIdentityRef) => string,
) {
  const groups = new Map<string, Record<string, GameJournal>>();
  for (const [key, journal] of Object.entries(journals)) {
    const canonical = identity(journal.game);
    let group = groups.get(canonical);
    if (!group) groups.set(canonical, (group = {}));
    group[key] = journal;
  }
  let next: Record<string, GameJournal> | undefined;
  const changes: GameStatusChange[] = [];
  const seen = new Set<string>();
  for (const { game, status, expectedStatus } of updates) {
    const canonical = identity(game);
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    const group = groups.get(canonical);
    const journal = readJournal(group ?? {}, game, identity);
    // Undo must not recreate removed journals or replace a newer status.
    if (
      expectedStatus !== undefined &&
      (!group || journal.status !== expectedStatus)
    )
      continue;
    const previousKeys = Object.keys(group ?? {});
    if (journal.status === status && previousKeys.length <= 1) continue;
    next ??= { ...journals };
    for (const key of previousKeys) delete next[key];
    next[journalKey(game)] = { ...journal, status };
    if (journal.status !== status)
      changes.push({
        game: journal.game,
        before: journal.status,
        after: status,
      });
  }
  return { journals: next ?? journals, changes };
}

export function rekeyJournal(
  journals: Record<string, GameJournal>,
  from: string,
  to: string,
) {
  const old = journals[from];
  if (!old || from === to) return journals;
  const separator = to.lastIndexOf(":");
  const source = to.slice(0, separator);
  const gameId = Number(to.slice(separator + 1));
  if (
    !Number.isSafeInteger(gameId) ||
    !["igdb", "community", "custom", "unknown"].includes(source)
  )
    return journals;
  const game = {
    gameId,
    source:
      source === "unknown" ? undefined : (source as GameIdentityRef["source"]),
  };
  const moved = { ...old, game };
  const next = {
    ...journals,
    [to]: journals[to] ? mergeJournals(journals[to], moved) : moved,
  };
  delete next[from];
  return next;
}

export function archivePlaythroughSeconds(
  current: Record<string, number>,
  removed: readonly Session[],
) {
  const next = { ...current };
  for (const session of removed) {
    if (session.playthroughId)
      next[session.playthroughId] =
        (next[session.playthroughId] ?? 0) +
        Math.max(0, session.durationSeconds ?? 0);
  }
  return next;
}

export function sanitizePlaythroughSeconds(
  value: unknown,
): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      ([key, seconds]) =>
        key.length > 0 &&
        typeof seconds === "number" &&
        Number.isFinite(seconds) &&
        seconds >= 0,
    ),
  ) as Record<string, number>;
}

export function playthroughSeconds(
  id: string,
  sessions: readonly Session[],
  archived: Record<string, number>,
) {
  return (
    Math.max(0, archived[id] ?? 0) +
    sessions.reduce(
      (sum, session) =>
        sum +
        (session.playthroughId === id
          ? Math.max(0, session.durationSeconds ?? 0)
          : 0),
      0,
    )
  );
}

export function playthroughName(
  journal: GameJournal,
  id: string | null = journal.activePlaythroughId,
) {
  return (
    journal.playthroughs.find((p) => p.id === id)?.name ??
    DEFAULT_PLAYTHROUGH_NAME
  );
}

/** Sessions without a named assignment belong to this game's default playthrough.
 *  The caller must scope sessions and the game archive to this game. Provider
 *  lifetime totals and game-wide adjustments cannot be attributed to a run. */
export function defaultPlaythroughTime(
  journal: GameJournal,
  sessions: readonly Session[],
  gameArchivedSeconds: number,
  archived: Record<string, number>,
) {
  const archivedSeconds = Math.max(
    0,
    gameArchivedSeconds -
      journal.playthroughs.reduce(
        (sum, p) => sum + Math.max(0, archived[p.id] ?? 0),
        0,
      ),
  );
  return {
    archivedSeconds,
    seconds:
      archivedSeconds +
      sessions.reduce(
        (sum, session) =>
          sum +
          (!session.playthroughId
            ? Math.max(0, session.durationSeconds ?? 0)
            : 0),
        0,
      ),
  };
}

export function journalNote(
  journal: GameJournal,
  playthroughId: string | null = journal.activePlaythroughId,
) {
  // An empty playthrough note must not inherit the default playthrough's note.
  return (
    journal.playthroughs.find((p) => p.id === playthroughId)?.note ??
    journal.note
  );
}

export type FilterableLibraryGame = {
  name: string;
  totalSeconds: number;
  lastPlayedAt: string;
  /** False when lastPlayedAt is merely an import or metadata-check fallback. */
  hasLastPlayedEvidence?: boolean;
  emulatorIds: string[];
  libraryImports: Array<{
    provider: string;
    installed: boolean;
    entry: { providerSeconds: number | null };
  }>;
};

export function matchesLibraryFilters(
  game: FilterableLibraryGame,
  journal: GameJournal,
  filters: LibraryFilters,
  nowMs = Date.now(),
) {
  if (
    filters.search &&
    !game.name.toLowerCase().includes(filters.search.trim().toLowerCase())
  )
    return false;
  if (filters.source === "unimported" && game.libraryImports.length)
    return false;
  if (
    filters.source &&
    filters.source !== "all" &&
    filters.source !== "unimported" &&
    !game.libraryImports.some((entry) => entry.provider === filters.source)
  )
    return false;
  if (
    filters.status &&
    journal.status !== (filters.status === "none" ? null : filters.status)
  )
    return false;
  if (filters.favorite && !journal.favorite) return false;
  if (
    filters.installed !== undefined &&
    game.libraryImports.some((entry) => entry.installed) !== filters.installed
  )
    return false;
  if (filters.emulator && !game.emulatorIds.includes(filters.emulator))
    return false;
  if (filters.played === "played" && game.totalSeconds <= 0) return false;
  if (
    filters.played === "unplayed" &&
    (game.totalSeconds > 0 ||
      game.libraryImports.some((entry) => entry.entry.providerSeconds === null))
  )
    return false;
  if (filters.lastPlayedDays) {
    if (game.hasLastPlayedEvidence === false) return false;
    const last = Date.parse(game.lastPlayedAt);
    if (
      game.totalSeconds <= 0 ||
      !Number.isFinite(last) ||
      last >= nowMs - filters.lastPlayedDays * 86400000
    )
      return false;
  }
  return true;
}
