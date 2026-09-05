import type { IdentifierFlagReason } from "@playcounter/shared";

/* Copy for one ambiguity card ────────────────────────────────────────────────
   The card asks one question and explains it once. Which question depends on
   why the executable landed here: the database lists it under several games
   (or none), or other players reported the file as not a game at all. */

export type AmbiguousMatchCopy = {
  eyebrow: string;
  /** Rendered with the exe name in monospace; `{exe}` marks its position. */
  headline: string;
  description: string;
};

export function ambiguousMatchCopy({
  candidateCount,
  candidateName,
  flagReason,
}: {
  candidateCount: number;
  /** Name of the only candidate, when there is exactly one. */
  candidateName?: string;
  flagReason?: IdentifierFlagReason;
}): AmbiguousMatchCopy {
  if (flagReason === "not_a_game") {
    const suffix =
      candidateCount === 1 && candidateName
        ? ` It still matches ${candidateName}.`
        : candidateCount > 1
          ? ` It still matches ${candidateCount} games.`
          : "";
    return {
      eyebrow: "Reported as not a game",
      headline: "Is {exe} a game?",
      description: `Other players reported this file as not a game, so PlayCounter no longer matches it on its own.${suffix}`,
    };
  }

  if (candidateCount === 0) {
    return {
      eyebrow: "Unidentified process",
      headline: "Which game is {exe}?",
      description:
        "PlayCounter found this app running, but no game in the database uses this file name. Tell it once and it will remember.",
    };
  }

  return {
    eyebrow: "Unidentified process",
    headline: "Which game is {exe}?",
    description:
      candidateCount === 1
        ? "A game in the database uses this file name, but other apps might too, so PlayCounter won't guess. Pick it if that is what you started."
        : `${candidateCount} games in the database use this file name, so PlayCounter won't guess. Pick the one you started.`,
  };
}

export function formatAgo(seconds: number) {
  if (seconds < 60) return "just now";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours > 0 ? `${hours}h ${minutes}m ago` : `${minutes}m ago`;
}
