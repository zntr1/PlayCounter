import { describe, expect, it } from "vitest";
import {
  achievementArt,
  milestoneThreshold,
  type AchievementIconName,
  type AchievementTier,
} from "./achievementArt";
import {
  EMULATOR_VERIFIED_COUNTS,
  GAME_HOURS,
  MONTH_HOURS,
  STREAK_DAYS,
  TOTAL_HOURS,
  VERIFIED_COUNTS,
} from "./milestones";
import type { NotificationKind } from "./notifications";

const EXPECTED_ICONS: Record<NotificationKind, AchievementIconName> = {
  "suggestion-verified": "shield-check",
  "suggestion-rejected": "circle-slash",
  "milestone-total": "trophy",
  "milestone-month": "calendar",
  "milestone-game": "gamepad",
  "milestone-streak": "flame",
  "milestone-verified": "badge-check",
  "milestone-emulator": "joystick",
  "discovered-review": "list-checks",
};

const TIER_INDEX: Record<AchievementTier, number> = {
  bronze: 0,
  silver: 1,
  gold: 2,
  platinum: 3,
  diamond: 4,
  master: 5,
  grandmaster: 6,
  legendary: 7,
};

describe("achievement art", () => {
  it.each([
    ["milestone:total:50", 50],
    ["milestone:month:2026-08:10", 10],
    ["milestone:game:community:42:25", 25],
    ["milestone:game:igdb#12345:250", 250],
    ["milestone:streak:7", 7],
    ["milestone:verified:1", 1],
    ["milestone:emulator:3", 3],
  ])("parses the threshold from %s", (id, threshold) => {
    expect(milestoneThreshold(id)).toBe(threshold);
  });

  it("returns fitting, complete fallback art for every notification kind", () => {
    for (const kind of Object.keys(EXPECTED_ICONS) as NotificationKind[]) {
      const result = achievementArt({ id: `${kind}:10`, kind });
      expect(result.icon).toBe(EXPECTED_ICONS[kind]);
      expect(result.frameClassName).toContain("achievement-badge");
      expect(result.label).toBeTruthy();
    }
  });

  it.each([
    ["milestone-total", TOTAL_HOURS],
    ["milestone-month", MONTH_HOURS],
    ["milestone-game", GAME_HOURS],
    ["milestone-streak", STREAK_DAYS],
    ["milestone-verified", VERIFIED_COUNTS],
    ["milestone-emulator", EMULATOR_VERIFIED_COUNTS],
  ] satisfies [NotificationKind, number[]][])(
    "assigns a distinct progression through legendary for %s",
    (kind, thresholds) => {
      const tiers = thresholds.map(
        (threshold) =>
          achievementArt({ id: `${kind}:${threshold}`, kind }).tier,
      );
      expect(tiers.at(-1)).toBe("legendary");
      expect(new Set(tiers).size).toBe(thresholds.length);
      expect(tiers.map((tier) => TIER_INDEX[tier])).toEqual(
        [...tiers.map((tier) => TIER_INDEX[tier])].sort((a, b) => a - b),
      );
    },
  );

  it("derives art from the fields present on legacy notifications", () => {
    expect(
      achievementArt({
        id: "milestone:game:community:42:10",
        kind: "milestone-game",
      }),
    ).toMatchObject({ icon: "gamepad", tier: "bronze" });
  });

  it("labels the discovered cleanup reminder without achievement wording", () => {
    expect(
      achievementArt({
        id: "discovered-review-backlog",
        kind: "discovered-review",
      }),
    ).toMatchObject({
      icon: "list-checks",
      label: "Reminder: apps waiting for review",
    });
  });

  it.each(["milestone:total:", "milestone:total:abc", ""])(
    "uses a safe default for an invalid id (%s)",
    (id) => {
      expect(achievementArt({ id, kind: "milestone-total" })).toMatchObject({
        icon: "trophy",
        tier: "bronze",
      });
    },
  );
});
