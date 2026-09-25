/**
 * Machine-local memory for adding new Steam games automatically: which Steam
 * account was imported on this PC, and which Steam games the user removed so
 * they are never added back. Kept out of backups, like install paths.
 */
const STORAGE_KEY = "playcounter.steamAutoAdd";

type SteamAutoAddRecord = {
  accountId?: number;
  dismissedAppIds: string[];
};

export function readSteamAutoAdd(): SteamAutoAddRecord {
  try {
    const parsed: unknown = JSON.parse(
      localStorage.getItem(STORAGE_KEY) ?? "{}",
    );
    const value =
      parsed && typeof parsed === "object"
        ? (parsed as Partial<SteamAutoAddRecord>)
        : {};
    return {
      accountId:
        typeof value.accountId === "number" &&
        Number.isInteger(value.accountId) &&
        value.accountId >= 0
          ? value.accountId
          : undefined,
      dismissedAppIds: Array.isArray(value.dismissedAppIds)
        ? value.dismissedAppIds.filter(
            (id): id is string => typeof id === "string",
          )
        : [],
    };
  } catch {
    return { dismissedAppIds: [] };
  }
}

function writeSteamAutoAdd(record: SteamAutoAddRecord) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
  } catch {
    // Without storage the next start simply waits for another Steam import.
  }
}

/** A successful Steam import names the account and opts this PC in. */
export function rememberSteamImportAccount(accountId: number) {
  writeSteamAutoAdd({ ...readSteamAutoAdd(), accountId });
}

export function dismissSteamApps(appIds: readonly string[]) {
  const record = readSteamAutoAdd();
  const added = appIds.filter((id) => !record.dismissedAppIds.includes(id));
  if (added.length === 0) return;
  writeSteamAutoAdd({
    ...record,
    dismissedAppIds: [...record.dismissedAppIds, ...new Set(added)],
  });
}

/** Importing a game by hand takes back an earlier removal. */
export function undismissSteamApps(appIds: readonly string[]) {
  const record = readSteamAutoAdd();
  const dismissedAppIds = record.dismissedAppIds.filter(
    (id) => !appIds.includes(id),
  );
  if (dismissedAppIds.length === record.dismissedAppIds.length) return;
  writeSteamAutoAdd({ ...record, dismissedAppIds });
}

/** Forgetting all Steam data also stops adding games until the next import. */
export function forgetSteamAutoAdd() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing stored means nothing to forget.
  }
}
