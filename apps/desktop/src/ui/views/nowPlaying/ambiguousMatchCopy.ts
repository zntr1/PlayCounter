import type { IdentifierFlagReason } from "@playcounter/shared";
import { getT } from "../../../i18n";

const t = getT("nowPlaying");

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
  genericName = false,
  softwareName,
}: {
  candidateCount: number;
  /** Name of the only candidate, when there is exactly one. */
  candidateName?: string;
  flagReason?: IdentifierFlagReason;
  /** A file name many games ship (Game.exe): asked once per folder. */
  genericName?: boolean;
  /** Known software on the same file name; candidateCount counts games. */
  softwareName?: string;
}): AmbiguousMatchCopy {
  if (softwareName) {
    return {
      eyebrow: t("Software or game?"),
      headline: t("What is {exe}?"),
      description: t(
        "{{software}} uses this file name, and so do {{count}} games. The file doesn't say which one this is. Pick what you started.",
        { software: softwareName, count: candidateCount },
      ),
    };
  }

  if (flagReason === "not_a_game") {
    return {
      eyebrow: t("Reported as not a game"),
      headline: t("Is {exe} a game?"),
      description:
        candidateCount === 1 && candidateName
          ? t(
              "Other players reported this file as not a game, so PlayCounter no longer matches it on its own. It still matches {{game}}.",
              { game: candidateName },
            )
          : candidateCount > 1
            ? t(
                "Other players reported this file as not a game, so PlayCounter no longer matches it on its own. It still matches {{count}} games.",
                { count: candidateCount },
              )
            : t(
                "Other players reported this file as not a game, so PlayCounter no longer matches it on its own.",
              ),
    };
  }

  if (genericName) {
    return {
      eyebrow: t("New game folder"),
      headline: t("Which game is {exe}?"),
      description:
        candidateCount > 0
          ? t(
              "Many games ship a file with this name, so PlayCounter asks once for each folder. Pick the game in this folder, or add it under its name.",
            )
          : t(
              "Many games ship a file with this name, so PlayCounter asks once for each folder. Add the game in this folder under its name.",
            ),
    };
  }

  if (candidateCount === 0) {
    return {
      eyebrow: t("Unidentified process"),
      headline: t("Which game is {exe}?"),
      description: t(
        "PlayCounter found this app running, but no game in the database uses this file name. Tell it once and it will remember.",
      ),
    };
  }

  return {
    eyebrow: t("Unidentified process"),
    headline: t("Which game is {exe}?"),
    description:
      candidateCount === 1
        ? t(
            "A game in the database uses this file name, but other apps might too, so PlayCounter won't guess. Pick it if that is what you started.",
          )
        : t(
            "{{candidateCount}} games in the database use this file name, so PlayCounter won't guess. Pick the one you started.",
            { candidateCount },
          ),
  };
}

export function formatAgo(seconds: number) {
  if (seconds < 60) return t("just now");
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours > 0
    ? t("{{hours}}h {{minutes}}m ago", { hours, minutes })
    : t("{{minutes}}m ago", { minutes });
}
