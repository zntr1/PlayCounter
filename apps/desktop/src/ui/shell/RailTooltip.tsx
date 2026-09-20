import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";

/* Labels for the icon rail. The nav clips horizontally so it can scroll, so
   the label cannot live inside the button; it is portalled to the body and
   positioned against the button's own rectangle. Native title tooltips would
   do the same job a second later and in the system's own styling. */

export function useRailTooltip(enabled: boolean) {
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(
    null,
  );
  const hide = useCallback(() => setAnchor(null), []);
  const show = useCallback(
    (element: HTMLElement | null) => {
      if (!enabled || !element) return;
      const rect = element.getBoundingClientRect();
      setAnchor({ top: rect.top + rect.height / 2, left: rect.right + 10 });
    },
    [enabled],
  );

  useEffect(() => {
    if (!anchor) return;
    // Scrolling the nav or resizing moves the button out from under the
    // label; there is nothing sensible to point at afterwards.
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, [anchor, hide]);

  useEffect(() => {
    if (!enabled) setAnchor(null);
  }, [enabled]);

  return {
    anchor,
    show,
    hide,
    /** Spread onto the button; every way in and out of the control. */
    triggerProps: {
      onPointerEnter: (event: React.PointerEvent<HTMLElement>) =>
        show(event.currentTarget),
      onPointerLeave: hide,
      onFocus: (event: React.FocusEvent<HTMLElement>) =>
        show(event.currentTarget),
      onBlur: hide,
      onClick: hide,
    },
  };
}

export function RailTooltip({
  anchor,
  label,
  detail,
}: {
  anchor: { top: number; left: number } | null;
  label: string;
  detail?: string;
}) {
  if (!anchor) return null;
  return createPortal(
    <div
      role="tooltip"
      style={{ top: anchor.top, left: anchor.left }}
      className="pointer-events-none fixed z-[80] max-w-[220px] -translate-y-1/2 animate-fade-in rounded-lg border border-border bg-surface px-2.5 py-1.5 shadow-raised"
    >
      <div className="whitespace-nowrap text-[13px] font-semibold text-text">
        {label}
      </div>
      {detail ? (
        <div className="mt-0.5 text-[11px] leading-4 text-text-muted">
          {detail}
        </div>
      ) : null}
    </div>,
    document.body,
  );
}
