/**
 * File names the admin panel marks "Per folder" (GET /api/identifiers/per-folder).
 * They count like the built-in shared names in exeCandidates.ts (Game.exe):
 * linked per folder, never by name, and never sent to the community.
 *
 * Saved on this PC and read when this module loads, so the list counts from
 * the first moment of a start, before anything is fetched: hydrate() drops
 * the folder ignores of names that are not shared. Not part of backups: it is
 * server data, fetched again at every start. "Reset local data" clears it.
 */
const STORAGE_KEY = "playcounter.perFolderFiles";

/** A file name the way the shared-name lists compare it: no ".exe", lower
 *  case, letters and digits only. */
export function exeBasename(exeName: string) {
  return exeName
    .replace(/\.exe$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** The server's file names, lower case with ".exe". */
let files: readonly string[] = readSaved();
let basenames = new Set(files.map(exeBasename));

function readSaved(): string[] {
  try {
    const parsed: unknown = JSON.parse(
      localStorage.getItem(STORAGE_KEY) ?? "[]",
    );
    return Array.isArray(parsed) ? validFiles(parsed) : [];
  } catch {
    return [];
  }
}

function validFiles(values: readonly unknown[]) {
  return [
    ...new Set(
      values.flatMap((value) =>
        typeof value === "string" && exeBasename(value)
          ? [value.toLowerCase()]
          : [],
      ),
    ),
  ];
}

export function isPerFolderBasename(basename: string) {
  return basenames.has(basename);
}

/**
 * Takes the server's list as it is: a name Phil removed stops counting. Saves
 * it and returns the names that are new, whose old name links have to move
 * to their folders.
 */
export function setPerFolderFiles(serverFiles: readonly unknown[]): string[] {
  const next = validFiles(serverFiles);
  const added = next.filter((file) => !basenames.has(exeBasename(file)));
  files = next;
  basenames = new Set(next.map(exeBasename));
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // The list still counts until the app closes, and comes back next start.
  }
  return added;
}
