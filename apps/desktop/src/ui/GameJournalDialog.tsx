import {
  BookOpen,
  Check,
  Flag,
  FolderHeart,
  Plus,
  Star,
  StickyNote,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
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
  personalGameIdentity,
  useAppStore,
  type ActiveSession,
} from "../store";
import { Button, Input, Modal } from "./primitives";
import { formatDuration } from "./components";
import { useGameJournal } from "./useGameJournal";
import type { Session } from "@playcounter/shared";
import { gameSecondsRefFromKey } from "../gameSeconds";

export const journalSelectClass =
  "min-w-0 rounded-md border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus:border-accent focus:ring-2 focus:ring-accent/30";

export function SessionPlaythroughSelect({
  session,
  compact = false,
}: {
  session: Session | ActiveSession;
  compact?: boolean;
}) {
  const journal = useGameJournal(session);
  const assign = useAppStore((s) => s.assignSessionPlaythrough);
  const open = useAppStore((s) => s.openGameJournal);
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
    <label
      className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-text-muted"
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <span>{compact ? "Playthrough" : "This session"}</span>
      <select
        aria-label={`Playthrough for session ${session.id}`}
        className={`${journalSelectClass} max-w-[240px] !py-1`}
        value={session.playthroughId ?? ""}
        onChange={(event) => assign(session.id, event.target.value || null)}
      >
        <option value="">{DEFAULT_PLAYTHROUGH_NAME}</option>
        {journal.playthroughs.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
            {p.completedAt ? " · Finished" : ""}
          </option>
        ))}
      </select>
    </label>
  );
}

export function GameJournalHost() {
  const target = useAppStore((s) => s.journalTarget);
  return target ? (
    <GameJournalDialog
      key={`${target.game.source}:${target.game.gameId}:${target.tab}:${target.playthroughId}`}
      target={target}
    />
  ) : null;
}

function GameJournalDialog({ target }: { target: JournalTarget }) {
  const journal = useGameJournal(target.game);
  const [tab, setTab] = useState(target.tab ?? "note");
  const [selected, setSelected] = useState<string | null>(
    target.playthroughId === undefined
      ? journal.activePlaythroughId
      : target.playthroughId,
  );
  const playthrough = journal.playthroughs.find((p) => p.id === selected);
  const storedNote = playthrough?.note ?? journal.note;
  const [draft, setDraft] = useState(storedNote);
  const [name, setName] = useState("");
  const [shelfName, setShelfName] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  const sessions = useAppStore((s) => s.recentSessions);
  const activeSessions = useAppStore((s) => s.activeSessions);
  const archived = useAppStore((s) => s.archivedPlaythroughSeconds);
  const archivedGameSeconds = useAppStore((s) => s.archivedGameSeconds);
  const playtimeAdjustments = useAppStore((s) => s.playtimeAdjustments);
  const libraryImports = useAppStore((s) => s.libraryImports);
  const shelves = useAppStore((s) => s.personalShelves);
  const actions = useAppStore;
  const identity = personalGameIdentity(actions.getState());
  const gameKey = identity(target.game);
  const gameSessions = sessions.filter((s) => identity(s) === gameKey);
  const selectedSessions = gameSessions.filter(
    (s) => (s.playthroughId ?? null) === selected,
  );
  const running = activeSessions.filter((s) => identity(s) === gameKey);
  const showDays = useAppStore((s) => s.settings.showDurationDays);
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
  const selectedSeconds =
    (playthrough
      ? playthroughSeconds(playthrough.id, gameSessions, archived)
      : defaultTime.seconds) +
    running
      .filter((s) => (s.playthroughId ?? null) === selected)
      .reduce(
        (sum, s) =>
          sum + Math.max(0, Math.floor((now - Date.parse(s.startedAt)) / 1000)),
        0,
      );
  const selectedArchivedSeconds = playthrough
    ? (archived[playthrough.id] ?? 0)
    : defaultTime.archivedSeconds;
  useEffect(() => {
    if (!running.length) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running.length]);
  useEffect(() => setDraft(storedNote), [storedNote, selected]);

  function saveNote() {
    if (draft === storedNote) return;
    if (playthrough)
      actions
        .getState()
        .updatePlaythrough(target.game, playthrough.id, { note: draft });
    else actions.getState().updateGameJournal(target.game, { note: draft });
  }
  function close() {
    saveNote();
    actions.getState().openGameJournal(null);
  }
  function select(id: string | null) {
    saveNote();
    setSelected(id);
    setDraft(
      journal.playthroughs.find((p) => p.id === id)?.note ?? journal.note,
    );
    setDeleting(null);
  }
  function create() {
    saveNote();
    const id = actions.getState().createPlaythrough(target.game, name);
    if (id) {
      setSelected(id);
      setName("");
    }
  }

  return (
    <Modal
      labelId="game-journal-title"
      size="wide"
      className="h-[720px]"
      bodyClassName="flex flex-col !overflow-hidden"
      icon={BookOpen}
      title={target.game.gameName ?? "Game journal"}
      subtitle="Your notes, playthroughs, and shelves"
      onClose={close}
      footer={
        <Button variant="primary" icon={Check} onClick={close}>
          {draft !== storedNote ? "Save and close" : "Done"}
        </Button>
      }
    >
      <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] gap-5">
        <div
          className="flex flex-wrap gap-2"
          role="tablist"
          aria-label="Game journal"
        >
          {(
            [
              { id: "note", label: "Notes", icon: StickyNote },
              { id: "playthroughs", label: "Playthroughs", icon: BookOpen },
              { id: "organize", label: "Shelves & status", icon: FolderHeart },
            ] as const
          ).map((item) => (
            <Button
              key={item.id}
              role="tab"
              aria-selected={tab === item.id}
              variant={tab === item.id ? "primary" : "secondary"}
              icon={item.icon}
              onClick={() => {
                saveNote();
                setTab(item.id);
              }}
            >
              {item.label}
            </Button>
          ))}
        </div>

        <div
          key={tab}
          data-controller-scroll
          className="grid min-h-0 content-start gap-5 overflow-y-auto [scrollbar-gutter:stable]"
        >
          {tab !== "organize" ? (
            <>
              <label className="grid gap-2 text-sm text-text-muted">
                {tab === "note" ? "Note for" : "Playthrough"}
                <select
                  aria-label="Journal playthrough"
                  value={selected ?? ""}
                  className={journalSelectClass}
                  onChange={(event) => select(event.target.value || null)}
                >
                  <option value="">
                    {DEFAULT_PLAYTHROUGH_NAME}
                    {journal.activePlaythroughId === null ? " · Active" : ""}
                  </option>
                  {journal.playthroughs.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {p.id === journal.activePlaythroughId ? " · Active" : ""}
                      {p.completedAt ? " · Finished" : ""}
                    </option>
                  ))}
                </select>
              </label>
              {tab === "note" ? (
                <div className="grid gap-3">
                  <textarea
                    aria-label="Game note"
                    data-autofocus
                    rows={7}
                    maxLength={Math.max(NOTE_LIMIT, storedNote.length)}
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    placeholder="Where did you leave off? What would you like to do next time?"
                    className="w-full resize-y rounded-xl border border-border bg-bg p-4 text-sm leading-relaxed text-text outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
                  />
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs text-text-faint">
                      {draft.length.toLocaleString()} /{" "}
                      {Math.max(NOTE_LIMIT, storedNote.length).toLocaleString()}
                    </span>
                    <Button
                      icon={Check}
                      variant="secondary"
                      onClick={saveNote}
                      disabled={draft === storedNote}
                    >
                      Save note
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="grid gap-4">
                  <form
                    className="flex gap-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      create();
                    }}
                  >
                    <Input
                      aria-label="New playthrough name"
                      maxLength={NAME_LIMIT}
                      value={name}
                      placeholder="New Game+, co-op campaign, 2026 replay…"
                      className="flex-1"
                      onChange={(event) => setName(event.target.value)}
                    />
                    <Button
                      type="submit"
                      variant="secondary"
                      icon={Plus}
                      disabled={!name.trim()}
                    >
                      Create
                    </Button>
                  </form>
                  <div className="rounded-lg border border-border bg-bg p-3 text-sm text-text-muted">
                    <span className="font-medium text-text">
                      Next session: {playthroughName(journal)}
                    </span>
                    <p className="mt-1 text-xs">
                      New playthroughs become active for future sessions.
                      Earlier sessions stay in their current playthrough.
                    </p>
                    {running.map((s) => (
                      <div key={s.id} className="mt-3">
                        <SessionPlaythroughSelect session={s} />
                      </div>
                    ))}
                  </div>
                  {playthrough ? (
                    <section className="grid gap-3 rounded-xl border border-border p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <Input
                          key={`${playthrough.id}:${playthrough.name}`}
                          aria-label="Playthrough name"
                          maxLength={NAME_LIMIT}
                          defaultValue={playthrough.name}
                          onBlur={(event) => {
                            if (event.target.value.trim())
                              actions
                                .getState()
                                .updatePlaythrough(
                                  target.game,
                                  playthrough.id,
                                  {
                                    name: event.target.value,
                                  },
                                );
                            else event.target.value = playthrough.name;
                          }}
                        />
                        <span className="font-mono text-lg font-semibold text-accent">
                          {formatDuration(selectedSeconds, showDays)}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="secondary"
                          icon={Check}
                          disabled={
                            !!playthrough.completedAt ||
                            journal.activePlaythroughId === playthrough.id
                          }
                          onClick={() =>
                            actions
                              .getState()
                              .setActivePlaythrough(target.game, playthrough.id)
                          }
                        >
                          {journal.activePlaythroughId === playthrough.id
                            ? "Active playthrough"
                            : "Make active"}
                        </Button>
                        {journal.activePlaythroughId === playthrough.id ? (
                          <Button
                            variant="ghost"
                            onClick={() => {
                              actions
                                .getState()
                                .setActivePlaythrough(target.game, null);
                              select(null);
                            }}
                          >
                            Use default
                          </Button>
                        ) : null}
                        <Button
                          variant="secondary"
                          icon={Flag}
                          onClick={() =>
                            actions
                              .getState()
                              .updatePlaythrough(target.game, playthrough.id, {
                                completedAt: playthrough.completedAt
                                  ? null
                                  : new Date().toISOString(),
                              })
                          }
                        >
                          {playthrough.completedAt ? "Reopen" : "Mark finished"}
                        </Button>
                        <Button
                          variant="ghost"
                          icon={StickyNote}
                          onClick={() => setTab("note")}
                        >
                          {playthrough.note ? "Edit note" : "Add note"}
                        </Button>
                        <Button
                          variant="ghost"
                          icon={Trash2}
                          aria-label="Delete playthrough"
                          onClick={() => setDeleting(playthrough.id)}
                        />
                      </div>
                      {playthrough.completedAt ? (
                        <label className="flex items-center gap-3 text-sm text-text-muted">
                          Finished on
                          <Input
                            type="date"
                            aria-label="Playthrough completion date"
                            value={playthrough.completedAt.slice(0, 10)}
                            onChange={(event) => {
                              if (event.target.value)
                                actions
                                  .getState()
                                  .updatePlaythrough(
                                    target.game,
                                    playthrough.id,
                                    {
                                      completedAt: `${event.target.value}T12:00:00.000Z`,
                                    },
                                  );
                            }}
                          />
                        </label>
                      ) : null}
                      {deleting === playthrough.id ? (
                        <div className="rounded-lg border border-warning-border bg-warning-tint p-3 text-sm text-text">
                          Delete “{playthrough.name}” and its note? Its sessions
                          return to the default playthrough and all game
                          playtime is kept.
                          <div className="mt-3 flex gap-2">
                            <Button
                              variant="danger"
                              onClick={() => {
                                actions
                                  .getState()
                                  .deletePlaythrough(
                                    target.game,
                                    playthrough.id,
                                  );
                                setSelected(null);
                                setDeleting(null);
                              }}
                            >
                              Delete playthrough
                            </Button>
                            <Button
                              variant="secondary"
                              onClick={() => setDeleting(null)}
                            >
                              Cancel
                            </Button>
                          </div>
                        </div>
                      ) : null}
                    </section>
                  ) : (
                    <section className="grid gap-3 rounded-xl border border-border p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <h3 className="text-sm font-semibold text-text">
                          {DEFAULT_PLAYTHROUGH_NAME}
                        </h3>
                        <span className="font-mono text-lg font-semibold text-accent">
                          {formatDuration(selectedSeconds, showDays)}
                        </span>
                      </div>
                      <p className="text-xs text-text-muted">
                        Your standard playthrough. Create another for a replay
                        or a different campaign.
                      </p>
                      {hasGameWideTime ? (
                        <p className="text-xs text-text-muted">
                          Imported lifetime playtime and game-wide adjustments
                          stay in the game's overall total.
                        </p>
                      ) : null}
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="secondary"
                          icon={Check}
                          disabled={journal.activePlaythroughId === null}
                          onClick={() =>
                            actions
                              .getState()
                              .setActivePlaythrough(target.game, null)
                          }
                        >
                          {journal.activePlaythroughId === null
                            ? "Active playthrough"
                            : "Make active"}
                        </Button>
                        <Button
                          variant="ghost"
                          icon={StickyNote}
                          onClick={() => setTab("note")}
                        >
                          {journal.note ? "Edit note" : "Add note"}
                        </Button>
                      </div>
                    </section>
                  )}
                  <section className="grid gap-2">
                    <h3 className="text-sm font-semibold text-text">
                      Recorded sessions · {selectedSessions.length}
                    </h3>
                    {selectedArchivedSeconds > 0 ? (
                      <p className="text-xs text-text-muted">
                        Total includes{" "}
                        {formatDuration(selectedArchivedSeconds, showDays)} from
                        archived sessions.
                      </p>
                    ) : null}
                    <div className="max-h-64 overflow-y-auto divide-y divide-border">
                      {selectedSessions.map((s) => (
                        <div
                          key={s.id}
                          className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm text-text-muted"
                        >
                          <span>
                            {new Date(s.startedAt).toLocaleDateString()} ·{" "}
                            {formatDuration(s.durationSeconds ?? 0, showDays)}
                          </span>
                          <SessionPlaythroughSelect session={s} compact />
                        </div>
                      ))}
                      {!selectedSessions.length ? (
                        <p className="py-2 text-sm text-text-faint">
                          No recorded sessions here yet.
                        </p>
                      ) : null}
                    </div>
                  </section>
                </div>
              )}
            </>
          ) : (
            <div className="grid gap-5">
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  icon={Star}
                  variant={journal.favorite ? "primary" : "secondary"}
                  aria-pressed={journal.favorite}
                  onClick={() =>
                    actions.getState().updateGameJournal(target.game, {
                      favorite: !journal.favorite,
                    })
                  }
                >
                  {journal.favorite ? "Favorite" : "Add to Favorites"}
                </Button>
                <select
                  aria-label="Game status"
                  value={journal.status ?? ""}
                  className={journalSelectClass}
                  onChange={(event) =>
                    actions.getState().updateGameJournal(target.game, {
                      status: (event.target.value || null) as GameStatus | null,
                    })
                  }
                >
                  <option value="">No status</option>
                  {Object.entries(GAME_STATUSES).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <fieldset className="grid gap-2">
                <legend className="mb-3 text-sm font-semibold text-text">
                  Shelves
                </legend>
                {shelves
                  .filter((s) => !s.filters)
                  .map((s) => (
                    <label
                      key={s.id}
                      className="flex items-center gap-3 rounded-lg border border-border p-3 text-sm text-text"
                    >
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-accent"
                        checked={journal.shelfIds.includes(s.id)}
                        onChange={(event) =>
                          actions.getState().updateGameJournal(target.game, {
                            shelfIds: event.target.checked
                              ? [...journal.shelfIds, s.id]
                              : journal.shelfIds.filter((id) => id !== s.id),
                          })
                        }
                      />
                      {s.name}
                    </label>
                  ))}
                {!shelves.some((s) => !s.filters) ? (
                  <p className="text-sm text-text-muted">
                    Create a shelf to group games. A game can belong to several
                    shelves.
                  </p>
                ) : null}
              </fieldset>
              <form
                className="flex gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  const id = actions
                    .getState()
                    .savePersonalShelf({ name: shelfName, pinned: false });
                  if (id) {
                    actions.getState().updateGameJournal(target.game, {
                      shelfIds: [...journal.shelfIds, id],
                    });
                    setShelfName("");
                  }
                }}
              >
                <Input
                  aria-label="New shelf name"
                  maxLength={NAME_LIMIT}
                  value={shelfName}
                  onChange={(event) => setShelfName(event.target.value)}
                  placeholder="New shelf…"
                  className="flex-1"
                />
                <Button
                  type="submit"
                  variant="secondary"
                  icon={Plus}
                  disabled={!shelfName.trim()}
                >
                  Create & add
                </Button>
              </form>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
