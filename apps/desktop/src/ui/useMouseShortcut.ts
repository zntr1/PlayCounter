import { useEffect, useRef } from "react";
import { shortcutFromMouse } from "../shortcutKeys";

/** While a key field waits, a mouse button pressed anywhere in the window is
 *  the answer: the pointer needn't be over the field. `onButton` gets the
 *  shortcut, or null for a button that can't be one (right, or macOS). Left
 *  stays free: it starts and stops waiting. Back/Forward and the context menu
 *  stay shut meanwhile. */
export function useMouseShortcut(
  active: boolean,
  onButton: (shortcut: string | null) => void,
) {
  const latest = useRef(onButton);
  latest.current = onButton;
  useEffect(() => {
    if (!active) return;
    const down = (event: MouseEvent) => {
      if (event.button === 0) return;
      event.preventDefault();
      event.stopPropagation();
      latest.current(shortcutFromMouse(event));
    };
    const shut = (event: MouseEvent) => {
      if (event.button !== 0) event.preventDefault();
    };
    window.addEventListener("mousedown", down, true);
    window.addEventListener("mouseup", shut, true);
    window.addEventListener("auxclick", shut, true);
    window.addEventListener("contextmenu", shut, true);
    return () => {
      window.removeEventListener("mousedown", down, true);
      window.removeEventListener("mouseup", shut, true);
      window.removeEventListener("auxclick", shut, true);
      window.removeEventListener("contextmenu", shut, true);
    };
  }, [active]);
}
