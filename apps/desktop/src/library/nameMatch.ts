import type { GameMetadata } from "../store";

/* docs/name-auto-match-plan.md: a launcher title the server could not match
   counts as matched when exactly one suggestion has the same name. */

/** A title as compared: without ™ ® © ℠, spaces collapsed, lower case, and
 *  ’ read as '. Punctuation stays: "Siege" vs ": Siege" is another name. */
function comparable(title: string) {
  return title
    .replace(/[™®©℠]/gu, "")
    .replace(/’/gu, "'")
    .replace(/\s+/gu, " ")
    .trim()
    .toLowerCase();
}

/** The one suggestion named like the launcher's title, or null when none or
 *  several are. */
export function nameMatch(
  title: string | undefined,
  candidates: readonly GameMetadata[] | undefined,
): GameMetadata | null {
  if (!title || !candidates?.length) return null;
  const wanted = comparable(title);
  if (!wanted) return null;
  const same = candidates.filter(
    (candidate) => comparable(candidate.name) === wanted,
  );
  return same.length === 1 ? same[0] : null;
}
