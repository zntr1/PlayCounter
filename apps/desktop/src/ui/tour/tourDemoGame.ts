import type { EmulatorMapping } from "../../emulators/types";
import type { ActiveSession } from "../../store";

export const TOUR_DEMO_GAME = {
  gameId: -1,
  name: "World of Warcraft",
  exeName: "Wow.exe",
  exePath: "C:\\Games\\World of Warcraft\\_retail_\\Wow.exe",
  coverUrl: "https://images.igdb.com/igdb/image/upload/t_cover_big/co2l7z.webp",
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
  coverUrl: "https://images.igdb.com/igdb/image/upload/t_cover_big/co3ohz.webp",
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
