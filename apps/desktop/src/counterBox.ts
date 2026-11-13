import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  controllerCounterId,
  counterName,
  orderedCounters,
} from "./counters";
import {
  counterKeyConflict,
  countingSession,
  sessionTallies,
  useCounterKeyStatus,
} from "./counterInput";
import { showCurrentSessionOverlay } from "./desktopOverlayBridge";
import { formatHotkey } from "./hotkeyFormat";
import { getT } from "./i18n";
import { pickedCover } from "./pickedCovers";
import { playthroughName } from "./personalLibrary";
import { currentPlatform } from "./platform";
import { boxLook } from "./quickNote";
import { getGameJournal, useAppStore, type ActiveSession } from "./store";

const t = getT("nowPlaying");

/* The counter box (docs/counters-plan.md) ────────────────────────────────────
   The hotkey opens the note box window as a box with the running game's
   counters. Like quick add, the box only shows and sends: the main window
   counts, saves and sends the box what it shows next. */

/** quick_note.rs COUNTER_BOX_ACTION_EVENT: what the box asks for. */
export const COUNTER_BOX_ACTION_EVENT = "playcounter:counter-box-action";

export type CounterBoxRow = {
  id: string;
  name: string;
  shown: boolean;
  /** View + D-pad up counts this one. */
  controller: boolean;
  /** Its own key as saved, and as the player reads it. */
  key: string | null;
  keyLabel: string | null;
  /** Why its key doesn't work right now. */
  keyError: string | null;
  session: number;
  playthrough: number;
};

export type CounterBoxState = {
  sessionId: number;
  gameName: string;
  coverUrl: string | null;
  playthroughName: string;
  rows: CounterBoxRow[];
  /** A short answer to the last action ("That name is taken."). */
  notice: string | null;
  /** "Ctrl+Alt+Z takes the last one back", or null without that key. */
  undoHint: string | null;
  /** "Count with controller" is on: rows show the controller icon. */
  controllerEnabled: boolean;
};

export type CounterBoxAction =
  | { kind: "count"; counterId: string; delta: number }
  | { kind: "shown"; counterId: string; shown: boolean }
  | { kind: "controller"; counterId: string }
  | { kind: "add"; name: string }
  | { kind: "key"; counterId: string; key: string | null };

export type CounterBoxLabel =
  | "Counters"
  | "<b>{{value}}</b> this playthrough"
  | "this session"
  | "Shown while you play. Click to hide."
  | "Hidden while you play. Click to show."
  | "Set a key that counts this counter while the game runs."
  | "Click to change the key."
  | "View + D-pad up counts this one. Click to stop."
  | "Count this one with View + D-pad up."
  | "Add one"
  | "Take one back"
  | "Press a key combination…"
  | "Remove the key"
  | "New counter, for example Wins"
  | "Add"
  | "↑↓ picks · + and − count · Esc closes";

/** What the box gets. It has no i18n of its own: its texts come along, keyed
 *  by their English. */
export type CounterBoxPayload = {
  counterBox: CounterBoxState;
  labels: Record<CounterBoxLabel, string>;
  monitor?: string | null;
  locale?: string | null;
  theme: "dark" | "light";
  accentColor: string | null;
  reducedMotion: boolean;
};

function counterBoxLabels(): Record<CounterBoxLabel, string> {
  return {
    Counters: t("Counters"),
    // The box puts the number in.
    "<b>{{value}}</b> this playthrough": t(
      "<b>{{value}}</b> this playthrough",
      { value: "{{value}}" },
    ),
    "this session": t("this session"),
    "Shown while you play. Click to hide.": t(
      "Shown while you play. Click to hide.",
    ),
    "Hidden while you play. Click to show.": t(
      "Hidden while you play. Click to show.",
    ),
    "Set a key that counts this counter while the game runs.": t(
      "Set a key that counts this counter while the game runs.",
    ),
    "Click to change the key.": t("Click to change the key."),
    "View + D-pad up counts this one. Click to stop.": t(
      "View + D-pad up counts this one. Click to stop.",
    ),
    "Count this one with View + D-pad up.": t(
      "Count this one with View + D-pad up.",
    ),
    "Add one": t("Add one"),
    "Take one back": t("Take one back"),
    "Press a key combination…": t("Press a key combination…"),
    "Remove the key": t("Remove the key"),
    "New counter, for example Wins": t("New counter, for example Wins"),
    Add: t("Add"),
    "↑↓ picks · + and − count · Esc closes": t(
      "↑↓ picks · + and − count · Esc closes",
    ),
  };
}

/** What the box shows for a running session, or null when it ended. */
export function counterBoxState(
  sessionId: number,
  notice: string | null = null,
): CounterBoxState | null {
  const state = useAppStore.getState();
  const session = state.activeSessions.find((entry) => entry.id === sessionId);
  if (!session) return null;
  const journal = getGameJournal(state, session);
  const tallies = sessionTallies(state, session);
  const keyErrors = useCounterKeyStatus.getState().errors;
  const undoKey = state.settings.counterUndoHotkey;
  const controller = controllerCounterId(journal);
  return {
    sessionId,
    gameName: session.gameName,
    coverUrl: pickedCover(state, session) ?? session.coverUrl ?? null,
    playthroughName: playthroughName(journal, session.playthroughId ?? null),
    rows: orderedCounters(journal).map((counter) => {
      const tally = tallies.get(counter.id);
      return {
        id: counter.id,
        name: counterName(counter),
        shown: counter.shown,
        controller: counter.id === controller,
        key: counter.key ?? null,
        keyLabel: counter.key ? formatHotkey(counter.key) : null,
        keyError: keyErrors[counter.id] ?? null,
        session: tally?.session ?? 0,
        playthrough: tally?.playthrough ?? 0,
      };
    }),
    notice,
    controllerEnabled: state.settings.controllerCountingEnabled === true,
    undoHint: undoKey
      ? t("{{key}} takes the last one back.", { key: formatHotkey(undoKey) })
      : null,
  };
}

/** The box's session while it is open. */
let openFor: number | null = null;
let lastSent = "";

function send(next: CounterBoxState) {
  const text = JSON.stringify(next);
  if (text === lastSent) return;
  lastSent = text;
  void invoke<boolean>("counter_box_update", { update: next })
    .then((open) => {
      // Closed in the meantime: nothing more to send.
      if (!open && openFor === next.sessionId) openFor = null;
    })
    .catch((error) => console.error("counter box update failed", error));
}

function refresh(notice: string | null = null) {
  if (openFor === null) return;
  const next = counterBoxState(openFor, notice);
  if (next) send(next);
}

/** The counter box hotkey: the box over the game counted for. */
export function openCounterBox() {
  if (currentPlatform() === "macos") return;
  const session = countingSession(useAppStore.getState().activeSessions);
  if (!session) {
    showCurrentSessionOverlay();
    return;
  }
  openCounterBoxFor(session);
}

export function openCounterBoxFor(session: ActiveSession) {
  const counterBox = counterBoxState(session.id);
  if (!counterBox) return;
  openFor = session.id;
  lastSent = JSON.stringify(counterBox);
  const payload: CounterBoxPayload = {
    counterBox,
    labels: counterBoxLabels(),
    ...boxLook(),
  };
  void invoke("quick_note_open", { payload }).catch((error) =>
    console.error("counter box failed to open", error),
  );
}

/** Does what the box asked, then sends what it shows now. */
export function applyCounterBoxAction(action: CounterBoxAction) {
  if (openFor === null) return;
  const store = useAppStore.getState();
  const session = store.activeSessions.find((entry) => entry.id === openFor);
  if (!session) return;
  let notice: string | null = null;
  if (action.kind === "count") {
    store.changeSessionCount(session.id, action.counterId, action.delta);
  } else if (action.kind === "shown") {
    store.updateGameCounter(session, action.counterId, {
      shown: action.shown,
    });
  } else if (action.kind === "controller") {
    const journal = getGameJournal(store, session);
    store.setControllerCounter(
      session,
      controllerCounterId(journal) === action.counterId ? null : action.counterId,
    );
  } else if (action.kind === "add") {
    if (action.name.trim() && !store.addGameCounter(session, action.name))
      notice = t("A counter with this name already exists.");
  } else if (action.kind === "key") {
    const conflict = action.key
      ? counterKeyConflict(store, session, action.counterId, action.key)
      : null;
    if (conflict) notice = conflict;
    else
      store.updateGameCounter(session, action.counterId, {
        key: action.key,
      });
  }
  // Changes reach the box through the store subscription; a notice alone
  // changes nothing there, so it goes now.
  if (notice) refresh(notice);
}

let lifecycle: {
  disposed: boolean;
  unlisten?: UnlistenFn;
  unsubscribe: () => void;
  unsubscribeKeys: () => void;
} | null = null;

export function initializeCounterBox() {
  if (lifecycle) return;
  const current = {
    disposed: false,
    unlisten: undefined as UnlistenFn | undefined,
    unsubscribe: useAppStore.subscribe((state, previous) => {
      if (
        openFor !== null &&
        (state.activeSessions !== previous.activeSessions ||
          state.gameJournals !== previous.gameJournals ||
          state.recentSessions !== previous.recentSessions ||
          state.settings !== previous.settings)
      )
        refresh();
    }),
    // A key that could not be set up shows its reason in the box.
    unsubscribeKeys: useCounterKeyStatus.subscribe(() => refresh()),
  };
  lifecycle = current;
  void listen<CounterBoxAction>(COUNTER_BOX_ACTION_EVENT, ({ payload }) => {
    if (!current.disposed) applyCounterBoxAction(payload);
  })
    .then((unlisten) => {
      if (current.disposed) unlisten();
      else current.unlisten = unlisten;
    })
    .catch((error) => console.error("counter box listener failed", error));
}

export function disposeCounterBox() {
  if (!lifecycle) return;
  lifecycle.disposed = true;
  lifecycle.unlisten?.();
  lifecycle.unsubscribe();
  lifecycle.unsubscribeKeys();
  lifecycle = null;
  openFor = null;
  lastSent = "";
}
