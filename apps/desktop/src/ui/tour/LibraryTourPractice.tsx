import { CheckSquare, SlidersHorizontal } from "lucide-react";
import { useLayoutEffect, useMemo, useState } from "react";
import { useStore } from "zustand";
import {
  matchesLibraryFilters,
  type LibraryFilters,
} from "../../personalLibrary";
import { getGameJournal, useAppStore } from "../../store";
import { GameJournalHost } from "../GameJournalDialog";
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
import { Button } from "../primitives";
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
  return (
    <PersonalLibraryContext.Provider value={store}>
      <PracticeLibrary store={store} tourId={tourId} stepId={stepId} />
      <GameJournalHost key={stepId} />
    </PersonalLibraryContext.Provider>
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
  const sessions = useStore(store, (s) => s.recentSessions);
  const journalFor = useLibraryJournalLookup();
  const [shelfId, setShelfId] = useState("all");
  const [filters, setFilters] = useState<LibraryFilters>({});
  const [expanded, setExpanded] = useState(false);
  const [customize, setCustomize] = useState(false);
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
      if (["intro", "open-journal", "finish"].includes(stepId)) {
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

  function setting<K extends keyof typeof settings>(
    key: K,
    value: (typeof settings)[K],
  ) {
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
        {customize ? (
          <div
            data-tour="demo-library-customize"
            className="divide-y divide-border rounded-lg border border-border px-3"
          >
            <LibraryAppearanceControls
              view="grid"
              gridLayout={{
                columns:
                  settings.libraryGridColumns ?? LIBRARY_TOUR_GRID_COLUMNS,
                sliderValue:
                  settings.libraryGridColumns ?? LIBRARY_TOUR_GRID_COLUMNS,
                maxColumns: 8,
              }}
              showShelves={settings.libraryShowShelves !== false}
              showOrigin={settings.libraryShowOriginBadges !== false}
              showMatch={settings.libraryShowMatchBadges !== false}
              showStatus={settings.libraryShowStatusBadges !== false}
              showNotes={settings.libraryShowNoteBadges !== false}
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
          data-tour="demo-library-cards"
          className="grid items-start gap-3"
          style={{
            gridTemplateColumns: `repeat(${settings.libraryGridColumns ?? LIBRARY_TOUR_GRID_COLUMNS}, minmax(0, 1fr))`,
          }}
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
