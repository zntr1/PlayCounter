import { beforeEach, describe, expect, it } from "vitest";
import { useAppStore } from "./store";
import { MAX_STORED_SESSIONS } from "./sessionPersistence";

beforeEach(() => {
  useAppStore.setState({
    installUuid: null,
    contributionOwnerUuid: null,
    seenContributionStatus: {},
    contributionCounts: { suggested: 0, verified: 0, pending: 0, rejected: 0 },
    notifications: [],
    awardedMilestoneIds: [],
    archivedSeconds: 0,
    archivedGameSeconds: {},
  });
});

describe("contribution identity", () => {
  it("clears only contribution-scoped state when the resolved UUID changes", () => {
    useAppStore.setState({
      contributionOwnerUuid: "old",
      seenContributionStatus: { suggestion: "verified" },
      contributionCounts: {
        suggested: 1,
        verified: 1,
        pending: 0,
        rejected: 0,
      },
      notifications: [
        {
          id: "suggestion-verified:test",
          kind: "suggestion-verified",
          title: "Verified",
          createdAt: "2026-08-09T00:00:00.000Z",
        },
        {
          id: "milestone:total:10",
          kind: "milestone-total",
          title: "10 hours",
          createdAt: "2026-08-09T00:00:00.000Z",
        },
      ],
      awardedMilestoneIds: ["milestone:total:10"],
      archivedSeconds: 3600,
    });

    useAppStore.getState().adoptInstallIdentity("new");
    const state = useAppStore.getState();
    expect(state.installUuid).toBe("new");
    expect(state.contributionOwnerUuid).toBe("new");
    expect(state.seenContributionStatus).toEqual({});
    expect(state.contributionCounts.suggested).toBe(0);
    expect(state.notifications.map((item) => item.id)).toEqual([
      "milestone:total:10",
    ]);
    expect(state.awardedMilestoneIds).toEqual(["milestone:total:10"]);
    expect(state.archivedSeconds).toBe(3600);
  });

  it("keeps contribution state when the UUID matches", () => {
    useAppStore.setState({
      contributionOwnerUuid: "same",
      seenContributionStatus: { suggestion: "pending" },
      contributionCounts: {
        suggested: 1,
        verified: 0,
        pending: 1,
        rejected: 0,
      },
    });
    useAppStore.getState().adoptInstallIdentity("same");
    expect(useAppStore.getState().seenContributionStatus).toEqual({
      suggestion: "pending",
    });
  });
});

describe("archived game rekeying", () => {
  it("moves the source bucket into the destination", () => {
    useAppStore.setState({
      archivedGameSeconds: { "custom:-1": 120, "community:42": 30 },
    });
    useAppStore
      .getState()
      .rekeyArchivedGameSeconds("custom:-1", "community:42");
    expect(useAppStore.getState().archivedGameSeconds).toEqual({
      "community:42": 150,
    });
  });

  it("keeps lifetime increasing when a new session exceeds the retained cap", () => {
    const sessions = Array.from({ length: MAX_STORED_SESSIONS }, (_, index) => {
      const startedAt = new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString();
      return {
        id: index,
        gameId: 1,
        source: "community" as const,
        exeName: "game.exe",
        startedAt,
        endedAt: new Date(Date.parse(startedAt) + 60_000).toISOString(),
        durationSeconds: 60,
      };
    });
    useAppStore.setState({ recentSessions: sessions });
    const before = sessions.length * 60;
    const startedAt = new Date(Date.UTC(2026, 5, 1)).toISOString();
    useAppStore.getState().addSession({
      id: MAX_STORED_SESSIONS,
      gameId: 1,
      source: "community",
      exeName: "game.exe",
      startedAt,
      endedAt: new Date(Date.parse(startedAt) + 60_000).toISOString(),
      durationSeconds: 60,
    });
    const state = useAppStore.getState();
    const lifetime =
      state.archivedSeconds +
      state.recentSessions.reduce(
        (total, session) => total + (session.durationSeconds ?? 0),
        0,
      );
    expect(state.recentSessions).toHaveLength(MAX_STORED_SESSIONS);
    expect(lifetime).toBe(before + 60);
  });
});
