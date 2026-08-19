import {
  AlertTriangle,
  Download,
  FolderOpen,
  RotateCcw,
  Upload,
} from "lucide-react";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { useEffect, useState } from "react";
import {
  clearLocalCache,
  openUserIgnoredProcessesFolder,
  reloadIgnoredProcesses,
  setEmulatorIgnored,
} from "../../tracker";
import { emulatorAssetUrls } from "../../emulators/assets";
import { adapterFor } from "../../emulators/registry";
import { exportLocalData, importLocalData } from "../../backup";
import { useAppStore, useIsOffline } from "../../store";
import {
  checkForUpdate,
  installAvailableUpdate,
  type InstallProgress,
  type UpdateCheckResult,
} from "../../updater";
import { Panel } from "../components";
import { Button, useEscapeKey } from "../primitives";
import { DEFAULT_ACCENT_COLOR } from "../../theme";
import { currentPlatform } from "../../platform";
import { previewDesktopOverlay } from "../../desktopOverlayBridge";
import { TutorialSettingsPanel } from "../tour/TourUI";

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
  const [emulatorSyncing, setEmulatorSyncing] = useState<string | null>(null);
  const isOffline = useIsOffline();
  const settings = useAppStore((state) => state.settings);
  const setLaunchOnStartup = useAppStore((state) => state.setLaunchOnStartup);
  const setShowDurationDays = useAppStore((state) => state.setShowDurationDays);
  const setAutoShareIgnoredProcesses = useAppStore(
    (state) => state.setAutoShareIgnoredProcesses,
  );
  const setEmulatorSetting = useAppStore((state) => state.setEmulatorSetting);
  const setDesktopOverlaySetting = useAppStore(
    (state) => state.setDesktopOverlaySetting,
  );
  const setAccentColor = useAppStore((state) => state.setAccentColor);
  const knownEmulators = useAppStore((state) => state.knownEmulators);
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

  async function handleEmulatorIgnored(emulatorId: string, ignored: boolean) {
    setEmulatorSyncing(emulatorId);
    try {
      await setEmulatorIgnored(emulatorId, ignored);
      addToast({
        tone: "success",
        title: ignored ? "Emulator ignored" : "Emulator enabled",
        detail: ignored
          ? "PlayCounter will hide this emulator and stop detecting games inside it. Existing games and history are kept."
          : "PlayCounter will detect games inside this emulator again.",
      });
    } catch (error) {
      addToast({
        tone: "error",
        title: "Emulator setting failed",
        detail: formatError(error),
      });
    } finally {
      setEmulatorSyncing(null);
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
  const displayedEmulators = new Map(knownEmulators);
  for (const rawEmulatorId of settings.ignoredEmulatorIds ?? []) {
    const emulatorId = rawEmulatorId.trim().toLowerCase();
    if (!emulatorId || displayedEmulators.has(emulatorId)) continue;
    const adapter = adapterFor(emulatorId);
    displayedEmulators.set(emulatorId, {
      emulatorId,
      label: adapter?.label ?? emulatorId,
      firstSeenAt: "",
      lastSeenAt: "",
      hostExeNames: [],
    });
  }

  return (
    <div className="grid max-w-4xl gap-5">
      <SettingsPanel
        dataTour="settings-general"
        description="Control background behavior and how playtimes are shown."
        title="General"
      >
        <SettingsRow
          description="Strongly recommended. PlayCounter starts when you sign in so it can detect every game session; if disabled, tracking only works after you open the app manually."
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
        {!settings.launchOnStartup && !startupSyncing ? (
          <div className="flex items-start gap-3 rounded-lg border border-danger-border bg-danger-tint px-4 py-3 text-sm text-danger">
            <AlertTriangle size={18} className="mt-0.5 shrink-0" />
            <div>
              <div className="font-semibold">Auto-start is disabled</div>
              <p className="mt-1 leading-5">
                This is not recommended. PlayCounter cannot detect or record
                sessions until you open it manually.
              </p>
            </div>
          </div>
        ) : null}
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
        dataTour="settings-appearance"
        description="Personalize PlayCounter's interactive controls and highlights."
        title="Appearance"
      >
        <SettingsRow
          description="Choose an accent color. PlayCounter adjusts it automatically for readable contrast in both themes."
          title="Accent color"
        >
          <div className="flex items-center gap-2">
            <input
              type="color"
              aria-label="Choose accent color"
              value={settings.accentColor ?? DEFAULT_ACCENT_COLOR}
              onChange={(event) => setAccentColor(event.target.value)}
              className="h-9 w-11 cursor-pointer rounded-md border border-border bg-surface p-1"
            />
            <span className="w-[4.5rem] font-mono text-xs text-text-muted">
              {settings.accentColor ?? DEFAULT_ACCENT_COLOR}
            </span>
            <Button
              variant="ghost"
              disabled={!settings.accentColor}
              onClick={() => setAccentColor(null)}
            >
              Reset
            </Button>
          </div>
        </SettingsRow>
      </SettingsPanel>

      {currentPlatform() !== "macos" ? (
        <SettingsPanel
          dataTour="settings-notifications"
          description="Short popups on your desktop while you play. They disappear on their own."
          title="Desktop popups"
        >
          <SettingsRow
            description="Works even when PlayCounter is only running in the tray."
            title="Show desktop popups"
          >
            <input
              type="checkbox"
              checked={settings.desktopOverlaysEnabled === true}
              onChange={(event) =>
                setDesktopOverlaySetting(
                  "desktopOverlaysEnabled",
                  event.target.checked,
                )
              }
              className="h-5 w-5 accent-accent"
            />
          </SettingsRow>
          <p className="-mt-3 text-xs text-text-faint">
            Popups stay hidden while the PlayCounter window is open and focused.
          </p>
          <SettingsRow
            description="Popup when PlayCounter recognizes a game for the first time."
            title="First-time detections"
          >
            <input
              type="checkbox"
              checked={settings.overlayFirstDetections !== false}
              disabled={settings.desktopOverlaysEnabled !== true}
              onChange={(event) =>
                setDesktopOverlaySetting(
                  "overlayFirstDetections",
                  event.target.checked,
                )
              }
              className="h-5 w-5 accent-accent disabled:opacity-50"
            />
          </SettingsRow>
          <SettingsRow
            description="Popup each time tracking starts."
            title="Every game start"
          >
            <input
              type="checkbox"
              checked={settings.overlaySessionStarts === true}
              disabled={settings.desktopOverlaysEnabled !== true}
              onChange={(event) =>
                setDesktopOverlaySetting(
                  "overlaySessionStarts",
                  event.target.checked,
                )
              }
              className="h-5 w-5 accent-accent disabled:opacity-50"
            />
          </SettingsRow>
          <SettingsRow
            description="Popup after sessions of 10 minutes or more."
            title="Session summaries"
          >
            <input
              type="checkbox"
              checked={settings.overlaySessionSummaries !== false}
              disabled={settings.desktopOverlaysEnabled !== true}
              onChange={(event) =>
                setDesktopOverlaySetting(
                  "overlaySessionSummaries",
                  event.target.checked,
                )
              }
              className="h-5 w-5 accent-accent disabled:opacity-50"
            />
          </SettingsRow>
          <SettingsRow
            description="Popup when you unlock a new playtime milestone."
            title="Milestones"
          >
            <input
              type="checkbox"
              checked={settings.overlayMilestones !== false}
              disabled={settings.desktopOverlaysEnabled !== true}
              onChange={(event) =>
                setDesktopOverlaySetting(
                  "overlayMilestones",
                  event.target.checked,
                )
              }
              className="h-5 w-5 accent-accent disabled:opacity-50"
            />
          </SettingsRow>
          <SettingsRow
            description="Popup when PlayCounter finds an app it does not know. Only apps found while this is on are included."
            title="New discoveries"
          >
            <input
              type="checkbox"
              checked={settings.overlayDiscoveries === true}
              disabled={settings.desktopOverlaysEnabled !== true}
              onChange={(event) =>
                setDesktopOverlaySetting(
                  "overlayDiscoveries",
                  event.target.checked,
                )
              }
              className="h-5 w-5 accent-accent disabled:opacity-50"
            />
          </SettingsRow>
          {settings.desktopOverlaysEnabled === true ? (
            <div className="flex justify-end border-t border-border pt-4">
              <Button variant="secondary" onClick={previewDesktopOverlay}>
                Preview popup
              </Button>
            </div>
          ) : null}
        </SettingsPanel>
      ) : null}

      <SettingsPanel
        dataTour="settings-emulators"
        description="Detect the game running inside a supported emulator, including DOSBox and Dolphin."
        title="Emulators"
      >
        <SettingsRow
          description="Reads the emulator's window title and start-up options on this PC to work out which game is loaded. Full paths and window titles never leave your PC."
          title="Detect emulator games"
        >
          <input
            type="checkbox"
            checked={settings.emulatorDetection ?? true}
            onChange={(event) =>
              setEmulatorSetting("emulatorDetection", event.target.checked)
            }
            className="h-5 w-5 accent-accent"
          />
        </SettingsRow>
        <SettingsRow
          description="Sends the recognized game name or disc ID (such as a DOSBox program or a Dolphin disc file) to look it up in the database. Folder paths and unclear window titles stay on this PC."
          title="Look up recognized content"
        >
          <input
            type="checkbox"
            checked={settings.emulatorContentLookup ?? true}
            disabled={!(settings.emulatorDetection ?? true)}
            onChange={(event) =>
              setEmulatorSetting("emulatorContentLookup", event.target.checked)
            }
            className="h-5 w-5 accent-accent disabled:opacity-50"
          />
        </SettingsRow>
        {displayedEmulators.size > 0 ? (
          <div className="grid gap-3 border-t border-border pt-5">
            <div>
              <h3 className="font-medium text-text">Detected emulators</h3>
              <p className="mt-1 text-sm text-text-muted">
                Ignored emulators are hidden and no games inside them are
                tracked. Existing games, mappings, and history are preserved.
              </p>
            </div>
            {[...displayedEmulators.values()].map((emulator) => {
              const ignored = (settings.ignoredEmulatorIds ?? []).some(
                (id) => id.toLowerCase() === emulator.emulatorId.toLowerCase(),
              );
              const imageSrc = emulatorAssetUrls[emulator.emulatorId];
              return (
                <div
                  key={emulator.emulatorId}
                  className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-border bg-bg/60 p-4"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    {imageSrc ? (
                      <img
                        src={imageSrc}
                        alt=""
                        className="h-10 w-10 shrink-0 rounded-md object-cover"
                      />
                    ) : null}
                    <div className="min-w-0">
                      <div className="font-medium text-text">
                        {emulator.label}
                      </div>
                      <div className="truncate text-xs text-text-faint">
                        {ignored
                          ? "Ignored and hidden"
                          : emulator.hostExeNames.join(", ") || "Enabled"}
                      </div>
                    </div>
                  </div>
                  <Button
                    variant={ignored ? "primary" : "secondary"}
                    loading={emulatorSyncing === emulator.emulatorId}
                    disabled={
                      emulatorSyncing !== null ||
                      !(settings.emulatorDetection ?? true)
                    }
                    onClick={() =>
                      void handleEmulatorIgnored(emulator.emulatorId, !ignored)
                    }
                  >
                    {ignored ? "Enable" : "Ignore"}
                  </Button>
                </div>
              );
            })}
          </div>
        ) : null}
      </SettingsPanel>

      <SettingsPanel
        description="Tune how PlayCounter finds apps and retries unknown ones."
        title="Discovery"
      >
        <SettingsRow
          dataTour="settings-sharing"
          description="When you ignore an app PlayCounter does not recognize, it sends the file name, your platform, and an anonymous install ID. Playtime and game history are never sent."
          title="Share apps you ignore"
        >
          <input
            type="checkbox"
            checked={settings.autoShareIgnoredProcesses}
            onChange={(event) =>
              setAutoShareIgnoredProcesses(event.target.checked)
            }
            className="h-5 w-5 accent-accent"
          />
        </SettingsRow>
        <SettingsRow
          description="Apps in this list are skipped before PlayCounter tries to match them. Built-in system defaults plus your own file."
          title="Ignored apps"
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
                  title: "Ignore list reloaded",
                  detail: "PlayCounter read the list again and rescanned.",
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
        dataTour="settings-backup"
        description="Move your play history and game cache to another PC. Backups are plain JSON files."
        title="Backup & transfer"
      >
        <SettingsRow
          dataTour="settings-backup-export"
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
          dataTour="settings-backup-import"
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
        dataTour="settings-maintenance"
        description="Manual recovery actions for stale local tracking state."
        title="Maintenance"
      >
        <SettingsRow
          description="Clears cached matches and errors. Your play history is not deleted."
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
        description="Tutorials and task guides are available from the Help menu in the top-right corner."
        title="Help & tutorials"
      >
        <TutorialSettingsPanel />
      </SettingsPanel>

      <SettingsPanel
        dataTour="settings-updates"
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
              detail: "Cached matches were cleared.",
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
  dataTour,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  dataTour?: string;
}) {
  return (
    <Panel dataTour={dataTour} className="overflow-hidden">
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
  dataTour,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  className?: string;
  dataTour?: string;
}) {
  return (
    <div
      data-tour={dataTour}
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
  useEscapeKey(onCancel);
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
  useEscapeKey(onCancel);
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
