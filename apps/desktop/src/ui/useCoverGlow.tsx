import { useCallback, useRef, type PointerEvent } from "react";

/* The glow in the colors of the cover under the pointer (Covers view).

   Two blurred cover copies serve the whole grid, however many games it shows:
   on entering a card, the idle one moves behind it and fades in, the other
   fades out where the pointer was. They are set straight on the DOM, so no
   card re-renders on hover. The grid must be positioned (`relative`): a
   card's offsetLeft/offsetTop are read against it. Styles: .cover-glow. */
export function useCoverGlow(enabled: boolean) {
  const glows = useRef<(HTMLImageElement | null)[]>([null, null]);
  const lit = useRef<{ card: Element | null; turn: number }>({
    card: null,
    turn: 0,
  });

  const hide = useCallback(() => {
    lit.current.card = null;
    for (const glow of glows.current) glow?.removeAttribute("data-on");
  }, []);

  const onPointerOver = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      const card = (event.target as Element).closest<HTMLElement>(
        ".game-library-card",
      );
      if (card === lit.current.card) return;
      const cover = card?.querySelector<HTMLImageElement>(
        ".game-card-cover-image",
      );
      if (!card || !cover) {
        hide();
        return;
      }
      lit.current.card = card;
      lit.current.turn ^= 1;
      const next = glows.current[lit.current.turn];
      glows.current[lit.current.turn ^ 1]?.removeAttribute("data-on");
      if (!next) return;
      // A little narrower than the card and a little lower, like light
      // falling from the cover onto the surface below it.
      const width = card.offsetWidth;
      const height = card.offsetHeight;
      Object.assign(next.style, {
        left: `${card.offsetLeft + width * 0.03}px`,
        top: `${card.offsetTop + height * 0.06 + 4}px`,
        width: `${width * 0.94}px`,
        height: `${height * 0.92}px`,
      });
      next.src = cover.currentSrc || cover.src;
      next.setAttribute("data-on", "");
    },
    [hide],
  );

  if (!enabled)
    return { layer: null, onPointerOver: undefined, onPointerLeave: undefined };
  return {
    layer: [0, 1].map((index) => (
      <img
        key={index}
        ref={(element) => {
          glows.current[index] = element;
          // Back in the Covers view, the card under the pointer glows again.
          if (!element) lit.current.card = null;
        }}
        data-cover-glow=""
        alt=""
        aria-hidden="true"
        decoding="async"
        className="cover-glow"
      />
    )),
    onPointerOver,
    onPointerLeave: hide,
  };
}
