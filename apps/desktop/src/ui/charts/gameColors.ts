/* Colours of the games in the stacked playtime chart. The range's six most
   played games get a slot each; the rest is grey "Other". A game keeps the
   slot it got while the range changes (until the app restarts), so whoever
   learned "Witcher is blue" is not misled by the next range. The slots are
   the --color-series-* tokens in styles.css. */

export const GAME_COLOR_COUNT = 6;

const remembered = new Map<string, number>();

/** Slots for games in rank order, most played first. */
export function assignGameColors(keys: readonly string[]) {
  const shown = keys.slice(0, GAME_COLOR_COUNT);
  const slots = new Map<string, number>();
  const used = new Set<number>();
  for (const key of shown) {
    const slot = remembered.get(key);
    if (slot === undefined || used.has(slot)) continue;
    slots.set(key, slot);
    used.add(slot);
  }
  for (const key of shown) {
    if (slots.has(key)) continue;
    let slot = 0;
    while (used.has(slot)) slot += 1;
    slots.set(key, slot);
    used.add(slot);
    remembered.set(key, slot);
  }
  return new Map(shown.map((key) => [key, slots.get(key)!]));
}

export function gameColor(slot: number | undefined) {
  return slot === undefined
    ? "rgb(var(--color-series-other))"
    : `rgb(var(--color-series-${slot + 1}))`;
}

/** Tests start from no remembered colours. */
export function resetGameColors() {
  remembered.clear();
}
