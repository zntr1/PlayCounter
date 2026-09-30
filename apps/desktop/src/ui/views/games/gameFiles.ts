import type { GameSource } from "@playcounter/shared";
import type { ScopedExeLink } from "../../../library/types";
import {
  fileMatchSource,
  type ExeCacheEntry,
  type LaunchTarget,
} from "../../../store";
import type { GameAliasRef } from "../../../tracker";

/* The files a game card counts, as this PC knows them. Report, Convert and
   Check match act on the one file the user picks, never on the card's first
   file: the server must learn which file is wrong. How each file ran here is
   shown to help the user pick; a file that never ran (an import) can be
   wrong too, so it can still be picked. */

export type GameFile = {
  exeName: string;
  /** Who matched it for this game: igdb, community, or custom (the user). */
  source: GameSource | null;
  /** Matched by name; false when only this game's folders match it. */
  byName: boolean;
  running: boolean;
  /** Last real run as this game here. Manual sessions don't count. */
  lastRanAt?: string;
  path?: string;
};

export function listGameFiles(
  game: {
    exeNames: string[];
    aliases: GameAliasRef[];
    exeLastRanAt?: Record<string, string>;
    exeRunningNow?: string[];
  },
  exeCache: ReadonlyMap<string, ExeCacheEntry>,
  scopedExeLinks: ReadonlyMap<string, ScopedExeLink>,
  launchTargets: ReadonlyMap<string, LaunchTarget>,
): GameFile[] {
  const ownsLink = (link: { gameId?: number; source?: GameSource | null }) =>
    game.aliases.some(
      (alias) =>
        alias.gameId === link.gameId && alias.source === (link.source ?? null),
    );
  return game.exeNames.filter(Boolean).map((exeName) => {
    const key = exeName.toLowerCase();
    const entry = exeCache.get(key);
    const nameLink =
      entry?.state === "matched" && ownsLink(entry) ? entry : undefined;
    const folderLink = [...scopedExeLinks.values()].find(
      (link) => link.exeName.toLowerCase() === key && ownsLink(link),
    );
    return {
      exeName,
      source: fileMatchSource(nameLink ?? folderLink ?? {}) ?? null,
      byName: nameLink !== undefined,
      running: game.exeRunningNow?.includes(key) ?? false,
      lastRanAt: game.exeLastRanAt?.[key],
      path: launchTargets.get(key)?.path ?? folderLink?.exePath,
    };
  });
}

function isDatabaseSource(source: GameSource | null) {
  return source === "igdb" || source === "community";
}

/** Report wrong match: a file IGDB or the community matched. */
export function canReportFile(file: GameFile) {
  return isDatabaseSource(file.source);
}

/** Convert to custom game: the database's match by name. */
export function canConvertFile(file: GameFile) {
  return file.byName && canReportFile(file);
}

/** Check match: the user's own file, or a database match. */
export function canCheckFile(file: GameFile) {
  return file.source === "custom" || canReportFile(file);
}

export function fileRunStatus(file: GameFile) {
  if (file.running) return "Running now";
  if (!file.lastRanAt) return "Never ran on this PC";
  return `Last ran ${new Date(file.lastRanAt).toLocaleDateString()}`;
}

/** Running first, then the most recent; files that never ran come last. */
export function sortGameFiles(files: readonly GameFile[]) {
  const rank = (file: GameFile) =>
    file.running
      ? Number.MAX_SAFE_INTEGER
      : file.lastRanAt
        ? Date.parse(file.lastRanAt)
        : 0;
  return [...files].sort((left, right) => rank(right) - rank(left));
}
