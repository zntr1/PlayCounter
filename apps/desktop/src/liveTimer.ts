import { invoke } from "@tauri-apps/api/core";
import type { LiveTimerCorner, Settings } from "@playcounter/shared";
import {
  newestSession,
  showLiveTimerToggledOverlay,
} from "./desktopOverlayBridge";
import { currentPlatform } from "./platform";
import { useAppStore, type ActiveSession } from "./store";

export type LiveTimerPayload = {
  startedAtMs: number;
  corner: LiveTimerCorner;
  monitor: string;
  accentColor: string | null;
  /** The game's processes; the pill sits in the corner of their window. */
  targetPids: number[];
};

type GamePids = (session: ActiveSession) => number[];

/** What the timer window shows, or null while it should not exist. */
export function liveTimerPayload(
  settings: Settings,
  activeSessions: ActiveSession[],
  gamePids: GamePids,
): LiveTimerPayload | null {
  if (settings.liveTimerEnabled !== true) return null;
  const session = newestSession(activeSessions);
  const startedAtMs = session ? Date.parse(session.startedAt) : Number.NaN;
  if (!session || !Number.isFinite(startedAtMs)) return null;
  return {
    startedAtMs,
    corner: settings.liveTimerCorner ?? "top-left",
    monitor: settings.overlayMonitor ?? "primary",
    accentColor: settings.accentColor,
    // A console timer has no process: the pill stays in the screen corner.
    targetPids: session.timer ? [] : gamePids(session),
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
      left.startedAtMs === right.startedAtMs &&
      left.corner === right.corner &&
      left.monitor === right.monitor &&
      left.accentColor === right.accentColor &&
      left.targetPids.join() === right.targetPids.join())
  );
}

let lifecycle: {
  unsubscribe: () => void;
  shown: LiveTimerPayload | null;
  gamePids: GamePids;
} | null = null;
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

export function initializeLiveTimer(gamePids: GamePids) {
  if (lifecycle || currentPlatform() === "macos") return;
  lifecycle = {
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
  syncLiveTimer();
}

export function disposeLiveTimer() {
  if (!lifecycle) return;
  lifecycle.unsubscribe();
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
