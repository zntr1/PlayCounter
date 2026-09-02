import type { GameSource, LibraryProviderId } from "@playcounter/shared";
import type { ExeCacheEntry, GameMetadata } from "../store";
import { normalizeWindowsDir } from "./scopedLinks";
import { manualExecutableNeedsScope } from "./exeCandidates";
import { customLocalGameId, scopedLocalGameId } from "./localGameIds";
import { matchesProcessPatternSet } from "../ignoredProcessPatterns";
import type {
  LibraryImportCommit,
  LibraryImportEntry,
  ResolvedLibraryGame,
  ScannedExecutable,
  ScannedLibraryGame,
  ScopedExeLink,
} from "./types";

export function buildLibraryImportCommit(input: {
  provider?: LibraryProviderId;
  scanned: ScannedLibraryGame;
  resolved: ResolvedLibraryGame;
  selectedExecutable?: ScannedExecutable;
  ignoredProcesses?: ReadonlySet<string>;
  now?: string;
}): LibraryImportCommit | null {
  const { scanned, resolved } = input;
  if (resolved.status !== "resolved" || !resolved.game) return null;
  const now = input.now ?? new Date().toISOString();
  const provider = input.provider ?? "steam";
  const game = resolved.game;
  const igdbId = game.igdbId;
  if (!igdbId) return null;
  const installPath = scanned.installPath
    ? normalizeWindowsDir(scanned.installPath)
    : null;
  const localByName = new Map(
    scanned.executables.map((exe) => [exe.fileName.toLowerCase(), exe]),
  );
  const knownWindows = resolved.executables.filter(
    (item) => item.platform === "windows" && item.kind === "exe",
  );
  const exeCacheEntries: ExeCacheEntry[] = [];
  const scopedLinks: ScopedExeLink[] = [];
  const linked = new Set<string>();
  const linkedExeSources = new Set<GameSource>();

  const executableEvidence = new Map<
    string,
    {
      name: string;
      pathScopedOnly: boolean;
      identifierSource: "igdb" | "community";
    }
  >();
  for (const executable of knownWindows) {
    const name = executable.value.trim();
    if (!name.toLowerCase().endsWith(".exe")) continue;
    if (matchesProcessPatternSet(name, input.ignoredProcesses ?? new Set())) {
      continue;
    }
    const key = name.toLowerCase();
    const existing = executableEvidence.get(key);
    executableEvidence.set(key, {
      name: existing?.name ?? name,
      pathScopedOnly:
        Boolean(existing?.pathScopedOnly) ||
        Boolean(executable.ambiguous) ||
        !executable.verified,
      identifierSource:
        existing?.identifierSource === "igdb" ||
        executable.provenance === "igdb"
          ? "igdb"
          : "community",
    });
  }
  for (const executable of executableEvidence.values()) {
    const name = executable.name;
    linked.add(name);
    linkedExeSources.add(executable.identifierSource);
    if (!executable.pathScopedOnly) {
      exeCacheEntries.push(
        toExeCache(
          name,
          scanned.externalId,
          provider,
          game,
          executable.identifierSource,
          now,
        ),
      );
      if (installPath && localByName.has(name.toLowerCase())) {
        scopedLinks.push(
          toScopedLink(
            name,
            installPath,
            scanned.externalId,
            provider,
            game,
            executable.identifierSource,
            now,
          ),
        );
      }
    } else if (installPath) {
      // The provider identity and install root make an otherwise ambiguous
      // basename safe locally. Do not require the bounded filesystem scan to
      // rediscover the file: large game folders can hit that scan's entry cap
      // before a deeply nested executable (for example CS2's cs2.exe) is seen.
      scopedLinks.push(
        toScopedLink(
          name,
          installPath,
          scanned.externalId,
          provider,
          game,
          executable.identifierSource,
          now,
        ),
      );
    }
  }

  if (input.selectedExecutable && installPath) {
    const selectedName = input.selectedExecutable.fileName;
    linked.add(selectedName);
    linkedExeSources.add("custom");
    if (manualExecutableNeedsScope(input.selectedExecutable)) {
      scopedLinks.push(
        toCustomScopedLink(
          selectedName,
          installPath,
          scanned.externalId,
          provider,
          game,
          now,
        ),
      );
    } else {
      exeCacheEntries.push(
        toCustomExeCache(selectedName, scanned.externalId, provider, game, now),
      );
    }
  }

  const entry: LibraryImportEntry = {
    provider,
    externalId: scanned.externalId,
    igdbId,
    gameId: game.id,
    source: game.source,
    name: game.name,
    coverUrl: game.coverUrl,
    importedAt: now,
    providerSeconds:
      scanned.playtimeSeconds === null
        ? null
        : Math.max(0, Math.floor(scanned.playtimeSeconds)),
    providerLastPlayedAt: scanned.lastPlayedUnix
      ? new Date(scanned.lastPlayedUnix * 1000).toISOString()
      : undefined,
    lastReadAt: now,
    linkedExeNames: [...linked],
    linkedExeSources: [...linkedExeSources],
  };
  return {
    entry,
    metadata: game,
    install:
      installPath && scanned.installed
        ? {
            provider,
            externalId: scanned.externalId,
            installPath,
            scannedAt: now,
          }
        : undefined,
    exeCacheEntries,
    scopedLinks,
  };
}

function toExeCache(
  exeName: string,
  externalId: string,
  provider: LibraryProviderId,
  game: GameMetadata,
  identifierSource: "igdb" | "community",
  now: string,
): ExeCacheEntry {
  return {
    exeName,
    state: "matched",
    gameId: game.id,
    igdbId: game.igdbId,
    gameName: game.name,
    coverUrl: game.coverUrl,
    source: game.source,
    identifierSource,
    libraryProvider: provider,
    libraryExternalId: externalId,
    lastCheckedAt: now,
  };
}

function toScopedLink(
  exeName: string,
  pathPrefix: string,
  externalId: string,
  provider: LibraryProviderId,
  game: GameMetadata,
  identifierSource: "igdb" | "community",
  now: string,
): ScopedExeLink {
  return {
    exeName,
    pathPrefix,
    gameId: game.id,
    source: game.source,
    identifierSource,
    igdbId: game.igdbId!,
    gameName: game.name,
    coverUrl: game.coverUrl,
    provider,
    externalId,
    setAt: now,
  };
}

function toCustomExeCache(
  exeName: string,
  externalId: string,
  provider: LibraryProviderId,
  game: GameMetadata,
  now: string,
): ExeCacheEntry {
  return {
    exeName,
    state: "matched",
    gameId: customLocalGameId(exeName),
    igdbId: game.igdbId,
    gameName: game.name,
    coverUrl: game.coverUrl,
    source: "custom",
    identifierSource: "custom",
    lastCheckedAt: now,
    shareState: "unshared",
    libraryProvider: provider,
    libraryExternalId: externalId,
  };
}

function toCustomScopedLink(
  exeName: string,
  pathPrefix: string,
  externalId: string,
  provider: LibraryProviderId,
  game: GameMetadata,
  now: string,
): ScopedExeLink {
  return {
    exeName,
    pathPrefix,
    gameId: scopedLocalGameId(exeName, pathPrefix),
    source: "custom",
    identifierSource: "custom",
    igdbId: game.igdbId!,
    gameName: game.name,
    coverUrl: game.coverUrl,
    provider,
    externalId,
    setAt: now,
    shareState: "unshared",
  };
}
