import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ImgHTMLAttributes,
} from "react";
import { coverQualityOf, upgradeCoverUrl } from "../coverArt";
import { markCoverUnavailable } from "../pickedCovers";
import { useAppStore } from "../store";

/* A cover <img> that honours the "Cover quality" setting.

   The upgraded size is a different file on IGDB's CDN, and nothing guarantees
   every cover has one. A URL that fails once is remembered here for the app's
   lifetime and served at its original size from then on, so a missing 2x asset
   degrades to exactly today's image instead of an empty box - and is not
   retried on every render. */
const failedUpgrades = new Set<string>();

export function GameCover({
  src,
  large,
  highRes,
  ...rest
}: {
  src: string;
  /** Shown big (library cards, heroes, details): may load Sharpest and
   *  Original. Every other cover stops at Sharp, which is already twice what
   *  a small cover shows, so a new small spot stays cheap on its own. */
  large?: boolean;
  /** At least Sharp, whatever the setting says (details view). */
  highRes?: boolean;
} & Omit<ImgHTMLAttributes<HTMLImageElement>, "src">) {
  const setting = useAppStore((state) => coverQualityOf(state.settings));
  const capped =
    !large && (setting === "sharpest" || setting === "original")
      ? "sharp"
      : setting;
  const wanted = highRes && capped === "standard" ? "sharp" : capped;
  const upgraded = upgradeCoverUrl(src, wanted);
  const [fallback, setFallback] = useState(() => failedUpgrades.has(upgraded));

  useEffect(() => {
    setFallback(failedUpgrades.has(upgradeCoverUrl(src, wanted)));
  }, [src, wanted]);

  /* A cover still loading stays hidden and fades in once it has loaded
     (styles.css: [data-cover-loading], [data-cover-fade-in]), instead of
     popping in. One the webview already has shows at once, so scrolling back
     or switching views doesn't fade it again; a later src change doesn't
     either. The fade is a transition, dropped when it ends: an animation
     left applying keeps an image softer in WebView2. */
  const imgRef = useRef<HTMLImageElement>(null);
  const [phase, setPhase] = useState<"loading" | "fade-in" | "shown">(
    "loading",
  );
  useLayoutEffect(() => {
    const img = imgRef.current;
    if (img?.complete && img.naturalWidth > 0) setPhase("shown");
  }, []);

  /* A library of any size puts far more covers in the DOM than fit on screen.
     Leaving the off-screen ones to the browser keeps the first paint cheap;
     callers that need a cover decoded up front (the hero) can override both. */
  return (
    <img
      loading="lazy"
      decoding="async"
      {...rest}
      ref={imgRef}
      data-cover-loading={phase === "loading" ? "" : undefined}
      data-cover-fade-in={phase === "fade-in" ? "" : undefined}
      onLoad={(event) => {
        setPhase((current) => (current === "loading" ? "fade-in" : current));
        rest.onLoad?.(event);
      }}
      onTransitionEnd={(event) => {
        rest.onTransitionEnd?.(event);
        if (event.target !== event.currentTarget) return;
        if (event.propertyName && event.propertyName !== "opacity") return;
        setPhase((current) => (current === "fade-in" ? "shown" : current));
      }}
      src={fallback ? src : upgraded}
      onError={(event) => {
        if (!fallback && upgraded !== src) {
          failedUpgrades.add(upgraded);
          setFallback(true);
          return;
        }
        // Every view resolving this game's cover skips it from now on.
        markCoverUnavailable(src);
        rest.onError?.(event);
      }}
    />
  );
}
