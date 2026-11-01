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

/** Why Epic sent no list (epic_achievements.rs). "blocked" is Epic's bot
 *  check or a refusal; "unavailable" is Epic down or this PC offline. */
export type EpicAchievementStatus =
  | "noLogin"
  | "needsSignIn"
  | "notInAccount"
  | "noAchievements"
  | "blocked"
  | "unavailable";

export type EpicAchievementRead =
  | { list: AchievementList }
  | { status: EpicAchievementStatus };

const STATUSES: readonly string[] = [
  "noLogin",
  "needsSignIn",
  "notInAccount",
  "noAchievements",
  "blocked",
  "unavailable",
];

/** Epic's locales for the app's languages. Not all are confirmed: Rust asks
 *  once more in en-US when Epic answers a locale with an error. */
export const EPIC_LOCALES: Record<AppLanguage, string> = {
  en: "en-US",
  de: "de",
  fr: "fr",
  es: "es-ES",
  "pt-BR": "pt-BR",
  pl: "pl",
  ru: "ru",
  "zh-CN": "zh-CN",
};

function parseRead(appName: string, answer: unknown): EpicAchievementRead {
  const raw =
    answer !== null && typeof answer === "object"
      ? (answer as Record<string, unknown>)
      : {};
  if (raw.status === "ok") {
    const list = parseAchievementList({
      provider: "epic",
      externalId: appName,
      fetchedAt: Date.now(),
      achievements: raw.achievements,
    });
    return list ? { list } : { status: "unavailable" };
  }
  return typeof raw.status === "string" && STATUSES.includes(raw.status)
    ? { status: raw.status as EpicAchievementStatus }
    : { status: "unavailable" };
}

/** One Epic game's achievements with the kept Epic sign-in. The Rust part
 *  renews the sign-in and asks Epic; no window opens. */
export async function readEpicAchievements(
  appName: string,
): Promise<EpicAchievementRead> {
  const revision = getLoginOperationRevision("epic");
  let read: EpicAchievementRead;
  try {
    read = parseRead(
      appName,
      await invoke<unknown>("epic_read_achievements", {
        appName,
        language: EPIC_LOCALES[appLanguage()],
      }),
    );
  } catch {
    return { status: "unavailable" };
  }
  const status = "status" in read ? read.status : "ok";
  // Launcher accounts shows what the renewal found, unless the account
  // changed meanwhile.
  if (revision === getLoginOperationRevision("epic")) {
    if (status === "needsSignIn") recordLoginHealth("epic", "needsSignIn");
    else if (["ok", "notInAccount", "noAchievements"].includes(status))
      recordLoginHealth("epic", "valid");
  }
  // A refused sign-in is gone now.
  if (status === "needsSignIn" || status === "noLogin")
    await refreshKeptLogins();
  return read;
}
