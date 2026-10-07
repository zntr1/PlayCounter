import type { GameSource, LibraryKnownExecutable } from "@playcounter/shared";
import { matchesProcessPatternSet } from "../ignoredProcessPatterns";
import { currentPlatform } from "../platform";
import { useAppStore } from "../store";
import { isGenericExeName } from "./exeCandidates";

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
  const mac = currentPlatform() === "macos";
  for (const executable of executables) {
    const name = executable.value.trim();
    // Only files this computer runs natively. A Mac runs a .exe only through
    // Wine, and the server is asked about it live when it does.
    const runsHere = mac
      ? executable.platform === "macos" && executable.kind === "process_name"
      : executable.platform === "windows" &&
        executable.kind === "exe" &&
        name.toLowerCase().endsWith(".exe");
    if (
      !runsHere ||
      !executable.verified ||
      executable.ambiguous ||
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
