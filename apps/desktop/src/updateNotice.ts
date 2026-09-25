export const UPDATE_FIRST_CHECK_DELAY_MS = 8_000;
export const UPDATE_RECHECK_MS = 6 * 60 * 60 * 1000;
// Autostart at boot often checks before the network is up.
export const UPDATE_RETRY_MS = 5 * 60 * 1000;

export type UpdateCheckOutcome = "available" | "current" | "failed";

/**
 * Autostart keeps PlayCounter in the tray, where the update banner is never
 * seen. The first successful check of a launch may open the window, unless a
 * game is running. Later checks stay quiet.
 */
export function planUpdateNotice(input: {
  outcome: UpdateCheckOutcome;
  hadSuccessfulCheck: boolean;
  gameRunning: boolean;
}): { reveal: boolean; nextCheckMs: number } {
  if (input.outcome === "failed") {
    return { reveal: false, nextCheckMs: UPDATE_RETRY_MS };
  }
  return {
    reveal:
      input.outcome === "available" &&
      !input.hadSuccessfulCheck &&
      !input.gameRunning,
    nextCheckMs: UPDATE_RECHECK_MS,
  };
}
