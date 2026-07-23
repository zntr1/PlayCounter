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

export interface MatchProcessesResponse {
  matches: Array<{
    key: string;
    game: Game | null;
    matchedIdentifier?: ProcessIdentifier;
    ambiguousGames?: Game[];
    pendingCommunityGame?: Game;
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
