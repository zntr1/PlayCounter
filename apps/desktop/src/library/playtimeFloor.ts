import type { LibraryProviderId } from "@playcounter/shared";
import type { LibraryImportEntry } from "./types";

export type ProviderFloor = {
  canonicalKey: string;
  seconds: number;
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
        name: entry.name,
        coverUrl: entry.coverUrl,
      });
      floors.set(canonicalKey, providers);
    }
  }
  // Launcher counters are independent. Keep one lifetime total per launcher,
  // then sum them before comparing with overlapping PlayCounter tracking.
  return [...floors.values()].map((providers) => {
    const values = [...providers.values()];
    const largest = values.reduce((current, floor) =>
      floor.seconds > current.seconds ? floor : current,
    );
    return {
      ...largest,
      seconds: values.reduce((total, floor) => total + floor.seconds, 0),
    };
  });
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
