import type { LibraryProviderId } from "@playcounter/shared";
import type { LibraryImportEntry } from "./types";

export type ProviderFloor = {
  canonicalKey: string;
  seconds: number;
  /**
   * PlayCounter's recorded time at the latest launcher read in this total
   * (the largest snapshot). Undefined when one of the reads predates
   * snapshots: the total then stays flat.
   */
  recordedSecondsAtRead?: number;
  /** When the latest launcher read in this total was taken. */
  readAtMs?: number;
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
    return {
      canonicalKey: largest.canonicalKey,
      seconds: values.reduce((total, floor) => total + floor.seconds, 0),
      recordedSecondsAtRead: values.every(
        (floor) => floor.recordedSecondsAtRead !== undefined,
      )
        ? Math.max(...values.map((floor) => floor.recordedSecondsAtRead!))
        : undefined,
      readAtMs: values.every((floor) => floor.readAtMs !== undefined)
        ? Math.max(...values.map((floor) => floor.readAtMs!))
        : undefined,
      name: largest.name,
      coverUrl: largest.coverUrl,
    };
  });
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
