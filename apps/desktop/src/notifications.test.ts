import { describe, expect, it } from "vitest";
import {
  contributionNotification,
  displayNotificationTitle,
  notificationEmoji,
  notificationsForDisplay,
  shouldNotifyContributionTransition,
} from "./notifications";
import type { AppNotification } from "./notifications";

describe("contribution transitions", () => {
  it.each([
    [undefined, "pending", false],
    [undefined, "verified", true],
    [undefined, "rejected", true],
    ["pending", "verified", true],
    ["pending", "rejected", true],
    ["verified", "verified", false],
    ["rejected", "pending", false],
  ] as const)("maps %s -> %s to notify=%s", (previous, incoming, expected) => {
    expect(shouldNotifyContributionTransition(previous, incoming)).toBe(
      expected,
    );
  });
});

describe("notification titles", () => {
  it("makes an approved suggestion explicit", () => {
    const notification = contributionNotification({
      platform: "windows",
      kind: "exe",
      value: "game.exe",
      gameId: 42,
      gameName: "Test Game",
      coverUrl: "",
      status: "verified",
      createdAt: "2026-08-15T00:00:00.000Z",
    });

    expect(notification?.title).toBe("Test Game suggestion approved");
    expect(notification?.body).toBe(
      "Suggested file: game.exe\n\nThanks for helping PlayCounter recognize it.",
    );
    expect(notification && displayNotificationTitle(notification)).toBe(
      "👍 Test Game suggestion approved",
    );
  });

  it("makes a suggestion that was not approved explicit", () => {
    const notification = contributionNotification({
      platform: "windows",
      kind: "exe",
      value: "game.exe",
      gameId: 42,
      gameName: "Test Game",
      coverUrl: "",
      status: "rejected",
      reviewNote: "not a game",
      createdAt: "2026-08-15T00:00:00.000Z",
    });

    expect(notification?.title).toBe("Test Game suggestion not approved");
    expect(notification?.body).toBe(
      "Suggested file: game.exe\n\nFeedback: not a game",
    );
    expect(notification && displayNotificationTitle(notification)).toBe(
      "➖ Test Game suggestion not approved",
    );
  });

  it("clarifies legacy suggestion notification titles", () => {
    expect(
      displayNotificationTitle({
        id: "suggestion-verified:test",
        kind: "suggestion-verified",
        title: "Test Game was verified",
      }),
    ).toBe("👍 Test Game suggestion approved");
    expect(
      displayNotificationTitle({
        id: "suggestion-rejected:test",
        kind: "suggestion-rejected",
        title: "Test Game suggestion was reviewed",
      }),
    ).toBe("➖ Test Game suggestion not approved");
  });

  it("restores the year on legacy monthly milestone titles", () => {
    expect(
      displayNotificationTitle({
        id: "milestone:month:2025-08:200",
        kind: "milestone-month",
        title: "200 hours played in August",
      }),
    ).toBe("200 hours played in August 2025");
  });

  it("does not duplicate a year already present in a monthly title", () => {
    expect(
      displayNotificationTitle({
        id: "milestone:month:2026-08:200",
        kind: "milestone-month",
        title: "200 hours played in August 2026",
      }),
    ).toBe("200 hours played in August 2026");
  });
});

describe("notification emojis", () => {
  it.each([
    ["suggestion-verified", "✅"],
    ["suggestion-rejected", "➖"],
    ["milestone-total", "🏆"],
    ["milestone-month", "📅"],
    ["milestone-game", "🎮"],
    ["milestone-streak", "🔥"],
    ["milestone-verified", "✅"],
    ["discovered-review", "🧹"],
  ] as const)("uses %s art", (kind, emoji) => {
    expect(notificationEmoji(kind)).toBe(emoji);
  });
});

describe("notification display order", () => {
  it("puts higher thresholds first within an existing milestone batch", () => {
    const createdAt = "2026-08-10T12:00:00.000Z";
    const notifications = [10, 50, 500].map(
      (hours): AppNotification => ({
        id: `milestone:game:community:42:${hours}`,
        kind: "milestone-game",
        title: `${hours} hours played in Test Game`,
        createdAt,
      }),
    );

    expect(
      notificationsForDisplay(notifications).map(
        (notification) => notification.id,
      ),
    ).toEqual([
      "milestone:game:community:42:500",
      "milestone:game:community:42:50",
      "milestone:game:community:42:10",
    ]);
  });

  it("keeps newer notifications above older high thresholds", () => {
    const notifications: AppNotification[] = [
      {
        id: "milestone:game:community:42:500",
        kind: "milestone-game",
        title: "500 hours played in Test Game",
        createdAt: "2026-08-09T12:00:00.000Z",
      },
      {
        id: "milestone:game:community:42:10",
        kind: "milestone-game",
        title: "10 hours played in Test Game",
        createdAt: "2026-08-10T12:00:00.000Z",
      },
    ];

    expect(notificationsForDisplay(notifications)[0]?.id).toBe(
      "milestone:game:community:42:10",
    );
  });
});
