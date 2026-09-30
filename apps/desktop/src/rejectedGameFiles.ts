import type { GameSource } from "@playcounter/shared";

/* "It doesn't belong to <game>": that file never counts for that game again on
   this PC, whatever the server, a launcher import or a recheck says. Linking
   the file to the game yourself undoes it. The report to community review is
   separate; this is what holds until review answers, and after. */

export type RejectedGameFile = {
  /** Lowercase: cs2.exe and CS2.exe are one file. */
  exeName: string;
  gameId: number;
  source: "igdb" | "community";
  /** The game by its IGDB id when it has one, so its IGDB and community
   *  entries both count as the rejected game. */
  igdbId?: number;
  rejectedAt: string;
};

type GameRef = {
  id?: number;
  gameId?: number;
  igdbId?: number | null;
  source?: GameSource | null;
};

function isRejectedGame(entry: RejectedGameFile, game: GameRef) {
  if (entry.igdbId !== undefined && game.igdbId != null) {
    return entry.igdbId === game.igdbId;
  }
  return (
    entry.source === (game.source ?? null) &&
    entry.gameId === (game.gameId ?? game.id)
  );
}

export function isRejectedGameFile(
  rejected: readonly RejectedGameFile[],
  exeName: string,
  game: GameRef,
) {
  const key = exeName.toLowerCase();
  return rejected.some(
    (entry) => entry.exeName === key && isRejectedGame(entry, game),
  );
}

/** The list without that file and game: the user linked it again. */
export function withoutRejectedGameFile(
  rejected: readonly RejectedGameFile[],
  exeName: string,
  game: GameRef,
) {
  const key = exeName.toLowerCase();
  return rejected.filter(
    (entry) => entry.exeName !== key || !isRejectedGame(entry, game),
  );
}

/** Saved data read back: malformed entries are dropped. */
export function sanitizeRejectedGameFiles(value: unknown): RejectedGameFile[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): RejectedGameFile[] => {
    if (!item || typeof item !== "object") return [];
    const entry = item as Partial<RejectedGameFile>;
    if (
      typeof entry.exeName !== "string" ||
      !entry.exeName.trim() ||
      !Number.isSafeInteger(entry.gameId) ||
      (entry.source !== "igdb" && entry.source !== "community") ||
      typeof entry.rejectedAt !== "string"
    ) {
      return [];
    }
    return [
      {
        exeName: entry.exeName.toLowerCase(),
        gameId: entry.gameId!,
        source: entry.source,
        ...(Number.isSafeInteger(entry.igdbId) && entry.igdbId! > 0
          ? { igdbId: entry.igdbId }
          : {}),
        rejectedAt: entry.rejectedAt,
      },
    ];
  });
}
