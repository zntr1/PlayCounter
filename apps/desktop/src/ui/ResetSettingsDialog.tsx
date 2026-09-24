import { useRef, useState } from "react";
import { RotateCcw } from "lucide-react";
import { resetSettings } from "../resetSettings";
import { Button, Modal } from "./primitives";

export function ResetSettingsDialog({
  onCancel,
  onReset,
}: {
  onCancel: () => void;
  onReset: () => void;
}) {
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  async function confirm() {
    if (busy.current) return;
    busy.current = true;
    setResetting(true);
    setError(null);
    try {
      await resetSettings();
      onReset();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      busy.current = false;
      setResetting(false);
    }
  }

  return (
    <Modal
      size="sm"
      labelId="reset-settings-title"
      eyebrow="Settings"
      title="Reset settings?"
      icon={RotateCcw}
      onClose={() => {
        if (!busy.current) onCancel();
      }}
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button data-autofocus disabled={resetting} onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={resetting}
            onClick={() => void confirm()}
          >
            {resetting ? "Resetting…" : "Restore defaults"}
          </Button>
        </div>
      }
    >
      <div className="space-y-3 text-sm leading-6 text-text-muted">
        <p>
          Restore default appearance, library display, detection, popup,
          keyboard shortcut, and startup settings. Changes apply immediately.
        </p>
        <p>
          Your games, play history, notes, shelves, and saved game files are
          kept. Backup files and backup preferences stay as they are.
        </p>
        {error ? (
          <div
            role="alert"
            className="rounded-lg border border-danger-border bg-danger-tint p-3 text-danger"
          >
            <p className="font-medium">
              Settings could not be fully reset: {error}
            </p>
            <p>
              Some settings may already have changed. Retry to finish the reset.
            </p>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
