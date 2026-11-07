import type {
  EmulatorId,
  GameTimeToBeat,
  LibraryProviderId,
  Session,
} from "@playcounter/shared";
import { playthroughSeconds, type GameJournal } from "./personalLibrary";

/* HowLongToBeat ──────────────────────────────────────────────────────────────
   HowLongToBeat has no public API, so PlayCounter never talks to it. The
   numbers are IGDB's time to beat (through the PlayCounter API), the link to
   a game's HowLongToBeat page comes from Wikidata, and "Add my time" shows the
   player's own run and opens howlongtobeat.com in the browser, where they
   submit it themselves. See docs/howlongtobeat-plan.md. */

const HLTB_ORIGIN = "https://howlongtobeat.com";

const isHltbId = (hltbId?: number): hltbId is number =>
  hltbId !== undefined && Number.isSafeInteger(hltbId) && hltbId > 0;

/** The game's own HowLongToBeat page when its id is known, otherwise
 *  HowLongToBeat's search for the name. Encoded: the shell refuses spaces. */
export function howLongToBeatUrl(name: string, hltbId?: number) {
  return isHltbId(hltbId)
    ? `${HLTB_ORIGIN}/game/${hltbId}`
    : `${HLTB_ORIGIN}/?q=${encodeURIComponent(name.trim())}`;
}

/** HowLongToBeat's form for adding a time to one game. Undefined without the
 *  game's id: the form has no search. */
export function howLongToBeatSubmitUrl(hltbId?: number) {
  return isHltbId(hltbId) ? `${HLTB_ORIGIN}/submit/game/${hltbId}` : undefined;
}

/** The sessions of one run: a named playthrough's, or the default one's
 *  (sessions without a playthrough). The caller scopes them to the game. */
export function runSessions(
  gameSessions: readonly Session[],
  playthroughId: string | null,
) {
  return gameSessions.filter(
    (session) => (session.playthroughId ?? null) === playthroughId,
  );
}

/**
 * The hours of one playthrough: a named one's own sessions and archive. The
 * default playthrough gets everything the named ones do not have, so
 * imported launcher hours and manual adjustments count for it (unlike
 * defaultPlaythroughTime, which leaves them out on purpose).
 */
export function runSeconds({
  playthroughId,
  playthroughIds,
  gameSessions,
  archivedPlaythroughSeconds,
  gameTotalSeconds,
}: {
  playthroughId: string | null;
  playthroughIds: readonly string[];
  gameSessions: readonly Session[];
  archivedPlaythroughSeconds: Record<string, number>;
  gameTotalSeconds: number;
}) {
  if (playthroughId)
    return playthroughSeconds(
      playthroughId,
      gameSessions,
      archivedPlaythroughSeconds,
    );
  const namedSeconds = playthroughIds.reduce(
    (sum, id) =>
      sum + playthroughSeconds(id, gameSessions, archivedPlaythroughSeconds),
    0,
  );
  return Math.max(0, gameTotalSeconds - namedSeconds);
}

/** IGDB's three paces, shown with HowLongToBeat's names: Main story,
 *  Main + extras, Completionist. */
export const PACES = ["hastily", "normally", "completely"] as const;
export type Pace = (typeof PACES)[number];

const PACE_SECONDS = {
  hastily: "hastilySeconds",
  normally: "normallySeconds",
  completely: "completelySeconds",
} as const satisfies Record<Pace, keyof GameTimeToBeat>;

/** The paces IGDB has a number for, shortest first. */
export function timeToBeatMarks(time: GameTimeToBeat | undefined) {
  return PACES.flatMap((pace) => {
    const seconds = time?.[PACE_SECONDS[pace]];
    return typeof seconds === "number" && seconds > 0
      ? [{ pace, seconds }]
      : [];
  }).sort((left, right) => left.seconds - right.seconds);
}

export type TimeToBeatProgress =
  | {
      state: "playing";
      playedSeconds: number;
      nextPace: Pace;
      leftSeconds: number;
    }
  | { state: "past-all"; playedSeconds: number }
  | { state: "finished"; playedSeconds: number; averageSeconds?: number };

/** A run against the three marks: how far to the next one, or how it ended
 *  against the middle one. Null without any numbers. */
export function timeToBeatProgress(
  time: GameTimeToBeat | undefined,
  playedSeconds: number,
  finished: boolean,
): TimeToBeatProgress | null {
  const marks = timeToBeatMarks(time);
  if (marks.length === 0) return null;
  const played = Math.max(0, playedSeconds);
  if (finished) {
    const average = time?.normallySeconds;
    return average && average > 0
      ? { state: "finished", playedSeconds: played, averageSeconds: average }
      : { state: "finished", playedSeconds: played };
  }
  const next = marks.find((mark) => played < mark.seconds);
  return next
    ? {
        state: "playing",
        playedSeconds: played,
        nextPace: next.pace,
        leftSeconds: next.seconds - played,
      }
    : { state: "past-all", playedSeconds: played };
}

export type HltbRun = {
  /** Null for the default playthrough. */
  id: string | null;
  /** Null for the default playthrough: the UI names it in the app's language. */
  name: string | null;
  seconds: number;
  finished: boolean;
  /** A named playthrough's finish date; the default one's last session. */
  finishedAt?: string;
  /** New sessions count towards this playthrough. */
  active: boolean;
  sessions: Session[];
};

/**
 * Every playthrough "Add your time" can be about. The default one has no
 * finish date of its own: it counts as finished while the game's status is
 * Finished, on the day of its last session. It is left out when it has no
 * hours, is not active and named playthroughs exist.
 */
export function hltbRuns({
  journal,
  gameSessions,
  archivedPlaythroughSeconds,
  gameTotalSeconds,
}: {
  journal: GameJournal;
  gameSessions: readonly Session[];
  archivedPlaythroughSeconds: Record<string, number>;
  gameTotalSeconds: number;
}): HltbRun[] {
  const named = journal.playthroughs.map(
    (playthrough): HltbRun => ({
      id: playthrough.id,
      name: playthrough.name,
      seconds: playthroughSeconds(
        playthrough.id,
        gameSessions,
        archivedPlaythroughSeconds,
      ),
      finished: Boolean(playthrough.completedAt),
      finishedAt: playthrough.completedAt ?? undefined,
      active: journal.activePlaythroughId === playthrough.id,
      sessions: runSessions(gameSessions, playthrough.id),
    }),
  );
  const sessions = runSessions(gameSessions, null);
  const seconds = runSeconds({
    playthroughId: null,
    playthroughIds: journal.playthroughs.map(({ id }) => id),
    gameSessions,
    archivedPlaythroughSeconds,
    gameTotalSeconds,
  });
  const finished = journal.status === "finished" && seconds > 0;
  const defaultRun: HltbRun = {
    id: null,
    name: null,
    seconds,
    finished,
    finishedAt: finished ? runDates(sessions).lastPlayedAt : undefined,
    active: journal.activePlaythroughId === null,
    sessions,
  };
  return named.length === 0 || seconds > 0 || defaultRun.active
    ? [defaultRun, ...named]
    : named;
}

function lastActivityMs(run: HltbRun) {
  const times = [runDates(run.sessions).lastPlayedAt, run.finishedAt]
    .map((value) => (value ? Date.parse(value) : Number.NaN))
    .filter(Number.isFinite);
  return times.length > 0 ? Math.max(...times) : Number.NEGATIVE_INFINITY;
}

/**
 * The playthrough the tab starts on: the one played or finished last. That is
 * the active one while you play it, and the one you just finished right after
 * finishing it, although finishing makes the default playthrough active again.
 */
export function preferredRun(runs: readonly HltbRun[]) {
  let best: HltbRun | undefined;
  let bestMs = Number.NEGATIVE_INFINITY;
  for (const run of runs) {
    const ms = lastActivityMs(run);
    if (ms > bestMs || (ms === bestMs && run.active)) {
      best = run;
      bestMs = ms;
    }
  }
  return best ?? runs.find((run) => run.active) ?? runs[0];
}

/** HowLongToBeat's form asks for hours, minutes and seconds separately. */
export function splitDuration(totalSeconds: number) {
  const whole = Math.max(0, Math.floor(totalSeconds));
  return {
    hours: Math.floor(whole / 3_600),
    minutes: Math.floor((whole % 3_600) / 60),
    seconds: whole % 60,
  };
}

/** When a run was first and last played. Empty when its sessions are gone
 *  (only the newest 2,500 are kept) or it only has imported hours. */
export function runDates(sessions: readonly Session[]): {
  startedAt?: string;
  lastPlayedAt?: string;
} {
  let startedAt: string | undefined;
  let lastPlayedAt: string | undefined;
  for (const session of sessions) {
    if (!startedAt || Date.parse(session.startedAt) < Date.parse(startedAt))
      startedAt = session.startedAt;
    const end = session.endedAt ?? session.startedAt;
    if (!lastPlayedAt || Date.parse(end) > Date.parse(lastPlayedAt))
      lastPlayedAt = end;
  }
  return {
    ...(startedAt ? { startedAt } : {}),
    ...(lastPlayedAt ? { lastPlayedAt } : {}),
  };
}

/* HowLongToBeat's own platform and store names (Playnite's HltbPlatform.cs
   and HltbStorefront.cs). Its form is English, so these stay English: the
   player picks the same words there. Undefined = PlayCounter can't tell, the
   player picks. */

const EMULATOR_PLATFORMS: Record<EmulatorId, string | undefined> = {
  dosbox: "PC",
  // GameCube or Wii.
  dolphin: undefined,
  pcsx2: "PlayStation 2",
  // Game Boy, Game Boy Color or Game Boy Advance; content keys drop the
  // file extension that would tell them apart.
  mgba: undefined,
  cemu: "Wii U",
  rpcs3: "PlayStation 3",
  ppsspp: "PlayStation Portable",
  duckstation: "PlayStation",
  ryujinx: "Nintendo Switch",
  eden: "Nintendo Switch",
  azahar: "Nintendo 3DS",
  melonds: "Nintendo DS",
  xenia: "Xbox 360",
};

function sessionPlatform(session: Session): string | undefined {
  if (session.origin === "playstation")
    return session.console === "PS4" ? "PlayStation 4" : "PlayStation 5";
  if (session.emulator)
    return EMULATOR_PLATFORMS[session.emulator.emulatorId as EmulatorId];
  return "PC";
}

/** The platform a run was played on, the one with the most hours if several.
 *  PC for a run without sessions: imported hours come from PC launchers. */
export function hltbPlatform(sessions: readonly Session[]) {
  if (sessions.length === 0) return "PC";
  const seconds = new Map<string | undefined, number>();
  for (const session of sessions) {
    const platform = sessionPlatform(session);
    seconds.set(
      platform,
      (seconds.get(platform) ?? 0) + Math.max(0, session.durationSeconds ?? 0),
    );
  }
  let best: string | undefined;
  let bestSeconds = -1;
  for (const [platform, total] of seconds) {
    if (total > bestSeconds) {
      best = platform;
      bestSeconds = total;
    }
  }
  return best;
}

const STOREFRONTS: Record<LibraryProviderId, string | undefined> = {
  steam: "Steam",
  epic: "Epic Games",
  gog: "GOG",
  battlenet: "Battle.net",
  playstation: "PlayStation Store",
  // Xbox Store, Microsoft Store or Xbox Game Pass.
  xbox: undefined,
};

/** The store a game came from, when it came from exactly one. */
export function hltbStorefront(providers: readonly LibraryProviderId[]) {
  const distinct = [...new Set(providers)];
  return distinct.length === 1 ? STOREFRONTS[distinct[0]] : undefined;
}
