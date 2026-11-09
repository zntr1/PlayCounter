import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { create } from "zustand";
import {
  counterName,
  counterTallies,
  controllerCounterId,
  gameArchivedCounts,
  journalCounters,
  orderedCounters,
  type CounterTally,
} from "./counters";
import {
  newestSession,
  showCounterOverlay,
  showCurrentSessionOverlay,
} from "./desktopOverlayBridge";
import { formatHotkey } from "./hotkeyFormat";
import { getT } from "./i18n";
import { nativeText } from "./nativeText";
import {
  getGameJournal,
  personalGameIdentity,
  useAppStore,
  type ActiveSession,
  type AppState,
} from "./store";

/* Counting from outside the app: a counter's own key, "Take one back" and the
   controller (docs/counters-plan.md). They count for the game the live timer
   shows, and the pill or a popup answers each press. */

const t = getT("settings");

/** Rust's set_global_hotkey takes this prefix plus a counter id. */
const KEY_ACTION_PREFIX = "counter-key:";
/** hotkeys.rs: a counter's own key was pressed. */
const KEY_EVENT = "playcounter:counter-key-hotkey";
/** controller.rs: a counting combo was held ("add" or "undo"). */
const CONTROLLER_EVENT = "playcounter:controller-count";

/** The game the hotkeys count for: the one started last on this PC, a
 *  PlayStation session only when nothing runs here. The same game the pause
 *  hotkey pauses and the live timer shows. */
export function countingSession(activeSessions: readonly ActiveSession[]) {
  return (
    newestSession(activeSessions.filter((session) => !session.console)) ??
    newestSession([...activeSessions])
  );
}

type TallyState = Pick<
  AppState,
  | "recentSessions"
  | "activeSessions"
  | "archivedCounts"
  | "gameJournals"
  | "gameMetadata"
  | "exeCache"
  | "libraryImports"
>;

/** Every counter's numbers for a running session's game: this session, its
 *  playthrough, all playthroughs. */
export function sessionTallies(
  state: TallyState,
  session: ActiveSession,
): Map<string, CounterTally> {
  const identity = personalGameIdentity(state);
  const gameKey = identity(session);
  return counterTallies({
    sessions: [...state.recentSessions, ...state.activeSessions].filter(
      (entry) => identity(entry) === gameKey,
    ),
    archived: gameArchivedCounts(state.archivedCounts, session, identity),
    playthroughId: session.playthroughId ?? null,
    sessionId: session.id,
  });
}

type Answer = (counterId: string) => boolean;
/** The live timer answers a press itself when it shows the counter
 *  (liveTimer.ts); it registers here so this module stays free of it. */
let pillAnswer: Answer = () => false;

export function setPillAnswer(answer: Answer) {
  pillAnswer = answer;
}

/** Counts and says so: the pill pulses, or a popup shows the new number. */
function countAndAnswer(session: ActiveSession, counterId: string, delta: number) {
  if (
    useAppStore.getState().changeSessionCount(session.id, counterId, delta) ===
    null
  )
    return;
  if (pillAnswer(counterId)) return;
  const state = useAppStore.getState();
  const current =
    state.activeSessions.find((entry) => entry.id === session.id) ?? session;
  const counter = journalCounters(getGameJournal(state, current)).find(
    (entry) => entry.id === counterId,
  );
  if (!counter) return;
  showCounterOverlay(current, {
    name: counterName(counter),
    count: sessionTallies(state, current).get(counterId)?.playthrough ?? 0,
  });
}

/** The controller adds one to the counter with the controller icon. "Take
 *  one back" (the hotkey or the controller) takes one off the counter counted
 *  last in this session, else the controller's counter, else the first. */
function count(direction: "add" | "undo") {
  const state = useAppStore.getState();
  const session = countingSession(state.activeSessions);
  if (!session) {
    showCurrentSessionOverlay();
    return;
  }
  const journal = getGameJournal(state, session);
  const last =
    direction === "undo" &&
    session.lastCounterId &&
    journalCounters(journal).some((c) => c.id === session.lastCounterId)
      ? session.lastCounterId
      : null;
  const controller = controllerCounterId(journal);
  const counterId =
    direction === "add"
      ? controller
      : (last ?? controller ?? orderedCounters(journal)[0]?.id ?? null);
  if (!counterId) {
    showCounterOverlay(
      session,
      journalCounters(journal).length > 0 ? "no-controller-counter" : "no-counters",
    );
    return;
  }
  countAndAnswer(session, counterId, direction === "add" ? 1 : -1);
}

/** The "Take one back" hotkey. */
export function takeOneBack() {
  count("undo");
}

/** View + D-pad up / down held (controller.rs). */
export function countFromController(direction: "add" | "undo") {
  count(direction);
}

/** A counter's own key: one more for it, if the game running has it. */
export function countWithKey(counterId: string) {
  const state = useAppStore.getState();
  const session = countingSession(state.activeSessions);
  if (
    !session ||
    !journalCounters(getGameJournal(state, session)).some(
      (c) => c.id === counterId,
    )
  )
    return;
  countAndAnswer(session, counterId, 1);
}

/* A counter's own key ─────────────────────────────────────────────────────
   It works while its game is the one counted for, so the same key can mean
   another counter in another game. Only that game's keys are registered. */

export const useCounterKeyStatus = create<{
  /** Counter id -> why its key could not be set up. */
  errors: Record<string, string>;
}>(() => ({ errors: {} }));

/** The keys a counter may not take: another PlayCounter hotkey, or another
 *  counter of the same game. Null when it is free. */
export function counterKeyConflict(
  state: Pick<
    AppState,
    "settings" | "gameJournals" | "gameMetadata" | "exeCache" | "libraryImports"
  >,
  game: Parameters<typeof getGameJournal>[1],
  counterId: string,
  shortcut: string,
): string | null {
  const taken = Object.entries(state.settings).some(
    ([key, value]) => key.endsWith("Hotkey") && value === shortcut,
  );
  if (taken)
    return t("{{key}} is already one of PlayCounter's hotkeys.", {
      key: formatHotkey(shortcut),
    });
  const other = journalCounters(getGameJournal(state, game)).find(
    (counter) => counter.id !== counterId && counter.key === shortcut,
  );
  return other
    ? t("{{key}} already counts {{counter}}.", {
        key: formatHotkey(shortcut),
        counter: counterName(other),
      })
    : null;
}

type KeyLifecycle = {
  disposed: boolean;
  unsubscribe: () => void;
  unlisten?: UnlistenFn;
  /** Action -> key, as registered in Rust. */
  registered: Map<string, string>;
  wanted: string;
  pending: Promise<unknown>;
};

let keys: KeyLifecycle | null = null;

function wantedKeys(state: AppState) {
  const session = countingSession(state.activeSessions);
  const wanted = new Map<string, string>();
  if (!session) return wanted;
  for (const counter of journalCounters(getGameJournal(state, session)))
    if (counter.key) wanted.set(`${KEY_ACTION_PREFIX}${counter.id}`, counter.key);
  return wanted;
}

function syncKeys(current: KeyLifecycle) {
  const wanted = wantedKeys(useAppStore.getState());
  const fingerprint = JSON.stringify([...wanted].sort());
  if (fingerprint === current.wanted) return;
  current.wanted = fingerprint;
  current.pending = current.pending.then(async () => {
    if (current.disposed) return;
    const register = (action: string, shortcut: string | null) =>
      invoke("set_global_hotkey", { action, shortcut });
    // Off first, so two counters can swap keys.
    for (const [action, shortcut] of [...current.registered]) {
      if (wanted.get(action) === shortcut) continue;
      try {
        await register(action, null);
      } catch (error) {
        console.warn("counter key cleanup failed", error);
      }
      current.registered.delete(action);
    }
    const errors: Record<string, string> = {};
    for (const [action, shortcut] of wanted) {
      if (current.registered.get(action) === shortcut) continue;
      try {
        await register(action, shortcut);
        current.registered.set(action, shortcut);
      } catch (error) {
        errors[action.slice(KEY_ACTION_PREFIX.length)] = nativeText(
          error instanceof Error ? error.message : String(error),
        );
      }
    }
    useCounterKeyStatus.setState({ errors });
  });
}

export function initializeCounterKeys() {
  if (keys) return;
  const current: KeyLifecycle = {
    disposed: false,
    registered: new Map(),
    wanted: "",
    pending: Promise.resolve(),
    unsubscribe: useAppStore.subscribe((state, previous) => {
      if (
        state.activeSessions !== previous.activeSessions ||
        state.gameJournals !== previous.gameJournals
      )
        syncKeys(current);
    }),
  };
  keys = current;
  void Promise.all([
    listen<string>(KEY_EVENT, ({ payload }) => {
      if (!current.disposed && typeof payload === "string")
        countWithKey(payload);
    }),
    // The controller counts like the hotkeys.
    listen<string>(CONTROLLER_EVENT, ({ payload }) => {
      if (!current.disposed)
        countFromController(payload === "undo" ? "undo" : "add");
    }),
  ])
    .then((handlers) => {
      const unlisten = () => handlers.forEach((handler) => handler());
      if (current.disposed) unlisten();
      else current.unlisten = unlisten;
    })
    .catch((error) => console.warn("counter key listener failed", error));
  syncKeys(current);
}

export function disposeCounterKeys() {
  const current = keys;
  if (!current) return;
  keys = null;
  current.disposed = true;
  current.unsubscribe();
  current.unlisten?.();
  current.pending = current.pending.then(async () => {
    for (const action of current.registered.keys()) {
      try {
        await invoke("set_global_hotkey", { action, shortcut: null });
      } catch (error) {
        console.warn("counter key cleanup failed", error);
      }
    }
    current.registered.clear();
  });
}
