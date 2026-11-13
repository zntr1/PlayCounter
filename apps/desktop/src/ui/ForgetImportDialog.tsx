import { LIBRARY_PROVIDER_LABELS } from "@playcounter/shared";
import type { LibraryProviderId } from "@playcounter/shared";
import { Trash2 } from "lucide-react";
import { getT } from "../i18n";
import { forgetImportedLibraryData } from "../tracker";
import { Button, Modal } from "./primitives";

const t = getT("settings");

// What Forget removes differs per launcher; the confirm dialog says it.
function forgetText(provider: LibraryProviderId) {
  switch (provider) {
    case "steam":
      return t(
        "Removes the Steam mark, the imported Steam playtime, the game files Steam linked, and where they are installed. Sessions PlayCounter recorded itself are kept.",
      );
    case "xbox":
      return t(
        "Removes the Xbox mark, the imported Xbox playtime, and the game files Xbox linked. Sessions PlayCounter recorded itself are kept.",
      );
    case "battlenet":
      return t(
        "Removes Battle.net imports and their installation links. Sessions PlayCounter recorded itself are kept.",
      );
    case "epic":
      return t(
        "Removes the Epic Games mark, the imported Epic playtime, the game files Epic linked, and where they are installed. Sessions PlayCounter recorded itself are kept.",
      );
    case "gog":
      return t(
        "Removes the GOG mark, the imported GOG playtime, the game files GOG linked, and where they are installed. Sessions PlayCounter recorded itself are kept.",
      );
    case "playstation":
      return t(
        "Removes the PlayStation mark and the imported PlayStation playtime. Sessions PlayCounter recorded itself, PS5 and PS4 sessions included, are kept.",
      );
  }
}

/** Asks before one launcher's imports go, and forgets them on confirm.
 *  Settings and the sidebar's launcher menu both open this. */
export function ForgetImportDialog({
  provider,
  onClose,
}: {
  provider: LibraryProviderId;
  onClose: () => void;
}) {
  const label = LIBRARY_PROVIDER_LABELS[provider];
  return (
    <Modal
      size="sm"
      labelId="forget-library-title"
      title={t("Forget imported {{forgetLibraryLabel}} data?", {
        forgetLibraryLabel: label,
      })}
      subtitle={t("Your recorded PlayCounter sessions will be kept.")}
      icon={Trash2}
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>{t("Cancel")}</Button>
          <Button
            variant="danger"
            onClick={() => {
              forgetImportedLibraryData(provider);
              onClose();
            }}
          >
            {t("Forget imported data")}
          </Button>
        </div>
      }
    >
      <div className="grid gap-2 text-sm text-text-muted">
        <p>{forgetText(provider)}</p>
        <p>
          {t(
            "{{forgetLibraryLabel}} badges and imported playtime floors will disappear. You can import the library again at any time.",
            { forgetLibraryLabel: label },
          )}
        </p>
      </div>
    </Modal>
  );
}
