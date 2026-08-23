import { RotateCcw } from "lucide-react";
import { Button, Modal } from "./primitives";

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
      eyebrow="My Games"
      title="Cancel suggestion?"
      subtitle={gameName}
      icon={RotateCcw}
      onClose={onCancel}
      footer={
        <div className="grid gap-2 sm:grid-cols-2">
          <Button variant="secondary" onClick={onConfirm} disabled={isOffline}>
            Cancel suggestion
          </Button>
          <Button variant="ghost" onClick={onCancel} data-autofocus>
            Keep suggestion
          </Button>
        </div>
      }
    >
      <p className="text-sm leading-6 text-text-muted">
        Your suggestion for <span className="font-mono">{exeName}</span> is
        still awaiting community review. Cancelling removes it from the review
        queue. {gameName} stays tracked here as a private custom game, and
        nothing in your history changes. You can suggest it again anytime.
      </p>
      {isOffline ? (
        <p className="mt-3 text-xs text-text-faint">
          You&apos;re offline. Reconnect to cancel this suggestion.
        </p>
      ) : null}
    </Modal>
  );
}
