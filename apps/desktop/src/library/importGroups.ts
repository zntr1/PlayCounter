import { matchesProcessPatternSet } from "../ignoredProcessPatterns";
import type { BuiltinImportProviderId } from "./importProviders";
import { importProfile } from "./importProfiles";
import type { ResolvedLibraryGame, ScannedLibraryGame } from "./types";
import { libraryEntryKey } from "./types";

/* Which shelf a scanned game lands on. Pure rules, the same for every
   launcher: the launcher's profile supplies the facts that differ. */

/** ready: nothing to decide. attention: "Needs you". unavailable: "Can't
 *  import". imported: "Already in My Games". */
export type ImportGroupKey = "ready" | "attention" | "unavailable" | "imported";

export const IMPORT_GROUP_ORDER: readonly ImportGroupKey[] = [
  "ready",
  "attention",
  "imported",
  "unavailable",
];

export function hasImportableActivity(game: ScannedLibraryGame) {
  return (
    (game.playtimeSeconds === null && game.hasPlayedEvidence !== false) ||
    (game.playtimeSeconds ?? 0) > 0 ||
    game.lastPlayedUnix !== undefined
  );
}

export function hasImportableContent(game: ScannedLibraryGame) {
  return (
    hasImportableActivity(game) ||
    game.inAccountLibrary === true ||
    (game.hasPlayedEvidence !== undefined && game.installed)
  );
}

export function isImportable(
  game: ScannedLibraryGame,
  resolved?: ResolvedLibraryGame,
) {
  return (
    resolved?.status === "resolved" &&
    resolved.game?.igdbId !== undefined &&
    hasImportableContent(game)
  );
}

/**
 * A game you own but never played and have not installed: importable, but
 * only when you pick it. Launcher accounts collect many free games.
 */
export function startsUnchecked(game: ScannedLibraryGame) {
  return (
    game.inAccountLibrary === true &&
    !game.installed &&
    !hasImportableActivity(game)
  );
}

/** An installed, matched game none of whose known files is on this PC. */
export function requiresExecutableChoice(
  game: ScannedLibraryGame,
  resolved?: ResolvedLibraryGame,
  ignoredProcesses: ReadonlySet<string> = new Set(),
) {
  if (
    resolved?.status !== "resolved" ||
    !resolved.game?.igdbId ||
    !game.installed
  ) {
    return false;
  }
  const knownNames = new Set(
    resolved.executables
      .filter(
        (item) =>
          item.platform === "windows" &&
          item.kind === "exe" &&
          !matchesProcessPatternSet(item.value, ignoredProcesses),
      )
      .map((item) => item.value.toLowerCase()),
  );
  const hasKnownLocalExe = game.executables.some((item) =>
    knownNames.has(item.fileName.toLowerCase()),
  );
  return !hasKnownLocalExe && game.installPath !== undefined;
}

/** The server matched by name and found no safe match: the player picks. */
export function needsGameChoice(
  provider: BuiltinImportProviderId,
  game: ScannedLibraryGame,
  resolved?: ResolvedLibraryGame,
) {
  return (
    importProfile(provider).matchedBy === "name" &&
    hasImportableContent(game) &&
    resolved?.status !== "resolved"
  );
}

/** The detail shows "Which file starts the game?". */
export function showsFileChoice(
  provider: BuiltinImportProviderId,
  game: ScannedLibraryGame,
  resolved?: ResolvedLibraryGame,
  ignoredProcesses?: ReadonlySet<string>,
) {
  return (
    requiresExecutableChoice(game, resolved, ignoredProcesses) ||
    (needsGameChoice(provider, game, resolved) &&
      game.installed &&
      game.installPath !== undefined)
  );
}

export function canImportScannedGame(params: {
  game: ScannedLibraryGame;
  resolved?: ResolvedLibraryGame;
  alreadyImported: boolean;
  ignoredProcesses?: ReadonlySet<string>;
}) {
  const { game, resolved, alreadyImported, ignoredProcesses } = params;
  if (!isImportable(game, resolved)) return false;
  // Importing a game that is already in My Games only refreshes it, so a
  // missing file link must not block it. A file picked for it is saved then.
  return (
    alreadyImported ||
    !requiresExecutableChoice(game, resolved, ignoredProcesses)
  );
}

/**
 * A game already in My Games belongs to "Already in My Games", even when it
 * can be imported again to refresh it.
 */
export function importGroupForGame(params: {
  game: ScannedLibraryGame;
  provider: BuiltinImportProviderId;
  resolved?: ResolvedLibraryGame;
  alreadyImported: boolean;
  completed?: boolean;
  ignoredProcesses?: ReadonlySet<string>;
}): ImportGroupKey {
  const { game, provider, resolved, ignoredProcesses } = params;
  if (params.completed || params.alreadyImported) return "imported";
  if (!hasImportableContent(game)) return "unavailable";
  if (needsGameChoice(provider, game, resolved)) return "attention";
  if (!isImportable(game, resolved)) return "unavailable";
  if (requiresExecutableChoice(game, resolved, ignoredProcesses)) {
    return "attention";
  }
  return "ready";
}

/** The first shelf with games, in shelf order. */
export function initialImportGroup(
  provider: BuiltinImportProviderId,
  games: readonly ScannedLibraryGame[],
  resolved: ReadonlyMap<string, ResolvedLibraryGame>,
  existingImports: ReadonlyMap<string, unknown>,
  ignoredProcesses: ReadonlySet<string>,
): ImportGroupKey {
  const present = new Set(
    games.map((game) => {
      const key = libraryEntryKey(provider, game.externalId);
      return importGroupForGame({
        game,
        provider,
        resolved: resolved.get(key),
        alreadyImported: existingImports.has(key),
        ignoredProcesses,
      });
    }),
  );
  return IMPORT_GROUP_ORDER.find((group) => present.has(group)) ?? "ready";
}
