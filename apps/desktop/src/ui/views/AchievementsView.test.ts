import { describe, expect, it } from "vitest";
import { milestoneMetrics, TOTAL_HOURS } from "../../milestones";
import { buildAchievementCatalog } from "./AchievementsView";

describe("achievement catalog", () => {
  it("includes locked thresholds with progress alongside earned achievements", () => {
    const metrics = milestoneMetrics({
      sessions: [],
      archivedSeconds: 12 * 3600,
      archivedGameSeconds: {},
      playtimeAdjustments: {},
      verifiedContributions: 0,
      now: new Date("2026-08-10T12:00:00.000Z"),
    });
    const catalog = buildAchievementCatalog(
      [
        {
          id: "milestone:total:10",
          kind: "milestone-total",
          title: "You've played 10 hours in total",
          awardedAt: "2026-08-10T12:00:00.000Z",
        },
      ],
      metrics,
    );

    const total = catalog.get("total") ?? [];
    expect(total).toHaveLength(TOTAL_HOURS.length);
    expect(total.find((item) => item.threshold === 10)?.milestone).toBeTruthy();
    expect(total.find((item) => item.threshold === 50)).toMatchObject({
      currentValue: 12,
      milestone: undefined,
    });

    expect(catalog.has("game")).toBe(false);

    expect(catalog.get("month")).toHaveLength(5);
    expect(catalog.get("streak")).toHaveLength(5);
    expect(catalog.get("verified")).toHaveLength(5);
  });
});
