import { XboxButtonGlyph } from "../../XboxButtonGlyph";

// Shown on the selected card's play button in place of the play icon. The
// styles pick the A glyph while a controller drives the app and the Enter key
// for the keyboard (see .launch-key-hint in styles.css).
export function LaunchKeyHint({ compact = false }: { compact?: boolean }) {
  return (
    <>
      <span className="launch-key-hint launch-key-hint--controller">
        <XboxButtonGlyph button="A" size="small" />
      </span>
      <kbd
        aria-hidden="true"
        className="launch-key-hint launch-key-hint--keyboard select-none items-center rounded border border-current px-1.5 font-sans text-[11px] font-semibold leading-5"
      >
        {compact ? "↵" : "Enter"}
      </kbd>
    </>
  );
}
