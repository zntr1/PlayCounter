import {
  useLayoutEffect,
  useRef,
  useState,
  type ReactEventHandler,
  type TransitionEventHandler,
} from "react";

/* An image that is still loading stays hidden and fades in once it has
   loaded, instead of popping in (styles.css: img[data-img-loading],
   img[data-img-fade-in]). Art with its own entrance animation plays it once
   loaded, not on an empty frame. An image the webview already has shows at
   once, so scrolling back or switching views doesn't fade it again.

   Spread the result on the <img>. It decides once per mount: a caller whose
   src changes to a different picture gives the <img> a `key` of its src.
   The fade is a transition, dropped when it ends: an animation left applying
   keeps an image softer in WebView2. */
export function useImageFadeIn(handlers: {
  onLoad?: ReactEventHandler<HTMLImageElement>;
  onTransitionEnd?: TransitionEventHandler<HTMLImageElement>;
} = {}) {
  const ref = useRef<HTMLImageElement>(null);
  const [phase, setPhase] = useState<"loading" | "fade-in" | "shown">(
    "loading",
  );
  useLayoutEffect(() => {
    const img = ref.current;
    if (img?.complete && img.naturalWidth > 0) setPhase("shown");
  }, []);

  return {
    ref,
    "data-img-loading": phase === "loading" ? "" : undefined,
    "data-img-fade-in": phase === "fade-in" ? "" : undefined,
    onLoad: ((event) => {
      setPhase((current) => (current === "loading" ? "fade-in" : current));
      handlers.onLoad?.(event);
    }) satisfies ReactEventHandler<HTMLImageElement>,
    onTransitionEnd: ((event) => {
      handlers.onTransitionEnd?.(event);
      if (event.target !== event.currentTarget) return;
      if (event.propertyName && event.propertyName !== "opacity") return;
      setPhase((current) => (current === "fade-in" ? "shown" : current));
    }) satisfies TransitionEventHandler<HTMLImageElement>,
  };
}
