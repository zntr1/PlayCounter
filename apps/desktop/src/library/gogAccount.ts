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

/** Deliberately excludes account ids, e-mail addresses and tokens. */
export type GogAccountLibrary = {
  games: {
    productId: string;
    title: string;
    playtimeSeconds: number | null;
  }[];
  incomplete: boolean;
  /** The account read, by a key made in Rust from its id. GOG's user name
   *  comes with the sign-in, not with this read. */
  account?: LibraryAccount;
};

/**
 * Adds the account's games and GOG's recorded playtime to the local scan.
 * Every owned game is importable. Never-played ones start unchecked in the
 * importer (see `startsUnchecked`): GOG accounts collect many free games.
 */
export function mergeGogAccountLibrary(
  account: GogAccountLibrary,
  local: LibraryScanResult,
): LibraryScanResult {
  const games = new Map(local.games.map((game) => [game.externalId, game]));
  for (const game of account.games) {
    const installed = games.get(game.productId);
    const playtime = game.playtimeSeconds;
    const played = playtime !== null && playtime > 0;
    const entry: ScannedLibraryGame = installed
      ? {
          ...installed,
          name: game.title || installed.name,
          playtimeSeconds: playtime,
          hasPlayedEvidence: played,
          inAccountLibrary: true,
        }
      : {
          externalId: game.productId,
          name: game.title,
          inAccountLibrary: true,
          installed: false,
          installationStatusUnknown: local.partial || undefined,
          playtimeSeconds: playtime,
          hasPlayedEvidence: played,
          executables: [],
        };
    games.set(game.productId, entry);
  }
  return {
    games: [...games.values()].sort((a, b) =>
      (a.name ?? a.externalId).localeCompare(b.name ?? b.externalId),
    ),
    warnings: [
      ...local.warnings,
      ...(account.incomplete
        ? [
            t(
              "GOG returned only part of your library or playtime. Sign in again to retry.",
            ),
          ]
        : []),
    ],
    partial: local.partial || account.incomplete,
    ...(account.account
      ? { account: namedAccount("gog", account.account) }
      : {}),
  };
}

export function readGogAccountLibrary(signal?: AbortSignal) {
  return runGogAccountCommand<GogAccountLibrary>(
    "library_gog_account_games",
    signal,
  );
}

/** Connects the account without reading its games or scanning this PC. */
export function signInGogAccount(signal?: AbortSignal) {
  return runGogAccountCommand<void>("library_gog_sign_in", signal);
}

async function runGogAccountCommand<T>(command: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  supersedeLoginCheck("gog");
  const revision = getLoginOperationRevision("gog");
  const savedAt = useKeptLogins
    .getState()
    .logins.find((login) => login.service === "gog")?.savedAt;
  const requestId = crypto.randomUUID();
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => {
      void invoke("library_cancel_gog_account", { requestId }).catch(() => {});
      reject(
        signal?.reason ?? new DOMException(t("Import cancelled"), "AbortError"),
      );
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([
      // A code exchange already underway finishes saving even after the
      // caller leaves this view. Refresh its durable result when native ends.
      invoke<T>(command, {
        requestId,
        title: t("GOG sign-in"),
      })
        .then((result) => {
          if (revision === getLoginOperationRevision("gog"))
            recordLoginHealth("gog", "valid");
          return result;
        })
        .finally(async () => {
          const saved = (await refreshKeptLogins()).find(
            (login) => login.service === "gog",
          );
          // Native cancellation can save a newly verified login before rejecting.
          if (
            saved &&
            saved.savedAt !== savedAt &&
            revision === getLoginOperationRevision("gog")
          )
            recordLoginHealth("gog", "valid");
        }),
      aborted,
    ]);
  } finally {
    if (onAbort) signal?.removeEventListener("abort", onAbort);
  }
}
