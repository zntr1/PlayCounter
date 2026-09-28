import type { Game } from "@playcounter/shared";
import { isWindowsExecutablePath, launchFileBaseName } from "../gameLaunch";
import { matchesProcessPatternSet } from "../ignoredProcessPatterns";
import { personalGameIdentity, useAppStore, type GameMetadata } from "../store";
import {
  linkGameFileByHand,
  lookupFolderExecutables,
  persist,
  resolveCachedProcess,
  submitLocalLinkToCommunity,
} from "../tracker";
import { isGenericExeName } from "./exeCandidates";
import { isInIgnoredFolder } from "./genericExeLinks";

/* Adding a game by hand ──────────────────────────────────────────────────────
   "Add game" in My Games: a game searched by name, with or without its .exe.
   Without a file the game gets a PlayCounter library entry, like a game moved
   away from its launcher. With a file, checkGameFile runs before anything is
   written. Either way the dialog then links the files the server knows for
   the game (linkServerKnownFiles). See docs/manual-add-plan.md. */

export type GameFile = { exeName: string; exePath: string };

export type GameFileCheck =
  /** Not a full path to an .exe. */
  | { kind: "invalid" }
  /** On the ignore list, ignored by the user, or in an ignored folder. */
  | { kind: "ignored"; file: GameFile }
  | { kind: "software"; file: GameFile; name: string }
  /** Already counts for another game on this PC. */
  | { kind: "taken"; file: GameFile; game: Game }
  /** Already counts for this game: only Play needs the file. */
  | { kind: "same"; file: GameFile; game: Game }
  /** The server knows the file as another game: the user decides. */
  | { kind: "other"; file: GameFile; game: Game }
  /** `game` is the server's entry when it lists the file for this game: it
   *  says whether IGDB or the community knows the file. Without it the file
   *  is the user's own pick. */
  | { kind: "link"; file: GameFile; game?: Game }
  /** Unknown to the server: linked here and sent for community review. */
  | { kind: "share"; file: GameFile };

export function sameGame(left: Game, right: Game) {
  return (
    (left.igdbId !== undefined && left.igdbId === right.igdbId) ||
    (left.source === right.source && left.id === right.id)
  );
}

/** Adds a searched game without a file. False when it is already there. */
export function addGameWithoutFile(game: GameMetadata) {
  if (!game.igdbId) throw new Error(`${game.name} has no IGDB id.`);
  const state = useAppStore.getState();
  const key = personalGameIdentity(state)({
    gameId: game.id,
    source: game.source,
    igdbId: game.igdbId,
  });
  if (state.playcounterLibrary.has(key)) return false;
  const playcounterLibrary = new Map(state.playcounterLibrary);
  playcounterLibrary.set(key, {
    gameId: game.id,
    igdbId: game.igdbId,
    source: game.source,
    name: game.name,
    coverUrl: game.coverUrl,
    addedAt: new Date().toISOString(),
  });
  // Remove and the journal name the game by id and source; the metadata tells
  // them its IGDB id, as for a game moved away from its launcher.
  state.setGameMetadata([game]);
  useAppStore.setState({ playcounterLibrary });
  persist();
  return true;
}

/** Decides what a picked file means for `game`. Writes nothing. */
export async function checkGameFile(
  path: string,
  game: Game,
): Promise<GameFileCheck> {
  const exePath = path.trim();
  if (!isWindowsExecutablePath(exePath)) return { kind: "invalid" };
  const file = { exeName: launchFileBaseName(exePath), exePath };
  const key = file.exeName.toLowerCase();
  const state = useAppStore.getState();
  const cached = state.exeCache.get(key);
  if (
    matchesProcessPatternSet(file.exeName, state.blacklist) ||
    matchesProcessPatternSet(file.exeName, state.ignoredProcesses) ||
    cached?.state === "blacklisted" ||
    isInIgnoredFolder(file, state.ignoredExeFolders)
  ) {
    return { kind: "ignored", file };
  }
  if (cached?.state === "tool") {
    return { kind: "software", file, name: cached.gameName ?? file.exeName };
  }
  // The same lookup a running copy of this file would get.
  const linked = resolveCachedProcess(
    file,
    state.exeCache,
    state.scopedExeLinks,
    Date.now(),
    0,
  );
  if (linked.state === "matched") {
    return sameGame(linked.game, game)
      ? { kind: "same", file, game: linked.game }
      : { kind: "taken", file, game: linked.game };
  }

  const result = (
    await lookupFolderExecutables([file], { supportsTools: true })
  ).get(key);
  if (result?.game?.kind === "tool") {
    return { kind: "software", file, name: result.game.name };
  }
  // The server's entry for this game when it lists the file for it, even
  // among many: the card then names who knows the file.
  const listed = [result?.game, ...(result?.ambiguousGames ?? [])].find(
    (candidate): candidate is Game =>
      candidate != null &&
      candidate.source !== "custom" &&
      candidate.kind !== "tool" &&
      sameGame(candidate, game),
  );
  // Game.exe names no game, and a flagged name is shared by many: the user's
  // pick wins, on this PC only.
  if (isGenericExeName(file.exeName) || result?.flaggedIdentifier) {
    return { kind: "link", file, game: listed };
  }
  if (result?.game && result.game.source !== "custom") {
    return sameGame(result.game, game)
      ? { kind: "link", file, game: result.game }
      : { kind: "other", file, game: result.game };
  }
  // Several candidates: the server is unsure itself, so the pick wins.
  if (result?.ambiguousGames?.length) {
    return { kind: "link", file, game: listed };
  }
  return { kind: "share", file };
}

/** The user's file as a Custom game, linked here first, then sent for
 *  review like a launcher import. A failed send keeps the link. `declined`
 *  is the server's other game for the file, which the user turned down. */
export async function addAndShareGameFile(
  file: GameFile,
  game: Game,
  declined?: Game,
) {
  const ref = linkGameFileByHand(file, game, "custom", declined);
  return ref ? submitLocalLinkToCommunity(ref) : null;
}
