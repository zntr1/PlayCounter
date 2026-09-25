/**
 * Machine-local state for watched folders, kept out of backups like launch
 * paths: the folders themselves, the game folders already handled, finds
 * waiting in Discovered, and game folders the user dismissed for good.
 */
const STORAGE_KEY = "playcounter.watchFolders";

/** A game folder whose executable waits in Discovered for a game. */
export type PendingFolderFind = {
  exePath: string;
  folderPath: string;
  folderName: string;
};

/** A game folder the user dismissed by ignoring its file in Discovered. */
export type DismissedFolder = { folderPath: string; exeName: string };

export type WatchFolderRecord = {
  folders: string[];
  /** Lowercased game folder paths that need no second look. */
  seen: string[];
  /** Keyed by lowercased executable name, like the exe cache. */
  pending: Record<string, PendingFolderFind>;
  dismissed: DismissedFolder[];
};

const EMPTY: WatchFolderRecord = {
  folders: [],
  seen: [],
  pending: {},
  dismissed: [],
};

const strings = (value: unknown) =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];

export function readWatchFolders(): WatchFolderRecord {
  try {
    const parsed: unknown = JSON.parse(
      localStorage.getItem(STORAGE_KEY) ?? "{}",
    );
    const value =
      parsed && typeof parsed === "object"
        ? (parsed as Partial<WatchFolderRecord>)
        : {};
    const pending: Record<string, PendingFolderFind> = {};
    if (value.pending && typeof value.pending === "object") {
      for (const [key, find] of Object.entries(value.pending)) {
        if (
          find &&
          typeof find.exePath === "string" &&
          typeof find.folderPath === "string" &&
          typeof find.folderName === "string"
        ) {
          pending[key] = find;
        }
      }
    }
    return {
      folders: strings(value.folders),
      seen: strings(value.seen),
      pending,
      dismissed: Array.isArray(value.dismissed)
        ? value.dismissed.filter(
            (item): item is DismissedFolder =>
              Boolean(item) &&
              typeof item.folderPath === "string" &&
              typeof item.exeName === "string",
          )
        : [],
    };
  } catch {
    return structuredClone(EMPTY);
  }
}

export function writeWatchFolders(record: WatchFolderRecord) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
  } catch {
    // Without storage the folders are simply looked at again next time.
  }
}

export function updateWatchFolders(
  change: (record: WatchFolderRecord) => WatchFolderRecord,
) {
  const next = change(readWatchFolders());
  writeWatchFolders(next);
  return next;
}

function isInside(path: string, folder: string) {
  const lowerPath = path.toLowerCase();
  const lowerFolder = folder.toLowerCase().replace(/[\\/]+$/, "");
  return (
    lowerPath === lowerFolder ||
    lowerPath.startsWith(`${lowerFolder}\\`) ||
    lowerPath.startsWith(`${lowerFolder}/`)
  );
}

export function addWatchFolder(folder: string) {
  return updateWatchFolders((record) =>
    record.folders.some((item) => item.toLowerCase() === folder.toLowerCase())
      ? record
      : { ...record, folders: [...record.folders, folder] },
  );
}

/** Games already added stay in the library; everything else is forgotten. */
export function removeWatchFolder(folder: string) {
  return updateWatchFolders((record) => ({
    folders: record.folders.filter(
      (item) => item.toLowerCase() !== folder.toLowerCase(),
    ),
    seen: record.seen.filter((path) => !isInside(path, folder)),
    pending: Object.fromEntries(
      Object.entries(record.pending).filter(
        ([, find]) => !isInside(find.folderPath, folder),
      ),
    ),
    dismissed: record.dismissed.filter(
      (item) => !isInside(item.folderPath, folder),
    ),
  }));
}

/** A dismissed game folder is looked at again on the next check. */
export function restoreDismissedFolder(folderPath: string) {
  return updateWatchFolders((record) => ({
    ...record,
    seen: record.seen.filter((path) => path !== folderPath.toLowerCase()),
    dismissed: record.dismissed.filter(
      (item) => item.folderPath.toLowerCase() !== folderPath.toLowerCase(),
    ),
  }));
}

export function pendingFolderFind(exeName: string) {
  return readWatchFolders().pending[exeName.toLowerCase()];
}
