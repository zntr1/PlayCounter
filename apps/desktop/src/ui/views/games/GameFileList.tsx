import { ChevronRight, FileCode2 } from "lucide-react";
import { ExeIcon } from "../../ExeIcon";
import { SourceBadge } from "../../components";
import { Modal } from "../../primitives";
import { fileRunStatus, sortGameFiles, type GameFile } from "./gameFiles";

/** "Which file?" rows: the name, who matched it, when it ran here and where it
 *  is, so the user can tell which file is really theirs. */
export function GameFileList({
  files,
  canPick,
  onPick,
}: {
  files: readonly GameFile[];
  canPick: (file: GameFile) => boolean;
  onPick: (exeName: string) => void;
}) {
  return (
    <div className="grid gap-2">
      {sortGameFiles(files).map((file) => {
        const enabled = canPick(file);
        return (
          <button
            key={file.exeName}
            type="button"
            disabled={!enabled}
            onClick={() => onPick(file.exeName)}
            className="group flex w-full items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 text-left transition enabled:hover:border-accent/60 enabled:hover:bg-accent-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-surface-hover text-text-muted">
              <ExeIcon
                exePath={file.path ?? null}
                className="h-5 w-5"
                fallback={<FileCode2 size={18} />}
              />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="min-w-0 truncate font-mono text-sm font-semibold text-text">
                  {file.exeName}
                </span>
                <SourceBadge source={file.source} variant="text" />
              </span>
              <span className="block text-xs text-text-muted">
                {fileRunStatus(file)}
              </span>
              {file.path ? (
                <span className="block truncate text-xs text-text-faint">
                  {file.path}
                </span>
              ) : null}
            </span>
            {enabled ? (
              <ChevronRight
                size={16}
                className="shrink-0 text-text-faint transition group-hover:text-accent-ink"
              />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/** Convert and Check match on a card with more than one file that fits: the
 *  user says which file first. */
export function PickGameFileDialog({
  action,
  gameName,
  files,
  canPick,
  onPick,
  onCancel,
}: {
  action: string;
  gameName: string;
  files: readonly GameFile[];
  canPick: (file: GameFile) => boolean;
  onPick: (exeName: string) => void;
  onCancel: () => void;
}) {
  return (
    <Modal
      size="md"
      labelId="pick-game-file-title"
      eyebrow={action}
      title={gameName}
      icon={FileCode2}
      onClose={onCancel}
    >
      <h3 className="text-sm font-semibold text-text">Which file?</h3>
      <div className="mt-3">
        <GameFileList files={files} canPick={canPick} onPick={onPick} />
      </div>
    </Modal>
  );
}
