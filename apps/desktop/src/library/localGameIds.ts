const CUSTOM_GAME_ID_BASE = -1_000_000_000;

export function hashToCustomIdNamespace(value: string) {
  let hash = 0;
  for (const character of value.toLowerCase()) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return CUSTOM_GAME_ID_BASE - (hash % 900_000_000);
}

export function customLocalGameId(exeName: string) {
  return hashToCustomIdNamespace(exeName);
}

export function scopedLocalGameId(exeName: string, normalizedPrefix: string) {
  return hashToCustomIdNamespace(
    `${exeName.toLowerCase()}|${normalizedPrefix.toLowerCase()}`,
  );
}
