import type { LibraryProviderId } from "@playcounter/shared";
import type { LibraryImportEntry } from "./types";

/**
 * Launchers that count console play. It never overlaps the sessions
 * PlayCounter sees on this PC, so a game's total is this PC's side plus the
 * console side, each with its own snapshot (docs/psn-import-plan.md).
 */
export const CONSOLE_PROVIDERS: ReadonlySet<LibraryProviderId> = new Set([
  "playstation",
]);

export type LauncherSide = {
  seconds: number;
  /** PlayCounter's time on this side at the side's latest read. */
  recordedSecondsAtRead?: number;
  readAtMs?: number;
};

export type ProviderFloor = {
  canonicalKey: string;
  /** Every launcher together: this PC's launchers and the console side. */
  seconds: number;
  /**
   * PlayCounter's recorded time at the latest read of this PC's launchers
   * (the largest snapshot). Undefined when one of the reads predates
   * snapshots (the total then stays flat), or without a PC launcher.
   */
  recordedSecondsAtRead?: number;
  /** When the latest read of this PC's launchers was taken. */
  readAtMs?: number;
  /** PlayStation's total: console play, with its own snapshot. */
  console?: LauncherSide;
  name: string;
  coverUrl: string;
};

export function providerFloorKey(game: {
  igdbId?: number;
  source?: string | null;
  gameId: number;
}) {
  return game.igdbId === undefined
    ? `${game.source ?? "unknown"}:${game.gameId}`
    : `igdb#${game.igdbId}`;
}

export function providerFloors(
  entries: Iterable<LibraryImportEntry>,
): ProviderFloor[] {
  const floors = new Map<string, Map<LibraryProviderId, ProviderFloor>>();
  for (const entry of entries) {
    if (entry.providerSeconds === null) continue;
    const seconds = Math.max(0, Math.round(entry.providerSeconds));
    if (!Number.isFinite(seconds) || seconds === 0) continue;
    const canonicalKey = providerFloorKey(entry);
    const providers =
      floors.get(canonicalKey) ?? new Map<LibraryProviderId, ProviderFloor>();
    const current = providers.get(entry.provider);
    // Each console entry is its own copy (a PS4 and a PS5 concept IGDB calls
    // one game): their times add up.
    if (current && CONSOLE_PROVIDERS.has(entry.provider)) {
      const recorded = validRecordedSeconds(entry.recordedSecondsAtRead);
      const readAtMs = validDateMs(entry.lastReadAt);
      providers.set(entry.provider, {
        ...current,
        seconds: current.seconds + seconds,
        recordedSecondsAtRead:
          current.recordedSecondsAtRead === undefined || recorded === undefined
            ? undefined
            : Math.max(current.recordedSecondsAtRead, recorded),
        readAtMs:
          current.readAtMs === undefined || readAtMs === undefined
            ? undefined
            : Math.max(current.readAtMs, readAtMs),
      });
      continue;
    }
    if (!current || seconds > current.seconds) {
      providers.set(entry.provider, {
        canonicalKey,
        seconds,
        recordedSecondsAtRead: validRecordedSeconds(
          entry.recordedSecondsAtRead,
        ),
        readAtMs: validDateMs(entry.lastReadAt),
        name: entry.name,
        coverUrl: entry.coverUrl,
      });
      floors.set(canonicalKey, providers);
    }
  }
  // Launcher counters are independent. Keep one lifetime total per launcher,
  // then sum them before comparing with overlapping PlayCounter tracking.
  // PlayCounter time counts as new from the latest read on (the largest
  // snapshot): an older read may miss some of it until that launcher is
  // imported again, but nothing is ever counted twice.
  return [...floors.values()].map((providers) => {
    const values = [...providers.values()];
    const largest = values.reduce((current, floor) =>
      floor.seconds > current.seconds ? floor : current,
    );
    const thisPc = launcherSide(
      [...providers]
        .filter(([provider]) => !CONSOLE_PROVIDERS.has(provider))
        .map(([, floor]) => floor),
    );
    const consoleSide = launcherSide(
      [...providers]
        .filter(([provider]) => CONSOLE_PROVIDERS.has(provider))
        .map(([, floor]) => floor),
    );
    return {
      canonicalKey: largest.canonicalKey,
      seconds: (thisPc?.seconds ?? 0) + (consoleSide?.seconds ?? 0),
      recordedSecondsAtRead: thisPc?.recordedSecondsAtRead,
      readAtMs: thisPc?.readAtMs,
      ...(consoleSide ? { console: consoleSide } : {}),
      name: largest.name,
      coverUrl: largest.coverUrl,
    };
  });
}

function launcherSide(values: ProviderFloor[]): LauncherSide | undefined {
  if (values.length === 0) return undefined;
  return {
    seconds: values.reduce((total, floor) => total + floor.seconds, 0),
    recordedSecondsAtRead: values.every(
      (floor) => floor.recordedSecondsAtRead !== undefined,
    )
      ? Math.max(...values.map((floor) => floor.recordedSecondsAtRead!))
      : undefined,
    readAtMs: values.every((floor) => floor.readAtMs !== undefined)
      ? Math.max(...values.map((floor) => floor.readAtMs!))
      : undefined,
  };
}

function validRecordedSeconds(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.round(value)
    : undefined;
}

function validDateMs(value: string) {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : undefined;
}

export function providerFloorsForProvider(
  entries: Iterable<LibraryImportEntry>,
  provider: LibraryProviderId,
) {
  const scopedEntries: LibraryImportEntry[] = [];
  for (const entry of entries) {
    if (entry.provider === provider) scopedEntries.push(entry);
  }
  return providerFloors(scopedEntries);
}

export function providerFloorsByKey(
  floors: Iterable<ProviderFloor>,
): Record<string, ProviderFloor> {
  const result: Record<string, ProviderFloor> = {};
  for (const floor of floors) result[floor.canonicalKey] = floor;
  return result;
}

export function providerFloorRecord(
  floors: Iterable<ProviderFloor>,
): Record<string, number> {
  const result: Record<string, number> = {};
  for (const floor of floors) {
    result[floor.canonicalKey] = Math.max(
      result[floor.canonicalKey] ?? 0,
      floor.seconds,
    );
  }
  return result;
}
