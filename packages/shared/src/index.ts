export type GameSource = "igdb" | "community" | "custom";

export interface Game {
  id: number;
  igdbId?: number;
  name: string;
  coverUrl: string;
  source: GameSource;
  releaseYear?: number;
}

export type EmulatorContentKind =
  | "conf"
  | "program"
  | "folder"
  | "rom"
  | "title_id";
export type EmulatorSignalTrust = "recognized" | "weak";

export interface EmulatorLaunchContext {
  emulatorId: string;
  label: string;
  contentKey: string;
  display: string;
  trust: EmulatorSignalTrust;
}

export interface EmulatorContentRef {
  emulatorId: string;
  contentKind: EmulatorContentKind;
  contentValue: string;
}

export interface EmulatorResolveRequest {
  items: Array<{ key: string; searchHint?: string } & EmulatorContentRef>;
}

export type EmulatorResolveConfidence =
  | "curated"
  | "probable"
  | "ambiguous"
  | "unknown";

export interface EmulatorResolveResponse {
  results: Array<{
    key: string;
    confidence: EmulatorResolveConfidence;
    game: Game | null;
    candidates?: Game[];
  }>;
}

/** A locally installed or remotely linked game-library provider. */
export type LibraryProviderId = "steam" | "xbox";

export interface LibraryResolveRequest {
  items: Array<{
    /** Client-generated correlation key; never treated as game identity. */
    key: string;
    provider: LibraryProviderId;
    /** Provider-native id. Steam uses its decimal AppID. */
    externalId: string;
  }>;
}

export interface LibraryKnownExecutable {
  platform: Platform;
  kind: ProcessIdentifierKind;
  value: string;
  provenance: "igdb" | "community";
  verified: boolean;
  /** True when this basename must not become a global one-to-one mapping. */
  ambiguous?: boolean;
}

export interface LibraryResolveResponse {
  results: Array<{
    key: string;
    status: "resolved" | "unknown";
    game?: Game;
    executables?: LibraryKnownExecutable[];
    flaggedIdentifiers?: Array<{
      value: string;
      reason: IdentifierFlagReason;
    }>;
  }>;
}
export interface LibraryReverseResolveRequest {
  /** Server-local game id selected by the user. */
  gameId: number;
}

export interface LibraryReverseResolveResponse {
  game: Game;
  executables: LibraryKnownExecutable[];
}

/**
 * Xbox playtime import: the local desktop client has no on-disk source for
 * Xbox/Game Pass playtime, so the whole OAuth + Xbox Live lookup + IGDB
 * matching flow runs server-side. The desktop client never receives a
 * Microsoft or Xbox Live token.
 */
export interface XboxImportStartResponse {
  /** Opaque handle correlating the browser sign-in with later polling. */
  attemptId: string;
  /** Microsoft sign-in URL to open in the user's system browser. */
  authorizeUrl: string;
}

export type XboxImportFailureReason =
  | "cancelled"
  | "timed_out"
  | "oauth_error"
  | "xbox_api_error";

export type XboxImportFailureStage =
  | "authorization"
  | "microsoft_token"
  | "xbox_user_token"
  | "xbox_xsts"
  | "title_history";

export interface XboxImportGame {
  /** Xbox Live title ID, the provider-native external ID for this provider. */
  externalId: string;
  /** Title as reported by Xbox Live; never IGDB truth. */
  name: string;
  /**
   * Total playtime in seconds when Xbox Live reported MinutesPlayed,
   * otherwise null. null is a distinct "unknown", never zero.
   */
  providerSeconds: number | null;
  /** ISO timestamp of the last achievement unlock, when available. */
  providerLastPlayedAt?: string;
  /**
   * Title-search suggestions only. The desktop must require the user to pick
   * one before importing; no Xbox-provided identifier proves an IGDB match.
   */
  candidates: Game[];
}

export type XboxImportProgressStage = "authorization" | "history";

export type XboxImportResultResponse =
  | { status: "pending"; stage?: XboxImportProgressStage }
  | { status: "done"; games: XboxImportGame[] }
  | {
      status: "failed";
      reason: XboxImportFailureReason;
      stage?: XboxImportFailureStage;
      errorCode?: string;
      /** Display-only Microsoft account label; never use for authorization. */
      accountLabel?: string;
    };

export interface XboxImportCancelRequest {
  attemptId: string;
}

export interface EmulatorContentSuggestionPayload extends EmulatorContentRef {
  /** Server-local igdb_games.id. Local custom games use negative ids. */
  gameId: number;
  /** Anonymous per-install idempotency key. */
  installUuid: string;
}

export type EmulatorContentSuggestionStatus =
  | "pending"
  | "rejected"
  | "already_curated";

export interface EmulatorContentSuggestionResponse {
  status: EmulatorContentSuggestionStatus;
  /** The currently curated game, if this identity already has one. */
  game?: Game;
  reviewNote?: string;
}

export type Platform = "windows" | "macos" | "linux";

export type ProcessIdentifierKind =
  | "exe"
  | "bundle_id"
  | "app_bundle"
  | "process_name"
  | "steam_app_id"
  | "executable_path"
  | "executable_name"
  | "desktop_id"
  | "wine_exe";

export interface ProcessIdentifier {
  platform: Platform;
  kind: ProcessIdentifierKind;
  value: string;
}

export interface MatchProcessRequestItem {
  key: string;
  identifiers: ProcessIdentifier[];
}

export interface MatchProcessesRequest {
  processes: MatchProcessRequestItem[];
}

// Community game ids that were merged into `gameId` and no longer exist. A
// client still holding one of them - as a cached match or as the id of its own
// pending suggestion - is holding a retired id for this exact game and can
// move over. Any other id is a different game.
export interface CommunityGameAlias {
  gameId: number;
  mergedFromGameIds: number[];
}

export type IdentifierFlagReason = "not_a_game" | "ambiguous";

export interface MatchProcessesResponse {
  matches: Array<{
    key: string;
    game: Game | null;
    matchedIdentifier?: ProcessIdentifier;
    ambiguousGames?: Game[];
    // Verified problematic identifiers always use the picker, even when only
    // one candidate exists, so a shared executable name is never auto-applied.
    flaggedIdentifier?: { reason: IdentifierFlagReason };
    pendingCommunityGame?: Game;
    // All unverified suggestions for the matched identifiers. Newer servers
    // always include this array (including when empty), which lets the desktop
    // distinguish a rejected suggestion from one hidden behind another match.
    // The singular field remains for older clients and discovery UI.
    pendingCommunityGames?: Game[];
    // Covers every community game named in this result - the match, the
    // ambiguous candidates and pending suggestions. Community and IGDB
    // entries for one exe deliberately end up in the picker, so a merged game
    // often appears only as a candidate.
    communityGameAliases?: CommunityGameAlias[];
  }>;
}

export interface CommunityMetadataCandidate {
  igdbId: number;
  name: string;
  coverUrl: string;
  releaseYear?: number;
}

export interface CommunityMetadataSearchResponse {
  candidates: CommunityMetadataCandidate[];
  // Optional for compatibility with servers released before metadata search
  // pagination. When true, nextOffset can be passed back to fetch more of the
  // same ranked IGDB search without replacing the visible candidates.
  hasMore?: boolean;
  nextOffset?: number;
}

export interface CommunityGameSuggestionPayload {
  exeName: string;
  name: string;
  coverUrl?: string;
  // Identity of the picked metadata candidate. Names are not unique (remakes,
  // re-releases), so this is what decides whether a suggestion joins an
  // existing community game or starts a new one. Optional: clients released
  // before this field existed still only send the name.
  igdbId?: number;
  installUuid?: string;
}

export interface CommunityGameSuggestionResponse {
  id?: number;
  verified?: boolean;
  rejected?: boolean;
  reviewNote?: string;
  // Set instead of id/verified when the suggested game is already a known
  // IGDB match for the exe - the client applies it directly, no review needed.
  igdbGame?: Game;
}

export interface CommunitySuggestionCancelPayload {
  exeName: string;
  gameId: number;
  installUuid: string;
}

export type CommunitySuggestionCancelStatus =
  | "cancelled"
  | "not_found"
  | "not_pending"
  | "not_owner";

export interface CommunitySuggestionCancelResponse {
  status: CommunitySuggestionCancelStatus;
}

export type IdentifierReportReason = "not_a_game";

export interface IdentifierReportPayload {
  exeName: string;
  reason: IdentifierReportReason;
  // Omitted when the report comes from an ambiguity picker where no game has
  // been selected yet.
  gameId?: number;
  gameSource?: "igdb" | "community";
  // Required as the per-install idempotency key for community evidence.
  installUuid: string;
}

export interface IdentifierReportResponse {
  status: "recorded" | "duplicate" | "already_reviewed";
  flagged: boolean;
}

export interface IgnoredProcessReportPayload {
  exeName: string;
  platform: Platform;
  // Used only as an anonymous, per-install idempotency key.
  installUuid: string;
}

export type IgnoredProcessReportStatus =
  | "recorded"
  | "duplicate"
  | "already_reviewed";

export interface IgnoredProcessReportResponse {
  status: IgnoredProcessReportStatus;
}

export type ContributionStatus = "pending" | "verified" | "rejected";

export interface Contribution {
  platform: Platform;
  kind: ProcessIdentifierKind;
  value: string;
  gameId: number;
  gameName: string;
  coverUrl: string;
  status: ContributionStatus;
  reviewNote?: string;
  reviewedAt?: string;
  createdAt: string;
}

export interface ContributionCounts {
  suggested: number;
  verified: number;
  pending: number;
  rejected: number;
}

export interface EmulatorContribution extends EmulatorContentRef {
  gameId: number;
  gameName: string;
  coverUrl: string;
  status: ContributionStatus;
  reviewNote?: string;
  reviewedAt?: string;
  createdAt: string;
}

export interface ContributionsResponse {
  items: Contribution[];
  counts: ContributionCounts;
  /** Absent on API builds released before emulator contributions. */
  emulator?: {
    items: EmulatorContribution[];
    counts: ContributionCounts;
  };
}

export interface GameMetadataResponse {
  games: Game[];
}

/**
 * Extended IGDB facts for one game, shown in the desktop's game details view.
 * Everything past `gameId`/`igdbId` is optional or an empty array: IGDB entries
 * are unevenly filled, and a community game may have no IGDB entry at all.
 */
export interface GameDetails {
  /**
   * Keyed on the IGDB id, never a server-local game id: local ids differ
   * between deployments (and move when community games merge), while this one
   * identifies the same game everywhere.
   */
  igdbId: number;
  /** Canonical IGDB page, as IGDB itself reports it. Never built from a slug. */
  igdbUrl?: string;
  summary?: string;
  /** ISO calendar date (YYYY-MM-DD) of the first release, when IGDB knows one. */
  releaseDate?: string;
  releaseYear?: number;
  developers: string[];
  publishers: string[];
  genres: string[];
  gameModes: string[];
  platforms: string[];
  /** IGDB's aggregate score, 0-100, rounded. Absent when too few ratings. */
  rating?: number;
}

export interface GameDetailsResponse {
  details: GameDetails[];
}

export interface Session {
  id: number;
  gameId: number;
  igdbId?: number;
  gameName?: string;
  coverUrl?: string;
  source?: GameSource;
  communitySuggestionId?: number;
  communitySuggestionVerified?: boolean;
  communitySuggestionStatus?: ContributionStatus;
  communitySuggestionNote?: string;
  exeName: string;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number | null;
  origin?: "manual";
  emulator?: EmulatorLaunchContext;
}

export type FeedbackType = "bug" | "feature" | "other";

export interface FeedbackPayload {
  type: FeedbackType;
  message: string;
  appVersion: string;
  platform: string;
  installUuid?: string;
}

export interface FeedbackResponse {
  id: number;
}

export interface InstallPresencePayload {
  installUuid: string;
}

export type Theme = "dark" | "light";

/** Summary cards a My Games tab can show above the grid. */
export type LibraryStatCardId =
  | "games"
  | "playtime"
  | "tracked"
  | "recent"
  | "sessions"
  | "played"
  | "unplayed"
  | "installed"
  | "emulator";

export interface Settings {
  launchOnStartup: boolean;
  showDurationDays: boolean;
  /** My Games card density. Absent on older persisted settings. */
  libraryCardSize?: "grid" | "large" | "list";
  librarySortKey?: "recent" | "playtime" | "name" | "sessions";
  /** Retired single toggle. Still read once so an existing opt-out seeds both
   *  of the toggles below; never written again. */
  libraryShowBadges?: boolean;
  /** Steam, Xbox, emulator or PlayCounter mark beside each game name. */
  libraryShowOriginBadges?: boolean;
  /** IGDB, Community or Custom seal in the cover corner. */
  libraryShowMatchBadges?: boolean;
  /** Request IGDB cover art one size up. Absent = off, the smaller default. */
  libraryHighResCovers?: boolean;
  /** My Games summary cards. Absent = the default set. Empty = all off. */
  libraryStatCards?: LibraryStatCardId[];
  /** Master switch for the My Games summary row. */
  libraryShowStatCards?: boolean;
  /** Drop provider tabs that have no imported games. Absent = off, tabs stay. */
  libraryHideEmptyProviderTabs?: boolean;
  autoShareIgnoredProcesses: boolean;
  pollingIntervalSeconds: number;
  unmatchedRetryDays: number;
  apiEndpoint: string;
  verboseLogs: boolean;
  theme: Theme;
  accentColor: string | null;
  emulatorDetection?: boolean;
  emulatorContentLookup?: boolean;
  ignoredEmulatorIds?: string[];
  desktopOverlaysEnabled?: boolean;
  overlayFirstDetections?: boolean;
  overlaySessionStarts?: boolean;
  overlaySessionSummaries?: boolean;
  overlayMilestones?: boolean;
  overlayActionRequired?: boolean;
  overlayDiscoveries?: boolean;
  rememberLaunchPaths?: boolean;
  gameLaunchingEnabled?: boolean;
  controllerNavigationEnabled?: boolean;
}
