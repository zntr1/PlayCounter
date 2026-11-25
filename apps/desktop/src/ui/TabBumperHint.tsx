import { cn } from "./cn";
import { ControllerButtonGlyph } from "./ControllerButtonGlyph";

// LB before a tab row and RB after it: they switch its tabs
// (controllerBridge). Settings' menu shows them above and below its pages,
// with a label. Shown only while a controller drives the app (see
// .controller-mode-only in styles.css).
export function TabBumperHint({
  button,
  label,
}: {
  button: "LB" | "RB";
  label?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "controller-mode-only shrink-0 items-center self-center",
        label ? "gap-2 px-1.5 text-xs font-medium text-text-faint" : "px-1",
      )}
    >
      {/* Small: it fits the tab's height, also in rows that scroll sideways. */}
      <ControllerButtonGlyph button={button} size="small" />
      {label}
    </span>
  );
}
