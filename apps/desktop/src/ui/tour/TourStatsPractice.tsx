import type { Session } from "@playcounter/shared";
import { useMemo, useState } from "react";
import type { StoreApi } from "zustand";
import type { HistorySelection } from "../../historyStats";
import type { PersonalLibraryState } from "../../personalLibraryStore";
import { useAppStore } from "../../store";
import { PersonalLibraryContext } from "../PersonalLibraryContext";
import { GameJournalHost } from "../GameJournalDialog";
import {
  HistoryView,
  type HistoryGuideScene,
  type HistoryTab,
} from "../views/HistoryView";
import { createLibraryTourStore } from "./libraryTourStore";
import { findTour } from "./tourDefinitions";
import { tourSessionsForGame } from "./tourDemoGame";
import { emitTourEvent } from "./tourEvents";
import { historySampleSessions } from "./tourHistorySample";
import type { GameSummary } from "../views/MyGamesView";

/* The sample history of the guides on My History: the real page on a store
   of its own, so nothing a player tries reaches their history.

   A guide's step says here what it needs (its tab, its range) and what the
   player does to finish it. The page is mounted anew for every step, and
   Back or a jump from the guide's checklist starts over with a fresh sample,
   so a step looks the same from wherever it is entered. */

type Scene = {
  tab: HistoryTab;
  /** The range the step starts on; All time when left out. */
  selection?: HistorySelection;
  /** What the player does to finish the step. */
  finish?: { on: "range" } | { on: "tab"; tab: HistoryTab };
};

const SESSIONS: Scene = { tab: "sessions" };

const SCENES: Record<string, Record<string, Scene>> = {
  stats: {
    ranges: { tab: "sessions", finish: { on: "range" } },
    // 7 days has sessions in the week before too, so the comparison shows.
    compare: {
      tab: "sessions",
      selection: { kind: "last7", offset: 0 },
      finish: { on: "range" },
    },
    // 30 days against the 30 before: Pace, the sixth chart, needs both.
    charts: {
      tab: "insights",
      selection: { kind: "last30", offset: 0 },
      finish: { on: "tab", tab: "games" },
    },
    games: { tab: "games" },
  },
};

const done = () => emitTourEvent("demo.step-completed");

function sampleStore(sessions: Session[]) {
  const store = createLibraryTourStore(useAppStore.getState().settings);
  store.setState({ recentSessions: sessions });
  return store;
}

function Practice({
  store,
  scene,
  stepId,
}: {
  store: StoreApi<PersonalLibraryState>;
  scene?: HistoryGuideScene;
  stepId?: string;
}) {
  return (
    <PersonalLibraryContext.Provider value={store}>
      <div data-tour="demo-stats">
        <HistoryView key={stepId} scene={scene} />
      </div>
      <GameJournalHost />
    </PersonalLibraryContext.Provider>
  );
}

/** The sample history of the guide that is running. */
function GuidePractice() {
  const active = useAppStore((state) => state.activeTour);
  const tourId = active?.tourId;
  const stepIndex = active?.stepIndex;
  const stepId = useMemo(
    () =>
      tourId !== undefined && stepIndex !== undefined
        ? findTour(tourId)?.steps[stepIndex]?.id
        : undefined,
    [tourId, stepIndex],
  );
  const [store] = useState(() => sampleStore(historySampleSessions(tourId)));
  const step =
    (tourId !== undefined && stepId !== undefined
      ? SCENES[tourId]?.[stepId]
      : undefined) ?? SESSIONS;
  const scene = useMemo<HistoryGuideScene>(() => {
    const finish = step.finish;
    return {
      tab: step.tab,
      selection: step.selection,
      onRangeChange: finish?.on === "range" ? done : undefined,
      onTabChange:
        finish?.on === "tab"
          ? (tab) => {
              if (tab === finish.tab) done();
            }
          : undefined,
    };
  }, [step]);
  return <Practice store={store} scene={scene} stepId={stepId} />;
}

/** The sessions of one sample game, for "Game history" on the sample card. */
function GamePractice({ game }: { game: GameSummary }) {
  const [store] = useState(() => sampleStore(tourSessionsForGame(game)));
  return <Practice store={store} />;
}

export function StatsPractice({
  game,
}: {
  game?: GameSummary;
  /** No longer used: the guide's last step keeps the history in view. */
  milestones?: boolean;
} = {}) {
  // Back and a jump from the checklist start over with a fresh sample.
  const resetToken = useAppStore((state) => state.demoResetToken);
  return game ? (
    <GamePractice game={game} />
  ) : (
    <GuidePractice key={resetToken} />
  );
}
