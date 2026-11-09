import { getVersion } from "@tauri-apps/api/app";
import {
  Check,
  CircleHelp,
  Copy,
  Download,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Trans } from "react-i18next";
import { PlayCounterAnimatedIcon } from "../../../brand/PlayCounterAnimatedIcon";
import { appLocale, getT } from "../../../i18n";
import {
  findReleaseNote,
  isEmptyDisplayNotes,
  parseManifestNotes,
  updateDisplayNotes,
} from "../../../releaseNotes";
import { useAppStore, useIsOffline } from "../../../store";
import {
  checkForUpdate,
  installAvailableUpdate,
  type InstallProgress,
} from "../../../updater";
import { ReleaseNotesDialog } from "../../ReleaseNotesDialog";
import { Button } from "../../primitives";
import { SettingsRow, type SettingsRowProps } from "./SettingsKit";
import { formatError, setSettingsOp } from "./settingsOps";

const t = getT("settings");

type CheckState = "idle" | "checking" | "current" | "installing" | "error";

/** The version you run, the update check and the release notes. */
export function AppUpdatesRow({ disabled }: SettingsRowProps) {
  const available = useAppStore((state) => state.availableUpdate);
  const setAvailableUpdate = useAppStore((state) => state.setAvailableUpdate);
  const openCurrentReleaseNotes = useAppStore(
    (state) => state.openCurrentReleaseNotes,
  );
  const isOffline = useIsOffline();
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [state, setState] = useState<CheckState>("idle");
  const [progress, setProgress] = useState<InstallProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notesOpen, setNotesOpen] = useState(false);

  useEffect(() => {
    void getVersion()
      .then(setAppVersion)
      .catch(() => setAppVersion(null));
  }, []);

  async function check() {
    setState("checking");
    setError(null);
    try {
      const result = await checkForUpdate();
      setAvailableUpdate(result.status === "available" ? result : null);
      setState(result.status === "available" ? "idle" : "current");
    } catch (failure) {
      setError(formatError(failure));
      setState("error");
    }
  }

  async function install() {
    setNotesOpen(false);
    setState("installing");
    setProgress(null);
    setError(null);
    setSettingsOp({ installingUpdate: true });
    try {
      const installed = await installAvailableUpdate(setProgress);
      if (!installed) {
        setAvailableUpdate(null);
        setState("current");
      }
    } catch (failure) {
      setError(formatError(failure));
      setState("error");
    } finally {
      setSettingsOp({ installingUpdate: false });
    }
  }

  const busy = state === "checking" || state === "installing";
  const installedNote = findReleaseNote(appVersion);
  const availableNotes = available
    ? updateDisplayNotes(available)
    : parseManifestNotes(null);
  const status =
    state === "installing"
      ? progress
        ? t("Downloading and installing {{progressLabel}}", {
            progressLabel: formatBytesProgress(progress),
          })
        : t("Preparing update...")
      : state === "checking"
        ? t("Checking for updates...")
        : isOffline
          ? t("Update checks unavailable offline.")
          : available
            ? t("Version {{version}} is available.", {
                version: available.version,
              })
            : state === "current"
              ? t("PlayCounter is up to date.")
              : state === "error"
                ? t("Update check failed.")
                : t("No update check has run in this session.");

  return (
    <div
      data-row="appUpdates"
      data-tour="settings-updates"
      className="flex flex-wrap items-center gap-x-[18px] gap-y-3 p-[18px]"
    >
      {busy ? (
        <PlayCounterAnimatedIcon size={56} />
      ) : (
        <img
          src="/brand/playcounter-mark.svg"
          alt=""
          width={56}
          height={56}
          draggable={false}
          className="h-14 w-14"
        />
      )}
      <div className="min-w-[12rem] flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2.5 text-lg font-bold text-text">
          PlayCounter
          {appVersion ? (
            <span className="font-mono text-[13px] font-semibold text-text-muted">
              {appVersion}
            </span>
          ) : null}
        </div>
        <div
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className={
            available && !busy && !isOffline
              ? "mt-0.5 flex items-center gap-1.5 text-sm font-semibold text-accent-ink"
              : state === "current" && !isOffline
                ? "mt-0.5 flex items-center gap-1.5 text-sm text-success"
                : "mt-0.5 flex items-center gap-1.5 text-sm text-text-muted"
          }
        >
          {available && !busy && !isOffline ? (
            <Sparkles size={15} aria-hidden="true" />
          ) : state === "current" && !isOffline ? (
            <Check size={15} aria-hidden="true" />
          ) : null}
          {status}
        </div>
        {error ? (
          <p className="mt-1 break-words text-sm text-danger">{error}</p>
        ) : null}
      </div>
      <div className="ml-auto flex flex-wrap justify-end gap-2">
        {available ? (
          <>
            {!isEmptyDisplayNotes(availableNotes) ? (
              <Button
                disabled={disabled || state === "installing"}
                onClick={() => setNotesOpen(true)}
              >
                {t("What's new")}
              </Button>
            ) : null}
            <Button
              variant="primary"
              icon={state === "installing" ? undefined : Download}
              aria-busy={state === "installing"}
              disabled={disabled || busy || isOffline}
              onClick={() => void install()}
            >
              {state === "installing" ? t("Installing…") : t("Install")}
            </Button>
          </>
        ) : (
          <>
            <Button
              variant="ghost"
              disabled={disabled || !installedNote}
              title={
                installedNote
                  ? undefined
                  : t("No release notes for this version")
              }
              onClick={openCurrentReleaseNotes}
            >
              {t("Release notes")}
            </Button>
            <Button
              icon={state === "checking" ? undefined : RotateCcw}
              aria-busy={state === "checking"}
              disabled={disabled || busy || isOffline}
              title={
                isOffline ? t("Update checks unavailable offline") : undefined
              }
              onClick={() => void check()}
            >
              {state === "checking" ? t("Checking…") : t("Check")}
            </Button>
          </>
        )}
      </div>
      {notesOpen && available ? (
        <ReleaseNotesDialog
          version={available.version}
          eyebrow={t("Update available")}
          sections={[{ version: available.version, notes: availableNotes }]}
          onClose={() => setNotesOpen(false)}
          footer={
            <div className="flex justify-end">
              <Button
                variant="primary"
                icon={Download}
                loading={state === "installing"}
                disabled={isOffline}
                data-autofocus
                onClick={() => void install()}
              >
                {state === "installing"
                  ? t("Installing…")
                  : t("Install update")}
              </Button>
            </div>
          }
        />
      ) : null}
    </div>
  );
}

export function HelpRow({ level, disabled }: SettingsRowProps) {
  const setHelpMenuOpen = useAppStore((state) => state.setHelpMenuOpen);
  return (
    <SettingsRow
      id="help"
      dataTour="settings-help"
      level={level}
      disabled={disabled}
      title={t("Help & tutorials")}
      description={
        <Trans
          t={t}
          i18nKey="Use the <b>?</b> button in the top-right corner to start or replay the Quick Tour and every step-by-step guide."
          components={{ b: <b className="font-semibold text-text" /> }}
        />
      }
      control={
        <Button
          icon={CircleHelp}
          disabled={disabled}
          onClick={() => setHelpMenuOpen(true)}
        >
          {t("Open Help menu")}
        </Button>
      }
    />
  );
}

export function UserUuidRow({ level, disabled }: SettingsRowProps) {
  const uuid = useAppStore((state) => state.installUuid);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);
  return (
    <SettingsRow
      id="userUuid"
      level={level}
      disabled={disabled}
      title={t("User UUID")}
      description={t(
        "A random ID that recognizes your installation without an account. Used to count active installations and link your community suggestions and reports.",
      )}
      below={
        <div className="flex items-center gap-2.5 rounded-lg border border-border bg-bg/35 py-1.5 pl-3 pr-1.5">
          <span className="min-w-0 flex-1 select-all break-all font-mono text-[13px] text-text">
            {uuid ?? t("Unavailable")}
          </span>
          <Button
            icon={copied ? Check : Copy}
            className="h-[30px] px-2.5 text-[13px]"
            disabled={disabled || !uuid}
            onClick={() => {
              if (!uuid) return;
              void navigator.clipboard
                ?.writeText(uuid)
                .then(() => setCopied(true))
                .catch(() => undefined);
            }}
          >
            {copied ? t("Copied") : t("Copy")}
          </Button>
        </div>
      }
    />
  );
}

function formatBytesProgress(progress: InstallProgress) {
  const downloaded = formatBytes(progress.downloadedBytes);
  if (!progress.totalBytes) return downloaded;
  return t("{{downloaded}} of {{total}}", {
    downloaded,
    total: formatBytes(progress.totalBytes),
  });
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
