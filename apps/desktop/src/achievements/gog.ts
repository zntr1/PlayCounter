import { invoke } from "@tauri-apps/api/core";
import type { AchievementList } from "@playcounter/shared";
import type { AppLanguage } from "../appLanguages";
import { appLanguage } from "../i18n";
import { refreshKeptLogins } from "../library/keptLogins";
import {
  getLoginOperationRevision,
  recordLoginHealth,
} from "../library/loginHealth";
import { parseAchievementList } from "./model";

/** Why GOG sent no list (gog_achievements.rs). "noAchievements" also covers
 *  a game without GOG GALAXY features; "unavailable" is GOG down, any other
 *  answer, or this PC offline. */
export type GogAchievementStatus =
  | "noLogin"
  | "needsSignIn"
  | "noAchievements"
  | "unavailable";

export type GogAchievementRead =
  | { list: AchievementList }
  | { status: GogAchievementStatus };

const STATUSES: readonly string[] = [
  "noLogin",
  "needsSignIn",
  "noAchievements",
  "unavailable",
];

/** GOG's languages for the app's languages, written the way GOG GALAXY sends
 *  them. Whether GOG translates achievements with them is not confirmed. */
export const GOG_LOCALES: Record<AppLanguage, string> = {
  en: "en-US",
  de: "de-DE",
  fr: "fr-FR",
  es: "es-ES",
  "pt-BR": "pt-BR",
  pl: "pl-PL",
  ru: "ru-RU",
  "zh-CN": "zh-CN",
};

function parseRead(productId: string, answer: unknown): GogAchievementRead {
  const raw =
    answer !== null && typeof answer === "object"
      ? (answer as Record<string, unknown>)
      : {};
  if (raw.status === "ok") {
    const list = parseAchievementList({
      provider: "gog",
      externalId: productId,
      fetchedAt: Date.now(),
      achievements: raw.achievements,
    });
    return list ? { list } : { status: "unavailable" };
  }
  return typeof raw.status === "string" && STATUSES.includes(raw.status)
    ? { status: raw.status as GogAchievementStatus }
    : { status: "unavailable" };
}

/** One GOG game's achievements with the kept GOG sign-in. The Rust part
 *  renews the sign-in and asks GOG; no window opens. */
export async function readGogAchievements(
  productId: string,
): Promise<GogAchievementRead> {
  const revision = getLoginOperationRevision("gog");
  let read: GogAchievementRead;
  try {
    read = parseRead(
      productId,
      await invoke<unknown>("gog_read_achievements", {
        productId,
        language: GOG_LOCALES[appLanguage()],
      }),
    );
  } catch {
    return { status: "unavailable" };
  }
  const status = "status" in read ? read.status : "ok";
  // Launcher accounts shows what the renewal found, unless the account
  // changed meanwhile.
  if (revision === getLoginOperationRevision("gog")) {
    if (status === "needsSignIn") recordLoginHealth("gog", "needsSignIn");
    else if (status === "ok" || status === "noAchievements")
      recordLoginHealth("gog", "valid");
  }
  // A refused sign-in is gone now.
  if (status === "needsSignIn" || status === "noLogin")
    await refreshKeptLogins();
  return read;
}
