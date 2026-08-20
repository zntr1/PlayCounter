import type { Session } from "@playcounter/shared";
import { describe, expect, it } from "vitest";
import {
  evaluateMilestones,
  migrateAwardedMilestones,
  parseMilestoneId,
} from "./milestones";

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
    expect(
      august.notifications.find(
        (notification) => notification.id === "milestone:month:2026-08:10",
      )?.title,
    ).toContain("2026");
    expect(september.notifications.map((item) => item.id)).toContain(
      "milestone:month:2026-09:10",
    );
  });

  it("orders simultaneously reached thresholds from highest to lowest", () => {
    const result = evaluateMilestones({
      sessions: [session(1_000)],
      archivedSeconds: 0,
      archivedGameSeconds: {},
      playtimeAdjustments: {},
      verifiedContributions: 0,
      awardedMilestoneIds: [],
      milestonesInitializedAt: "2026-08-01T00:00:00.000Z",
      now: new Date("2026-09-30T12:00:00.000Z"),
    });

    expect(
      result.notifications
        .filter((notification) => notification.kind === "milestone-game")
        .map((notification) => notification.id),
    ).toEqual([
      "milestone:game:community:42:1000",
      "milestone:game:community:42:500",
      "milestone:game:community:42:250",
      "milestone:game:community:42:100",
      "milestone:game:community:42:50",
      "milestone:game:community:42:25",
      "milestone:game:community:42:10",
    ]);
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

  it("records exact award times after achievement tracking is initialized", () => {
    const now = new Date("2026-08-10T12:34:56.000Z");
    const result = evaluateMilestones({
      sessions: [session(10)],
      archivedSeconds: 0,
      archivedGameSeconds: {},
      playtimeAdjustments: {},
      verifiedContributions: 0,
      awardedMilestones: [],
      milestonesInitializedAt: "2026-08-01T00:00:00.000Z",
      now,
    });

    expect(
      result.awardedMilestones.find(
        (milestone) => milestone.id === "milestone:total:10",
      ),
    ).toMatchObject({ awardedAt: now.toISOString() });
    expect(
      result.awardedMilestones.find(
        (milestone) => milestone.id === "milestone:total:10",
      )?.backfilled,
    ).toBeUndefined();
  });

  it("dates first-run achievements once without notifying", () => {
    const now = new Date("2026-08-10T12:00:00.000Z");
    const result = evaluateMilestones({
      sessions: [session(10)],
      archivedSeconds: 0,
      archivedGameSeconds: {},
      playtimeAdjustments: {},
      verifiedContributions: 0,
      awardedMilestones: [],
      milestonesInitializedAt: null,
      now,
    });

    expect(result.notifications).toEqual([]);
    expect(result.awardedMilestones.length).toBeGreaterThan(0);
    expect(
      result.awardedMilestones.every(
        (item) => item.awardedAt === now.toISOString() && !item.backfilled,
      ),
    ).toBe(true);
  });

  it("revokes game and total achievements when the only game is adjusted below them", () => {
    const earned = evaluateMilestones({
      sessions: [session(20)],
      archivedSeconds: 0,
      archivedGameSeconds: {},
      playtimeAdjustments: {},
      verifiedContributions: 0,
      awardedMilestones: [],
      milestonesInitializedAt: "2026-08-01T00:00:00.000Z",
      now: new Date("2026-08-10T12:00:00.000Z"),
    });
    const lowered = evaluateMilestones({
      sessions: [session(20)],
      archivedSeconds: 0,
      archivedGameSeconds: {},
      playtimeAdjustments: { "community:42": -15 * 3600 },
      verifiedContributions: 0,
      awardedMilestones: earned.awardedMilestones,
      milestonesInitializedAt: earned.milestonesInitializedAt,
      now: new Date("2026-08-11T12:00:00.000Z"),
    });

    expect(lowered.revokedMilestoneIds).toEqual(
      expect.arrayContaining([
        "milestone:total:10",
        "milestone:game:community:42:10",
      ]),
    );
    expect(lowered.awardedMilestoneIds).not.toContain("milestone:total:10");
    expect(lowered.awardedMilestoneIds).not.toContain(
      "milestone:game:community:42:10",
    );
    expect(lowered.notifications).toEqual([]);
  });

  it("revokes playtime achievements when all history for the only game is deleted", () => {
    const earned = evaluateMilestones({
      sessions: [session(20)],
      archivedSeconds: 0,
      archivedGameSeconds: {},
      playtimeAdjustments: {},
      verifiedContributions: 0,
      awardedMilestones: [],
      milestonesInitializedAt: "2026-08-01T00:00:00.000Z",
      now: new Date("2026-08-10T12:00:00.000Z"),
    });
    const deleted = evaluateMilestones({
      sessions: [],
      archivedSeconds: 0,
      archivedGameSeconds: {},
      playtimeAdjustments: {},
      verifiedContributions: 0,
      awardedMilestones: earned.awardedMilestones,
      milestonesInitializedAt: earned.milestonesInitializedAt,
      now: new Date("2026-08-11T12:00:00.000Z"),
    });

    expect(deleted.awardedMilestones.map((item) => item.id)).not.toContain(
      "milestone:total:10",
    );
    expect(deleted.awardedMilestones.map((item) => item.id)).not.toContain(
      "milestone:game:community:42:10",
    );
  });

  it("can award a revoked achievement again with a new timestamp", () => {
    const earned = evaluateMilestones({
      sessions: [session(20)],
      archivedSeconds: 0,
      archivedGameSeconds: {},
      playtimeAdjustments: {},
      verifiedContributions: 0,
      awardedMilestones: [],
      milestonesInitializedAt: "2026-08-01T00:00:00.000Z",
      now: new Date("2026-08-10T12:00:00.000Z"),
    });
    const lowered = evaluateMilestones({
      sessions: [session(20)],
      archivedSeconds: 0,
      archivedGameSeconds: {},
      playtimeAdjustments: { "community:42": -15 * 3600 },
      verifiedContributions: 0,
      awardedMilestones: earned.awardedMilestones,
      milestonesInitializedAt: earned.milestonesInitializedAt,
      now: new Date("2026-08-11T12:00:00.000Z"),
    });
    const reearnedAt = new Date("2026-08-12T12:00:00.000Z");
    const reearned = evaluateMilestones({
      sessions: [session(20)],
      archivedSeconds: 0,
      archivedGameSeconds: {},
      playtimeAdjustments: {},
      verifiedContributions: 0,
      awardedMilestones: lowered.awardedMilestones,
      milestonesInitializedAt: lowered.milestonesInitializedAt,
      now: reearnedAt,
    });

    expect(
      reearned.awardedMilestones.find(
        (item) => item.id === "milestone:game:community:42:10",
      )?.awardedAt,
    ).toBe(reearnedAt.toISOString());
    expect(reearned.notifications.map((item) => item.id)).toContain(
      "milestone:game:community:42:10",
    );
  });

  it("keeps monthly and previously awarded streak achievements when retained history shrinks", () => {
    const earned = evaluateMilestones({
      sessions: [
        session(10),
        session(1, "2026-08-08T08:00:00.000Z"),
        session(1, "2026-08-07T08:00:00.000Z"),
      ],
      archivedSeconds: 0,
      archivedGameSeconds: {},
      playtimeAdjustments: {},
      verifiedContributions: 0,
      awardedMilestones: [],
      milestonesInitializedAt: "2026-08-01T00:00:00.000Z",
      now: new Date("2026-08-09T12:00:00.000Z"),
    });
    const shrunk = evaluateMilestones({
      sessions: [],
      archivedSeconds: 0,
      archivedGameSeconds: {},
      playtimeAdjustments: {},
      verifiedContributions: 0,
      awardedMilestones: [
        ...earned.awardedMilestones,
        {
          id: "milestone:streak:3",
          kind: "milestone-streak",
          title: "3-day play streak",
          awardedAt: "2026-08-09T12:00:00.000Z",
        },
      ],
      milestonesInitializedAt: earned.milestonesInitializedAt,
      now: new Date("2026-08-12T12:00:00.000Z"),
    });

    expect(shrunk.awardedMilestoneIds).toContain("milestone:month:2026-08:10");
    expect(shrunk.awardedMilestoneIds).toContain("milestone:streak:3");
  });

  it("does not award play streak achievements while they are disabled", () => {
    const result = evaluateMilestones({
      sessions: [
        session(1, "2026-08-08T08:00:00.000Z"),
        session(1, "2026-08-07T08:00:00.000Z"),
        session(1, "2026-08-06T08:00:00.000Z"),
      ],
      archivedSeconds: 0,
      archivedGameSeconds: {},
      playtimeAdjustments: {},
      verifiedContributions: 0,
      awardedMilestones: [],
      milestonesInitializedAt: "2026-08-01T00:00:00.000Z",
      now: new Date("2026-08-09T12:00:00.000Z"),
    });

    expect(result.awardedMilestoneIds).not.toContain("milestone:streak:3");
    expect(result.notifications.map((item) => item.id)).not.toContain(
      "milestone:streak:3",
    );
  });

  it("revokes verified achievements only with an authoritative server count", () => {
    const award = {
      id: "milestone:verified:5",
      kind: "milestone-verified" as const,
      title: "5 contributions approved",
      awardedAt: "2026-08-10T12:00:00.000Z",
    };
    const base = {
      sessions: [],
      archivedSeconds: 0,
      archivedGameSeconds: {},
      playtimeAdjustments: {},
      verifiedContributions: 0,
      awardedMilestones: [award],
      milestonesInitializedAt: "2026-08-01T00:00:00.000Z",
      now: new Date("2026-08-11T12:00:00.000Z"),
    };

    expect(evaluateMilestones(base).awardedMilestoneIds).toContain(award.id);
    expect(
      evaluateMilestones({
        ...base,
        verifiedContributionsAuthoritative: true,
      }).awardedMilestoneIds,
    ).not.toContain(award.id);
  });

  it("tracks emulator approvals separately and revokes them only authoritatively", () => {
    const earned = evaluateMilestones({
      sessions: [],
      archivedSeconds: 0,
      archivedGameSeconds: {},
      playtimeAdjustments: {},
      verifiedContributions: 0,
      verifiedEmulatorContributions: 1,
      awardedMilestones: [],
      milestonesInitializedAt: "2026-08-01T00:00:00.000Z",
      now: new Date("2026-08-10T12:00:00.000Z"),
    });
    expect(earned.notifications.map((item) => item.id)).toContain(
      "milestone:emulator:1",
    );
    expect(earned.awardedMilestoneIds).not.toContain("milestone:verified:1");

    const base = {
      sessions: [],
      archivedSeconds: 0,
      archivedGameSeconds: {},
      playtimeAdjustments: {},
      verifiedContributions: 0,
      verifiedEmulatorContributions: 0,
      awardedMilestones: earned.awardedMilestones,
      milestonesInitializedAt: earned.milestonesInitializedAt,
      now: new Date("2026-08-11T12:00:00.000Z"),
    };
    expect(
      evaluateMilestones({
        ...base,
        verifiedContributionsAuthoritative: true,
      }).awardedMilestoneIds,
    ).toContain("milestone:emulator:1");
    expect(
      evaluateMilestones({
        ...base,
        emulatorContributionsAuthoritative: true,
      }).awardedMilestoneIds,
    ).not.toContain("milestone:emulator:1");
  });

  it.each([
    ["milestone:total:10", { category: "total", scope: "", threshold: 10 }],
    [
      "milestone:game:community:42:25",
      { category: "game", scope: "community:42", threshold: 25 },
    ],
    [
      "milestone:month:2026-08:10",
      { category: "month", scope: "2026-08", threshold: 10 },
    ],
    ["milestone:emulator:3", { category: "emulator", scope: "", threshold: 3 }],
    ["not-a-milestone", null],
  ])("parses milestone id %s", (id, expected) => {
    expect(parseMilestoneId(id)).toEqual(expected);
  });

  it("dates legacy ids on migration and keeps that date on later starts", () => {
    const initializedAt = "2026-08-01T00:00:00.000Z";
    const firstStart = new Date("2026-08-10T12:00:00.000Z");
    const migrated = migrateAwardedMilestones({
      awardedMilestoneIds: ["milestone:total:10", "junk"],
      milestonesInitializedAt: initializedAt,
      now: firstStart,
    });
    expect(migrated).toEqual([
      expect.objectContaining({
        id: "milestone:total:10",
        awardedAt: firstStart.toISOString(),
      }),
    ]);
    expect(migrated[0].backfilled).toBeUndefined();
    expect(
      migrateAwardedMilestones({
        awardedMilestones: migrated,
        now: new Date("2026-08-20T12:00:00.000Z"),
      })[0]?.awardedAt,
    ).toBe(firstStart.toISOString());
    const previouslyBackfilled = migrateAwardedMilestones({
      awardedMilestones: [
        {
          ...migrated[0],
          awardedAt: initializedAt,
          backfilled: true,
        },
      ],
      now: firstStart,
    })[0];
    expect(previouslyBackfilled.awardedAt).toBe(firstStart.toISOString());
    expect(previouslyBackfilled.backfilled).toBeUndefined();
  });
});
