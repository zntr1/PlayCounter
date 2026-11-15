/* Cover resolution ───────────────────────────────────────────────────────────
   IGDB serves the same artwork at several sizes behind a token in the path, so
   a sharper cover costs nothing but a different URL. Covers reach us at
   t_cover_big (264x374), which is soft on the large cards and on the Now
   Playing hero.

   This only ever rewrites the size token of an images.igdb.com URL. Custom
   covers (asset://), data URIs and anything hosted elsewhere are returned
   untouched - their size is whatever the user or the community supplied. */

import type { CoverQuality, Settings } from "@playcounter/shared";

const IGDB_IMAGE_PREFIX = "https://images.igdb.com/igdb/image/upload/";

// Thumbnails show small, so every level stops them at card size.
const SHARP: Readonly<Record<string, string>> = {
  t_thumb: "t_cover_big",
  t_cover_small: "t_cover_big",
  t_cover_small_2x: "t_cover_big",
  t_cover_big: "t_cover_big_2x",
};

/** Only sizes we know a larger variant of; anything else is left alone. */
const LARGER_SIZE: Readonly<
  Record<CoverQuality, Readonly<Record<string, string>>>
> = {
  standard: {},
  sharp: SHARP,
  sharpest: { ...SHARP, t_cover_big: "t_1080p", t_cover_big_2x: "t_1080p" },
  original: {
    ...SHARP,
    t_cover_big: "t_original",
    t_cover_big_2x: "t_original",
  },
};

export function isIgdbImageUrl(url: string) {
  return url.startsWith(IGDB_IMAGE_PREFIX);
}

/** The picked cover quality. Before the picker there was one switch,
 *  "Sharper covers"; whoever had it on gets Sharp. */
export function coverQualityOf(
  settings: Pick<Settings, "coverQuality" | "libraryHighResCovers">,
): CoverQuality {
  return (
    settings.coverQuality ??
    (settings.libraryHighResCovers === true ? "sharp" : "standard")
  );
}

/**
 * The same cover at the picked quality, when the URL is an IGDB one and a
 * larger size exists. Returns the input unchanged in every other case,
 * including at Standard, so callers can pass the setting straight through.
 */
export function upgradeCoverUrl(url: string, quality: CoverQuality): string {
  if (!url || !isIgdbImageUrl(url)) return url;

  const rest = url.slice(IGDB_IMAGE_PREFIX.length);
  const separator = rest.indexOf("/");
  if (separator <= 0) return url;

  const size = rest.slice(0, separator);
  const larger = LARGER_SIZE[quality][size];
  // Not a cover size we upgrade (t_720p, t_1080p, t_original, screenshots).
  if (!larger) return url;

  return `${IGDB_IMAGE_PREFIX}${larger}/${rest.slice(separator + 1)}`;
}
