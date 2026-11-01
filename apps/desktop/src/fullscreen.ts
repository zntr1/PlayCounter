import { useSyncExternalStore } from "react";

/* Fullscreen covers the taskbar too, for using PlayCounter on a TV. F11, the
   title bar button and the controller's Menu/Options button switch it. The
   window-state plugin restores it on the next start. */

let fullscreen = false;
const listeners = new Set<() => void>();

function getFullscreen() {
  return fullscreen;
}

function setFullscreenState(value: boolean) {
  if (value === fullscreen) return;
  fullscreen = value;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  startSync();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function insideTauri() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function currentWindow() {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  return getCurrentWindow();
}

// The window's normal bounds (Windows workspace coordinates) and whether it
// was maximized, from before fullscreen. Rust reads and applies it.
type WindowPlacement = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  maximized: boolean;
};

const PLACEMENT_KEY = "playcounter:window-placement-before-fullscreen";

function isPlacement(value: unknown): value is WindowPlacement {
  if (typeof value !== "object" || value === null) return false;
  const placement = value as Record<string, unknown>;
  return (
    ["left", "top", "right", "bottom"].every((key) =>
      Number.isInteger(placement[key]),
    ) && typeof placement.maximized === "boolean"
  );
}

function readPlacement(): WindowPlacement | null {
  try {
    const value: unknown = JSON.parse(
      localStorage.getItem(PLACEMENT_KEY) ?? "null",
    );
    return isPlacement(value) ? value : null;
  } catch {
    return null;
  }
}

function writePlacement(placement: WindowPlacement) {
  try {
    localStorage.setItem(PLACEMENT_KEY, JSON.stringify(placement));
  } catch {
    // Without it, leaving fullscreen after a restart keeps the screen size.
  }
}

// Within one run the window returns to where it was. After a restart in
// fullscreen it would return screen-sized: the window-state plugin saved the
// fullscreen bounds as the window size, so the stored placement replaces them.
export async function toggleFullscreen() {
  if (!insideTauri()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  const win = await currentWindow();
  const fullscreen = !(await win.isFullscreen());
  const placement = await invoke<WindowPlacement | null>(
    "set_main_fullscreen",
    { fullscreen, restore: fullscreen ? null : readPlacement() },
  );
  if (placement) writePlacement(placement);
  setFullscreenState(fullscreen);
}

// The restored fullscreen arrives while the window is still hidden, so the
// state is read again on every resize and focus change, for the app's life.
let syncing = false;

function startSync() {
  if (syncing || !insideTauri()) return;
  syncing = true;
  void currentWindow()
    .then(async (win) => {
      const sync = () =>
        win
          .isFullscreen()
          .then(setFullscreenState)
          .catch(() => undefined);
      await sync();
      await win.onResized(() => void sync());
      await win.onFocusChanged(() => void sync());
    })
    .catch(() => undefined);
}

export function useFullscreen() {
  return useSyncExternalStore(subscribe, getFullscreen, getFullscreen);
}

// The value for data-tauri-drag-region, where Tauri reads "false" as no drag.
// In fullscreen a drag would move the window off its screen, and a double
// click would maximize it, which brings back the taskbar gap.
export function useWindowDragRegion() {
  return useFullscreen() ? "false" : "true";
}
