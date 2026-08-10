import type { NotificationKind } from "./notifications";
import {
  GAME_HOURS,
  MONTH_HOURS,
  STREAK_DAYS,
  TOTAL_HOURS,
  VERIFIED_COUNTS,
} from "./milestones";

export type AchievementTier = "bronze" | "silver" | "gold" | "platinum";

export type AchievementIconName =
  | "trophy"
  | "calendar"
  | "gamepad"
  | "flame"
  | "badge-check"
  | "shield-check"
  | "circle-slash";

export type AchievementArt = {
  icon: AchievementIconName;
  tier: AchievementTier;
  frameClassName: string;
  label: string;
};

const TIERS: AchievementTier[] = ["bronze", "silver", "gold", "platinum"];

export function milestoneThreshold(id: string): number | null {
  const separator = id.lastIndexOf(":");
  if (separator < 0) return null;
  const threshold = Number(id.slice(separator + 1));
  return Number.isInteger(threshold) && threshold > 0 ? threshold : null;
}

export function achievementArt(input: {
  id: string;
  kind: NotificationKind;
}): AchievementArt {
  const threshold = milestoneThreshold(input.id);

  switch (input.kind) {
    case "milestone-total":
      return art(
        "trophy",
        tierForThreshold(TOTAL_HOURS, threshold),
        "total playtime",
      );
    case "milestone-month":
      return art(
        "calendar",
        tierForThreshold(MONTH_HOURS, threshold),
        "monthly playtime",
      );
    case "milestone-game":
      return art(
        "gamepad",
        tierForThreshold(GAME_HOURS, threshold),
        "game playtime",
      );
    case "milestone-streak":
      return art(
        "flame",
        tierForThreshold(STREAK_DAYS, threshold),
        "play streak",
      );
    case "milestone-verified":
      return art(
        "badge-check",
        tierForThreshold(VERIFIED_COUNTS, threshold),
        "verified contributions",
      );
    case "suggestion-verified":
      return art("shield-check", "bronze", "verified suggestion", false);
    case "suggestion-rejected":
      return art("circle-slash", "bronze", "reviewed suggestion", false);
    default:
      return assertNever(input.kind);
  }
}

function tierForThreshold(
  thresholds: readonly number[],
  threshold: number | null,
): AchievementTier {
  if (threshold === null) return "bronze";
  const index = thresholds.indexOf(threshold);
  if (index < 0) return "bronze";
  return (
    TIERS[Math.floor((index * TIERS.length) / thresholds.length)] ?? "bronze"
  );
}

function art(
  icon: AchievementIconName,
  tier: AchievementTier,
  subject: string,
  achievement = true,
): AchievementArt {
  return {
    icon,
    tier,
    frameClassName: frameClassName(tier),
    label: achievement
      ? `${capitalize(tier)} achievement: ${subject}`
      : `${capitalize(tier)} badge: ${subject}`,
  };
}

function frameClassName(tier: AchievementTier) {
  switch (tier) {
    case "bronze":
      return "achievement-badge achievement-badge-bronze";
    case "silver":
      return "achievement-badge achievement-badge-silver";
    case "gold":
      return "achievement-badge achievement-badge-gold";
    case "platinum":
      return "achievement-badge achievement-badge-platinum";
  }
}

function capitalize(value: string) {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

function assertNever(value: never): never {
  throw new Error(`Unhandled notification kind: ${String(value)}`);
}
