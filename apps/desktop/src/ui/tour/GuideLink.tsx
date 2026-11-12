import { GraduationCap } from "lucide-react";
import { getT } from "../../i18n";
import { useAppStore } from "../../store";
import { cn } from "../cn";
import { findTour } from "./tourDefinitions";

const t = getT("tour");

/** "Show me how": starts the guide for the feature it sits next to. It hides
 *  while a guide runs, so a practice surface never offers a second guide. */
export function GuideLink({
  tourId,
  className,
}: {
  tourId: string;
  className?: string;
}) {
  const startTour = useAppStore((state) => state.startTour);
  const running = useAppStore((state) => state.activeTour !== null);
  if (running || !findTour(tourId)) return null;
  return (
    <button
      type="button"
      data-guide-link={tourId}
      className={cn(
        "inline-flex items-center gap-1.5 rounded text-xs font-medium text-accent-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
        className,
      )}
      onClick={() => startTour(tourId)}
    >
      <GraduationCap size={14} aria-hidden="true" />
      {t("Show me how")}
    </button>
  );
}
