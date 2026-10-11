import type { GameSource, LibraryKnownExecutable } from "@playcounter/shared";
import { matchesProcessPatternSet } from "../ignoredProcessPatterns";
import { isRejectedGameFile } from "../rejectedGameFiles";
import { useAppStore, type GameMetadata } from "../store";
import { isGenericExeName } from "./exeCandidates";
import { reverseResolveLibraryGame } from "./gameLookup";
import type { LibraryExecutableMatch } from "./recheck";
import type { PlayCounterLibraryEntry } from "./types";

/** A file the server knows for a game, and who knows it: IGDB or the
 *  community. That is the card's badge, not the game's metadata source. */
export type KnownGameFile = { exeName: string; identifierSource: GameSource };

/** The server's files that count for a game by name alone: the ones a
 *  launcher import links by name. Game.exe and unverified or shared names
 *  need an install folder, which a game linked by hand does not have. */
export function knownGameFiles(
  executables: readonly LibraryKnownExecutable[],
): KnownGameFile[] {
  const state = useAppStore.getState();
  const files = new Map<string, KnownGameFile>();
  for (const executable of executables) {
    const name = executable.value.trim();
    if (
      executable.platform !== "windows" ||
      executable.kind !== "exe" ||
      !executable.verified ||
      executable.ambiguous ||
      !name.toLowerCase().endsWith(".exe") ||
      isGenericExeName(name) ||
      matchesProcessPatternSet(name, state.blacklist) ||
      matchesProcessPatternSet(name, state.ignoredProcesses)
    ) {
      continue;
    }
    // Known to IGDB and the community: IGDB wins, as in a launcher import.
    const existing = files.get(name.toLowerCase());
    files.set(name.toLowerCase(), {
      exeName: existing?.exeName ?? name,
      identifierSource:
        existing?.identifierSource === "igdb" ? "igdb" : executable.provenance,
    });
  }
  return [...files.values()];
}

export type PlayCounterMatchCheck =
  | {
      kind: "found";
      game: GameMetadata;
      files: KnownGameFile[];
      executableMatches: LibraryExecutableMatch[];
    }
  /** Only names that need a folder (Game.exe & co.), which a PlayCounter
   *  game does not have: the user picks the file with Set launch file. */
  | { kind: "needs_file"; executableNames: string[] }
  | { kind: "not_found" };

/**
 * The launcher games' "Check for matches" for a PlayCounter game: a game
 * added by hand or moved away from its launcher, without a file yet. Writes
 * nothing; the caller links `files` with linkKnownGameFiles.
 */
export async function checkPlayCounterGameForMatches(input: {
  apiEndpoint: string;
  game: Pick<PlayCounterLibraryEntry, "gameId" | "igdbId">;
  signal?: AbortSignal;
}): Promise<PlayCounterMatchCheck> {
  const result = await reverseResolveLibraryGame(
    input.apiEndpoint,
    input.game.gameId,
    input.signal,
  );
  if (result.game.igdbId !== input.game.igdbId) return { kind: "not_found" };
  const state = useAppStore.getState();
  // The same files linkKnownGameFiles would link: none that already counts
  // for a game or that the user took away from this one.
  const usable = (exeName: string) => {
    const existing = state.exeCache.get(exeName.toLowerCase());
    return (
      (!existing || existing.state === "unmatched") &&
      !isRejectedGameFile(state.rejectedGameFiles, exeName, result.game)
    );
  };
  const files = knownGameFiles(result.executables).filter((file) =>
    usable(file.exeName),
  );
  if (files.length > 0) {
    return {
      kind: "found",
      game: result.game,
      files,
      executableMatches: files.map((file) => ({
        name: file.exeName,
        sources: [
          ...new Set(
            result.executables
              .filter(
                (executable) =>
                  executable.platform === "windows" &&
                  executable.kind === "exe" &&
                  executable.value.trim().toLowerCase() ===
                    file.exeName.toLowerCase(),
              )
              .map((executable) => executable.provenance),
          ),
        ],
      })),
    };
  }
  const folderOnly = new Map<string, string>();
  for (const executable of result.executables) {
    const name = executable.value.trim();
    if (
      executable.platform === "windows" &&
      executable.kind === "exe" &&
      name.toLowerCase().endsWith(".exe") &&
      !matchesProcessPatternSet(name, state.blacklist) &&
      !matchesProcessPatternSet(name, state.ignoredProcesses) &&
      usable(name)
    ) {
      folderOnly.set(name.toLowerCase(), name);
    }
  }
  return folderOnly.size > 0
    ? { kind: "needs_file", executableNames: [...folderOnly.values()] }
    : { kind: "not_found" };
}
