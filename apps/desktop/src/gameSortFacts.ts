import type { GameSortFacts, GameSortFactsResponse } from "@playcounter/shared";
import { useEffect, useSyncExternalStore } from "react";
import { rateLimitedFetch, responseError } from "./rateLimitedFetch";
import { isOfflineStatus, useAppStore } from "./store";

/* Time to beat and rating for sorting My Games ───────────────────────────────
   IGDB's Main story time and rating for the whole library, loaded when one of
   the two sorts is picked. Memory only, like gameDetails.ts: the server keeps
   them for 30 days, so a restart costs a few requests, never IGDB calls.
   See docs/time-to-beat-sort-plan.md. */

const BATCH_SIZE = 100;
// A batch of games nobody asked about yet waits for two IGDB calls.
const REQUEST_TIMEOUT_MS = 20_000;

/** null = asked, and the server has neither number. */
const cache = new Map<number, GameSortFacts | null>();
const pending = new Set<number>();
let snapshot: ReadonlyMap<number, GameSortFacts | null> = new Map();
const listeners = new Set<() => void>();

function publish() {
  snapshot = new Map(cache);
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

/** Forgets everything loaded. */
export function clearGameSortFacts() {
  cache.clear();
  pending.clear();
  publish();
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
 * Loads the numbers of every game not asked about yet, 100 games a request,
 * one request after another. A failed request throws and caches nothing, so
 * the next call asks again. `signal` stops it between two requests.
 */
export async function loadGameSortFacts(
  igdbIds: readonly number[],
  endpoint: string,
  signal?: AbortSignal,
) {
  const missing = [...new Set(igdbIds)].filter(
    (igdbId) =>
      Number.isSafeInteger(igdbId) &&
      igdbId > 0 &&
      !cache.has(igdbId) &&
      !pending.has(igdbId),
  );
  for (let start = 0; start < missing.length; start += BATCH_SIZE) {
    if (signal?.aborted) return;
    const batch = missing.slice(start, start + BATCH_SIZE);
    for (const igdbId of batch) pending.add(igdbId);
    try {
      const facts = await requestBatch(batch, endpoint);
      const byId = new Map(facts.map((entry) => [entry.igdbId, entry]));
      for (const igdbId of batch) cache.set(igdbId, byId.get(igdbId) ?? null);
    } finally {
      for (const igdbId of batch) pending.delete(igdbId);
    }
    publish();
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
    if (!enabled || offline || igdbIds.length === 0) return;
    const controller = new AbortController();
    // A failure leaves those games at the end until the sort is picked again.
    loadGameSortFacts(igdbIds, endpoint, controller.signal).catch(() => {});
    return () => controller.abort();
  }, [enabled, offline, endpoint, igdbIds]);

  return facts;
}
