import type {
  ContributionStatus,
  Game,
  GameSource,
  LibraryKnownExecutable,
  LibraryProviderId,
} from "@playcounter/shared";
import type { ExeCacheEntry, GameMetadata } from "../store";
import type { GameSecondsRef } from "../gameSeconds";

export type LibraryImportEntry = {
  provider: LibraryProviderId;
  externalId: string;
  igdbId: number;
  gameId: number;
  source: Exclude<GameSource, "custom">;
  name: string;
  coverUrl: string;
  importedAt: string;
  providerSeconds: number | null;
  /** False means no provider play evidence, not proof of never playing. */
  providerHasPlayedEvidence?: boolean;
  providerLastPlayedAt?: string;
  lastReadAt: string;
  linkedExeNames: string[];
  linkedExeSources: GameSource[];
};

export type LibraryInstallEntry = {
  provider: LibraryProviderId;
  externalId: string;
  installPath: string;
  scannedAt: string;
};

/** Explicit library membership for games moved away from a launcher. */
export type PlayCounterLibraryEntry = {
  gameId: number;
  igdbId: number;
  source: Exclude<GameSource, "custom">;
  name: string;
  coverUrl: string;
  addedAt: string;
  lastPlayedAt?: string;
  /** Keep archived totals addressable after their launcher entries disappear. */
  aliases?: GameSecondsRef[];
};

export type ScopedExeLink = {
  exeName: string;
  pathPrefix: string;
  gameId: number;
  source: GameSource;
  /** Provenance of the executable mapping, separate from game identity. */
  identifierSource?: GameSource;
  igdbId: number;
  gameName: string;
  coverUrl: string;
  /** Absent after moving to PlayCounter; the folder restriction still applies. */
  provider?: LibraryProviderId;
  externalId?: string;
  setAt: string;
  pendingCommunityGame?: Game;
  communitySuggestionId?: number;
  communitySuggestionVerified?: boolean;
  communitySuggestionStatus?: ContributionStatus;
  communitySuggestionNote?: string;
  shareState?: "unshared" | "failed";
};

export type ProviderStatus = {
  provider: LibraryProviderId;
  available: boolean;
  rootPath?: string;
  checkedPaths: string[];
};

export type LocalLibraryAccount = {
  accountId: number;
  personaName?: string;
  mostRecent: boolean;
  gamesWithPlaytime: number;
};

export type ScannedExecutable = {
  fileName: string;
  relativePath: string;
  sizeBytes: number;
  depth: number;
  /** True when MicrosoftGame.config declares this as the title executable. */
  declared?: boolean;
};

export type ScannedLibraryGame = {
  externalId: string;
  name?: string;
  playtimeSeconds: number | null;
  hasPlayedEvidence?: boolean;
  /** Membership is independent of whether the provider has play history. */
  inAccountLibrary?: boolean;
  /** An incomplete local scan cannot establish that this game is uninstalled. */
  installationStatusUnknown?: boolean;
  lastPlayedUnix?: number;
  installed: boolean;
  installPath?: string;
  executables: ScannedExecutable[];
};

export type LibraryScanResult = {
  games: ScannedLibraryGame[];
  warnings: string[];
  partial: boolean;
  resolvedGames?: ResolvedLibraryGame[];
};

export type ResolvedLibraryGame = {
  key: string;
  status: "resolved" | "unknown";
  game?: GameMetadata;
  executables: LibraryKnownExecutable[];
  candidates?: GameMetadata[];
};

export type LibraryImportCommit = {
  entry: LibraryImportEntry;
  metadata: GameMetadata;
  install?: LibraryInstallEntry;
  preserveInstall?: boolean;
  exeCacheEntries: ExeCacheEntry[];
  scopedLinks: ScopedExeLink[];
};

export function libraryEntryKey(
  provider: LibraryProviderId,
  externalId: string,
) {
  return `${provider}:${externalId}`;
}
