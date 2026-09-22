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
 * The sum of launcher lifetime totals is a historical floor, never an
 * adjustment. PlayCounter tracking can overlap those totals, so use the
 * higher of its adjusted time and the combined launcher time.
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
