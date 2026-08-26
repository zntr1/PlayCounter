export function adjustmentSecondsFor(
  adjustments: Record<string, number>,
  keys: Iterable<string>,
) {
  let seconds = 0;
  for (const key of new Set(keys)) seconds += adjustments[key] ?? 0;
  return seconds;
}

export function nextAdjustmentSeconds(
  recordedSeconds: number,
  targetSeconds: number,
) {
  return Math.round(targetSeconds) - Math.round(recordedSeconds);
}

export function displayTotalSeconds(
  recordedSeconds: number,
  adjustmentSeconds: number,
) {
  return Math.max(0, recordedSeconds + adjustmentSeconds);
}

/**
 * Provider totals are historical floors, never adjustments. Keeping them
 * separate prevents newly tracked sessions from being added on top of Steam's
 * already-overlapping lifetime counter.
 */
export function effectiveTotalSeconds(
  recordedSeconds: number,
  adjustmentSeconds: number,
  providerFloorSeconds = 0,
) {
  return Math.max(
    displayTotalSeconds(recordedSeconds, adjustmentSeconds),
    Math.max(0, Math.round(providerFloorSeconds)),
  );
}
