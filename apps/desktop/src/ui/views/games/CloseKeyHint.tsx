import { Square } from "lucide-react";
import { ControllerButtonGlyph } from "../../ControllerButtonGlyph";

// The ■ on a running card's Close button. On the selected card it turns into
// the X / Square glyph while a controller drives the app (see .close-key-hint
// in styles.css). The keyboard has no key for it, so the ■ stays there.
export function CloseKeyHint({ size }: { size: number }) {
  return (
    <>
      <Square
        size={size}
        fill="currentColor"
        aria-hidden="true"
        className="close-key-icon shrink-0"
      />
      <span className="close-key-hint">
        <ControllerButtonGlyph button="X" size="small" />
      </span>
    </>
  );
}
