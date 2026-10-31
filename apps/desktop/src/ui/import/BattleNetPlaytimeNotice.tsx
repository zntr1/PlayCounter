import { Clock3 } from "lucide-react";
import { Trans } from "react-i18next";
import { getT } from "../../i18n";
import { Button, Modal } from "../primitives";

const t = getT("import");

/**
 * Shown before the first Battle.net scan or sign-in on this PC. Answering OK
 * is remembered; after that the same warning sits on the Battle.net card.
 */
export function BattleNetPlaytimeNotice({
  confirmLabel,
  onCancel,
  onConfirm,
}: {
  confirmLabel?: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal
      labelId="battlenet-playtime-title"
      title={t("Battle.net playtime")}
      icon={Clock3}
      onClose={onCancel}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>
            {t("Cancel")}
          </Button>
          <Button variant="primary" onClick={onConfirm}>
            {confirmLabel ?? t("OK")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4 text-sm leading-6 text-text-muted">
        <p>
          {t(
            "Battle.net does not provide historical playtime. To include your previous hours, you need to set each game's total yourself.",
          )}
        </p>
        <p>
          <Trans
            t={t}
            i18nKey="After importing, right-click a game in <strong>My Games</strong> and choose <strong>Adjust total playtime</strong>."
            components={{ strong: <strong className="text-text" /> }}
          />
        </p>
        <div className="rounded-lg border border-border bg-bg/60 p-3">
          <p className="font-semibold text-text">
            {t("World of Warcraft example")}
          </p>
          <p className="mt-1">
            <Trans
              t={t}
              i18nKey="Type <code>/played</code> on each of your characters and add up their total time for the WoW version you're importing."
              components={{ code: <code className="text-text" /> }}
            />
          </p>
        </div>
        <p>{t("PlayCounter tracks new sessions automatically.")}</p>
      </div>
    </Modal>
  );
}
