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
      verifiedContributions: 0,
      awardedMilestoneIds: first.awardedMilestoneIds,
      milestonesInitializedAt: initializedAt,
      now: new Date("2026-08-09T12:00:00.000Z"),
    });
    expect(second.notifications).toEqual([]);
  });

  it("uses recurring calendar-month identifiers", () => {
    const august = evaluateMilestones({
      sessions: [session(10, "2026-08-09T08:00:00.000Z")],
      archivedSeconds: 0,
      archivedGameSeconds: {},
      verifiedContributions: 0,
      awardedMilestoneIds: [],
      milestonesInitializedAt: "2026-07-01T00:00:00.000Z",
      now: new Date("2026-08-10T12:00:00.000Z"),
    });
    const september = evaluateMilestones({
      sessions: [session(10, "2026-09-09T08:00:00.000Z")],
      archivedSeconds: 0,
      archivedGameSeconds: {},
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
});
