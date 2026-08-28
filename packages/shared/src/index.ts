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

/** A locally installed game-library provider. Kept as a union for future adapters. */
export type LibraryProviderId = "steam";

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

export interface Settings {
  launchOnStartup: boolean;
  showDurationDays: boolean;
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
