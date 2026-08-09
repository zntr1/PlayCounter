import type { Contribution, ContributionStatus } from "@playcounter/shared";

export type NotificationKind =
  | "suggestion-verified"
  | "suggestion-rejected"
  | "milestone-total"
  | "milestone-month"
  | "milestone-game"
  | "milestone-streak"
  | "milestone-verified";

export type AppNotification = {
  id: string;
  kind: NotificationKind;
  title: string;
  body?: string;
  coverUrl?: string;
  createdAt: string;
  readAt?: string;
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
        title: `${contribution.gameName} was verified`,
        body: `Thanks for helping PlayCounter recognize ${contribution.value}.`,
        coverUrl: contribution.coverUrl,
        createdAt: contribution.reviewedAt ?? now,
      }
    : {
        id: `suggestion-rejected:${key}`,
        kind: "suggestion-rejected",
        title: `${contribution.gameName} suggestion was reviewed`,
        body:
          contribution.reviewNote ??
          `The ${contribution.value} suggestion was not accepted.`,
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
