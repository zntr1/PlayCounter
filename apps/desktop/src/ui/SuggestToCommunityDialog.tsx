import { Send } from "lucide-react";
import { Button, Modal } from "./primitives";

/** "Suggest to Community" for a Custom game that already names its database
 *  game: the pair is sent as it is, without a search. */
export function SuggestToCommunityDialog({
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
      labelId="suggest-community-dialog-title"
      eyebrow="Community"
      title="Suggest to community?"
      subtitle={gameName}
      icon={Send}
      onClose={onCancel}
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2 [&>button]:whitespace-nowrap">
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="primary"
            icon={Send}
            onClick={onConfirm}
            disabled={isOffline}
            data-autofocus
          >
            Suggest
          </Button>
        </div>
      }
    >
      <p className="text-sm leading-6 text-text-muted">
        Send <span className="font-mono text-text">{exeName}</span> as{" "}
        <span className="font-semibold text-text">{gameName}</span> for
        community review. Only the file name and the game name are sent. If the
        game is wrong, use Change Game first.
      </p>
      {isOffline ? (
        <p className="mt-3 text-xs text-text-faint">
          You&apos;re offline. Reconnect to suggest it.
        </p>
      ) : null}
    </Modal>
  );
}
