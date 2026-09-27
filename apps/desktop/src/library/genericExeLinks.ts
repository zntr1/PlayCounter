import type { Game } from "@playcounter/shared";
import { isWindowsExecutablePath } from "../gameLaunch";
import type { ExeCacheEntry, LaunchTarget } from "../store";
import { isGenericExeName } from "./exeCandidates";
import { scopedLocalGameId } from "./localGameIds";
import {
  isUnderPrefix,
  normalizeWindowsDir,
  resolveScopedLink,
  scopedExeLinkKey,
} from "./scopedLinks";
import type { IgnoredExeFolder, ScopedExeLink } from "./types";

/* Generic exe names ──────────────────────────────────────────────────────────
   Every RPG Maker game ships its own Game.exe, so the name says nothing about
   the game. A link for a generic name is kept to the folder the file runs
   from; a name link would claim every other Game.exe on the PC. Unique names
   keep their name link, which still holds after the game moves to another
   drive. */

type ExeFile = { exeName: string; exePath?: string | null };

/** The folder a generic exe is linked to, as the path spells it. Null for a
 *  unique name, or when no usable Windows path is known. */
export function genericExeFolder({ exeName, exePath }: ExeFile) {
  if (!exePath || !isGenericExeName(exeName)) return null;
  if (!isWindowsExecutablePath(exePath)) return null;
  const folder = exePath.replace(/[\\/]+[^\\/]*$/, "");
  return normalizeWindowsDir(folder) ? folder : null;
}

/** Local id for a game named on this PC. Generic names get one per folder, so
 *  two custom games on Game.exe never share hours. */
export function localCustomGameId(file: ExeFile, fallback: number) {
  const folder = genericExeFolder(file);
  const prefix = folder ? normalizeWindowsDir(folder) : null;
  return prefix ? scopedLocalGameId(file.exeName, prefix) : fallback;
}

/** The folder link for a generic exe, or null when it gets a name link. */
export function genericFolderLink(
  file: ExeFile,
  game: Game,
  setAt: string,
): ScopedExeLink | null {
  const folder = genericExeFolder(file);
  if (!folder) return null;
  return {
    exeName: file.exeName,
    pathPrefix: folder,
    exePath: file.exePath ?? undefined,
    gameId: game.id,
    source: game.source ?? "igdb",
    igdbId: game.igdbId,
    gameName: game.name,
    coverUrl: game.coverUrl,
    setAt,
  };
}

/** Whether a file sits in the folder of a link. A missing path counts as
 *  "could be": an entry without one cannot be told apart. */
export function mayBeInLinkFolder(
  exePath: string | null | undefined,
  link: Pick<ScopedExeLink, "pathPrefix">,
) {
  if (!exePath) return true;
  const path = normalizeWindowsDir(exePath);
  const prefix = normalizeWindowsDir(link.pathPrefix);
  return Boolean(path && prefix && isUnderPrefix(path, prefix));
}

/** Every game already linked to an exe name on this PC, in any folder. The
 *  picker offers them first when the name shows up in a new folder. */
export function gamesLinkedToExe(
  exeName: string,
  exeCache: ReadonlyMap<string, ExeCacheEntry>,
  scopedExeLinks: ReadonlyMap<string, ScopedExeLink>,
): Game[] {
  const key = exeName.toLowerCase();
  const games = new Map<string, Game>();
  const add = (game: Game) => {
    const id = `${game.source}:${game.id}`;
    if (!games.has(id)) games.set(id, game);
  };
  const cached = exeCache.get(key);
  if (
    cached?.state === "matched" &&
    cached.gameId !== undefined &&
    cached.gameName
  ) {
    add({
      id: cached.gameId,
      igdbId: cached.igdbId,
      name: cached.gameName,
      coverUrl: cached.coverUrl ?? "",
      source: cached.source ?? "igdb",
    });
  }
  for (const link of scopedExeLinks.values()) {
    if (link.exeName.toLowerCase() !== key) continue;
    add({
      id: link.gameId,
      igdbId: link.igdbId,
      name: link.gameName,
      coverUrl: link.coverUrl,
      source: link.source,
    });
  }
  return [...games.values()];
}

/**
 * Save data from before folder links: a generic name linked by name alone
 * moves to the folder of its remembered Play file, keeping the game's id so
 * its hours stay together. Without a Play file of that game the name link
 * stays; nothing tells which folder it meant. Mutates both maps; returns
 * whether anything moved.
 */
export function moveGenericNameLinksToFolders(
  exeCache: Map<string, ExeCacheEntry>,
  scopedExeLinks: Map<string, ScopedExeLink>,
  launchTargets: ReadonlyMap<string, LaunchTarget>,
) {
  let changed = false;
  for (const [key, entry] of [...exeCache]) {
    if (
      entry.state !== "matched" ||
      entry.gameId === undefined ||
      !entry.gameName ||
      !isGenericExeName(entry.exeName)
    ) {
      continue;
    }
    const source = entry.source ?? "igdb";
    // A launcher import already linked this name to its install folder.
    const hasFolderLink = [...scopedExeLinks.values()].some(
      (link) =>
        link.exeName.toLowerCase() === key &&
        link.gameId === entry.gameId &&
        link.source === source,
    );
    if (hasFolderLink) {
      exeCache.delete(key);
      changed = true;
      continue;
    }
    const target = launchTargets.get(key);
    if (
      !target ||
      target.owner.gameId !== entry.gameId ||
      target.owner.source !== (entry.source ?? null)
    ) {
      continue;
    }
    const link = genericFolderLink(
      { exeName: entry.exeName, exePath: target.path },
      {
        id: entry.gameId,
        igdbId: entry.igdbId,
        name: entry.gameName,
        coverUrl: entry.coverUrl ?? "",
        source,
      },
      entry.lastCheckedAt,
    );
    const linkKey = link && scopedExeLinkKey(link.exeName, link.pathPrefix);
    if (!link || !linkKey) continue;
    if (!scopedExeLinks.has(linkKey)) {
      scopedExeLinks.set(linkKey, {
        ...link,
        identifierSource: entry.identifierSource,
        provider: entry.libraryProvider,
        externalId: entry.libraryExternalId,
        pendingCommunityGame: entry.pendingCommunityGame,
        communitySuggestionId: entry.communitySuggestionId,
        communitySuggestionVerified: entry.communitySuggestionVerified,
        communitySuggestionStatus: entry.communitySuggestionStatus,
        communitySuggestionNote: entry.communitySuggestionNote,
        shareState: entry.shareState,
      });
    }
    exeCache.delete(key);
    changed = true;
  }
  return changed;
}

/** Whether a file sits in a folder (both as Windows paths). */
export function isInFolder(exePath: string | null | undefined, folder: string) {
  if (!exePath) return false;
  const path = normalizeWindowsDir(exePath);
  const prefix = normalizeWindowsDir(folder);
  return Boolean(path && prefix && isUnderPrefix(path, prefix));
}

/** Whether this copy of a generic exe runs from a folder ignored on this PC.
 *  Copies in other folders are still tracked. */
export function isInIgnoredFolder(
  { exeName, exePath }: ExeFile,
  folders: ReadonlyMap<string, IgnoredExeFolder>,
) {
  if (folders.size === 0 || !exePath || !isGenericExeName(exeName)) {
    return false;
  }
  const key = exeName.toLowerCase();
  return [...folders.values()].some(
    (folder) =>
      folder.exeName.toLowerCase() === key &&
      isInFolder(exePath, folder.pathPrefix),
  );
}

/** A running Game.exe already sorted: tracked through its folder link, or
 *  from a folder ignored here. It is not the unknown Game.exe Discovered
 *  waits for and must not lend that entry its path. */
export function isSortedGenericCopy(
  process: ExeFile,
  scopedExeLinks: ReadonlyMap<string, ScopedExeLink>,
  ignoredExeFolders: ReadonlyMap<string, IgnoredExeFolder>,
) {
  if (!isGenericExeName(process.exeName)) return false;
  return (
    isInIgnoredFolder(process, ignoredExeFolders) ||
    Boolean(
      process.exePath &&
      resolveScopedLink(
        { exeName: process.exeName, exePath: process.exePath },
        scopedExeLinks,
      ),
    )
  );
}
