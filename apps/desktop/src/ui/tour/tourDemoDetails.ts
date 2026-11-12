import type { GameAchievement, GameDetails, Session } from "@playcounter/shared";
import { DEATHS_COUNTER_ID, type GameCounter } from "../../counters";
import { emptyJournal, journalKey } from "../../personalLibrary";
import { currentPlatform } from "../../platform";
import { useAppStore, type ActiveSession, type GameIdentityRef } from "../../store";
import type {
  AwardedMilestone,
  MilestoneMetrics,
} from "../../milestones";
import type { GameLabel } from "../views/achievements/achievementCatalog";
import { findTour } from "./tourDefinitions";
import { emitTourEvent } from "./tourEvents";
import { createLibraryTourStore } from "./libraryTourStore";
import { TOUR_DEMO_GAME } from "./tourDemoGame";

/* The sample data behind the sample game's Details, its Counters and the
   sample Achievements page (docs/tours-plan.md, WP5). Everything here is
   bundled: nothing is loaded, nothing is saved, and it is thrown away when
   the guide ends. The English texts are sample content on purpose. */

const DAY = 86_400_000;

/** The sample game, and only it: an own game with the same id is not it. */
export const isTourDemoGame = (game: { kind?: string; gameId: number }) =>
  game.kind === "tour-demo" && game.gameId === TOUR_DEMO_GAME.gameId;

function sampleDetails(): GameDetails {
  return {
    igdbId: 0, // i18n-exempt: no IGDB entry, never looked up
    summary:
      "Azeroth is a world of swords and sorcery. Pick a race and a class, set out with friends and take on quests, dungeons and raids in one of the largest online worlds ever made.", // i18n-exempt: sample description
    releaseDate: "2004-11-23",
    releaseYear: 2004,
    developers: ["Blizzard Entertainment"], // i18n-exempt: sample company
    publishers: ["Blizzard Entertainment"], // i18n-exempt: sample company
    genres: ["Role-playing (RPG)", "Adventure"], // i18n-exempt: IGDB terms
    gameModes: ["Multiplayer", "Massively Multiplayer Online (MMO)"], // i18n-exempt: IGDB terms
    platforms: ["PC (Microsoft Windows)", "Mac"], // i18n-exempt: IGDB terms
    rating: 79,
    heroUrls: [TOUR_DEMO_GAME.bannerUrl],
    timeToBeat: {
      hastilySeconds: 40 * 3600,
      normallySeconds: 90 * 3600,
      completelySeconds: 260 * 3600,
      count: 312,
    },
  };
}

function sampleAchievements(now: number): GameAchievement[] {
  const base = {
    hidden: false,
  };
  const unlocked = (
    id: string,
    name: string,
    description: string,
    daysAgo: number,
    globalPercent: number,
  ): GameAchievement => ({
    ...base,
    id,
    name,
    description,
    unlocked: true,
    unlockedAt: now - daysAgo * DAY,
    globalPercent,
  });
  const locked = (
    id: string,
    name: string,
    description: string,
    globalPercent: number,
  ): GameAchievement => ({
    ...base,
    id,
    name,
    description,
    unlocked: false,
    globalPercent,
  });
  /* i18n-exempt: sample achievements of the sample game */
  return [
    unlocked("first-steps", "First steps", "Reach level 10.", 40, 91.2),
    unlocked("well-travelled", "Well travelled", "Visit five zones.", 28, 74.5),
    unlocked(
      "dungeon-delver",
      "Dungeon delver",
      "Finish your first dungeon.",
      15,
      58.3,
    ),
    unlocked("quest-hoarder", "Quest hoarder", "Complete 100 quests.", 6, 41.7),
    locked("max-level", "Top of the world", "Reach the level cap.", 22.4),
    locked("raid-ready", "Raid ready", "Defeat a raid boss.", 12.9),
    locked(
      "master-crafter",
      "Master crafter",
      "Reach the top skill in a profession.",
      8.6,
    ),
    locked("legendary", "Legendary", "Earn a legendary item.", 1.8),
  ];
}

/** What the sample game's Details shows instead of asking the database: the
 *  facts, the time to beat and one launcher's achievements. Null for every
 *  other game. */
export function tourDemoDetails(game: { kind?: string; gameId: number }) {
  if (!isTourDemoGame(game)) return null;
  return {
    details: sampleDetails(),
    achievements: sampleAchievements(Date.now()),
  };
}

/** Which launcher the sample's achievements come from: GOG's sign-in exists
 *  on Windows only, Steam reads its files everywhere. */
export const tourAchievementsLauncher = () =>
  currentPlatform() === "windows" ? ("gog" as const) : ("steam" as const);

/* Counters ───────────────────────────────────────────────────────────────── */

const SAMPLE_BOSSES_ID = "sample-bosses";

const sampleGameRef: GameIdentityRef = {
  gameId: TOUR_DEMO_GAME.gameId,
  gameName: TOUR_DEMO_GAME.name,
  coverUrl: TOUR_DEMO_GAME.coverUrl,
};

function makeCounterLibrary() {
  const now = Date.now();
  const library = createLibraryTourStore(useAppStore.getState().settings);
  const counters: GameCounter[] = [
    {
      id: DEATHS_COUNTER_ID,
      shown: true,
      createdAt: "1970-01-01T00:00:00.000Z",
    },
    {
      id: SAMPLE_BOSSES_ID,
      name: "Bosses", // i18n-exempt: sample counter
      shown: true,
      createdAt: new Date(now - 30 * DAY).toISOString(),
    },
  ];
  const counted: Array<[number, number]> = [
    [9, 1],
    [14, 2],
    [6, 1],
    [11, 3],
    [4, 0],
  ];
  const recentSessions: Session[] = counted.map(([deaths, bosses], index) => {
    const durationSeconds = 5_400 + index * 900;
    const endedAt = now - (index + 1) * DAY;
    return {
      id: -700 - index,
      gameId: TOUR_DEMO_GAME.gameId,
      gameName: TOUR_DEMO_GAME.name,
      coverUrl: TOUR_DEMO_GAME.coverUrl,
      exeName: TOUR_DEMO_GAME.exeName,
      startedAt: new Date(endedAt - durationSeconds * 1000).toISOString(),
      endedAt: new Date(endedAt).toISOString(),
      durationSeconds,
      counts: {
        [DEATHS_COUNTER_ID]: deaths,
        ...(bosses ? { [SAMPLE_BOSSES_ID]: bosses } : {}),
      },
    };
  });
  const startedAt = new Date(now - 137_000).toISOString();
  const running: ActiveSession = {
    id: -1,
    gameId: TOUR_DEMO_GAME.gameId,
    gameName: TOUR_DEMO_GAME.name,
    exeName: TOUR_DEMO_GAME.exeName,
    coverUrl: TOUR_DEMO_GAME.coverUrl,
    startedAt,
    checkpointedAt: startedAt,
    counts: { [DEATHS_COUNTER_ID]: 2 },
  };
  const settings = library.getState().settings;
  library.setState({
    gameJournals: {
      [journalKey(sampleGameRef)]: {
        ...emptyJournal(sampleGameRef),
        counters,
      },
    },
    recentSessions,
    activeSessions: [running],
    // The controller row only exists where a controller can count.
    settings: {
      ...settings,
      controllerCountingEnabled: currentPlatform() === "windows",
    },
  });
  return library;
}

let counterLibrary: { key: string; library: ReturnType<typeof makeCounterLibrary> } | null =
  null;

/** The sample game's counters and its running session, in a library of
 *  their own: the same while a guide runs, new when the guide puts the sample
 *  back or ends. Nothing reaches the player's library or registers a key. */
export function tourCounters() {
  const state = useAppStore.getState();
  const key = `${state.activeTour?.tourId ?? ""}:${state.demoResetToken}`;
  if (counterLibrary?.key !== key)
    counterLibrary = { key, library: makeCounterLibrary() };
  return { store: counterLibrary.library, game: sampleGameRef };
}

/* The Achievements page ──────────────────────────────────────────────────── */

/** The tab each step on the Achievements page needs. */
export const TOUR_ACHIEVEMENTS_PAGE_TABS: Record<string, "milestones" | "games"> =
  {
    page: "milestones",
    tabs: "milestones",
    ladders: "games",
  };

/** What a newcomer's Achievements page shows while the guide runs: some
 *  milestones won, more ahead, and game ladders with and without trophies. */
export function tourSampleAchievementsPage(now: Date = new Date()) {
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const at = (daysAgo: number) =>
    new Date(now.getTime() - daysAgo * DAY).toISOString();
  const milestone = (
    id: string,
    kind: AwardedMilestone["kind"],
    daysAgo: number,
    extra: Partial<AwardedMilestone> = {},
  ): AwardedMilestone => ({
    id,
    kind,
    title: id,
    awardedAt: at(daysAgo),
    ...extra,
  });
  const wow = { key: "tour-wow", name: TOUR_DEMO_GAME.name };
  const gameRung = (
    game: { key: string; name: string },
    threshold: number,
    daysAgo: number,
  ) =>
    milestone(
      `milestone:game:${game.key}:${threshold}`,
      "milestone-game",
      daysAgo,
      { gameName: game.name },
    );
  /* i18n-exempt: sample game names */
  const stardew = { key: "tour-stardew", name: "Stardew Valley" };
  const hades = { key: "tour-hades", name: "Hades" };
  const celeste = { key: "tour-celeste", name: "Celeste" };

  const awardedMilestones: AwardedMilestone[] = [
    milestone("milestone:total:10", "milestone-total", 60),
    milestone("milestone:total:50", "milestone-total", 35),
    milestone("milestone:total:100", "milestone-total", 9),
    milestone(`milestone:month:${monthKey}:10`, "milestone-month", 2),
    milestone("milestone:verified:1", "milestone-verified", 20),
    milestone("milestone:verified:5", "milestone-verified", 7),
    gameRung(wow, 10, 50),
    gameRung(wow, 25, 30),
    gameRung(wow, 50, 5),
    gameRung(stardew, 10, 25),
    gameRung(stardew, 25, 12),
  ];

  const games = new Map<string, { hours: number; name: string; coverUrl: string }>(
    [
      [wow.key, { hours: 62, name: wow.name, coverUrl: TOUR_DEMO_GAME.coverUrl }],
      [stardew.key, { hours: 31, name: stardew.name, coverUrl: "" }],
      [hades.key, { hours: 24, name: hades.name, coverUrl: "" }],
      [celeste.key, { hours: 4, name: celeste.name, coverUrl: "" }],
    ],
  );
  const metrics: MilestoneMetrics = {
    totalHours: 130,
    monthKey,
    monthHours: 12,
    streakDays: 0,
    verifiedCount: 6,
    verifiedEmulatorCount: 0,
    games,
    canonicalByAlias: new Map(),
  };
  const gameLabels = new Map<string, GameLabel>(
    [...games].map(([key, game]) => [
      key,
      { name: game.name, coverUrl: game.coverUrl },
    ]),
  );
  return { awardedMilestones, metrics, gameLabels };
}

/* Telling the guide ──────────────────────────────────────────────────────── */

/** A sample control tells its guide that the task is done, but only while
 *  that guide is on that very step. Anywhere else it does nothing. */
export function completeTourStep(
  tourId: string,
  stepId: string,
  message?: string,
) {
  const active = useAppStore.getState().activeTour;
  if (active?.tourId !== tourId) return;
  if (findTour(tourId)?.steps[active.stepIndex]?.id !== stepId) return;
  emitTourEvent("demo.step-completed", message);
}
