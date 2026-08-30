import type { Settings } from "@playcounter/shared";
import type { MyGamesSortKey } from "./myGamesSort";

export type MyGamesCardSize = "grid" | "large" | "list";

export type MyGamesPresentationSettings = Pick<
  Settings,
  "libraryCardSize" | "librarySortKey" | "libraryShowBadges"
>;

export type MyGamesPresentation = {
  cardSize: MyGamesCardSize;
  sortKey: MyGamesSortKey;
  showBadges: boolean;
};

export const DEFAULT_MY_GAMES_PRESENTATION: MyGamesPresentation = {
  cardSize: "grid",
  sortKey: "recent",
  showBadges: true,
};

export function isMyGamesCardSize(value: unknown): value is MyGamesCardSize {
  return value === "grid" || value === "large" || value === "list";
}

export function isMyGamesSortKey(value: unknown): value is MyGamesSortKey {
  return (
    value === "recent" ||
    value === "playtime" ||
    value === "name" ||
    value === "sessions"
  );
}

export function resolveMyGamesPresentation(
  settings: Partial<MyGamesPresentationSettings> | undefined,
): MyGamesPresentation {
  return {
    cardSize: isMyGamesCardSize(settings?.libraryCardSize)
      ? settings.libraryCardSize
      : DEFAULT_MY_GAMES_PRESENTATION.cardSize,
    sortKey: isMyGamesSortKey(settings?.librarySortKey)
      ? settings.librarySortKey
      : DEFAULT_MY_GAMES_PRESENTATION.sortKey,
    showBadges:
      typeof settings?.libraryShowBadges === "boolean"
        ? settings.libraryShowBadges
        : DEFAULT_MY_GAMES_PRESENTATION.showBadges,
  };
}

export function resolveMyGamesPresentationSettings(
  settings: Partial<MyGamesPresentationSettings> | undefined,
): Required<MyGamesPresentationSettings> {
  const resolved = resolveMyGamesPresentation(settings);
  return {
    libraryCardSize: resolved.cardSize,
    librarySortKey: resolved.sortKey,
    libraryShowBadges: resolved.showBadges,
  };
}

export function libraryBadgesVisible(input: {
  showBadges: boolean;
  demo: boolean;
}) {
  return input.demo || input.showBadges;
}
