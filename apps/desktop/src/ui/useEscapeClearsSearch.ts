import { useEffect } from "react";
import { hasOpenContextMenu } from "./ContextMenu";

/* Escape clears a page's search text from anywhere on the page, unless
   something else owns the key: a dialog, a menu, the tour card or another
   text field. The search field clears its own text first and marks the
   event handled. */
export function useEscapeClearsSearch(enabled: boolean, clear: () => void) {
  useEffect(() => {
    if (!enabled) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key !== "Escape" ||
        event.defaultPrevented ||
        event.isComposing ||
        hasOpenContextMenu() ||
        (event.target instanceof Element &&
          event.target.closest(
            'input, textarea, select, [contenteditable="true"]',
          ))
      )
        return;
      const overlayOpen = [
        ...document.querySelectorAll<HTMLElement>(
          '[role="dialog"], [role="menu"]',
        ),
      ].some((overlay) => overlay.getClientRects().length > 0);
      if (overlayOpen) return;
      event.preventDefault();
      clear();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [enabled, clear]);
}
