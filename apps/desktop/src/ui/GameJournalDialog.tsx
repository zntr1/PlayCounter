import {
  usePersonalLibraryState,
  usePersonalLibraryApi,
  useLibraryPractice,
} from "./PersonalLibraryContext";
import {
  ArrowRight,
  BookOpen,
  Check,
  ChevronDown,
  Flag,
  Gamepad2,
  Info,
  Plus,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  DEFAULT_PLAYTHROUGH_NAME,
  GAME_STATUSES,
  NAME_LIMIT,
  NOTE_LIMIT,
  defaultPlaythroughTime,
  playthroughName,
  playthroughSeconds,
  type GameStatus,
  type JournalTarget,
} from "../personalLibrary";
import {
  createGameIdentityResolver,
  personalGameIdentity,
  useAppStore,
  type ActiveSession,
} from "../store";
import {
  Button,
  ContextMenu,
  ContextMenuHeading,
  ContextMenuItem,
  IconButton,
  Input,
  Modal,
  Pill,
  useAnchoredMenu,
} from "./primitives";
import { GAME_STATUS_LIST, STATUS_TONES } from "./journalStyles";
import { formatDuration } from "./components";
import { GameCover } from "./GameCover";
import { useGameJournal } from "./useGameJournal";
import type { Session } from "@playcounter/shared";
import { gameSecondsRefFromKey } from "../gameSeconds";
import { getSessionGameKey } from "../historyStats";

/* The game journal ───────────────────────────────────────────────────────────
   One game, one page. The header carries the game: cover, totals, and the
   favorite, progress and shelf controls that describe the game rather than a
   single run. The left column is a ledger of playthroughs with the time each
   one took, so a replay is something you can see rather than something you
   have to remember. The right column is the selected playthrough: its name,
   its note, and the sessions it owns. */

const eyebrowClass =
  "text-[11px] font-semibold uppercase tracking-[0.14em] text-text-faint";
/** Header actions read as buttons, not filter pills. */
const headerButton = "!rounded-lg !px-4 !py-2 !text-sm";

/** Assigns one session to a playthrough. Reads as a label, opens as a menu. */
export function SessionPlaythroughPicker({
  session,
  compact = false,
  showDefault = !compact,
}: {
  session: Session | ActiveSession;
  compact?: boolean;
  showDefault?: boolean;
}) {
  const practice = useLibraryPractice();
  const journal = useGameJournal(session);
  const assign = usePersonalLibraryState((s) => s.assignSessionPlaythrough);
  const open = usePersonalLibraryState((s) => s.openGameJournal);
  const menu = useAnchoredMenu();
  const current = session.playthroughId ?? null;

  if (!journal.playthroughs.length) {
    if (!showDefault) return null;
    return compact ? (
      <span className="text-xs text-text-muted">
        {DEFAULT_PLAYTHROUGH_NAME}
      </span>
    ) : (
      <Button
        variant="ghost"
        icon={BookOpen}
        onClick={(event) => {
          event.stopPropagation();
          open({ game: session, tab: "playthroughs", playthroughId: null });
        }}
      >
        {DEFAULT_PLAYTHROUGH_NAME}
      </Button>
    );
  }

  return (
    <>
      <Pill
        data-tour={practice ? "demo-session-playthrough" : undefined}
        ref={menu.anchorRef}
        icon={BookOpen}
        aria-haspopup="menu"
        aria-expanded={menu.open}
        aria-label={`Playthrough for session ${session.id}`}
        className={
          compact
            ? "max-w-[220px] border-transparent bg-surface-hover !px-2 !py-0.5 !text-[12px]"
            : "max-w-[260px] !py-1"
        }
        onClick={(event) => {
          event.stopPropagation();
          menu.toggle();
        }}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <span className="truncate">{playthroughName(journal, current)}</span>
        <ChevronDown size={12} className="shrink-0 opacity-70" />
      </Pill>
      <ContextMenu
        dataTour={practice ? "demo-library-menu" : undefined}
        open={menu.open}
        position={menu.position}
        anchorRef={menu.anchorRef}
        onClose={menu.close}
      >
        <ContextMenuHeading>Count this session towards</ContextMenuHeading>
        <ContextMenuItem
          selected={current === null}
          onClick={() => {
            assign(session.id, null);
            menu.close();
          }}
        >
          {DEFAULT_PLAYTHROUGH_NAME}
        </ContextMenuItem>
        {journal.playthroughs.map((p) => (
          <ContextMenuItem
            key={p.id}
            dataTour={practice ? "demo-session-named-playthrough" : undefined}
            selected={current === p.id}
            onClick={() => {
              assign(session.id, p.id);
              menu.close();
            }}
          >
            {p.name}
            {p.completedAt ? " · Finished" : ""}
          </ContextMenuItem>
        ))}
      </ContextMenu>
    </>
  );
}

export function GameJournalHost() {
  const target = usePersonalLibraryState((s) => s.journalTarget);
  // Keyed by game only: reopening the same game on another tab or playthrough
  // (a guide moving to its next step) updates the open dialog instead of
  // rebuilding it, which flashed the whole modal.
  return target ? (
    <GameJournalDialog
      key={`${target.game.source}:${target.game.gameId}`}
      target={target}
    />
  ) : null;
}

function GameJournalDialog({ target }: { target: JournalTarget }) {
  const libraryApi = usePersonalLibraryApi();
  const practice = useLibraryPractice();
  const journal = useGameJournal(target.game);
  const targetSelection =
    target.playthroughId === undefined
      ? journal.activePlaythroughId
      : target.playthroughId;
  const [selected, setSelected] = useState<string | null>(targetSelection);
  const playthrough = journal.playthroughs.find((p) => p.id === selected);
  const storedNote = playthrough?.note ?? journal.note;
  const [draft, setDraft] = useState(storedNote);
  const [name, setName] = useState("");
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [shownTarget, setShownTarget] = useState(target);
  if (shownTarget !== target) {
    // Same reset a fresh dialog would get, without remounting it.
    setShownTarget(target);
    setSelected(targetSelection);
    setName("");
    setAdding(false);
    setDeleting(false);
  }
  const sessions = usePersonalLibraryState((s) => s.recentSessions);
  const activeSessions = usePersonalLibraryState((s) => s.activeSessions);
  const archived = usePersonalLibraryState((s) => s.archivedPlaythroughSeconds);
  const archivedGameSeconds = usePersonalLibraryState(
    (s) => s.archivedGameSeconds,
  );
  const showDays = usePersonalLibraryState((s) => s.settings.showDurationDays);
  const identity = personalGameIdentity(libraryApi.getState());
  const gameKey = identity(target.game);
  const gameSessions = sessions.filter((s) => identity(s) === gameKey);
  const selectedSessions = gameSessions.filter(
    (s) => (s.playthroughId ?? null) === selected,
  );
  const running = activeSessions.filter((s) => identity(s) === gameKey);
  const [now, setNow] = useState(Date.now);
  const gameArchivedSeconds = Object.entries(archivedGameSeconds).reduce(
    (sum, [key, seconds]) => {
      const ref = gameSecondsRefFromKey(key);
      return (
        sum + (ref && identity(ref) === gameKey ? Math.max(0, seconds) : 0)
      );
    },
    0,
  );
  const defaultTime = defaultPlaythroughTime(
    journal,
    gameSessions,
    gameArchivedSeconds,
    archived,
  );
  const runningSecondsFor = (id: string | null) =>
    running
      .filter((s) => (s.playthroughId ?? null) === id)
      .reduce(
        (sum, s) =>
          sum + Math.max(0, Math.floor((now - Date.parse(s.startedAt)) / 1000)),
        0,
      );
  const sessionCountFor = (id: string | null) =>
    gameSessions.filter((s) => (s.playthroughId ?? null) === id).length;
  // One pass over the ledger: every row needs its own total, and the longest
  // row sets the scale for the bars.
  const ledger = [
    {
      id: null as string | null,
      name: DEFAULT_PLAYTHROUGH_NAME,
      completedAt: null as string | null,
      seconds: defaultTime.seconds + runningSecondsFor(null),
      sessions: sessionCountFor(null),
    },
    ...journal.playthroughs.map((p) => ({
      id: p.id as string | null,
      name: p.name,
      completedAt: p.completedAt,
      seconds:
        playthroughSeconds(p.id, gameSessions, archived) +
        runningSecondsFor(p.id),
      sessions: sessionCountFor(p.id),
    })),
  ];
  const longestSeconds = Math.max(...ledger.map((entry) => entry.seconds), 1);
  const trackedSeconds = ledger.reduce((sum, entry) => sum + entry.seconds, 0);
  const selectedSeconds =
    ledger.find((entry) => entry.id === selected)?.seconds ?? 0;
  const selectedArchivedSeconds = playthrough
    ? (archived[playthrough.id] ?? 0)
    : defaultTime.archivedSeconds;
  const runningSelected = running.filter(
    (s) => (s.playthroughId ?? null) === selected,
  );
  const lastPlayedAt = gameSessions.reduce(
    (latest, s) => (s.startedAt > latest ? s.startedAt : latest),
    "",
  );

  useEffect(() => {
    if (!running.length) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running.length]);
  useEffect(() => setDraft(storedNote), [storedNote, selected]);

  function saveNote() {
    if (draft === storedNote) return;
    if (playthrough)
      libraryApi
        .getState()
        .updatePlaythrough(target.game, playthrough.id, { note: draft });
    else libraryApi.getState().updateGameJournal(target.game, { note: draft });
  }
  function close() {
    saveNote();
    libraryApi.getState().openGameJournal(null);
  }
  function select(id: string | null) {
    saveNote();
    setSelected(id);
    setDraft(
      journal.playthroughs.find((p) => p.id === id)?.note ?? journal.note,
    );
    setDeleting(false);
  }
  function create() {
    saveNote();
    const id = libraryApi.getState().createPlaythrough(target.game, name);
    if (id) {
      setSelected(id);
      setDraft("");
      setName("");
      setAdding(false);
      setDeleting(false);
    }
  }

  const stats = [
    `${formatDuration(trackedSeconds, showDays)} tracked`,
    `${gameSessions.length} ${gameSessions.length === 1 ? "session" : "sessions"}`,
    lastPlayedAt
      ? `last played ${new Date(lastPlayedAt).toLocaleDateString()}`
      : "no sessions yet",
  ];

  return (
    <Modal
      dataTour={practice ? "demo-journal" : undefined}
      backdropDataTour={practice ? "demo-library-modal" : undefined}
      labelId="game-journal-title"
      size="xl"
      className="game-journal h-[88vh] max-h-[960px] !max-w-7xl"
      bodyClassName="flex flex-col !overflow-hidden !p-0"
      title={target.game.gameName ?? "Game journal"}
      header={
        <div className="journal-header relative shrink-0 border-b border-border bg-gradient-to-br from-accent/10 via-surface to-surface px-5 py-5 before:absolute before:inset-x-5 before:top-0 before:h-px before:bg-gradient-to-r before:from-transparent before:via-accent/80 before:to-transparent sm:px-6 sm:before:inset-x-6">
          <div className="journal-header-main flex items-start gap-5">
            {target.game.coverUrl ? (
              <GameCover
                src={target.game.coverUrl}
                alt=""
                className="journal-header-cover h-[118px] w-[88px] shrink-0 rounded-xl object-cover shadow-raised ring-1 ring-white/10"
              />
            ) : (
              <div className="grid h-[118px] w-[88px] shrink-0 place-items-center rounded-xl bg-surface-hover text-text-faint ring-1 ring-white/10">
                <Gamepad2 size={32} />
              </div>
            )}
            <div className="min-w-0 flex-1 self-center">
              <div className="min-w-0">
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-accent-ink">
                  Journal
                </div>
                <h2
                  id="game-journal-title"
                  className="journal-header-title mt-0.5 truncate text-2xl font-bold leading-tight text-text sm:text-3xl"
                  title={target.game.gameName ?? undefined}
                >
                  {target.game.gameName ?? "Game journal"}
                </h2>
                <p className="mt-1.5 text-sm text-text-muted">
                  {stats.join(" · ")}
                </p>
              </div>
            </div>
            <div className="journal-header-actions flex shrink-0 flex-col items-end gap-3">
              <IconButton icon={X} aria-label="Close" onClick={close} />
              <GameShelfStrip target={target} />
            </div>
          </div>
        </div>
      }
      onClose={close}
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-2 text-xs text-text-faint">
            <Info size={14} className="shrink-0" />
            {practice
              ? "Practice only · changes disappear when you leave the guide."
              : "Notes and playthroughs are stored on this PC only."}
          </span>
          <Button variant="primary" icon={Check} onClick={close}>
            {draft !== storedNote ? "Save and close" : "Done"}
          </Button>
        </div>
      }
    >
      <div
        data-tour={practice ? "demo-journal-columns" : undefined}
        className="journal-columns grid min-h-0 flex-1 md:grid-cols-[288px_minmax(0,1fr)]"
      >
        <div className="flex min-h-0 flex-col border-border md:border-r">
          <div className="px-5 pb-2 pt-4">
            <h3 className={eyebrowClass}>Playthroughs</h3>
          </div>
          <div
            data-controller-scroll
            className="min-h-0 flex-1 overflow-y-auto px-5 pb-4 [scrollbar-gutter:stable]"
          >
            <div
              data-tour={practice ? "demo-playthrough-list" : undefined}
              role="listbox"
              aria-label="Playthroughs"
              className="space-y-2"
            >
              {ledger.map((entry) => (
                <LedgerRow
                  key={entry.id ?? "default"}
                  entry={entry}
                  share={entry.seconds / longestSeconds}
                  active={journal.activePlaythroughId === entry.id}
                  selected={selected === entry.id}
                  showDays={showDays}
                  autoFocus={
                    target.tab !== "note" &&
                    target.tab !== "organize" &&
                    selected === entry.id
                  }
                  onSelect={() => select(entry.id)}
                  onActivate={
                    entry.completedAt
                      ? undefined
                      : () =>
                          libraryApi
                            .getState()
                            .setActivePlaythrough(target.game, entry.id)
                  }
                />
              ))}
            </div>

            <div
              data-tour={practice ? "demo-new-playthrough" : undefined}
              className="mt-3"
            >
              {adding ? (
                <form
                  className="grid gap-2 rounded-xl border border-accent/60 bg-accent-tint/40 p-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    create();
                  }}
                >
                  <Input
                    data-tour={practice ? "demo-playthrough-name" : undefined}
                    autoFocus
                    aria-label="New playthrough name"
                    maxLength={NAME_LIMIT}
                    value={name}
                    placeholder="Speedrun, New Game+, Hardcore…"
                    className="w-full !py-1.5 text-[13px]"
                    onChange={(event) => setName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        event.stopPropagation();
                        setAdding(false);
                        setName("");
                      }
                    }}
                  />
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="ghost"
                      className="!px-2.5 !py-1.5 text-[13px]"
                      onClick={() => {
                        setAdding(false);
                        setName("");
                      }}
                    >
                      Cancel
                    </Button>
                    <Button
                      data-tour={
                        practice ? "demo-playthrough-create" : undefined
                      }
                      type="submit"
                      variant="primary"
                      icon={Plus}
                      aria-label="Create playthrough"
                      className="!px-2.5 !py-1.5 text-[13px]"
                      disabled={!name.trim()}
                    >
                      Create
                    </Button>
                  </div>
                </form>
              ) : (
                <button
                  type="button"
                  data-tour={practice ? "demo-playthrough-name" : undefined}
                  onClick={() => setAdding(true)}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-surface px-3 py-3 text-sm font-medium text-text transition hover:border-accent/50 hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                >
                  <Plus size={16} />
                  Add playthrough
                </button>
              )}
            </div>

            <div className="mt-3 flex items-start gap-2.5 rounded-xl border border-border bg-bg px-3.5 py-3 text-[13px] leading-5 text-text-muted">
              <Info size={16} className="mt-0.5 shrink-0 text-text-faint" />
              <p>
                Your next session will be assigned to{" "}
                <span className="font-medium text-text">
                  {playthroughName(journal)}
                </span>
                .
              </p>
            </div>
          </div>
        </div>

        <div
          data-controller-scroll
          className="grid min-h-0 content-start gap-5 overflow-y-auto p-5 [scrollbar-gutter:stable]"
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              {playthrough ? (
                <Input
                  key={`${playthrough.id}:${playthrough.name}`}
                  aria-label="Playthrough name"
                  maxLength={NAME_LIMIT}
                  defaultValue={playthrough.name}
                  className="-mx-2 w-full border-transparent bg-transparent !px-2 !py-1 !text-lg font-bold leading-7 !text-text hover:border-border"
                  onBlur={(event) => {
                    if (event.target.value.trim())
                      libraryApi
                        .getState()
                        .updatePlaythrough(target.game, playthrough.id, {
                          name: event.target.value,
                        });
                    else event.target.value = playthrough.name;
                  }}
                />
              ) : (
                <h3 className="py-1 text-lg font-bold leading-7 text-text">
                  {DEFAULT_PLAYTHROUGH_NAME}
                </h3>
              )}
              <p className="mt-1 text-xs text-text-muted">
                {playthrough
                  ? `Started ${new Date(playthrough.createdAt).toLocaleDateString()}`
                  : "All sessions that are not assigned to a named playthrough."}
                {selectedArchivedSeconds > 0
                  ? ` · includes ${formatDuration(selectedArchivedSeconds, showDays)} from archived sessions`
                  : ""}
              </p>
            </div>
            <div className="text-right">
              <div className={eyebrowClass}>Playtime</div>
              <div className="font-mono text-3xl font-semibold leading-none tabular-nums text-accent-ink">
                {formatDuration(selectedSeconds, showDays)}
              </div>
            </div>
          </div>

          <div
            data-tour={practice ? "demo-playthrough-actions" : undefined}
            className="flex flex-wrap items-center gap-2"
          >
            <Pill
              data-tour={practice ? "demo-playthrough-active" : undefined}
              icon={Check}
              selected={journal.activePlaythroughId === selected}
              disabled={
                journal.activePlaythroughId === selected ||
                Boolean(playthrough?.completedAt)
              }
              title={
                playthrough?.completedAt
                  ? "Reopen this playthrough to make it active"
                  : undefined
              }
              onClick={() =>
                libraryApi
                  .getState()
                  .setActivePlaythrough(target.game, selected)
              }
            >
              {journal.activePlaythroughId === selected
                ? "Active"
                : "Make active"}
            </Pill>
            {playthrough ? (
              <Pill
                data-tour={practice ? "demo-playthrough-finish" : undefined}
                icon={Flag}
                selected={Boolean(playthrough.completedAt)}
                onClick={() =>
                  libraryApi
                    .getState()
                    .updatePlaythrough(target.game, playthrough.id, {
                      completedAt: playthrough.completedAt
                        ? null
                        : new Date().toISOString(),
                    })
                }
              >
                {playthrough.completedAt ? "Finished" : "Mark finished"}
              </Pill>
            ) : null}
            {playthrough?.completedAt ? (
              <label className="flex items-center gap-2 text-xs text-text-muted">
                on
                <Input
                  type="date"
                  aria-label="Playthrough completion date"
                  className="!py-1 text-xs"
                  value={playthrough.completedAt.slice(0, 10)}
                  onChange={(event) => {
                    if (event.target.value)
                      libraryApi
                        .getState()
                        .updatePlaythrough(target.game, playthrough.id, {
                          completedAt: `${event.target.value}T12:00:00.000Z`,
                        });
                  }}
                />
              </label>
            ) : null}
            {playthrough ? (
              <IconButton
                icon={Trash2}
                intent="danger"
                aria-label="Delete playthrough"
                title="Delete playthrough"
                className="ml-auto"
                onClick={() => setDeleting(true)}
              />
            ) : null}
          </div>

          {deleting && playthrough ? (
            <div className="rounded-lg border border-warning-border bg-warning-tint p-3 text-sm text-text">
              Delete “{playthrough.name}” and its note? Its sessions move back
              to Default playthrough. No playtime is lost.
              <div className="mt-3 flex gap-2">
                <Button
                  variant="danger"
                  onClick={() => {
                    libraryApi
                      .getState()
                      .deletePlaythrough(target.game, playthrough.id);
                    setSelected(null);
                    setDeleting(false);
                  }}
                >
                  Delete playthrough
                </Button>
                <Button variant="secondary" onClick={() => setDeleting(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}

          <section
            data-tour={practice ? "demo-journal-note" : undefined}
            aria-labelledby="journal-note-heading"
            className="rounded-xl border border-border bg-surface p-4"
          >
            <h4
              id="journal-note-heading"
              className="text-base font-bold text-text"
            >
              Game notes
            </h4>
            <p className="mt-0.5 text-[13px] text-text-muted">
              Keep track of where you are, your goals, and anything else about
              your journey.
            </p>
            <textarea
              data-tour={practice ? "demo-note-input" : undefined}
              id="journal-note"
              aria-label="Note"
              data-autofocus={target.tab === "note" ? "" : undefined}
              rows={5}
              maxLength={Math.max(NOTE_LIMIT, storedNote.length)}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onBlur={saveNote}
              placeholder="Where did you stop? What do you want to do next?"
              className="mt-3 w-full resize-y rounded-xl border border-border bg-bg p-4 text-sm leading-relaxed text-text outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/30"
            />
            <div className="mt-2 flex items-center gap-3">
              <span
                aria-live="polite"
                className={`inline-flex items-center gap-1.5 text-xs ${draft === storedNote ? "text-text-faint" : "text-warning"}`}
              >
                {draft === storedNote ? (
                  <Check size={14} className="text-success" />
                ) : null}
                {draft === storedNote ? "Saved" : "Unsaved changes"}
              </span>
              <span className="ml-auto font-mono text-[11px] tabular-nums text-text-faint">
                {draft.length.toLocaleString()} /{" "}
                {Math.max(NOTE_LIMIT, storedNote.length).toLocaleString()}
              </span>
              <Button
                data-tour={practice ? "demo-note-save" : undefined}
                icon={Check}
                variant="primary"
                onClick={saveNote}
                disabled={draft === storedNote}
              >
                Save note
              </Button>
            </div>
          </section>

          <div
            data-tour={practice ? "demo-playthrough-sessions" : undefined}
            className="grid gap-2"
          >
            <div className="flex items-center justify-between gap-3">
              <h4 className={eyebrowClass}>
                Recorded sessions · {selectedSessions.length}
              </h4>
              {!practice && gameSessions.length ? (
                <ShowHistoryLink
                  target={target}
                  session={gameSessions[0]}
                  onNavigate={close}
                />
              ) : null}
            </div>
            <div className="overflow-hidden rounded-xl border border-border">
              {selectedSessions.length || runningSelected.length ? (
                <table className="w-full table-fixed text-sm">
                  <thead>
                    <tr className="border-b border-border bg-bg text-left">
                      <th className={`px-3 py-2 font-semibold ${eyebrowClass}`}>
                        Date
                      </th>
                      <th className={`px-3 py-2 font-semibold ${eyebrowClass}`}>
                        Duration
                      </th>
                      <th className={`px-3 py-2 font-semibold ${eyebrowClass}`}>
                        Playthrough
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {runningSelected.map((s) => (
                      <tr key={`live-${s.id}`}>
                        <td className="whitespace-nowrap px-3 py-2">
                          <span className="inline-flex items-center gap-2 text-success">
                            <span className="h-1.5 w-1.5 rounded-full bg-success" />
                            Playing now
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 font-mono tabular-nums text-text">
                          {formatDuration(
                            Math.max(
                              0,
                              Math.floor(
                                (now - Date.parse(s.startedAt)) / 1000,
                              ),
                            ),
                            showDays,
                          )}
                        </td>
                        <td className="px-3 py-1.5 [&>button]:w-full [&>button]:max-w-none [&>button]:justify-between">
                          <SessionPlaythroughPicker
                            session={s}
                            compact
                            showDefault
                          />
                        </td>
                      </tr>
                    ))}
                    {selectedSessions.map((s) => (
                      <tr key={s.id} className="text-text-muted">
                        <td className="whitespace-nowrap px-3 py-2 tabular-nums">
                          {new Date(s.startedAt).toLocaleDateString()}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 font-mono tabular-nums text-text">
                          {formatDuration(s.durationSeconds ?? 0, showDays)}
                        </td>
                        <td className="px-3 py-1.5 [&>button]:w-full [&>button]:max-w-none [&>button]:justify-between">
                          <SessionPlaythroughPicker
                            session={s}
                            compact
                            showDefault
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="px-3 py-4 text-sm text-text-faint">
                  No sessions yet. New sessions are added here while this
                  playthrough is active.
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}

/** Jumps to My History filtered to this game. Uses the same key History
 *  itself groups sessions by, so the filter matches exactly one game. */
function ShowHistoryLink({
  target,
  session,
  onNavigate,
}: {
  target: JournalTarget;
  session: Session;
  onNavigate: () => void;
}) {
  const hydratedGameMetadata = useAppStore((s) => s.gameMetadata);
  const exeCache = useAppStore((s) => s.exeCache);
  const setActiveView = useAppStore((s) => s.setActiveView);
  const setHistoryQuery = useAppStore((s) => s.setHistoryQuery);
  const setHistoryGameKey = useAppStore((s) => s.setHistoryGameKey);
  const resolveIgdbId = useMemo(
    () => createGameIdentityResolver(hydratedGameMetadata, exeCache),
    [exeCache, hydratedGameMetadata],
  );
  return (
    <Button
      variant="ghost"
      className="!px-2 !py-1 text-[13px]"
      onClick={() => {
        onNavigate();
        setHistoryQuery(target.game.gameName ?? "");
        setHistoryGameKey(getSessionGameKey(session, resolveIgdbId));
        setActiveView("history");
      }}
    >
      Show full history
      <ArrowRight size={14} />
    </Button>
  );
}

function LedgerRow({
  entry,
  share,
  active,
  selected,
  showDays,
  autoFocus,
  onSelect,
  onActivate,
}: {
  entry: {
    id: string | null;
    name: string;
    completedAt: string | null;
    seconds: number;
    sessions: number;
  };
  share: number;
  active: boolean;
  selected: boolean;
  showDays: boolean;
  autoFocus: boolean;
  onSelect: () => void;
  /** Double-click. Missing for a finished playthrough, which must be reopened first. */
  onActivate?: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      data-autofocus={autoFocus ? "" : undefined}
      onClick={onSelect}
      onDoubleClick={onActivate}
      title={onActivate && !active ? "Double-click to make active" : undefined}
      className={`grid w-full gap-2 rounded-xl border px-3.5 py-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 ${
        selected
          ? "border-accent/60 bg-accent-tint"
          : "border-border bg-surface hover:border-accent/40 hover:bg-surface-hover"
      }`}
    >
      <div className="flex min-w-0 items-center gap-2">
        <span
          aria-hidden
          className={`h-2 w-2 shrink-0 rounded-full ${
            entry.completedAt
              ? "bg-accent"
              : active
                ? "bg-success"
                : "bg-text-faint"
          }`}
        />
        <span
          className={`truncate text-[13px] font-semibold ${selected ? "text-text" : "text-text-muted"}`}
        >
          {entry.name}
        </span>
        {active ? (
          <span
            title="New sessions count towards this playthrough"
            className="ml-auto shrink-0 rounded-full bg-accent/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent-ink"
          >
            Active
          </span>
        ) : null}
        {entry.completedAt ? (
          <Flag
            size={12}
            className={`shrink-0 text-success ${active ? "" : "ml-auto"}`}
            aria-label="Finished"
          />
        ) : null}
      </div>
      <div className="text-[12px] text-text-muted">
        <span className="font-mono tabular-nums text-text">
          {formatDuration(entry.seconds, showDays)}
        </span>
        {" · "}
        {entry.sessions} {entry.sessions === 1 ? "session" : "sessions"}
      </div>
      <span className="h-1 overflow-hidden rounded-full bg-surface-hover">
        <span
          className={`block h-full rounded-full ${selected ? "bg-accent" : "bg-border"}`}
          style={{ width: `${Math.max(2, Math.round(share * 100))}%` }}
        />
      </span>
    </button>
  );
}

/** Favorite, progress and shelves describe the game, not a single run. */
function GameShelfStrip({ target }: { target: JournalTarget }) {
  const practice = useLibraryPractice();
  const journal = useGameJournal(target.game);
  const shelves = usePersonalLibraryState((s) => s.personalShelves);
  const showShelves = usePersonalLibraryState(
    (s) => s.settings.libraryShowShelves !== false,
  );
  const update = usePersonalLibraryState((s) => s.updateGameJournal);
  const save = usePersonalLibraryState((s) => s.savePersonalShelf);
  const statusMenu = useAnchoredMenu();
  const shelfMenu = useAnchoredMenu();
  const [shelfName, setShelfName] = useState("");
  const manualShelves = useMemo(
    () => shelves.filter((s) => !s.filters),
    [shelves],
  );
  const memberships = manualShelves.filter((s) =>
    journal.shelfIds.includes(s.id),
  );
  const status = journal.status;

  function toggleShelf(id: string, member: boolean) {
    update(target.game, {
      shelfIds: member
        ? journal.shelfIds.filter((value) => value !== id)
        : [...journal.shelfIds, id],
    });
  }

  return (
    <div
      data-tour={practice ? "demo-journal-organize" : undefined}
      className="flex flex-wrap items-center justify-end gap-2"
    >
      <Pill
        className={headerButton}
        icon={Star}
        selected={journal.favorite}
        aria-pressed={journal.favorite}
        onClick={() => update(target.game, { favorite: !journal.favorite })}
      >
        {journal.favorite ? "Favorite" : "Add to Favorites"}
      </Pill>

      <Pill
        className={headerButton}
        ref={statusMenu.anchorRef}
        aria-haspopup="menu"
        aria-expanded={statusMenu.open}
        aria-label="Progress status"
        data-autofocus={
          target.tab === "organize" && !showShelves ? "" : undefined
        }
        selected={Boolean(status)}
        onClick={statusMenu.toggle}
      >
        <span
          className={`h-2 w-2 rounded-full ${status ? STATUS_TONES[status].dot : "bg-text-faint"}`}
        />
        {status ? GAME_STATUSES[status] : "Set progress"}
        <ChevronDown size={12} className="opacity-70" />
      </Pill>
      <ContextMenu
        dataTour={practice ? "demo-library-menu" : undefined}
        open={statusMenu.open}
        position={statusMenu.position}
        anchorRef={statusMenu.anchorRef}
        onClose={statusMenu.close}
      >
        <ContextMenuHeading>Progress</ContextMenuHeading>
        {GAME_STATUS_LIST.map((value) => (
          <ContextMenuItem
            key={value}
            selected={status === value}
            onClick={() => {
              update(target.game, {
                status: status === value ? null : (value as GameStatus),
              });
              statusMenu.close();
            }}
          >
            {GAME_STATUSES[value]}
          </ContextMenuItem>
        ))}
      </ContextMenu>

      {showShelves ? (
        <>
          {memberships.map((shelf) => (
            <Pill
              className={headerButton}
              key={shelf.id}
              selected
              aria-label={`Remove ${target.game.gameName ?? "game"} from ${shelf.name}`}
              title="Remove from this shelf"
              onClick={() => toggleShelf(shelf.id, true)}
            >
              {shelf.name}
              <X size={12} className="opacity-70" />
            </Pill>
          ))}
          <Pill
            className={headerButton}
            data-tour={practice ? "demo-journal-shelf" : undefined}
            ref={shelfMenu.anchorRef}
            icon={Plus}
            aria-haspopup="menu"
            aria-expanded={shelfMenu.open}
            data-autofocus={target.tab === "organize" ? "" : undefined}
            onClick={shelfMenu.toggle}
          >
            Add to shelf
          </Pill>
          <ContextMenu
            dataTour={practice ? "demo-library-menu" : undefined}
            open={shelfMenu.open}
            position={shelfMenu.position}
            anchorRef={shelfMenu.anchorRef}
            onClose={shelfMenu.close}
          >
            <ContextMenuHeading>Shelves</ContextMenuHeading>
            {manualShelves.map((shelf) => (
              <ContextMenuItem
                key={shelf.id}
                dataTour={practice ? "demo-journal-shelf-choice" : undefined}
                selected={journal.shelfIds.includes(shelf.id)}
                onClick={() =>
                  toggleShelf(shelf.id, journal.shelfIds.includes(shelf.id))
                }
              >
                {shelf.name}
              </ContextMenuItem>
            ))}
            {!manualShelves.length ? (
              <p className="max-w-56 px-3 py-2 text-xs leading-5 text-text-muted">
                Shelves group your games any way you like. A game can sit on
                several shelves.
              </p>
            ) : null}
            <form
              className="flex gap-1.5 border-t border-border px-2 pb-1 pt-2"
              onSubmit={(event) => {
                event.preventDefault();
                const id = save({ name: shelfName });
                if (id) {
                  update(target.game, { shelfIds: [...journal.shelfIds, id] });
                  setShelfName("");
                  shelfMenu.close();
                }
              }}
            >
              <Input
                aria-label="New shelf name"
                maxLength={NAME_LIMIT}
                value={shelfName}
                placeholder="Online Games"
                className="w-40 !py-1 text-[13px]"
                onChange={(event) => setShelfName(event.target.value)}
              />
              <Button
                type="submit"
                variant="secondary"
                icon={Plus}
                aria-label="Create shelf and add this game"
                className="!px-2"
                disabled={!shelfName.trim()}
              />
            </form>
          </ContextMenu>
        </>
      ) : null}
    </div>
  );
}
