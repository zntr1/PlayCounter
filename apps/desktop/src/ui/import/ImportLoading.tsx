import { Copy } from "lucide-react";
import { PlayCounterLoader } from "../../brand/PlayCounterLoader";
import { getT } from "../../i18n";
import { Panel } from "../components";
import { Button } from "../primitives";

const t = getT("import");

/** Step 2: PlayCounter's loader. Its text names the step the player waits on. */
export function ImportLoading({
  label,
  onCancel,
  onCopySignInLink,
}: {
  label: string;
  onCancel?: () => void;
  onCopySignInLink?: () => void;
}) {
  return (
    <Panel className="grid min-h-[360px] place-items-center p-8 text-center text-text-muted">
      <div>
        <PlayCounterLoader label={label} />
        {onCopySignInLink ? (
          <p className="mx-auto mt-2 max-w-md text-sm text-text-faint">
            {t(
              "Browser did not open, or opened the wrong account? Copy the sign-in link and open it yourself.",
            )}
          </p>
        ) : null}
        {onCancel || onCopySignInLink ? (
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {onCopySignInLink ? (
              <Button
                variant="secondary"
                icon={Copy}
                onClick={onCopySignInLink}
              >
                {t("Copy sign-in link")}
              </Button>
            ) : null}
            {onCancel ? (
              <Button variant="secondary" onClick={onCancel}>
                {t("Cancel import")}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </Panel>
  );
}
