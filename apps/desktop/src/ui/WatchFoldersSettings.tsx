import { FolderOpen, FolderPlus, Info, RotateCcw, Trash2 } from "lucide-react";
import { useState } from "react";
import { chooseWatchFolder } from "../library/watchFolders";
import {
  readWatchFolders,
  removeWatchFolder,
} from "../library/watchFolderState";
import { useAppStore } from "../store";
import { restoreDismissedWatchFolder } from "../tracker";
import { Button } from "./primitives";
import { getT } from "../i18n";
import {
  SettingsRow,
  type SettingsRowProps,
} from "./views/settings/SettingsKit";

const t = getT("settings");

/** Folders PlayCounter watches for games that no launcher knows about. */
export function WatchFoldersSettings({
  level = 0,
  disabled = false,
}: Partial<SettingsRowProps>) {
  const remembersPaths = useAppStore(
    (state) => state.settings.rememberLaunchPaths !== false,
  );
  const addToast = useAppStore((state) => state.addToast);
  const [record, setRecord] = useState(readWatchFolders);

  async function addFolder() {
    try {
      const next = await chooseWatchFolder();
      if (next) setRecord(next);
    } catch (error) {
      addToast({
        tone: "error",
        title: t("Folder not added"),
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return (
    <SettingsRow
      id="watchFolders"
      dataTour="settings-watch-folders"
      level={level}
      disabled={disabled}
      title={t("Watched folders")}
      description={t(
        "Each folder inside a watched folder counts as one game. Games PlayCounter recognizes show up in My Games, ready to play; the rest wait in Discovered. To recognize them, PlayCounter sends the names of the game files it finds to its game database.",
      )}
      control={
        <Button
          data-tour="settings-watch-folders-add"
          icon={FolderPlus}
          disabled={disabled || !remembersPaths}
          aria-describedby={
            remembersPaths ? undefined : "watch-folders-needs-paths"
          }
          onClick={() => void addFolder()}
        >
          {t("Add folder")}
        </Button>
      }
      below={
        remembersPaths &&
        record.folders.length === 0 &&
        record.dismissed.length === 0 ? null : (
          <div className="grid gap-2">
            {remembersPaths ? null : (
              <p
                id="watch-folders-needs-paths"
                className="flex items-start gap-2 text-[13px] leading-5 text-warning"
              >
                <Info
                  size={14}
                  aria-hidden="true"
                  className="mt-0.5 shrink-0"
                />
                <span>
                  {t(
                    "Add folder needs Remember launch paths, because PlayCounter saves where each game's file is.",
                  )}{" "}
                  <button
                    type="button"
                    className="font-semibold text-accent-ink hover:underline"
                    onClick={() =>
                      useAppStore.getState().setSettingsGroup("launching")
                    }
                  >
                    {t("Open {{group}}", { group: t("Game launching") })}
                  </button>
                </span>
              </p>
            )}
            {record.folders.length ? (
              <ul className="overflow-hidden rounded-[10px] border border-border">
                {record.folders.map((folder) => (
                  <li
                    key={folder}
                    className="flex items-center gap-3 border-border/60 bg-bg/35 py-1.5 pl-3 pr-2 [&:not(:first-child)]:border-t"
                  >
                    <FolderOpen
                      size={16}
                      aria-hidden="true"
                      className="shrink-0 text-text-faint"
                    />
                    <span
                      className="min-w-0 flex-1 truncate font-mono text-[13px] text-text"
                      title={folder}
                    >
                      {folder}
                    </span>
                    <Button
                      variant="ghost"
                      icon={Trash2}
                      className="h-[30px] px-2.5 text-[13px]"
                      aria-label={t("Stop watching {{folder}}", { folder })}
                      onClick={() => setRecord(removeWatchFolder(folder))}
                    >
                      {t("Remove")}
                    </Button>
                  </li>
                ))}
              </ul>
            ) : null}
            {record.dismissed.length > 0 ? (
              <div
                data-tour="settings-watch-folders-dismissed"
                className="grid gap-1.5"
              >
                <div className="mx-0.5 mt-1 text-xs font-medium text-text-muted">
                  {t("Dismissed game folders")}
                </div>
                <ul className="overflow-hidden rounded-[10px] border border-border/70">
                  {record.dismissed.map(({ folderPath: path, exeName }) => (
                    <li
                      key={path}
                      className="flex items-center gap-3 border-border/60 py-1.5 pl-3 pr-2 [&:not(:first-child)]:border-t"
                    >
                      <span
                        className="min-w-0 flex-1 truncate font-mono text-xs text-text-faint"
                        title={path}
                      >
                        {path}
                      </span>
                      <Button
                        variant="ghost"
                        icon={RotateCcw}
                        className="h-[30px] px-2.5 text-[13px]"
                        aria-label={t("Restore {{path}}", { path })}
                        onClick={() =>
                          void restoreDismissedWatchFolder(
                            path,
                            exeName,
                          ).finally(() => setRecord(readWatchFolders()))
                        }
                      >
                        {t("Restore")}
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        )
      }
    />
  );
}
