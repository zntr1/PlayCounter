import type { Toast } from "../store";
import type { FileNotOfGameOutcome } from "../tracker";
import { getT } from "../i18n";

const t = getT("dialogs");

/** After "It doesn't belong to <game>" in the report picker. */
export function notifyFileRemovedFromGame(
  exeName: string,
  gameName: string,
  outcome: FileNotOfGameOutcome,
  addToast: (toast: Omit<Toast, "id">) => void,
) {
  addToast({
    tone: outcome.report === "failed" ? "info" : "success",
    title: t("{{exeName}} removed from {{gameName}}", { exeName, gameName }),
    detail: outcome.folder
      ? t("Only from this game's folder, on this PC. Nothing was reported.")
      : outcome.report === "skipped"
        ? t("Only on this PC. Nothing was reported.")
        : outcome.report === "failed"
          ? t("Removed on this PC. The report could not be sent.")
          : outcome.report === "already_reviewed"
            ? t("Removed on this PC. Your earlier report was already reviewed.")
            : t("Reported for review. If it runs, it shows up in Discovered."),
  });
}
