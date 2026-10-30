import type { AchievementList, GameAchievement } from "@playcounter/shared";

export type AchievementFilter = "all" | "unlocked" | "locked";

/** One entry of Steam's public list (see achievements.rs). */
export type SteamCatalogAchievement = {
  id: string;
  name: string;
  description: string;
  hidden: boolean;
  iconUrl?: string;
  lockedIconUrl?: string;
  globalPercent?: number;
};

const MAX_ACHIEVEMENTS = 10_000;
const MAX_TEXT = 4_000;
const ICON_HOSTS = [
  "steamstatic.com",
  "steamcommunity.com",
  "akamaihd.net",
  "xboxlive.com",
  "xbox.com",
  "xboxservices.com",
];

export function achievementSummary(achievements: readonly GameAchievement[]) {
  const unlocked = achievements.filter((a) => a.unlocked).length;
  const total = achievements.length;
  const scored = achievements.filter((a) => a.gamerscore !== undefined);
  return {
    total,
    unlocked,
    // Rounded down: 99.5% is not done.
    percent: total ? Math.floor((unlocked / total) * 100) : 0,
    ...(scored.length
      ? {
          gamerscore: {
            earned: scored.reduce(
              (sum, a) => sum + (a.unlocked ? a.gamerscore! : 0),
              0,
            ),
            total: scored.reduce((sum, a) => sum + a.gamerscore!, 0),
          },
        }
      : {}),
  };
}

/** Unlocked first, newest first. Then locked: started ones closest to done,
 *  then the most common (easiest), then by name. 0 / 100 is not started. */
export function orderAchievements(achievements: readonly GameAchievement[]) {
  const ratio = (a: GameAchievement) =>
    a.progress && a.progress.current > 0
      ? a.progress.current / a.progress.target
      : -1;
  return [...achievements].sort((a, b) => {
    if (a.unlocked !== b.unlocked) return a.unlocked ? -1 : 1;
    if (a.unlocked)
      return (
        (b.unlockedAt ?? -1) - (a.unlockedAt ?? -1) ||
        a.name.localeCompare(b.name)
      );
    return (
      ratio(b) - ratio(a) ||
      (b.globalPercent ?? -1) - (a.globalPercent ?? -1) ||
      a.name.localeCompare(b.name)
    );
  });
}

export function filterAchievements(
  achievements: readonly GameAchievement[],
  filter: AchievementFilter,
) {
  return filter === "all"
    ? [...achievements]
    : achievements.filter((a) => a.unlocked === (filter === "unlocked"));
}

/** A hidden achievement keeps its secret until it is unlocked or shown. */
export function isConcealed(
  achievement: GameAchievement,
  revealed: ReadonlySet<string>,
) {
  return (
    achievement.hidden && !achievement.unlocked && !revealed.has(achievement.id)
  );
}

/** The file on this PC is the truth for texts and unlocks; Steam's public
 *  list adds the share of players, and the achievements a game got after it
 *  last ran here (locked: they can't be earned without running it). */
export function mergeSteamCatalog(
  local: readonly GameAchievement[],
  catalog: readonly SteamCatalogAchievement[],
): GameAchievement[] {
  const byId = new Map(catalog.map((entry) => [entry.id, entry]));
  const localIds = new Set(local.map((a) => a.id));
  return [
    ...local.map((a) => {
      const percent = byId.get(a.id)?.globalPercent;
      return percent === undefined ? a : { ...a, globalPercent: percent };
    }),
    ...catalog
      .filter((entry) => !localIds.has(entry.id))
      .map(
        (entry): GameAchievement => ({
          id: entry.id,
          name: entry.name,
          description: entry.description,
          hidden: entry.hidden,
          unlocked: false,
          ...(entry.iconUrl ? { iconUrl: entry.iconUrl } : {}),
          ...(entry.lockedIconUrl
            ? { lockedIconUrl: entry.lockedIconUrl }
            : {}),
          ...(entry.globalPercent !== undefined
            ? { globalPercent: entry.globalPercent }
            : {}),
        }),
      ),
  ];
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown, max = MAX_TEXT): value is string {
  return typeof value === "string" && value.length <= max;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function safeAchievementIcon(value: unknown): string | undefined {
  if (!text(value, 2048)) return undefined;
  try {
    const url = new URL(value);
    if (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      ICON_HOSTS.some(
        (host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
      )
    )
      return url.toString();
  } catch {
    // An icon is optional.
  }
  return undefined;
}

function parseAchievement(value: unknown): GameAchievement | null {
  const raw = record(value);
  if (
    !raw ||
    !text(raw.id, 256) ||
    !raw.id ||
    !text(raw.name) ||
    !text(raw.description) ||
    typeof raw.hidden !== "boolean" ||
    typeof raw.unlocked !== "boolean"
  )
    return null;
  const iconUrl = safeAchievementIcon(raw.iconUrl);
  const lockedIconUrl = safeAchievementIcon(raw.lockedIconUrl);
  const progress = record(raw.progress);
  return {
    id: raw.id,
    name: raw.name,
    description: raw.description,
    hidden: raw.hidden,
    unlocked: raw.unlocked,
    ...(raw.unlocked && finite(raw.unlockedAt) && raw.unlockedAt > 0
      ? { unlockedAt: raw.unlockedAt }
      : {}),
    ...(iconUrl ? { iconUrl } : {}),
    ...(lockedIconUrl ? { lockedIconUrl } : {}),
    ...(finite(raw.gamerscore) && raw.gamerscore >= 0
      ? { gamerscore: raw.gamerscore }
      : {}),
    ...(finite(raw.globalPercent) &&
    raw.globalPercent >= 0 &&
    raw.globalPercent <= 100
      ? { globalPercent: raw.globalPercent }
      : {}),
    ...(progress &&
    finite(progress.current) &&
    finite(progress.target) &&
    progress.current >= 0 &&
    progress.target > 0
      ? { progress: { current: progress.current, target: progress.target } }
      : {}),
  };
}

/** A list from the backend or from this PC's storage. Fields that can't be
 *  trusted are dropped; a list that isn't one is rejected. */
export function parseAchievementList(value: unknown): AchievementList | null {
  const raw = record(value);
  if (
    !raw ||
    (raw.provider !== "steam" && raw.provider !== "xbox") ||
    typeof raw.externalId !== "string" ||
    !/^[1-9][0-9]{0,9}$/.test(raw.externalId) ||
    !finite(raw.fetchedAt) ||
    raw.fetchedAt < 0 ||
    !Array.isArray(raw.achievements) ||
    raw.achievements.length > MAX_ACHIEVEMENTS
  )
    return null;
  const ids = new Set<string>();
  const achievements: GameAchievement[] = [];
  for (const item of raw.achievements) {
    const achievement = parseAchievement(item);
    if (!achievement) return null;
    if (ids.has(achievement.id)) continue;
    ids.add(achievement.id);
    achievements.push(achievement);
  }
  return {
    provider: raw.provider,
    externalId: raw.externalId,
    fetchedAt: raw.fetchedAt,
    achievements,
  };
}
