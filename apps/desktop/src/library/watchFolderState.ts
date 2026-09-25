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

/**
 * What a look at a game folder found. A game folder is looked at again when
 * its game file lost its launch path, for example after an update renamed it.
 */
export type SeenFolder =
  | { kind: "game"; exeName: string }
  | { kind: "discovered"; exeName: string }
  | { kind: "empty" };

export type WatchFolderRecord = {
  folders: string[];
  /** Keyed by lowercased game folder path. */
  seen: Record<string, SeenFolder>;
  /** Keyed by lowercased executable name, like the exe cache. */
  pending: Record<string, PendingFolderFind>;
  dismissed: DismissedFolder[];
};

const EMPTY: WatchFolderRecord = {
  folders: [],
  seen: {},
  pending: {},
  dismissed: [],
};

const strings = (value: unknown) =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];

function readSeen(value: unknown): Record<string, SeenFolder> {
  // Early builds kept a plain list; those folders get one more look.
  if (Array.isArray(value)) {
    return Object.fromEntries(
      strings(value).map((path) => [path, { kind: "game", exeName: "" }]),
    );
  }
  const seen: Record<string, SeenFolder> = {};
  if (value && typeof value === "object") {
    for (const [path, entry] of Object.entries(value)) {
      const kind = (entry as Partial<SeenFolder> | null)?.kind;
      const exeName = (entry as { exeName?: unknown } | null)?.exeName;
      if (kind === "empty") seen[path] = { kind };
      else if (
        (kind === "game" || kind === "discovered") &&
        typeof exeName === "string"
      ) {
        seen[path] = { kind, exeName };
      }
    }
  }
  return seen;
}

export function readWatchFolders(): WatchFolderRecord {
  try {
    const parsed: unknown = JSON.parse(
      localStorage.getItem(STORAGE_KEY) ?? "{}",
    );
    const value =
      parsed && typeof parsed === "object"
        ? (parsed as Record<string, unknown>)
        : {};
    const pending: Record<string, PendingFolderFind> = {};
    if (value.pending && typeof value.pending === "object") {
      for (const [key, find] of Object.entries(
        value.pending as Record<string, Partial<PendingFolderFind>>,
      )) {
        if (
          find &&
          typeof find.exePath === "string" &&
          typeof find.folderPath === "string" &&
          typeof find.folderName === "string"
        ) {
          pending[key] = find as PendingFolderFind;
        }
      }
    }
    return {
      folders: strings(value.folders),
      seen: readSeen(value.seen),
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

export function isInsideFolder(path: string, folder: string) {
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
    seen: Object.fromEntries(
      Object.entries(record.seen).filter(
        ([path]) => !isInsideFolder(path, folder),
      ),
    ),
    pending: Object.fromEntries(
      Object.entries(record.pending).filter(
        ([, find]) => !isInsideFolder(find.folderPath, folder),
      ),
    ),
    dismissed: record.dismissed.filter(
      (item) => !isInsideFolder(item.folderPath, folder),
    ),
  }));
}

/** A dismissed game folder is looked at again on the next check. */
export function restoreDismissedFolder(folderPath: string) {
  const key = folderPath.toLowerCase();
  return updateWatchFolders((record) => ({
    ...record,
    seen: Object.fromEntries(
      Object.entries(record.seen).filter(([path]) => path !== key),
    ),
    dismissed: record.dismissed.filter(
      (item) => item.folderPath.toLowerCase() !== key,
    ),
  }));
}

export function pendingFolderFind(exeName: string) {
  return readWatchFolders().pending[exeName.toLowerCase()];
}
