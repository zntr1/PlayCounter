import type { GameSource } from "@playcounter/shared";

const VALID_SOURCES = new Set(["igdb", "community", "custom", "unknown"]);

export type GameSecondsRef = {
  gameId: number;
  source?: GameSource | null;
};

export function gameSecondsKey(ref: GameSecondsRef) {
  return `${ref.source ?? "unknown"}:${ref.gameId}`;
}

export function gameSecondsKeys(refs: GameSecondsRef[]) {
  return [...new Set(refs.map(gameSecondsKey))];
}

export function gameSecondsRefFromKey(key: string): GameSecondsRef | null {
  const separator = key.indexOf(":");
  if (separator <= 0 || separator === key.length - 1) return null;
  const source = key.slice(0, separator);
  const gameId = Number(key.slice(separator + 1));
  if (!VALID_SOURCES.has(source) || !Number.isSafeInteger(gameId)) return null;
  return {
    gameId,
    source: source === "unknown" ? null : (source as GameSource),
  };
}

export function sanitizeGameSecondsRecord(
  value: unknown,
  { signed }: { signed: boolean },
): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const result: Record<string, number> = {};
  for (const [key, rawSeconds] of Object.entries(value)) {
    const ref = gameSecondsRefFromKey(key);
    if (
      !ref ||
      typeof rawSeconds !== "number" ||
      !Number.isFinite(rawSeconds)
    ) {
      continue;
    }
    const seconds = Math.round(rawSeconds);
    if (seconds === 0 || (!signed && seconds < 0)) continue;
    result[gameSecondsKey(ref)] = seconds;
  }
  return result;
}
