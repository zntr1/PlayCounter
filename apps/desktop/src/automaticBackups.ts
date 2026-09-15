import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { createBackupContents, createTransferData } from "./backup";
import { validateBackupData } from "./backupValidation";
import { createPersistedPayload } from "./persistence";
import { useAppStore } from "./store";

// Machine-local preferences live outside the transferable app data. Restoring
// a backup must never enable a schedule or replace this PC's chosen folder.
export const AUTOMATIC_BACKUP_STORAGE_KEY = "playcounter:automatic-backups:v1";
const DAY_MS = 24 * 60 * 60 * 1000;
const RETRY_DELAY_MS = 15 * 60 * 1000;

export type AutomaticBackupPreferences = {
  enabled: boolean;
  interval: "daily" | "weekly";
  directory: string | null;
  keepCount: number;
  lastBackupAt: string | null;
  lastBackupPath: string | null;
};

type BackupResult = { path: string; cleanupWarning: string | null };

const defaultPreferences: AutomaticBackupPreferences = {
  enabled: true,
  interval: "weekly",
  directory: null,
  keepCount: 5,
  lastBackupAt: null,
  lastBackupPath: null,
};

export const useAutomaticBackupStore = create<{
  preferences: AutomaticBackupPreferences;
  defaultDirectory: string | null;
  loaded: boolean;
  running: boolean;
  error: string | null;
  retryAt: number | null;
  cleanupWarning: string | null;
}>(() => ({
  preferences: defaultPreferences,
  defaultDirectory: null,
  loaded: false,
  running: false,
  error: null,
  retryAt: null,
  cleanupWarning: null,
}));

export function nextAutomaticBackupAt(preferences: AutomaticBackupPreferences) {
  if (!preferences.lastBackupAt) return null;
  const last = Date.parse(preferences.lastBackupAt);
  if (!Number.isFinite(last)) return null;
  return last + (preferences.interval === "weekly" ? 7 : 1) * DAY_MS;
}

export function isAutomaticBackupDue(
  preferences: AutomaticBackupPreferences,
  now = Date.now(),
) {
  if (!preferences.enabled) return false;
  const next = nextAutomaticBackupAt(preferences);
  return (
    next === null ||
    now >= next ||
    // Recover when the system clock was ahead during the last backup.
    Date.parse(preferences.lastBackupAt!) > now
  );
}

function readPreferences(): AutomaticBackupPreferences {
  const raw = localStorage.getItem(AUTOMATIC_BACKUP_STORAGE_KEY);
  if (!raw) return { ...defaultPreferences };
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Saved automatic backup settings could not be read.");
  }
  const saved = value as Record<string, unknown>;
  return {
    enabled:
      typeof saved.enabled === "boolean"
        ? saved.enabled
        : defaultPreferences.enabled,
    interval:
      saved.interval === "daily" || saved.interval === "weekly"
        ? saved.interval
        : defaultPreferences.interval,
    directory:
      typeof saved.directory === "string" && saved.directory.trim()
        ? saved.directory
        : null,
    keepCount:
      Number.isInteger(saved.keepCount) &&
      Number(saved.keepCount) >= 1 &&
      Number(saved.keepCount) <= 100
        ? Number(saved.keepCount)
        : defaultPreferences.keepCount,
    lastBackupAt:
      typeof saved.lastBackupAt === "string" &&
      Number.isFinite(Date.parse(saved.lastBackupAt))
        ? saved.lastBackupAt
        : null,
    lastBackupPath:
      typeof saved.lastBackupPath === "string" ? saved.lastBackupPath : null,
  };
}

function persistPreferences(preferences: AutomaticBackupPreferences) {
  localStorage.setItem(
    AUTOMATIC_BACKUP_STORAGE_KEY,
    JSON.stringify(preferences),
  );
}

let inFlight: Promise<BackupResult | null> | null = null;
let retryAfter = 0;
let stopScheduler: (() => void) | null = null;

export function setAutomaticBackupPreferences(
  patch: Partial<
    Pick<
      AutomaticBackupPreferences,
      "enabled" | "interval" | "directory" | "keepCount"
    >
  >,
) {
  const current = useAutomaticBackupStore.getState().preferences;
  const preferences = { ...current, ...patch };
  if (preferences.directory !== current.directory) {
    preferences.lastBackupAt = null;
    preferences.lastBackupPath = null;
  }
  try {
    persistPreferences(preferences);
    useAutomaticBackupStore.setState({
      preferences,
      error: null,
      retryAt: null,
      cleanupWarning: null,
    });
    retryAfter = 0;
    if (stopScheduler) void runAutomaticBackup();
  } catch (error) {
    useAutomaticBackupStore.setState({
      error: `Could not save backup settings: ${formatError(error)}`,
    });
  }
}

/** Called once after app data hydrates. Checks also catch up after sleep. */
export function initializeAutomaticBackups() {
  if (stopScheduler) return;
  if (!useAutomaticBackupStore.getState().loaded) {
    try {
      useAutomaticBackupStore.setState({
        preferences: readPreferences(),
        loaded: true,
      });
    } catch (error) {
      useAutomaticBackupStore.setState({
        // Unreadable preferences may contain an explicit opt-out or a custom
        // destination. Wait for the user to save their settings again.
        preferences: { ...defaultPreferences, enabled: false },
        loaded: true,
        error: formatError(error),
      });
    }
  }
  const check = () => void runAutomaticBackup();
  const onVisible = () => {
    if (document.visibilityState === "visible") check();
  };
  const timer = window.setInterval(check, 60_000);
  window.addEventListener("focus", check);
  document.addEventListener("visibilitychange", onVisible);
  stopScheduler = () => {
    window.clearInterval(timer);
    window.removeEventListener("focus", check);
    document.removeEventListener("visibilitychange", onVisible);
  };
  void invoke<string>("default_backup_directory").then(
    (defaultDirectory) =>
      useAutomaticBackupStore.setState({ defaultDirectory }),
    () => undefined, // The writer still resolves the default folder natively.
  );
  check();
}

export function disposeAutomaticBackups() {
  stopScheduler?.();
  stopScheduler = null;
}

/** Manual and scheduled snapshots share a lock and the same retention limit. */
export function runAutomaticBackup(
  force = false,
): Promise<BackupResult | null> {
  if (inFlight) return inFlight;
  const { preferences, loaded } = useAutomaticBackupStore.getState();
  if (
    !loaded ||
    (!force && (!isAutomaticBackupDue(preferences) || Date.now() < retryAfter))
  ) {
    return Promise.resolve(null);
  }
  useAutomaticBackupStore.setState({
    running: true,
    error: null,
    retryAt: null,
  });
  const operation = Promise.resolve()
    .then(async () => {
      try {
        // Use current durable state, including edits whose localStorage save is
        // still queued. Runtime sessions and machine-local paths stay excluded.
        const source = createPersistedPayload(useAppStore.getState());
        validateBackupData(createTransferData(source), "data");
        const result = await invoke<BackupResult>("write_automatic_backup", {
          directory: preferences.directory,
          contents: createBackupContents(source),
          keepCount: preferences.keepCount,
        });
        retryAfter = 0;
        const current = useAutomaticBackupStore.getState().preferences;
        if (current.directory === preferences.directory) {
          const updated = {
            ...current,
            lastBackupAt: new Date().toISOString(),
            lastBackupPath: result.path,
          };
          useAutomaticBackupStore.setState({
            preferences: updated,
            cleanupWarning: result.cleanupWarning,
          });
          try {
            persistPreferences(updated);
          } catch (error) {
            useAutomaticBackupStore.setState({
              error: `Backup saved, but its schedule could not be saved: ${formatError(error)}`,
            });
          }
        }
        return result;
      } catch (error) {
        retryAfter = Date.now() + RETRY_DELAY_MS;
        useAutomaticBackupStore.setState({
          error: formatError(error),
          retryAt: retryAfter,
        });
        return null;
      }
    })
    .finally(() => {
      inFlight = null;
      useAutomaticBackupStore.setState({ running: false });
    });
  inFlight = operation;
  return operation;
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
