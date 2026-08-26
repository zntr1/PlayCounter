import { persistAppState } from "../persistence";
import {
  createGameIdentityResolver,
  foldSessionsIntoArchive,
  gameMetadataKey,
  useAppStore,
  type ExeCacheEntry,
} from "../store";
import { scopedExeLinkKey } from "./scopedLinks";
import { scopedLocalGameId } from "./localGameIds";
import { libraryEntryKey, type LibraryImportCommit } from "./types";
import { evaluateMilestones } from "../milestones";
import { providerFloors } from "./playtimeFloor";
import { splitStoredSessions } from "../sessionPersistence";
import type { Session } from "@playcounter/shared";

export function commitLibraryImports(commits: readonly LibraryImportCommit[]) {
  const state = useAppStore.getState();
  const libraryImports = new Map(state.libraryImports);
  const libraryInstalls = new Map(state.libraryInstalls);
  const scopedExeLinks = new Map(state.scopedExeLinks);
  const exeCache = new Map(state.exeCache);
  const gameMetadata = new Map(state.gameMetadata);
  const backfillSessions: Session[] = [];
  const backfilledExecutables = new Set<string>();
  const now = new Date();

  for (const commit of commits) {
    const key = libraryEntryKey(commit.entry.provider, commit.entry.externalId);
    const previous = libraryImports.get(key);
    libraryImports.set(key, {
      ...commit.entry,
      importedAt: previous?.importedAt ?? commit.entry.importedAt,
      providerSeconds: Math.max(
        previous?.providerSeconds ?? 0,
        commit.entry.providerSeconds,
      ),
    });
    if (commit.install) libraryInstalls.set(key, commit.install);
    else libraryInstalls.delete(key);
    gameMetadata.set(gameMetadataKey(commit.metadata), commit.metadata);
    for (const entry of commit.exeCacheEntries) {
      const existing = exeCache.get(entry.exeName.toLowerCase());
      addBackfillSession(
        backfillSessions,
        backfilledExecutables,
        existing,
        entry,
        now,
      );
      if (
        !existing ||
        existing.state !== "matched" ||
        existing.igdbId === entry.igdbId
      ) {
        exeCache.set(entry.exeName.toLowerCase(), entry);
      } else if (entry.source === "custom" && commit.install && entry.igdbId) {
        const fallback = {
          exeName: entry.exeName,
          pathPrefix: commit.install.installPath,
          gameId: scopedLocalGameId(entry.exeName, commit.install.installPath),
          source: "custom" as const,
          igdbId: entry.igdbId,
          gameName: entry.gameName ?? commit.metadata.name,
          coverUrl: entry.coverUrl ?? commit.metadata.coverUrl,
          provider: commit.entry.provider,
          externalId: commit.entry.externalId,
          setAt: entry.lastCheckedAt,
          shareState: entry.shareState ?? "unshared",
        };
        const fallbackKey = scopedExeLinkKey(
          fallback.exeName,
          fallback.pathPrefix,
        );
        if (fallbackKey) scopedExeLinks.set(fallbackKey, fallback);
      }
    }
    for (const link of commit.scopedLinks) {
      addBackfillSession(
        backfillSessions,
        backfilledExecutables,
        exeCache.get(link.exeName.toLowerCase()),
        {
          exeName: link.exeName,
          gameId: link.gameId,
          igdbId: link.igdbId,
          gameName: link.gameName,
          coverUrl: link.coverUrl,
          source: link.source,
        },
        now,
      );
      const linkKey = scopedExeLinkKey(link.exeName, link.pathPrefix);
      if (linkKey) scopedExeLinks.set(linkKey, link);
    }
  }

  const resolveIgdbId = createGameIdentityResolver(
    gameMetadata,
    exeCache,
    libraryImports,
  );
  const split = splitStoredSessions([
    ...backfillSessions,
    ...state.recentSessions,
  ]);
  const archive = foldSessionsIntoArchive(
    state.archivedSeconds,
    state.archivedGameSeconds,
    split.removed,
  );
  const milestoneResult = evaluateMilestones({
    sessions: split.kept,
    archivedSeconds: archive.archivedSeconds,
    archivedGameSeconds: archive.archivedGameSeconds,
    playtimeAdjustments: state.playtimeAdjustments,
    providerFloors: providerFloors(libraryImports.values()),
    verifiedContributions: state.contributionCounts.verified,
    verifiedEmulatorContributions: state.emulatorContributionCounts.verified,
    awardedMilestones: state.awardedMilestones,
    milestonesInitializedAt: state.milestonesInitializedAt,
    resolveIgdbId,
    now,
  });
  const revokedMilestones = new Set(milestoneResult.revokedMilestoneIds);
  const notifications = state.notifications.filter(
    (notification) => !revokedMilestones.has(notification.id),
  );
  const candidate = {
    ...state,
    libraryImports,
    libraryInstalls,
    scopedExeLinks,
    exeCache,
    gameMetadata,
    awardedMilestones: milestoneResult.awardedMilestones,
    milestonesInitializedAt: milestoneResult.milestonesInitializedAt,
    notifications,
    recentSessions: split.kept,
    archivedSeconds: archive.archivedSeconds,
    archivedGameSeconds: archive.archivedGameSeconds,
  };
  const result = persistAppState(candidate);
  if (result.status === "failed") throw result.error;
  useAppStore.setState({
    libraryImports,
    libraryInstalls,
    scopedExeLinks,
    exeCache,
    gameMetadata,
    awardedMilestones: milestoneResult.awardedMilestones,
    milestonesInitializedAt: milestoneResult.milestonesInitializedAt,
    recentSessions: result.sessions,
    notifications: result.notifications,
    archivedSeconds: result.archivedSeconds,
    archivedGameSeconds: result.archivedGameSeconds,
  });
  return result;
}

function addBackfillSession(
  sessions: Session[],
  seen: Set<string>,
  existing: ExeCacheEntry | undefined,
  game: {
    exeName: string;
    gameId?: number;
    igdbId?: number;
    gameName?: string;
    coverUrl?: string;
    source?: "igdb" | "community" | "custom";
  },
  now: Date,
) {
  const key = game.exeName.toLowerCase();
  if (
    seen.has(key) ||
    existing?.state !== "unmatched" ||
    game.gameId === undefined ||
    !game.gameName
  ) {
    return;
  }
  const runningSince = existing.runningSince
    ? Date.parse(existing.runningSince)
    : Number.NaN;
  const openSeconds = Number.isFinite(runningSince)
    ? Math.max(0, (now.getTime() - runningSince) / 1000)
    : 0;
  const durationSeconds = Math.round(
    (existing.trackedSeconds ?? 0) + openSeconds,
  );
  if (durationSeconds < 60) return;
  seen.add(key);
  sessions.push({
    id: now.getTime() * 1_000 + sessions.length,
    gameId: game.gameId,
    igdbId: game.igdbId,
    gameName: game.gameName,
    coverUrl: game.coverUrl ?? "",
    source: game.source,
    exeName: game.exeName,
    startedAt: new Date(now.getTime() - durationSeconds * 1_000).toISOString(),
    endedAt: now.toISOString(),
    durationSeconds,
  });
}
