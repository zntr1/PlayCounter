import { useCallback, useRef, type FocusEvent, type PointerEvent } from "react";

/* The glow in the colors of the cover under the pointer (Covers view), or
   of the cover picked with the arrow keys, a controller or Tab: they all
   focus the card, so focus leads the glow like the pointer does.

   Two blurred cover copies serve the whole grid, however many games it shows:
   on reaching a card, the idle one moves behind it and fades in, the other
   fades out where the last one was. They are set straight on the DOM, so no
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

  /** Lights the card around `target`; nothing to light (a gap, a card
   *  without a cover) puts the glow out. */
  const glowAt = useCallback(
    (target: EventTarget | null) => {
      const card =
        target instanceof Element
          ? target.closest<HTMLElement>(".game-library-card")
          : null;
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

  const onPointerOver = useCallback(
    (event: PointerEvent<HTMLElement>) => glowAt(event.target),
    [glowAt],
  );
  const onFocus = useCallback(
    (event: FocusEvent<HTMLElement>) => glowAt(event.target),
    [glowAt],
  );
  // Focus leaving the grid (Escape, Tab, a click elsewhere) puts it out;
  // moving between cards is the next onFocus.
  const onBlur = useCallback(
    (event: FocusEvent<HTMLElement>) => {
      const next = event.relatedTarget;
      if (!(next instanceof Node) || !event.currentTarget.contains(next))
        hide();
    },
    [hide],
  );

  if (!enabled)
    return {
      layer: null,
      onPointerOver: undefined,
      onPointerLeave: undefined,
      onFocus: undefined,
      onBlur: undefined,
    };
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
    onFocus,
    onBlur,
  };
}
