import { CheckSquare, SlidersHorizontal } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { emitTourEvent } from "./TourUI";
import { useStore } from "zustand";
import { createPortal } from "react-dom";
import {
  matchesLibraryFilters,
  type LibraryFilters,
} from "../../personalLibrary";
import { getGameJournal, useAppStore } from "../../store";
import { GameJournalHost } from "../GameJournalDialog";
import { DesktopNotificationOverlay } from "../DesktopNotificationOverlay";
import { LibraryAppearanceControls } from "../LibraryAppearanceControls";
import { LibraryBulkActions } from "../LibraryBulkActions";
import { LibraryGameDropHint } from "../LibraryGameDropHint";
import {
  LibraryOrganizationToolbar,
  matchesShelf,
  useLibraryJournalLookup,
} from "../LibraryOrganization";
import { PersonalLibraryContext } from "../PersonalLibraryContext";
import { useLibraryGameDrag } from "../libraryGameDrag";
import { Button, Switch } from "../primitives";
import { useLibraryGridColumns } from "../useLibraryGridColumns";
import {
  librarySelectionKey,
  useLibrarySelection,
} from "../useLibrarySelection";
import { GameLibraryCard, makeCoreTourDemoGames } from "../views/MyGamesView";
import {
  createLibraryTourStore,
  LIBRARY_TOUR_GAME,
  LIBRARY_TOUR_GRID_COLUMNS,
  type LibraryTourState,
} from "./libraryTourStore";
import type { StoreApi } from "zustand";

type ExerciseProgress = {
  favorites: number;
  onShelf: number;
  shelfFilters: boolean;
  statusFilter: string | null;
  allSelected: boolean;
  withStatus: number;
  samples: number;
  columns: number | null;
  detailCycles: number;
  note: string;
  playthroughs: number;
  runNote: string;
  moved: number;
  finishedRuns: number;
};

/** Whether the learner did what the step asks, compared with its start. */
export function exerciseDone(
  step: string,
  before: ExerciseProgress,
  now: ExerciseProgress,
) {
  switch (step) {
    case "notes-playthroughs:note":
      return now.note.trim() !== "" && now.note !== before.note;
    case "notes-playthroughs:create-run":
      return now.playthroughs > before.playthroughs;
    case "notes-playthroughs:active-run":
      return now.runNote.trim() !== "" && now.runNote !== before.runNote;
    case "notes-playthroughs:move-session":
      return now.moved > before.moved;
    case "notes-playthroughs:finish-run":
      return now.finishedRuns > before.finishedRuns;
    case "organize-library:favorite":
      return now.favorites > before.favorites;
    case "organize-library:fill-shelf":
      return now.onShelf > before.onShelf;
    case "organize-library:filters":
      return (
        now.statusFilter === "playing" && before.statusFilter !== "playing"
      );
    case "organize-library:save-filters":
      return now.shelfFilters && !before.shelfFilters;
    case "library-progress:filter":
      return now.statusFilter === "none" && before.statusFilter !== "none";
    case "library-progress:select-games":
      return now.allSelected && !before.allSelected;
    case "library-progress:apply":
      return now.withStatus === now.samples && before.withStatus < now.samples;
    case "library-progress:customize":
      return now.columns !== before.columns;
    case "library-progress:card-details":
      return now.detailCycles > before.detailCycles;
    default:
      return false;
  }
}

export function LibraryTourPractice({
  tourId,
  stepId,
}: {
  tourId: string;
  stepId: string;
}) {
  const [store] = useState(() =>
    createLibraryTourStore(useAppStore.getState().settings),
  );
  return createPortal(
    <PersonalLibraryContext.Provider value={store}>
      <PracticeLibrary store={store} tourId={tourId} stepId={stepId} />
      <GameJournalHost />
    </PersonalLibraryContext.Provider>,
    document.body,
  );
}

function PracticeLibrary({
  store,
  tourId,
  stepId,
}: {
  store: StoreApi<LibraryTourState>;
  tourId: string;
  stepId: string;
}) {
  const resetToken = useAppStore((s) => s.demoResetToken);
  const settings = useStore(store, (s) => s.settings);
  const shelves = useStore(store, (s) => s.personalShelves);
  const notice = useStore(store, (s) => s.notice);
  useEffect(() => {
    if (notice) emitTourEvent("demo.action-completed", notice.title);
  }, [notice]);
  const sessions = useStore(store, (s) => s.recentSessions);
  const journalFor = useLibraryJournalLookup();
  const [shelfId, setShelfId] = useState("all");
  const [filters, setFilters] = useState<LibraryFilters>({});
  const [expanded, setExpanded] = useState(false);
  const [customize, setCustomize] = useState(false);
  const [popupNames, setPopupNames] = useState(false);
  const [popupNotes, setPopupNotes] = useState(false);
  const [popupUpdate, setPopupUpdate] = useState(false);
  const [popupKind, setPopupKind] = useState<
    "session-start" | "session-summary"
  >("session-start");
  useStore(store, (s) => s.gameJournals);
  const sampleJournal = getGameJournal(store.getState(), LIBRARY_TOUR_GAME);
  const activePlaythrough = sampleJournal.playthroughs.find(
    (run) => run.id === sampleJournal.activePlaythroughId,
  );
  const gridLayout = useLibraryGridColumns(
    "grid",
    settings.libraryGridColumns ?? LIBRARY_TOUR_GRID_COLUMNS,
  );
  const games = useMemo(
    () =>
      makeCoreTourDemoGames().map((game, index) => {
        const ownSessions = sessions.filter((s) => s.gameId === game.gameId);
        const seconds =
          index === 0
            ? ownSessions.reduce((sum, s) => sum + (s.durationSeconds ?? 0), 0)
            : 2700;
        return {
          ...game,
          gameName: game.name,
          totalSeconds: seconds,
          sessionSeconds: seconds,
          recordedSeconds: seconds,
          sessionCount: index === 0 ? ownSessions.length : 1,
        };
      }),
    [sessions],
  );
  const selectedShelf = shelves.find((s) => s.id === shelfId);
  const visible = useMemo(
    () =>
      games.filter((game) => {
        const journal = journalFor(game);
        return (
          (expanded && selectedShelf
            ? true
            : matchesShelf(game, journal, shelfId, shelves)) &&
          matchesLibraryFilters(game, journal, filters)
        );
      }),
    [games, journalFor, expanded, selectedShelf, shelfId, shelves, filters],
  );
  const selection = useLibrarySelection(
    visible,
    JSON.stringify([shelfId, filters]),
    true,
  );
  const drag = useLibraryGameDrag(selection.selectedGames);
  const counts = Object.fromEntries(
    ["all", "favorites", ...shelves.map((s) => s.id)].map((id) => [
      id,
      games.filter((game) => matchesShelf(game, journalFor(game), id, shelves))
        .length,
    ]),
  );

  function selectShelf(id: string) {
    setShelfId(id);
    setFilters(
      store.getState().personalShelves.find((s) => s.id === id)?.filters ?? {},
    );
  }
  function clearFilters() {
    setFilters({});
    setShelfId("all");
  }

  // Prepare the next example when a learner skips an exercise. Changes they
  // already made survive Back/Next; restarting the guide makes a fresh store.
  useLayoutEffect(() => {
    store.setState({ notice: null });
    if (tourId === "notes-playthroughs") {
      if (["intro", "open-journal", "popups", "finish"].includes(stepId)) {
        store.getState().openGameJournal(null);
        return;
      }
      let journal = getGameJournal(store.getState(), LIBRARY_TOUR_GAME);
      if (
        ["active-run", "move-session", "finish-run"].includes(stepId) &&
        !journal.playthroughs.length
      ) {
        store.getState().createPlaythrough(LIBRARY_TOUR_GAME, "Speedrun");
        journal = getGameJournal(store.getState(), LIBRARY_TOUR_GAME);
      }
      store.getState().openGameJournal({
        game: LIBRARY_TOUR_GAME,
        tab: stepId === "note" ? "note" : "playthroughs",
        playthroughId: ["active-run", "finish-run"].includes(stepId)
          ? journal.playthroughs.at(-1)?.id
          : null,
      });
    } else {
      store.getState().openGameJournal(null);
    }
    if (tourId === "organize-library") {
      if (["create-shelf", "fill-shelf"].includes(stepId)) selectShelf("all");
      if (["fill-shelf", "filters", "save-filters"].includes(stepId)) {
        let shelf = store.getState().personalShelves[0];
        if (!shelf) {
          store.getState().savePersonalShelf({ name: "Online Games" });
          shelf = store.getState().personalShelves[0];
        }
        if (stepId !== "fill-shelf") {
          store
            .getState()
            .updateGameJournal(LIBRARY_TOUR_GAME, { status: "playing" });
          setShelfId(shelf.id);
          setExpanded(true);
          if (stepId === "save-filters" && !Object.keys(filters).length)
            setFilters({ status: "playing" });
        }
      }
      if (stepId === "finish") setExpanded(false);
    }
    if (tourId === "library-progress") {
      setExpanded(stepId === "filter");
      setCustomize(["customize", "card-details"].includes(stepId));
      if (stepId === "select") selection.finish();
      if (stepId === "select-games" && !selection.active)
        selection.toggleMode();
      if (["select", "select-games"].includes(stepId) && !visible.length)
        clearFilters();
      if (stepId === "apply" && !selection.selected.size) {
        if (!selection.active) selection.toggleMode();
        selection.selectAll();
      }
      if (
        ["open-customize", "customize", "card-details", "finish"].includes(
          stepId,
        )
      ) {
        selection.finish();
        clearFilters();
      }
      if (["customize", "card-details"].includes(stepId)) {
        const journal = getGameJournal(store.getState(), LIBRARY_TOUR_GAME);
        // Supply a visible example if the status exercise was skipped.
        store.getState().updateGameJournal(LIBRARY_TOUR_GAME, {
          status: journal.status ?? "playing",
          note:
            journal.note ||
            "Finish the Westfall quests, then head to Stormwind.",
        });
      }
    }
  }, [store, tourId, stepId, resetToken]);

  // Exercise steps move on by themselves once the learner has done what the
  // step asks. Only a change made during the step counts, so going Back to a
  // finished exercise waits for Next instead of bouncing forward again.
  const detailCycles = useRef(0);
  const shelf = shelves[0];
  const samples = games.map((game) => journalFor(game));
  const progress: ExerciseProgress = {
    favorites: samples.filter((journal) => journal.favorite).length,
    onShelf: shelf
      ? samples.filter((journal) => journal.shelfIds.includes(shelf.id)).length
      : 0,
    shelfFilters: Boolean(shelf?.filters && Object.keys(shelf.filters).length),
    statusFilter: filters.status ?? null,
    allSelected:
      visible.length > 0 && selection.selected.size >= visible.length,
    withStatus: samples.filter((journal) => journal.status !== null).length,
    samples: samples.length,
    columns: settings.libraryGridColumns ?? null,
    detailCycles: detailCycles.current,
    note: sampleJournal.note,
    playthroughs: sampleJournal.playthroughs.length,
    runNote: sampleJournal.playthroughs.at(-1)?.note ?? "",
    moved: sessions.filter(
      (session) =>
        session.gameId === LIBRARY_TOUR_GAME.gameId &&
        sampleJournal.playthroughs.some(
          (run) => run.id === session.playthroughId,
        ),
    ).length,
    finishedRuns: sampleJournal.playthroughs.filter((run) => run.completedAt)
      .length,
  };
  const progressKey = JSON.stringify(progress);
  const entry = useRef<{ step: string; progress: ExerciseProgress } | null>(
    null,
  );
  useEffect(() => {
    const step = `${tourId}:${stepId}:${resetToken}`;
    if (entry.current?.step !== step) {
      entry.current = { step, progress };
      return;
    }
    if (!exerciseDone(`${tourId}:${stepId}`, entry.current.progress, progress))
      return;
    // A short pause shows the result before the next step replaces it; a
    // slider that keeps moving restarts it.
    const timer = window.setTimeout(
      () => emitTourEvent("demo.step-completed"),
      700,
    );
    return () => window.clearTimeout(timer);
    // `progress` is read whenever its serialized form changes.
  }, [tourId, stepId, resetToken, progressKey]);

  function setting<K extends keyof typeof settings>(
    key: K,
    value: (typeof settings)[K],
  ) {
    // Switching a card detail off and on again completes that exercise.
    if (
      value === true &&
      (key === "libraryShowStatusBadges" ||
        key === "libraryShowNoteBadges" ||
        key === "libraryShowShelves") &&
      store.getState().settings[key] === false
    )
      detailCycles.current += 1;
    store.setState((state) => ({
      settings: { ...state.settings, [key]: value },
    }));
  }

  return (
    <div className="tour-practice-space">
      <div
        ref={selection.rootRef}
        onKeyDown={selection.onKeyDown}
        data-tour="demo-library-stage"
        className="grid gap-4 rounded-xl border border-border bg-bg p-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-semibold text-text">Practice library</h2>
            <p className="text-xs text-text-muted">
              Sample games · everything you change here disappears when the
              guide ends
            </p>
          </div>
          {tourId === "library-progress" ? (
            <Button
              data-tour="demo-customize-toggle"
              aria-expanded={customize}
              icon={SlidersHorizontal}
              onClick={() => setCustomize(!customize)}
            >
              Customize
            </Button>
          ) : null}
        </div>
        {tourId === "notes-playthroughs" && stepId === "popups" ? (
          <div
            data-tour="demo-popup-preview"
            className="grid gap-4 rounded-lg border border-border p-4"
          >
            <p className="text-sm text-text-muted">
              Preview the active playthrough's note. These switches only change
              this sample.
            </p>
            <div className="flex flex-wrap gap-4 text-sm">
              {[
                ["Playthrough names in popups", popupNames, setPopupNames],
                ["Notes in game-start popups", popupNotes, setPopupNotes],
                ["Update note in popups", popupUpdate, setPopupUpdate],
              ].map(([label, checked, change]) => (
                <label
                  key={String(label)}
                  className="flex cursor-pointer items-center gap-2"
                >
                  <Switch
                    checked={Boolean(checked)}
                    onChange={(event) =>
                      (change as (value: boolean) => void)(event.target.checked)
                    }
                  />
                  {String(label)}
                </label>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                aria-pressed={popupKind === "session-start"}
                onClick={() => setPopupKind("session-start")}
              >
                Game started
              </Button>
              <Button
                aria-pressed={popupKind === "session-summary"}
                onClick={() => setPopupKind("session-summary")}
              >
                Session saved
              </Button>
            </div>
            <DesktopNotificationOverlay
              preview
              message={{
                id: "tour-popup",
                sequence: 0,
                kind: popupKind,
                priority: 1,
                kicker:
                  popupKind === "session-start"
                    ? "Now playing"
                    : "Session saved",
                title: LIBRARY_TOUR_GAME.name,
                body: [
                  popupNames
                    ? (activePlaythrough?.name ?? "Default playthrough")
                    : "",
                  popupNotes && popupKind === "session-start"
                    ? (activePlaythrough?.note ?? sampleJournal.note)
                    : "",
                ]
                  .filter(Boolean)
                  .join(" · "),
                coverUrl: LIBRARY_TOUR_GAME.coverUrl,
                metric: popupKind === "session-summary" ? "45m" : undefined,
                action:
                  popupUpdate && popupKind === "session-summary"
                    ? "open-game-note:-1"
                    : undefined,
                actionLabel: "Update note",
                theme: settings.theme === "light" ? "light" : "dark",
                accentColor: null,
                reducedMotion: true,
                durationMs: 5000,
                createdAtMs: 0,
                expiresAtMs: 0,
              }}
              onFinished={() => {}}
              onAction={() =>
                store.getState().openGameJournal({
                  game: LIBRARY_TOUR_GAME,
                  tab: "note",
                  playthroughId: sampleJournal.activePlaythroughId,
                })
              }
            />
          </div>
        ) : null}
        {customize ? (
          <div
            data-tour="demo-library-customize"
            className="divide-y divide-border rounded-lg border border-border px-3"
          >
            <LibraryAppearanceControls
              view="grid"
              gridLayout={gridLayout}
              showShelves={settings.libraryShowShelves !== false}
              showOrigin={settings.libraryShowOriginBadges !== false}
              showMatch={settings.libraryShowMatchBadges !== false}
              showStatus={settings.libraryShowStatusBadges !== false}
              showNotes={settings.libraryShowNoteBadges !== false}
              showTrackingWarnings={
                settings.libraryShowTrackingWarnings !== false
              }
              setMyGamesGridColumns={(v) => setting("libraryGridColumns", v)}
              setMyGamesShowShelves={(v) => setting("libraryShowShelves", v)}
              setMyGamesShowOriginBadges={(v) =>
                setting("libraryShowOriginBadges", v)
              }
              setMyGamesShowMatchBadges={(v) =>
                setting("libraryShowMatchBadges", v)
              }
              setMyGamesShowStatusBadges={(v) =>
                setting("libraryShowStatusBadges", v)
              }
              setMyGamesShowNoteBadges={(v) =>
                setting("libraryShowNoteBadges", v)
              }
              setMyGamesShowTrackingWarnings={(v) =>
                setting("libraryShowTrackingWarnings", v)
              }
            />
          </div>
        ) : null}
        {tourId !== "notes-playthroughs" ? (
          <LibraryOrganizationToolbar
            key={stepId}
            showShelves={settings.libraryShowShelves !== false}
            selection={shelfId}
            onSelect={selectShelf}
            filters={filters}
            onFiltersChange={setFilters}
            expanded={expanded}
            onExpandedChange={setExpanded}
            onClearFilters={clearFilters}
            source="all"
            query=""
            counts={counts}
            selectionAction={
              <Button
                icon={CheckSquare}
                data-tour="demo-library-select"
                data-library-select
                aria-pressed={selection.active}
                onClick={selection.toggleMode}
              >
                Select
              </Button>
            }
          />
        ) : null}
        <LibraryBulkActions
          active={selection.active}
          count={selection.selected.size}
          total={visible.length}
          onSelectAll={selection.selectAll}
          onClear={selection.clear}
          onDone={selection.finish}
          onStatus={selection.applyStatus}
        />
        {notice ? (
          <p
            data-tour="demo-library-result"
            role="status"
            className="rounded-lg border border-accent/30 bg-accent-tint px-3 py-2 text-sm text-text"
          >
            {notice.title}
          </p>
        ) : null}
        <div
          ref={gridLayout.gridRef}
          data-tour="demo-library-cards"
          className="grid items-start gap-3"
          style={gridLayout.style}
        >
          {visible.map((game) => (
            <GameLibraryCard
              key={`${stepId}:${game.gameId}`}
              game={game}
              demo
              localLinks={[]}
              launchKey={`demo:${game.gameId}`}
              launchBlocked
              onAcquireLaunch={() => false}
              onReleaseLaunch={() => {}}
              showDurationDays={settings.showDurationDays}
              showOrigin={settings.libraryShowOriginBadges !== false}
              showMatch={settings.libraryShowMatchBadges !== false}
              showTrackingWarning={
                settings.libraryShowTrackingWarnings !== false
              }
              view="grid"
              onRemove={() => {}}
              onDragGame={drag.start}
              selectionMode={selection.active}
              selected={selection.selected.has(librarySelectionKey(game))}
              onToggleSelection={selection.toggleGame}
            />
          ))}
        </div>
        {!visible.length ? (
          <div className="py-4 text-center text-sm text-text-muted">
            <p>No sample games match this view.</p>
            <Button className="mt-2" onClick={clearFilters}>
              Show all sample games
            </Button>
          </div>
        ) : null}
        <LibraryGameDropHint hint={drag.hint} onDismiss={drag.dismissHint} />
      </div>
    </div>
  );
}
