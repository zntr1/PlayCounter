import { notificationEmoji, type AppNotification } from "./notifications";

export const DISCOVERED_REVIEW_REMINDER_THRESHOLD = 10;
export const DISCOVERED_REVIEW_REMINDER_REARM_AT = 5;
export const DISCOVERED_REVIEW_REMINDER_COOLDOWN_MS = 24 * 60 * 60 * 1000;
export const DISCOVERED_REVIEW_REMINDER_ID = "discovered-review-backlog";

export type DiscoveredReviewReminder = {
  notifiedAt: string;
  notifiedCount: number;
} | null;

export type DiscoveredReviewCardState = "absent" | "unread" | "read";

export function discoveredReviewReminderText(count: number) {
  return {
    title: `${count} apps are waiting for review`,
    body: "Match them to games or ignore them so PlayCounter tracks the right playtime.",
  };
}

export function discoveredReviewNotification(
  count: number,
  now = new Date(),
): AppNotification {
  const text = discoveredReviewReminderText(count);
  return {
    id: DISCOVERED_REVIEW_REMINDER_ID,
    kind: "discovered-review",
    title: `${notificationEmoji("discovered-review")} ${text.title}`,
    body: text.body,
    createdAt: now.toISOString(),
    action: { view: "discovered", label: "Open Discovered" },
  };
}

export function sanitizeDiscoveredReviewReminder(
  value: unknown,
): DiscoveredReviewReminder {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.notifiedAt !== "string" ||
    !Number.isFinite(Date.parse(candidate.notifiedAt)) ||
    typeof candidate.notifiedCount !== "number" ||
    !Number.isFinite(candidate.notifiedCount) ||
    candidate.notifiedCount < 0
  ) {
    return null;
  }
  return {
    notifiedAt: candidate.notifiedAt,
    notifiedCount: candidate.notifiedCount,
  };
}

export function anchorDiscoveredReviewReminder(
  reminder: DiscoveredReviewReminder,
  atIso: string,
): Exclude<DiscoveredReviewReminder, null> {
  return {
    notifiedAt: atIso,
    notifiedCount: reminder?.notifiedCount ?? 0,
  };
}

export function evaluateDiscoveredReviewReminder(input: {
  count: number;
  reminder: DiscoveredReviewReminder;
  cardState: DiscoveredReviewCardState;
  canFire: boolean;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const removeNotificationId =
    input.cardState === "absent" ? null : DISCOVERED_REVIEW_REMINDER_ID;

  if (input.count < DISCOVERED_REVIEW_REMINDER_THRESHOLD) {
    const rearm = input.count <= DISCOVERED_REVIEW_REMINDER_REARM_AT;
    return {
      notification: null,
      removeNotificationId,
      reminder: rearm ? null : input.reminder,
      reminderChanged:
        removeNotificationId !== null || (rearm && input.reminder !== null),
    };
  }

  if (!input.canFire || !isCooledDown(input.reminder, now)) {
    return inertDecision(input.reminder);
  }

  if (
    input.cardState === "unread" &&
    input.reminder &&
    input.count <= input.reminder.notifiedCount
  ) {
    return inertDecision(input.reminder);
  }

  return {
    notification: discoveredReviewNotification(input.count, now),
    removeNotificationId: null,
    reminder: {
      notifiedAt: now.toISOString(),
      notifiedCount: input.count,
    },
    reminderChanged: true,
  };
}

function isCooledDown(reminder: DiscoveredReviewReminder, now: Date) {
  if (!reminder) return true;
  const notifiedAt = Date.parse(reminder.notifiedAt);
  if (!Number.isFinite(notifiedAt)) return true;
  const elapsed = now.getTime() - notifiedAt;
  if (elapsed < 0) return true;
  return elapsed >= DISCOVERED_REVIEW_REMINDER_COOLDOWN_MS;
}

function inertDecision(reminder: DiscoveredReviewReminder) {
  return {
    notification: null,
    removeNotificationId: null,
    reminder,
    reminderChanged: false,
  };
}
