import type { PlayCounterLibraryEntry } from "./types";

export function normalizePlayCounterLibraryEntry(
  value: unknown,
): PlayCounterLibraryEntry | null {
  if (!value || typeof value !== "object") return null;
  const entry = value as Partial<PlayCounterLibraryEntry>;
  if (
    !Number.isSafeInteger(entry.gameId) ||
    (entry.gameId ?? 0) <= 0 ||
    !Number.isSafeInteger(entry.igdbId) ||
    (entry.igdbId ?? 0) <= 0 ||
    (entry.source !== "igdb" && entry.source !== "community") ||
    typeof entry.name !== "string" ||
    !entry.name.trim() ||
    typeof entry.coverUrl !== "string" ||
    typeof entry.addedAt !== "string" ||
    !Number.isFinite(Date.parse(entry.addedAt)) ||
    (entry.lastPlayedAt !== undefined &&
      (typeof entry.lastPlayedAt !== "string" ||
        !Number.isFinite(Date.parse(entry.lastPlayedAt))))
  ) {
    return null;
  }
  if (
    entry.aliases !== undefined &&
    (!Array.isArray(entry.aliases) ||
      entry.aliases.some(
        (alias) =>
          !alias ||
          !Number.isSafeInteger(alias.gameId) ||
          (alias.source !== undefined &&
            alias.source !== null &&
            alias.source !== "igdb" &&
            alias.source !== "community" &&
            alias.source !== "custom"),
      ))
  )
    return null;
  return entry as PlayCounterLibraryEntry;
}
