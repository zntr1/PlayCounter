import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import { useAppStore } from "../store";

/* A minute after the main window goes to the tray, App stops rendering the
   views and their artwork. A view left open kept thousands of elements and
   full-size artwork in memory while games ran. The tracker lives outside the
   views and keeps running. Opening the window renders everything again. */
const PARK_DELAY_MS = 60_000;

// A dialog can hold unsaved input and a guide points at view elements: while
// either is open the views stay, and parking is tried again a minute later.
function viewsInUse() {
  return (
    useAppStore.getState().activeTour !== null ||
    document.querySelector('[role="dialog"][aria-modal="true"]') !== null
  );
}

async function windowHidden() {
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    return !(await getCurrentWindow().isVisible());
  } catch {
    return false;
  }
}

export function useParkedInTray() {
  const [parked, setParked] = useState(false);

  useEffect(() => {
    // Only Tauri has a tray; the browser dev server and tests render as usual.
    if (!("__TAURI_INTERNALS__" in window)) return;
    let disposed = false;
    let timer: number | undefined;
    let unlisten: (() => void) | undefined;
    // Bumped by every tray event, so a visibility check that was already
    // under way when the window came back never parks it.
    let generation = 0;

    const cancel = () => {
      window.clearTimeout(timer);
      timer = undefined;
    };
    const schedule = () => {
      cancel();
      const scheduledIn = generation;
      timer = window.setTimeout(() => {
        timer = undefined;
        void windowHidden().then((hidden) => {
          if (disposed || scheduledIn !== generation || !hidden) return;
          if (viewsInUse()) schedule();
          else setParked(true);
        });
      }, PARK_DELAY_MS);
    };

    listen<boolean>("playcounter:main-window-in-tray", ({ payload }) => {
      generation += 1;
      if (payload) {
        schedule();
      } else {
        cancel();
        setParked(false);
      }
    })
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch(() => undefined);
    // An autostart launch can reach the tray before the listener exists; the
    // check at the end of the delay skips a window that is on screen.
    schedule();

    return () => {
      disposed = true;
      cancel();
      unlisten?.();
    };
  }, []);

  // Removing the views touches most of the page's memory again after
  // WebView2 already trimmed it; once they are gone, ask for another trim.
  useEffect(() => {
    if (!parked) return;
    const timer = window.setTimeout(() => {
      invoke("main_window_parked").catch(() => undefined);
    }, 2_000);
    return () => window.clearTimeout(timer);
  }, [parked]);

  return parked;
}
