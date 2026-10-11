import type { Toast } from "../../store";
import { getT } from "../../i18n";

const t = getT("discovered");

/** Only one folder's Game.exe was ignored; nothing was reported. */
export function notifyFolderIgnored(
  exeName: string,
  folder: string,
  addToast: (toast: Omit<Toast, "id">) => void,
) {
  const folderName = folder.split(/[\\/]/).filter(Boolean).at(-1) ?? folder;
  addToast({
    tone: "success",
    title: t("{{exeName}} ignored in {{folderName}}", { exeName, folderName }),
    detail: t(
      "Only this folder, only on this PC. Other games with this file name are still tracked. Nothing was reported.",
    ),
  });
}
