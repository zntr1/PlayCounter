import { useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { resetLocalData } from "../resetLocalData";
import { Button, Modal } from "./primitives";
import { getT } from "../i18n";

const t = getT("settings");

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
      eyebrow={t("Settings")}
      title={t("Reset PlayCounter?")}
      icon={Trash2}
      onClose={close}
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button data-autofocus disabled={resetting} onClick={close}>
            {error ? t("Reload PlayCounter") : t("Cancel")}
          </Button>
          <Button
            variant="danger"
            loading={resetting}
            onClick={() => void confirm()}
          >
            {resetting
              ? t("Resetting…")
              : error
                ? t("Retry reset")
                : t("Erase data and restart")}
          </Button>
        </div>
      }
    >
      <div className="space-y-3 text-sm leading-6 text-text-muted">
        <p>
          {t(
            "Erase your current PlayCounter data: your library, play history, notes, playthroughs, shelves, settings, custom artwork, ignore rules, and installation ID.",
          )}
        </p>
        <p>
          {t(
            "All backup files are kept, including automatic and safety backups. You can import a backup later to restore saved data.",
          )}
        </p>
        <p>
          {t(
            "Your backup folder settings are kept. Automatic backups will be paused to protect your saved history; you can turn them back on in Settings.",
          )}
        </p>
        <p>
          {t(
            "PlayCounter will restart with default app settings. Your installed games and shared community contributions are kept.",
          )}
        </p>
        <p className="font-medium text-danger">
          {t("Any data not in a backup will be lost.")}
        </p>
        {error ? (
          <div
            role="alert"
            className="rounded-lg border border-danger-border bg-danger-tint p-3 text-danger"
          >
            <p className="font-medium">
              {t("Reset could not finish: {{error}}", { error })}
            </p>
            <p>
              {t(
                "Some data may already have been erased. Retry the reset or reload PlayCounter to use the remaining data.",
              )}
            </p>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
