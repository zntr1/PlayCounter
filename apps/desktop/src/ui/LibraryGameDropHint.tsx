import { Check, Info, SlidersHorizontal } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";

export type ShelfDropHint = {
  target: HTMLElement;
  reason: "already-added" | "saved-filter" | "unavailable";
  title: string;
  detail?: string;
};

export function positionLibraryGameHints(
  hints: { target: HTMLElement; element: HTMLElement }[],
) {
  // Batch the reads before writing positions, including when the rail scrolls.
  const positions = hints.map(({ target, element }) => ({
    element,
    anchor: target.getBoundingClientRect(),
    size: element.getBoundingClientRect(),
  }));
  for (const {
    element,
    anchor,
    size: { width, height },
  } of positions) {
    const center = anchor.left + anchor.width / 2;
    const left = Math.max(
      12,
      Math.min(center - width / 2, window.innerWidth - width - 12),
    );
    const top = anchor.top - height - 10;
    element.style.left = `${left}px`;
    element.style.top = `${top}px`;
    element.style.setProperty(
      "--drop-hint-arrow-x",
      `${Math.max(12, Math.min(center - left, width - 12))}px`,
    );
    element.dataset.side = "above";
  }
}

/** Empty slots are filled once at pickup. CSS handles visibility on shelf hover. */
export function LibraryGameHoverHint() {
  return (
    <span id={useId()} role="tooltip" className="library-game-hover-hint">
      <span className="library-game-drop-hint-icon" aria-hidden="true">
        <Check size={14} data-hint-icon="already-added" />
        <SlidersHorizontal size={14} data-hint-icon="saved-filter" />
        <Info size={14} data-hint-icon="unavailable" />
      </span>
      <span className="min-w-0">
        <span data-hint-title className="block font-semibold" />
        <span
          data-hint-detail
          className="mt-0.5 block text-[11px] font-normal text-text-muted empty:hidden"
        />
      </span>
    </span>
  );
}

/** Feedback is mounted only after a drop; it does no work while dragging. */
export function LibraryGameDropHint({
  hint,
  onDismiss,
}: {
  hint: ShelfDropHint | null;
  onDismiss: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!hint || !ref.current) return;
    positionLibraryGameHints([{ target: hint.target, element: ref.current }]);
  }, [hint]);

  useEffect(() => {
    if (!hint) return;
    const timeout = window.setTimeout(onDismiss, 3000);
    const keyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onDismiss();
    };
    window.addEventListener("pointerdown", onDismiss, true);
    window.addEventListener("scroll", onDismiss, true);
    window.addEventListener("resize", onDismiss);
    window.addEventListener("blur", onDismiss);
    window.addEventListener("keydown", keyDown);
    return () => {
      clearTimeout(timeout);
      window.removeEventListener("pointerdown", onDismiss, true);
      window.removeEventListener("scroll", onDismiss, true);
      window.removeEventListener("resize", onDismiss);
      window.removeEventListener("blur", onDismiss);
      window.removeEventListener("keydown", keyDown);
    };
  }, [hint, onDismiss]);

  if (!hint) return null;
  const Icon =
    hint.reason === "already-added"
      ? Check
      : hint.reason === "saved-filter"
        ? SlidersHorizontal
        : Info;
  return createPortal(
    <div
      ref={ref}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="library-game-drop-hint"
    >
      <span className="library-game-drop-hint-icon" aria-hidden="true">
        <Icon size={14} strokeWidth={2} />
      </span>
      <div className="min-w-0">
        <div className="font-semibold">{hint.title}</div>
        {hint.detail ? (
          <div className="mt-0.5 text-[11px] font-normal text-text-muted">
            {hint.detail}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
