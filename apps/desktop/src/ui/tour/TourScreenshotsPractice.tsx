import type { ComponentType } from "react";
import { useLayoutEffect, useMemo } from "react";
import { closeScreenshotViewer, openScreenshotViewer } from "../../screenshots";
import {
  resetSampleScreenshots,
  useSampleScreenshots,
} from "../../screenshotSample";
import { useAppStore } from "../../store";
import { PersonalLibraryContext } from "../PersonalLibraryContext";
import { GameJournalHost } from "../GameJournalDialog";
import type { HistoryGuideScene } from "../views/HistoryView";
import { createLibraryTourStore } from "./libraryTourStore";
import { findTour } from "./tourDefinitions";
import { emitTourEvent } from "./tourEvents";
import { HISTORY_SAMPLE, historySampleSessions } from "./tourHistorySample";

/* The Screenshots guide shows this sample history in place of My History,
   while Settings stays the real page. Its sessions live in a store of their
   own, and its two pictures never join the player's real ones
   (screenshotSample.ts). A step says here what it needs: "viewer" starts with
   the first picture open, every other step with the viewer closed. */

export function ScreenshotsHistoryPractice({
  Page,
}: {
  Page: ComponentType<{ scene?: HistoryGuideScene }>;
}) {
  const active = useAppStore((state) => state.activeTour);
  const resetToken = useAppStore((state) => state.demoResetToken);
  const stepId = active
    ? findTour(active.tourId)?.steps[active.stepIndex]?.id
    : undefined;
  const sessions = useMemo(() => historySampleSessions("screenshots"), []);
  const store = useMemo(() => {
    const created = createLibraryTourStore(useAppStore.getState().settings);
    created.setState({ recentSessions: sessions });
    return created;
    // A jump back starts over with a fresh sample.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions, resetToken]);

  useLayoutEffect(() => {
    const withPictures = sessions.find(
      (session) => session.id === HISTORY_SAMPLE.withPictures,
    )!;
    resetSampleScreenshots(
      withPictures.gameName ?? "",
      Date.parse(withPictures.startedAt),
    );
    const shots = useSampleScreenshots.getState().shots;
    if (stepId === "viewer")
      openScreenshotViewer(shots, 0, withPictures.gameName);
    else closeScreenshotViewer();
    let finished = false;
    const unsubscribe = useSampleScreenshots.subscribe((state) => {
      if (finished || stepId !== "viewer" || !state.shots[0]?.caption) return;
      finished = true;
      emitTourEvent("demo.step-completed");
    });
    return () => {
      unsubscribe();
      closeScreenshotViewer();
    };
  }, [sessions, stepId, resetToken]);

  return (
    <PersonalLibraryContext.Provider value={store}>
      <div data-tour="demo-stats">
        <Page key={`${stepId}-${resetToken}`} scene={{ tab: "sessions" }} />
      </div>
      <GameJournalHost />
    </PersonalLibraryContext.Provider>
  );
}
