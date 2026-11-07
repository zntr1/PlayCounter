/**
 * A game's own achievements from its store (Steam, Xbox, Epic Games, GOG,
 * PlayStation), as the developers made them. Not PlayCounter's milestones.
 * Same file in the backend repo.
 */
export type AchievementProvider =
  | "steam"
  | "xbox"
  | "epic"
  | "gog"
  | "playstation";

/** A PlayStation trophy's cup. */
export type TrophyType = "bronze" | "silver" | "gold" | "platinum";

export interface GameAchievement {
  /** Stable within the game: Steam's API name, Xbox "serviceConfigId:id",
   *  Epic's achievement name, GOG's achievement key, PlayStation
   *  "npCommunicationId:trophyId". */
  id: string;
  name: string;
  description: string;
  /** Secret until unlocked. */
  hidden: boolean;
  unlocked: boolean;
  /** Unix ms. Only on unlocked achievements, when the store knows it. */
  unlockedAt?: number;
  iconUrl?: string;
  /** Steam's grey icon for a locked achievement. */
  lockedIconUrl?: string;
  progress?: { current: number; target: number };
  /** Share of all players who unlocked it, 0–100. */
  globalPercent?: number;
  /** Xbox Gamerscore. */
  gamerscore?: number;
  /** Epic Games XP. */
  xp?: number;
  /** PlayStation: the trophy's cup. */
  trophyType?: TrophyType;
  /** PlayStation: the console of the trophy's list. Only when the game has a
   *  PS5 and a PS4 list. */
  platform?: "PS5" | "PS4";
}

export interface AchievementList {
  provider: AchievementProvider;
  /** Steam app id, Xbox title id, Epic app name, GOG product id or
   *  PlayStation Store concept id. */
  externalId: string;
  /** When PlayCounter read it, unix ms. */
  fetchedAt: number;
  achievements: GameAchievement[];
}

/** Why Xbox sent no list for a title. "unavailable" is not "no achievements":
 *  Xbox 360 titles answer that way too. */
export type XboxAchievementError =
  | "unavailable"
  | "forbidden"
  | "rate_limited"
  | "failed";

/** Body of POST /api/xbox/import/start. Empty = the plain import. */
export interface XboxImportStartRequest {
  /** Connect the account without reading its games or achievements. */
  authenticationOnly?: boolean;
  /** Also read every title's achievements. */
  includeAchievements?: boolean;
  /** Only these titles' achievements: no game matching, no playtime. */
  achievementTitleIds?: string[];
  /** The player's language (BCP 47) for achievement names and texts. */
  language?: string;
  /** Keep the Microsoft sign-in: SHA-256 (hex) of a secret only the desktop's
   *  Rust part knows. Only that secret can retrieve the sign-in. */
  keepLogin?: { claimHash: string };
}
