import type {
  EmulatorId,
  GameTimeToBeat,
  LibraryProviderId,
  Session,
} from "@playcounter/shared";
import { playthroughSeconds } from "./personalLibrary";

/* HowLongToBeat ──────────────────────────────────────────────────────────────
   HowLongToBeat has no public API, so PlayCounter never talks to it. The
   numbers are IGDB's time to beat (through the PlayCounter API), the link to
   a game's HowLongToBeat page comes from Wikidata, and "Add my time" shows the
   player's own run and opens howlongtobeat.com in the browser, where they
   submit it themselves. See docs/howlongtobeat-plan.md. */

const HLTB_ORIGIN = "https://howlongtobeat.com";

/** The game's own HowLongToBeat page when its id is known, otherwise
 *  HowLongToBeat's search for the name. Encoded: the shell refuses spaces. */
export function howLongToBeatUrl(name: string, hltbId?: number) {
  return hltbId !== undefined && Number.isSafeInteger(hltbId) && hltbId > 0
    ? `${HLTB_ORIGIN}/game/${hltbId}`
    : `${HLTB_ORIGIN}/?q=${encodeURIComponent(name.trim())}`;
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
 * The hours "time left" measures: only the active playthrough's own. The
 * default playthrough gets everything the named ones do not have, so
 * imported launcher hours and manual adjustments count for it (unlike
 * defaultPlaythroughTime, which leaves them out on purpose).
 */
export function runSeconds({
  activePlaythroughId,
  playthroughIds,
  gameSessions,
  archivedPlaythroughSeconds,
  gameTotalSeconds,
}: {
  activePlaythroughId: string | null;
  playthroughIds: readonly string[];
  gameSessions: readonly Session[];
  archivedPlaythroughSeconds: Record<string, number>;
  gameTotalSeconds: number;
}) {
  if (activePlaythroughId)
    return playthroughSeconds(
      activePlaythroughId,
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

export type TimeToBeatProgress =
  | {
      state: "playing";
      playedSeconds: number;
      averageSeconds: number;
      leftSeconds: number;
    }
  | {
      state: "playing-past";
      playedSeconds: number;
      averageSeconds: number;
      overSeconds: number;
    }
  | { state: "finished"; playedSeconds: number; averageSeconds: number };

/** A run against IGDB's middle number ("normally"). Null without it. */
export function timeToBeatProgress(
  time: GameTimeToBeat | undefined,
  playedSeconds: number,
  finished: boolean,
): TimeToBeatProgress | null {
  const averageSeconds = time?.normallySeconds;
  if (!averageSeconds || averageSeconds <= 0) return null;
  const played = Math.max(0, playedSeconds);
  if (finished)
    return { state: "finished", playedSeconds: played, averageSeconds };
  return played < averageSeconds
    ? {
        state: "playing",
        playedSeconds: played,
        averageSeconds,
        leftSeconds: averageSeconds - played,
      }
    : {
        state: "playing-past",
        playedSeconds: played,
        averageSeconds,
        overSeconds: played - averageSeconds,
      };
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
