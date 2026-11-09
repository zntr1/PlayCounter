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
import { Button, Select, Switch } from "./primitives";
import { formatNumericDateTime, getT } from "../i18n";
import {
  Segmented,
  SettingsRow,
  type SettingsRowProps,
} from "./views/settings/SettingsKit";

const t = getT("settings");

/** The automatic-backup rows of Backup & transfer. */
export function AutomaticBackupSettings({
  level = 0,
  disabled = false,
}: Partial<SettingsRowProps>) {
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
  const busy = disabled || !loaded || running || folderBusy;
  const nextAt = nextAutomaticBackupAt(preferences);

  async function chooseFolder() {
    setFolderBusy(true);
    setFolderError(null);
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: t("Choose automatic backup folder"),
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
    <>
      <SettingsRow
        id="automaticBackups"
        dataTour="settings-backup-automatic"
        level={level}
        disabled={disabled}
        title={t("Automatic backups")}
        description={
          <span id="automatic-backups-description">
            {t(
              "Save a backup on a schedule while PlayCounter is running, even when it is only in the tray. A missed backup is saved the next time you open the app.",
            )}
          </span>
        }
        control={
          <Switch
            data-tour="settings-backup-enabled"
            aria-label={t("Automatic backups")}
            aria-describedby="automatic-backups-description"
            checked={preferences.enabled}
            disabled={busy}
            onChange={(event) =>
              setAutomaticBackupPreferences({ enabled: event.target.checked })
            }
          />
        }
      />
      <SettingsRow
        id="backupSchedule"
        dataTour="settings-backup-schedule"
        level={level}
        disabled={disabled}
        title={t("Schedule")}
        control={
          <Segmented
            dataTour="settings-backup-interval"
            label={t("Schedule")}
            value={preferences.interval}
            disabled={busy}
            options={[
              { value: "daily", label: t("Daily") },
              { value: "weekly", label: t("Weekly") },
            ]}
            onChange={(interval) => setAutomaticBackupPreferences({ interval })}
          />
        }
      />
      <SettingsRow
        id="backupKeep"
        level={level}
        disabled={disabled}
        title={t("Keep")}
        description={t(
          "After a new backup is saved, older automatic backups beyond the Keep limit are deleted from this folder. To restore a backup, use Import data below.",
        )}
        control={
          <Select
            data-tour="settings-backup-keep"
            aria-label={t("Keep")}
            value={preferences.keepCount}
            disabled={busy}
            onChange={(event) =>
              setAutomaticBackupPreferences({
                keepCount: Number(event.target.value),
              })
            }
          >
            {[...new Set([5, 10, 30, preferences.keepCount])]
              .sort((a, b) => a - b)
              .map((count) => (
                <option key={count} value={count}>
                  {t("Last {{count}} backups", { count })}
                </option>
              ))}
          </Select>
        }
      />
      <SettingsRow
        id="backupFolder"
        dataTour="settings-backup-folder"
        level={level}
        disabled={disabled}
        title={
          preferences.directory
            ? t("Backup folder")
            : t("Backup folder · App data (default)")
        }
        below={
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-bg/35 py-1.5 pl-3 pr-1.5">
            <span className="min-w-0 flex-1 select-all break-all font-mono text-xs text-text-muted">
              {directory ?? t("App data / backups / automatic")}
            </span>
            <div className="flex flex-wrap gap-1.5">
              <Button
                data-tour="settings-backup-choose-folder"
                className="h-[30px] px-2.5 text-[13px]"
                disabled={busy}
                onClick={() => void chooseFolder()}
              >
                {t("Choose folder")}
              </Button>
              <Button
                data-tour="settings-backup-open-folder"
                icon={FolderOpen}
                className="h-[30px] px-2.5 text-[13px]"
                disabled={busy}
                onClick={() => void openFolder()}
              >
                {t("Open folder")}
              </Button>
              {preferences.directory ? (
                <Button
                  icon={RotateCcw}
                  className="h-[30px] px-2.5 text-[13px]"
                  disabled={busy}
                  onClick={() => {
                    setFolderError(null);
                    setAutomaticBackupPreferences({ directory: null });
                  }}
                >
                  {t("Use app data")}
                </Button>
              ) : null}
            </div>
          </div>
        }
      />
      <SettingsRow
        id="backupNow"
        level={level}
        disabled={disabled}
        title={
          <span role="status">
            {running
              ? t("Saving backup…")
              : preferences.lastBackupAt
                ? t("Last backup: {{date}}", {
                    date: formatNumericDateTime(preferences.lastBackupAt),
                  })
                : t("No automatic backups saved yet.")}
          </span>
        }
        description={
          preferences.enabled && !running && !error
            ? nextAt && nextAt > Date.now()
              ? t("Next backup: {{date}}", {
                  date: formatNumericDateTime(nextAt),
                })
              : t("Next backup: as soon as PlayCounter is running.")
            : undefined
        }
        control={
          <Button
            data-tour="settings-backup-now"
            icon={Download}
            loading={running}
            disabled={busy}
            onClick={() =>
              void runAutomaticBackup(true).then((result) => {
                if (result)
                  addToast({
                    tone: "success",
                    title: t("Backup saved"),
                    detail: result.path,
                  });
              })
            }
          >
            {t("Back up now")}
          </Button>
        }
        below={
          error || folderError || cleanupWarning ? (
            <div className="grid gap-1 text-xs">
              {error ? (
                <p className="break-words text-danger">
                  {preferences.enabled && retryAt
                    ? t(
                        "Backup error: {{error}} PlayCounter tries again in 15 minutes. You can also click Back up now.",
                        { error },
                      )
                    : t("Backup error: {{error}}", { error })}
                </p>
              ) : null}
              {folderError ? (
                <p className="break-words text-danger">
                  {t("Folder unavailable: {{folderError}}", { folderError })}
                </p>
              ) : null}
              {cleanupWarning ? (
                <p className="break-words text-warning">
                  {t(
                    "Backup saved, but older backups could not be removed: {{cleanupWarning}}",
                    { cleanupWarning },
                  )}
                </p>
              ) : null}
            </div>
          ) : null
        }
      />
    </>
  );
}
