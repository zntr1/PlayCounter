import { getT } from "../i18n";

const t = getT("common");

/** A toast's line once a database game picked for a shared file (Game.exe,
 *  Wow.exe) went to review from its folder (docs/shared-file-suggestions-plan.md). */
export function sentForReviewDetail(exeName: string, name: string) {
  return t(
    "{{name}} is tracked from this folder. {{exeName}} was sent for review. Once it is approved, other players can pick {{name}} for it too.",
    { exeName, name },
  );
}
