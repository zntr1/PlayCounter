import {
  GAME_STATUSES,
  type GameStatus,
  type GameTier,
} from "../personalLibrary";

/** Progress status is the one place in the journal where colour carries
 *  meaning, so each status owns a hue and keeps it on every surface: the
 *  library cover, the filter pills, and the journal header. */
export const STATUS_TONES: Record<GameStatus, { dot: string; chip: string }> = {
  playing: {
    dot: "bg-success",
    chip: "border-success-border bg-success-tint text-success",
  },
  "on-hold": {
    dot: "bg-warning",
    chip: "border-warning-border bg-warning-tint text-warning",
  },
  finished: {
    dot: "bg-accent",
    chip: "border-accent/50 bg-accent-tint text-accent-ink",
  },
  "want-to-play": {
    dot: "bg-text-muted",
    chip: "border-border bg-surface-hover text-text-muted",
  },
  "want-to-replay": {
    dot: "bg-community",
    chip: "border-community-border bg-community-tint text-community",
  },
  "not-planned": {
    dot: "bg-text-faint",
    chip: "border-dashed border-border bg-transparent text-text-faint",
  },
};

export const GAME_STATUS_LIST = Object.keys(GAME_STATUSES) as GameStatus[];

/** Tier-list colours, hot to cold. Only drawn on the dark cover badge. */
export const TIER_TONES: Record<GameTier, string> = {
  S: "text-rose-300",
  A: "text-orange-300",
  B: "text-amber-200",
  C: "text-lime-300",
  D: "text-sky-300",
  F: "text-zinc-400",
};

/** First line of a note, trimmed to fit a single-line preview. */
export function notePreview(note: string, limit = 120) {
  const line = note.trim().split("\n", 1)[0].trim();
  return line.length > limit ? `${line.slice(0, limit - 1)}…` : line;
}
