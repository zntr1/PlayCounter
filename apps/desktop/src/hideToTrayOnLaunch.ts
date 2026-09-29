import { useAppStore } from "./store";
import type { GameAliasRef } from "./tracker";

/* After a Play from PlayCounter, the main window goes to the tray once the
   game shows up as a session, so it stops using resources while the game
   runs. A game that has not appeared after two minutes (an update dialog in
   its launcher, a crash on start) leaves the window where it is. Only the
   latest launch is watched. */
const WAIT_FOR_GAME_MS = 120_000;

let stopWatching: (() => void) | undefined;

export function hideToTrayWhenGameStarts(aliases: readonly GameAliasRef[]) {
  stopWatching?.();
  const stop = () => {
    window.clearTimeout(timer);
    unsubscribe();
    if (stopWatching === stop) stopWatching = undefined;
  };
  const unsubscribe = useAppStore.subscribe((state, previous) => {
    if (state.activeSessions === previous.activeSessions) return;
    const started = state.activeSessions.some((session) =>
      aliases.some(
        (alias) =>
          session.gameId === alias.gameId &&
          (session.source ?? null) === alias.source,
      ),
    );
    if (!started) return;
    stop();
    if (state.settings.hideToTrayOnGameStart !== false) void hideMainWindow();
  });
  const timer = window.setTimeout(stop, WAIT_FOR_GAME_MS);
  stopWatching = stop;
}

// Closing the main window hides it to the tray (see on_window_event in
// lib.rs). Only Tauri has a window; the dev server and tests keep theirs.
async function hideMainWindow() {
  if (!("__TAURI_INTERNALS__" in window)) return;
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().close();
  } catch (error) {
    console.warn("hide to tray after launch failed", error);
  }
}
