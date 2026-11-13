import { Download } from "lucide-react";
import { useState } from "react";
import { appLocale, getT } from "../i18n";
import type { InstallProgress } from "../updater";
import { NoticeCard } from "./NoticeCard";
import { Button } from "./primitives";

const t = getT("shell");

/** The card for an update found at start or by a later check. Closed, it
 *  stays away until the next start, unless a newer version turns up. */
export function UpdateNotice({
  version,
  installing,
  progress,
  hasNotes,
  onOpenNotes,
  onInstall,
}: {
  version: string;
  installing: boolean;
  progress: InstallProgress | null;
  hasNotes: boolean;
  onOpenNotes: () => void;
  onInstall: () => void;
}) {
  const [closedVersion, setClosedVersion] = useState<string | null>(null);
  if (closedVersion === version) return null;
  const share =
    progress?.totalBytes && progress.totalBytes > 0
      ? Math.min(100, (progress.downloadedBytes / progress.totalBytes) * 100)
      : null;
  return (
    <NoticeCard
      tone="accent"
      icon={
        <img
          src="/brand/playcounter-mark-small.svg"
          alt=""
          className="h-[26px] w-[26px]"
        />
      }
      title={t("Version {{version}} is available", { version })}
      actions={
        <>
          {hasNotes ? (
            <Button
              variant="secondary"
              onClick={onOpenNotes}
              disabled={installing}
              className="px-3 py-1.5"
            >
              {t("What's new")}
            </Button>
          ) : null}
          <Button
            variant="primary"
            icon={installing ? undefined : Download}
            disabled={installing}
            aria-busy={installing}
            onClick={onInstall}
            className="px-3 py-1.5"
          >
            {installing ? t("Installing…") : t("Install")}
          </Button>
        </>
      }
      onClose={installing ? undefined : () => setClosedVersion(version)}
    >
      {installing ? (
        <div className="mt-1.5 flex items-center gap-2.5 text-[12.5px] text-text-muted">
          {share !== null ? (
            <div
              aria-hidden="true"
              className="h-1 max-w-[320px] flex-1 overflow-hidden rounded-full bg-border/70"
            >
              <div
                className="h-full rounded-full bg-accent transition-[width] duration-200"
                style={{ width: `${share}%` }}
              />
            </div>
          ) : null}
          <span>{formatInstallProgress(progress)}</span>
        </div>
      ) : null}
    </NoticeCard>
  );
}

function formatInstallProgress(progress: InstallProgress | null) {
  if (!progress) return t("preparing update");

  const downloaded = formatBytes(progress.downloadedBytes);
  if (!progress.totalBytes)
    return t("downloading {{downloaded}}", { downloaded });

  return t("downloading {{downloaded}} of {{bytes}}", {
    downloaded,
    bytes: formatBytes(progress.totalBytes),
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
