import type { EmulatorMapping } from "../../emulators/types";
import type { ActiveSession } from "../../store";
import type { Session } from "@playcounter/shared";
import type { GameSummary } from "../views/MyGamesView";

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
