import { useMemo } from "react";
import { useAppStore, type AppState } from "../store";

/** Keep the mounted library's session snapshot still while another view is open. */
export function useLibrarySessionState() {
  const select = useMemo(() => {
    const initial = useAppStore.getState();
    let snapshot = {
      recentSessions: initial.recentSessions,
      activeSessions: initial.activeSessions,
      archivedGameSeconds: initial.archivedGameSeconds,
    };
    return (state: AppState) => {
      // The library stays mounted to retain its filters and scroll position.
      // Updating its game summaries here would block interactions in Now Playing.
      if (
        state.activeView === "games" &&
        (state.recentSessions !== snapshot.recentSessions ||
          state.activeSessions !== snapshot.activeSessions ||
          state.archivedGameSeconds !== snapshot.archivedGameSeconds)
      ) {
        snapshot = {
          recentSessions: state.recentSessions,
          activeSessions: state.activeSessions,
          archivedGameSeconds: state.archivedGameSeconds,
        };
      }
      return snapshot;
    };
  }, []);
  return useAppStore(select);
}
