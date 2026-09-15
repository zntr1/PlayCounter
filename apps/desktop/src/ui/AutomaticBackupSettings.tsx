import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { Download, FolderOpen, RotateCcw } from "lucide-react";
import { useState } from "react";
import {
  nextAutomaticBackupAt,
  runAutomaticBackup,
  setAutomaticBackupPreferences,
  useAutomaticBackupStore,
} from "../automaticBackups";
import { useAppStore } from "../store";
import { Button, selectClass } from "./primitives";

export function AutomaticBackupSettings() {
  const {
    preferences,
    defaultDirectory,
    loaded,
    running,
    error,
    retryAt,
    cleanupWarning,
  } = useAutomaticBackupStore();
  const [folderBusy, setFolderBusy] = useState(false);
  const [folderError, setFolderError] = useState<string | null>(null);
  const addToast = useAppStore((state) => state.addToast);
  const directory = preferences.directory ?? defaultDirectory;
  const busy = !loaded || running || folderBusy;
  const nextAt = nextAutomaticBackupAt(preferences);

  async function chooseFolder() {
    setFolderBusy(true);
    setFolderError(null);
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Choose automatic backup folder",
        ...(directory ? { defaultPath: directory } : {}),
      });
      if (typeof selected === "string") {
        setAutomaticBackupPreferences({ directory: selected });
      }
    } catch (error) {
      setFolderError(String(error));
    } finally {
      setFolderBusy(false);
    }
  }

  async function openFolder() {
    setFolderBusy(true);
    setFolderError(null);
    try {
      await invoke("open_backup_directory", {
        directory: preferences.directory,
      });
    } catch (error) {
      setFolderError(String(error));
    } finally {
      setFolderBusy(false);
    }
  }

  return (
    <div
      data-tour="settings-backup-automatic"
      className="grid gap-4 border-b border-border pb-5"
    >
      <div className="flex items-start justify-between gap-5">
        <div className="min-w-0">
          <h3 className="font-medium text-text">Automatic backups</h3>
          <p
            id="automatic-backups-description"
            className="mt-1 text-sm text-text-muted"
          >
            Save scheduled snapshots while PlayCounter is running, including in
            the tray. Missed backups run the next time you open the app.
          </p>
        </div>
        <input
          type="checkbox"
          aria-label="Automatic backups"
          aria-describedby="automatic-backups-description"
          checked={preferences.enabled}
          disabled={busy}
          onChange={(event) =>
            setAutomaticBackupPreferences({ enabled: event.target.checked })
          }
          className="mt-1 h-4 w-4 shrink-0 accent-accent disabled:opacity-50"
        />
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1.5 text-sm text-text-muted">
          Schedule
          <select
            value={preferences.interval}
            disabled={busy}
            onChange={(event) =>
              setAutomaticBackupPreferences({
                interval: event.target.value as "daily" | "weekly",
              })
            }
            className={`${selectClass} disabled:opacity-50`}
          >
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
          </select>
        </label>
        <label className="grid gap-1.5 text-sm text-text-muted">
          Keep
          <select
            value={preferences.keepCount}
            disabled={busy}
            onChange={(event) =>
              setAutomaticBackupPreferences({
                keepCount: Number(event.target.value),
              })
            }
            className={`${selectClass} disabled:opacity-50`}
          >
            {[...new Set([5, 10, 30, preferences.keepCount])]
              .sort((a, b) => a - b)
              .map((count) => (
                <option key={count} value={count}>
                  Last {count} backups
                </option>
              ))}
          </select>
        </label>
        <Button
          icon={Download}
          loading={running}
          disabled={busy}
          onClick={() =>
            void runAutomaticBackup(true).then((result) => {
              if (result)
                addToast({
                  tone: "success",
                  title: "Backup saved",
                  detail: result.path,
                });
            })
          }
        >
          Back up now
        </Button>
      </div>
      <div className="min-w-0 rounded-md border border-border bg-surface px-3 py-3">
        <p className="text-sm text-text-muted">
          {preferences.directory
            ? "Backup folder"
            : "Backup folder · App data (default)"}
        </p>
        <p className="mt-1 select-all break-all text-sm text-text">
          {directory ?? "App data / backups / automatic"}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button disabled={busy} onClick={() => void chooseFolder()}>
            Choose folder
          </Button>
          <Button
            icon={FolderOpen}
            disabled={busy}
            onClick={() => void openFolder()}
          >
            Open folder
          </Button>
          {preferences.directory ? (
            <Button
              icon={RotateCcw}
              disabled={busy}
              onClick={() => {
                setFolderError(null);
                setAutomaticBackupPreferences({ directory: null });
              }}
            >
              Use app data
            </Button>
          ) : null}
        </div>
      </div>
      <div role="status" className="grid gap-1 text-xs text-text-muted">
        <p>
          {running
            ? "Saving backup…"
            : preferences.lastBackupAt
              ? `Last backup: ${new Date(preferences.lastBackupAt).toLocaleString()}`
              : "No automatic backups saved yet."}
        </p>
        {preferences.enabled && !running && !error ? (
          <p>
            {nextAt && nextAt > Date.now()
              ? `Next backup: ${new Date(nextAt).toLocaleString()}`
              : "Next backup: as soon as PlayCounter is running."}
          </p>
        ) : null}
        <p>
          Older automatic snapshots in this folder are removed after a new
          backup succeeds. Restore a snapshot with Import data below.
        </p>
        {error ? (
          <p className="break-words text-danger">
            Backup error: {error}
            {preferences.enabled && retryAt
              ? " Automatic backups retry in 15 minutes; you can also use Back up now."
              : ""}
          </p>
        ) : null}
        {folderError ? (
          <p className="break-words text-danger">
            Folder unavailable: {folderError}
          </p>
        ) : null}
        {cleanupWarning ? (
          <p className="break-words text-warning">
            Backup saved, but older snapshots could not be removed:{" "}
            {cleanupWarning}
          </p>
        ) : null}
      </div>
    </div>
  );
}
