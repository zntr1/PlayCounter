import { invoke } from "@tauri-apps/api/core";
import type {
  LibraryAccount,
  LibraryScanResult,
  ScannedLibraryGame,
} from "./types";
import { getT } from "../i18n";
import { namedAccount, refreshKeptLogins, useKeptLogins } from "./keptLogins";
import {
  getLoginOperationRevision,
  recordLoginHealth,
  supersedeLoginCheck,
} from "./loginHealth";

const t = getT("import");

/** One game of Nintendo's play history (docs/nintendo-import-plan.md).
 *  Deliberately excludes the account id and every token. */
export type NintendoAccountGame = {
  /** Nintendo's title id, lowercase: "0100000000010000". */
  titleId: string;
  /** Nintendo's name, often in capitals ("SUPER MARIO ODYSSEY"). May be
   *  empty. */
  title: string;
  /** Nintendo's whole minutes as seconds. Null: no readable total. */
  playtimeSeconds: number | null;
  lastPlayedAt: string | null;
};

export type NintendoAccountLibrary = {
  games: NintendoAccountGame[];
  /** The account read, by a key made in Rust from its id. The nickname
   *  comes with the sign-in, not with this read. */
  account?: LibraryAccount;
};

/** A read with the kept sign-in only. Never opens a window. */
export type NintendoSavedRead<T> = {
  status: "valid" | "needsSignIn" | "unavailable" | "signedOut" | "busy";
  value?: T;
  rateLimited?: boolean;
};

/** Nintendo's play history as a scan: nothing is installed on this PC. */
export function nintendoScanResult(
  library: NintendoAccountLibrary,
): LibraryScanResult {
  const games = library.games.map(
    (game): ScannedLibraryGame => ({
      externalId: game.titleId,
      ...(game.title ? { name: game.title } : {}),
      playtimeSeconds: game.playtimeSeconds,
      // Nintendo lists only games that were played.
      hasPlayedEvidence: true,
      inAccountLibrary: true,
      lastPlayedUnix: lastPlayedUnix(game.lastPlayedAt),
      installed: false,
      executables: [],
    }),
  );
  return {
    games: games.sort((a, b) =>
      (a.name ?? a.externalId).localeCompare(b.name ?? b.externalId),
    ),
    warnings: [],
    partial: false,
    ...(library.account
      ? { account: namedAccount("nintendo", library.account) }
      : {}),
  };
}

function lastPlayedUnix(value: string | null) {
  if (!value) return undefined;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : undefined;
}

export function readNintendoAccountLibrary(signal?: AbortSignal) {
  return runNintendoCommand<NintendoAccountLibrary>(
    "library_nintendo_account_games",
    signal,
  );
}

/** Connects the account without reading its games. */
export function signInNintendoAccount(signal?: AbortSignal) {
  return runNintendoCommand<void>("library_nintendo_sign_in", signal);
}

/** "Sign in with a link", step one: Nintendo's sign-in in the browser. */
export function openNintendoSignInLink() {
  return invoke<void>("library_nintendo_open_sign_in_link");
}

/** "Sign in with a link", step two: the link copied from Nintendo's page. */
export async function signInNintendoWithLink(link: string) {
  supersedeLoginCheck("nintendo");
  const revision = getLoginOperationRevision("nintendo");
  try {
    await invoke<void>("library_nintendo_sign_in_with_link", { link });
    if (revision === getLoginOperationRevision("nintendo"))
      recordLoginHealth("nintendo", "valid");
  } finally {
    await refreshKeptLogins();
  }
}

/** The play history with the kept sign-in, for background refreshes. */
export function readSavedNintendoGames() {
  return invoke<NintendoSavedRead<NintendoAccountLibrary>>(
    "library_nintendo_saved_games",
  );
}

async function runNintendoCommand<T>(command: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  supersedeLoginCheck("nintendo");
  const revision = getLoginOperationRevision("nintendo");
  const savedAt = useKeptLogins
    .getState()
    .logins.find((login) => login.service === "nintendo")?.savedAt;
  const requestId = crypto.randomUUID();
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => {
      void invoke("library_cancel_nintendo_account", { requestId }).catch(
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
        title: t("Nintendo sign-in"),
      })
        .then((result) => {
          if (revision === getLoginOperationRevision("nintendo"))
            recordLoginHealth("nintendo", "valid");
          return result;
        })
        .finally(async () => {
          const saved = (await refreshKeptLogins()).find(
            (login) => login.service === "nintendo",
          );
          if (
            saved &&
            saved.savedAt !== savedAt &&
            revision === getLoginOperationRevision("nintendo")
          )
            recordLoginHealth("nintendo", "valid");
        }),
      aborted,
    ]);
  } finally {
    if (onAbort) signal?.removeEventListener("abort", onAbort);
  }
}
