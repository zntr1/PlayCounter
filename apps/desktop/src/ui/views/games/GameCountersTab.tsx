import { ChevronDown, Keyboard, Pencil, Plus, Tally5, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import {
  COUNTER_NAME_LIMIT,
  controllerCounterId,
  counterName,
  counterTallies,
  gameArchivedCounts,
  orderedCounters,
  type GameCounter,
} from "../../../counters";
import { formatHotkey } from "../../../hotkeyFormat";
import { appLocale, getT } from "../../../i18n";
import { defaultPlaythroughName } from "../../../personalLibrary";
import { playedSeconds } from "../../../sessionTime";
import { openKeyboardShortcuts } from "../../openSettings";
import { personalGameIdentity, type GameIdentityRef } from "../../../store";
import {
  AddCounterField,
  CounterControllerButton,
  CounterEyeButton,
  CounterIcon,
  CounterKeyButton,
  useControllerCounting,
} from "../../counters/CounterParts";
import {
  usePersonalLibraryApi,
  usePersonalLibraryState,
} from "../../PersonalLibraryContext";
import { Button, Modal } from "../../primitives";
import { useGameJournal } from "../../useGameJournal";
import type { GameSummary } from "../MyGamesView";
import { Panel } from "./detailsPanels";

const t = getT("games");

/* Game Details → Counters (docs/counters-plan.md): every counter of the game
   with its numbers for one playthrough and all of them. Here the player
   renames, deletes, adds, picks what shows while playing (eye) and gives a
   counter its own key (keyboard). Below: how to take a press back. */

export function GameCountersTab({ game }: { game: GameSummary }) {
  const api = usePersonalLibraryApi();
  const gameRef = useMemo(
    () => ({
      gameId: game.gameId,
      source: game.source,
      igdbId: game.igdbId,
      gameName: game.name,
      coverUrl: game.coverUrl,
    }),
    [game.gameId, game.source, game.igdbId, game.name, game.coverUrl],
  );
  const journal = useGameJournal(gameRef);
  const recentSessions = usePersonalLibraryState((s) => s.recentSessions);
  const activeSessions = usePersonalLibraryState((s) => s.activeSessions);
  const archivedCounts = usePersonalLibraryState((s) => s.archivedCounts);
  const [playthroughId, setPlaythroughId] = useState<string | null>(
    journal.activePlaythroughId,
  );
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<GameCounter | null>(null);

  const identity = personalGameIdentity(api.getState());
  const gameKey = identity(gameRef);
  const sessions = useMemo(
    () =>
      [...recentSessions, ...activeSessions].filter(
        (session) => identity(session) === gameKey,
      ),
    [recentSessions, activeSessions, identity, gameKey],
  );
  const tallies = useMemo(
    () =>
      counterTallies({
        sessions,
        archived: gameArchivedCounts(archivedCounts, gameRef, identity),
        playthroughId,
      }),
    [sessions, archivedCounts, gameRef, identity, playthroughId],
  );
  const counters = orderedCounters(journal);
  const controllerCounting = useControllerCounting();
  const controller = controllerCounterId(journal);
  const undoKey = usePersonalLibraryState(
    (s) => s.settings.counterUndoHotkey ?? null,
  );
  const now = Date.now();

  /** Counts per hour in this playthrough's sessions that counted it. */
  const perHour = (counterId: string) => {
    let count = 0;
    let seconds = 0;
    for (const session of sessions) {
      const value = session.counts?.[counterId] ?? 0;
      if (!value || (session.playthroughId ?? null) !== playthroughId)
        continue;
      count += value;
      seconds +=
        "durationSeconds" in session && session.durationSeconds !== null
          ? session.durationSeconds
          : "checkpointedAt" in session
            ? playedSeconds(session, now)
            : 0;
    }
    if (seconds < 60) return "–";
    const rate = count / (seconds / 3600);
    return rate.toLocaleString(appLocale(), {
      maximumFractionDigits: rate < 1 ? 2 : 1,
    });
  };

  const playthroughs = [
    { id: null as string | null, name: defaultPlaythroughName() },
    ...journal.playthroughs.map((p) => ({ id: p.id as string | null, name: p.name })),
  ];
  const anyCounted = [...tallies.values()].some((tally) => tally.all > 0);

  return (
    <div className="grid gap-4 p-6">
      <Panel
        title={t("Counters")}
        icon={Tally5}
        action={
          <div className="flex items-center gap-2">
            {playthroughs.length > 1 ? (
              <label className="relative">
                <span className="sr-only">{t("Playthrough")}</span>
                <select
                  value={playthroughId ?? ""}
                  onChange={(event) =>
                    setPlaythroughId(event.target.value || null)
                  }
                  className="h-8 appearance-none rounded-lg border border-border bg-surface pl-3 pr-8 text-xs font-medium text-text"
                >
                  {playthroughs.map((p) => (
                    <option key={p.id ?? ""} value={p.id ?? ""}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  size={13}
                  aria-hidden
                  className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-text-faint"
                />
              </label>
            ) : null}
            <Button icon={Plus} onClick={() => setAdding(true)}>
              {t("Add counter")}
            </Button>
          </div>
        }
      >
        {adding ? (
          <AddCounterField
            game={gameRef}
            onDone={() => setAdding(false)}
            className="mb-3"
          />
        ) : null}
        {counters.length === 0 ? (
          <p className="text-sm italic text-text-faint">
            {t("No counters. Add one to count deaths, tries or anything else.")}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-right">
              <thead>
                <tr className="text-[11px] font-medium text-text-faint">
                  <th className="px-2 py-1.5 text-left font-medium">
                    {t("Counter")}
                  </th>
                  <th className="whitespace-nowrap px-2 py-1.5 font-medium">
                    {t("This playthrough")}
                  </th>
                  <th className="whitespace-nowrap px-2 py-1.5 font-medium">
                    {t("All playthroughs")}
                  </th>
                  <th className="whitespace-nowrap px-2 py-1.5 font-medium">
                    {t("Per hour played")}
                  </th>
                  <th className="whitespace-nowrap px-2 py-1.5 font-medium">
                    {t("Most in one session")}
                  </th>
                  <th className="px-2 py-1.5">
                    <span className="sr-only">{t("Actions")}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {counters.map((counter) => {
                  const tally = tallies.get(counter.id);
                  return (
                    <tr
                      key={counter.id}
                      className="border-t border-border/50 font-mono text-sm font-semibold tabular-nums text-text"
                    >
                      <td className="w-full px-2 py-2 text-left font-sans">
                        <CounterNameCell game={gameRef} counter={counter} />
                      </td>
                      <td className="px-2 py-2">{tally?.playthrough ?? 0}</td>
                      <td className="px-2 py-2">{tally?.all ?? 0}</td>
                      <td className="px-2 py-2">{perHour(counter.id)}</td>
                      <td className="whitespace-nowrap px-2 py-2">
                        {tally?.best ? (
                          <>
                            {tally.best.count}{" "}
                            <small className="font-sans text-[11px] font-medium text-text-faint">
                              {new Date(tally.best.startedAt).toLocaleDateString(
                                appLocale(),
                                { day: "numeric", month: "short" },
                              )}
                            </small>
                          </>
                        ) : (
                          "–"
                        )}
                      </td>
                      <td className="py-2 pl-1 pr-0">
                        <div className="flex items-center justify-end gap-0.5">
                          <CounterKeyButton game={gameRef} counter={counter} />
                          <CounterEyeButton game={gameRef} counter={counter} />
                          {controllerCounting ? (
                            <CounterControllerButton
                              game={gameRef}
                              counter={counter}
                              active={counter.id === controller}
                            />
                          ) : null}
                          <button
                            type="button"
                            title={t("Delete counter")}
                            aria-label={t("Delete {{counter}}", {
                              counter: counterName(counter),
                            })}
                            onClick={() => setDeleting(counter)}
                            className="grid h-7 w-7 place-items-center rounded-lg text-text-muted transition hover:bg-surface-hover hover:text-danger"
                          >
                            <Trash2 size={14} aria-hidden />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {counters.length > 0 && !anyCounted ? (
          <p className="mt-2 text-sm italic text-text-faint">
            {t(
              "Nothing counted yet. Give a counter a key with the keyboard, or use the + on Now Playing.",
            )}
          </p>
        ) : null}
        <p className="mt-3 text-xs text-text-faint">
          {t(
            "The eye shows a counter while you play. The keyboard gives a counter its own key, which counts it while the game runs.",
          )}
          {controllerCounting
            ? ` ${t("The controller icon picks the one counter View + D-pad up counts.")}`
            : null}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-xs text-text-muted">
          <Keyboard size={14} aria-hidden className="text-accent-ink" />
          <span className="min-w-0 flex-1">
            {undoKey
              ? t("Pressed a key by mistake? {{key}} takes the last one back.", {
                  key: formatHotkey(undoKey),
                })
              : t(
                  "Pressed a key by mistake? Set a key for “Take one back” to undo it.",
                )}
          </span>
          <button
            type="button"
            onClick={openKeyboardShortcuts}
            className="rounded-md px-2 py-1 font-semibold text-accent-ink hover:bg-surface-hover"
          >
            {t("Keyboard shortcuts")}
          </button>
        </div>
      </Panel>
      {deleting ? (
        <DeleteCounterDialog
          counter={deleting}
          total={tallies.get(deleting.id)?.all ?? 0}
          onCancel={() => setDeleting(null)}
          onDelete={() => {
            api.getState().deleteGameCounter(gameRef, deleting.id);
            setDeleting(null);
          }}
        />
      ) : null}
    </div>
  );
}

function CounterNameCell({
  game,
  counter,
}: {
  game: GameIdentityRef;
  counter: GameCounter;
}) {
  const update = usePersonalLibraryState((s) => s.updateGameCounter);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(counterName(counter));
  const [taken, setTaken] = useState(false);
  const save = () => {
    if (!name.trim() || name.trim() === counterName(counter)) {
      setEditing(false);
      return;
    }
    if (update(game, counter.id, { name })) setEditing(false);
    else setTaken(true);
  };
  if (editing)
    return (
      <div className="grid gap-1">
        <input
          autoFocus
          value={name}
          maxLength={COUNTER_NAME_LIMIT}
          aria-label={t("Counter name")}
          onChange={(event) => {
            setName(event.target.value);
            setTaken(false);
          }}
          onBlur={save}
          onKeyDown={(event) => {
            if (event.key === "Enter") save();
            else if (event.key === "Escape") {
              event.stopPropagation();
              setName(counterName(counter));
              setEditing(false);
            }
          }}
          className="h-8 w-full rounded-lg border border-accent bg-bg px-2 text-sm font-semibold text-text outline-none"
        />
        {taken ? (
          <span role="status" className="text-xs font-medium text-danger">
            {t("A counter with this name already exists.")}
          </span>
        ) : null}
      </div>
    );
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-surface-hover text-text/80">
        <CounterIcon counter={counter} />
      </span>
      <span className="truncate text-sm font-semibold">
        {counterName(counter)}
      </span>
      <button
        type="button"
        title={t("Rename")}
        aria-label={t("Rename {{counter}}", { counter: counterName(counter) })}
        onClick={() => {
          setName(counterName(counter));
          setEditing(true);
        }}
        className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-text-faint transition hover:bg-surface-hover hover:text-text"
      >
        <Pencil size={12} aria-hidden />
      </button>
    </div>
  );
}

function DeleteCounterDialog({
  counter,
  total,
  onCancel,
  onDelete,
}: {
  counter: GameCounter;
  total: number;
  onCancel: () => void;
  onDelete: () => void;
}) {
  return (
    <Modal
      size="sm"
      labelId="delete-counter-title"
      title={t("Delete {{counter}}?", { counter: counterName(counter) })}
      icon={Trash2}
      onClose={onCancel}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            {t("Cancel")}
          </Button>
          <Button variant="danger" onClick={onDelete}>
            {t("Delete counter")}
          </Button>
        </>
      }
    >
      <p className="text-sm text-text-muted">
        {t("This removes {{count}} counts from this game's sessions.", {
          count: total,
        })}
      </p>
    </Modal>
  );
}
