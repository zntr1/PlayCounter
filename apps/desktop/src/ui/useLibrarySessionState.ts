import { useDeferredValue, useMemo } from "react";
import { useAppStore, type AppState } from "../store";

/** Refresh shared summaries only while the library or a compact banner needs them. */
export function useLibrarySessionState() {
  const select = useMemo(() => {
    const initial = useAppStore.getState();
    let snapshot = {
      recentSessions: initial.recentSessions,
      activeSessions: initial.activeSessions,
      archivedGameSeconds: initial.archivedGameSeconds,
      archivedConsoleSeconds: initial.archivedConsoleSeconds,
    };
    return (state: AppState) => {
      // The library stays mounted to retain its filters and scroll position.
      // Other views only need fresh summaries when their banner is enabled.
      if (
        (state.activeView === "games" ||
          state.settings.viewShowHero?.[state.activeView] === true) &&
        (state.recentSessions !== snapshot.recentSessions ||
          state.activeSessions !== snapshot.activeSessions ||
          state.archivedGameSeconds !== snapshot.archivedGameSeconds ||
          state.archivedConsoleSeconds !== snapshot.archivedConsoleSeconds)
      ) {
        snapshot = {
          recentSessions: state.recentSessions,
          activeSessions: state.activeSessions,
          archivedGameSeconds: state.archivedGameSeconds,
          archivedConsoleSeconds: state.archivedConsoleSeconds,
        };
      }
      return snapshot;
    };
  }, []);
  // Returning to the library shows the cached cards immediately. Catching up
  // with session changes must not hold up the navigation's first paint.
  return useDeferredValue(useAppStore(select));
}
