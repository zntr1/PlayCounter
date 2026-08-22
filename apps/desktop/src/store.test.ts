import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  canSuggestCustomGameToCommunity,
  canSwitchApprovedSuggestionToCommunity,
  canonicalGameKey,
  createGameIdentityResolver,
  resolvedCanonicalGameKey,
  useAppStore,
} from "./store";
import { MAX_STORED_SESSIONS } from "./sessionPersistence";
import {
  DISCOVERED_REVIEW_REMINDER_ID,
  evaluateDiscoveredReviewReminder,
} from "./discoveredReminder";

describe("custom game community suggestion eligibility", () => {
  it("allows a new suggestion after the previous one was rejected", () => {
    expect(
      canSuggestCustomGameToCommunity({
        source: "custom",
        exeName: "Palworld.exe",
        communitySuggestionId: 84,
        communitySuggestionStatus: "rejected",
      }),
    ).toBe(true);
  });

  it("does not allow duplicate actions while a suggestion is pending or approved", () => {
    for (const status of ["pending", "verified"] as const) {
      expect(
        canSuggestCustomGameToCommunity({
          source: "custom",
          exeName: "Palworld.exe",
          communitySuggestionId: 84,
          communitySuggestionStatus: status,
        }),
      ).toBe(false);
    }
  });
});

describe("approved community suggestion switch", () => {
  const approvedSuggestion = {
    communitySuggestionId: 42,
    communitySuggestionVerified: true,
  };

  it("is offered only while the game is still custom", () => {
    expect(
      canSwitchApprovedSuggestionToCommunity({
        ...approvedSuggestion,
        source: "custom",
      }),
    ).toBe(true);
    expect(
      canSwitchApprovedSuggestionToCommunity({
        ...approvedSuggestion,
        source: "community",
      }),
    ).toBe(false);
    expect(
      canSwitchApprovedSuggestionToCommunity({
        ...approvedSuggestion,
        source: "igdb",
      }),
    ).toBe(false);
  });

  it("is not offered before approval", () => {
    expect(
      canSwitchApprovedSuggestionToCommunity({
        source: "custom",
        communitySuggestionId: 42,
        communitySuggestionVerified: false,
      }),
    ).toBe(false);
  });
});

beforeEach(() => {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: { setItem: vi.fn() },
  });
  useAppStore.setState({
    installUuid: null,
    contributionOwnerUuid: null,
    seenContributionStatus: {},
    contributionCounts: { suggested: 0, verified: 0, pending: 0, rejected: 0 },
    notifications: [],
    discoveredReviewReminder: null,
    awardedMilestones: [],
    archivedSeconds: 0,
    archivedGameSeconds: {},
    playtimeAdjustments: {},
    collapsedSections: [],
    autoDetectedGameKeys: [],
    ignoredProcesses: new Set(),
    userIgnoredProcesses: new Set(),
    launchTargets: new Map(),
    settings: {
      ...useAppStore.getState().settings,
      desktopOverlaysEnabled: true,
      overlayFirstDetections: true,
      overlaySessionStarts: true,
      overlaySessionSummaries: true,
      overlayMilestones: true,
      overlayDiscoveries: false,
    },
  });
});

describe("launch target state", () => {
  it("keys targets case-insensitively and clears them with the cache", () => {
    useAppStore.getState().setLaunchTarget({
      exeName: "Game.exe",
      path: String.raw`C:\Games\Game.exe`,
      owner: { gameId: 42, source: "igdb" },
    });
    expect(useAppStore.getState().launchTargets.has("game.exe")).toBe(true);

    useAppStore.getState().removeLaunchTarget("GAME.EXE");
    expect(useAppStore.getState().launchTargets.size).toBe(0);

    useAppStore.getState().setLaunchTarget({
      exeName: "Game.exe",
      path: String.raw`C:\Games\Game.exe`,
      owner: { gameId: 42, source: "igdb" },
    });
    useAppStore.getState().clearCache();
    expect(useAppStore.getState().launchTargets.size).toBe(0);
  });
});

describe("desktop overlay settings", () => {
  it("defaults notifications on except for new discoveries", () => {
    expect(useAppStore.getState().settings).toMatchObject({
      desktopOverlaysEnabled: true,
      overlayFirstDetections: true,
      overlaySessionStarts: true,
      overlaySessionSummaries: true,
      overlayMilestones: true,
      overlayDiscoveries: false,
    });
  });
});

describe("automatic detection identity", () => {
  it("records every alias on the first detection", () => {
    expect(
      useAppStore
        .getState()
        .recordAutomaticDetection(["igdb#900", "community:41"]),
    ).toBe(true);
    expect(useAppStore.getState().autoDetectedGameKeys).toEqual([
      "igdb#900",
      "community:41",
    ]);
  });

  it("widens partially overlapping aliases without reporting another first", async () => {
    useAppStore.setState({ autoDetectedGameKeys: ["community:41"] });
    expect(
      useAppStore
        .getState()
        .recordAutomaticDetection(["igdb#900", "community:41"]),
    ).toBe(false);
    expect(useAppStore.getState().autoDetectedGameKeys).toContain("igdb#900");
    await Promise.resolve();
    expect(globalThis.localStorage.setItem).toHaveBeenCalled();

    expect(
      useAppStore.getState().recordAutomaticDetection(["igdb#900", "igdb:900"]),
    ).toBe(false);
  });

  it("records detections independently from the overlay master", () => {
    useAppStore.setState((state) => ({
      settings: { ...state.settings, desktopOverlaysEnabled: false },
    }));
    expect(useAppStore.getState().recordAutomaticDetection(["custom:-1"])).toBe(
      true,
    );
    expect(useAppStore.getState().autoDetectedGameKeys).toEqual(["custom:-1"]);
  });

  it("carries a known local identity forward when a game is rekeyed", () => {
    useAppStore.setState({ autoDetectedGameKeys: ["custom:-1"] });
    useAppStore
      .getState()
      .carryAutoDetectedGameKey("custom:-1", "community:42");
    expect(useAppStore.getState().autoDetectedGameKeys).toEqual([
      "custom:-1",
      "community:42",
    ]);
  });
});

describe("section collapse preferences", () => {
  it("toggles sections independently", () => {
    useAppStore.getState().toggleSectionCollapsed("history.timeline");
    expect(useAppStore.getState().collapsedSections).toEqual([
      "history.timeline",
    ]);

    useAppStore.getState().toggleSectionCollapsed("achievements.total");
    expect(useAppStore.getState().collapsedSections).toEqual([
      "history.timeline",
      "achievements.total",
    ]);

    useAppStore.getState().toggleSectionCollapsed("history.timeline");
    expect(useAppStore.getState().collapsedSections).toEqual([
      "achievements.total",
    ]);
  });
});

describe("ignored process sharing preference", () => {
  it("updates and persists automatic sharing", async () => {
    const originalSettings = useAppStore.getState().settings;
    try {
      useAppStore.getState().setAutoShareIgnoredProcesses(true);

      expect(useAppStore.getState().settings.autoShareIgnoredProcesses).toBe(
        true,
      );
      await Promise.resolve();
      expect(globalThis.localStorage.setItem).toHaveBeenCalled();
    } finally {
      useAppStore.setState({ settings: originalSettings });
    }
  });
});

describe("ignored emulator settings", () => {
  it("normalizes, de-duplicates, and restores emulator ids", () => {
    const originalSettings = useAppStore.getState().settings;
    try {
      useAppStore.setState({
        settings: { ...originalSettings, ignoredEmulatorIds: [] },
      });
      useAppStore.getState().setEmulatorIgnoredSetting("DOSBox", true);
      useAppStore.getState().setEmulatorIgnoredSetting("dosbox", true);
      expect(useAppStore.getState().settings.ignoredEmulatorIds).toEqual([
        "dosbox",
      ]);

      useAppStore.getState().setEmulatorIgnoredSetting("dosbox", false);
      expect(useAppStore.getState().settings.ignoredEmulatorIds).toEqual([]);
    } finally {
      useAppStore.setState({ settings: originalSettings });
    }
  });
});

describe("discovered review reminder attention", () => {
  const oldReminder = {
    notifiedAt: "2026-08-01T00:00:00.000Z",
    notifiedCount: 12,
  };
  const unreadCard = {
    id: DISCOVERED_REVIEW_REMINDER_ID,
    kind: "discovered-review" as const,
    title: "🧹 12 apps are waiting for review",
    createdAt: oldReminder.notifiedAt,
  };

  it("anchors the cooldown when an unread reminder is read", () => {
    const before = Date.now();
    useAppStore.setState({
      notifications: [unreadCard],
      discoveredReviewReminder: oldReminder,
    });

    useAppStore.getState().markAllNotificationsRead();

    const state = useAppStore.getState();
    const readAt = state.notifications[0]?.readAt;
    expect(readAt).toBeTruthy();
    expect(state.discoveredReviewReminder).toEqual({
      notifiedAt: readAt,
      notifiedCount: 12,
    });
    expect(Date.parse(readAt ?? "")).toBeGreaterThanOrEqual(before);
  });

  it("does not move the cooldown when an already-read card is viewed again", () => {
    useAppStore.setState({
      notifications: [{ ...unreadCard, readAt: "2026-08-02T00:00:00.000Z" }],
      discoveredReviewReminder: oldReminder,
    });

    useAppStore.getState().markAllNotificationsRead();

    expect(useAppStore.getState().discoveredReviewReminder).toEqual(
      oldReminder,
    );
  });

  it("anchors dismiss and clear only while the reminder card is present", () => {
    useAppStore.setState({
      notifications: [unreadCard],
      discoveredReviewReminder: oldReminder,
    });
    useAppStore.getState().dismissNotification(DISCOVERED_REVIEW_REMINDER_ID);
    const dismissed = useAppStore.getState().discoveredReviewReminder;
    expect(Date.parse(dismissed?.notifiedAt ?? "")).toBeGreaterThan(
      Date.parse(oldReminder.notifiedAt),
    );

    useAppStore.setState({
      notifications: [unreadCard],
      discoveredReviewReminder: oldReminder,
    });
    useAppStore.getState().clearNotifications();
    const cleared = useAppStore.getState().discoveredReviewReminder;
    expect(Date.parse(cleared?.notifiedAt ?? "")).toBeGreaterThan(
      Date.parse(oldReminder.notifiedAt),
    );

    useAppStore.setState({
      notifications: [],
      discoveredReviewReminder: oldReminder,
    });
    useAppStore.getState().clearNotifications();
    expect(useAppStore.getState().discoveredReviewReminder).toEqual(
      oldReminder,
    );
  });

  it("does not immediately re-fire when an old unread card is read and dismissed", () => {
    const overdue = evaluateDiscoveredReviewReminder({
      count: 12,
      reminder: oldReminder,
      cardState: "unread",
      canFire: true,
      now: new Date("2026-08-10T00:00:00.000Z"),
    });
    expect(overdue.notification).toBeNull();

    useAppStore.setState({
      notifications: [unreadCard],
      discoveredReviewReminder: oldReminder,
    });
    useAppStore.getState().markAllNotificationsRead();
    useAppStore.getState().dismissNotification(DISCOVERED_REVIEW_REMINDER_ID);
    const anchored = useAppStore.getState().discoveredReviewReminder;
    const nextScan = evaluateDiscoveredReviewReminder({
      count: 12,
      reminder: anchored,
      cardState: "absent",
      canFire: true,
      now: new Date(Date.parse(anchored?.notifiedAt ?? "") + 1_000),
    });

    expect(nextScan.notification).toBeNull();
  });

  it("upserts a refreshed reminder as unread", () => {
    useAppStore.setState({
      notifications: [{ ...unreadCard, readAt: "2026-08-02T00:00:00.000Z" }],
    });

    useAppStore.getState().addNotification({
      ...unreadCard,
      createdAt: "2026-08-03T00:00:00.000Z",
    });

    expect(useAppStore.getState().notifications).toEqual([
      { ...unreadCard, createdAt: "2026-08-03T00:00:00.000Z" },
    ]);
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
      emulatorContributionCounts: {
        suggested: 2,
        verified: 1,
        pending: 1,
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
      awardedMilestones: [
        {
          id: "milestone:total:10",
          kind: "milestone-total",
          title: "10 hours",
          awardedAt: "2026-08-09T00:00:00.000Z",
        },
      ],
      archivedSeconds: 3600,
    });

    useAppStore.getState().adoptInstallIdentity("new");
    const state = useAppStore.getState();
    expect(state.installUuid).toBe("new");
    expect(state.contributionOwnerUuid).toBe("new");
    expect(state.seenContributionStatus).toEqual({});
    expect(state.contributionCounts.suggested).toBe(0);
    expect(state.emulatorContributionCounts.suggested).toBe(0);
    expect(state.notifications.map((item) => item.id)).toEqual([
      "milestone:total:10",
    ]);
    expect(state.awardedMilestones.map((item) => item.id)).toEqual([
      "milestone:total:10",
    ]);
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

describe("game seconds state", () => {
  it("moves archive and adjustment buckets into the destination", () => {
    useAppStore.setState({
      archivedGameSeconds: { "custom:-1": 120, "community:42": 30 },
      playtimeAdjustments: { "custom:-1": -60, "community:42": 10 },
    });
    useAppStore.getState().rekeyGameSeconds("custom:-1", "community:42");
    expect(useAppStore.getState().archivedGameSeconds).toEqual({
      "community:42": 150,
    });
    expect(useAppStore.getState().playtimeAdjustments).toEqual({
      "community:42": -50,
    });
  });

  it("clears archive and adjustment buckets and updates the archive total", () => {
    useAppStore.setState({
      archivedSeconds: 180,
      archivedGameSeconds: { "community:42": 120, "igdb:7": 60 },
      playtimeAdjustments: { "community:42": -60, "igdb:7": 30 },
    });
    useAppStore.getState().clearGameSeconds(["community:42"]);
    expect(useAppStore.getState()).toMatchObject({
      archivedSeconds: 60,
      archivedGameSeconds: { "igdb:7": 60 },
      playtimeAdjustments: { "igdb:7": 30 },
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

describe("canonical game identity", () => {
  it("uses igdbId across sources and falls back to the local pair", () => {
    expect(canonicalGameKey({ gameId: 1, source: "igdb", igdbId: 12345 })).toBe(
      "igdb#12345",
    );
    expect(canonicalGameKey({ gameId: 7, source: "community" })).toBe(
      "community:7",
    );
  });

  it("resolves legacy records from metadata and exe cache", () => {
    const resolveIgdbId = createGameIdentityResolver(
      new Map([
        [
          "igdb:1",
          {
            id: 1,
            igdbId: 12345,
            name: "Game",
            coverUrl: "",
            source: "igdb" as const,
          },
        ],
      ]),
      new Map([
        [
          "game.exe",
          {
            exeName: "Game.exe",
            state: "matched" as const,
            gameId: 7,
            igdbId: 12345,
            source: "community" as const,
            lastCheckedAt: "2026-08-09T00:00:00.000Z",
          },
        ],
      ]),
    );
    expect(
      resolvedCanonicalGameKey({ gameId: 1, source: "igdb" }, resolveIgdbId),
    ).toBe("igdb#12345");
    expect(
      resolvedCanonicalGameKey(
        { gameId: 7, source: "community" },
        resolveIgdbId,
      ),
    ).toBe("igdb#12345");
  });

  it("isolates a cached game when a reset database reuses its numeric id", () => {
    const resolveIgdbId = createGameIdentityResolver(
      new Map([
        [
          "community:31",
          {
            id: 31,
            igdbId: 378504,
            name: "Higher or Lower: Spotify Edition",
            coverUrl: "spotify-cover",
            source: "community" as const,
          },
        ],
      ]),
      new Map([
        [
          "project_plague-wingdk-shipping.exe",
          {
            exeName: "Project_Plague-WinGDK-Shipping.exe",
            state: "matched" as const,
            gameId: 31,
            igdbId: 378504,
            gameName: "Wuchang: Fallen Feathers",
            coverUrl: "wuchang-cover",
            source: "community" as const,
            lastCheckedAt: "2026-07-09T00:00:00.000Z",
          },
        ],
        [
          "spotify.exe",
          {
            exeName: "Spotify.exe",
            state: "matched" as const,
            gameId: -1444898014,
            igdbId: 378504,
            gameName: "Higher or Lower: Spotify Edition",
            coverUrl: "spotify-cover",
            source: "custom" as const,
            lastCheckedAt: "2026-08-16T00:00:00.000Z",
          },
        ],
      ]),
    );

    expect(
      resolvedCanonicalGameKey(
        {
          gameId: 31,
          igdbId: 378504,
          gameName: "Wuchang: Fallen Feathers",
          coverUrl: "wuchang-cover",
          source: "community",
        },
        resolveIgdbId,
      ),
    ).toBe("community:31");
    expect(
      resolvedCanonicalGameKey(
        {
          gameId: -1444898014,
          igdbId: 378504,
          gameName: "Higher or Lower: Spotify Edition",
          coverUrl: "spotify-cover",
          source: "custom",
        },
        resolveIgdbId,
      ),
    ).toBe("igdb#378504");
  });

  it("does not reinterpret named history from stale metadata alone", () => {
    const resolveIgdbId = createGameIdentityResolver(
      new Map([
        [
          "community:31",
          {
            id: 31,
            igdbId: 378504,
            name: "Higher or Lower: Spotify Edition",
            coverUrl: "spotify-cover",
            source: "community" as const,
          },
        ],
      ]),
      new Map(),
    );

    expect(
      resolvedCanonicalGameKey(
        {
          gameId: 31,
          gameName: "Wuchang: Fallen Feathers",
          source: "community",
        },
        resolveIgdbId,
      ),
    ).toBe("community:31");
  });
});
