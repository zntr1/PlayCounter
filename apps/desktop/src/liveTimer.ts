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
};

/** What the timer window shows, or null while it should not exist. */
export function liveTimerPayload(
  settings: Settings,
  activeSessions: ActiveSession[],
): LiveTimerPayload | null {
  if (settings.liveTimerEnabled !== true) return null;
  const session = newestSession(activeSessions);
  const startedAtMs = session ? Date.parse(session.startedAt) : Number.NaN;
  if (!Number.isFinite(startedAtMs)) return null;
  return {
    startedAtMs,
    corner: settings.liveTimerCorner ?? "top-left",
    monitor: settings.overlayMonitor ?? "primary",
    accentColor: settings.accentColor,
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
      left.accentColor === right.accentColor)
  );
}

let lifecycle: {
  unsubscribe: () => void;
  shown: LiveTimerPayload | null;
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

function sync() {
  if (!lifecycle) return;
  const { settings, activeSessions } = useAppStore.getState();
  const next = liveTimerPayload(settings, activeSessions);
  if (samePayload(next, lifecycle.shown)) return;
  lifecycle.shown = next;
  send(next);
}

export function initializeLiveTimer() {
  if (lifecycle || currentPlatform() === "macos") return;
  lifecycle = {
    shown: null,
    unsubscribe: useAppStore.subscribe((state, previous) => {
      if (
        state.settings !== previous.settings ||
        state.activeSessions !== previous.activeSessions
      ) {
        sync();
      }
    }),
  };
  sync();
}

export function disposeLiveTimer() {
  if (!lifecycle) return;
  lifecycle.unsubscribe();
  if (lifecycle.shown) send(null);
  lifecycle = null;
}

/** The hotkey. With a game running, the timer appearing or going is the
 *  answer; without one a short popup says what happened. */
export function toggleLiveTimer() {
  const store = useAppStore.getState();
  const enabled = store.settings.liveTimerEnabled !== true;
  store.setDesktopOverlaySetting("liveTimerEnabled", enabled);
  if (!newestSession(store.activeSessions)) {
    showLiveTimerToggledOverlay(enabled);
  }
}
