import { invoke } from "@tauri-apps/api/core";
import type { LibraryScanResult, ScannedLibraryGame } from "./types";
import { getT } from "../i18n";
import { refreshKeptLogins, useKeptLogins } from "./keptLogins";
import {
  getLoginOperationRevision,
  recordLoginHealth,
  supersedeLoginCheck,
  type LoginHealth,
} from "./loginHealth";

const t = getT("import");

/** One PlayStation Store concept: every copy (PS4, PS5) of one game.
 *  Deliberately excludes account ids, the session code and tokens. */
export type PlayStationAccountGame = {
  conceptId: string;
  title: string;
  /** The sum of its copies. Null: Sony gave no readable playtime. */
  playtimeSeconds: number | null;
  lastPlayedAt: string | null;
  platforms: ("PS5" | "PS4")[];
  /** Sony's ids of its copies (PPSA01521_00), to recognise it running. */
  titleIds: string[];
};

export type PlayStationAccountLibrary = {
  games: PlayStationAccountGame[];
  incomplete: boolean;
};

/** What runs on the console now, as Sony's presence names it. */
export type PlayStationLiveGame = {
  titleId: string;
  name: string;
  platform: "PS5" | "PS4";
  iconUrl: string | null;
};

export type PlayStationPresence = {
  online: boolean;
  game: PlayStationLiveGame | null;
};

/** A read with the kept sign-in only. Never opens a window. */
export type PlayStationSavedRead<T> = {
  status: "valid" | "needsSignIn" | "unavailable" | "signedOut" | "busy";
  value?: T;
  rateLimited?: boolean;
};

/** Sony's played list as a scan: nothing is installed on this PC. */
export function playStationScanResult(
  account: PlayStationAccountLibrary,
): LibraryScanResult {
  const games = account.games.map(
    (game): ScannedLibraryGame => ({
      externalId: game.conceptId,
      name: game.title,
      playtimeSeconds: game.playtimeSeconds,
      // Sony lists only games that were played.
      hasPlayedEvidence: true,
      inAccountLibrary: true,
      lastPlayedUnix: lastPlayedUnix(game.lastPlayedAt),
      installed: false,
      executables: [],
      consoleTitleIds: game.titleIds,
    }),
  );
  return {
    games: games.sort((a, b) =>
      (a.name ?? a.externalId).localeCompare(b.name ?? b.externalId),
    ),
    warnings: account.incomplete
      ? [
          t(
            "PlayStation returned only part of your library. Sign in again to retry.",
          ),
        ]
      : [],
    partial: account.incomplete,
  };
}

function lastPlayedUnix(value: string | null) {
  if (!value) return undefined;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : undefined;
}

export function readPlayStationAccountLibrary(signal?: AbortSignal) {
  return runPlayStationCommand<PlayStationAccountLibrary>(
    "library_playstation_account_games",
    signal,
  );
}

/** Connects the account without reading its games. */
export function signInPlayStationAccount(signal?: AbortSignal) {
  return runPlayStationCommand<void>("library_playstation_sign_in", signal);
}

/** "Sign in with a code": Sony's session code copied from its own page. */
export async function signInPlayStationWithCode(code: string) {
  supersedeLoginCheck("playstation");
  const revision = getLoginOperationRevision("playstation");
  try {
    await invoke<void>("library_playstation_sign_in_with_code", { code });
    if (revision === getLoginOperationRevision("playstation"))
      recordLoginHealth("playstation", "valid");
  } finally {
    await refreshKeptLogins();
  }
}

/** The played list with the kept sign-in, for background refreshes. */
export function readSavedPlayStationGames() {
  return invoke<PlayStationSavedRead<PlayStationAccountLibrary>>(
    "library_playstation_saved_games",
  );
}

/** What runs on the console now, with the kept sign-in. */
export function readPlayStationPresence() {
  return invoke<PlayStationSavedRead<PlayStationPresence>>(
    "library_playstation_presence",
  );
}

/** The login health a background read reports. */
export function savedReadHealth(
  status: PlayStationSavedRead<unknown>["status"],
): Exclude<LoginHealth["status"], "checking"> | null {
  return status === "valid" || status === "needsSignIn" ? status : null;
}

async function runPlayStationCommand<T>(command: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  supersedeLoginCheck("playstation");
  const revision = getLoginOperationRevision("playstation");
  const savedAt = useKeptLogins
    .getState()
    .logins.find((login) => login.service === "playstation")?.savedAt;
  const requestId = crypto.randomUUID();
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => {
      void invoke("library_cancel_playstation_account", { requestId }).catch(
        () => {},
      );
      reject(
        signal?.reason ?? new DOMException(t("Import cancelled"), "AbortError"),
      );
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([
      // A sign-in already underway finishes saving even after the caller
      // leaves this view. Refresh its durable result when native ends.
      invoke<T>(command, {
        requestId,
        title: t("PlayStation sign-in"),
      })
        .then((result) => {
          if (revision === getLoginOperationRevision("playstation"))
            recordLoginHealth("playstation", "valid");
          return result;
        })
        .finally(async () => {
          const saved = (await refreshKeptLogins()).find(
            (login) => login.service === "playstation",
          );
          if (
            saved &&
            saved.savedAt !== savedAt &&
            revision === getLoginOperationRevision("playstation")
          )
            recordLoginHealth("playstation", "valid");
        }),
      aborted,
    ]);
  } finally {
    if (onAbort) signal?.removeEventListener("abort", onAbort);
  }
}
