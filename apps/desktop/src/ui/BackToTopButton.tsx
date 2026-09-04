import { ArrowUp } from "lucide-react";
import { useEffect, useState, type RefObject } from "react";
import { shouldShowBackToTop } from "./backToTop";

export function BackToTopButton({
  containerRef,
}: {
  containerRef: RefObject<HTMLElement | null>;
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const update = () =>
      setVisible(
        shouldShowBackToTop(container.scrollTop, container.clientHeight),
      );
    update();
    container.addEventListener("scroll", update, { passive: true });
    return () => container.removeEventListener("scroll", update);
  }, [containerRef]);

  if (!visible) return null;

  return (
    <button
      type="button"
      aria-label="Back to top"
      onClick={() => {
        const container = containerRef.current;
        if (!container) return;
        const reducedMotion = window.matchMedia?.(
          "(prefers-reduced-motion: reduce)",
        ).matches;
        container.scrollTo({
          top: 0,
          behavior: reducedMotion ? "auto" : "smooth",
        });
      }}
      className="absolute bottom-6 right-7 z-40 inline-flex items-center gap-2 rounded-full border border-border bg-surface px-4 py-2 text-sm font-medium text-text shadow-raised transition hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
    >
      <ArrowUp size={15} />
      Back to top
    </button>
  );
}
