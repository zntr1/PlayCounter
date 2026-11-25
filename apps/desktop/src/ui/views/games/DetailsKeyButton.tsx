import { useLayoutEffect, useRef } from "react";
import { ControllerButtonGlyph } from "../../ControllerButtonGlyph";
import { getT } from "../../../i18n";
import { cn } from "../../cn";

const t = getT("myGames");

// Where styles.css shows the button.
const SHOWN =
  ':root[data-controller-mode="true"] .game-library-card[data-controller-selected="true"] .details-key-hint';

// Tries the row at its content widths (no data-fit, see styles.css): short of
// room, the button gives way first and its name wraps onto a line it cuts
// off. Then `data-fit` settles it: "name" when everything fit, so the action
// and Details share the row evenly; "glyph" when not, so the name goes, the
// button shrinks to the glyph and the room goes back to the action.
function fitName(button: HTMLButtonElement) {
  if (!button.matches(SHOWN)) {
    button.removeAttribute("data-fit");
    return;
  }
  const [glyph, name] = Array.from(button.children) as HTMLElement[];
  button.removeAttribute("data-fit");
  button.setAttribute(
    "data-fit",
    name.offsetTop === glyph.offsetTop ? "name" : "glyph",
  );
}

// Beside Play on the selected card while a controller drives the app (see
// .details-key-hint in styles.css): Y / Triangle opens Details, and so does a
// click.
export function DetailsKeyButton({
  gameName,
  onClick,
  className,
}: {
  gameName: string;
  onClick: () => void;
  className?: string;
}) {
  const ref = useRef<HTMLButtonElement>(null);

  // The action beside it may have changed, Play to Running + Stop.
  useLayoutEffect(() => {
    if (ref.current) fitName(ref.current);
  });

  // The card got wider or narrower, or the controller just picked it: the
  // glyph goes from no size to its size. Neither changes with the name.
  useLayoutEffect(() => {
    const button = ref.current;
    if (!button?.parentElement || !button.firstElementChild) return;
    const observer = new ResizeObserver(() => fitName(button));
    observer.observe(button.parentElement);
    observer.observe(button.firstElementChild);
    return () => observer.disconnect();
  }, []);

  return (
    <button
      ref={ref}
      type="button"
      aria-label={t("Open details for {{name}}", { name: gameName })}
      title={t("Open details")}
      onClick={onClick}
      className={cn(
        "details-key-hint items-center justify-center gap-x-1.5 font-semibold",
        className,
      )}
    >
      <span>
        <ControllerButtonGlyph button="Y" size="small" />
      </span>
      <span>{t("Details")}</span>
    </button>
  );
}
