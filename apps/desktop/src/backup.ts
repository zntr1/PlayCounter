import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";

const STORAGE_KEY = "playcounter:v1";
const BACKUP_FORMAT = "playcounter-backup";
const BACKUP_VERSION = 1;

type BackupEnvelope = {
  format: typeof BACKUP_FORMAT;
  version: number;
  app: "PlayCounter";
  exportedAt: string;
  data: Record<string, unknown>;
};

// Transient runtime state that only describes what was happening on the machine
// that produced the backup. Importing it would resurrect phantom "now playing"
// sessions on the target machine, so we drop it on import.
const TRANSIENT_KEYS = ["activeSessions", "activeSession", "ambiguousMatches"];

const JSON_FILTER = [{ name: "PlayCounter backup", extensions: ["json"] }];

function readPersistedRaw(): Record<string, unknown> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Record<
      string,
      unknown
    >;
  } catch {
    return {};
  }
}

function defaultExportName() {
  const stamp = new Date().toISOString().slice(0, 10);
  return `playcounter-backup-${stamp}.json`;
}

export type ExportResult = { path: string } | { cancelled: true };

export async function exportLocalData(): Promise<ExportResult> {
  const path = await save({
    defaultPath: defaultExportName(),
    filters: JSON_FILTER,
  });
  if (!path) return { cancelled: true };

  const envelope: BackupEnvelope = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    app: "PlayCounter",
    exportedAt: new Date().toISOString(),
    data: readPersistedRaw(),
  };

  await invoke("write_text_file", {
    path,
    contents: JSON.stringify(envelope, null, 2),
  });
  return { path };
}

export type ImportResult =
  | { cancelled: true }
  | { imported: true; backupPath: string | null; sessions: number };

function parseEnvelope(raw: string): BackupEnvelope["data"] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("The selected file is not valid JSON.");
  }

  if (
    !parsed ||
    typeof parsed !== "object" ||
    (parsed as { format?: unknown }).format !== BACKUP_FORMAT ||
    typeof (parsed as { data?: unknown }).data !== "object" ||
    (parsed as { data?: unknown }).data === null
  ) {
    throw new Error("This is not a PlayCounter backup file.");
  }

  return (parsed as BackupEnvelope).data;
}

/**
 * Replaces all local data with the contents of a chosen backup file. Before
 * overwriting, the current local data is written to a timestamped backup file
 * under the app data directory so an accidental import can be undone. The
 * imported install UUID is carried over so the new machine reports as the same
 * install. Reloads the window afterward so the tracker re-hydrates cleanly.
 */
export async function importLocalData(): Promise<ImportResult> {
  const path = await open({ multiple: false, filters: JSON_FILTER });
  if (!path || typeof path !== "string") return { cancelled: true };

  const raw = await invoke<string>("read_text_file", { path });
  const data = parseEnvelope(raw);

  for (const key of TRANSIENT_KEYS) delete data[key];

  const existing = localStorage.getItem(STORAGE_KEY);
  let backupPath: string | null = null;
  if (existing) {
    const envelope: BackupEnvelope = {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      app: "PlayCounter",
      exportedAt: new Date().toISOString(),
      data: readPersistedRaw(),
    };
    backupPath = await invoke<string>("backup_local_data", {
      contents: JSON.stringify(envelope, null, 2),
    });
  }

  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));

  const sessions = Array.isArray(data.sessions) ? data.sessions.length : 0;
  // Re-hydrate the whole app from the freshly written storage.
  window.location.reload();
  return { imported: true, backupPath, sessions };
}
