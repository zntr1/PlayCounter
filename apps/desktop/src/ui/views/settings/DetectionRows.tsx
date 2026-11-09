import { FolderOpen, RotateCcw } from "lucide-react";
import { useState } from "react";
import { getT } from "../../../i18n";
import { useAppStore } from "../../../store";
import {
  chooseEmulatorBinary,
  forgetEmulatorManualBinary,
  openUserIgnoredProcessesFolder,
  reloadIgnoredProcesses,
  setEmulatorIgnored,
} from "../../../tracker";
import { emulatorAssetUrls } from "../../../emulators/assets";
import { adapterFor } from "../../../emulators/registry";
import { resolveEmulatorBinary } from "../../../emulatorLaunch";
import { launchFileBaseName } from "../../../gameLaunch";
import { cn } from "../../cn";
import { Button, Switch } from "../../primitives";
import { SettingsRow, type SettingsRowProps } from "./SettingsKit";
import { formatError } from "./settingsOps";

const t = getT("settings");

/* ── Emulators ───────────────────────────────────────────── */

export function EmulatorDetectionRow({ level, disabled }: SettingsRowProps) {
  const checked = useAppStore(
    (state) => state.settings.emulatorDetection ?? true,
  );
  const setEmulatorSetting = useAppStore((state) => state.setEmulatorSetting);
  return (
    <SettingsRow
      id="emulatorDetection"
      level={level}
      disabled={disabled}
      title={t("Detect emulator games")}
      description={t(
        "Reads the loaded game file, the window title, and the start-up options of the emulator on this PC to work out which game is running. Full paths and window titles never leave your PC.",
      )}
      control={
        <Switch
          aria-label={t("Detect emulator games")}
          checked={checked}
          disabled={disabled}
          onChange={(event) =>
            setEmulatorSetting("emulatorDetection", event.target.checked)
          }
        />
      }
    />
  );
}

export function ContentLookupRow({ level, disabled }: SettingsRowProps) {
  const checked = useAppStore(
    (state) => state.settings.emulatorContentLookup ?? true,
  );
  const setEmulatorSetting = useAppStore((state) => state.setEmulatorSetting);
  return (
    <SettingsRow
      id="emulatorContentLookup"
      level={level}
      disabled={disabled}
      title={t("Look up recognized content")}
      description={t(
        "Sends the recognized game file name or disc ID to look it up in the database. Folder paths and unclear window titles stay on this PC.",
      )}
      control={
        <Switch
          aria-label={t("Look up recognized content")}
          checked={checked}
          disabled={disabled}
          onChange={(event) =>
            setEmulatorSetting("emulatorContentLookup", event.target.checked)
          }
        />
      }
    />
  );
}

export function DetectedEmulatorsRow({ level, disabled }: SettingsRowProps) {
  const settings = useAppStore((state) => state.settings);
  const knownEmulators = useAppStore((state) => state.knownEmulators);
  const autoBinaries = useAppStore((state) => state.emulatorAutoBinaries);
  const manualBinaries = useAppStore((state) => state.emulatorManualBinaries);
  const addToast = useAppStore((state) => state.addToast);
  const [syncing, setSyncing] = useState<string | null>(null);
  const detection = settings.emulatorDetection ?? true;

  // Ignored emulators stay listed, even before PlayCounter sees them again.
  const emulators = new Map(knownEmulators);
  for (const rawId of settings.ignoredEmulatorIds ?? []) {
    const emulatorId = rawId.trim().toLowerCase();
    if (!emulatorId || emulators.has(emulatorId)) continue;
    emulators.set(emulatorId, {
      emulatorId,
      label: adapterFor(emulatorId)?.label ?? emulatorId,
      firstSeenAt: "",
      lastSeenAt: "",
      hostExeNames: [],
    });
  }

  async function toggleIgnored(emulatorId: string, ignored: boolean) {
    setSyncing(emulatorId);
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
      setSyncing(null);
    }
  }

  async function chooseProgram(emulatorId: string) {
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

  function backToDetected(emulatorId: string, label: string) {
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

  return (
    <SettingsRow
      id="detectedEmulators"
      level={level}
      disabled={disabled}
      title={t("Detected emulators")}
      description={t(
        "Ignored emulators are hidden and no games inside them are tracked. Existing games, mappings, and history are preserved.",
      )}
      below={
        emulators.size === 0 ? (
          <p className="text-[13px] italic text-text-faint">
            {t(
              "None yet. An emulator shows up here once PlayCounter has seen it running.",
            )}
          </p>
        ) : (
          <ul className="overflow-hidden rounded-[10px] border border-border">
            {[...emulators.values()].map((emulator) => {
              const adapter = adapterFor(emulator.emulatorId);
              const ignored = (settings.ignoredEmulatorIds ?? []).some(
                (id) => id.toLowerCase() === emulator.emulatorId.toLowerCase(),
              );
              const imageSrc = emulatorAssetUrls[emulator.emulatorId];
              const binary = resolveEmulatorBinary(
                emulator.emulatorId,
                autoBinaries,
                manualBinaries,
              );
              const manual = manualBinaries.has(emulator.emulatorId);
              return (
                <li
                  key={emulator.emulatorId}
                  className="flex flex-wrap items-center gap-3 border-border/60 bg-bg/35 py-2 pl-3 pr-2 [&:not(:first-child)]:border-t"
                >
                  {imageSrc ? (
                    <img
                      src={imageSrc}
                      alt=""
                      className={cn(
                        "h-[34px] w-[34px] shrink-0 rounded-md object-cover",
                        ignored && "opacity-45 grayscale",
                      )}
                    />
                  ) : null}
                  <div className="grid min-w-0 flex-1">
                    <span
                      className={cn(
                        "truncate text-sm font-medium",
                        ignored ? "text-text-faint" : "text-text",
                      )}
                    >
                      {emulator.label}
                    </span>
                    <span className="truncate text-xs text-text-faint">
                      {ignored
                        ? t("Ignored and hidden")
                        : emulator.hostExeNames.join(", ") || t("Enabled")}
                    </span>
                    {adapter?.launch && !ignored ? (
                      <span
                        className="truncate text-xs text-text-muted"
                        title={binary?.exePath}
                      >
                        {!binary
                          ? t("Launch program: not set")
                          : manual
                            ? t("Launch program: {{file}} (selected)", {
                                file: launchFileBaseName(binary.exePath),
                              })
                            : t("Launch program: {{file}} (detected)", {
                                file: launchFileBaseName(binary.exePath),
                              })}
                      </span>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-1.5">
                    {adapter?.launch && !ignored ? (
                      <>
                        <Button
                          icon={FolderOpen}
                          className="h-[30px] px-2.5 text-[13px]"
                          disabled={disabled}
                          onClick={() =>
                            void chooseProgram(emulator.emulatorId)
                          }
                        >
                          {binary ? t("Change program") : t("Set program")}
                        </Button>
                        {manual ? (
                          <Button
                            variant="ghost"
                            icon={RotateCcw}
                            className="h-[30px] px-2.5 text-[13px]"
                            disabled={disabled}
                            onClick={() =>
                              backToDetected(
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
                      variant={ignored ? "primary" : "ghost"}
                      className="h-[30px] px-2.5 text-[13px]"
                      loading={syncing === emulator.emulatorId}
                      disabled={disabled || syncing !== null || !detection}
                      onClick={() =>
                        void toggleIgnored(emulator.emulatorId, !ignored)
                      }
                    >
                      {ignored ? t("Enable") : t("Ignore")}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )
      }
    />
  );
}

/* ── Discovery ───────────────────────────────────────────── */

export function TrackSoftwareRow({ level, disabled }: SettingsRowProps) {
  const checked = useAppStore((state) => state.settings.trackTools === true);
  const setTrackTools = useAppStore((state) => state.setTrackTools);
  return (
    <SettingsRow
      id="trackTools"
      level={level}
      disabled={disabled}
      title={t("Track software")}
      description={t(
        "Count how long apps like Discord, Spotify and launchers run, on their own Software page. They never appear in Now Playing and never count toward your game stats.",
      )}
      control={
        <Switch
          aria-label={t("Track software")}
          checked={checked}
          disabled={disabled}
          onChange={(event) => setTrackTools(event.target.checked)}
        />
      }
    />
  );
}

export function ShareIgnoredAppsRow({ level, disabled }: SettingsRowProps) {
  const checked = useAppStore(
    (state) => state.settings.autoShareIgnoredProcesses,
  );
  const setAutoShareIgnoredProcesses = useAppStore(
    (state) => state.setAutoShareIgnoredProcesses,
  );
  return (
    <SettingsRow
      id="shareIgnoredApps"
      dataTour="settings-sharing"
      level={level}
      disabled={disabled}
      title={t("Share apps you ignore")}
      description={t(
        "When you ignore an app PlayCounter does not recognize, it sends the file name, your platform, and an anonymous install ID. Playtime and game history are never sent.",
      )}
      control={
        <Switch
          aria-label={t("Share apps you ignore")}
          checked={checked}
          disabled={disabled}
          onChange={(event) =>
            setAutoShareIgnoredProcesses(event.target.checked)
          }
        />
      }
    />
  );
}

export function IgnoredAppsRow({ level, disabled }: SettingsRowProps) {
  const count = useAppStore((state) => state.ignoredProcesses.size);
  const path = useAppStore((state) => state.userIgnoredProcessesPath);
  const addToast = useAppStore((state) => state.addToast);
  const [reloading, setReloading] = useState(false);
  return (
    <SettingsRow
      id="ignoredApps"
      level={level}
      disabled={disabled}
      title={t("Ignored apps")}
      description={t(
        "Apps in this list are never treated as games. It contains PlayCounter's built-in list of system apps plus the apps you ignored yourself.",
      )}
      control={
        <Button
          icon={RotateCcw}
          loading={reloading}
          disabled={disabled}
          onClick={async () => {
            setReloading(true);
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
              setReloading(false);
            }
          }}
        >
          {t("Reload")}
        </Button>
      }
      below={
        <div className="grid gap-1.5">
          <div className="mx-0.5 text-[13px] text-text-muted">
            {t("Loaded entries:")}{" "}
            <b className="font-mono font-semibold text-text">{count}</b>
          </div>
          <div className="flex items-center gap-2.5 rounded-lg border border-border bg-bg/35 py-1.5 pl-3 pr-1.5">
            <span className="shrink-0 text-xs font-medium text-text-muted">
              {t("User file")}
            </span>
            <span
              className="min-w-0 flex-1 truncate font-mono text-xs text-text-faint"
              title={path ?? undefined}
            >
              {path ?? t("Unavailable")}
            </span>
            <Button
              icon={FolderOpen}
              className="h-[30px] px-2.5 text-[13px]"
              disabled={disabled || !path}
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
      }
    />
  );
}
