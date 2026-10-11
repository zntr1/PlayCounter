import type { Contribution, EmulatorContribution } from "@playcounter/shared";
import { describe, expect, it } from "vitest";
import { discoveredReviewNotification } from "./discoveredReminder";
import {
  contributionNotification,
  emulatorContributionNotification,
  type AppNotification,
} from "./notifications";
import { notificationText } from "./notificationText";

const reviewedAt = "2026-08-09T12:00:00.000Z";

function contribution(overrides: Partial<Contribution> = {}): Contribution {
  return {
    platform: "windows",
    kind: "exe",
    value: "hades.exe",
    gameId: 42,
    gameName: "Hades",
    coverUrl: "",
    status: "verified",
    reviewedAt,
    createdAt: reviewedAt,
    ...overrides,
  };
}

function emulatorContribution(
  overrides: Partial<EmulatorContribution> = {},
): EmulatorContribution {
  return {
    emulatorId: "dolphin",
    contentKind: "title_id",
    contentValue: "GALE01",
    gameId: 9,
    gameName: "Melee",
    coverUrl: "",
    status: "verified",
    reviewedAt,
    createdAt: reviewedAt,
    ...overrides,
  };
}

describe("notification text", () => {
  it("makes the same text a notification was saved with", () => {
    const notifications = [
      contributionNotification(contribution()),
      contributionNotification(contribution({ status: "rejected" })),
      contributionNotification(
        contribution({ status: "rejected", reviewNote: "Wrong game" }),
      ),
      contributionNotification(
        contribution({ status: "rejected", gameKind: "tool" }),
      ),
      emulatorContributionNotification(emulatorContribution(), "Dolphin"),
      emulatorContributionNotification(
        emulatorContribution({ status: "rejected" }),
        "Dolphin",
      ),
      emulatorContributionNotification(
        emulatorContribution({ status: "rejected", reviewNote: "Wrong disc" }),
        "Dolphin",
      ),
      discoveredReviewNotification(12, new Date(reviewedAt)),
    ];
    for (const notification of notifications) {
      if (!notification) throw new Error("expected a notification");
      expect(notificationText(notification)).toEqual({
        title: notification.title,
        body: notification.body,
        actionLabel: notification.action?.label,
      });
    }
  });

  it("keeps the saved text of a notification without facts", () => {
    const old: AppNotification = {
      id: "suggestion-verified:windows:exe:hades.exe:42",
      kind: "suggestion-verified",
      title: "Hades was verified",
      body: "Saved body",
      createdAt: reviewedAt,
    };
    expect(notificationText(old)).toEqual({
      title: "Hades was verified",
      body: "Saved body",
      actionLabel: undefined,
    });
  });

  it("falls back to the saved text when the saved facts are junk", () => {
    const kinds = [
      "suggestion-rejected",
      "discovered-review",
      "milestone-game",
      "feedback-reply",
      "unknown-kind",
    ];
    const junk = [null, "junk", 5, [], { game: 1, file: 2 }, { count: "12" }];
    for (const kind of kinds) {
      for (const params of junk) {
        const notification = {
          id: "milestone:game:community:42:10",
          kind,
          title: "Saved title",
          createdAt: reviewedAt,
          params,
        } as unknown as AppNotification;
        const text = notificationText(notification);
        expect(text.title).toBe(
          kind === "feedback-reply" ? "Reply from PlayCounter" : "Saved title",
        );
      }
    }
  });
});
