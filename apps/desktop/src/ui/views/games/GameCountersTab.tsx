import {
  ChevronDown,
  EyeOff,
  Keyboard,
  Pencil,
  Plus,
  Tally5,
  Trash2,
} from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Trans } from "react-i18next";
import {
  COUNTER_NAME_LIMIT,
  controllerCounterId,
  counterName,
  counterTallies,
  gameArchivedCounts,
  lastSessionCounts,
  orderedCounters,
  type CounterTally,
  type GameCounter,
} from "../../../counters";
import { formatHotkey } from "../../../hotkeyFormat";
import { appLocale, getT } from "../../../i18n";
import { defaultPlaythroughName } from "../../../personalLibrary";
import { playedSeconds } from "../../../sessionTime";
import { openKeyboardShortcuts } from "../../openSettings";
import { personalGameIdentity, type GameIdentityRef } from "../../../store";
import { cn } from "../../cn";
import {
  AddCounterField,
  CounterIcon,
  useControllerCounting,
  useCounterKeyRecorder,
} from "../../counters/CounterParts";
import {
  usePersonalLibraryApi,
  usePersonalLibraryState,
} from "../../PersonalLibraryContext";
import { Button, Modal, Switch } from "../../primitives";
import { useGameJournal } from "../../useGameJournal";
import type { GameSummary } from "../MyGamesView";
import { Panel } from "./detailsPanels";

const t = getT("games");

/* Game Details → Counters (docs/counters-plan.md; layout B of
   docs/counters-details-mockups.html): the game's counters on the left, the
   picked one on the right with its numbers, its last sessions and what it
   does while you play (shown, own key, controller). Below: how to take a
   press back. */

const KEY_CAP =
  "rounded border border-b-2 border-border bg-surface px-1.5 py-px font-mono text-[11px] font-semibold text-text/90";
/** How many sessions the chart shows. */
const CHART_SESSIONS = 12;

function shortDate(value: string) {
  return new Date(value).toLocaleDateString(appLocale(), {
    day: "numeric",
    month: "short",
  });
}

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
  // The first counter to start with; it stays picked when hiding it moves it
  // down the list.
  const [selectedId, setSelectedId] = useState<string | null>(
    () => orderedCounters(journal)[0]?.id ?? null,
  );

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
  const shown = counters.filter((counter) => counter.shown);
  const hidden = counters.filter((counter) => !counter.shown);
  const selected =
    counters.find((counter) => counter.id === selectedId) ?? counters[0];
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

  const row = (counter: GameCounter) => (
    <button
      key={counter.id}
      type="button"
      role="option"
      aria-selected={counter.id === selected?.id}
      onClick={() => setSelectedId(counter.id)}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-[10px] border border-transparent px-2.5 py-[7px] text-left transition hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
        counter.id === selected?.id &&
          "border-accent/60 bg-accent/10 hover:bg-accent/10",
      )}
    >
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-surface-hover text-text/80">
        <CounterIcon counter={counter} />
      </span>
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-[13.5px] font-semibold",
          !counter.shown && "text-text-faint",
        )}
      >
        {counterName(counter)}
      </span>
      {counter.shown ? null : (
        <EyeOff size={13} aria-hidden className="shrink-0 text-text-faint" />
      )}
      <span
        className={cn(
          "font-mono text-sm font-bold tabular-nums",
          !counter.shown && "text-text-faint",
        )}
      >
        {tallies.get(counter.id)?.playthrough ?? 0}
      </span>
    </button>
  );

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
            onAdded={setSelectedId}
            onDone={() => setAdding(false)}
            className="mb-3"
          />
        ) : null}
        {selected ? (
          <div className="grid items-start gap-4 md:grid-cols-[260px_minmax(0,1fr)]">
            <div
              role="listbox"
              aria-label={t("Counters")}
              className="grid max-h-[470px] content-start gap-1 overflow-y-auto pr-1"
            >
              {shown.map(row)}
              {hidden.length > 0 ? (
                <div className="mx-1 mb-1 mt-2.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-text-faint after:h-px after:flex-1 after:bg-border/60">
                  {t("Hidden · {{number}}", { number: hidden.length })}
                </div>
              ) : null}
              {hidden.map(row)}
            </div>
            <CounterDetail
              // Another counter starts with its own name field and key state.
              key={selected.id}
              game={gameRef}
              gameName={game.name}
              counter={selected}
              tally={tallies.get(selected.id)}
              perHour={perHour(selected.id)}
              series={lastSessionCounts(
                sessions,
                selected.id,
                playthroughId,
                CHART_SESSIONS,
              )}
              controllerCounting={controllerCounting}
              controller={selected.id === controller}
              onDelete={() => setDeleting(selected)}
            />
          </div>
        ) : (
          <p className="text-sm italic text-text-faint">
            {t("No counters. Add one to count deaths, tries or anything else.")}
          </p>
        )}
        <div
          data-undo-line
          className="mx-0.5 mt-3.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-faint"
        >
          <Keyboard size={13} aria-hidden />
          <span>
            {undoKey ? (
              <Trans
                t={t}
                i18nKey="Pressed a key by mistake? <kbd>{{key}}</kbd> takes the last one back."
                values={{ key: formatHotkey(undoKey) }}
                components={{ kbd: <kbd className={KEY_CAP} /> }}
              />
            ) : (
              t(
                "Pressed a key by mistake? Set a key for “Take one back” to undo it.",
              )
            )}
          </span>
          <button
            type="button"
            onClick={openKeyboardShortcuts}
            className="rounded-md px-1 font-semibold text-accent-ink hover:underline"
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

/** Everything about the picked counter. */
function CounterDetail({
  game,
  gameName,
  counter,
  tally,
  perHour,
  series,
  controllerCounting,
  controller,
  onDelete,
}: {
  game: GameIdentityRef;
  gameName: string;
  counter: GameCounter;
  tally: CounterTally | undefined;
  perHour: string;
  series: ReturnType<typeof lastSessionCounts>;
  controllerCounting: boolean;
  /** View + D-pad up counts this one. */
  controller: boolean;
  onDelete: () => void;
}) {
  const update = usePersonalLibraryState((s) => s.updateGameCounter);
  const setControllerCounter = usePersonalLibraryState(
    (s) => s.setControllerCounter,
  );
  const [editing, setEditing] = useState(false);
  const name = counterName(counter);
  const most = Math.max(0, ...series.map((session) => session.count));

  return (
    <section
      data-counter-detail
      aria-label={name}
      className="min-w-0 rounded-xl border border-border bg-surface p-4"
    >
      <div className="flex min-h-9 items-center gap-2.5">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-surface-hover text-text/80">
          <CounterIcon counter={counter} />
        </span>
        {editing ? (
          <CounterNameField
            game={game}
            counter={counter}
            onDone={() => setEditing(false)}
          />
        ) : (
          <>
            <h4 className="min-w-0 flex-1 truncate text-lg font-bold text-text">
              {name}
            </h4>
            <Button
              variant="ghost"
              icon={Pencil}
              aria-label={t("Rename {{counter}}", { counter: name })}
              onClick={() => setEditing(true)}
              className="px-2.5 py-1.5 text-[12.5px] font-semibold"
            >
              {t("Rename")}
            </Button>
            <Button
              variant="ghost"
              icon={Trash2}
              aria-label={t("Delete {{counter}}", { counter: name })}
              onClick={onDelete}
              className="px-2.5 py-1.5 text-[12.5px] font-semibold hover:text-danger"
            >
              {t("Delete")}
            </Button>
          </>
        )}
      </div>

      <div className="mt-3.5 grid grid-cols-2 gap-2 lg:grid-cols-4">
        <CounterFigure label={t("This playthrough")} lead>
          {tally?.playthrough ?? 0}
        </CounterFigure>
        <CounterFigure label={t("All playthroughs")}>
          {tally?.all ?? 0}
        </CounterFigure>
        <CounterFigure label={t("Per hour played")}>{perHour}</CounterFigure>
        <CounterFigure label={t("Most in one session")}>
          {tally?.best ? (
            <>
              {tally.best.count}{" "}
              <small className="font-sans text-[11px] font-medium text-text-faint">
                {shortDate(tally.best.startedAt)}
              </small>
            </>
          ) : (
            "–"
          )}
        </CounterFigure>
      </div>

      {series.length > 0 ? (
        <>
          <SubHeading>
            {t("Last {{count}} sessions", { count: series.length })}
          </SubHeading>
          <ol className="flex h-24 items-end gap-1.5 px-0.5">
            {series.map((session) => {
              const isMost = session.count > 0 && session.count === most;
              return (
                <li
                  key={session.id}
                  data-session-bar={session.count}
                  data-most={isMost ? "" : undefined}
                  title={`${shortDate(session.startedAt)}: ${session.count}`}
                  className="flex h-full min-w-0 max-w-[34px] flex-1 flex-col items-center justify-end gap-1"
                >
                  <span
                    className={cn(
                      "font-mono text-[10.5px] font-semibold tabular-nums",
                      isMost ? "text-accent-ink" : "text-text-muted",
                    )}
                  >
                    {session.count > 0 ? session.count : null}
                  </span>
                  <span
                    className={cn(
                      "w-full rounded-t-[3px]",
                      session.count === 0
                        ? "bg-border"
                        : isMost
                          ? "bg-accent"
                          : "bg-accent/35",
                    )}
                    style={{
                      height:
                        session.count > 0
                          ? Math.max(4, Math.round((session.count / most) * 70))
                          : 2,
                    }}
                  />
                </li>
              );
            })}
          </ol>
          <div className="mt-1.5 flex justify-between text-[11px] text-text-faint">
            <span>{shortDate(series[0].startedAt)}</span>
            {series.length > 1 ? (
              <span>{shortDate(series[series.length - 1].startedAt)}</span>
            ) : null}
          </div>
        </>
      ) : null}

      <SubHeading>{t("While you play")}</SubHeading>
      <SettingRow title={t("Show in the live timer and on Now Playing")}>
        <Switch
          aria-label={t("Show in the live timer and on Now Playing")}
          checked={counter.shown}
          onChange={(event) =>
            update(game, counter.id, { shown: event.target.checked })
          }
        />
      </SettingRow>
      <OwnKeyRow game={game} gameName={gameName} counter={counter} />
      {controllerCounting ? (
        <SettingRow
          title={t("Count with View + D-pad up")}
          description={t("One counter per game.")}
        >
          <Switch
            aria-label={t("Count with View + D-pad up")}
            checked={controller}
            onChange={(event) =>
              setControllerCounter(game, event.target.checked ? counter.id : null)
            }
          />
        </SettingRow>
      ) : null}
    </section>
  );
}

function CounterFigure({
  label,
  lead = false,
  children,
}: {
  label: string;
  /** The number the tab is about. */
  lead?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      data-figure
      className="min-w-0 rounded-lg border border-border bg-bg px-3 py-2.5"
    >
      <div className="truncate text-[11px] font-medium text-text-faint">
        {label}
      </div>
      <div
        className={cn(
          "mt-0.5 whitespace-nowrap font-mono text-xl font-bold tabular-nums",
          lead ? "text-accent-ink" : "text-text",
        )}
      >
        {children}
      </div>
    </div>
  );
}

function SubHeading({ children }: { children: ReactNode }) {
  return (
    <div className="mb-2 mt-[18px] text-[11px] font-semibold uppercase tracking-[0.12em] text-text-faint">
      {children}
    </div>
  );
}

function SettingRow({
  title,
  description,
  children,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border/60 py-2.5 first-of-type:border-t-0">
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold text-text">{title}</div>
        {description ? (
          <div className="text-xs text-text-faint">{description}</div>
        ) : null}
      </div>
      {children}
    </div>
  );
}

/** The counter's own key: Set a key, press it; then Change or Remove. */
function OwnKeyRow({
  game,
  gameName,
  counter,
}: {
  game: GameIdentityRef;
  gameName: string;
  counter: GameCounter;
}) {
  const { recording, recordingLabel, error, remove, buttonProps } =
    useCounterKeyRecorder(game, counter);
  const keyLabel = counter.key ? formatHotkey(counter.key) : null;
  return (
    <SettingRow
      title={t("Own key")}
      description={
        <>
          {t("Counts {{counter}} while {{game}} runs.", {
            counter: counterName(counter),
            game: gameName,
          })}
          {error ? (
            <span role="status" className="block font-medium text-danger">
              {error}
            </span>
          ) : null}
        </>
      }
    >
      {keyLabel && !recording ? (
        <kbd className={KEY_CAP}>{keyLabel}</kbd>
      ) : null}
      {/* One button through every state, so it keeps the focus that hears
          the key. */}
      <Button
        key="record"
        variant={recording ? "active" : "secondary"}
        icon={keyLabel || recording ? undefined : Keyboard}
        {...buttonProps}
        className="px-2.5 py-1.5 text-[12.5px] font-semibold"
      >
        {recording
          ? recordingLabel
          : keyLabel
            ? t("Change")
            : t("Set a key")}
      </Button>
      {keyLabel && !recording ? (
        <Button
          variant="ghost"
          onClick={remove}
          className="px-2.5 py-1.5 text-[12.5px] font-semibold"
        >
          {t("Remove")}
        </Button>
      ) : null}
    </SettingRow>
  );
}

/** The name as a text field: Enter or leaving saves, Esc gives up. */
function CounterNameField({
  game,
  counter,
  onDone,
}: {
  game: GameIdentityRef;
  counter: GameCounter;
  onDone: () => void;
}) {
  const update = usePersonalLibraryState((s) => s.updateGameCounter);
  const [name, setName] = useState(counterName(counter));
  const [taken, setTaken] = useState(false);
  const save = () => {
    if (!name.trim() || name.trim() === counterName(counter)) {
      onDone();
      return;
    }
    if (update(game, counter.id, { name })) onDone();
    else setTaken(true);
  };
  return (
    <div className="grid min-w-0 flex-1 gap-1">
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
            onDone();
          }
        }}
        className="h-9 w-full rounded-lg border border-accent bg-bg px-2.5 text-base font-semibold text-text outline-none"
      />
      {taken ? (
        <span role="status" className="text-xs font-medium text-danger">
          {t("A counter with this name already exists.")}
        </span>
      ) : null}
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
