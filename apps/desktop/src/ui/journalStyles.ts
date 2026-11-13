import {
  Ban,
  Bookmark,
  Check,
  Pause,
  Play,
  RotateCcw,
  type LucideIcon,
} from "lucide-react";
import {
  GAME_STATUSES,
  type GameStatus,
  type GameTier,
} from "../personalLibrary";

/** Progress status is the one place in the journal where colour carries
 *  meaning, so each status owns an icon and a hue and keeps them on every
 *  surface: the library cover, the status menus, the filter pills, and the
 *  journal header. The icon says it without the colour; the colours are their
 *  own (styles.css), never the accent, and green is not In progress because a
 *  running game's card is green. Filled icons read better at badge size. */
export const STATUS_TONES: Record<
  GameStatus,
  { icon: LucideIcon; filled: boolean; text: string }
> = {
  playing: { icon: Play, filled: true, text: "text-status-playing" },
  "on-hold": { icon: Pause, filled: true, text: "text-status-on-hold" },
  finished: { icon: Check, filled: false, text: "text-status-finished" },
  "want-to-play": {
    icon: Bookmark,
    filled: true,
    text: "text-status-want-to-play",
  },
  "want-to-replay": {
    icon: RotateCcw,
    filled: false,
    text: "text-status-want-to-replay",
  },
  "not-planned": {
    icon: Ban,
    filled: false,
    text: "text-status-not-planned",
  },
};

export const GAME_STATUS_LIST = Object.keys(GAME_STATUSES) as GameStatus[];

/** Tier-list colours, hot to cold (styles.css): on the black cover badge and
 *  on the card menu's Tier group. */
export const TIER_TONES: Record<GameTier, string> = {
  S: "text-tier-s",
  A: "text-tier-a",
  B: "text-tier-b",
  C: "text-tier-c",
  D: "text-tier-d",
  F: "text-tier-f",
};

/** First line of a note, trimmed to fit a single-line preview. */
export function notePreview(note: string, limit = 120) {
  const line = note.trim().split("\n", 1)[0].trim();
  return line.length > limit ? `${line.slice(0, limit - 1)}…` : line;
}
