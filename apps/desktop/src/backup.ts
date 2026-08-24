import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { open, save } from "@tauri-apps/plugin-dialog";
import type { Session } from "@playcounter/shared";
import {
  readPersistedRecord,
  STORAGE_KEY,
  writePersistedRecord,
} from "./persistence";
import {
  filterPersistableSessions,
  MAX_STORED_SESSIONS,
  normalizeSessions,
} from "./sessionPersistence";

const BACKUP_FORMAT = "playcounter-backup";
const BACKUP_VERSION = 2;

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
const DEVICE_LOCAL_KEYS = [
  "blacklist",
  "launchTargets",
  "manualLaunchTargets",
  "emulatorAutoBinaries",
  "emulatorManualBinaries",
  "emulatorAutoLaunchTargets",
  "emulatorManualLaunchTargets",
  "emulatorLaunchCandidates",
];
const NOTIFICATION_STATE_KEYS = [
  "notifications",
  "discoveredReviewReminder",
  "suppressStartupNotificationsOnce",
  "suppressContributionNotificationsOnce",
  "lastSeenReleaseNotesVersion",
];

const JSON_FILTER = [{ name: "PlayCounter backup", extensions: ["json"] }];

function readPersistedRaw(): Record<string, unknown> {
  return readPersistedRecord();
}

/**
 * Backups transfer durable user data, not machine-local ignore decisions or
 * notification delivery state. Achievement and contribution acknowledgement
 * markers remain in the payload so importing a current backup does not turn
 * already processed events into new ones.
 */
export function createTransferData(
  source: Record<string, unknown>,
): Record<string, unknown> {
  const data = { ...source };
  for (const key of TRANSIENT_KEYS) delete data[key];
  for (const key of DEVICE_LOCAL_KEYS) delete data[key];
  for (const key of NOTIFICATION_STATE_KEYS) delete data[key];

  if (Array.isArray(data.exeCache)) {
    data.exeCache = data.exeCache.filter(
      (value) =>
        !value ||
        typeof value !== "object" ||
        (value as { state?: unknown }).state !== "blacklisted",
    );
  }

  return data;
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
    data: createTransferData(readPersistedRaw()),
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

function parseEnvelope(raw: string): BackupEnvelope {
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
    typeof (parsed as { version?: unknown }).version !== "number" ||
    !Number.isInteger((parsed as { version: number }).version) ||
    (parsed as { version: number }).version < 1 ||
    typeof (parsed as { data?: unknown }).data !== "object" ||
    (parsed as { data?: unknown }).data === null ||
    Array.isArray((parsed as { data?: unknown }).data)
  ) {
    throw new Error("This is not a PlayCounter backup file.");
  }

  const envelope = parsed as BackupEnvelope;
  if (envelope.version > BACKUP_VERSION) {
    throw new Error(
      `This backup was created by a newer PlayCounter version (backup format ${envelope.version}). Update PlayCounter before importing it.`,
    );
  }

  return envelope;
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
  const envelope = parseEnvelope(raw);
  const data = createTransferData(envelope.data);
  data.notifications = [];
  data.discoveredReviewReminder = null;
  data.suppressStartupNotificationsOnce = true;
  data.suppressContributionNotificationsOnce = true;

  if (Array.isArray(data.sessions)) {
    const persistableCount = filterPersistableSessions(
      data.sessions as Session[],
    ).length;
    if (persistableCount > MAX_STORED_SESSIONS) {
      throw new Error(
        `This backup contains ${persistableCount} sessions, above this version's safe limit of ${MAX_STORED_SESSIONS}. No local data was changed.`,
      );
    }
  }

  const existing = localStorage.getItem(STORAGE_KEY);
  let backupPath: string | null = null;
  if (existing) {
    const envelope: BackupEnvelope = {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      app: "PlayCounter",
      exportedAt: new Date().toISOString(),
      data: createTransferData(readPersistedRaw()),
    };
    backupPath = await invoke<string>("backup_local_data", {
      contents: JSON.stringify(envelope, null, 2),
    });
  }

  if (Array.isArray(data.sessions)) {
    data.sessions = normalizeSessions(data.sessions as Session[]);
  }
  try {
    data.lastSeenReleaseNotesVersion = await getVersion();
  } catch {
    delete data.lastSeenReleaseNotesVersion;
  }
  writePersistedRecord(data);
  if (typeof data.installUuid === "string") {
    try {
      const installUuid = await invoke<string>("adopt_install_uuid", {
        value: data.installUuid,
      });
      data.installUuid = installUuid;
      data.contributionOwnerUuid = installUuid;
      writePersistedRecord(data);
    } catch (error) {
      if (existing === null) localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, existing);
      throw error;
    }
  }

  const sessions = Array.isArray(data.sessions) ? data.sessions.length : 0;
  // Re-hydrate the whole app from the freshly written storage.
  window.location.reload();
  return { imported: true, backupPath, sessions };
}
