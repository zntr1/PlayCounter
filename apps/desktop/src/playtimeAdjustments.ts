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
 * adjustment. At the import, PlayCounter tracking can overlap those totals, so
 * the higher of the two counts. Everything PlayCounter records after the
 * import is new, so it is added on top of the launcher total. A manual
 * adjustment ("Set total") moves the whole result, launcher time included.
 */
export function effectiveTotalSeconds(
  recordedSeconds: number,
  adjustmentSeconds: number,
  providerFloorSeconds = 0,
  trackedSinceReadSeconds = 0,
) {
  const floor = Math.max(0, Math.round(providerFloorSeconds));
  return displayTotalSeconds(
    Math.max(
      recordedSeconds,
      floor > 0 ? floor + Math.max(0, Math.round(trackedSinceReadSeconds)) : 0,
    ),
    adjustmentSeconds,
  );
}

/**
 * PlayCounter time recorded since the launcher read. Both numbers must come
 * from recordedSecondsByGame() (plus running time), the way the snapshot was
 * taken, so every screen counts the same hours. No snapshot (saves from
 * before it existed): nothing counts yet.
 */
export function trackedSinceReadSeconds(
  recordedSecondsAtRead: number | undefined,
  recordedSecondsNow: number,
) {
  return recordedSecondsAtRead === undefined
    ? 0
    : Math.max(0, recordedSecondsNow - recordedSecondsAtRead);
}
