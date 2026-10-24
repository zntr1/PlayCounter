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

// The window as it was before fullscreen, in physical pixels.
type WindowBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
  maximized: boolean;
};

const BOUNDS_KEY = "playcounter:window-before-fullscreen";

function readBounds(): WindowBounds | null {
  try {
    const raw = localStorage.getItem(BOUNDS_KEY);
    return raw ? (JSON.parse(raw) as WindowBounds) : null;
  } catch {
    return null;
  }
}

function writeBounds(bounds: WindowBounds) {
  try {
    localStorage.setItem(BOUNDS_KEY, JSON.stringify(bounds));
  } catch {
    // Without it, leaving fullscreen after a restart keeps the screen size.
  }
}

export async function toggleFullscreen() {
  if (!insideTauri()) return;
  const { availableMonitors, PhysicalPosition, PhysicalSize } = await import(
    "@tauri-apps/api/window"
  );
  const win = await currentWindow();
  if (!(await win.isFullscreen())) {
    // tao keeps a maximized borderless window clear of the taskbar, also in
    // fullscreen, so the window leaves maximized first.
    const maximized = await win.isMaximized();
    if (maximized) await win.unmaximize();
    const position = await win.outerPosition();
    const size = await win.innerSize();
    writeBounds({
      x: position.x,
      y: position.y,
      width: size.width,
      height: size.height,
      maximized,
    });
    await win.setFullscreen(true);
    setFullscreenState(true);
    return;
  }
  await win.setFullscreen(false);
  // Within one run the window comes back as it was. After a restart in
  // fullscreen it comes back screen-sized: the window-state plugin saved the
  // fullscreen bounds as the window size, so the stored bounds replace them.
  const bounds = readBounds();
  if (bounds) {
    const centerX = bounds.x + bounds.width / 2;
    const centerY = bounds.y + bounds.height / 2;
    const onScreen = (await availableMonitors()).some(
      (monitor) =>
        centerX >= monitor.position.x &&
        centerX < monitor.position.x + monitor.size.width &&
        centerY >= monitor.position.y &&
        centerY < monitor.position.y + monitor.size.height,
    );
    if (onScreen) {
      await win.setPosition(new PhysicalPosition(bounds.x, bounds.y));
      await win.setSize(new PhysicalSize(bounds.width, bounds.height));
    }
    if (bounds.maximized) await win.maximize();
  }
  setFullscreenState(false);
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
