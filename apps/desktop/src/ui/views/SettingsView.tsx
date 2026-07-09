import { Download, FolderOpen, RotateCcw, Upload } from "lucide-react";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { useEffect, useState } from "react";
import {
  clearLocalCache,
  openUserIgnoredProcessesFolder,
  reloadIgnoredProcesses,
} from "../../tracker";
import { exportLocalData, importLocalData } from "../../backup";
import { useAppStore, useIsOffline } from "../../store";
import {
  checkForUpdate,
  installAvailableUpdate,
  type InstallProgress,
  type UpdateCheckResult,
} from "../../updater";
import { Panel } from "../components";
import { Button } from "../primitives";

type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "current"
  | "installing"
  | "error";

export function SettingsView() {
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>("idle");
  const [updateResult, setUpdateResult] = useState<UpdateCheckResult | null>(
    null,
  );
  const [installProgress, setInstallProgress] =
    useState<InstallProgress | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [startupSyncing, setStartupSyncing] = useState(false);
  const [startupError, setStartupError] = useState<string | null>(null);
  const [reloadingIgnored, setReloadingIgnored] = useState(false);
  const [confirmResetCache, setConfirmResetCache] = useState(false);
  const [confirmImport, setConfirmImport] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const isOffline = useIsOffline();
  const settings = useAppStore((state) => state.settings);
  const setLaunchOnStartup = useAppStore((state) => state.setLaunchOnStartup);
  const setShowDurationDays = useAppStore((state) => state.setShowDurationDays);
  const ignoredProcessCount = useAppStore(
    (state) => state.ignoredProcesses.size,
  );
  const userIgnoredProcessesPath = useAppStore(
    (state) => state.userIgnoredProcessesPath,
  );
  const addToast = useAppStore((state) => state.addToast);

  useEffect(() => {
    let cancelled = false;

    async function syncStartupState() {
      setStartupSyncing(true);
      setStartupError(null);
      try {
        const enabled = await isEnabled();
        if (!cancelled) setLaunchOnStartup(enabled);
      } catch (error) {
        if (!cancelled) setStartupError(formatError(error));
      } finally {
        if (!cancelled) setStartupSyncing(false);
      }
    }

    void syncStartupState();

    return () => {
      cancelled = true;
    };
  }, [setLaunchOnStartup]);

  async function handleLaunchOnStartupChange(enabled: boolean) {
    setStartupSyncing(true);
    setStartupError(null);

    try {
      if (enabled) await enable();
      else await disable();
      setLaunchOnStartup(enabled);
    } catch (error) {
      setStartupError(formatError(error));
    } finally {
      setStartupSyncing(false);
    }
  }

  async function handleCheckForUpdate() {
    setUpdateStatus("checking");
    setUpdateResult(null);
    setInstallProgress(null);
    setUpdateError(null);

    try {
      const result = await checkForUpdate();
      setUpdateResult(result);
      setUpdateStatus(result.status === "available" ? "available" : "current");
    } catch (error) {
      setUpdateError(formatError(error));
      setUpdateStatus("error");
    }
  }

  async function handleInstallUpdate() {
    setUpdateStatus("installing");
    setInstallProgress(null);
    setUpdateError(null);

    try {
      const installed = await installAvailableUpdate(setInstallProgress);
      if (!installed) {
        setUpdateResult({ status: "current" });
        setUpdateStatus("current");
      }
    } catch (error) {
      setUpdateError(formatError(error));
      setUpdateStatus("error");
    }
  }

  async function handleExport() {
    setExporting(true);
    try {
      const result = await exportLocalData();
      if ("cancelled" in result) return;
      addToast({
        tone: "success",
        title: "Backup exported",
        detail: result.path,
      });
    } catch (error) {
      addToast({
        tone: "error",
        title: "Export failed",
        detail: formatError(error),
      });
    } finally {
      setExporting(false);
    }
  }

  async function handleImport() {
    setImporting(true);
    try {
      const result = await importLocalData();
      if ("cancelled" in result) return;
      // On success the window reloads, so this toast is best-effort.
      addToast({
        tone: "success",
        title: "Backup imported",
        detail: `${result.sessions} sessions restored. Reloading…`,
      });
    } catch (error) {
      addToast({
        tone: "error",
        title: "Import failed",
        detail: formatError(error),
      });
    } finally {
      setImporting(false);
    }
  }

  const updateButtonDisabled =
    updateStatus === "checking" || updateStatus === "installing";
  const progressLabel = installProgress
    ? formatBytesProgress(installProgress)
    : null;

  return (
    <div className="grid max-w-4xl gap-5">
      <SettingsPanel
        description="Control background behavior and how playtimes are shown."
        title="General"
      >
        <SettingsRow
          description="Starts PlayCounter when you sign in and keeps it available from the tray."
          title="Launch on startup"
        >
          <input
            type="checkbox"
            checked={settings.launchOnStartup}
            disabled={startupSyncing}
            onChange={(event) =>
              void handleLaunchOnStartupChange(event.target.checked)
            }
            className="h-5 w-5 accent-accent disabled:opacity-50"
          />
        </SettingsRow>
        {startupError ? (
          <p className="break-words text-sm text-danger">{startupError}</p>
        ) : null}
        <SettingsRow
          description="Shows long playtimes as days and hours instead of total hours."
          title="Show days in playtime"
        >
          <input
            type="checkbox"
            checked={settings.showDurationDays}
            onChange={(event) => setShowDurationDays(event.target.checked)}
            className="h-5 w-5 accent-accent"
          />
        </SettingsRow>
      </SettingsPanel>

      <SettingsPanel
        description="Tune how PlayCounter discovers executables and retries unknown apps."
        title="Discovery"
      >
        <SettingsRow
          description="Built-in OS defaults and your user ignore file are skipped before matching."
          title="Ignored processes"
        >
          <Button
            icon={RotateCcw}
            loading={reloadingIgnored}
            onClick={async () => {
              setReloadingIgnored(true);
              try {
                await reloadIgnoredProcesses();
                addToast({
                  tone: "success",
                  title: "Ignored processes reloaded",
                  detail: "The process list was refreshed and scanned again.",
                });
              } catch (error) {
                addToast({
                  tone: "error",
                  title: "Reload failed",
                  detail: formatError(error),
                });
              } finally {
                setReloadingIgnored(false);
              }
            }}
          >
            Reload
          </Button>
        </SettingsRow>
        <div className="grid gap-2 text-sm">
          <div>
            <span className="font-medium">Loaded entries: </span>
            <span>{ignoredProcessCount}</span>
          </div>
          <div className="grid gap-1">
            <span className="font-medium">User file</span>
            <div className="flex items-start gap-3">
              <span className="min-w-0 flex-1 break-all font-mono text-xs text-text-faint">
                {userIgnoredProcessesPath ?? "Unavailable"}
              </span>
              <Button
                icon={FolderOpen}
                disabled={!userIgnoredProcessesPath}
                onClick={() =>
                  void openUserIgnoredProcessesFolder().catch((error) =>
                    addToast({
                      tone: "error",
                      title: "Folder unavailable",
                      detail: formatError(error),
                    }),
                  )
                }
              >
                Folder
              </Button>
            </div>
          </div>
        </div>
      </SettingsPanel>

      <SettingsPanel
        description="Manual recovery actions for stale local tracking state."
        title="Maintenance"
      >
        <SettingsRow
          description="Clears cached executable matches and errors. Your play history is not deleted."
          title="Reset local cache"
        >
          <div className="flex shrink-0 justify-end">
            <Button variant="danger" onClick={() => setConfirmResetCache(true)}>
              Reset cache
            </Button>
          </div>
        </SettingsRow>
      </SettingsPanel>

      <SettingsPanel
        description="Move your play history and game cache to another PC. Backups are plain JSON files."
        title="Backup & transfer"
      >
        <SettingsRow
          description="Save all local data (play history, game cache, settings) to a JSON file you can copy to another PC."
          title="Export data"
        >
          <div className="flex shrink-0 justify-end">
            <Button
              icon={Download}
              loading={exporting}
              onClick={() => void handleExport()}
            >
              Export
            </Button>
          </div>
        </SettingsRow>
        <SettingsRow
          description="Replace all local data with a backup file. Your current data is backed up automatically first."
          title="Import data"
        >
          <div className="flex shrink-0 justify-end">
            <Button
              icon={Upload}
              loading={importing}
              onClick={() => setConfirmImport(true)}
            >
              Import
            </Button>
          </div>
        </SettingsRow>
      </SettingsPanel>

      <SettingsPanel
        description="Check and install updates from the configured release feed."
        title="Updates"
      >
        <div className="flex items-start justify-between gap-5">
          <div className="min-w-0">
            <h3 className="font-medium text-text">App updates</h3>
            <p className="mt-1 text-sm text-text-muted">
              Check for a new PlayCounter version immediately.
            </p>
            <p className="mt-2 text-sm text-text-muted">
              {isOffline
                ? "Update checks unavailable offline."
                : formatUpdateStatus(updateStatus, updateResult, progressLabel)}
            </p>
            {updateError ? (
              <p className="mt-2 break-words text-sm text-danger">
                {updateError}
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 gap-2">
            {updateStatus === "available" || updateStatus === "installing" ? (
              <Button
                variant="primary"
                icon={Download}
                loading={updateStatus === "installing"}
                onClick={() => void handleInstallUpdate()}
                disabled={updateButtonDisabled || isOffline}
              >
                {updateStatus === "installing" ? "Installing…" : "Install"}
              </Button>
            ) : null}
            <Button
              icon={RotateCcw}
              loading={updateStatus === "checking"}
              onClick={() => void handleCheckForUpdate()}
              disabled={updateButtonDisabled || isOffline}
              title={
                isOffline ? "Update checks unavailable offline" : undefined
              }
            >
              Check
            </Button>
          </div>
        </div>
      </SettingsPanel>
      {confirmImport ? (
        <ImportDataDialog
          onCancel={() => setConfirmImport(false)}
          onConfirm={() => {
            setConfirmImport(false);
            void handleImport();
          }}
        />
      ) : null}
      {confirmResetCache ? (
        <ResetCacheDialog
          onCancel={() => setConfirmResetCache(false)}
          onConfirm={() => {
            clearLocalCache();
            setConfirmResetCache(false);
            addToast({
              tone: "success",
              title: "Local cache reset",
              detail: "Cached executable matches were cleared.",
            });
          }}
        />
      ) : null}
    </div>
  );
}

function SettingsPanel({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Panel className="overflow-hidden">
      <div className="border-b border-border px-5 py-4">
        <h2 className="font-semibold text-text">{title}</h2>
        <p className="mt-1 text-sm text-text-muted">{description}</p>
      </div>
      <div className="grid gap-5 p-5">{children}</div>
    </Panel>
  );
}

function SettingsRow({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex items-start justify-between gap-5 ${className ?? ""}`}
    >
      <div className="min-w-0">
        <h3 className="font-medium text-text">{title}</h3>
        <p className="mt-1 text-sm text-text-muted">{description}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function ResetCacheDialog({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 px-4">
      <div className="w-full max-w-md rounded-lg border border-border bg-surface p-5 shadow-raised">
        <h2 className="text-lg font-semibold text-text">Reset local cache?</h2>
        <p className="mt-2 text-sm text-text-muted">
          This clears cached executable matches and transient errors. Play
          history, settings, and ignored-process files stay intact.
        </p>
        <div className="mt-5 grid gap-2 sm:grid-cols-2">
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="danger" onClick={onConfirm}>
            Reset cache
          </Button>
        </div>
      </div>
    </div>
  );
}

function ImportDataDialog({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 px-4">
      <div className="w-full max-w-md rounded-lg border border-border bg-surface p-5 shadow-raised">
        <h2 className="text-lg font-semibold text-text">Import backup?</h2>
        <p className="mt-2 text-sm text-text-muted">
          This replaces your current play history, game cache, and settings with
          the contents of the backup file. Your current data is saved to a
          backup file first, and PlayCounter reloads when the import finishes.
        </p>
        <div className="mt-5 grid gap-2 sm:grid-cols-2">
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="secondary" onClick={onConfirm}>
            Choose file
          </Button>
        </div>
      </div>
    </div>
  );
}

function formatUpdateStatus(
  status: UpdateStatus,
  result: UpdateCheckResult | null,
  progressLabel: string | null,
) {
  if (status === "checking") return "Checking for updates...";
  if (status === "installing") {
    return progressLabel
      ? `Downloading and installing ${progressLabel}`
      : "Preparing update...";
  }
  if (status === "available" && result?.status === "available") {
    return `Version ${result.version} is available.`;
  }
  if (status === "current") return "PlayCounter is up to date.";
  if (status === "error") return "Update check failed.";
  return "No update check has run in this session.";
}

function formatBytesProgress(progress: InstallProgress) {
  const downloaded = formatBytes(progress.downloadedBytes);
  if (!progress.totalBytes) return downloaded;

  return `${downloaded} of ${formatBytes(progress.totalBytes)}`;
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
