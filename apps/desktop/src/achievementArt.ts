import type { NotificationKind } from "./notifications";
import {
  EMULATOR_VERIFIED_COUNTS,
  GAME_HOURS,
  MONTH_HOURS,
  STREAK_DAYS,
  TOTAL_HOURS,
  VERIFIED_COUNTS,
} from "./milestones";
import { getT } from "./i18n";

const t = getT("achievements");

export const ACHIEVEMENT_TIERS = [
  "bronze",
  "silver",
  "gold",
  "platinum",
  "diamond",
  "master",
  "grandmaster",
  "legendary",
] as const;

export type AchievementTier = (typeof ACHIEVEMENT_TIERS)[number];

export type AchievementIconName =
  | "trophy"
  | "calendar"
  | "gamepad"
  | "flame"
  | "badge-check"
  | "joystick"
  | "shield-check"
  | "circle-slash"
  | "list-checks"
  | "message-square";

export type AchievementArt = {
  icon: AchievementIconName;
  tier: AchievementTier;
  frameClassName: string;
  label: string;
};

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
    case "feedback-reply":
      return art(
        "message-square",
        "bronze",
        t("feedback reply"),
        false,
        t("Reply from PlayCounter"),
      );
    case "milestone-total":
      return art(
        "trophy",
        tierForThreshold(TOTAL_HOURS, threshold),
        t("total playtime"),
      );
    case "milestone-month":
      return art(
        "calendar",
        tierForThreshold(MONTH_HOURS, threshold),
        t("monthly playtime"),
      );
    case "milestone-game":
      return art(
        "gamepad",
        tierForThreshold(GAME_HOURS, threshold),
        t("game playtime"),
      );
    case "milestone-streak":
      return art(
        "flame",
        tierForThreshold(STREAK_DAYS, threshold),
        t("play streak"),
      );
    case "milestone-verified":
      return art(
        "badge-check",
        tierForThreshold(VERIFIED_COUNTS, threshold),
        t("approved suggestions"),
      );
    case "milestone-emulator":
      return art(
        "joystick",
        tierForThreshold(EMULATOR_VERIFIED_COUNTS, threshold),
        t("approved emulator matches"),
      );
    case "suggestion-verified":
      return art("shield-check", "bronze", t("approved suggestion"), false);
    case "suggestion-rejected":
      return art("circle-slash", "bronze", t("reviewed suggestion"), false);
    case "discovered-review":
      return art(
        "list-checks",
        "bronze",
        t("apps waiting for review"),
        false,
        t("Reminder: apps waiting for review"),
      );
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
  if (index === thresholds.length - 1) return "legendary";
  return (
    ACHIEVEMENT_TIERS[Math.min(index, ACHIEVEMENT_TIERS.length - 2)] ?? "bronze"
  );
}

function art(
  icon: AchievementIconName,
  tier: AchievementTier,
  subject: string,
  achievement = true,
  label?: string,
): AchievementArt {
  return {
    icon,
    tier,
    frameClassName: frameClassName(tier),
    label:
      label ??
      (achievement
        ? t("{{tier}} achievement: {{subject}}", {
            tier: tierLabel(tier),
            subject,
          })
        : t("{{tier}} badge: {{subject}}", { tier: tierLabel(tier), subject })),
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
    case "diamond":
      return "achievement-badge achievement-badge-diamond";
    case "master":
      return "achievement-badge achievement-badge-master";
    case "grandmaster":
      return "achievement-badge achievement-badge-grandmaster";
    case "legendary":
      return "achievement-badge achievement-badge-legendary";
  }
}

export function tierLabel(tier: AchievementTier) {
  switch (tier) {
    case "bronze":
      return t("Bronze");
    case "silver":
      return t("Silver");
    case "gold":
      return t("Gold");
    case "platinum":
      return t("Platinum");
    case "diamond":
      return t("Diamond");
    case "master":
      return t("Master");
    case "grandmaster":
      return t("Grandmaster");
    case "legendary":
      return t("Legendary");
  }
}

function assertNever(value: never): never {
  // i18n-exempt: impossible case, never shown.
  throw new Error(`Unhandled notification kind: ${String(value)}`);
}
