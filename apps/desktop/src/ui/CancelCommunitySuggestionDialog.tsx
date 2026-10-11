import { RotateCcw } from "lucide-react";
import { Button, Modal } from "./primitives";
import { Trans } from "react-i18next";
import { getT } from "../i18n";

const t = getT("dialogs");

export function CancelCommunitySuggestionDialog({
  gameName,
  exeName,
  isOffline,
  onCancel,
  onConfirm,
}: {
  gameName: string;
  exeName: string;
  isOffline: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal
      size="sm"
      labelId="cancel-suggestion-dialog-title"
      eyebrow={t("My Games")}
      title={t("Cancel suggestion?")}
      subtitle={gameName}
      icon={RotateCcw}
      onClose={onCancel}
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2 [&>button]:whitespace-nowrap">
          <Button variant="secondary" onClick={onConfirm} disabled={isOffline}>
            {t("Cancel suggestion")}
          </Button>
          <Button variant="ghost" onClick={onCancel} data-autofocus>
            {t("Keep suggestion")}
          </Button>
        </div>
      }
    >
      <p className="text-sm leading-6 text-text-muted">
        <Trans
          t={t}
          i18nKey="Your suggestion for <file>{{file}}</file> is still awaiting community review. Cancelling removes it from the review queue. {{game}} stays tracked here as a private custom game, and nothing in your history changes. You can suggest it again anytime."
          values={{ file: exeName, game: gameName }}
          components={{ file: <span className="font-mono" /> }}
        />
      </p>
      {isOffline ? (
        <p className="mt-3 text-xs text-text-faint">
          {t("You're offline. Reconnect to cancel this suggestion.")}
        </p>
      ) : null}
    </Modal>
  );
}
