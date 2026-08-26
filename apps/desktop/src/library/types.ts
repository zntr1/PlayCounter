import type {
  ContributionStatus,
  Game,
  GameSource,
  LibraryKnownExecutable,
  LibraryProviderId,
} from "@playcounter/shared";
import type { ExeCacheEntry, GameMetadata } from "../store";

export type LibraryImportEntry = {
  provider: LibraryProviderId;
  externalId: string;
  igdbId: number;
  gameId: number;
  source: Exclude<GameSource, "custom">;
  name: string;
  coverUrl: string;
  importedAt: string;
  providerSeconds: number;
  providerLastPlayedAt?: string;
  lastReadAt: string;
  linkedExeNames: string[];
};

export type LibraryInstallEntry = {
  provider: LibraryProviderId;
  externalId: string;
  installPath: string;
  scannedAt: string;
};

export type ScopedExeLink = {
  exeName: string;
  pathPrefix: string;
  gameId: number;
  source: GameSource;
  igdbId: number;
  gameName: string;
  coverUrl: string;
  provider: LibraryProviderId;
  externalId: string;
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
};

export type ScannedLibraryGame = {
  externalId: string;
  name?: string;
  playtimeSeconds: number;
  lastPlayedUnix?: number;
  installed: boolean;
  installPath?: string;
  executables: ScannedExecutable[];
};

export type LibraryScanResult = {
  games: ScannedLibraryGame[];
  warnings: string[];
  partial: boolean;
};

export type ResolvedLibraryGame = {
  key: string;
  status: "resolved" | "unknown";
  game?: GameMetadata;
  executables: LibraryKnownExecutable[];
};

export type LibraryImportCommit = {
  entry: LibraryImportEntry;
  metadata: GameMetadata;
  install?: LibraryInstallEntry;
  exeCacheEntries: ExeCacheEntry[];
  scopedLinks: ScopedExeLink[];
};

export function libraryEntryKey(
  provider: LibraryProviderId,
  externalId: string,
) {
  return `${provider}:${externalId}`;
}
