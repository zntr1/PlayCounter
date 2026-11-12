import type { EmulatorMapping } from "../../emulators/types";
import type { ActiveSession } from "../../store";
import type { Game, Session } from "@playcounter/shared";
import type { GameSummary } from "../views/MyGamesView";
import type { SampleDetailsTab, TourStep } from "./tourTypes";

/** What the sample card in My Games shows when a step starts. */
export type SampleStage = {
  /** Its right-click menu is open. */
  menu: boolean;
  /** This flyout of the menu is open too (its `data-tour` name). */
  flyout: string | null;
  /** "Log a missed session" is open. */
  logSession: boolean;
  /** The cover's hover buttons show without the pointer on the card. */
  hoverButtons: boolean;
  /** Details is open on this tab (the step's `sampleDetails`). */
  details: SampleDetailsTab | null;
};

type StagedStep = Pick<
  TourStep,
  | "anchor"
  | "anchorTargets"
  | "additionalAnchors"
  | "retreatWhenMissing"
  | "sampleDetails"
>;

const tourNames = (selectors: readonly (string | undefined)[]) =>
  selectors.flatMap((selector) =>
    [...(selector ?? "").matchAll(/data-tour="([^"]+)"/g)].map(
      (match) => match[1],
    ),
  );

// How the sample card's `data-tour` names start. The names themselves are
// written out where they are rendered (views/MyGamesView.tsx).
const MENU_ROOTS = ["demo-context-menu", "demo-library-menu"];
const MENU_ENTRY = "demo-menu-";
const CARD_BUTTON = "demo-card-";
const LOG_SESSION = "demo-log-session-";

/** The sample card sets itself up from what a step rings, never from the
 *  step's place in its guide: a step that rings a menu entry gets the menu,
 *  one that rings a flyout gets that flyout, the dialog step gets its
 *  dialog. A step added to a guide needs nothing else. */
export function sampleStageForStep(step: StagedStep | undefined): SampleStage {
  // What the step cannot do without, then what it would like to ring.
  const needs = tourNames([step?.retreatWhenMissing, step?.anchor]);
  const names = [...needs, ...tourNames(step?.anchorTargets ?? [])];
  const logSession = needs.some((name) => name.startsWith(LOG_SESSION));
  const flyout =
    names.find(
      (name) => !MENU_ROOTS.includes(name) && /^demo-[a-z]+-menu$/.test(name),
    ) ?? null;
  return {
    menu:
      !logSession &&
      (flyout !== null ||
        names.some(
          (name) => MENU_ROOTS.includes(name) || name.startsWith(MENU_ENTRY),
        )),
    flyout: logSession ? null : flyout,
    logSession,
    hoverButtons: names.some((name) => name.startsWith(CARD_BUTTON)),
    details: step?.sampleDetails ?? null,
  };
}

/** Whether a step rings this entry of the sample card: "details" is the menu
 *  entry demo-menu-details or the cover button demo-card-details. Done on
 *  such a step, the entry's action finishes the step. */
export function stepAsksForSampleEntry(
  step: StagedStep | undefined,
  entry: string,
) {
  return tourNames([
    step?.anchor,
    ...(step?.anchorTargets ?? []),
    ...(step?.additionalAnchors ?? []),
  ]).some(
    (name) => name === MENU_ENTRY + entry || name === CARD_BUTTON + entry,
  );
}

/** What "Check for Matches" finds for the sample's game file: the community
 *  match and IGDB's entry. Bundled, so nothing is looked up. */
export function tourSampleMatches(): Game[] {
  const match = {
    id: TOUR_DEMO_GAME.gameId,
    name: TOUR_DEMO_GAME.name,
    coverUrl: TOUR_DEMO_GAME.coverUrl,
    releaseYear: 2004,
  };
  return [
    { ...match, source: "community" },
    { ...match, source: "igdb" },
  ];
}

export function tourSessionsForGame(game: GameSummary): Session[] {
  const count = Math.max(0, game.sessionCount);
  const total = Math.max(0, Math.round(game.sessionSeconds));
  return Array.from({ length: count }, (_, index) => {
    const durationSeconds =
      Math.floor(total / count) + (index < total % count ? 1 : 0);
    const endedAt = Date.now() - (index + 1) * 86400000;
    return {
      id: -500 - index,
      gameId: game.gameId,
      gameName: game.name,
      source: game.source ?? undefined,
      coverUrl: game.coverUrl ?? undefined,
      exeName: game.exeNames[0] ?? "sample.exe",
      startedAt: new Date(endedAt - durationSeconds * 1000).toISOString(),
      endedAt: new Date(endedAt).toISOString(),
      durationSeconds,
    };
  });
}

/** The second practice card, Grand Theft Auto V. */
export const TOUR_GTA_GAME_ID = -2;

export const TOUR_DEMO_GAME = {
  gameId: -1,
  name: "World of Warcraft",
  exeName: "Wow.exe",
  exePath: "C:\\Games\\World of Warcraft\\_retail_\\Wow.exe",
  // Bundled artwork keeps the quick tour ready even on a first, offline run.
  coverUrl: "/tour/world-of-warcraft-cover.webp",
  bannerUrl: "/tour/world-of-warcraft-banner.jpg",
} as const;

export const EMULATOR_TOUR_ID = "emulators";

export const TOUR_DEMO_EMULATOR = {
  emulatorId: "dolphin",
  label: "Dolphin",
  hostExeName: "dolphin.exe",
  contentKey: "playcounter-tour:dolphin:rom:zelda-wind-waker",
  contentValue: "zelda wind waker.rvz",
  display: "Zelda Wind Waker.rvz",
  gameId: -2,
  gameName: "The Legend of Zelda: The Wind Waker",
  coverUrl: "/tour/zelda-wind-waker-cover.webp",
} as const;

export const TOUR_DEMO_EMULATOR_STATS = {
  playtimeSeconds: 24_000,
  sessions: 5,
  games: 1,
  ignored: 0,
} as const;

export function tourDemoEmulatorMapping(): EmulatorMapping {
  const now = Date.now();
  return {
    contentKey: TOUR_DEMO_EMULATOR.contentKey,
    emulatorId: TOUR_DEMO_EMULATOR.emulatorId,
    label: TOUR_DEMO_EMULATOR.label,
    contentKind: "rom",
    contentValue: TOUR_DEMO_EMULATOR.contentValue,
    display: TOUR_DEMO_EMULATOR.display,
    trust: "recognized",
    decision: "game",
    gameId: TOUR_DEMO_EMULATOR.gameId,
    gameName: TOUR_DEMO_EMULATOR.gameName,
    coverUrl: TOUR_DEMO_EMULATOR.coverUrl,
    source: "igdb",
    confidence: "probable",
    needsConfirmation: true,
    shareable: true,
    detectionSource: "launch_arguments",
    decidedAt: new Date(now - 7 * 24 * 60 * 60 * 1_000).toISOString(),
    lastSeenAt: new Date(now - 60 * 60 * 1_000).toISOString(),
  };
}

export function tourDemoEmulatorSession(startedAt: string): ActiveSession {
  return {
    id: TOUR_DEMO_EMULATOR.gameId,
    gameId: TOUR_DEMO_EMULATOR.gameId,
    gameName: TOUR_DEMO_EMULATOR.gameName,
    exeName: TOUR_DEMO_EMULATOR.hostExeName,
    coverUrl: TOUR_DEMO_EMULATOR.coverUrl,
    source: "igdb",
    startedAt,
    checkpointedAt: startedAt,
    emulator: {
      emulatorId: TOUR_DEMO_EMULATOR.emulatorId,
      label: TOUR_DEMO_EMULATOR.label,
      contentKey: TOUR_DEMO_EMULATOR.contentKey,
      display: TOUR_DEMO_EMULATOR.display,
      trust: "recognized",
    },
  };
}

export function emulatorTourDemoActive(
  tourId: string | null | undefined,
  emulatorId?: string,
) {
  if (tourId !== EMULATOR_TOUR_ID) return false;
  return (
    emulatorId === undefined || emulatorId === TOUR_DEMO_EMULATOR.emulatorId
  );
}
