import { invoke } from "@tauri-apps/api/core";
import type { GameAchievement } from "@playcounter/shared";
import type { AppLanguage } from "../appLanguages";
import { appLanguage } from "../i18n";
import { readLibraryAutoAdd } from "../library/libraryAutoAddState";
import type { SteamCatalogAchievement } from "./model";

/** What Steam's files on this PC say about a game (achievements.rs). */
export type SteamAchievementRead =
  | {
      status: "ok";
      achievements: GameAchievement[];
      /** False: Steam has the list, but nothing for the account. */
      hasPlayerStats: boolean;
    }
  | {
      status: "noSteam" | "noSchema" | "noAchievements" | "unreadable";
    };

/** Steam's names for the languages its files carry. */
export const STEAM_LANGUAGES: Record<AppLanguage, string> = {
  en: "english",
  de: "german",
  fr: "french",
  es: "spanish",
  "pt-BR": "brazilian",
  pl: "polish",
  ru: "russian",
  "zh-CN": "schinese",
};

/** The Steam import's account on this PC; Rust falls back to the account
 *  Steam used last. */
export function readSteamAchievements(
  appId: string,
): Promise<SteamAchievementRead> {
  return invoke<SteamAchievementRead>("steam_read_achievements", {
    appId,
    accountId: readLibraryAutoAdd().steamAccountId ?? null,
    language: STEAM_LANGUAGES[appLanguage()],
  });
}

const catalogs = new Map<string, Promise<SteamCatalogAchievement[]>>();

/** Steam's public list, once per game and language while the app runs. A
 *  failed request is forgotten, so the next look tries again. */
export function steamAchievementCatalog(
  appId: string,
): Promise<SteamCatalogAchievement[]> {
  const language = STEAM_LANGUAGES[appLanguage()];
  const key = `${appId}:${language}`;
  let request = catalogs.get(key);
  if (!request) {
    request = invoke<SteamCatalogAchievement[]>("steam_achievement_catalog", {
      appId,
      language,
    });
    catalogs.set(key, request);
    request.catch(() => catalogs.delete(key));
  }
  return request;
}
