import type { Settings } from "@playcounter/shared";
import type { MyGamesSortKey } from "./myGamesSort";

export type MyGamesCardSize = "grid" | "large" | "list";

export const MAX_LIBRARY_GRID_COLUMNS = 48;

export function isLibraryGridColumns(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= MAX_LIBRARY_GRID_COLUMNS
  );
}

export type MyGamesPresentationSettings = Pick<
  Settings,
  | "libraryCardSize"
  | "libraryGridColumns"
  | "librarySortKey"
  | "libraryShowOriginBadges"
  | "libraryShowMatchBadges"
>;

export type MyGamesPresentation = {
  cardSize: MyGamesCardSize;
  gridColumns: number | null;
  sortKey: MyGamesSortKey;
  showOrigin: boolean;
  showMatch: boolean;
};

export const DEFAULT_MY_GAMES_PRESENTATION: MyGamesPresentation = {
  cardSize: "grid",
  gridColumns: null,
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
    gridColumns: isLibraryGridColumns(settings?.libraryGridColumns)
      ? settings.libraryGridColumns
      : null,
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
    libraryGridColumns: resolved.gridColumns,
    librarySortKey: resolved.sortKey,
    libraryShowOriginBadges: resolved.showOrigin,
    libraryShowMatchBadges: resolved.showMatch,
  };
}
