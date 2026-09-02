import type { ContributionStatus, Game, GameSource } from "@playcounter/shared";
import type { ExeCacheEntry } from "./store";
import type { ScopedExeLink } from "./library/types";

export type LocalLinkRef =
  | { kind: "exe"; key: string }
  | { kind: "scoped"; key: string };

export type LocalLink = {
  ref: LocalLinkRef;
  exeName: string;
  source: GameSource;
  identifierSource?: GameSource;
  gameId: number;
  igdbId?: number;
  gameName?: string;
  coverUrl?: string;
  pathPrefix?: string;
  pendingCommunityGame?: Game;
  communitySuggestionId?: number;
  communitySuggestionVerified?: boolean;
  communitySuggestionStatus?: ContributionStatus;
  communitySuggestionNote?: string;
  shareState?: "unshared" | "failed";
};

export type LocalLinkMaps = {
  exeCache: Map<string, ExeCacheEntry>;
  scopedExeLinks: Map<string, ScopedExeLink>;
};

function exeLocalLink(key: string, entry: ExeCacheEntry): LocalLink | null {
  if (
    entry.state !== "matched" ||
    entry.source === undefined ||
    entry.gameId === undefined
  ) {
    return null;
  }
  return {
    ref: { kind: "exe", key },
    exeName: entry.exeName,
    source: entry.source,
    identifierSource: entry.identifierSource,
    gameId: entry.gameId,
    igdbId: entry.igdbId,
    gameName: entry.gameName,
    coverUrl: entry.coverUrl,
    pendingCommunityGame: entry.pendingCommunityGame,
    communitySuggestionId: entry.communitySuggestionId,
    communitySuggestionVerified: entry.communitySuggestionVerified,
    communitySuggestionStatus: entry.communitySuggestionStatus,
    communitySuggestionNote: entry.communitySuggestionNote,
    shareState: entry.shareState,
  };
}

function scopedLocalLink(key: string, entry: ScopedExeLink): LocalLink {
  return {
    ref: { kind: "scoped", key },
    exeName: entry.exeName,
    source: entry.source,
    identifierSource: entry.identifierSource,
    gameId: entry.gameId,
    igdbId: entry.igdbId,
    gameName: entry.gameName,
    coverUrl: entry.coverUrl,
    pathPrefix: entry.pathPrefix,
    pendingCommunityGame: entry.pendingCommunityGame,
    communitySuggestionId: entry.communitySuggestionId,
    communitySuggestionVerified: entry.communitySuggestionVerified,
    communitySuggestionStatus: entry.communitySuggestionStatus,
    communitySuggestionNote: entry.communitySuggestionNote,
    shareState: entry.shareState,
  };
}

export function listLocalLinks(
  exeCache: ReadonlyMap<string, ExeCacheEntry>,
  scopedExeLinks: ReadonlyMap<string, ScopedExeLink>,
): LocalLink[] {
  return [
    ...[...exeCache].flatMap(([key, entry]) => {
      const link = exeLocalLink(key, entry);
      return link?.source === "custom" ? [link] : [];
    }),
    ...[...scopedExeLinks].flatMap(([key, entry]) => {
      const link = scopedLocalLink(key, entry);
      return link.source === "custom" ? [link] : [];
    }),
  ];
}

export function findLocalLinksByExe(
  exeName: string,
  exeCache: ReadonlyMap<string, ExeCacheEntry>,
  scopedExeLinks: ReadonlyMap<string, ScopedExeLink>,
): LocalLink[] {
  const key = exeName.toLowerCase();
  return listLocalLinks(exeCache, scopedExeLinks).filter(
    (link) => link.exeName.toLowerCase() === key,
  );
}

export function findLocalLink(
  ref: LocalLinkRef,
  exeCache: ReadonlyMap<string, ExeCacheEntry>,
  scopedExeLinks: ReadonlyMap<string, ScopedExeLink>,
): LocalLink | null {
  if (ref.kind === "exe") {
    const entry = exeCache.get(ref.key);
    return entry ? exeLocalLink(ref.key, entry) : null;
  }
  const entry = scopedExeLinks.get(ref.key);
  return entry ? scopedLocalLink(ref.key, entry) : null;
}

export function writeLocalLink(
  maps: LocalLinkMaps,
  ref: LocalLinkRef,
  patch: Partial<Omit<LocalLink, "ref" | "exeName" | "pathPrefix">>,
): LocalLinkMaps {
  if (ref.kind === "exe") {
    const existing = maps.exeCache.get(ref.key);
    if (!existing || existing.state !== "matched") return maps;
    const exeCache = new Map(maps.exeCache);
    exeCache.set(ref.key, { ...existing, ...patch });
    return { exeCache, scopedExeLinks: maps.scopedExeLinks };
  }

  const existing = maps.scopedExeLinks.get(ref.key);
  if (!existing) return maps;
  const scopedExeLinks = new Map(maps.scopedExeLinks);
  scopedExeLinks.set(ref.key, { ...existing, ...patch });
  return { exeCache: maps.exeCache, scopedExeLinks };
}
