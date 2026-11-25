import type { GameSortFacts, GameSortFactsResponse } from "@playcounter/shared";
import { useEffect, useSyncExternalStore } from "react";
import { rateLimitedFetch, responseError } from "./rateLimitedFetch";
import { waitForRequestTurn } from "./requestPace";
import { readServerCache, writeServerCache } from "./serverCache";
import { isOfflineStatus, useAppStore } from "./store";

/* Time to beat and rating for sorting My Games ───────────────────────────────
   IGDB's Main story time and rating for the whole library, loaded when one of
   the two sorts is picked. Kept on this PC (serverCache.ts): the sort stays
   picked between starts, and without that every start would ask about the
   whole library again. A game is asked about again once its numbers are a
   week old; until the answer is in, the old ones sort.
   See docs/time-to-beat-sort-plan.md. */

const BATCH_SIZE = 100;
// A batch of games nobody asked about yet waits for two IGDB calls.
const REQUEST_TIMEOUT_MS = 20_000;
// The server allows the route 30 requests a minute per address, and several
// PCs can share an address (requestPace.ts).
const REQUESTS_PER_MINUTE = 25;
/** Numbers older than this are asked about again. */
const FRESH_FOR_MS = 7 * 24 * 60 * 60 * 1000;
const SAVED_AS = "gameSortFacts";

type Entry = {
  /** null = asked, and the server has neither number. */
  facts: GameSortFacts | null;
  /** When the server answered. */
  at: number;
};

const cache = new Map<number, Entry>();
const pending = new Set<number>();
let snapshot: ReadonlyMap<number, GameSortFacts | null> = new Map();
const listeners = new Set<() => void>();
/** The server the numbers came from. */
let source: string | undefined;
let hydration: Promise<void> | undefined;

function publish() {
  snapshot = new Map(
    [...cache].map(([igdbId, entry]) => [igdbId, entry.facts]),
  );
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Everything loaded so far, by IGDB id. A new object after every batch. */
export function gameSortFactsSnapshot() {
  return snapshot;
}

function isIgdbId(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

const numberOrUndefined = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

/** Reads the numbers a start before this one loaded, once. Something
 *  unreadable counts as nothing saved. */
function hydrate() {
  hydration ??= (async () => {
    let saved: unknown;
    try {
      saved = await readServerCache(SAVED_AS);
    } catch {
      return;
    }
    if (!saved || typeof saved !== "object") return;
    const record = saved as Record<string, unknown>;
    if (typeof record.endpoint !== "string") return;
    if (!record.facts || typeof record.facts !== "object") return;
    for (const [key, value] of Object.entries(record.facts)) {
      const igdbId = Number(key);
      // [rating, mainStorySeconds, when]; null = the server has no number.
      if (!isIgdbId(igdbId) || !Array.isArray(value)) continue;
      const rating = numberOrUndefined(value[0]);
      const mainStorySeconds = numberOrUndefined(value[1]);
      const at = numberOrUndefined(value[2]);
      // A save that finished meanwhile wins over what was on disk.
      if (at === undefined || cache.has(igdbId)) continue;
      cache.set(igdbId, {
        facts:
          rating === undefined && mainStorySeconds === undefined
            ? null
            : {
                igdbId,
                ...(rating !== undefined ? { rating } : {}),
                ...(mainStorySeconds !== undefined ? { mainStorySeconds } : {}),
              },
        at,
      });
    }
    source = record.endpoint;
    publish();
  })();
  return hydration;
}

async function save() {
  try {
    await writeServerCache(SAVED_AS, {
      endpoint: source,
      facts: Object.fromEntries(
        [...cache].map(([igdbId, { facts, at }]) => [
          igdbId,
          [facts?.rating ?? null, facts?.mainStorySeconds ?? null, at],
        ]),
      ),
    });
  } catch {
    // They still count until the app closes; the next start asks again.
  }
}

async function requestBatch(igdbIds: number[], endpoint: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await rateLimitedFetch(
      `${endpoint}/api/games/sort-facts?igdbIds=${igdbIds.join(",")}`,
      { signal: controller.signal },
    );
    if (!response.ok) throw responseError(response);
    const body = (await response.json()) as GameSortFactsResponse;
    return body.facts ?? [];
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Loads the numbers of every game not asked about yet, or asked about more
 * than a week ago: 100 games a request, one request after another, each in
 * its turn (requestPace.ts). A failed request throws and caches nothing new,
 * so the next call asks again. `signal` stops it between two requests.
 */
export async function loadGameSortFacts(
  igdbIds: readonly number[],
  endpoint: string,
  signal?: AbortSignal,
) {
  await hydrate();
  if (source !== endpoint) {
    // Numbers of another server are not mixed in.
    cache.clear();
    source = endpoint;
    publish();
  }
  const now = Date.now();
  const missing = [...new Set(igdbIds)].filter((igdbId) => {
    if (!isIgdbId(igdbId) || pending.has(igdbId)) return false;
    const entry = cache.get(igdbId);
    return !entry || now - entry.at >= FRESH_FOR_MS;
  });
  for (let start = 0; start < missing.length; start += BATCH_SIZE) {
    if (signal?.aborted) return;
    const batch = missing.slice(start, start + BATCH_SIZE);
    for (const igdbId of batch) pending.add(igdbId);
    try {
      await waitForRequestTurn(
        `${endpoint}/api/games/sort-facts`,
        REQUESTS_PER_MINUTE,
        signal,
      );
      const facts = await requestBatch(batch, endpoint);
      const byId = new Map(facts.map((entry) => [entry.igdbId, entry]));
      const at = Date.now();
      for (const igdbId of batch) {
        cache.set(igdbId, { facts: byId.get(igdbId) ?? null, at });
      }
    } finally {
      for (const igdbId of batch) pending.delete(igdbId);
    }
    publish();
    await save();
  }
}

/**
 * The numbers of the given games, loading the missing ones while `enabled`.
 * Offline it only reads what was loaded before.
 */
export function useGameSortFacts(igdbIds: readonly number[], enabled: boolean) {
  const endpoint = useAppStore((state) => state.settings.apiEndpoint);
  const offline = useAppStore((state) =>
    isOfflineStatus(state.backendHealth.status),
  );
  const facts = useSyncExternalStore(subscribe, gameSortFactsSnapshot);

  useEffect(() => {
    if (!enabled || igdbIds.length === 0) return;
    // What this PC already has sorts at once, also offline.
    if (offline) {
      void hydrate();
      return;
    }
    const controller = new AbortController();
    // A failure leaves those games at the end until the sort is picked again.
    loadGameSortFacts(igdbIds, endpoint, controller.signal).catch(() => {});
    return () => controller.abort();
  }, [enabled, offline, endpoint, igdbIds]);

  return facts;
}

/** As after an app start: nothing in memory, what is saved stays. */
export function resetGameSortFactsForTests() {
  cache.clear();
  pending.clear();
  source = undefined;
  hydration = undefined;
  publish();
}
