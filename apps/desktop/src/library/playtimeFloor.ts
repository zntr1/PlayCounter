import type { LibraryImportEntry } from "./types";

export type ProviderFloor = {
  canonicalKey: string;
  seconds: number;
  name: string;
  coverUrl: string;
};

export function providerFloors(
  entries: Iterable<LibraryImportEntry>,
): ProviderFloor[] {
  const floors = new Map<string, ProviderFloor>();
  for (const entry of entries) {
    const seconds = Math.max(0, Math.round(entry.providerSeconds));
    if (!Number.isFinite(seconds) || seconds === 0) continue;
    const canonicalKey = `igdb#${entry.igdbId}`;
    const current = floors.get(canonicalKey);
    if (!current || seconds > current.seconds) {
      floors.set(canonicalKey, {
        canonicalKey,
        seconds,
        name: entry.name,
        coverUrl: entry.coverUrl,
      });
    }
  }
  return [...floors.values()];
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
