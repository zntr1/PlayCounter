import { invoke } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import {
  AUTOMATIC_BACKUP_STORAGE_KEY,
  stopAutomaticBackupsForReset,
  useAutomaticBackupStore,
} from "./automaticBackups";
import { suspendPersistenceForReset } from "./persistence";
import { stopTrackerForReset } from "./tracker";

let resetInFlight: Promise<void> | null = null;

/** Call only after the user confirms the destructive reset. */
export function resetLocalData(): Promise<void> {
  if (resetInFlight) return resetInFlight;
  suspendPersistenceForReset();
  const operation = (async () => {
    await Promise.all([stopAutomaticBackupsForReset(), stopTrackerForReset()]);
    const backupPreferences = {
      ...useAutomaticBackupStore.getState().preferences,
      // Keep recovery files available: a fresh empty snapshot must not rotate
      // away a pre-reset backup on the next startup.
      enabled: false,
    };
    await invoke("reset_local_data");
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem(
      AUTOMATIC_BACKUP_STORAGE_KEY,
      JSON.stringify(backupPreferences),
    );
    await relaunch();
  })();
  resetInFlight = operation.finally(() => {
    resetInFlight = null;
  });
  return resetInFlight;
}
