import { StatsPractice } from "./TourStatsPractice";
import { lazy, Suspense } from "react";
import { createPortal } from "react-dom";
import { DetectionPractice } from "./DetectionPractice";
import type { TourDefinition } from "./tourDefinitions";
import { getT } from "../../i18n";

const t = getT("tour");

// The real import screens on sample games, loaded when the guide needs them.
const ImportTourPractice = lazy(() => import("./ImportTourPractice"));

export function TourPracticeSurface({
  tour,
  stepId,
}: {
  tour: TourDefinition;
  stepId: string;
}) {
  return createPortal(
    <div className="tour-practice-space">
      <div
        data-tour="demo-library-stage"
        className="grid gap-4 rounded-xl border border-border bg-bg p-4"
      >
        <div>
          <h2 className="font-semibold text-text">
            {t("Practice · {{title}}", { title: tour.title })}
          </h2>
          <p className="text-xs text-text-muted">
            {t(
              "Sample data · changes disappear when you leave · nothing is submitted",
            )}
          </p>
        </div>
        {tour.simulation === "detection" ? (
          <DetectionPractice />
        ) : tour.simulation === "stats" ? (
          <StatsPractice milestones={stepId === "milestones"} />
        ) : (
          <Suspense fallback={null}>
            <ImportTourPractice stepId={stepId} />
          </Suspense>
        )}
      </div>
    </div>,
    document.body,
  );
}
