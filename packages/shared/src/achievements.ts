/**
 * A game's own achievements from its store (Steam, Xbox), as the developers
 * made them. Not PlayCounter's milestones. Same file in the backend repo.
 */
export type AchievementProvider = "steam" | "xbox";

export interface GameAchievement {
  /** Stable within the game: Steam's API name, Xbox "serviceConfigId:id". */
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
}

export interface AchievementList {
  provider: AchievementProvider;
  /** Steam app id or Xbox title id. */
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
  /** Also read every title's achievements. */
  includeAchievements?: boolean;
  /** Only these titles' achievements: no game matching, no playtime. */
  achievementTitleIds?: string[];
  /** The player's language (BCP 47) for achievement names and texts. */
  language?: string;
}
