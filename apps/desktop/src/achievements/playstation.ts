import { invoke } from "@tauri-apps/api/core";
import type { AchievementList } from "@playcounter/shared";
import type { AppLanguage } from "../appLanguages";
import { appLanguage } from "../i18n";
import { refreshKeptLogins } from "../library/keptLogins";
import {
  getLoginOperationRevision,
  recordLoginHealth,
} from "../library/loginHealth";
import { libraryEntryKey } from "../library/types";
import { useAppStore } from "../store";
import { parseAchievementList } from "./model";

/** Why Sony sent no trophies (playstation_trophies.rs). "noAchievements": no
 *  copy of the game has a trophy list of the player's; "unavailable" is Sony
 *  down or busy, a PlayStation sign-in window open, or this PC offline. */
export type PlayStationTrophyStatus =
  | "noLogin"
  | "needsSignIn"
  | "noAchievements"
  | "unavailable";

export type PlayStationTrophyRead =
  | { list: AchievementList }
  | { status: PlayStationTrophyStatus };

/** After Sony answers "too many requests", trophies wait this long. */
export const RATE_LIMIT_WAIT_MS = 10 * 60_000;

/** Sony's languages for the app's languages, sent as Accept-Language.
 *  Whether Sony translates trophies with them is not confirmed. */
export const PLAYSTATION_LOCALES: Record<AppLanguage, string> = {
  en: "en-US",
  de: "de-DE",
  fr: "fr-FR",
  es: "es-ES",
  "pt-BR": "pt-BR",
  pl: "pl-PL",
  ru: "ru-RU",
  "zh-CN": "zh-CN",
};

let waitUntil = 0;

/** The Rust part's answer: a read with the kept sign-in only. */
function parseRead(conceptId: string, answer: unknown) {
  const raw =
    answer !== null && typeof answer === "object"
      ? (answer as Record<string, unknown>)
      : {};
  const rateLimited = raw.rateLimited === true;
  if (raw.status === "valid") {
    if (Array.isArray(raw.value) && raw.value.length === 0)
      return { read: { status: "noAchievements" } as const, rateLimited };
    const list = parseAchievementList({
      provider: "playstation",
      externalId: conceptId,
      fetchedAt: Date.now(),
      achievements: raw.value,
    });
    return {
      read: list ? { list } : ({ status: "unavailable" } as const),
      rateLimited,
    };
  }
  const status: PlayStationTrophyStatus =
    raw.status === "signedOut"
      ? "noLogin"
      : raw.status === "needsSignIn"
        ? "needsSignIn"
        : "unavailable";
  return { read: { status }, rateLimited };
}

/** One PlayStation game's trophies with the kept PlayStation sign-in. The
 *  Rust part asks Sony with the game's copies the import saved; no window
 *  opens. */
export async function readPlayStationTrophies(
  conceptId: string,
): Promise<PlayStationTrophyRead> {
  const titleIds =
    useAppStore
      .getState()
      .libraryImports.get(libraryEntryKey("playstation", conceptId))
      ?.consoleTitleIds ?? [];
  if (titleIds.length === 0) return { status: "noAchievements" };
  // Sony was busy: a saved list stays until the wait is over.
  if (Date.now() < waitUntil) return { status: "unavailable" };
  const revision = getLoginOperationRevision("playstation");
  let read: PlayStationTrophyRead;
  try {
    const answer = parseRead(
      conceptId,
      await invoke<unknown>("playstation_read_trophies", {
        titleIds,
        language: PLAYSTATION_LOCALES[appLanguage()],
      }),
    );
    waitUntil = answer.rateLimited ? Date.now() + RATE_LIMIT_WAIT_MS : 0;
    read = answer.read;
  } catch {
    return { status: "unavailable" };
  }
  const status = "status" in read ? read.status : "ok";
  // Launcher accounts shows what the read found, unless the account changed
  // meanwhile.
  if (revision === getLoginOperationRevision("playstation")) {
    if (status === "needsSignIn")
      recordLoginHealth("playstation", "needsSignIn");
    else if (status === "ok" || status === "noAchievements")
      recordLoginHealth("playstation", "valid");
  }
  // Signed out elsewhere meanwhile: the list of kept sign-ins is old.
  if (status === "noLogin") await refreshKeptLogins();
  return read;
}
