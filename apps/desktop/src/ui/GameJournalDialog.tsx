import {
  usePersonalLibraryState,
  usePersonalLibraryApi,
  useLibraryPractice,
} from "./PersonalLibraryContext";
import {
  BookOpen,
  Check,
  ChevronDown,
  Flag,
  Gamepad2,
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
import { personalGameIdentity, type ActiveSession } from "../store";
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

/* The game journal ───────────────────────────────────────────────────────────
   One game, one page. The left column is a ledger of playthroughs with the
   time each one took, so a replay is something you can see rather than
   something you have to remember. The right column is the selected
   playthrough: its name, its note, and the sessions it owns. Favorites,
   progress and shelves describe the game itself, so they sit in the header
   above both columns. */

/** Assigns one session to a playthrough. Reads as a label, opens as a menu. */
export function SessionPlaythroughPicker({
  session,
  compact = false,
}: {
  session: Session | ActiveSession;
  compact?: boolean;
}) {
  const practice = useLibraryPractice();
  const journal = useGameJournal(session);
  const assign = usePersonalLibraryState((s) => s.assignSessionPlaythrough);
  const open = usePersonalLibraryState((s) => s.openGameJournal);
  const menu = useAnchoredMenu();
  const current = session.playthroughId ?? null;

  if (!journal.playthroughs.length)
    return compact ? null : (
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
  return target ? (
    <GameJournalDialog
      key={`${target.game.source}:${target.game.gameId}:${target.tab}:${target.playthroughId}`}
      target={target}
    />
  ) : null;
}

function GameJournalDialog({ target }: { target: JournalTarget }) {
  const libraryApi = usePersonalLibraryApi();
  const practice = useLibraryPractice();
  const journal = useGameJournal(target.game);
  const [selected, setSelected] = useState<string | null>(
    target.playthroughId === undefined
      ? journal.activePlaythroughId
      : target.playthroughId,
  );
  const playthrough = journal.playthroughs.find((p) => p.id === selected);
  const storedNote = playthrough?.note ?? journal.note;
  const [draft, setDraft] = useState(storedNote);
  const [name, setName] = useState("");
  const [deleting, setDeleting] = useState(false);
  const sessions = usePersonalLibraryState((s) => s.recentSessions);
  const activeSessions = usePersonalLibraryState((s) => s.activeSessions);
  const archived = usePersonalLibraryState((s) => s.archivedPlaythroughSeconds);
  const archivedGameSeconds = usePersonalLibraryState(
    (s) => s.archivedGameSeconds,
  );
  const playtimeAdjustments = usePersonalLibraryState(
    (s) => s.playtimeAdjustments,
  );
  const libraryImports = usePersonalLibraryState((s) => s.libraryImports);
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
  const hasGameWideTime =
    [...libraryImports.values()].some(
      (entry) =>
        (entry.providerSeconds ?? 0) > 0 && identity(entry) === gameKey,
    ) ||
    Object.entries(playtimeAdjustments).some(([key, seconds]) => {
      const ref = gameSecondsRefFromKey(key);
      return seconds !== 0 && ref && identity(ref) === gameKey;
    });
  const runningSecondsFor = (id: string | null) =>
    running
      .filter((s) => (s.playthroughId ?? null) === id)
      .reduce(
        (sum, s) =>
          sum + Math.max(0, Math.floor((now - Date.parse(s.startedAt)) / 1000)),
        0,
      );
  // One pass over the ledger: every row needs its own total, and the longest
  // row sets the scale for the bars.
  const ledger = [
    {
      id: null as string | null,
      name: DEFAULT_PLAYTHROUGH_NAME,
      completedAt: null as string | null,
      seconds: defaultTime.seconds + runningSecondsFor(null),
    },
    ...journal.playthroughs.map((p) => ({
      id: p.id as string | null,
      name: p.name,
      completedAt: p.completedAt,
      seconds:
        playthroughSeconds(p.id, gameSessions, archived) +
        runningSecondsFor(p.id),
    })),
  ];
  const longestSeconds = Math.max(...ledger.map((entry) => entry.seconds), 1);
  const trackedSeconds = ledger.reduce((sum, entry) => sum + entry.seconds, 0);
  const selectedSeconds =
    ledger.find((entry) => entry.id === selected)?.seconds ?? 0;
  const selectedArchivedSeconds = playthrough
    ? (archived[playthrough.id] ?? 0)
    : defaultTime.archivedSeconds;
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
      setDeleting(false);
    }
  }

  return (
    <Modal
      dataTour={practice ? "demo-journal" : undefined}
      backdropDataTour={practice ? "demo-library-modal" : undefined}
      labelId="game-journal-title"
      size="xl"
      className="h-[720px]"
      bodyClassName="flex flex-col !overflow-hidden !p-0"
      media={
        target.game.coverUrl ? (
          <GameCover
            src={target.game.coverUrl}
            alt=""
            className="h-[58px] w-11 shrink-0 rounded-lg object-cover shadow-sm ring-1 ring-white/10"
          />
        ) : (
          <div className="grid h-[58px] w-11 shrink-0 place-items-center rounded-lg bg-surface-hover text-text-faint ring-1 ring-white/10">
            <Gamepad2 size={20} />
          </div>
        )
      }
      eyebrow="Journal"
      title={target.game.gameName ?? "Game journal"}
      subtitle={[
        `${formatDuration(trackedSeconds, showDays)} tracked`,
        `${gameSessions.length} ${gameSessions.length === 1 ? "session" : "sessions"}`,
        lastPlayedAt
          ? `last played ${new Date(lastPlayedAt).toLocaleDateString()}`
          : "no sessions yet",
      ].join(" · ")}
      onClose={close}
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-text-faint">
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
      <GameShelfStrip target={target} />

      <div
        data-tour={practice ? "demo-journal-columns" : undefined}
        className="grid min-h-0 flex-1 md:grid-cols-[252px_minmax(0,1fr)]"
      >
        <div className="flex min-h-0 flex-col border-border md:border-r">
          <div className="flex items-baseline justify-between px-5 pt-4">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-text-faint">
              Playthroughs
            </h3>
            <span className="font-mono text-[11px] text-text-faint">
              {ledger.length}
            </span>
          </div>
          <div
            data-controller-scroll
            data-tour={practice ? "demo-playthrough-list" : undefined}
            role="listbox"
            aria-label="Playthroughs"
            className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 py-3 [scrollbar-gutter:stable]"
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
              />
            ))}
          </div>
          <form
            data-tour={practice ? "demo-new-playthrough" : undefined}
            className="flex gap-2 border-t border-border px-3 py-3"
            onSubmit={(event) => {
              event.preventDefault();
              create();
            }}
          >
            <Input
              data-tour={practice ? "demo-playthrough-name" : undefined}
              aria-label="New playthrough name"
              maxLength={NAME_LIMIT}
              value={name}
              placeholder="Speedrun, New Game+, Hardcore…"
              className="flex-1 !py-1.5 text-[13px]"
              onChange={(event) => setName(event.target.value)}
            />
            <Button
              data-tour={practice ? "demo-playthrough-create" : undefined}
              type="submit"
              variant="secondary"
              icon={Plus}
              aria-label="Create playthrough"
              title="Create playthrough"
              className="!px-2.5"
              disabled={!name.trim()}
            />
          </form>
          <p className="border-t border-border px-5 py-2.5 text-[11px] leading-4 text-text-faint">
            Your next session is counted towards{" "}
            <span className="font-medium text-text-muted">
              {playthroughName(journal)}
            </span>
            .
          </p>
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
                  className="-mx-2 w-full border-transparent bg-transparent px-2 py-1 text-lg font-bold !text-text hover:border-border"
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
                <h3 className="py-1 text-lg font-bold text-text">
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
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-text-faint">
                Playtime
              </div>
              <div className="font-mono text-3xl font-semibold leading-none tabular-nums text-accent">
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

          {!playthrough && hasGameWideTime ? (
            <p className="rounded-lg border border-border bg-bg px-3 py-2 text-xs leading-5 text-text-muted">
              Playtime imported from Steam or Xbox and adjustments to the total
              count towards the game&apos;s overall total only. They cannot be
              assigned to a playthrough.
            </p>
          ) : null}

          <div
            data-tour={practice ? "demo-journal-note" : undefined}
            className="grid gap-2"
          >
            <div className="flex items-center justify-between">
              <label
                htmlFor="journal-note"
                className="text-[11px] font-semibold uppercase tracking-[0.14em] text-text-faint"
              >
                Note
              </label>
              <span className="font-mono text-[11px] text-text-faint">
                {draft.length.toLocaleString()} /{" "}
                {Math.max(NOTE_LIMIT, storedNote.length).toLocaleString()}
              </span>
            </div>
            <textarea
              data-tour={practice ? "demo-note-input" : undefined}
              id="journal-note"
              data-autofocus={target.tab === "note" ? "" : undefined}
              rows={4}
              maxLength={Math.max(NOTE_LIMIT, storedNote.length)}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onBlur={saveNote}
              placeholder="Where did you stop? What do you want to do next time?"
              className="w-full resize-y rounded-xl border border-border bg-bg p-4 text-sm leading-relaxed text-text outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/30"
            />
            <div className="flex items-center justify-end gap-2">
              <span aria-live="polite" className="text-[11px] text-text-faint">
                {draft === storedNote ? "Saved" : "Unsaved changes"}
              </span>
              <Button
                data-tour={practice ? "demo-note-save" : undefined}
                icon={Check}
                variant="secondary"
                onClick={saveNote}
                disabled={draft === storedNote}
              >
                Save note
              </Button>
            </div>
          </div>

          <div
            data-tour={practice ? "demo-playthrough-sessions" : undefined}
            className="grid gap-2"
          >
            <h4 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-text-faint">
              Recorded sessions · {selectedSessions.length}
            </h4>
            <div className="divide-y divide-border rounded-xl border border-border">
              {running
                .filter((s) => (s.playthroughId ?? null) === selected)
                .map((s) => (
                  <div
                    key={`live-${s.id}`}
                    className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
                  >
                    <span className="inline-flex items-center gap-2 text-success">
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" />
                      Playing now
                    </span>
                    <SessionPlaythroughPicker session={s} compact />
                  </div>
                ))}
              {selectedSessions.map((s) => (
                <div
                  key={s.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm text-text-muted"
                >
                  <span className="tabular-nums">
                    {new Date(s.startedAt).toLocaleDateString()}
                    <span className="ml-2 font-mono text-text">
                      {formatDuration(s.durationSeconds ?? 0, showDays)}
                    </span>
                  </span>
                  <SessionPlaythroughPicker session={s} compact />
                </div>
              ))}
              {!selectedSessions.length && !running.length ? (
                <p className="px-3 py-4 text-sm text-text-faint">
                  No sessions yet. New sessions are added here while this
                  playthrough is active.
                </p>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </Modal>
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
}: {
  entry: {
    id: string | null;
    name: string;
    completedAt: string | null;
    seconds: number;
  };
  share: number;
  active: boolean;
  selected: boolean;
  showDays: boolean;
  autoFocus: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      data-autofocus={autoFocus ? "" : undefined}
      onClick={onSelect}
      className={`grid w-full gap-1.5 rounded-lg border px-3 py-2.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 ${
        selected
          ? "border-accent/60 bg-accent-tint"
          : "border-transparent hover:bg-surface-hover"
      }`}
    >
      <div className="flex min-w-0 items-center gap-2">
        <span
          className={`truncate text-[13px] font-medium ${selected ? "text-text" : "text-text-muted"}`}
        >
          {entry.name}
        </span>
        {active ? (
          <span
            title="New sessions count towards this playthrough"
            className="ml-auto shrink-0 rounded-full bg-accent/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent"
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
      <div className="flex items-center gap-2">
        <span className="font-mono text-[11px] tabular-nums text-text-faint">
          {formatDuration(entry.seconds, showDays)}
        </span>
        <span className="h-1 flex-1 overflow-hidden rounded-full bg-surface-hover">
          <span
            className={`block h-full rounded-full ${selected ? "bg-accent" : "bg-border"}`}
            style={{ width: `${Math.max(2, Math.round(share * 100))}%` }}
          />
        </span>
      </div>
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
      className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3"
    >
      <Pill
        icon={Star}
        selected={journal.favorite}
        aria-pressed={journal.favorite}
        onClick={() => update(target.game, { favorite: !journal.favorite })}
      >
        {journal.favorite ? "Favorite" : "Add to Favorites"}
      </Pill>

      <Pill
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
          <span aria-hidden className="mx-1 h-5 w-px bg-border" />

          {memberships.map((shelf) => (
            <Pill
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
            data-tour={practice ? "demo-journal-shelf" : undefined}
            ref={shelfMenu.anchorRef}
            icon={Plus}
            aria-haspopup="menu"
            aria-expanded={shelfMenu.open}
            data-autofocus={target.tab === "organize" ? "" : undefined}
            onClick={shelfMenu.toggle}
          >
            Shelf
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
