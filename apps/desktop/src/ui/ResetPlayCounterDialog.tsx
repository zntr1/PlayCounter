import { useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { resetLocalData } from "../resetLocalData";
import { Button, Modal } from "./primitives";

export function ResetPlayCounterDialog({ onCancel }: { onCancel: () => void }) {
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  function close() {
    if (busy.current) return;
    // After a partial failure, reload from disk instead of resuming stale state.
    if (error) window.location.reload();
    else onCancel();
  }

  async function confirm() {
    if (busy.current) return;
    busy.current = true;
    setResetting(true);
    setError(null);
    try {
      await resetLocalData();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setResetting(false);
      busy.current = false;
    }
  }

  return (
    <Modal
      size="sm"
      labelId="reset-playcounter-title"
      eyebrow="Settings"
      title="Reset PlayCounter?"
      icon={Trash2}
      onClose={close}
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button data-autofocus disabled={resetting} onClick={close}>
            {error ? "Reload PlayCounter" : "Cancel"}
          </Button>
          <Button
            variant="danger"
            loading={resetting}
            onClick={() => void confirm()}
          >
            {resetting
              ? "Resetting…"
              : error
                ? "Retry reset"
                : "Erase data and restart"}
          </Button>
        </div>
      }
    >
      <div className="space-y-3 text-sm leading-6 text-text-muted">
        <p>
          Erase your current PlayCounter data: your library, play history,
          notes, playthroughs, shelves, settings, custom artwork, ignore rules,
          and installation ID.
        </p>
        <p>
          All backup files are kept, including automatic and safety backups. You
          can import a backup later to restore saved data.
        </p>
        <p>
          Your backup folder settings are kept. Automatic backups will be paused
          to protect your saved history; you can turn them back on in Settings.
        </p>
        <p>
          PlayCounter will restart with default app settings. Your installed
          games and shared community contributions are kept.
        </p>
        <p className="font-medium text-danger">
          Any data not in a backup will be lost.
        </p>
        {error ? (
          <div
            role="alert"
            className="rounded-lg border border-danger-border bg-danger-tint p-3 text-danger"
          >
            <p className="font-medium">Reset could not finish: {error}</p>
            <p>
              Some data may already have been erased. Retry the reset or reload
              PlayCounter to use the remaining data.
            </p>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
