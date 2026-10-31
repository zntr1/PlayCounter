import { invoke } from "@tauri-apps/api/core";
import type { LibraryScanResult, ScannedLibraryGame } from "./types";
import { getT } from "../i18n";
import { refreshKeptLogins, useKeptLogins } from "./keptLogins";
import {
  getLoginOperationRevision,
  recordLoginHealth,
  supersedeLoginCheck,
} from "./loginHealth";

const t = getT("import");

/** Deliberately excludes account ids, e-mail addresses and tokens. */
export type EpicAccountLibrary = {
  games: { appName: string; title: string; playtimeSeconds: number | null }[];
  incomplete: boolean;
};

/**
 * Adds the account's games and Epic's recorded playtime to the local scan.
 * Every owned game is importable. Never-played ones start unchecked in the
 * importer (see `startsUnchecked`): Epic accounts collect many free games.
 */
export function mergeEpicAccountLibrary(
  account: EpicAccountLibrary,
  local: LibraryScanResult,
): LibraryScanResult {
  const games = new Map(local.games.map((game) => [game.externalId, game]));
  for (const game of account.games) {
    const installed = games.get(game.appName);
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
          externalId: game.appName,
          name: game.title,
          inAccountLibrary: true,
          installed: false,
          installationStatusUnknown: local.partial || undefined,
          playtimeSeconds: playtime,
          hasPlayedEvidence: played,
          executables: [],
        };
    games.set(game.appName, entry);
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
              "Epic Games returned only part of your library or playtime. Sign in again to retry.",
            ),
          ]
        : []),
    ],
    partial: local.partial || account.incomplete,
  };
}

export function readEpicAccountLibrary(signal?: AbortSignal) {
  return runEpicAccountCommand<EpicAccountLibrary>(
    "library_epic_account_games",
    signal,
  );
}

/** Connects the account without waiting for game discovery or local scanning. */
export function signInEpicAccount(signal?: AbortSignal) {
  return runEpicAccountCommand<void>("library_epic_sign_in", signal);
}

async function runEpicAccountCommand<T>(command: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  supersedeLoginCheck("epic");
  const revision = getLoginOperationRevision("epic");
  const savedAt = useKeptLogins.getState().logins.find(
    (login) => login.service === "epic",
  )?.savedAt;
  const requestId = crypto.randomUUID();
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => {
      void invoke("library_cancel_epic_account", { requestId }).catch(() => {});
      reject(
        signal?.reason ?? new DOMException(t("Import cancelled"), "AbortError"),
      );
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([
      // A token exchange already underway finishes saving even after the
      // caller leaves this view. Refresh its durable result when native ends.
      invoke<T>(command, {
        requestId,
        title: t("Epic Games sign-in"),
      })
        .then((result) => {
          if (revision === getLoginOperationRevision("epic"))
            recordLoginHealth("epic", "valid");
          return result;
        })
        .finally(async () => {
          const saved = (await refreshKeptLogins()).find(
            (login) => login.service === "epic",
          );
          // Native cancellation can save a newly verified login before rejecting.
          if (
            saved &&
            saved.savedAt !== savedAt &&
            revision === getLoginOperationRevision("epic")
          )
            recordLoginHealth("epic", "valid");
        }),
      aborted,
    ]);
  } finally {
    if (onAbort) signal?.removeEventListener("abort", onAbort);
  }
}
