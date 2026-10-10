import { LIBRARY_PROVIDER_LABELS } from "@playcounter/shared";
import {
  AlertTriangle,
  Download,
  FolderInput,
  FolderOpen,
  Gamepad2,
  Info,
  Moon,
  RotateCcw,
  Sun,
  Trash2,
  Upload,
} from "lucide-react";
import { getVersion } from "@tauri-apps/api/app";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { useEffect, useState } from "react";
import { Trans } from "react-i18next";
import { PlayCounterAnimatedIcon } from "../../brand/PlayCounterAnimatedIcon";
import type { LibraryProviderId } from "@playcounter/shared";
import {
  chooseEmulatorBinary,
  forgetImportedLibraryData,
  forgetEmulatorManualBinary,
  openUserIgnoredProcessesFolder,
  reloadIgnoredProcesses,
  setEmulatorIgnored,
} from "../../tracker";
import { emulatorAssetUrls } from "../../emulators/assets";
import { adapterFor, emulatorLabelList } from "../../emulators/registry";
import { exportLocalData, importLocalData } from "../../backup";
import { BUILD_STAGE, useAppStore, useIsOffline } from "../../store";
import {
  APP_LANGUAGES,
  LANGUAGE_NAMES,
  appLocale,
  isAppLanguage,
  systemLanguage,
  getT,
} from "../../i18n";
import { nativeText } from "../../nativeText";
import {
  checkForUpdate,
  installAvailableUpdate,
  type InstallProgress,
  type UpdateCheckResult,
} from "../../updater";
import { Panel, ProviderBadge } from "../components";
import { Button, Modal, Select, Switch } from "../primitives";
import {
  DEFAULT_CONTENT_SCALE,
  DEFAULT_MENU_SCALE,
  SCALE_OPTIONS,
  normalizeInterfaceScale,
} from "../../interfaceScale";
import { DEFAULT_ACCENT_COLOR } from "../../theme";
import { currentPlatform } from "../../platform";
import { previewDesktopOverlay } from "../../desktopOverlayBridge";
import { DesktopOverlayMonitorSelect } from "../DesktopOverlayMonitorSelect";
import { AutomaticBackupSettings } from "../AutomaticBackupSettings";
import { WatchFoldersSettings } from "../WatchFoldersSettings";
import { ResetPlayCounterDialog } from "../ResetPlayCounterDialog";
import { ResetSettingsDialog } from "../ResetSettingsDialog";
import { HotkeyInput } from "../HotkeyInput";
import type { DesktopOverlayKind } from "../../desktopOverlays";
import { TutorialSettingsPanel } from "../tour/TourUI";
import { ReleaseNotesDialog } from "../ReleaseNotesDialog";
import { resolveEmulatorBinary } from "../../emulatorLaunch";
import { launchFileBaseName } from "../../gameLaunch";
import {
  findReleaseNote,
  isEmptyDisplayNotes,
  parseManifestNotes,
} from "../../releaseNotes";

const t = getT("settings");

type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "current"
  | "installing"
  | "error";

type LaunchFileForgetScope = "executables" | "emulators" | "all";

function overlayPreviews(): ReadonlyArray<
  readonly [DesktopOverlayKind, string]
> {
  return [
    ["action-required", t("Choice required")],
    ["first-detection", t("First detection")],
    ["session-start", t("Game start")],
    ["session-summary", t("Session summary")],
    ["current-session", t("Current session")],
    ["milestone", t("Milestone")],
    ["discovery", t("Discovery")],
  ];
}

export function SettingsView() {
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>("idle");
  const [updateResult, setUpdateResult] = useState<UpdateCheckResult | null>(
    null,
  );
  const [installProgress, setInstallProgress] =
    useState<InstallProgress | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [uuidInfoOpen, setUuidInfoOpen] = useState(false);
  const [updateNotesOpen, setUpdateNotesOpen] = useState(false);
  const [startupSyncing, setStartupSyncing] = useState(false);
  const [startupError, setStartupError] = useState<string | null>(null);
  const [reloadingIgnored, setReloadingIgnored] = useState(false);
  const [confirmForgetLibrary, setConfirmForgetLibrary] =
    useState<LibraryProviderId | null>(null);
  const [confirmForgetLaunchFiles, setConfirmForgetLaunchFiles] =
    useState<LaunchFileForgetScope | null>(null);
  const [confirmImport, setConfirmImport] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmResetSettings, setConfirmResetSettings] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [emulatorSyncing, setEmulatorSyncing] = useState<string | null>(null);
  const isOffline = useIsOffline();
  const installUuid = useAppStore((state) => state.installUuid);
  const settings = useAppStore((state) => state.settings);
  const setLaunchOnStartup = useAppStore((state) => state.setLaunchOnStartup);
  const setStartView = useAppStore((state) => state.setStartView);
  const setLanguage = useAppStore((state) => state.setLanguage);
  const setShowDurationDays = useAppStore((state) => state.setShowDurationDays);
  const setShowInstallInSteam = useAppStore(
    (state) => state.setShowInstallInSteam,
  );
  const setShowAdultArt = useAppStore((state) => state.setShowAdultArt);
  const setAutoAddInstalledGames = useAppStore(
    (state) => state.setAutoAddInstalledGames,
  );
  const setTrackTools = useAppStore((state) => state.setTrackTools);
  const setAutoShareIgnoredProcesses = useAppStore(
    (state) => state.setAutoShareIgnoredProcesses,
  );
  const setEmulatorSetting = useAppStore((state) => state.setEmulatorSetting);
  const setDesktopOverlaySetting = useAppStore(
    (state) => state.setDesktopOverlaySetting,
  );
  const setLauncherSetting = useAppStore((state) => state.setLauncherSetting);
  const forgetExecutableLaunchTargets = useAppStore(
    (state) => state.forgetExecutableLaunchTargets,
  );
  const forgetEmulatorLaunchTargets = useAppStore(
    (state) => state.forgetEmulatorLaunchTargets,
  );
  const executableLaunchTargetCount = useAppStore(
    (state) => state.launchTargets.size + state.manualLaunchTargets.size,
  );
  const importedSteamCount = useAppStore((state) => {
    let count = 0;
    for (const entry of state.libraryImports.values()) {
      if (entry.provider === "steam") count += 1;
    }
    return count;
  });
  const importedXboxCount = useAppStore((state) => {
    let count = 0;
    for (const entry of state.libraryImports.values()) {
      if (entry.provider === "xbox") count += 1;
    }
    return count;
  });
  const importedBattleNetCount = useAppStore(
    (state) =>
      [...state.libraryImports.values()].filter(
        (entry) => entry.provider === "battlenet",
      ).length,
  );
  const importedEpicCount = useAppStore(
    (state) =>
      [...state.libraryImports.values()].filter(
        (entry) => entry.provider === "epic",
      ).length,
  );
  const forgetLibraryLabel = confirmForgetLibrary
    ? LIBRARY_PROVIDER_LABELS[confirmForgetLibrary]
    : "";
  const emulatorLaunchTargetCount = useAppStore(
    (state) =>
      state.emulatorAutoBinaries.size +
      state.emulatorManualBinaries.size +
      state.emulatorAutoLaunchTargets.size +
      state.emulatorManualLaunchTargets.size +
      state.emulatorLaunchCandidates.size,
  );
  const emulatorAutoBinaries = useAppStore(
    (state) => state.emulatorAutoBinaries,
  );
  const emulatorManualBinaries = useAppStore(
    (state) => state.emulatorManualBinaries,
  );
  const setTheme = useAppStore((state) => state.setTheme);
  const setAccentColor = useAppStore((state) => state.setAccentColor);
  const setInterfaceScale = useAppStore((state) => state.setInterfaceScale);
  const knownEmulators = useAppStore((state) => state.knownEmulators);
  const ignoredProcessCount = useAppStore(
    (state) => state.ignoredProcesses.size,
  );
  const userIgnoredProcessesPath = useAppStore(
    (state) => state.userIgnoredProcessesPath,
  );
  const addToast = useAppStore((state) => state.addToast);
  const openCurrentReleaseNotes = useAppStore(
    (state) => state.openCurrentReleaseNotes,
  );

  useEffect(() => {
    void getVersion()
      .then(setAppVersion)
      .catch(() => setAppVersion(null));
  }, []);

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
        title: ignored ? t("Emulator ignored") : t("Emulator enabled"),
        detail: ignored
          ? t(
              "PlayCounter will hide this emulator and stop detecting games inside it. Existing games and history are kept.",
            )
          : t("PlayCounter will detect games inside this emulator again."),
      });
    } catch (error) {
      addToast({
        tone: "error",
        title: t("Emulator setting failed"),
        detail: formatError(error),
      });
    } finally {
      setEmulatorSyncing(null);
    }
  }

  async function handleChooseEmulatorBinary(emulatorId: string) {
    try {
      const binary = await chooseEmulatorBinary(emulatorId);
      if (!binary) return;
      addToast({
        tone: "success",
        title: t("Emulator program saved"),
        detail: t(
          "{{launchFileBase}} can now be used to start emulator games.",
          { launchFileBase: launchFileBaseName(binary.exePath) },
        ),
      });
    } catch (error) {
      addToast({
        tone: "error",
        title: t("Emulator program not set"),
        detail: formatError(error),
      });
    }
  }

  function handleForgetEmulatorBinary(emulatorId: string, label: string) {
    forgetEmulatorManualBinary(emulatorId);
    addToast({
      tone: "info",
      title: t("Emulator program forgotten"),
      detail: t(
        "PlayCounter will learn {{label}} again when it sees it running.",
        { label },
      ),
    });
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
    setUpdateNotesOpen(false);
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
        title: t("Backup exported"),
        detail: result.path,
      });
    } catch (error) {
      addToast({
        tone: "error",
        title: t("Export failed"),
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
        title: t("Backup imported"),
        detail: t("{{sessions}} sessions restored. Reloading…", {
          sessions: result.sessions,
        }),
      });
    } catch (error) {
      addToast({
        tone: "error",
        title: t("Import failed"),
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
  const installedReleaseNote = findReleaseNote(appVersion);
  const availableDisplayNotes =
    updateResult?.status === "available"
      ? parseManifestNotes(updateResult.notes)
      : parseManifestNotes(null);
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
        description={t(
          "Control background behavior and how playtimes are shown.",
        )}
        title={t("General")}
      >
        <SettingsRow
          description={t(
            "Strongly recommended. PlayCounter starts when you sign in, so no game session is missed. If this is off, tracking only works after you open the app yourself.",
          )}
          title={t("Launch on startup")}
        >
          <Switch
            aria-label={t("Launch on startup")}
            checked={settings.launchOnStartup}
            disabled={startupSyncing}
            onChange={(event) =>
              void handleLaunchOnStartupChange(event.target.checked)
            }
          />
        </SettingsRow>
        {!settings.launchOnStartup && !startupSyncing ? (
          <div className="flex items-start gap-3 rounded-lg border border-danger-border bg-danger-tint px-4 py-3 text-sm text-danger">
            <AlertTriangle size={18} className="mt-0.5 shrink-0" />
            <div>
              <div className="font-semibold">{t("Auto-start is disabled")}</div>
              <p className="mt-1 leading-5">
                {t(
                  "This is not recommended. PlayCounter cannot detect or record sessions until you open it manually.",
                )}
              </p>
            </div>
          </div>
        ) : null}
        {startupError ? (
          <p className="break-words text-sm text-danger">{startupError}</p>
        ) : null}
        <SettingsRow
          description={t(
            "Shows long playtimes as days and hours instead of total hours.",
          )}
          title={t("Show days in playtime")}
        >
          <Switch
            aria-label={t("Show days in playtime")}
            checked={settings.showDurationDays}
            onChange={(event) => setShowDurationDays(event.target.checked)}
          />
        </SettingsRow>
        <SettingsRow
          description={t("The page PlayCounter shows when it opens.")}
          title={t("Start page")}
        >
          <Select
            aria-label={t("Start page")}
            value={settings.startView === "games" ? "games" : "now"}
            onChange={(event) =>
              setStartView(event.target.value === "games" ? "games" : "now")
            }
          >
            <option value="now">{t("Now Playing")}</option>
            <option value="games">{t("My Games")}</option>
          </Select>
        </SettingsRow>
        {/* Dev and test builds only until the first translation ships. */}
        {BUILD_STAGE !== "prod" ? (
          <SettingsRow
            description={t(
              "System uses your computer's language when PlayCounter has it, otherwise English.",
            )}
            title={t("Language")}
          >
            <Select
              aria-label={t("Language")}
              value={
                isAppLanguage(settings.language) ? settings.language : "system"
              }
              onChange={(event) =>
                setLanguage(
                  isAppLanguage(event.target.value)
                    ? event.target.value
                    : "system",
                )
              }
            >
              <option value="system">
                {t("System ({{language}})", {
                  language: LANGUAGE_NAMES[systemLanguage()],
                })}
              </option>
              {APP_LANGUAGES.map((language) => (
                <option key={language} value={language}>
                  {LANGUAGE_NAMES[language]}
                </option>
              ))}
            </Select>
          </SettingsRow>
        ) : null}
      </SettingsPanel>

      <SettingsPanel
        dataTour="settings-appearance"
        description={t(
          "Personalize PlayCounter's theme, colors, and interface size.",
        )}
        title={t("Appearance")}
      >
        <SettingsRow
          description={t("Choose a light or dark theme.")}
          title={t("Theme")}
        >
          <Button
            icon={settings.theme === "dark" ? Sun : Moon}
            onClick={() =>
              setTheme(settings.theme === "dark" ? "light" : "dark")
            }
          >
            {settings.theme === "dark"
              ? t("Switch to light theme")
              : t("Switch to dark theme")}
          </Button>
        </SettingsRow>
        <SettingsRow
          description={t(
            "Choose an accent color. PlayCounter adjusts it automatically for readable contrast in both themes.",
          )}
          title={t("Accent color")}
        >
          <div className="flex items-center gap-2">
            <input
              type="color"
              aria-label={t("Choose accent color")}
              value={settings.accentColor ?? DEFAULT_ACCENT_COLOR}
              onChange={(event) => setAccentColor(event.target.value)}
              className="pc-color-input h-9 w-11 cursor-pointer rounded-md border border-border bg-surface p-1 outline-none transition hover:border-text-faint focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30"
            />
            <span className="w-[4.5rem] font-mono text-xs text-text-muted">
              {settings.accentColor ?? DEFAULT_ACCENT_COLOR}
            </span>
            <Button
              variant="ghost"
              disabled={!settings.accentColor}
              onClick={() => setAccentColor(null)}
            >
              {t("Reset")}
            </Button>
          </div>
        </SettingsRow>
        <SettingsRow
          description={t(
            "Text, icons, covers and spacing in the main area scale together. Menus and dialogs keep their size.",
          )}
          title={t("Content size")}
        >
          <Select
            aria-label={t("Content size")}
            value={String(
              normalizeInterfaceScale(
                settings.contentScale,
                DEFAULT_CONTENT_SCALE,
              ),
            )}
            onChange={(event) =>
              setInterfaceScale("content", Number(event.target.value))
            }
          >
            {SCALE_OPTIONS.map((option) => (
              <option key={option.value} value={String(option.value)}>
                {option.label}
              </option>
            ))}
          </Select>
        </SettingsRow>
        <SettingsRow
          description={t(
            "The sidebar and the title bar with the search field.",
          )}
          title={t("Menu size")}
        >
          <Select
            aria-label={t("Menu size")}
            value={String(
              normalizeInterfaceScale(settings.menuScale, DEFAULT_MENU_SCALE),
            )}
            onChange={(event) =>
              setInterfaceScale("menu", Number(event.target.value))
            }
          >
            {SCALE_OPTIONS.map((option) => (
              <option key={option.value} value={String(option.value)}>
                {option.label}
              </option>
            ))}
          </Select>
        </SettingsRow>
        <SettingsRow
          description={t(
            "Include SteamGridDB artwork marked 18+ when you pick covers and banners. Art you share with the community always stays safe for work.",
          )}
          title={t("Show 18+ art")}
        >
          <Switch
            aria-label={t("Show 18+ art")}
            checked={settings.showAdultArt === true}
            onChange={(event) => setShowAdultArt(event.target.checked)}
          />
        </SettingsRow>
      </SettingsPanel>

      <SettingsPanel
        dataTour="settings-shortcuts"
        title={t("Keyboard shortcuts")}
        description={t(
          "Global hotkeys work while PlayCounter is running, including in the system tray.",
        )}
      >
        <SettingsRow
          title={t("Bring PlayCounter to front")}
          description={t("Show and focus PlayCounter from any app.")}
        >
          <HotkeyInput
            setting="showWindowHotkey"
            label={t("Bring PlayCounter to front")}
          />
        </SettingsRow>
        <SettingsRow
          title={t("Show current session time")}
          description={
            currentPlatform() === "macos"
              ? t("Desktop popups are not supported on macOS.")
              : t(
                  "Show a brief popup without leaving your game, even when automatic popups are off. Press again to cycle through active games. Uses the display selected under Desktop popups.",
                )
          }
        >
          <HotkeyInput
            setting="currentSessionHotkey"
            label={t("Show current session time")}
            disabled={currentPlatform() === "macos"}
          />
        </SettingsRow>
        {currentPlatform() !== "macos" ? (
          <SettingsRow
            title={t("Show clock in session popup")}
            description={t(
              "Add the time of day to the current session popup, handy in fullscreen games.",
            )}
          >
            <Switch
              aria-label={t("Show clock in session popup")}
              checked={settings.overlayShowClock === true}
              onChange={(event) =>
                setDesktopOverlaySetting(
                  "overlayShowClock",
                  event.target.checked,
                )
              }
            />
          </SettingsRow>
        ) : null}
      </SettingsPanel>

      {currentPlatform() !== "macos" ? (
        <SettingsPanel
          dataTour="settings-notifications"
          description={t(
            "Short popups on your desktop while you play. They disappear on their own.",
          )}
          title={t("Desktop popups")}
        >
          <SettingsRow
            description={t(
              "Show popups even while PlayCounter is open and focused, or running in the tray.",
            )}
            title={t("Show desktop popups")}
          >
            <Switch
              aria-label={t("Show desktop popups")}
              checked={settings.desktopOverlaysEnabled === true}
              onChange={(event) =>
                setDesktopOverlaySetting(
                  "desktopOverlaysEnabled",
                  event.target.checked,
                )
              }
            />
          </SettingsRow>
          <SettingsRow
            description={t(
              "Popups appear at the top right of this display. If it is disconnected, PlayCounter uses your primary monitor.",
            )}
            title={t("Popup monitor")}
          >
            <DesktopOverlayMonitorSelect />
          </SettingsRow>
          <SettingsRow
            description={t(
              "Popup when PlayCounter needs you to pick between possible games. Click it to open Now Playing.",
            )}
            title={t("Choices that need review")}
          >
            <Switch
              aria-label={t("Choices that need review")}
              checked={settings.overlayActionRequired !== false}
              disabled={settings.desktopOverlaysEnabled !== true}
              onChange={(event) =>
                setDesktopOverlaySetting(
                  "overlayActionRequired",
                  event.target.checked,
                )
              }
            />
          </SettingsRow>
          <SettingsRow
            description={t(
              "Popup when PlayCounter recognizes a game for the first time.",
            )}
            title={t("First-time detections")}
          >
            <Switch
              aria-label={t("First-time detections")}
              checked={settings.overlayFirstDetections !== false}
              disabled={settings.desktopOverlaysEnabled !== true}
              onChange={(event) =>
                setDesktopOverlaySetting(
                  "overlayFirstDetections",
                  event.target.checked,
                )
              }
            />
          </SettingsRow>
          <SettingsRow
            description={t("Popup each time tracking starts.")}
            title={t("Every game start")}
          >
            <Switch
              aria-label={t("Every game start")}
              checked={settings.overlaySessionStarts === true}
              disabled={settings.desktopOverlaysEnabled !== true}
              onChange={(event) =>
                setDesktopOverlaySetting(
                  "overlaySessionStarts",
                  event.target.checked,
                )
              }
            />
          </SettingsRow>
          <SettingsRow
            description={t("Popup after sessions of 10 minutes or more.")}
            title={t("Session summaries")}
          >
            <Switch
              aria-label={t("Session summaries")}
              checked={settings.overlaySessionSummaries !== false}
              disabled={settings.desktopOverlaysEnabled !== true}
              onChange={(event) =>
                setDesktopOverlaySetting(
                  "overlaySessionSummaries",
                  event.target.checked,
                )
              }
            />
          </SettingsRow>
          <SettingsRow
            description={t(
              "Show the playthrough name in game-start and saved-session popups.",
            )}
            title={t("Playthrough names in popups")}
          >
            <Switch
              aria-label={t("Playthrough names in popups")}
              checked={settings.overlayPlaythroughNames === true}
              disabled={settings.desktopOverlaysEnabled !== true}
              onChange={(event) =>
                setDesktopOverlaySetting(
                  "overlayPlaythroughNames",
                  event.target.checked,
                )
              }
            />
          </SettingsRow>
          <SettingsRow
            description={t(
              "Show the note of the game's active playthrough in the popup when a game starts.",
            )}
            title={t("Notes in game-start popups")}
          >
            <Switch
              aria-label={t("Notes in game-start popups")}
              checked={settings.overlayGameNotes === true}
              disabled={settings.desktopOverlaysEnabled !== true}
              onChange={(event) =>
                setDesktopOverlaySetting(
                  "overlayGameNotes",
                  event.target.checked,
                )
              }
            />
          </SettingsRow>
          <SettingsRow
            description={t(
              'Show an "Update note" button in saved-session popups.',
            )}
            title={t("Update note in popups")}
          >
            <Switch
              aria-label={t("Update note in popups")}
              checked={settings.overlayUpdateNote === true}
              disabled={settings.desktopOverlaysEnabled !== true}
              onChange={(event) =>
                setDesktopOverlaySetting(
                  "overlayUpdateNote",
                  event.target.checked,
                )
              }
            />
          </SettingsRow>
          <SettingsRow
            description={t("Popup when you unlock a new playtime milestone.")}
            title={t("Milestones")}
          >
            <Switch
              aria-label={t("Milestones")}
              checked={settings.overlayMilestones !== false}
              disabled={settings.desktopOverlaysEnabled !== true}
              onChange={(event) =>
                setDesktopOverlaySetting(
                  "overlayMilestones",
                  event.target.checked,
                )
              }
            />
          </SettingsRow>
          <SettingsRow
            description={t(
              "Popup when PlayCounter finds an app it does not know. Click it to open Discovered. Only apps found while this is on are included.",
            )}
            title={t("New discoveries")}
          >
            <Switch
              aria-label={t("New discoveries")}
              checked={settings.overlayDiscoveries === true}
              disabled={settings.desktopOverlaysEnabled !== true}
              onChange={(event) =>
                setDesktopOverlaySetting(
                  "overlayDiscoveries",
                  event.target.checked,
                )
              }
            />
          </SettingsRow>
          {settings.desktopOverlaysEnabled === true ? (
            <div className="border-t border-border pt-4">
              <p className="mb-2 text-xs text-text-faint">
                {t(
                  "Preview a popup with sample data. Works for every kind, even the ones switched off above.",
                )}
              </p>
              <div className="flex flex-wrap justify-end gap-2">
                {overlayPreviews().map(([kind, label]) => (
                  <Button
                    key={kind}
                    variant="secondary"
                    onClick={() => previewDesktopOverlay(kind)}
                  >
                    {label}
                  </Button>
                ))}
              </div>
            </div>
          ) : null}
        </SettingsPanel>
      ) : null}

      {currentPlatform() === "windows" ? (
        <SettingsPanel
          dataTour="settings-launcher"
          description={t(
            "Decide whether PlayCounter may remember game files on this PC, start games for you, and be steered with a controller.",
          )}
          title={t("Game launching")}
        >
          <SettingsRow
            description={t(
              "Keep the file paths of the games and emulators PlayCounter recognized on this PC. Turning this off deletes the saved paths and stops PlayCounter from learning new ones.",
            )}
            title={t("Remember launch paths")}
          >
            <Switch
              aria-label={t("Remember launch paths")}
              checked={settings.rememberLaunchPaths !== false}
              onChange={(event) => {
                if (event.target.checked) {
                  setLauncherSetting("rememberLaunchPaths", true);
                } else {
                  setConfirmForgetLaunchFiles("all");
                }
              }}
            />
          </SettingsRow>
          <SettingsRow
            description={t(
              "Show Play buttons in My Games and let PlayCounter start games for you. Needs remembered launch paths.",
            )}
            title={t("Launch games directly")}
          >
            <Switch
              data-tour="settings-launch-direct"
              aria-label={t("Launch games directly")}
              checked={settings.gameLaunchingEnabled === true}
              disabled={settings.rememberLaunchPaths === false}
              onChange={(event) =>
                setLauncherSetting("gameLaunchingEnabled", event.target.checked)
              }
            />
          </SettingsRow>
          <SettingsRow
            description={t(
              "Once a game you started from PlayCounter is running, PlayCounter moves to the tray to save resources. Needs direct game launching turned on.",
            )}
            title={t("Hide to tray when a game starts")}
          >
            <Switch
              aria-label={t("Hide to tray when a game starts")}
              checked={settings.hideToTrayOnGameStart !== false}
              disabled={settings.gameLaunchingEnabled !== true}
              onChange={(event) =>
                setLauncherSetting(
                  "hideToTrayOnGameStart",
                  event.target.checked,
                )
              }
            />
          </SettingsRow>

          <SettingsRow
            dataTour="settings-install-in-steam"
            description={t(
              "For imported Steam games that are no longer installed, show a button that opens Steam's installer where Play would be. Needs direct game launching turned on.",
            )}
            title={
              <span className="flex items-center gap-2">
                <ProviderBadge provider="steam" variant="mark" />
                {t("Show Install in Steam")}
              </span>
            }
          >
            <Switch
              aria-label={t("Show Install in Steam")}
              checked={settings.showInstallInSteam === true}
              disabled={settings.gameLaunchingEnabled !== true}
              onChange={(event) => setShowInstallInSteam(event.target.checked)}
            />
          </SettingsRow>

          <div className="rounded-lg border border-border bg-bg/40 px-4 py-3 text-xs leading-5 text-text-muted">
            {t(
              "PlayCounter starts the game file you picked directly, or hands a saved game file to a supported emulator. Games managed by a launcher, and games that ask for administrator rights, may still need their normal shortcut. Remembered paths stay on this device and are left out of backups.",
            )}
          </div>
          <SettingsRow
            description={t(
              "Move through PlayCounter with a controller. Needs direct game launching turned on.",
            )}
            title={
              <span className="flex items-center gap-2">
                <Gamepad2 size={17} className="text-accent-ink" />
                {t("Controller navigation")}
              </span>
            }
          >
            <Switch
              checked={settings.controllerNavigationEnabled === true}
              data-tour="settings-controller-navigation"
              aria-label={t("Controller navigation")}
              disabled={settings.gameLaunchingEnabled !== true}
              onChange={(event) =>
                setLauncherSetting(
                  "controllerNavigationEnabled",
                  event.target.checked,
                )
              }
            />
          </SettingsRow>
          <div className="grid gap-3 border-t border-border pt-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium text-text">
                  {t("Saved game files")}
                </div>
                <div className="mt-0.5 text-xs text-text-faint">
                  {t("{{count}} saved game file paths", {
                    count: executableLaunchTargetCount,
                  })}
                </div>
              </div>
              <Button
                variant="secondary"
                icon={Trash2}
                disabled={executableLaunchTargetCount === 0}
                onClick={() => setConfirmForgetLaunchFiles("executables")}
              >
                {t("Forget game files")}
              </Button>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/70 pt-3">
              <div>
                <div className="text-sm font-medium text-text">
                  {t("Emulator launch files")}
                </div>
                <div className="mt-0.5 text-xs text-text-faint">
                  {t("{{count}} saved emulator or content paths", {
                    count: emulatorLaunchTargetCount,
                  })}
                </div>
              </div>
              <Button
                variant="secondary"
                icon={Trash2}
                disabled={emulatorLaunchTargetCount === 0}
                onClick={() => setConfirmForgetLaunchFiles("emulators")}
              >
                {t("Forget emulator files")}
              </Button>
            </div>
          </div>
        </SettingsPanel>
      ) : null}

      <SettingsPanel
        dataTour="settings-emulators"
        description={t("Detect the game running inside {{emulators}}.", {
          emulators: emulatorLabelList("or"),
        })}
        title={t("Emulators")}
      >
        <SettingsRow
          description={t(
            "Reads the loaded game file, the window title, and the start-up options of the emulator on this PC to work out which game is running. Full paths and window titles never leave your PC.",
          )}
          title={t("Detect emulator games")}
        >
          <Switch
            aria-label={t("Detect emulator games")}
            checked={settings.emulatorDetection ?? true}
            onChange={(event) =>
              setEmulatorSetting("emulatorDetection", event.target.checked)
            }
          />
        </SettingsRow>
        <SettingsRow
          description={t(
            "Sends the recognized game file name or disc ID to look it up in the database. Folder paths and unclear window titles stay on this PC.",
          )}
          title={t("Look up recognized content")}
        >
          <Switch
            aria-label={t("Look up recognized content")}
            checked={settings.emulatorContentLookup ?? true}
            disabled={!(settings.emulatorDetection ?? true)}
            onChange={(event) =>
              setEmulatorSetting("emulatorContentLookup", event.target.checked)
            }
          />
        </SettingsRow>
        {displayedEmulators.size > 0 ? (
          <div className="grid gap-3 border-t border-border pt-5">
            <div>
              <h3 className="font-medium text-text">
                {t("Detected emulators")}
              </h3>
              <p className="mt-1 text-sm text-text-muted">
                {t(
                  "Ignored emulators are hidden and no games inside them are tracked. Existing games, mappings, and history are preserved.",
                )}
              </p>
            </div>
            {[...displayedEmulators.values()].map((emulator) => {
              const adapter = adapterFor(emulator.emulatorId);
              const ignored = (settings.ignoredEmulatorIds ?? []).some(
                (id) => id.toLowerCase() === emulator.emulatorId.toLowerCase(),
              );
              const imageSrc = emulatorAssetUrls[emulator.emulatorId];
              const binary = resolveEmulatorBinary(
                emulator.emulatorId,
                emulatorAutoBinaries,
                emulatorManualBinaries,
              );
              const hasManualBinary = emulatorManualBinaries.has(
                emulator.emulatorId,
              );
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
                          ? t("Ignored and hidden")
                          : emulator.hostExeNames.join(", ") || t("Enabled")}
                      </div>
                      {adapter?.launch ? (
                        <div
                          className="mt-1 truncate text-xs text-text-muted"
                          title={binary?.exePath}
                        >
                          {!binary
                            ? t("Launch program: not set")
                            : hasManualBinary
                              ? t("Launch program: {{file}} (selected)", {
                                  file: launchFileBaseName(binary.exePath),
                                })
                              : t("Launch program: {{file}} (detected)", {
                                  file: launchFileBaseName(binary.exePath),
                                })}
                        </div>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    {adapter?.launch ? (
                      <>
                        <Button
                          variant="secondary"
                          icon={FolderOpen}
                          onClick={() =>
                            void handleChooseEmulatorBinary(emulator.emulatorId)
                          }
                        >
                          {binary ? t("Change program") : t("Set program")}
                        </Button>
                        {hasManualBinary ? (
                          <Button
                            variant="secondary"
                            icon={RotateCcw}
                            onClick={() =>
                              handleForgetEmulatorBinary(
                                emulator.emulatorId,
                                emulator.label,
                              )
                            }
                          >
                            {t("Use detected")}
                          </Button>
                        ) : null}
                      </>
                    ) : null}
                    <Button
                      variant={ignored ? "primary" : "secondary"}
                      loading={emulatorSyncing === emulator.emulatorId}
                      disabled={
                        emulatorSyncing !== null ||
                        !(settings.emulatorDetection ?? true)
                      }
                      onClick={() =>
                        void handleEmulatorIgnored(
                          emulator.emulatorId,
                          !ignored,
                        )
                      }
                    >
                      {ignored ? t("Enable") : t("Ignore")}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}
      </SettingsPanel>

      <SettingsPanel
        description={t(
          "Tune how PlayCounter finds apps and retries unknown ones.",
        )}
        title={t("Discovery")}
      >
        <SettingsRow
          description={t(
            "Count how long apps like Discord, Spotify and launchers run, on their own Software page. They never appear in Now Playing and never count toward your game stats.",
          )}
          title={t("Track software")}
        >
          <Switch
            aria-label={t("Track software")}
            checked={settings.trackTools === true}
            onChange={(event) => setTrackTools(event.target.checked)}
          />
        </SettingsRow>
        <SettingsRow
          dataTour="settings-sharing"
          description={t(
            "When you ignore an app PlayCounter does not recognize, it sends the file name, your platform, and an anonymous install ID. Playtime and game history are never sent.",
          )}
          title={t("Share apps you ignore")}
        >
          <Switch
            aria-label={t("Share apps you ignore")}
            checked={settings.autoShareIgnoredProcesses}
            onChange={(event) =>
              setAutoShareIgnoredProcesses(event.target.checked)
            }
          />
        </SettingsRow>
        <SettingsRow
          description={t(
            "Apps in this list are never treated as games. It contains PlayCounter's built-in list of system apps plus the apps you ignored yourself.",
          )}
          title={t("Ignored apps")}
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
                  title: t("Ignore list reloaded"),
                  detail: t("PlayCounter read the list again and rescanned."),
                });
              } catch (error) {
                addToast({
                  tone: "error",
                  title: t("Reload failed"),
                  detail: formatError(error),
                });
              } finally {
                setReloadingIgnored(false);
              }
            }}
          >
            {t("Reload")}
          </Button>
        </SettingsRow>
        <div className="grid gap-2 text-sm">
          <div>
            <span className="font-medium">{t("Loaded entries:")} </span>
            <span>{ignoredProcessCount}</span>
          </div>
          <div className="grid gap-1">
            <span className="font-medium">{t("User file")}</span>
            <div className="flex items-start gap-3">
              <span className="min-w-0 flex-1 break-all font-mono text-xs text-text-faint">
                {userIgnoredProcessesPath ?? t("Unavailable")}
              </span>
              <Button
                icon={FolderOpen}
                disabled={!userIgnoredProcessesPath}
                onClick={() =>
                  void openUserIgnoredProcessesFolder().catch((error) =>
                    addToast({
                      tone: "error",
                      title: t("Folder unavailable"),
                      detail: formatError(error),
                    }),
                  )
                }
              >
                {t("Folder")}
              </Button>
            </div>
          </div>
        </div>
      </SettingsPanel>

      <SettingsPanel
        dataTour="settings-library-import"
        description={t(
          "Keep your launcher games up to date, or remove data imported from Steam, Xbox, Battle.net, or Epic Games. Install paths and the game files linked to them always stay on this PC.",
        )}
        title={t("Library import")}
      >
        {currentPlatform() === "windows" ? (
          <SettingsRow
            dataTour="settings-auto-add"
            description={t(
              "After your first import from Steam, Battle.net or Epic Games, games you install there show up in My Games on their own. Games you remove from PlayCounter are not added again. Xbox games still need an Xbox import, because Xbox does not tell PlayCounter which game an installation is.",
            )}
            title={t("Add new games automatically")}
          >
            <Switch
              aria-label={t("Add new games automatically")}
              checked={settings.autoAddInstalledGames !== false}
              onChange={(event) =>
                setAutoAddInstalledGames(event.target.checked)
              }
            />
          </SettingsRow>
        ) : null}
        {currentPlatform() === "windows" ? (
          <>
            <WatchFoldersSettings />
            <div role="separator" className="border-t border-border" />
          </>
        ) : null}
        <SettingsRow
          description={t(
            "Removes the Steam mark, the imported Steam playtime, the game files Steam linked, and where they are installed. Sessions PlayCounter recorded itself are kept.",
          )}
          title={
            <span className="flex items-center gap-2">
              <ProviderBadge provider="steam" variant="mark" />
              {t("Forget imported Steam data")}
            </span>
          }
        >
          <Button
            variant="danger"
            disabled={importedSteamCount === 0}
            onClick={() => setConfirmForgetLibrary("steam")}
          >
            {importedSteamCount
              ? t("Forget {{count}}", { count: importedSteamCount })
              : t("Forget all")}
          </Button>
        </SettingsRow>
        <SettingsRow
          description={t(
            "Removes the Xbox mark, the imported Xbox playtime, and the game files Xbox linked. Sessions PlayCounter recorded itself are kept.",
          )}
          title={
            <span className="flex items-center gap-2">
              <ProviderBadge provider="xbox" variant="mark" />
              {t("Forget imported Xbox data")}
            </span>
          }
        >
          <Button
            variant="danger"
            disabled={importedXboxCount === 0}
            onClick={() => setConfirmForgetLibrary("xbox")}
          >
            {importedXboxCount
              ? t("Forget {{count}}", { count: importedXboxCount })
              : t("Forget all")}
          </Button>
        </SettingsRow>
        <SettingsRow
          description={t(
            "Removes Battle.net imports and their installation links. Sessions PlayCounter recorded itself are kept.",
          )}
          title={
            <span className="flex items-center gap-2">
              <ProviderBadge provider="battlenet" variant="mark" />
              {t("Forget imported Battle.net data")}
            </span>
          }
        >
          <Button
            variant="danger"
            disabled={importedBattleNetCount === 0}
            onClick={() => setConfirmForgetLibrary("battlenet")}
          >
            {importedBattleNetCount
              ? t("Forget {{count}}", { count: importedBattleNetCount })
              : t("Forget all")}
          </Button>
        </SettingsRow>
        <SettingsRow
          description={t(
            "Removes the Epic Games mark, the imported Epic playtime, the game files Epic linked, and where they are installed. Sessions PlayCounter recorded itself are kept.",
          )}
          title={
            <span className="flex items-center gap-2">
              <ProviderBadge provider="epic" variant="mark" />
              {t("Forget imported Epic Games data")}
            </span>
          }
        >
          <Button
            variant="danger"
            disabled={importedEpicCount === 0}
            onClick={() => setConfirmForgetLibrary("epic")}
          >
            {importedEpicCount
              ? t("Forget {{count}}", { count: importedEpicCount })
              : t("Forget all")}
          </Button>
        </SettingsRow>
      </SettingsPanel>

      <SettingsPanel
        dataTour="settings-backup"
        description={t(
          "Protect your play history, notes, playthroughs, and shelves, or move them to another PC. Backups are plain JSON files.",
        )}
        title={t("Backup & transfer")}
      >
        <AutomaticBackupSettings />
        <SettingsRow
          dataTour="settings-backup-export"
          description={t(
            "Save your history, notes, playthroughs, shelves, game cache, and settings to a JSON file you can copy to another PC.",
          )}
          title={t("Export data")}
        >
          <div className="flex shrink-0 justify-end">
            <Button
              icon={Download}
              loading={exporting}
              onClick={() => void handleExport()}
            >
              {t("Export")}
            </Button>
          </div>
        </SettingsRow>
        <SettingsRow
          dataTour="settings-backup-import"
          description={t(
            "Replace all local data with a backup file. Your current data is backed up automatically first.",
          )}
          title={t("Import data")}
        >
          <div className="flex shrink-0 justify-end">
            <Button
              icon={Upload}
              loading={importing}
              onClick={() => setConfirmImport(true)}
            >
              {t("Import")}
            </Button>
          </div>
        </SettingsRow>
      </SettingsPanel>

      <SettingsPanel
        title={t("Reset")}
        description={t(
          "Restore default settings or start fresh. Existing backups are kept.",
        )}
      >
        <SettingsRow
          title={t("Restore default settings")}
          description={t(
            "Reset app preferences while keeping your games, play history, and backup preferences.",
          )}
        >
          <Button
            icon={RotateCcw}
            disabled={
              startupSyncing ||
              importing ||
              exporting ||
              updateStatus === "installing"
            }
            onClick={() => setConfirmResetSettings(true)}
          >
            {t("Reset settings")}
          </Button>
        </SettingsRow>
        <SettingsRow
          title={t("Start over")}
          description={t(
            "Clear your library, history, and app settings, then restart PlayCounter. Your backup files are preserved.",
          )}
        >
          <Button
            variant="danger"
            icon={Trash2}
            disabled={importing || exporting || updateStatus === "installing"}
            onClick={() => setConfirmReset(true)}
          >
            {t("Reset PlayCounter")}
          </Button>
        </SettingsRow>
      </SettingsPanel>

      <SettingsPanel
        description={t(
          "Tutorials and task guides are available from the Help menu in the top-right corner.",
        )}
        title={t("Help & tutorials")}
      >
        <TutorialSettingsPanel />
      </SettingsPanel>

      <SettingsPanel
        dataTour="settings-updates"
        description={t(
          "Check for a new version of PlayCounter and install it.",
        )}
        title={t("Updates")}
      >
        <SettingsRow
          title={t("Release notes")}
          description={t("See what changed in the version you're running.")}
        >
          <Button
            variant="secondary"
            disabled={!installedReleaseNote}
            title={
              installedReleaseNote
                ? undefined
                : t("No release notes for this version")
            }
            onClick={openCurrentReleaseNotes}
          >
            {t("View")}
          </Button>
        </SettingsRow>
        <div className="flex items-start justify-between gap-5">
          <div className="min-w-0">
            <h3 className="font-medium text-text">{t("App updates")}</h3>
            <p className="mt-1 text-sm text-text-muted">
              {t("Check for a new PlayCounter version immediately.")}
            </p>
            <div
              className="mt-2 flex items-center gap-3 text-sm text-text-muted"
              role="status"
              aria-live="polite"
              aria-atomic="true"
            >
              {updateButtonDisabled ? (
                <PlayCounterAnimatedIcon size={40} />
              ) : null}
              <span>
                {isOffline && !updateButtonDisabled
                  ? t("Update checks unavailable offline.")
                  : formatUpdateStatus(
                      updateStatus,
                      updateResult,
                      progressLabel,
                    )}
              </span>
            </div>
            {updateError ? (
              <p className="mt-2 break-words text-sm text-danger">
                {updateError}
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 gap-2">
            {updateResult?.status === "available" &&
            !isEmptyDisplayNotes(availableDisplayNotes) ? (
              <Button
                variant="secondary"
                onClick={() => setUpdateNotesOpen(true)}
                disabled={updateStatus === "installing"}
              >
                {t("What's new")}
              </Button>
            ) : null}
            {updateStatus === "available" || updateStatus === "installing" ? (
              <Button
                variant="primary"
                icon={updateStatus === "installing" ? undefined : Download}
                aria-busy={updateStatus === "installing"}
                onClick={() => void handleInstallUpdate()}
                disabled={updateButtonDisabled || isOffline}
              >
                {updateStatus === "installing"
                  ? t("Installing…")
                  : t("Install")}
              </Button>
            ) : null}
            <Button
              icon={updateStatus === "checking" ? undefined : RotateCcw}
              aria-busy={updateStatus === "checking"}
              onClick={() => void handleCheckForUpdate()}
              disabled={updateButtonDisabled || isOffline}
              title={
                isOffline ? t("Update checks unavailable offline") : undefined
              }
            >
              {updateStatus === "checking" ? t("Checking…") : t("Check")}
            </Button>
          </div>
        </div>
      </SettingsPanel>
      {installUuid ? (
        <div className="flex items-center gap-1.5 px-1 text-xs text-text-muted">
          <p className="min-w-0">
            <Trans
              t={t}
              i18nKey="User UUID: <uuid>{{uuid}}</uuid>"
              values={{ uuid: installUuid }}
              components={{
                uuid: <span className="select-all break-all font-mono" />,
              }}
            />
          </p>
          <div
            className="relative shrink-0"
            onMouseEnter={() => setUuidInfoOpen(true)}
            onMouseLeave={() => setUuidInfoOpen(false)}
            onFocus={() => setUuidInfoOpen(true)}
            onBlur={() => setUuidInfoOpen(false)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setUuidInfoOpen(false);
            }}
          >
            <button
              type="button"
              aria-label={t("About your user UUID")}
              aria-describedby={uuidInfoOpen ? "user-uuid-info" : undefined}
              className="flex rounded p-1 transition-colors hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <Info size={14} aria-hidden="true" />
            </button>
            {uuidInfoOpen ? (
              <div className="absolute bottom-full right-0 z-10 w-64 max-w-[calc(100vw-2rem)] pb-2">
                <p
                  id="user-uuid-info"
                  role="tooltip"
                  className="rounded-md border border-border bg-surface px-3 py-2 leading-relaxed text-text shadow-raised"
                >
                  {t(
                    "A random ID that recognizes your installation without an account. Used to count active installations and link your community suggestions and reports.",
                  )}
                </p>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
      {updateNotesOpen && updateResult?.status === "available" ? (
        <ReleaseNotesDialog
          version={updateResult.version}
          eyebrow={t("Update available")}
          sections={[
            {
              version: updateResult.version,
              notes: availableDisplayNotes,
            },
          ]}
          onClose={() => setUpdateNotesOpen(false)}
          footer={
            <div className="flex justify-end">
              <Button
                variant="primary"
                icon={Download}
                loading={updateStatus === "installing"}
                disabled={isOffline}
                data-autofocus
                onClick={() => void handleInstallUpdate()}
              >
                {updateStatus === "installing"
                  ? t("Installing…")
                  : t("Install update")}
              </Button>
            </div>
          }
        />
      ) : null}
      {confirmResetSettings ? (
        <ResetSettingsDialog
          onCancel={() => setConfirmResetSettings(false)}
          onReset={() => {
            setConfirmResetSettings(false);
            addToast({
              tone: "success",
              title: t("Settings reset"),
              detail: t("Default app settings have been restored."),
            });
          }}
        />
      ) : null}
      {confirmReset ? (
        <ResetPlayCounterDialog onCancel={() => setConfirmReset(false)} />
      ) : null}
      {confirmImport ? (
        <ImportDataDialog
          onCancel={() => setConfirmImport(false)}
          onConfirm={() => {
            setConfirmImport(false);
            void handleImport();
          }}
        />
      ) : null}
      {confirmForgetLibrary ? (
        <Modal
          size="sm"
          labelId="forget-library-title"
          title={t("Forget imported {{forgetLibraryLabel}} data?", {
            forgetLibraryLabel,
          })}
          subtitle={t("Your recorded PlayCounter sessions will be kept.")}
          icon={Trash2}
          onClose={() => setConfirmForgetLibrary(null)}
          footer={
            <div className="flex justify-end gap-2">
              <Button onClick={() => setConfirmForgetLibrary(null)}>
                {t("Cancel")}
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  forgetImportedLibraryData(confirmForgetLibrary);
                  setConfirmForgetLibrary(null);
                }}
              >
                {t("Forget imported data")}
              </Button>
            </div>
          }
        >
          <p className="text-sm text-text-muted">
            {t(
              "{{forgetLibraryLabel}} badges and imported playtime floors will disappear. You can import the library again at any time.",
              { forgetLibraryLabel },
            )}
          </p>
        </Modal>
      ) : null}
      {confirmForgetLaunchFiles ? (
        <ForgetLaunchFilesDialog
          scope={confirmForgetLaunchFiles}
          count={
            confirmForgetLaunchFiles === "executables"
              ? executableLaunchTargetCount
              : confirmForgetLaunchFiles === "emulators"
                ? emulatorLaunchTargetCount
                : executableLaunchTargetCount + emulatorLaunchTargetCount
          }
          onCancel={() => setConfirmForgetLaunchFiles(null)}
          onConfirm={() => {
            if (confirmForgetLaunchFiles === "all") {
              setLauncherSetting("rememberLaunchPaths", false);
              addToast({
                tone: "success",
                title: t("Launch paths are no longer stored"),
                detail: t(
                  "Saved game and emulator paths were forgotten. Starting games from PlayCounter and controller navigation were turned off.",
                ),
              });
            } else if (confirmForgetLaunchFiles === "executables") {
              forgetExecutableLaunchTargets();
              addToast({
                tone: "success",
                title: t("Saved game files forgotten"),
                detail: t(
                  "Emulator programs and game files were left untouched.",
                ),
              });
            } else {
              forgetEmulatorLaunchTargets();
              addToast({
                tone: "success",
                title: t("Emulator launch files forgotten"),
                detail: t("Saved paths for regular games were left untouched."),
              });
            }
            setConfirmForgetLaunchFiles(null);
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
  title: React.ReactNode;
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

function ForgetLaunchFilesDialog({
  scope,
  count,
  onCancel,
  onConfirm,
}: {
  scope: LaunchFileForgetScope;
  count: number;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const emulatorFiles = scope === "emulators";
  const disablingStorage = scope === "all";
  return (
    <Modal
      size="sm"
      labelId="forget-launch-files-dialog-title"
      eyebrow={t("Direct game launching")}
      title={
        disablingStorage
          ? t("Stop remembering launch paths?")
          : emulatorFiles
            ? t("Forget emulator launch files?")
            : t("Forget saved game files?")
      }
      icon={Gamepad2}
      onClose={onCancel}
      footer={
        <div className="grid gap-2 sm:grid-cols-2">
          <Button variant="secondary" onClick={onCancel}>
            {t("Cancel")}
          </Button>
          <Button variant="danger" icon={Trash2} onClick={onConfirm}>
            {disablingStorage
              ? t("Stop remembering")
              : count
                ? t("Forget {{count}}", { count })
                : t("Forget all")}
          </Button>
        </div>
      }
    >
      <p className="text-sm leading-6 text-text-muted">
        {[
          disablingStorage
            ? count === 0
              ? t(
                  "This removes any saved game and emulator paths, stops PlayCounter from learning new ones, and turns off starting games from PlayCounter and controller navigation.",
                )
              : t(
                  "This removes all {{count}} saved game and emulator paths, stops PlayCounter from learning new ones, and turns off starting games from PlayCounter and controller navigation.",
                  { count },
                )
            : emulatorFiles
              ? t(
                  "This removes {{count}} saved emulator program and game paths, including files such as ISO, RVZ, and DOSBox programs. Paths for regular games stay intact.",
                  { count },
                )
              : t(
                  "This removes {{count}} saved paths for regular games. Emulator programs and game files stay intact.",
                  { count },
                ),
          t("Play history and game matches are not changed."),
          disablingStorage
            ? t("You can turn path storage back on at any time.")
            : t(
                "PlayCounter can learn the paths again the next time it sees the game running.",
              ),
        ].join(" ")}
      </p>
    </Modal>
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
    <Modal
      size="sm"
      labelId="import-data-dialog-title"
      eyebrow={t("Settings")}
      title={t("Import backup?")}
      icon={FolderInput}
      onClose={onCancel}
      footer={
        <div className="grid gap-2 sm:grid-cols-2">
          <Button variant="secondary" onClick={onCancel}>
            {t("Cancel")}
          </Button>
          <Button variant="primary" icon={FolderOpen} onClick={onConfirm}>
            {t("Choose file")}
          </Button>
        </div>
      }
    >
      <p className="text-sm leading-6 text-text-muted">
        {t(
          "This replaces your current play history, game cache, and settings with the contents of the backup file. Your current data is saved to a backup file first, and PlayCounter reloads when the import finishes.",
        )}
      </p>
    </Modal>
  );
}

function formatUpdateStatus(
  status: UpdateStatus,
  result: UpdateCheckResult | null,
  progressLabel: string | null,
) {
  if (status === "checking") return t("Checking for updates...");
  if (status === "installing") {
    return progressLabel
      ? t("Downloading and installing {{progressLabel}}", { progressLabel })
      : t("Preparing update...");
  }
  if (status === "available" && result?.status === "available") {
    return t("Version {{version}} is available.", { version: result.version });
  }
  if (status === "current") return t("PlayCounter is up to date.");
  if (status === "error") return t("Update check failed.");
  return t("No update check has run in this session.");
}

function formatBytesProgress(progress: InstallProgress) {
  const downloaded = formatBytes(progress.downloadedBytes);
  if (!progress.totalBytes) return downloaded;

  return `${downloaded} of ${formatBytes(progress.totalBytes)}`;
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  // Like toFixed(1), but with the language's decimal mark.
  return `${(bytes / (1024 * 1024)).toLocaleString(appLocale(), {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
    useGrouping: false,
  })} MB`;
}

function formatError(error: unknown) {
  return nativeText(error instanceof Error ? error.message : String(error));
}
