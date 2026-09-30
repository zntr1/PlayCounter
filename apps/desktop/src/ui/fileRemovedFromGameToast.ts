import type { Toast } from "../store";
import type { FileNotOfGameOutcome } from "../tracker";

/** After "It doesn't belong to <game>" in the report picker. */
export function notifyFileRemovedFromGame(
  exeName: string,
  gameName: string,
  outcome: FileNotOfGameOutcome,
  addToast: (toast: Omit<Toast, "id">) => void,
) {
  addToast({
    tone: outcome.report === "failed" ? "info" : "success",
    title: `${exeName} removed from ${gameName}`,
    detail: outcome.folder
      ? "Only from this game's folder, on this PC. Nothing was reported."
      : outcome.report === "skipped"
        ? "Only on this PC. Nothing was reported."
        : outcome.report === "failed"
          ? "Removed on this PC. The report could not be sent."
          : outcome.report === "already_reviewed"
            ? "Removed on this PC. Your earlier report was already reviewed."
            : "Reported for review. If it runs, it shows up in Discovered.",
  });
}
