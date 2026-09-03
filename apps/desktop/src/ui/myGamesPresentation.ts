import type { Settings } from "@playcounter/shared";
import type { MyGamesSortKey } from "./myGamesSort";

export type MyGamesCardSize = "grid" | "large" | "list";

export type MyGamesPresentationSettings = Pick<
  Settings,
  | "libraryCardSize"
  | "librarySortKey"
  | "libraryShowOriginBadges"
  | "libraryShowMatchBadges"
>;

export type MyGamesPresentation = {
  cardSize: MyGamesCardSize;
  sortKey: MyGamesSortKey;
  showOrigin: boolean;
  showMatch: boolean;
};

export const DEFAULT_MY_GAMES_PRESENTATION: MyGamesPresentation = {
  cardSize: "grid",
  sortKey: "recent",
  showOrigin: true,
  showMatch: true,
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
  settings:
    | (Partial<MyGamesPresentationSettings> &
        Pick<Partial<Settings>, "libraryShowBadges">)
    | undefined,
): MyGamesPresentation {
  // The retired single toggle seeds both halves, so anyone who had badges off
  // stays that way instead of having them reappear.
  const legacy =
    typeof settings?.libraryShowBadges === "boolean"
      ? settings.libraryShowBadges
      : undefined;
  return {
    cardSize: isMyGamesCardSize(settings?.libraryCardSize)
      ? settings.libraryCardSize
      : DEFAULT_MY_GAMES_PRESENTATION.cardSize,
    sortKey: isMyGamesSortKey(settings?.librarySortKey)
      ? settings.librarySortKey
      : DEFAULT_MY_GAMES_PRESENTATION.sortKey,
    showOrigin:
      typeof settings?.libraryShowOriginBadges === "boolean"
        ? settings.libraryShowOriginBadges
        : (legacy ?? DEFAULT_MY_GAMES_PRESENTATION.showOrigin),
    showMatch:
      typeof settings?.libraryShowMatchBadges === "boolean"
        ? settings.libraryShowMatchBadges
        : (legacy ?? DEFAULT_MY_GAMES_PRESENTATION.showMatch),
  };
}

export function resolveMyGamesPresentationSettings(
  settings:
    | (Partial<MyGamesPresentationSettings> &
        Pick<Partial<Settings>, "libraryShowBadges">)
    | undefined,
): Required<MyGamesPresentationSettings> {
  const resolved = resolveMyGamesPresentation(settings);
  return {
    libraryCardSize: resolved.cardSize,
    librarySortKey: resolved.sortKey,
    libraryShowOriginBadges: resolved.showOrigin,
    libraryShowMatchBadges: resolved.showMatch,
  };
}
