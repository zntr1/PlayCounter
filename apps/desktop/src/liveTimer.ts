import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { LiveTimerCorner, Settings } from "@playcounter/shared";
import {
  newestSession,
  showLiveTimerToggledOverlay,
} from "./desktopOverlayBridge";
import { currentPlatform } from "./platform";
import { countFromMs, pausedAtMs } from "./sessionTime";
import { getT } from "./i18n";
import { useAppStore, type ActiveSession } from "./store";

export type LiveTimerPayload = {
  /** The pill counts up from here: the start, moved later by the session's
   *  finished pauses. */
  countFromMs: number;
  /** Set while paused: the pill stands at this moment. */
  pausedAtMs: number | null;
  corner: LiveTimerCorner;
  monitor: string;
  accentColor: string | null;
  /** The game's processes; the pill sits in the corner of their window. */
  targetPids: number[];
  /** The pill's button, in the app's language. */
  pauseLabel: string;
  resumeLabel: string;
};

type GamePids = (session: ActiveSession) => number[];

const t = getT("overlays");

/** Sent by the pill when its button is clicked. */
const TOGGLE_PAUSE_EVENT = "playcounter:live-timer-toggle-pause";

/** The game the pill shows: the one started last on this PC. */
function pillSession(activeSessions: ActiveSession[]) {
  return newestSession(activeSessions.filter((active) => !active.console));
}

/** What the timer window shows, or null while it should not exist. */
export function liveTimerPayload(
  settings: Settings,
  activeSessions: ActiveSession[],
  gamePids: GamePids,
): LiveTimerPayload | null {
  if (settings.liveTimerEnabled !== true) return null;
  const session = pillSession(activeSessions);
  const fromMs = session ? countFromMs(session) : Number.NaN;
  if (!session || !Number.isFinite(fromMs)) return null;
  return {
    countFromMs: fromMs,
    pausedAtMs: pausedAtMs(session),
    corner: settings.liveTimerCorner ?? "top-left",
    monitor: settings.overlayMonitor ?? "primary",
    accentColor: settings.accentColor,
    // A console timer has no process: the pill stays in the screen corner.
    targetPids: session.timer ? [] : gamePids(session),
    pauseLabel: t("Pause the timer for {{gameName}}", {
      gameName: session.gameName,
    }),
    resumeLabel: t("Resume the timer for {{gameName}}", {
      gameName: session.gameName,
    }),
  };
}

function samePayload(
  left: LiveTimerPayload | null,
  right: LiveTimerPayload | null,
) {
  return (
    left === right ||
    (left !== null &&
      right !== null &&
      left.countFromMs === right.countFromMs &&
      left.pausedAtMs === right.pausedAtMs &&
      left.corner === right.corner &&
      left.monitor === right.monitor &&
      left.accentColor === right.accentColor &&
      left.pauseLabel === right.pauseLabel &&
      left.resumeLabel === right.resumeLabel &&
      left.targetPids.join() === right.targetPids.join())
  );
}

type Lifecycle = {
  unsubscribe: () => void;
  unlisten?: () => void;
  shown: LiveTimerPayload | null;
  gamePids: GamePids;
};

let lifecycle: Lifecycle | null = null;
// Show and hide run in order, so a quick toggle cannot leave a stale window.
let pending: Promise<unknown> = Promise.resolve();

function send(payload: LiveTimerPayload | null) {
  pending = pending
    .then(() =>
      payload
        ? invoke("live_timer_show", { payload })
        : invoke("live_timer_hide"),
    )
    .catch((error) => console.warn("live timer update failed", error));
}

/** Also called after each process scan, when the game's processes may have
 *  changed without its session changing. */
export function syncLiveTimer() {
  if (!lifecycle) return;
  const { settings, activeSessions } = useAppStore.getState();
  const next = liveTimerPayload(settings, activeSessions, lifecycle.gamePids);
  if (samePayload(next, lifecycle.shown)) return;
  lifecycle.shown = next;
  send(next);
}

export function initializeLiveTimer(
  gamePids: GamePids,
  onTogglePause: (sessionId: number) => void = () => undefined,
) {
  if (lifecycle || currentPlatform() === "macos") return;
  const current: Lifecycle = {
    shown: null,
    gamePids,
    unsubscribe: useAppStore.subscribe((state, previous) => {
      if (
        state.settings !== previous.settings ||
        state.activeSessions !== previous.activeSessions
      ) {
        syncLiveTimer();
      }
    }),
  };
  lifecycle = current;
  // The pill's button: pause or resume the game it shows right now.
  void listen(TOGGLE_PAUSE_EVENT, () => {
    const session = pillSession(useAppStore.getState().activeSessions);
    if (session) onTogglePause(session.id);
  })
    .then((unlisten) => {
      if (lifecycle === current) current.unlisten = unlisten;
      else unlisten();
    })
    .catch((error) => console.warn("live timer listener failed", error));
  syncLiveTimer();
}

export function disposeLiveTimer() {
  if (!lifecycle) return;
  lifecycle.unsubscribe();
  lifecycle.unlisten?.();
  if (lifecycle.shown) send(null);
  lifecycle = null;
}

const HOTKEY_CORNERS: LiveTimerCorner[] = [
  "top-left",
  "top-right",
  "bottom-right",
  "bottom-left",
];

/** The hotkey's next step: off, then each corner clockwise from the top
 *  left, then off again. Null = off. */
export function nextLiveTimerCorner(settings: Settings) {
  if (settings.liveTimerEnabled !== true) return HOTKEY_CORNERS[0];
  const index = HOTKEY_CORNERS.indexOf(settings.liveTimerCorner ?? "top-left");
  return HOTKEY_CORNERS[index + 1] ?? null;
}

/** The hotkey. With a game running, the timer moving or going is the
 *  answer; without one a short popup says what happened. */
export function cycleLiveTimer() {
  const store = useAppStore.getState();
  const corner = nextLiveTimerCorner(store.settings);
  // Corner first: switching on then shows the timer once, in its place.
  if (corner) store.setLiveTimerCorner(corner);
  store.setDesktopOverlaySetting("liveTimerEnabled", corner !== null);
  if (!newestSession(store.activeSessions)) {
    showLiveTimerToggledOverlay(corner);
  }
}
