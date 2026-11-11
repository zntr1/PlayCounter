import type {
  AchievementList,
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
  /**
   * PlayCounter's recorded time for this game when providerSeconds was read.
   * Time tracked after that is added on top of the launcher total. Missing
   * only on entries saved before this existed, until the app fills it in.
   */
  recordedSecondsAtRead?: number;
  /** False means no provider play evidence, not proof of never playing. */
  providerHasPlayedEvidence?: boolean;
  providerLastPlayedAt?: string;
  lastReadAt: string;
  linkedExeNames: string[];
  linkedExeSources: GameSource[];
  /** PlayStation: Sony's ids of the game's copies, so a game running on the
   *  console is recognised (playstationLive.ts). */
  consoleTitleIds?: string[];
  /** Each launcher account's own reading of this game; `providerSeconds` is
   *  their sum. Absent on entries saved before accounts were known, until an
   *  account reads the game again (docs/import-accounts-plan.md). */
  accounts?: AccountReading[];
};

/** The launcher account a scan read. */
export type LibraryAccount = {
  /** SHA-256 of "<launcher>:<account id>", 32 hex characters. Made in Rust,
   *  or by our server for Xbox: the account id never reaches this side. */
  key: string;
  /** Steam persona, Xbox gamertag, Epic display name, GOG user name or PSN
   *  online id. Null when the launcher gives none. */
  name: string | null;
};

/** One account's reading of a game. */
export type AccountReading = LibraryAccount & {
  seconds: number | null;
  lastPlayedAt?: string;
  hasPlayedEvidence?: boolean;
  readAt: string;
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
  /** Absent for a game named on this PC (a generic exe's custom game). */
  igdbId?: number;
  gameName: string;
  coverUrl: string;
  /** The file this link was made from, when its folder is the link's folder:
   *  Play starts it. Launcher links point at the install root instead. */
  exePath?: string;
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

/** One folder's copy of a generic exe (Game.exe) ignored on this PC. Other
 *  folders with the same file name are still tracked. */
export type IgnoredExeFolder = {
  exeName: string;
  pathPrefix: string;
  ignoredAt: string;
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
  /** The launcher starts the game in an emulator it ships with the game
   *  (GOG's DOSBox and ScummVM games): there is no game file to link. */
  runsInEmulator?: boolean;
  /** PlayStation: Sony's ids of the game's copies (PPSA01521_00). */
  consoleTitleIds?: string[];
  /** PlayStation: Sony names no console for any copy (its "unknown"
   *  category), seen for games other people played on the account. Starts
   *  unchecked and is never added in the background. */
  consoleUnknown?: boolean;
};

export type LibraryScanResult = {
  games: ScannedLibraryGame[];
  warnings: string[];
  partial: boolean;
  resolvedGames?: ResolvedLibraryGame[];
  /** Xbox: the achievements read during the same sign-in. */
  achievementLists?: AchievementList[];
  /** The account it read. Absent for scans of this PC only. */
  account?: LibraryAccount;
  /** Some totals may be short: Sony's list ended early, so a game's copies
   *  may not all be added up. Such a read decides no account's earlier
   *  hours (docs/import-accounts-plan.md, D1). */
  totalsCutShort?: boolean;
};

export type ResolvedLibraryGame = {
  key: string;
  status: "resolved" | "unknown";
  game?: GameMetadata;
  executables: LibraryKnownExecutable[];
  candidates?: GameMetadata[];
  /** Matched by name, not installed: the game's files are asked for on
   *  Import, like a picked game's (docs/name-auto-match-plan.md). */
  filesOnImport?: boolean;
};

export type LibraryImportCommit = {
  entry: LibraryImportEntry;
  metadata: GameMetadata;
  install?: LibraryInstallEntry;
  preserveInstall?: boolean;
  exeCacheEntries: ExeCacheEntry[];
  scopedLinks: ScopedExeLink[];
  /** The read stopped early: it never splits earlier hours (D1). */
  partialRead?: boolean;
};

export function libraryEntryKey(
  provider: LibraryProviderId,
  externalId: string,
) {
  return `${provider}:${externalId}`;
}
