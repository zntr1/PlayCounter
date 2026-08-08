export type GameSource = "igdb" | "community" | "custom";

export interface Game {
  id: number;
  name: string;
  coverUrl: string;
  source: GameSource;
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
// client still holding one of them — as a cached match or as the id of its own
// pending suggestion — is holding a retired id for this exact game and can
// move over. Any other id is a different game.
export interface CommunityGameAlias {
  gameId: number;
  mergedFromGameIds: number[];
}

export interface MatchProcessesResponse {
  matches: Array<{
    key: string;
    game: Game | null;
    matchedIdentifier?: ProcessIdentifier;
    ambiguousGames?: Game[];
    pendingCommunityGame?: Game;
    // Covers every community game named in this result — the match, the
    // ambiguous candidates and the pending suggestion. Community and IGDB
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
  // Set instead of id/verified when the suggested game is already a known
  // IGDB match for the exe — the client applies it directly, no review needed.
  igdbGame?: Game;
}

export interface GameMetadataResponse {
  games: Game[];
}

export interface Session {
  id: number;
  gameId: number;
  gameName?: string;
  coverUrl?: string;
  source?: GameSource;
  communitySuggestionId?: number;
  communitySuggestionVerified?: boolean;
  exeName: string;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number | null;
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

export type Theme = "dark" | "light";

export interface Settings {
  launchOnStartup: boolean;
  showDurationDays: boolean;
  pollingIntervalSeconds: number;
  unmatchedRetryDays: number;
  apiEndpoint: string;
  verboseLogs: boolean;
  theme: Theme;
  accentColor: string | null;
}
