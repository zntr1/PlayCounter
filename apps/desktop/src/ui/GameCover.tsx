import { useEffect, useState, type ImgHTMLAttributes } from "react";
import { upgradeCoverUrl } from "../coverArt";
import { useAppStore } from "../store";

/* A cover <img> that honours the "sharper covers" setting.

   The upgraded size is a different file on IGDB's CDN, and nothing guarantees
   every cover has one. A URL that fails once is remembered here for the app's
   lifetime and served at its original size from then on, so a missing 2x asset
   degrades to exactly today's image instead of an empty box - and is not
   retried on every render. */
const failedUpgrades = new Set<string>();

export function GameCover({
  src,
  highRes,
  ...rest
}: {
  src: string;
  /** Force the larger size regardless of the setting (details view). */
  highRes?: boolean;
} & Omit<ImgHTMLAttributes<HTMLImageElement>, "src">) {
  const setting = useAppStore(
    (state) => state.settings.libraryHighResCovers === true,
  );
  const wanted = highRes ?? setting;
  const upgraded = upgradeCoverUrl(src, wanted);
  const [fallback, setFallback] = useState(() => failedUpgrades.has(upgraded));

  useEffect(() => {
    setFallback(failedUpgrades.has(upgradeCoverUrl(src, wanted)));
  }, [src, wanted]);

  return (
    <img
      {...rest}
      src={fallback ? src : upgraded}
      onError={(event) => {
        if (!fallback && upgraded !== src) {
          failedUpgrades.add(upgraded);
          setFallback(true);
          return;
        }
        rest.onError?.(event);
      }}
    />
  );
}
