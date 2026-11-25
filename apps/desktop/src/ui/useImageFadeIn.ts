import {
  useLayoutEffect,
  useRef,
  useState,
  type AnimationEventHandler,
  type ReactEventHandler,
} from "react";

/* An image that is still loading shows a soft shimmer in its place, then
   fades in once it has loaded, instead of popping in (styles.css:
   img[data-img-loading], img[data-img-fade-in]). Art with its own entrance
   animation plays it once loaded, not on an empty frame. An image the
   webview already has shows at once, so scrolling back or switching views
   doesn't shimmer or fade it again. A picture that fails stops shimmering
   and stays hidden, so it never looks like it is still coming.

   Spread the result on the <img>. It decides once per mount: a caller whose
   src changes to a different picture gives the <img> a `key` of its src.
   The fade is an animation without a lasting fill, dropped when it ends: one
   left applying keeps an image softer in WebView2. */
export function useImageFadeIn(handlers: {
  onLoad?: ReactEventHandler<HTMLImageElement>;
  onAnimationEnd?: AnimationEventHandler<HTMLImageElement>;
  onError?: ReactEventHandler<HTMLImageElement>;
} = {}) {
  const ref = useRef<HTMLImageElement | null>(null);
  const [phase, setPhase] = useState<
    "loading" | "failed" | "fade-in" | "shown"
  >("loading");
  useLayoutEffect(() => {
    const img = ref.current;
    if (img?.complete && img.naturalWidth > 0) setPhase("shown");
  }, []);

  return {
    ref,
    "data-img-loading": phase === "loading" ? "" : undefined,
    "data-img-failed": phase === "failed" ? "" : undefined,
    "data-img-fade-in": phase === "fade-in" ? "" : undefined,
    onLoad: ((event) => {
      setPhase((current) =>
        current === "loading" || current === "failed" ? "fade-in" : current,
      );
      handlers.onLoad?.(event);
    }) satisfies ReactEventHandler<HTMLImageElement>,
    onError: ((event) => {
      setPhase((current) => (current === "loading" ? "failed" : current));
      handlers.onError?.(event);
    }) satisfies ReactEventHandler<HTMLImageElement>,
    onAnimationEnd: ((event) => {
      handlers.onAnimationEnd?.(event);
      if (event.target !== event.currentTarget) return;
      setPhase((current) => (current === "fade-in" ? "shown" : current));
    }) satisfies AnimationEventHandler<HTMLImageElement>,
  };
}
