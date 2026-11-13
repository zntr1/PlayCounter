import type { ComponentType } from "react";
import { useLayoutEffect, useMemo, useRef } from "react";
import {
  closeScreenshotViewer,
  openScreenshotViewer,
  useScreenshotViewer,
} from "../../screenshots";
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
   (screenshotSample.ts). A step says here what it needs: "viewer" keeps the
   picture the player opened on "pictures", or opens the first one when it is
   entered any other way; every other step has the viewer closed. */

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

  const before = useRef({ stepId, resetToken });
  useLayoutEffect(() => {
    const withPictures = sessions.find(
      (session) => session.id === HISTORY_SAMPLE.withPictures,
    )!;
    // The picture clicked on "pictures" stays open, caption and all.
    const keepOpen =
      stepId === "viewer" &&
      before.current.stepId === "pictures" &&
      before.current.resetToken === resetToken &&
      useScreenshotViewer.getState().shots.length > 0;
    before.current = { stepId, resetToken };
    if (!keepOpen)
      resetSampleScreenshots(
        withPictures.gameName ?? "",
        Date.parse(withPictures.startedAt),
      );
    const shots = useSampleScreenshots.getState().shots;
    if (stepId !== "viewer") closeScreenshotViewer();
    else if (!keepOpen) openScreenshotViewer(shots, 0, withPictures.gameName);
    // A caption added or changed on any picture is the task.
    const captions = shots.map((shot) => shot.caption ?? null);
    let finished = false;
    const unsubscribe = useSampleScreenshots.subscribe((state) => {
      if (finished || stepId !== "viewer") return;
      if (
        !state.shots.some(
          (shot, index) => (shot.caption ?? null) !== captions[index],
        )
      )
        return;
      finished = true;
      emitTourEvent("demo.step-completed");
    });
    return () => {
      unsubscribe();
      // The viewer a click on "pictures" opened carries over into "viewer".
      const active = useAppStore.getState().activeTour;
      const next = active
        ? findTour(active.tourId)?.steps[active.stepIndex]?.id
        : undefined;
      if (stepId !== "pictures" || next !== "viewer") closeScreenshotViewer();
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
