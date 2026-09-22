import { gameSecondsKey, gameSecondsRefFromKey } from "../gameSeconds";
import { persistAppState } from "../persistence";
import { MIN_SESSION_DURATION_SECONDS } from "../sessionPersistence";
import {
  adjustmentSecondsFor,
  effectiveTotalSeconds,
} from "../playtimeAdjustments";
import {
  gameMetadataKey,
  personalGameIdentity,
  useAppStore,
  type AppState,
  type GameIdentityRef,
} from "../store";
import { libraryEntryKey, type LibraryImportEntry } from "./types";
import { providerFloors } from "./playtimeFloor";

type MoveTarget = GameIdentityRef & { aliases?: GameIdentityRef[] };
type MoveChanges = Pick<
  AppState,
  | "libraryImports"
  | "libraryInstalls"
  | "playcounterLibrary"
  | "exeCache"
  | "scopedExeLinks"
  | "gameMetadata"
  | "playtimeAdjustments"
>;

/** Detach all launchers for one canonical game without manufacturing sessions. */
export function moveGameToPlayCounter(game: MoveTarget) {
  return moveGamesToPlayCounter([game]) > 0;
}

/** Save a whole selection together, skipping games already in PlayCounter. */
export function moveGamesToPlayCounter(games: readonly MoveTarget[]) {
  const state = useAppStore.getState();
  const identity = personalGameIdentity(state);
  const targets = new Map<
    string,
    { game: MoveTarget; imports: LibraryImportEntry[] }
  >();
  for (const game of games) {
    const key = identity(game);
    const existing = targets.get(key);
    if (existing) {
      existing.game = {
        ...existing.game,
        aliases: [
          ...(existing.game.aliases ?? []),
          game,
          ...(game.aliases ?? []),
        ],
      };
    } else targets.set(key, { game, imports: [] });
  }
  for (const entry of state.libraryImports.values()) {
    targets.get(identity(entry))?.imports.push(entry);
  }
  const moves = [...targets].filter(([, target]) => target.imports.length > 0);
  if (moves.length === 0) return 0;

  const changes: MoveChanges = {
    libraryImports: new Map(state.libraryImports),
    libraryInstalls: new Map(state.libraryInstalls),
    playcounterLibrary: new Map(state.playcounterLibrary),
    exeCache: new Map(state.exeCache),
    scopedExeLinks: new Map(state.scopedExeLinks),
    gameMetadata: new Map(state.gameMetadata),
    playtimeAdjustments: { ...state.playtimeAdjustments },
  };
  for (const [key, { game, imports }] of moves) {
    applyGameMove(state, identity, changes, key, game, imports);
  }

  // Commit the entire selection before publishing any of it to the UI.
  const result = persistAppState({ ...state, ...changes });
  if (result.status === "failed") throw result.error;
  useAppStore.setState({
    ...changes,
    recentSessions: result.sessions,
    notifications: result.notifications,
    archivedSeconds: result.archivedSeconds,
    archivedGameSeconds: result.archivedGameSeconds,
    archivedPlaythroughSeconds: result.archivedPlaythroughSeconds,
  });
  return moves.length;
}

function applyGameMove(
  state: AppState,
  identity: ReturnType<typeof personalGameIdentity>,
  changes: MoveChanges,
  key: string,
  game: MoveTarget,
  imports: readonly LibraryImportEntry[],
) {
  const {
    libraryImports,
    libraryInstalls,
    playcounterLibrary,
    exeCache,
    scopedExeLinks,
    gameMetadata,
    playtimeAdjustments,
  } = changes;

  const primary = imports[0];
  const importKeys = new Set(
    imports.map((entry) => libraryEntryKey(entry.provider, entry.externalId)),
  );
  const belongsToImport = (provider?: string, externalId?: string) =>
    provider !== undefined &&
    externalId !== undefined &&
    importKeys.has(`${provider}:${externalId}`);
  const aliases = new Set(
    [
      game,
      ...(game.aliases ?? []),
      ...(state.playcounterLibrary.get(key)?.aliases ?? []),
      ...imports,
    ].map(gameSecondsKey),
  );
  const belongsToGame = (ref: GameIdentityRef) =>
    aliases.has(gameSecondsKey(ref)) || identity(ref) === key;
  for (const entry of state.exeCache.values()) {
    if (entry.state === "matched" && entry.gameId !== undefined) {
      const ref = { ...entry, gameId: entry.gameId };
      if (belongsToGame(ref)) aliases.add(gameSecondsKey(ref));
    }
  }
  for (const link of state.scopedExeLinks.values()) {
    if (belongsToGame(link)) aliases.add(gameSecondsKey(link));
  }
  for (const ref of [...state.recentSessions, ...state.activeSessions]) {
    if (belongsToGame(ref)) aliases.add(gameSecondsKey(ref));
  }
  for (const secondsKey of new Set([
    ...Object.keys(state.archivedGameSeconds),
    ...Object.keys(state.playtimeAdjustments),
  ])) {
    const ref = gameSecondsRefFromKey(secondsKey);
    if (ref && belongsToGame(ref)) aliases.add(secondsKey);
  }

  const completedSeconds = state.recentSessions
    .filter(belongsToGame)
    .reduce(
      (total, session) => total + Math.max(0, session.durationSeconds ?? 0),
      0,
    );
  // Eligible running sessions already contribute to the displayed total.
  // Shorter sessions may still be discarded, so never deduct their time from
  // the retained baseline; they contribute only if they go on to be saved.
  const activeSeconds = state.activeSessions
    .filter(belongsToGame)
    .reduce((total, session) => {
      const seconds = Math.round(
        (Date.parse(session.checkpointedAt) - Date.parse(session.startedAt)) /
          1_000,
      );
      return total + (seconds >= MIN_SESSION_DURATION_SECONDS ? seconds : 0);
    }, 0);
  const archivedSeconds = [...aliases].reduce(
    (total, alias) =>
      total + Math.max(0, state.archivedGameSeconds[alias] ?? 0),
    0,
  );
  const recordedSeconds = completedSeconds + activeSeconds + archivedSeconds;
  const totalSeconds = effectiveTotalSeconds(
    recordedSeconds,
    adjustmentSecondsFor(state.playtimeAdjustments, aliases),
    providerFloors(imports).reduce((total, floor) => total + floor.seconds, 0),
  );
  for (const alias of aliases) delete playtimeAdjustments[alias];
  const adjustment = Math.round(totalSeconds - recordedSeconds);
  if (adjustment !== 0)
    playtimeAdjustments[gameSecondsKey(primary)] = adjustment;

  for (const importKey of importKeys) {
    libraryImports.delete(importKey);
    libraryInstalls.delete(importKey);
  }
  for (const [exeKey, entry] of exeCache) {
    if (!belongsToImport(entry.libraryProvider, entry.libraryExternalId))
      continue;
    const { libraryProvider, libraryExternalId, ...localEntry } = entry;
    exeCache.set(exeKey, localEntry);
  }
  for (const [linkKey, entry] of scopedExeLinks) {
    if (!belongsToImport(entry.provider, entry.externalId)) continue;
    const { provider, externalId, ...localEntry } = entry;
    // Never broaden a generic executable match beyond its chosen folder.
    scopedExeLinks.set(linkKey, localEntry);
  }

  const previous = playcounterLibrary.get(key);
  const lastPlayedAt = [
    previous?.lastPlayedAt,
    ...imports.map((entry) => entry.providerLastPlayedAt),
  ]
    .filter((date): date is string =>
      Boolean(date && Number.isFinite(Date.parse(date))),
    )
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0];
  playcounterLibrary.set(key, {
    gameId: primary.gameId,
    igdbId: primary.igdbId,
    source: primary.source,
    name: primary.name,
    coverUrl: primary.coverUrl,
    addedAt: previous?.addedAt ?? primary.importedAt,
    lastPlayedAt,
    aliases: [...aliases].flatMap((alias) => {
      const ref = gameSecondsRefFromKey(alias);
      return ref ? [ref] : [];
    }),
  });
  for (const entry of imports) {
    const metadataKey = gameMetadataKey({
      id: entry.gameId,
      source: entry.source,
    });
    gameMetadata.set(metadataKey, {
      ...gameMetadata.get(metadataKey),
      id: entry.gameId,
      igdbId: entry.igdbId,
      source: entry.source,
      name: entry.name,
      coverUrl: entry.coverUrl,
    });
  }
}
