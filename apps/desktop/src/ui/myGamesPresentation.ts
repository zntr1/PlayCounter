import type { Settings } from "@playcounter/shared";
import type { MyGamesSortKey } from "./myGamesSort";

/** "covers": only the cover; name, playtime and Play show on hover. */
export type MyGamesCardSize = "grid" | "large" | "covers" | "list";

export const MAX_LIBRARY_GRID_COLUMNS = 48;

/** Covers view, Customize > Space between covers: the gap between columns
 *  in px. Rows get a little more, so covers read as rows. 44 is the room to
 *  breathe of docs/cover-view-polish-mockups.html. */
export const COVER_GAP = { min: 8, max: 128, step: 4, default: 44 } as const;

export function isCoverGap(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= COVER_GAP.min &&
    value <= COVER_GAP.max
  );
}

/** The covers' gaps for a saved value; anything else is the default. */
export function coverGapStyle(value: unknown) {
  const column = isCoverGap(value) ? value : COVER_GAP.default;
  return { columnGap: column, rowGap: Math.round(column * 1.27) };
}

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
  return (
    value === "grid" ||
    value === "large" ||
    value === "covers" ||
    value === "list"
  );
}

export function isMyGamesSortKey(value: unknown): value is MyGamesSortKey {
  return (
    value === "recent" ||
    value === "added" ||
    value === "playtime" ||
    value === "name" ||
    value === "sessions" ||
    value === "tier" ||
    value === "timeToBeat" ||
    value === "rating"
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
