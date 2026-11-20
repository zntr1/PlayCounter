import type { GameCoversResponse } from "@playcounter/shared";
import { create } from "zustand";
import { rateLimitedFetch, responseError } from "./rateLimitedFetch";
import { isOfflineStatus, useAppStore, type AppState } from "./store";

/* Current covers ─────────────────────────────────────────────────────────────
   A game's cover as the server has it now, by IGDB id. Covers change on IGDB
   (service games get new art), and the server compares them again after a
   week (GET /api/games/covers). The copies stored on this PC (exeCache,
   sessions, backups) are identity evidence and are never rewritten: the
   current cover only changes what is drawn (pickedCovers.ts). Memory only,
   asked again at every start and once a day. See docs/cover-refresh-plan.md. */

const BATCH_SIZE = 100;
// A batch of games not checked for a week waits for one IGDB call.
const REQUEST_TIMEOUT_MS = 20_000;
const REFRESH_EVERY_MS = 24 * 60 * 60 * 1000;
// How often a running app looks whether its day is over; also the wait
// after a failed refresh.
const CHECK_EVERY_MS = 60 * 60 * 1000;

export const useCurrentCovers = create<{
  byIgdbId: ReadonlyMap<number, string>;
}>(() => ({ byIgdbId: new Map() }));

/** Forgets every current cover. */
export function clearCurrentCovers() {
  useCurrentCovers.setState({ byIgdbId: new Map() });
}

function usableIds(igdbIds: Iterable<number>) {
  return [...new Set(igdbIds)].filter(
    (igdbId) => Number.isSafeInteger(igdbId) && igdbId > 0,
  );
}

/** Every IGDB id the app keeps a game under. Software and the player's own
 *  games are left out: neither has an IGDB cover to follow. */
export function knownIgdbIds(
  state: Pick<
    AppState,
    | "gameMetadata"
    | "exeCache"
    | "scopedExeLinks"
    | "libraryImports"
    | "playcounterLibrary"
    | "emulatorMappings"
    | "activeSessions"
    | "recentSessions"
  >,
) {
  const ids: number[] = [];
  const add = (
    entry: { igdbId?: number; source?: string | null },
    included = true,
  ) => {
    if (included && entry.source !== "custom" && entry.igdbId !== undefined) {
      ids.push(entry.igdbId);
    }
  };
  for (const game of state.gameMetadata.values()) add(game);
  for (const entry of state.exeCache.values()) {
    add(entry, entry.state === "matched");
  }
  for (const link of state.scopedExeLinks.values()) add(link);
  for (const entry of state.libraryImports.values()) add(entry);
  for (const entry of state.playcounterLibrary.values()) add(entry);
  for (const mapping of state.emulatorMappings.values()) {
    add(mapping, mapping.decision === "game");
  }
  for (const session of state.activeSessions) add(session);
  for (const session of state.recentSessions) add(session);
  return usableIds(ids);
}

async function requestBatch(igdbIds: number[], endpoint: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await rateLimitedFetch(
      `${endpoint}/api/games/covers?igdbIds=${igdbIds.join(",")}`,
      { signal: controller.signal },
    );
    if (!response.ok) throw responseError(response);
    const body = (await response.json()) as GameCoversResponse;
    return body.covers ?? [];
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Asks for the current cover of every given game, 100 games a request, one
 * request after another, also for games asked about before: a day later the
 * answer may be newer. A failed request throws and keeps what was there.
 * `signal` stops it between two requests.
 */
export async function loadCurrentCovers(
  igdbIds: readonly number[],
  endpoint: string,
  signal?: AbortSignal,
) {
  const ids = usableIds(igdbIds);
  for (let start = 0; start < ids.length; start += BATCH_SIZE) {
    if (signal?.aborted) return;
    const covers = await requestBatch(
      ids.slice(start, start + BATCH_SIZE),
      endpoint,
    );
    const byIgdbId = new Map(useCurrentCovers.getState().byIgdbId);
    let changed = false;
    for (const cover of covers) {
      if (typeof cover.coverUrl !== "string" || !cover.coverUrl) continue;
      if (byIgdbId.get(cover.igdbId) === cover.coverUrl) continue;
      byIgdbId.set(cover.igdbId, cover.coverUrl);
      changed = true;
    }
    if (changed) useCurrentCovers.setState({ byIgdbId });
  }
}

/**
 * Keeps the current covers fresh while the app runs: at start, when the
 * server is reachable again, and once a day (the app lives in the tray for
 * days). A failed refresh is tried again an hour later. Returns the stop.
 */
export function startCurrentCoverRefresh(): () => void {
  let stopped = false;
  let active: AbortController | undefined;
  let refreshedAt: number | undefined;

  async function refreshIfDue() {
    if (stopped || active) return;
    if (
      refreshedAt !== undefined &&
      Date.now() - refreshedAt < REFRESH_EVERY_MS
    )
      return;
    const state = useAppStore.getState();
    if (isOfflineStatus(state.backendHealth.status)) return;
    const igdbIds = knownIgdbIds(state);
    const endpoint = state.settings.apiEndpoint.replace(/\/+$/, "");
    const controller = new AbortController();
    active = controller;
    try {
      await loadCurrentCovers(igdbIds, endpoint, controller.signal);
      if (!controller.signal.aborted) refreshedAt = Date.now();
    } catch {
      // Offline, throttled or a server error: the covers stored on this PC
      // keep showing, and the hourly check asks again.
    } finally {
      active = undefined;
    }
  }

  const unsubscribe = useAppStore.subscribe((state, previous) => {
    if (
      state.backendHealth.status === "online" &&
      previous.backendHealth.status !== "online"
    ) {
      void refreshIfDue();
    }
  });
  const timer = setInterval(() => void refreshIfDue(), CHECK_EVERY_MS);
  void refreshIfDue();
  return () => {
    stopped = true;
    active?.abort();
    clearInterval(timer);
    unsubscribe();
  };
}
