import clsx from "clsx";
import { cn } from "../cn";
import {
  Eye,
  EyeOff,
  Gamepad2,
  Keyboard,
  Minus,
  Plus,
  Skull,
  Tally5,
  X,
} from "lucide-react";
import { useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { Trans } from "react-i18next";
import {
  COUNTER_NAME_LIMIT,
  DEATHS_COUNTER_ID,
  controllerCounterId,
  counterName,
  orderedCounters,
  type CounterTally,
  type GameCounter,
} from "../../counters";
import {
  counterKeyConflict,
  sessionTallies,
  useCounterKeyStatus,
} from "../../counterInput";
import { formatHotkey } from "../../hotkeyFormat";
import { getT } from "../../i18n";
import { shortcutFromKey } from "../../shortcutKeys";
import {
  useAppStore,
  type ActiveSession,
  type GameIdentityRef,
} from "../../store";
import {
  PersonalLibraryContext,
  usePersonalLibraryApi,
  usePersonalLibraryState,
} from "../PersonalLibraryContext";
import { completeTourStep, tourCounters } from "../tour/tourDemoDetails";
import { TOUR_DEMO_GAME } from "../tour/tourDemoGame";
import { useGameJournal } from "../useGameJournal";

const t = getT("nowPlaying");

/* Pieces every counter view shares (docs/counters-plan.md): the icon, the
   eye (shown while you play), the keyboard (the counter's own key), − / +,
   and the field that adds a counter. */

export function CounterIcon({
  counter,
  size = 14,
}: {
  counter: Pick<GameCounter, "id">;
  size?: number;
}) {
  return counter.id === DEATHS_COUNTER_ID ? (
    <Skull size={size} aria-hidden />
  ) : (
    <Tally5 size={size} aria-hidden />
  );
}

export function CounterEyeButton({
  game,
  counter,
}: {
  game: GameIdentityRef;
  counter: GameCounter;
}) {
  const update = usePersonalLibraryState((s) => s.updateGameCounter);
  const label = counter.shown
    ? t("Shown while you play. Click to hide.")
    : t("Hidden while you play. Click to show.");
  return (
    <button
      type="button"
      title={label}
      aria-label={`${counterName(counter)}: ${label}`}
      aria-pressed={counter.shown}
      onClick={() => update(game, counter.id, { shown: !counter.shown })}
      className={clsx(
        "grid h-7 w-7 shrink-0 place-items-center rounded-lg transition hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
        counter.shown ? "text-accent-ink" : "text-text-faint",
      )}
    >
      {counter.shown ? (
        <Eye size={15} aria-hidden />
      ) : (
        <EyeOff size={15} aria-hidden />
      )}
    </button>
  );
}

/** Whether counters show their controller icon: only with "Count with
 *  controller" on in Settings. */
export function useControllerCounting() {
  return usePersonalLibraryState(
    (s) => s.settings.controllerCountingEnabled === true,
  );
}

/** The controller icon: the one counter of the game View + D-pad up counts.
 *  Clicking another counter moves it there; clicking it again clears it. */
export function CounterControllerButton({
  game,
  counter,
  active,
}: {
  game: GameIdentityRef;
  counter: GameCounter;
  active: boolean;
}) {
  const setControllerCounter = usePersonalLibraryState(
    (s) => s.setControllerCounter,
  );
  const label = active
    ? t("View + D-pad up counts this one. Click to stop.")
    : t("Count this one with View + D-pad up.");
  return (
    <button
      type="button"
      title={label}
      aria-label={`${counterName(counter)}: ${label}`}
      aria-pressed={active}
      onClick={() => setControllerCounter(game, active ? null : counter.id)}
      className={clsx(
        "grid h-7 w-7 shrink-0 place-items-center rounded-lg transition hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
        active ? "bg-accent/15 text-accent-ink" : "text-text-faint",
      )}
    >
      <Gamepad2 size={15} aria-hidden />
    </button>
  );
}

/** Recording a counter's own key: start, press a key combination (or a
 *  Numpad key alone), and it is saved; a taken key says so in a toast. Put
 *  `buttonProps` on the button that starts it. */
export function useCounterKeyRecorder(
  game: GameIdentityRef,
  counter: GameCounter,
) {
  const api = usePersonalLibraryApi();
  const update = usePersonalLibraryState((s) => s.updateGameCounter);
  const addToast = usePersonalLibraryState((s) => s.addToast);
  /** Why the key could not be set up, if it couldn't. */
  const error = useCounterKeyStatus((s) => s.errors[counter.id]);
  const [recording, setRecording] = useState(false);
  return {
    recording,
    /** What the button says while it waits for the key. */
    recordingLabel: t("Press a key combination…"),
    error,
    remove: () => update(game, counter.id, { key: null }),
    buttonProps: {
      "aria-pressed": recording,
      onClick: () => setRecording(!recording),
      onBlur: () => setRecording(false),
      onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => {
        if (!recording || event.key === "Tab") return;
        event.preventDefault();
        event.stopPropagation();
        if (event.key === "Escape") {
          setRecording(false);
          return;
        }
        const key = shortcutFromKey(event.nativeEvent, { plain: true });
        if (!key) return;
        setRecording(false);
        const conflict = counterKeyConflict(
          api.getState(),
          game,
          counter.id,
          key,
        );
        if (conflict) addToast({ tone: "error", title: conflict });
        else {
          update(game, counter.id, { key });
          completeTourStep("counters", "key");
        }
      },
    },
  };
}

/** The counter's own key: the keyboard icon. Click it and press a key
 *  combination (or a Numpad key alone); the key shows next to it, × takes it
 *  away. The key counts this counter while its game runs. */
export function CounterKeyButton({
  game,
  counter,
}: {
  game: GameIdentityRef;
  counter: GameCounter;
}) {
  const { recording, error, remove, buttonProps } = useCounterKeyRecorder(
    game,
    counter,
  );
  const name = counterName(counter);
  const keyLabel = counter.key ? formatHotkey(counter.key) : null;
  const title = recording
    ? t("Press a key combination…")
    : (error ??
      (keyLabel
        ? t(
            "{{key}} counts {{counter}} while the game runs. Click to change.",
            {
              key: keyLabel,
              counter: name,
            },
          )
        : t("Set a key that counts {{counter}} while the game runs.", {
            counter: name,
          })));
  return (
    <span className="flex shrink-0 items-center gap-0.5">
      <button
        type="button"
        title={title}
        aria-label={title}
        {...buttonProps}
        className={cn(
          "flex h-7 shrink-0 items-center gap-1.5 rounded-lg px-1.5 transition hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
          recording
            ? "border border-accent text-accent-ink"
            : error
              ? "text-danger"
              : keyLabel
                ? "text-accent-ink"
                : "text-text-faint",
        )}
      >
        <Keyboard size={15} aria-hidden />
        {recording ? (
          <span className="text-[11px] font-semibold">
            {t("Press a key combination…")}
          </span>
        ) : keyLabel ? (
          <span className="font-mono text-[11px] font-semibold">
            {keyLabel}
          </span>
        ) : null}
      </button>
      {keyLabel && !recording ? (
        <button
          type="button"
          title={t("Remove the key")}
          aria-label={t("Remove the key from {{counter}}", { counter: name })}
          onClick={remove}
          className="grid h-5 w-5 place-items-center rounded text-text-faint hover:text-text"
        >
          <X size={12} aria-hidden />
        </button>
      ) : null}
    </span>
  );
}

export function CountButtons({
  counter,
  onCount,
  plusTour,
}: {
  counter: GameCounter;
  onCount: (delta: 1 | -1) => void;
  /** The `data-tour` name of "Add one", for a guide that rings it. */
  plusTour?: string;
}) {
  const name = counterName(counter);
  return (
    <span className="flex shrink-0 gap-1.5">
      <button
        type="button"
        title={t("Take one back")}
        aria-label={t("Take one back: {{counter}}", { counter: name })}
        onClick={() => onCount(-1)}
        className="grid h-8 w-8 place-items-center rounded-full border border-border bg-bg/50 text-text-muted transition hover:border-text-muted hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
      >
        <Minus size={15} strokeWidth={2.5} aria-hidden />
      </button>
      <button
        type="button"
        title={t("Add one")}
        data-tour={plusTour}
        aria-label={t("Add one: {{counter}}", { counter: name })}
        onClick={() => onCount(1)}
        className="grid h-8 w-8 place-items-center rounded-full border border-accent/50 bg-accent/10 text-accent-ink transition hover:border-accent hover:bg-accent hover:text-accent-fg hover:shadow-[0_0_18px_rgb(var(--color-accent)/0.45)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
      >
        <Plus size={15} strokeWidth={2.5} aria-hidden />
      </button>
    </span>
  );
}

/** A name field and Add; a taken name says so instead of adding. */
export function AddCounterField({
  game,
  onDone,
  onAdded,
  className,
}: {
  game: GameIdentityRef;
  onDone: () => void;
  /** The new counter's id, before onDone. */
  onAdded?: (counterId: string) => void;
  className?: string;
}) {
  const addGameCounter = usePersonalLibraryState((s) => s.addGameCounter);
  const [name, setName] = useState("");
  const [taken, setTaken] = useState(false);
  const add = () => {
    if (!name.trim()) return;
    const id = addGameCounter(game, name);
    if (id) {
      onAdded?.(id);
      onDone();
      completeTourStep("counters", "add");
    } else setTaken(true);
  };
  return (
    <div className={cn("grid gap-1.5", className)}>
      <div className="flex gap-2">
        <input
          autoFocus
          value={name}
          maxLength={COUNTER_NAME_LIMIT}
          aria-label={t("New counter, for example Wins")}
          placeholder={t("New counter, for example Wins")}
          onChange={(event) => {
            setName(event.target.value);
            setTaken(false);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.nativeEvent.isComposing) {
              event.preventDefault();
              add();
            } else if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              onDone();
            }
          }}
          className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-bg px-3 text-sm text-text outline-none placeholder:text-text-faint focus:border-accent focus:ring-2 focus:ring-accent/30"
        />
        <button
          type="button"
          disabled={!name.trim()}
          onClick={add}
          className="rounded-lg bg-accent px-3 text-xs font-semibold text-accent-fg hover:bg-accent-hover disabled:opacity-45"
        >
          {t("Add")}
        </button>
      </div>
      {taken ? (
        <p role="status" className="text-xs text-danger">
          {t("A counter with this name already exists.")}
        </p>
      ) : null}
    </div>
  );
}

/** A running session's counters, in the order everywhere, with their
 *  numbers. */
export function useSessionCounters(session: ActiveSession) {
  const journal = useGameJournal(session);
  const recentSessions = usePersonalLibraryState((s) => s.recentSessions);
  const activeSessions = usePersonalLibraryState((s) => s.activeSessions);
  const archivedCounts = usePersonalLibraryState((s) => s.archivedCounts);
  const gameJournals = usePersonalLibraryState((s) => s.gameJournals);
  const gameMetadata = usePersonalLibraryState((s) => s.gameMetadata);
  const exeCache = usePersonalLibraryState((s) => s.exeCache);
  const libraryImports = usePersonalLibraryState((s) => s.libraryImports);
  const current =
    activeSessions.find((entry) => entry.id === session.id) ?? session;
  const tallies = useMemo(
    () =>
      sessionTallies(
        {
          recentSessions,
          activeSessions,
          archivedCounts,
          gameJournals,
          gameMetadata,
          exeCache,
          libraryImports,
        },
        current,
      ),
    [
      recentSessions,
      activeSessions,
      archivedCounts,
      gameJournals,
      gameMetadata,
      exeCache,
      libraryImports,
      current,
    ],
  );
  return {
    counters: orderedCounters(journal),
    controller: controllerCounterId(journal),
    tallies,
  };
}

const NO_TALLY: CounterTally = {
  session: 0,
  playthrough: 0,
  all: 0,
  best: null,
};

/* Now Playing ────────────────────────────────────────────────────────────
   A tile per shown counter under the figures. A game that was never counted
   gets one quiet line instead, so a game nobody counts in stays calm. */

export function NowPlayingCounters({ session }: { session: ActiveSession }) {
  const guideRunning = useAppStore((state) => state.activeTour !== null);
  const resetToken = useAppStore((state) => state.demoResetToken);
  // The sample session of the guides counts in a library of its own.
  const sample =
    guideRunning &&
    session.id === -1 &&
    session.gameId === TOUR_DEMO_GAME.gameId &&
    session.exeName === TOUR_DEMO_GAME.exeName;
  if (!sample) return <SessionCounters session={session} />;
  return (
    <PersonalLibraryContext.Provider
      key={resetToken}
      value={tourCounters().store}
    >
      <SessionCounters session={session} tourPlus />
    </PersonalLibraryContext.Provider>
  );
}

function SessionCounters({
  session,
  tourPlus = false,
}: {
  session: ActiveSession;
  /** The first counter's "Add one" is the one the counters guide rings. */
  tourPlus?: boolean;
}) {
  const api = usePersonalLibraryApi();
  const { counters, controller, tallies } = useSessionCounters(session);
  const controllerCounting = useControllerCounting();
  const [adding, setAdding] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const counted = [...tallies.values()].some((tally) => tally.all > 0);
  const count = (counterId: string, delta: 1 | -1) => {
    api.getState().changeSessionCount(session.id, counterId, delta);
    if (delta > 0) completeTourStep("counters", "count");
  };
  const first = counters[0];

  if (!counted) {
    return (
      <div className="relative mx-7 mb-7 -mt-3.5 flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-border bg-bg/40 px-4 py-2.5 text-sm text-text-muted">
        {adding ? (
          <AddCounterField
            game={session}
            onDone={() => setAdding(false)}
            className="min-w-0 flex-1"
          />
        ) : (
          <>
            {first ? <CounterIcon counter={first} size={16} /> : null}
            <span className="min-w-0 flex-1">
              {first
                ? t("Count {{counter}} here, or give it a key of its own.", {
                    counter: counterName(first),
                  })
                : t("Add a counter to count deaths, tries or anything else.")}
            </span>
            {first ? <CounterKeyButton game={session} counter={first} /> : null}
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="rounded-lg px-2.5 py-1.5 text-[13px] font-semibold text-text-muted hover:bg-surface-hover hover:text-text"
            >
              {t("+ Add counter")}
            </button>
            {first ? (
              <CountButtons
                counter={first}
                onCount={(delta) => count(first.id, delta)}
                plusTour={tourPlus ? "demo-session-counter-plus" : undefined}
              />
            ) : null}
          </>
        )}
      </div>
    );
  }

  const hidden = counters.filter((counter) => !counter.shown);
  const tiles = counters.filter((counter) => counter.shown || showHidden);
  return (
    <div className="relative mx-7 mb-7 -mt-3.5 grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-2.5">
      {tiles.map((counter, index) => {
        const tally = tallies.get(counter.id) ?? NO_TALLY;
        return (
          <CounterTile
            key={counter.id}
            dimmed={!counter.shown}
            head={
              <>
                <div className="flex min-w-0 flex-1 items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-text-muted">
                  <span className="text-accent-ink">
                    <CounterIcon counter={counter} />
                  </span>
                  <span className="truncate">{counterName(counter)}</span>
                </div>
                <CounterEyeButton game={session} counter={counter} />
                {controllerCounting ? (
                  <CounterControllerButton
                    game={session}
                    counter={counter}
                    active={counter.id === controller}
                  />
                ) : null}
              </>
            }
          >
            <div className="flex items-center gap-3">
              <div className="min-w-0">
                <div className="font-mono text-[32px] font-bold leading-none tabular-nums text-text">
                  {tally.session}
                </div>
                <div className="mt-1 text-xs text-text-muted">
                  {t("this session")}
                </div>
              </div>
              <span className="ml-auto">
                <CountButtons
                  counter={counter}
                  onCount={(delta) => count(counter.id, delta)}
                  plusTour={
                    tourPlus && index === 0 ? "demo-session-counter-plus" : undefined
                  }
                />
              </span>
            </div>
            {/* The key lives down here: the name above keeps its room. */}
            <div className="flex min-h-7 items-center gap-2 border-t border-border/50 pt-2 text-xs text-text-muted">
              <span className="min-w-0 flex-1 truncate">
                <PlaythroughCount value={tally.playthrough} />
              </span>
              <CounterKeyButton game={session} counter={counter} />
            </div>
          </CounterTile>
        );
      })}
      <div className="flex flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-border/70 bg-bg/40 p-3 text-[13px] font-semibold text-text-muted">
        {adding ? (
          <AddCounterField
            game={session}
            onDone={() => setAdding(false)}
            className="w-full"
          />
        ) : (
          <>
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="rounded-lg px-2.5 py-1 hover:text-text"
            >
              {t("+ Add counter")}
            </button>
            {hidden.length > 0 ? (
              <button
                type="button"
                onClick={() => setShowHidden(!showHidden)}
                className="rounded-lg px-2.5 py-1 text-xs font-medium text-text-faint hover:text-text"
              >
                {showHidden
                  ? t("Hide the hidden ones")
                  : t("Show {{count}} hidden", { count: hidden.length })}
              </button>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

function CounterTile({
  dimmed,
  head,
  children,
}: {
  dimmed: boolean;
  head: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      className={clsx(
        "flex flex-col gap-2 rounded-xl border border-border/60 bg-bg/50 py-3 pl-4 pr-3.5 backdrop-blur",
        dimmed && "opacity-60",
      )}
    >
      <div className="flex min-h-7 items-center gap-1.5">{head}</div>
      {children}
    </div>
  );
}

/** "313 this playthrough", the number in bold. */
export function PlaythroughCount({ value }: { value: number }) {
  return (
    <Trans
      t={t}
      i18nKey="<b>{{value}}</b> this playthrough"
      values={{ value }}
      components={{
        b: <b className="font-mono font-semibold tabular-nums text-text/90" />,
      }}
    />
  );
}
