import { describe, expect, it } from "vitest";
import {
  anchorDiscoveredReviewReminder,
  DISCOVERED_REVIEW_REMINDER_COOLDOWN_MS,
  DISCOVERED_REVIEW_REMINDER_ID,
  evaluateDiscoveredReviewReminder,
  sanitizeDiscoveredReviewReminder,
  type DiscoveredReviewCardState,
  type DiscoveredReviewReminder,
} from "./discoveredReminder";

const start = new Date("2026-08-10T00:00:00.000Z");

function evaluate(
  count: number,
  reminder: DiscoveredReviewReminder = null,
  cardState: DiscoveredReviewCardState = "absent",
  elapsedMs = 0,
  canFire = true,
) {
  return evaluateDiscoveredReviewReminder({
    count,
    reminder,
    cardState,
    canFire,
    now: new Date(start.getTime() + elapsedMs),
  });
}

describe("discovered review reminder", () => {
  it("fires once the backlog reaches ten", () => {
    expect(evaluate(9)).toMatchObject({
      notification: null,
      reminderChanged: false,
    });

    const result = evaluate(10);
    expect(result.notification).toMatchObject({
      id: DISCOVERED_REVIEW_REMINDER_ID,
      kind: "discovered-review",
      title: "🧹 10 apps are waiting for review",
      action: { view: "discovered", label: "Open Discovered" },
    });
    expect(result.notification).not.toHaveProperty("readAt");
    expect(result.reminder).toEqual({
      notifiedAt: start.toISOString(),
      notifiedCount: 10,
    });
  });

  it("does not churn an unread reminder", () => {
    const reminder = {
      notifiedAt: start.toISOString(),
      notifiedCount: 10,
    };

    expect(evaluate(10, reminder, "unread", 0)).toMatchObject({
      notification: null,
      reminderChanged: false,
    });
    expect(
      evaluate(10, reminder, "unread", DISCOVERED_REVIEW_REMINDER_COOLDOWN_MS),
    ).toMatchObject({ notification: null, reminderChanged: false });
  });

  it("re-fires a read reminder after the cooldown", () => {
    const reminder = {
      notifiedAt: start.toISOString(),
      notifiedCount: 10,
    };
    expect(
      evaluate(
        10,
        reminder,
        "read",
        DISCOVERED_REVIEW_REMINDER_COOLDOWN_MS - 1,
      ),
    ).toMatchObject({ notification: null, reminderChanged: false });

    const result = evaluate(
      10,
      reminder,
      "read",
      DISCOVERED_REVIEW_REMINDER_COOLDOWN_MS,
    );
    expect(result.notification?.id).toBe(DISCOVERED_REVIEW_REMINDER_ID);
    expect(result.notification).not.toHaveProperty("readAt");
  });

  it("refreshes a grown unread backlog only after the cooldown", () => {
    const reminder = {
      notifiedAt: start.toISOString(),
      notifiedCount: 10,
    };
    const result = evaluate(
      15,
      reminder,
      "unread",
      DISCOVERED_REVIEW_REMINDER_COOLDOWN_MS,
    );
    expect(result.notification?.title).toContain("15 apps");
    expect(result.reminder).toMatchObject({ notifiedCount: 15 });

    expect(
      evaluate(
        12,
        { ...reminder, notifiedCount: 15 },
        "unread",
        DISCOVERED_REVIEW_REMINDER_COOLDOWN_MS,
      ),
    ).toMatchObject({ notification: null, reminderChanged: false });
  });

  it("honors dismissal cooldown and the re-arm threshold", () => {
    const reminder = {
      notifiedAt: start.toISOString(),
      notifiedCount: 10,
    };
    expect(evaluate(10, reminder, "absent", 1_000)).toMatchObject({
      notification: null,
    });
    expect(
      evaluate(10, reminder, "absent", DISCOVERED_REVIEW_REMINDER_COOLDOWN_MS)
        .notification?.id,
    ).toBe(DISCOVERED_REVIEW_REMINDER_ID);

    expect(evaluate(7, reminder, "unread")).toMatchObject({
      removeNotificationId: DISCOVERED_REVIEW_REMINDER_ID,
      reminder,
      reminderChanged: true,
    });
    expect(evaluate(4, reminder, "unread")).toMatchObject({
      removeNotificationId: DISCOVERED_REVIEW_REMINDER_ID,
      reminder: null,
      reminderChanged: true,
    });
    expect(evaluate(4, null, "absent")).toMatchObject({
      removeNotificationId: null,
      reminderChanged: false,
    });
  });

  it("suppresses firing while offline but still removes stale cards", () => {
    expect(evaluate(12, null, "absent", 0, false)).toMatchObject({
      notification: null,
      reminderChanged: false,
    });
    expect(evaluate(3, null, "unread", 0, false)).toMatchObject({
      removeNotificationId: DISCOVERED_REVIEW_REMINDER_ID,
      reminder: null,
    });
  });

  it("anchors user attention and sanitizes persisted state", () => {
    expect(
      anchorDiscoveredReviewReminder(
        { notifiedAt: start.toISOString(), notifiedCount: 12 },
        "2026-08-11T00:00:00.000Z",
      ),
    ).toEqual({
      notifiedAt: "2026-08-11T00:00:00.000Z",
      notifiedCount: 12,
    });
    expect(anchorDiscoveredReviewReminder(null, start.toISOString())).toEqual({
      notifiedAt: start.toISOString(),
      notifiedCount: 0,
    });
    expect(sanitizeDiscoveredReviewReminder({})).toBeNull();
    expect(
      sanitizeDiscoveredReviewReminder({
        notifiedAt: "nope",
        notifiedCount: 10,
      }),
    ).toBeNull();
    expect(
      sanitizeDiscoveredReviewReminder({
        notifiedAt: start.toISOString(),
        notifiedCount: -1,
      }),
    ).toBeNull();
  });
});
