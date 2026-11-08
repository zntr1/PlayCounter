import { adapterFor } from "../emulators/registry";
import { matchesProcessPatternSet } from "../ignoredProcessPatterns";
import {
  canonicalGameKey,
  createGameIdentityResolver,
  gameMetadataKey,
  resolvedCanonicalGameKey,
  type AppState,
  type GameMetadata,
} from "../store";

type MyGamesSources = Pick<
  AppState,
  | "recentSessions"
  | "activeSessions"
  | "exeCache"
  | "scopedExeLinks"
  | "playcounterLibrary"
  | "libraryImports"
  | "emulatorMappings"
  | "gameMetadata"
  | "userIgnoredProcesses"
  | "blacklist"
>;

/** The keys of the games My Games lists, for the quick add box, which has to
 *  know while that screen isn't open. They're read from the same places, in
 *  the same way, as MyGamesView's `games`: played and running games, the
 *  games' files, games added with Add game, launcher imports and emulator
 *  games. A game with an IGDB id has the key `igdb#<id>`. When My Games reads
 *  its games from somewhere new, add it here too. */
export function myGamesKeys(state: MyGamesSources): Set<string> {
  const keys = new Set<string>();
  const ignored = new Set([...state.userIgnoredProcesses, ...state.blacklist]);
  const isIgnored = (exeName: string) =>
    matchesProcessPatternSet(exeName, ignored);
  const resolveIgdbId = createGameIdentityResolver(
    state.gameMetadata,
    state.exeCache,
    state.libraryImports,
  );

  for (const session of [...state.recentSessions, ...state.activeSessions]) {
    if (isIgnored(session.exeName)) continue;
    const hydrated =
      session.source === "igdb" || session.source === "community"
        ? state.gameMetadata.get(
            gameMetadataKey({ id: session.gameId, source: session.source }),
          )
        : (state.gameMetadata.get(`igdb:${session.gameId}`) ??
          state.gameMetadata.get(`community:${session.gameId}`));
    const source = session.source ?? hydrated?.source ?? null;
    const resolved = resolveIgdbId(session.gameId, source, session.gameName);
    keys.add(
      resolvedCanonicalGameKey({
        gameId: session.gameId,
        source,
        igdbId:
          resolved === null
            ? undefined
            : (session.igdbId ?? hydrated?.igdbId ?? resolved ?? undefined),
        gameName: session.gameName,
        coverUrl: session.coverUrl,
      }),
    );
  }

  const files = [
    ...state.exeCache.values(),
    ...[...state.scopedExeLinks.values()].map((link) => ({
      ...link,
      state: "matched" as const,
    })),
  ];
  for (const entry of files) {
    if (entry.state !== "matched" || !entry.gameId) continue;
    if (isIgnored(entry.exeName)) continue;
    keys.add(
      resolvedCanonicalGameKey(
        {
          gameId: entry.gameId,
          source: entry.source,
          igdbId: entry.igdbId,
          gameName: entry.gameName,
          coverUrl: entry.coverUrl,
        },
        resolveIgdbId,
      ),
    );
  }

  for (const entry of state.playcounterLibrary.values()) {
    keys.add(`igdb#${entry.igdbId}`);
  }
  for (const entry of state.libraryImports.values()) {
    keys.add(`igdb#${entry.igdbId}`);
  }

  for (const mapping of state.emulatorMappings.values()) {
    if (
      mapping.decision !== "game" ||
      mapping.gameId === undefined ||
      !adapterFor(mapping.emulatorId)?.launch
    ) {
      continue;
    }
    keys.add(
      resolvedCanonicalGameKey(
        {
          gameId: mapping.gameId,
          source: mapping.source ?? null,
          igdbId: mapping.igdbId,
          gameName: mapping.gameName,
          coverUrl: mapping.coverUrl,
        },
        resolveIgdbId,
      ),
    );
  }

  return keys;
}

/** A search result is in My Games when its game has one of the keys. */
export function inMyGames(keys: ReadonlySet<string>, game: GameMetadata) {
  return keys.has(
    canonicalGameKey({
      gameId: game.id,
      source: game.source,
      igdbId: game.igdbId,
    }),
  );
}
