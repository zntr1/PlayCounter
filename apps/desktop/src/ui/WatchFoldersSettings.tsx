import { FolderPlus, Info, RotateCcw, Trash2 } from "lucide-react";
import { useState } from "react";
import { chooseWatchFolder, scanWatchFolders } from "../library/watchFolders";
import {
  readWatchFolders,
  removeWatchFolder,
  restoreDismissedFolder,
} from "../library/watchFolderState";
import { useAppStore } from "../store";
import { setUserIgnoredProcess } from "../tracker";
import { Button } from "./primitives";

/** Folders PlayCounter watches for games that no launcher knows about. */
export function WatchFoldersSettings() {
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
        title: "Folder not added",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return (
    <div
      data-tour="settings-watch-folders"
      className="grid gap-3 border-t border-border pt-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-text">Watched folders</div>
          <div className="mt-0.5 text-xs leading-5 text-text-faint">
            Each folder inside a watched folder counts as one game. Games
            PlayCounter recognizes show up in My Games, ready to play; the rest
            wait in Discovered. To recognize them, PlayCounter sends the names
            of the game files it finds to its game database.
          </div>
        </div>
        <Button
          data-tour="settings-watch-folders-add"
          variant="secondary"
          icon={FolderPlus}
          disabled={!remembersPaths}
          aria-describedby={
            remembersPaths ? undefined : "watch-folders-needs-paths"
          }
          onClick={() => void addFolder()}
        >
          Add folder
        </Button>
      </div>
      {remembersPaths ? null : (
        <p
          id="watch-folders-needs-paths"
          className="flex items-start gap-2 text-xs leading-5 text-warning"
        >
          <Info size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
          Add folder needs Remember launch paths, because PlayCounter saves
          where each game's file is. Turn it on under Game launching above.
        </p>
      )}
      {record.folders.map((folder) => (
        <div
          key={folder}
          className="flex items-center justify-between gap-3 rounded-lg border border-border bg-bg/40 px-3 py-2"
        >
          <span className="min-w-0 truncate text-sm text-text" title={folder}>
            {folder}
          </span>
          <Button
            variant="ghost"
            icon={Trash2}
            aria-label={`Stop watching ${folder}`}
            onClick={() => setRecord(removeWatchFolder(folder))}
          >
            Remove
          </Button>
        </div>
      ))}
      {record.dismissed.length > 0 ? (
        <div
          data-tour="settings-watch-folders-dismissed"
          className="grid gap-2"
        >
          <div className="text-xs font-medium text-text-muted">
            Dismissed game folders
          </div>
          {record.dismissed.map(({ folderPath: path, exeName }) => (
            <div
              key={path}
              className="flex items-center justify-between gap-3 rounded-lg border border-border/70 px-3 py-2"
            >
              <span
                className="min-w-0 truncate text-xs text-text-faint"
                title={path}
              >
                {path}
              </span>
              <Button
                variant="ghost"
                icon={RotateCcw}
                aria-label={`Restore ${path}`}
                onClick={() => {
                  setRecord(restoreDismissedFolder(path));
                  void setUserIgnoredProcess(exeName, false).finally(
                    () => void scanWatchFolders("folder restored"),
                  );
                }}
              >
                Restore
              </Button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
