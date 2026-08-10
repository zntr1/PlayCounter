import { describe, expect, it } from "vitest";
import {
  GAME_HOURS,
  MONTH_HOURS,
  STREAK_DAYS,
  TOTAL_HOURS,
  VERIFIED_COUNTS,
  type AwardedMilestone,
  type MilestoneMetrics,
  type MilestoneNotificationKind,
} from "../../../milestones";
import {
  GROUP_META,
  buildAchievementCatalog,
  buildGameLadders,
  buildMonthHistory,
  gameNameFromMilestoneTitle,
  monthLabel,
  recentUnlocks,
  remainderLabel,
  summarizeAchievements,
} from "./achievementCatalog";

describe("achievement catalog", () => {
  it("places community contributions first", () => {
    expect(GROUP_META[0].id).toBe("verified");
  });

  it("includes the fixed catalog with progress and an earned item", () => {
    const catalog = buildAchievementCatalog(
      [award("milestone:total:10", "milestone-total")],
      metrics({ totalHours: 12 }),
    );

    expect(catalog.get("total")).toHaveLength(TOTAL_HOURS.length);
    expect(catalog.get("month")).toHaveLength(MONTH_HOURS.length);
    expect(catalog.get("streak")).toHaveLength(STREAK_DAYS.length);
    expect(catalog.get("verified")).toHaveLength(VERIFIED_COUNTS.length);
    expect(catalog.get("game")).toEqual([]);
    expect(
      catalog.get("total")?.find((item) => item.threshold === 10)?.milestone,
    ).toBeTruthy();
    expect(
      catalog.get("total")?.find((item) => item.threshold === 50),
    ).toMatchObject({ currentValue: 12, milestone: undefined, isNext: true });
  });

  it("synthesizes one game ladder and marks its active rung", () => {
    const gameMetrics = metrics({
      totalHours: 120,
      games: new Map([
        ["igdb#42", { hours: 41, name: "Elden Ring", coverUrl: "cover" }],
      ]),
      canonicalByAlias: new Map([["igdb#42", "igdb#42"]]),
    });
    const catalog = buildAchievementCatalog(
      [
        award("milestone:total:10", "milestone-total"),
        award("milestone:total:50", "milestone-total"),
        award("milestone:total:100", "milestone-total"),
        award("milestone:game:igdb#42:10", "milestone-game", {
          title: "10 hours played in Elden Ring",
        }),
        award("milestone:game:igdb#42:25", "milestone-game", {
          title: "25 hours played in Elden Ring",
        }),
      ],
      gameMetrics,
    );

    const game = catalog.get("game") ?? [];
    expect(game).toHaveLength(GAME_HOURS.length);
    expect(game.filter((item) => item.milestone)).toHaveLength(2);
    expect(game.find((item) => item.threshold === 50)).toMatchObject({
      currentValue: 41,
      isNext: true,
      gameName: "Elden Ring",
    });
    const ladders = buildGameLadders(catalog);
    expect(ladders).toHaveLength(1);
    expect(ladders[0].rungs.map((item) => item.id)).toEqual(
      game.map((item) => item.id),
    );
  });

  it("collapses an alias-keyed game award onto the canonical rung", () => {
    const catalog = buildAchievementCatalog(
      [
        award("milestone:game:community:7:10", "milestone-game", {
          title: "10 hours played in Hollow Knight",
          aliasIds: ["milestone:game:igdb#99:10"],
        }),
      ],
      metrics({
        games: new Map([
          ["igdb#99", { hours: 18, name: "Hollow Knight", coverUrl: "cover" }],
        ]),
        canonicalByAlias: new Map([
          ["community:7", "igdb#99"],
          ["igdb#99", "igdb#99"],
        ]),
      }),
    );

    const rungs = catalog.get("game") ?? [];
    expect(rungs).toHaveLength(GAME_HOURS.length);
    expect(rungs.filter((item) => item.milestone)).toHaveLength(1);
    expect(rungs[0].id).toBe("milestone:game:igdb#99:10");
  });

  it("keeps earned game trophies when current game metrics are unavailable", () => {
    const catalog = buildAchievementCatalog(
      [
        award("milestone:game:community:77:10", "milestone-game", {
          title: "10 hours played in Celeste",
          coverUrl: "cover",
        }),
      ],
      metrics(),
    );

    const game = catalog.get("game") ?? [];
    expect(game).toHaveLength(GAME_HOURS.length);
    expect(game[0]).toMatchObject({
      gameName: "Celeste",
      currentValue: undefined,
      ratio: 1,
    });
    expect(game.find((item) => item.isNext)?.threshold).toBe(25);
  });

  it("skips already-reached but unreconciled locked rungs for next up", () => {
    const catalog = buildAchievementCatalog(
      [],
      metrics({
        games: new Map([
          ["igdb#5", { hours: 12, name: "Hades II", coverUrl: "cover" }],
        ]),
        canonicalByAlias: new Map([["igdb#5", "igdb#5"]]),
      }),
    );

    expect(
      (catalog.get("game") ?? []).find((item) => item.isNext),
    ).toMatchObject({
      id: "milestone:game:igdb#5:25",
      threshold: 25,
      currentValue: 12,
    });
  });

  it("marks the next ladder rung and clears it when the ladder is complete", () => {
    const active = buildAchievementCatalog([], metrics({ totalHours: 4 }));
    expect(active.get("total")?.find((item) => item.isNext)?.id).toBe(
      "milestone:total:10",
    );

    const allAwards = [
      ...TOTAL_HOURS.map((value) =>
        award(`milestone:total:${value}`, "milestone-total"),
      ),
      ...MONTH_HOURS.map((value) =>
        award(`milestone:month:2026-08:${value}`, "milestone-month"),
      ),
      ...STREAK_DAYS.map((value) =>
        award(`milestone:streak:${value}`, "milestone-streak"),
      ),
      ...VERIFIED_COUNTS.map((value) =>
        award(`milestone:verified:${value}`, "milestone-verified"),
      ),
    ];
    const complete = buildAchievementCatalog(allAwards, metrics());
    expect([...complete.values()].flat().filter((item) => item.isNext)).toEqual(
      [],
    );
  });

  it("normalizes current-month titles instead of exposing the storage key", () => {
    const catalog = buildAchievementCatalog(
      [
        award("milestone:month:2026-08:50", "milestone-month", {
          title: "50 hours played in 2026-08",
        }),
      ],
      metrics(),
    );

    expect(
      catalog.get("month")?.find((item) => item.threshold === 50)?.title,
    ).toBe(`50 hours played in ${monthLabel("2026-08")}`);
  });

  it("groups historical month milestones without inventing exact totals", () => {
    const catalog = buildAchievementCatalog(
      [
        award("milestone:month:2026-06:10", "milestone-month"),
        award("milestone:month:2026-06:25", "milestone-month"),
        award("milestone:month:2026-07:10", "milestone-month"),
      ],
      metrics(),
    );
    const history = buildMonthHistory(catalog, "2026-08");
    expect(history.map((month) => month.monthKey)).toEqual([
      "2026-07",
      "2026-06",
    ]);
    expect(history[1]).toMatchObject({ highestThreshold: 25 });
    expect(
      catalog.get("month")?.filter((item) => item.scope === "2026-08"),
    ).toHaveLength(MONTH_HOURS.length);
    expect(
      catalog.get("month")?.filter((item) => item.scope === "2026-06"),
    ).toHaveLength(2);
  });

  it("summarizes only the stable core denominator while tallying all earned tiers", () => {
    const catalog = buildAchievementCatalog(
      [
        award("milestone:total:10", "milestone-total"),
        award("milestone:month:2026-07:10", "milestone-month"),
        award("milestone:game:igdb#1:10", "milestone-game", {
          title: "10 hours played in Hades",
        }),
      ],
      metrics(),
    );
    const summary = summarizeAchievements(catalog, "2026-08");
    expect(summary).toMatchObject({
      fixedTotal: 23,
      fixedUnlocked: 1,
      gameTrophies: 1,
      pastMonthTrophies: 1,
    });
    expect(
      Object.values(summary.byTier).reduce((sum, value) => sum + value, 0),
    ).toBe(3);
  });

  it("sorts and caps recent unlocks", () => {
    const catalog = buildAchievementCatalog(
      TOTAL_HOURS.slice(0, 6).map((value, index) =>
        award(`milestone:total:${value}`, "milestone-total", {
          awardedAt: `2026-08-${String(index + 1).padStart(2, "0")}T12:00:00.000Z`,
        }),
      ),
      metrics(),
    );
    expect(recentUnlocks(catalog).map((item) => item.threshold)).toEqual([
      1000, 500, 250, 100, 50,
    ]);
  });
});

describe("achievement formatting", () => {
  it.each([
    ["10 hours played in Foo", 10, "Foo"],
    ["1,000 hours played in Foo: Bar 2", 1000, "Foo: Bar 2"],
    ["1\u202f000 hours played in Foo", 1000, "Foo"],
    ["1,000 hours played in a game", 1000, undefined],
    ["25 hours played in Foo", 50, undefined],
    ["Played a lot", 10, undefined],
    ["", 10, undefined],
  ])("extracts a safe name from %s", (title, threshold, expected) => {
    expect(gameNameFromMilestoneTitle(title, threshold)).toBe(expected);
  });

  it("formats singular and plural remainders", () => {
    const catalog = buildAchievementCatalog([], metrics({ totalHours: 9 }));
    const total = catalog.get("total")![0];
    expect(remainderLabel(total)).toBe("1 more hour");
    expect(
      remainderLabel({
        ...total,
        unit: "days",
        currentValue: 8,
        threshold: 10,
      }),
    ).toBe("2 more days");
    expect(
      remainderLabel({
        ...total,
        unit: "contributions",
        currentValue: 0,
        threshold: 1,
      }),
    ).toBe("1 more contribution");
  });
});

function metrics(overrides: Partial<MilestoneMetrics> = {}): MilestoneMetrics {
  return {
    totalHours: 0,
    monthKey: "2026-08",
    monthHours: 0,
    streakDays: 0,
    verifiedCount: 0,
    games: new Map(),
    canonicalByAlias: new Map(),
    ...overrides,
  };
}

function award(
  id: string,
  kind: MilestoneNotificationKind,
  overrides: Partial<AwardedMilestone> = {},
): AwardedMilestone {
  return {
    id,
    kind,
    title: id,
    awardedAt: "2026-08-10T12:00:00.000Z",
    ...overrides,
  };
}
