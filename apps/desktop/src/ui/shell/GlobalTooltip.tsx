import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/* Replaces the WebView's native `title` tooltips app-wide with the same card
   the icon rail uses. Call sites keep writing plain `title="…"`; while the
   pointer rests on such an element its title is parked in `data-tip-title`
   so the system tooltip never opens, and put back when the pointer leaves. */

const HOVER_DELAY_MS = 500;
const GAP = 8;
const EDGE = 8;

type Tip = { text: string; rect: DOMRect };

export function GlobalTooltip() {
  const [tip, setTip] = useState<Tip | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const tipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let target: HTMLElement | null = null;
    let timer: number | null = null;

    const release = () => {
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
      if (target) {
        const parked = target.getAttribute("data-tip-title");
        // React may have written a fresh title meanwhile; that one wins.
        if (parked !== null && !target.hasAttribute("title")) {
          target.setAttribute("title", parked);
        }
        target.removeAttribute("data-tip-title");
        target = null;
      }
      setTip(null);
    };

    const onOver = (event: Event) => {
      const next = (event.target as Element | null)?.closest?.(
        "[title]",
      ) as HTMLElement | null;
      if (!next || next === target) return;
      // SVG <title> children are elements, not attributes; closest("[title]")
      // only ever finds the attribute form, so charts are left alone.
      const text = next.getAttribute("title")?.trim();
      release();
      if (!text) return;
      target = next;
      next.setAttribute("data-tip-title", text);
      next.removeAttribute("title");
      timer = window.setTimeout(() => {
        timer = null;
        if (target === next && next.isConnected) {
          setTip({ text, rect: next.getBoundingClientRect() });
        }
      }, HOVER_DELAY_MS);
    };

    const onOut = (event: Event) => {
      if (!target) return;
      const to = (event as PointerEvent).relatedTarget as Node | null;
      if (to && target.contains(to)) return;
      release();
    };

    document.addEventListener("pointerover", onOver, true);
    document.addEventListener("pointerout", onOut, true);
    document.addEventListener("pointerdown", release, true);
    window.addEventListener("scroll", release, true);
    window.addEventListener("resize", release);
    window.addEventListener("blur", release);
    return () => {
      release();
      document.removeEventListener("pointerover", onOver, true);
      document.removeEventListener("pointerout", onOut, true);
      document.removeEventListener("pointerdown", release, true);
      window.removeEventListener("scroll", release, true);
      window.removeEventListener("resize", release);
      window.removeEventListener("blur", release);
    };
  }, []);

  // Below the element and centred on it; above when there is no room, and
  // clamped so it never runs off the window's sides.
  useLayoutEffect(() => {
    if (!tip || !tipRef.current) {
      setPos(null);
      return;
    }
    const { width, height } = tipRef.current.getBoundingClientRect();
    const { rect } = tip;
    let top = rect.bottom + GAP;
    if (top + height > window.innerHeight - EDGE) {
      top = Math.max(EDGE, rect.top - GAP - height);
    }
    const centred = rect.left + rect.width / 2 - width / 2;
    const left = Math.min(
      Math.max(EDGE, centred),
      window.innerWidth - EDGE - width,
    );
    setPos({ top, left });
  }, [tip]);

  if (!tip) return null;
  return createPortal(
    <div
      ref={tipRef}
      role="tooltip"
      style={{
        top: pos?.top ?? 0,
        left: pos?.left ?? 0,
        visibility: pos ? "visible" : "hidden",
      }}
      className="pointer-events-none fixed z-[90] max-w-[280px] animate-tip-in whitespace-pre-line rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[12px] leading-4 text-text shadow-raised motion-reduce:animate-none"
    >
      {tip.text}
    </div>,
    document.body,
  );
}
