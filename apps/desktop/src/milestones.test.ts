import type { Session } from "@playcounter/shared";
import { describe, expect, it } from "vitest";
import { evaluateMilestones } from "./milestones";

function session(
  hours: number,
  startedAt = "2026-08-09T08:00:00.000Z",
): Session {
  return {
    id: Date.parse(startedAt),
    gameId: 42,
    gameName: "Test Game",
    source: "community",
    exeName: "game.exe",
    startedAt,
    endedAt: new Date(Date.parse(startedAt) + hours * 3_600_000).toISOString(),
    durationSeconds: hours * 3600,
  };
}

describe("milestones", () => {
  it("backfills reached milestones silently on first evaluation", () => {
    const result = evaluateMilestones({
      sessions: [session(55)],
      archivedSeconds: 0,
      archivedGameSeconds: {},
      playtimeAdjustments: {},
      verifiedContributions: 5,
      awardedMilestoneIds: [],
      milestonesInitializedAt: null,
      now: new Date("2026-08-09T12:00:00.000Z"),
    });
    expect(result.notifications).toEqual([]);
    expect(result.awardedMilestoneIds).toContain("milestone:total:50");
    expect(result.awardedMilestoneIds).toContain("milestone:verified:5");
  });

  it("fires each newly crossed threshold once and includes archived time", () => {
    const initializedAt = "2026-08-01T00:00:00.000Z";
    const first = evaluateMilestones({
      sessions: [session(1)],
      archivedSeconds: 9 * 3600,
      archivedGameSeconds: { "community:42": 9 * 3600 },
      playtimeAdjustments: {},
      verifiedContributions: 0,
      awardedMilestoneIds: [],
      milestonesInitializedAt: initializedAt,
      now: new Date("2026-08-09T12:00:00.000Z"),
    });
    expect(first.notifications.map((item) => item.id)).toContain(
      "milestone:total:10",
    );
    expect(first.notifications.map((item) => item.id)).toContain(
      "milestone:game:community:42:10",
    );

    const second = evaluateMilestones({
      sessions: [session(1)],
      archivedSeconds: 9 * 3600,
      archivedGameSeconds: { "community:42": 9 * 3600 },
      playtimeAdjustments: {},
      verifiedContributions: 0,
      awardedMilestoneIds: first.awardedMilestoneIds,
      milestonesInitializedAt: initializedAt,
      now: new Date("2026-08-09T12:00:00.000Z"),
    });
    expect(second.notifications).toEqual([]);
  });

  it("keeps the game cover on game milestone notifications", () => {
    const result = evaluateMilestones({
      sessions: [{ ...session(10), coverUrl: "cover.jpg" }],
      archivedSeconds: 0,
      archivedGameSeconds: {},
      playtimeAdjustments: {},
      verifiedContributions: 0,
      awardedMilestoneIds: [],
      milestonesInitializedAt: "2026-08-01T00:00:00.000Z",
      now: new Date("2026-08-09T20:00:00.000Z"),
    });

    expect(
      result.notifications.find(
        (notification) => notification.id === "milestone:game:community:42:10",
      )?.coverUrl,
    ).toBe("cover.jpg");
  });

  it("uses recurring calendar-month identifiers", () => {
    const august = evaluateMilestones({
      sessions: [session(10, "2026-08-09T08:00:00.000Z")],
      archivedSeconds: 0,
      archivedGameSeconds: {},
      playtimeAdjustments: {},
      verifiedContributions: 0,
      awardedMilestoneIds: [],
      milestonesInitializedAt: "2026-07-01T00:00:00.000Z",
      now: new Date("2026-08-10T12:00:00.000Z"),
    });
    const september = evaluateMilestones({
      sessions: [session(10, "2026-09-09T08:00:00.000Z")],
      archivedSeconds: 0,
      archivedGameSeconds: {},
      playtimeAdjustments: {},
      verifiedContributions: 0,
      awardedMilestoneIds: august.awardedMilestoneIds,
      milestonesInitializedAt: "2026-07-01T00:00:00.000Z",
      now: new Date("2026-09-10T12:00:00.000Z"),
    });
    expect(august.awardedMilestoneIds).toContain("milestone:month:2026-08:10");
    expect(september.notifications.map((item) => item.id)).toContain(
      "milestone:month:2026-09:10",
    );
  });

  it("merges archived aliases and does not re-award their milestones", () => {
    const result = evaluateMilestones({
      sessions: [session(1)],
      archivedSeconds: 9 * 3600,
      archivedGameSeconds: { "community:42": 9 * 3600 },
      playtimeAdjustments: {},
      verifiedContributions: 0,
      awardedMilestoneIds: ["milestone:game:community:42:10"],
      milestonesInitializedAt: "2026-08-01T00:00:00.000Z",
      resolveIgdbId: () => 12345,
      now: new Date("2026-08-09T12:00:00.000Z"),
    });
    expect(result.notifications.map((item) => item.id)).not.toContain(
      "milestone:game:igdb#12345:10",
    );
    expect(result.awardedMilestoneIds).toContain(
      "milestone:game:igdb#12345:10",
    );
  });

  it("counts positive adjustments in lifetime but not calendar milestones", () => {
    const result = evaluateMilestones({
      sessions: [session(9)],
      archivedSeconds: 0,
      archivedGameSeconds: {},
      playtimeAdjustments: { "community:42": 3600 },
      verifiedContributions: 0,
      awardedMilestoneIds: [],
      milestonesInitializedAt: "2026-08-01T00:00:00.000Z",
      now: new Date("2026-08-09T20:00:00.000Z"),
    });
    expect(result.notifications.map((item) => item.id)).toContain(
      "milestone:total:10",
    );
    expect(result.notifications.map((item) => item.id)).toContain(
      "milestone:game:community:42:10",
    );
    expect(result.notifications.map((item) => item.id)).not.toContain(
      "milestone:month:2026-08:10",
    );
  });

  it("clamps negative adjustments per game before computing global time", () => {
    const other = {
      ...session(10, "2026-08-08T08:00:00.000Z"),
      id: 99,
      gameId: 99,
      gameName: "Other Game",
      exeName: "other.exe",
    };
    const result = evaluateMilestones({
      sessions: [session(1), other],
      archivedSeconds: 0,
      archivedGameSeconds: {},
      playtimeAdjustments: { "community:42": -2 * 3600 },
      verifiedContributions: 0,
      awardedMilestoneIds: [],
      milestonesInitializedAt: "2026-08-01T00:00:00.000Z",
      now: new Date("2026-08-09T20:00:00.000Z"),
    });
    expect(result.notifications.map((item) => item.id)).toContain(
      "milestone:total:10",
    );
    expect(result.notifications.map((item) => item.id)).toContain(
      "milestone:game:community:99:10",
    );
  });
});
