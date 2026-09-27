export type MyGamesSortKey =
  | "recent"
  | "added"
  | "playtime"
  | "name"
  | "sessions";

export const LAST_PLAYED_PROMOTION_DELAY_MS = 30_000;
export const NEW_GAME_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export type MyGamesSortValue = {
  gameId: number;
  source: string | null;
  name: string;
  totalSeconds: number;
  sessionCount: number;
  lastPlayedAt: string;
  hasLastPlayedEvidence?: boolean;
  activeStartedAt?: string;
  /** When the game joined the library. Absent for games added before the
   *  date was kept and never played since. */
  addedAt?: string;
};

function newestFirst(left: string, right: string) {
  return Date.parse(right) - Date.parse(left);
}

function addedTime(game: Pick<MyGamesSortValue, "addedAt">) {
  const timestamp = Date.parse(game.addedAt ?? "");
  return Number.isFinite(timestamp) ? timestamp : 0;
}

/** The earliest valid date: a game joined when its first route in appeared. */
export function earliestAddedAt(
  current: string | undefined,
  candidate: string | undefined,
) {
  const candidateTime = Date.parse(candidate ?? "");
  if (!Number.isFinite(candidateTime)) return current;
  const currentTime = Date.parse(current ?? "");
  return Number.isFinite(currentTime) && currentTime <= candidateTime
    ? current
    : candidate;
}

/** Added in the last week and not played yet, here or in its launcher. */
export function isNewGame(
  game: Pick<
    MyGamesSortValue,
    "addedAt" | "sessionCount" | "hasLastPlayedEvidence" | "activeStartedAt"
  >,
  nowMs: number,
) {
  if (
    game.sessionCount > 0 ||
    game.hasLastPlayedEvidence ||
    game.activeStartedAt !== undefined
  ) {
    return false;
  }
  const addedMs = addedTime(game);
  return addedMs > 0 && nowMs - addedMs < NEW_GAME_WINDOW_MS;
}

function lastPlayedTime(game: MyGamesSortValue) {
  // Undated entries keep an added/import date for display, not recent-play rank.
  if (!game.hasLastPlayedEvidence && game.sessionCount === 0) return 0;
  const timestamp = Date.parse(game.lastPlayedAt);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function mergeLastPlayedEvidence(
  current: string,
  candidate: string,
  currentIsPlayEvidence: boolean,
) {
  const candidateTime = Date.parse(candidate);
  if (!Number.isFinite(candidateTime)) return current;
  if (!currentIsPlayEvidence) return candidate;

  const currentTime = Date.parse(current);
  return !Number.isFinite(currentTime) || candidateTime > currentTime
    ? candidate
    : current;
}

function stableIdentityOrder(left: MyGamesSortValue, right: MyGamesSortValue) {
  return (
    left.name.localeCompare(right.name) ||
    (left.source ?? "").localeCompare(right.source ?? "") ||
    left.gameId - right.gameId
  );
}

export function shouldPromoteActiveGame(
  startedAt: string,
  nowMs: number,
  delayMs = LAST_PLAYED_PROMOTION_DELAY_MS,
) {
  const startedAtMs = Date.parse(startedAt);
  return Number.isFinite(startedAtMs) && nowMs - startedAtMs >= delayMs;
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
    case "added":
      order = addedTime(right) - addedTime(left);
      break;
    case "recent":
    default: {
      const leftActive = left.activeStartedAt !== undefined;
      const rightActive = right.activeStartedAt !== undefined;
      if (leftActive !== rightActive) return leftActive ? -1 : 1;
      order =
        leftActive && rightActive
          ? newestFirst(left.activeStartedAt!, right.activeStartedAt!)
          : lastPlayedTime(right) - lastPlayedTime(left);
      break;
    }
  }

  return order || stableIdentityOrder(left, right);
}
