import clsx from "clsx";
import { CheckSquare } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { emitTourEvent } from "./TourUI";
import { useStore } from "zustand";
import { createPortal } from "react-dom";
import { buildOverlayMessage } from "../../desktopOverlays";
import {
  journalNote,
  matchesLibraryFilters,
  playthroughName,
  shelfHides,
  type GameStatus,
  type LibraryFilters,
} from "../../personalLibrary";
import type { QuickNoteLabel } from "../../quickNote";
import { getGameJournal, useAppStore } from "../../store";
import { formatDuration } from "../components";
import { GameJournalHost } from "../GameJournalDialog";
import { DesktopNotificationOverlay } from "../DesktopNotificationOverlay";
import {
  LibraryCardSection,
  LibraryCustomizeButton,
  LibraryCustomizePanel,
  LibraryLayoutControls,
  LibraryLayoutSection,
  LibraryViewButtons,
} from "../LibraryAppearanceControls";
import { LibraryBulkActions } from "../LibraryBulkActions";
import { LibraryGameDropHint } from "../LibraryGameDropHint";
import {
  LibraryOrganizationToolbar,
  matchesShelf,
  useLibraryJournalLookup,
} from "../LibraryOrganization";
import { PersonalLibraryContext } from "../PersonalLibraryContext";
import { QuickNoteWindow } from "../QuickNoteWindow";
import { useLibraryGameDrag } from "../libraryGameDrag";
import type { MyGamesCardSize } from "../myGamesPresentation";
import { Button, ContextMenu, Switch } from "../primitives";
import { useLibraryGridColumns } from "../useLibraryGridColumns";
import {
  librarySelectionKey,
  useLibrarySelection,
} from "../useLibrarySelection";
import {
  GameLibraryCard,
  makeCoreTourDemoGames,
  MyGamesSortSelect,
} from "../views/MyGamesView";
import { compareMyGames, type MyGamesSortKey } from "../myGamesSort";
import { TOUR_GTA_GAME_ID } from "./tourDemoGame";
import {
  createLibraryTourStore,
  LIBRARY_TOUR_GAME,
  type LibraryTourState,
} from "./libraryTourStore";
import type { StoreApi } from "zustand";
import { appLocale, getT } from "../../i18n";

const t = getT("tour");
// The practice frame wears My Games' own labels, and the popups theirs.
const tGames = getT("myGames");
const tSettings = getT("settings");
const tOverlays = getT("overlays");

const CUSTOMIZE_PANEL_ID = "demo-library-customize-panel";
/** The real popup and note box windows (notification_overlay.rs,
 *  quick_note.rs), so the preview is as big as what shows over a game. */
const POPUP_WIDTH = 440;
const NOTE_BOX = { width: 560, height: 236 };

type ExerciseProgress = {
  favorites: number;
  /** How often a sample sits on a shelf the player fills by hand. */
  shelfGames: number;
  shelfFilters: boolean;
  /** A shelf keeps its games out of All games. */
  hiddenAll: boolean;
  statusFilter: string | null;
  allSelected: boolean;
  /** Each sample's progress status. */
  statuses: (GameStatus | null)[];
  columns: number | null;
  detailCycles: number;
  note: string;
  playthroughs: number;
  activeRun: string | null;
  runNote: string;
  moved: number;
  /** Each sample session's own note. */
  sessionNotes: string[];
  finishedRuns: number;
  /** How often the popup's note box was opened and closed again. */
  noteBoxes: number;
  gtaTier: string | null;
  sortKey: MyGamesSortKey;
  tierFilter: string | null;
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
      return now.activeRun !== before.activeRun;
    case "notes-playthroughs:run-note":
      return now.runNote.trim() !== "" && now.runNote !== before.runNote;
    case "notes-playthroughs:move-session":
      return now.moved > before.moved;
    case "notes-playthroughs:session-note":
      return now.sessionNotes.some(
        (note, index) => note !== "" && note !== before.sessionNotes[index],
      );
    case "notes-playthroughs:finish-run":
      return now.finishedRuns > before.finishedRuns;
    case "notes-playthroughs:popups":
      return now.noteBoxes > before.noteBoxes;
    case "organize-library:favorite":
      return now.favorites > before.favorites;
    case "organize-library:fill-shelf":
      return now.shelfGames > before.shelfGames;
    case "organize-library:hide-shelf":
      return now.hiddenAll && !before.hiddenAll;
    case "organize-library:filters":
      return (
        now.statusFilter === "playing" && before.statusFilter !== "playing"
      );
    case "organize-library:save-filters":
      return now.shelfFilters && !before.shelfFilters;
    case "library-progress:filter":
      return now.statusFilter === "none" && before.statusFilter !== "none";
    case "library-progress:select":
      return now.allSelected && !before.allSelected;
    case "library-progress:apply":
    case "library-progress:status-menu":
      return now.statuses.some(
        (status, index) => status !== null && status !== before.statuses[index],
      );
    case "library-progress:customize":
      return now.columns !== before.columns;
    case "library-progress:card-details":
      return now.detailCycles > before.detailCycles;
    case "rate-games:rate":
      return now.gtaTier !== null && now.gtaTier !== before.gtaTier;
    case "rate-games:sort":
      return now.sortKey === "tier" && before.sortKey !== "tier";
    case "rate-games:filter":
      return (
        now.tierFilter !== null &&
        now.tierFilter === now.gtaTier &&
        before.tierFilter !== now.tierFilter
      );
    default:
      return false;
  }
}

/** The note box has no texts of its own: they come with it (quickNote.ts). */
function noteBoxLabels(): Record<QuickNoteLabel, string> {
  return {
    "Session note": tOverlays("Session note"),
    "Playing now": tOverlays("Playing now"),
    Paused: tOverlays("Paused"),
    "Session saved": tOverlays("Session saved"),
    "What happened? Where did you stop?": tOverlays(
      "What happened? Where did you stop?",
    ),
    "Enter saves · Shift+Enter starts a new line · Esc cancels": tOverlays(
      "Enter saves · Shift+Enter starts a new line · Esc cancels",
    ),
    Save: tOverlays("Save"),
    Cancel: tOverlays("Cancel"),
  };
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
  // Back and a click on a finished step enter the step again.
  const stepKey = `${tourId}:${stepId}:${resetToken}`;
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
  const [sortKey, setSortKey] = useState<MyGamesSortKey>("recent");
  const customizeButton = useRef<HTMLButtonElement>(null);
  const [customize, setCustomize] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [popupNames, setPopupNames] = useState(false);
  const [popupNotes, setPopupNotes] = useState(false);
  const [popupSessionNotes, setPopupSessionNotes] = useState(false);
  const [noteBox, setNoteBox] = useState(false);
  const [noteBoxes, setNoteBoxes] = useState(0);
  useStore(store, (s) => s.gameJournals);
  const sampleJournal = getGameJournal(store.getState(), LIBRARY_TOUR_GAME);
  const view: MyGamesCardSize = settings.libraryCardSize ?? "grid";
  const gridLayout = useLibraryGridColumns(
    view,
    settings.libraryGridColumns ?? null,
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
  const gta = games.find((game) => game.gameId === TOUR_GTA_GAME_ID)!;
  const selectedShelf = shelves.find((s) => s.id === shelfId);
  const visible = useMemo(
    () =>
      games
        .filter((game) => {
          const journal = journalFor(game);
          return (
            (expanded && selectedShelf
              ? true
              : matchesShelf(game, journal, shelfId, shelves)) &&
            matchesLibraryFilters(game, journal, filters)
          );
        })
        .sort((left, right) =>
          compareMyGames(
            { ...left, tier: journalFor(left).tier },
            { ...right, tier: journalFor(right).tier },
            sortKey,
          ),
        ),
    [
      games,
      journalFor,
      expanded,
      selectedShelf,
      shelfId,
      shelves,
      filters,
      sortKey,
    ],
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
  // The session the saved-session popup is about: the latest sample one.
  const noteSession = sessions.find(
    (session) => session.gameId === LIBRARY_TOUR_GAME.gameId,
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
  function openCustomize() {
    // Its right edge under the gear's, like in My Games.
    const rect = customizeButton.current?.getBoundingClientRect();
    setCustomize({ x: (rect?.right ?? 400) - 400, y: (rect?.bottom ?? 0) + 6 });
  }
  function setView(libraryCardSize: MyGamesCardSize) {
    // As in My Games: a card size brings its own cards per row.
    store.setState((state) => ({
      settings: {
        ...state.settings,
        libraryCardSize,
        libraryGridColumns: null,
      },
    }));
  }

  /* Every step sets up what it needs, wherever the player comes from: Next,
     Skip step, Back or a click on a finished step in the card's list. A step
     entered again can be done again, so its exercise is put back first.
     Restarting the guide makes a fresh store. */
  const [prepared, setPrepared] = useState("");
  useLayoutEffect(() => {
    const state = () => store.getState();
    const journalOf = (game: (typeof games)[number]) =>
      getGameJournal(state(), game);
    const wow = () => getGameJournal(state(), LIBRARY_TOUR_GAME);
    /** Whether any sample shows once the changes below are in. */
    const anyVisible = () =>
      games.some((game) => {
        const journal = journalOf(game);
        return (
          matchesShelf(game, journal, shelfId, state().personalShelves) &&
          matchesLibraryFilters(game, journal, filters)
        );
      });

    store.setState({ notice: null });
    state().openNewShelf(null);
    setNoteBox(false);
    let journalTarget: Parameters<LibraryTourState["openGameJournal"]>[0] =
      null;
    let customizeOpen = false;

    if (tourId === "notes-playthroughs") {
      if (stepId === "popups") {
        setPopupNames(false);
        setPopupNotes(false);
        setPopupSessionNotes(false);
      }
      if (!["open-journal", "popups", "finish"].includes(stepId)) {
        const onRun = [
          "active-run",
          "run-note",
          "move-session",
          "session-note",
          "finish-run",
        ].includes(stepId);
        // The steps after "Start a new playthrough" work on that playthrough.
        if (onRun && !wow().playthroughs.length)
          state().createPlaythrough(LIBRARY_TOUR_GAME, t("Speedrun"));
        const run = wow().playthroughs.at(-1);
        if (run && ["active-run", "finish-run"].includes(stepId)) {
          if (run.completedAt)
            state().updatePlaythrough(LIBRARY_TOUR_GAME, run.id, {
              completedAt: null,
            });
          // "Click Default playthrough, then Make active" starts from here.
          if (stepId === "active-run")
            state().setActivePlaythrough(LIBRARY_TOUR_GAME, run.id);
        }
        const own = () =>
          state().recentSessions.filter(
            (session) => session.gameId === LIBRARY_TOUR_GAME.gameId,
          );
        // Both sample sessions may sit in the new playthrough already.
        if (
          stepId === "move-session" &&
          own().length &&
          own().every((session) => session.playthroughId)
        )
          state().assignSessionPlaythrough(own()[0].id, null);
        journalTarget = {
          game: LIBRARY_TOUR_GAME,
          tab: ["note", "run-note"].includes(stepId) ? "note" : "playthroughs",
          playthroughId:
            stepId === "session-note"
              ? // A playthrough that has a session to write the note for.
                (own()[0]?.playthroughId ?? null)
              : ["active-run", "run-note", "finish-run"].includes(stepId)
                ? run?.id
                : null,
        };
      }
    }

    if (tourId === "organize-library") {
      const shelf = () => {
        if (!state().personalShelves.length)
          state().savePersonalShelf({ name: tGames("Online Games") });
        return state().personalShelves[0];
      };
      const onShelf = (journal: ReturnType<typeof wow>) =>
        journal.shelfIds.includes(shelf().id);
      if (["filters", "save-filters"].includes(stepId)) {
        // A shelf that hides would only answer "hiding is paused", and saved
        // filters would leave nothing to save.
        state().savePersonalShelf({
          ...shelf(),
          filters: undefined,
          hiddenIn: [],
        });
        state().updateGameJournal(LIBRARY_TOUR_GAME, { status: "playing" });
        setShelfId(shelf().id);
        setExpanded(true);
        setFilters(stepId === "save-filters" ? { status: "playing" } : {});
      } else {
        setExpanded(false);
        if (stepId !== "finish") selectShelf("all");
      }
      if (
        stepId === "favorite" &&
        games.every((game) => journalOf(game).favorite)
      )
        state().updateGameJournal(LIBRARY_TOUR_GAME, { favorite: false });
      if (["fill-shelf", "hide-shelf"].includes(stepId)) {
        // Only a shelf without saved filters takes games by hand or hides
        // them, and a hidden game would be gone from All games.
        state().savePersonalShelf({
          ...shelf(),
          filters: undefined,
          hiddenIn: [],
        });
        const taken = games.every((game) => onShelf(journalOf(game)));
        if (stepId === "fill-shelf" ? taken : !onShelf(wow()))
          state().updateGameJournal(LIBRARY_TOUR_GAME, {
            shelfIds:
              stepId === "fill-shelf"
                ? wow().shelfIds.filter((id) => id !== shelf().id)
                : [...wow().shelfIds, shelf().id],
          });
      }
    }

    if (tourId === "library-progress") {
      const statuses = () => games.map((game) => journalOf(game).status);
      const clearStatuses = () =>
        state().setGameStatuses(
          games.map((game) => ({ ...game, gameName: game.name })),
          null,
        );
      setExpanded(stepId === "filter");
      if (stepId === "filter") {
        // Something has to be without a status, and "No status" not picked.
        if (statuses().every(Boolean)) clearStatuses();
        clearFilters();
      } else if (stepId === "select" || stepId === "apply") {
        // "In progress" has to change something when it is picked again.
        if (stepId === "apply" && statuses().every(Boolean)) clearStatuses();
        if (!anyVisible()) clearFilters();
      } else {
        // Games with a status left the "No status" view.
        clearFilters();
      }
      if (stepId === "status-menu")
        for (const game of games)
          if (journalOf(game).status === "finished")
            state().updateGameJournal(game, { status: "playing" });
      if (stepId === "customize" && view === "list") setView("grid");
      if (stepId === "card-details") {
        customizeOpen = true;
        // Supply a visible example if the status exercise was skipped.
        state().updateGameJournal(LIBRARY_TOUR_GAME, {
          status: wow().status ?? "playing",
          note:
            wow().note ||
            t("Finish the Westfall quests, then head to Stormwind."),
        });
      }
    }

    if (tourId === "rate-games") {
      // Supply the rating if the learner skipped that exercise.
      if (["sort", "filter", "finish"].includes(stepId) && !journalOf(gta).tier)
        state().setGameTier(gta, "S");
      setExpanded(stepId === "filter");
      clearFilters();
      if (stepId === "sort" && sortKey === "tier") setSortKey("recent");
      if (stepId === "finish") setSortKey("tier");
    }

    state().openGameJournal(journalTarget);
    if (!customizeOpen) setCustomize(null);
    else if (!customize) openCustomize();
    setPrepared(stepKey);
  }, [store, stepKey]);

  // Selection comes second: it needs the cards the changes above leave.
  const [ready, setReady] = useState("");
  useLayoutEffect(() => {
    if (prepared !== stepKey) return;
    if (tourId === "library-progress" && stepId === "apply") {
      // If the selecting was skipped, both samples are selected here.
      if (!selection.selected.size) {
        if (!selection.active) selection.toggleMode();
        selection.selectAll();
      }
    } else if (selection.active) selection.finish();
    setReady(stepKey);
  }, [prepared, stepKey]);

  // Exercise steps move on by themselves once the learner has done what the
  // step asks. Only a change made during the step counts: not what the set-up
  // above did, and not what was done before Back.
  const detailCycles = useRef(0);
  const samples = games.map((game) => journalFor(game));
  const handShelves = shelves.filter((shelf) => !shelf.filters);
  const progress: ExerciseProgress = {
    favorites: samples.filter((journal) => journal.favorite).length,
    shelfGames: samples.reduce(
      (sum, journal) =>
        sum +
        handShelves.filter((shelf) => journal.shelfIds.includes(shelf.id))
          .length,
      0,
    ),
    shelfFilters: shelves.some(
      (shelf) => shelf.filters && Object.keys(shelf.filters).length,
    ),
    hiddenAll: shelves.some((shelf) => shelfHides(shelf, "all")),
    statusFilter: filters.status ?? null,
    allSelected:
      visible.length > 0 && selection.selected.size >= visible.length,
    statuses: samples.map((journal) => journal.status),
    columns: settings.libraryGridColumns ?? null,
    detailCycles: detailCycles.current,
    note: sampleJournal.note,
    playthroughs: sampleJournal.playthroughs.length,
    activeRun: sampleJournal.activePlaythroughId,
    runNote: sampleJournal.playthroughs.at(-1)?.note ?? "",
    moved: sessions.filter(
      (session) =>
        session.gameId === LIBRARY_TOUR_GAME.gameId &&
        sampleJournal.playthroughs.some(
          (run) => run.id === session.playthroughId,
        ),
    ).length,
    sessionNotes: sessions
      .filter((session) => session.gameId === LIBRARY_TOUR_GAME.gameId)
      .map((session) => session.note ?? ""),
    finishedRuns: sampleJournal.playthroughs.filter((run) => run.completedAt)
      .length,
    noteBoxes,
    gtaTier: journalFor(gta).tier ?? null,
    sortKey,
    tierFilter: filters.tier ?? null,
  };
  const progressKey = JSON.stringify(progress);
  const entry = useRef<{ step: string; progress: ExerciseProgress } | null>(
    null,
  );
  useEffect(() => {
    if (ready !== stepKey) return;
    if (entry.current?.step !== stepKey) {
      entry.current = { step: stepKey, progress };
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
  }, [stepKey, ready, progressKey]);

  function setting<K extends keyof typeof settings>(
    key: K,
    value: (typeof settings)[K],
  ) {
    // Switching a card detail off and on again completes that exercise.
    if (
      value === true &&
      (key === "libraryShowStatusBadges" ||
        key === "libraryShowNoteBadges" ||
        key === "libraryShowTierBadges" ||
        key === "libraryShowShelves") &&
      store.getState().settings[key] === false
    )
      detailCycles.current += 1;
    store.setState((state) => ({
      settings: { ...state.settings, [key]: value },
    }));
  }

  // The real popups, built by the code that builds them over a game. The
  // three switches stand in for the settings that feed it.
  const showPopups = tourId === "notes-playthroughs" && stepId === "popups";
  const theme = settings.theme === "light" ? "light" : "dark";
  const popups = useMemo(() => {
    if (!showPopups) return null;
    const context = {
      nowMs: 0,
      locale: appLocale(),
      theme,
      accentColor: null,
      reducedMotion: true,
    } as const;
    const game = {
      gameName: LIBRARY_TOUR_GAME.name,
      coverUrl: LIBRARY_TOUR_GAME.coverUrl,
      playthroughName: popupNames ? playthroughName(sampleJournal) : undefined,
    };
    return {
      start: buildOverlayMessage(
        "session-start",
        {
          type: "session-started",
          ...game,
          note: popupNotes
            ? journalNote(sampleJournal).slice(0, 180) || undefined
            : undefined,
          firstAutoDetection: false,
        },
        context,
      ),
      saved: buildOverlayMessage(
        "session-summary",
        {
          type: "session-ended",
          ...game,
          sessionId: popupSessionNotes ? noteSession?.id : undefined,
          durationSeconds: noteSession?.durationSeconds ?? 0,
          totalSeconds: games[0].totalSeconds,
        },
        context,
      ),
    };
  }, [
    showPopups,
    theme,
    popupNames,
    popupNotes,
    popupSessionNotes,
    sampleJournal,
    noteSession,
    games,
  ]);

  return (
    <div className="tour-practice-space">
      <div
        ref={selection.rootRef}
        onKeyDown={selection.onKeyDown}
        data-tour="demo-library-stage"
        className="grid gap-4 rounded-xl border border-border bg-bg p-4"
      >
        <div>
          <h2 className="font-semibold text-text">{t("Practice library")}</h2>
          <p className="text-xs text-text-muted">
            {t(
              "Sample games · everything you change here disappears when the guide ends",
            )}
          </p>
        </div>
        {popups ? (
          <div
            data-tour="demo-popup-preview"
            className="grid gap-x-8 gap-y-4 rounded-lg border border-border p-4 xl:grid-cols-[minmax(0,280px)_minmax(0,1fr)]"
          >
            <div className="grid content-start gap-1 text-sm text-text">
              {(
                [
                  [
                    "demo-popup-names",
                    tSettings("Playthrough names in popups"),
                    popupNames,
                    setPopupNames,
                  ],
                  [
                    "demo-popup-game-notes",
                    tSettings("Notes in game-start popups"),
                    popupNotes,
                    setPopupNotes,
                  ],
                  [
                    "demo-popup-session-notes",
                    tSettings("Session notes in popups"),
                    popupSessionNotes,
                    setPopupSessionNotes,
                  ],
                ] as const
              ).map(([name, label, checked, change]) => (
                <label
                  key={name}
                  className="flex cursor-pointer items-center justify-between gap-4 rounded-lg px-2 py-2 hover:bg-surface-hover/50"
                >
                  {label}
                  <Switch
                    data-tour={name}
                    checked={checked}
                    onChange={(event) => change(event.target.checked)}
                  />
                </label>
              ))}
            </div>
            <div className="flex flex-wrap items-start gap-4">
              {(
                [
                  ["demo-popup-start", t("Game started"), popups.start],
                  ["demo-popup-saved", t("Session saved"), popups.saved],
                ] as const
              ).map(([name, caption, message]) => (
                <figure
                  key={name}
                  data-tour={name}
                  style={{ width: POPUP_WIDTH }}
                  className="m-0 grid max-w-full gap-1"
                >
                  <figcaption className="px-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-text-faint">
                    {caption}
                  </figcaption>
                  <DesktopNotificationOverlay
                    preview
                    message={message}
                    onFinished={() => {}}
                    onAction={() => setNoteBox(true)}
                  />
                </figure>
              ))}
              {noteBox && noteSession ? (
                // The box the popup's button opens over the game.
                <div
                  data-tour="demo-popup-note-box"
                  style={NOTE_BOX}
                  className="max-w-full"
                >
                  <QuickNoteWindow
                    payload={{
                      sessionId: noteSession.id,
                      gameName: LIBRARY_TOUR_GAME.name,
                      coverUrl: LIBRARY_TOUR_GAME.coverUrl,
                      note: noteSession.note ?? "",
                      startedAt: null,
                      duration: formatDuration(
                        noteSession.durationSeconds ?? 0,
                      ),
                      labels: noteBoxLabels(),
                      locale: appLocale(),
                      theme,
                      accentColor: null,
                      reducedMotion: true,
                    }}
                    onClose={(note) => {
                      if (note !== null)
                        store.getState().setSessionNote(noteSession.id, note);
                      setNoteBox(false);
                      setNoteBoxes((count) => count + 1);
                    }}
                  />
                </div>
              ) : null}
            </div>
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
            practiceTier={
              tourId === "rate-games" ? journalFor(gta).tier : undefined
            }
            selectionAction={
              <Button
                variant={selection.active ? "primary" : "secondary"}
                icon={CheckSquare}
                data-tour="demo-library-select"
                data-library-select=""
                aria-label={tGames("Select games")}
                aria-pressed={selection.active}
                title={
                  selection.active
                    ? tGames("Exit selection mode (Esc)")
                    : tGames("Select games to set their status")
                }
                onClick={selection.toggleMode}
                className="h-9 shrink-0"
              >
                {selection.active ? tGames("Selecting") : tGames("Select")}
              </Button>
            }
            trailing={
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <MyGamesSortSelect
                  dataTour="demo-sort"
                  value={sortKey}
                  onChange={setSortKey}
                />
                <LibraryViewButtons view={view} onChange={setView} />
                <LibraryCustomizeButton
                  ref={customizeButton}
                  dataTour="demo-customize-toggle"
                  open={customize !== null}
                  panelId={CUSTOMIZE_PANEL_ID}
                  onClick={() =>
                    customize ? setCustomize(null) : openCustomize()
                  }
                />
              </div>
            }
          />
        ) : null}
        <ContextMenu
          open={customize !== null}
          position={customize ?? { x: 0, y: 0 }}
          onClose={() => setCustomize(null)}
          anchorRef={customizeButton}
          dataTour="demo-library-menu"
        >
          <LibraryCustomizePanel
            id={CUSTOMIZE_PANEL_ID}
            dataTour="demo-library-customize"
          >
            <LibraryLayoutSection>
              <LibraryLayoutControls
                view={view}
                gridLayout={gridLayout}
                showShelves={settings.libraryShowShelves !== false}
                setMyGamesGridColumns={(v) => setting("libraryGridColumns", v)}
                setMyGamesShowShelves={(v) => setting("libraryShowShelves", v)}
              />
            </LibraryLayoutSection>
            <LibraryCardSection
              showOrigin={settings.libraryShowOriginBadges !== false}
              showMatch={settings.libraryShowMatchBadges !== false}
              showStatus={settings.libraryShowStatusBadges !== false}
              showNotes={settings.libraryShowNoteBadges !== false}
              showTiers={settings.libraryShowTierBadges !== false}
              showTrackingWarnings={
                settings.libraryShowTrackingWarnings !== false
              }
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
              setMyGamesShowTierBadges={(v) =>
                setting("libraryShowTierBadges", v)
              }
              setMyGamesShowTrackingWarnings={(v) =>
                setting("libraryShowTrackingWarnings", v)
              }
            />
          </LibraryCustomizePanel>
        </ContextMenu>
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
          // My Games' own grid (views/MyGamesView.tsx), so the sample cards
          // are the size the player's cards are.
          className={clsx(
            "grid",
            view === "grid" &&
              "grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-[repeat(auto-fill,minmax(216px,1fr))]",
            view === "large" &&
              "grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-[repeat(auto-fill,minmax(300px,1fr))]",
            view === "list" && "gap-3",
          )}
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
              view={view}
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
            <p>{t("No sample games match this view.")}</p>
            <Button className="mt-2" onClick={clearFilters}>
              {t("Show all sample games")}
            </Button>
          </div>
        ) : null}
        <LibraryGameDropHint hint={drag.hint} onDismiss={drag.dismissHint} />
      </div>
    </div>
  );
}
