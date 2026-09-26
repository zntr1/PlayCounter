import type { LibraryProviderId } from "@playcounter/shared";
import { libraryEntryKey } from "./types";

/**
 * Machine-local memory for adding newly installed games automatically: which
 * Steam account was imported on this PC, and which launcher games the user
 * removed so they are never added back. Kept out of backups, like install
 * paths.
 */
const STORAGE_KEY = "playcounter.libraryAutoAdd";

type LibraryAutoAddRecord = {
  steamAccountId?: number;
  /** `provider:externalId` keys, as in `libraryEntryKey`. */
  dismissed: string[];
};

type LauncherGame = { provider: LibraryProviderId; externalId: string };

export function readLibraryAutoAdd(): LibraryAutoAddRecord {
  try {
    const parsed: unknown = JSON.parse(
      localStorage.getItem(STORAGE_KEY) ?? "{}",
    );
    const value =
      parsed && typeof parsed === "object"
        ? (parsed as Partial<LibraryAutoAddRecord>)
        : {};
    return {
      steamAccountId:
        typeof value.steamAccountId === "number" &&
        Number.isInteger(value.steamAccountId) &&
        value.steamAccountId >= 0
          ? value.steamAccountId
          : undefined,
      dismissed: Array.isArray(value.dismissed)
        ? value.dismissed.filter(
            (key): key is string => typeof key === "string",
          )
        : [],
    };
  } catch {
    return { dismissed: [] };
  }
}

function writeLibraryAutoAdd(record: LibraryAutoAddRecord) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
  } catch {
    // Without storage the next start simply waits for another Steam import.
  }
}

/** A successful Steam import names the account whose playtime to read. */
export function rememberSteamImportAccount(accountId: number) {
  writeLibraryAutoAdd({ ...readLibraryAutoAdd(), steamAccountId: accountId });
}

export function isLauncherGameDismissed(
  record: LibraryAutoAddRecord,
  game: LauncherGame,
) {
  return record.dismissed.includes(
    libraryEntryKey(game.provider, game.externalId),
  );
}

export function dismissLauncherGames(games: readonly LauncherGame[]) {
  const record = readLibraryAutoAdd();
  const added = games
    .map((game) => libraryEntryKey(game.provider, game.externalId))
    .filter((key) => !record.dismissed.includes(key));
  if (added.length === 0) return;
  writeLibraryAutoAdd({
    ...record,
    dismissed: [...record.dismissed, ...new Set(added)],
  });
}

/** Importing a game by hand takes back an earlier removal. */
export function undismissLauncherGames(games: readonly LauncherGame[]) {
  const record = readLibraryAutoAdd();
  const keys = new Set(
    games.map((game) => libraryEntryKey(game.provider, game.externalId)),
  );
  const dismissed = record.dismissed.filter((key) => !keys.has(key));
  if (dismissed.length === record.dismissed.length) return;
  writeLibraryAutoAdd({ ...record, dismissed });
}

/** Forgetting a launcher's data starts over for that launcher. */
export function forgetLauncherAutoAdd(provider: LibraryProviderId) {
  const record = readLibraryAutoAdd();
  writeLibraryAutoAdd({
    steamAccountId: provider === "steam" ? undefined : record.steamAccountId,
    dismissed: record.dismissed.filter(
      (key) => !key.startsWith(`${provider}:`),
    ),
  });
}
