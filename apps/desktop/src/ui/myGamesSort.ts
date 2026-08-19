export type MyGamesSortKey = "recent" | "playtime" | "name" | "sessions";

export type MyGamesSortValue = {
  gameId: number;
  source: string | null;
  name: string;
  totalSeconds: number;
  sessionCount: number;
  lastPlayedAt: string;
  activeStartedAt?: string;
};

function newestFirst(left: string, right: string) {
  return Date.parse(right) - Date.parse(left);
}

function stableIdentityOrder(left: MyGamesSortValue, right: MyGamesSortValue) {
  return (
    left.name.localeCompare(right.name) ||
    (left.source ?? "").localeCompare(right.source ?? "") ||
    left.gameId - right.gameId
  );
}

export function compareMyGames(
  left: MyGamesSortValue,
  right: MyGamesSortValue,
  sortKey: MyGamesSortKey,
) {
  let order = 0;
  switch (sortKey) {
    case "playtime":
      order = right.totalSeconds - left.totalSeconds;
      break;
    case "name":
      order = left.name.localeCompare(right.name);
      break;
    case "sessions":
      order = right.sessionCount - left.sessionCount;
      break;
    case "recent":
    default: {
      const leftActive = left.activeStartedAt !== undefined;
      const rightActive = right.activeStartedAt !== undefined;
      if (leftActive !== rightActive) return leftActive ? -1 : 1;
      order =
        leftActive && rightActive
          ? newestFirst(left.activeStartedAt!, right.activeStartedAt!)
          : newestFirst(left.lastPlayedAt, right.lastPlayedAt);
      break;
    }
  }

  return order || stableIdentityOrder(left, right);
}
