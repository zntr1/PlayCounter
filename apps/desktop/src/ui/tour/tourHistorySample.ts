import type { Session } from "@playcounter/shared";
import { TOUR_DEMO_GAME, TOUR_GTA_GAME_ID } from "./tourDemoGame";

/* The sample histories of the guides on My History. Each guide gets sessions
   its steps can point at: "Read your stats" six ordinary ones spread over
   weeks, "Correct your history" one that is plainly wrong, one with a break
   in it and two that belong together, "Screenshots" one with pictures. All
   times are relative to now, so the ranges and "Yesterday" always fit. */

/** The sessions a step names. Guides ring their rows, the practice checks
 *  that they are still there when such a step starts. */
export const HISTORY_SAMPLE = {
  /** Left open overnight: 14 hours. */
  overnight: -301,
  /** 4h 30m with an hour away from the game in the middle. */
  withBreak: -302,
  /** Two sessions of one evening, 15 minutes apart. */
  beforeRestart: -303,
  afterRestart: -304,
  /** Has two pictures. */
  withPictures: -401,
} as const;

/** Guides that also walk through real pages have no practice surface. My
 *  History shows their sample history itself while they run. */
export const showsHistorySample = (tourId: string | undefined) =>
  tourId === "screenshots";

/** The row of one sample session. */
export const historySampleRow = (sessionId: number) =>
  `[data-tour="demo-history-row"][data-history-session-id="${sessionId}"]`;

type SampleGame = Pick<
  Session,
  "gameId" | "gameName" | "source" | "coverUrl" | "exeName"
>;

const WOW: SampleGame = {
  gameId: TOUR_DEMO_GAME.gameId,
  gameName: TOUR_DEMO_GAME.name,
  source: "community",
  coverUrl: TOUR_DEMO_GAME.coverUrl,
  exeName: TOUR_DEMO_GAME.exeName,
};

const GTA: SampleGame = {
  gameId: TOUR_GTA_GAME_ID,
  gameName: "Grand Theft Auto V", // i18n-exempt: sample game name
  source: "igdb",
  coverUrl: "/tour/gta-v-cover.webp",
  exeName: "GTA5.exe",
};

/** Local time, `daysAgo` days before `now`. */
function at(now: Date, daysAgo: number, hour: number, minute = 0) {
  const time = new Date(now);
  time.setDate(time.getDate() - daysAgo);
  time.setHours(hour, minute, 0, 0);
  return time;
}

function session(
  id: number,
  game: SampleGame,
  start: Date,
  minutes: number,
): Session {
  return {
    ...game,
    id,
    startedAt: start.toISOString(),
    endedAt: new Date(start.getTime() + minutes * 60_000).toISOString(),
    durationSeconds: minutes * 60,
  };
}

// Six sessions over six weeks, half an hour to three hours, each ending at
// noon: enough for every range, a comparison and all charts.
function statsSample(now: Date) {
  return [0, 2, 5, 10, 18, 40].map((daysAgo, index) => {
    const minutes = (index + 1) * 30;
    const end = at(now, daysAgo, 12);
    return session(
      -200 - index,
      index % 2 === 0 ? WOW : GTA,
      new Date(end.getTime() - minutes * 60_000),
      minutes,
    );
  });
}

function correctionSample(now: Date) {
  return [
    // 21:00 until 11:00 the next morning.
    session(HISTORY_SAMPLE.overnight, WOW, at(now, 2, 21), 14 * 60),
    session(HISTORY_SAMPLE.withBreak, GTA, at(now, 4, 18), 270),
    session(HISTORY_SAMPLE.afterRestart, WOW, at(now, 6, 19, 55), 75),
    session(HISTORY_SAMPLE.beforeRestart, WOW, at(now, 6, 19), 40),
    session(-305, GTA, at(now, 9, 20), 90),
    session(-306, WOW, at(now, 12, 17), 75),
  ];
}

function picturesSample(now: Date) {
  return [
    session(HISTORY_SAMPLE.withPictures, WOW, at(now, 1, 20), 90),
    session(-402, GTA, at(now, 3, 19), 60),
    session(-403, WOW, at(now, 5, 18, 30), 90),
    session(-404, GTA, at(now, 9, 21), 70),
  ];
}

/** A guide's sample sessions, newest first, as the store keeps them. */
export function historySampleSessions(
  tourId: string | undefined,
  now = new Date(),
): Session[] {
  if (tourId === "correct-history") return correctionSample(now);
  if (tourId === "screenshots") return picturesSample(now);
  return statsSample(now);
}
