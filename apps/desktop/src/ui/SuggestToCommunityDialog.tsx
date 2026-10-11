import { Send } from "lucide-react";
import { Button, Modal } from "./primitives";
import { Trans } from "react-i18next";
import { getT } from "../i18n";

const t = getT("dialogs");

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
      eyebrow={t("Community")}
      title={t("Suggest to community?")}
      subtitle={gameName}
      icon={Send}
      onClose={onCancel}
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2 [&>button]:whitespace-nowrap">
          <Button variant="ghost" onClick={onCancel}>
            {t("Cancel")}
          </Button>
          <Button
            variant="primary"
            icon={Send}
            onClick={onConfirm}
            disabled={isOffline}
            data-autofocus
          >
            {t("Suggest")}
          </Button>
        </div>
      }
    >
      <p className="text-sm leading-6 text-text-muted">
        <Trans
          t={t}
          i18nKey="Send <file>{{file}}</file> as <game>{{game}}</game> for community review. Only the file name and the game name are sent. If the game is wrong, use Change Game first."
          values={{ file: exeName, game: gameName }}
          components={{
            file: <span className="font-mono text-text" />,
            game: <span className="font-semibold text-text" />,
          }}
        />
      </p>
      {isOffline ? (
        <p className="mt-3 text-xs text-text-faint">
          {t("You're offline. Reconnect to suggest it.")}
        </p>
      ) : null}
    </Modal>
  );
}
