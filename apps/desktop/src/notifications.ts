import type { Contribution, ContributionStatus } from "@playcounter/shared";
import type { ViewId } from "./store";

export type NotificationKind =
  | "suggestion-verified"
  | "suggestion-rejected"
  | "milestone-total"
  | "milestone-month"
  | "milestone-game"
  | "milestone-streak"
  | "milestone-verified"
  | "discovered-review";

export type NotificationAction = {
  view: ViewId;
  label: string;
};

export type AppNotification = {
  id: string;
  kind: NotificationKind;
  title: string;
  body?: string;
  coverUrl?: string;
  createdAt: string;
  readAt?: string;
  action?: NotificationAction;
};

export type ContributionCounts = {
  suggested: number;
  verified: number;
  pending: number;
  rejected: number;
};

export const EMPTY_CONTRIBUTION_COUNTS: ContributionCounts = {
  suggested: 0,
  verified: 0,
  pending: 0,
  rejected: 0,
};

export function notificationEmoji(kind: NotificationKind) {
  switch (kind) {
    case "suggestion-verified":
      return "✅";
    case "suggestion-rejected":
      return "➖";
    case "milestone-total":
      return "🏆";
    case "milestone-month":
      return "📅";
    case "milestone-game":
      return "🎮";
    case "milestone-streak":
      return "🔥";
    case "milestone-verified":
      return "✅";
    case "discovered-review":
      return "🧹";
    default:
      return assertNever(kind);
  }
}

export function displayNotificationTitle(
  notification: Pick<AppNotification, "id" | "kind" | "title">,
) {
  if (notification.kind === "suggestion-verified") {
    const title = notification.title.replace(
      / was verified$/i,
      " suggestion approved",
    );
    return title.startsWith("👍") ? title : `👍 ${title}`;
  }

  if (notification.kind === "suggestion-rejected") {
    const title = notification.title
      .replace(/^📝\s*/, "")
      .replace(/ suggestion was reviewed$/i, " suggestion not approved");
    return title.startsWith("➖") ? title : `➖ ${title}`;
  }

  if (notification.kind !== "milestone-month") return notification.title;

  const year = /^milestone:month:(\d{4})-\d{2}:/.exec(notification.id)?.[1];
  if (!year || new RegExp(`\\b${year}\\b`).test(notification.title)) {
    return notification.title;
  }

  return `${notification.title} ${year}`;
}

export function notificationsForDisplay(
  notifications: readonly AppNotification[],
): AppNotification[] {
  const groupOrder = new Map<string, number>();
  const rows = notifications.map((notification, index) => {
    const scope = milestoneScope(notification);
    const timestamp = Date.parse(notification.createdAt);
    const groupKey = scope
      ? `${notification.createdAt}:${scope}`
      : `${notification.createdAt}:notification:${index}`;
    if (!groupOrder.has(groupKey)) groupOrder.set(groupKey, groupOrder.size);

    return {
      notification,
      index,
      timestamp: Number.isFinite(timestamp) ? timestamp : 0,
      groupKey,
      threshold: scope ? notificationThreshold(notification.id) : null,
    };
  });

  return rows
    .sort((left, right) => {
      if (left.timestamp !== right.timestamp) {
        return right.timestamp - left.timestamp;
      }

      const groupDifference =
        (groupOrder.get(left.groupKey) ?? left.index) -
        (groupOrder.get(right.groupKey) ?? right.index);
      if (groupDifference !== 0) return groupDifference;

      if (left.threshold !== null && right.threshold !== null) {
        return right.threshold - left.threshold;
      }
      return left.index - right.index;
    })
    .map(({ notification }) => notification);
}

function milestoneScope(notification: AppNotification) {
  if (!notification.kind.startsWith("milestone-")) return null;
  const separator = notification.id.lastIndexOf(":");
  return separator > 0 ? notification.id.slice(0, separator) : null;
}

function notificationThreshold(id: string) {
  const threshold = Number(id.slice(id.lastIndexOf(":") + 1));
  return Number.isFinite(threshold) ? threshold : null;
}

function assertNever(value: never): never {
  throw new Error(`Unhandled notification kind: ${String(value)}`);
}

export function contributionKey(
  contribution: Pick<Contribution, "platform" | "kind" | "value" | "gameId">,
) {
  return `${contribution.platform}:${contribution.kind}:${contribution.value.toLowerCase()}:${contribution.gameId}`;
}

export function contributionNotification(
  contribution: Contribution,
  now = new Date().toISOString(),
): AppNotification | null {
  if (contribution.status === "pending") return null;
  const key = contributionKey(contribution);
  return contribution.status === "verified"
    ? {
        id: `suggestion-verified:${key}`,
        kind: "suggestion-verified",
        title: `${contribution.gameName} suggestion approved`,
        body: `Suggested executable: ${contribution.value}\n\nThanks for helping PlayCounter recognize it.`,
        coverUrl: contribution.coverUrl,
        createdAt: contribution.reviewedAt ?? now,
      }
    : {
        id: `suggestion-rejected:${key}`,
        kind: "suggestion-rejected",
        title: `${contribution.gameName} suggestion not approved`,
        body: contribution.reviewNote
          ? `Suggested executable: ${contribution.value}\n\nFeedback: ${contribution.reviewNote}`
          : `Suggested executable: ${contribution.value}\n\nThis executable was not approved for this game.`,
        coverUrl: contribution.coverUrl,
        createdAt: contribution.reviewedAt ?? now,
      };
}

export function shouldNotifyContributionTransition(
  previous: ContributionStatus | undefined,
  incoming: ContributionStatus,
) {
  if (incoming === "pending" || previous === incoming) return false;
  return incoming === "verified" || incoming === "rejected";
}
