import type {
  GameCoverChangesResponse,
  GameCoversResponse,
} from "@playcounter/shared";
import { create } from "zustand";
import { rateLimitedFetch, responseError } from "./rateLimitedFetch";
import { waitForRequestTurn } from "./requestPace";
import { readServerCache, writeServerCache } from "./serverCache";
import { isOfflineStatus, useAppStore, type AppState } from "./store";

/* Current covers ─────────────────────────────────────────────────────────────
   A game's cover as the server has it now, by IGDB id. Covers change on IGDB
   (service games get new art), and the server compares its covers with IGDB
   once a day. The copies stored on this PC (exeCache, sessions, backups) are
   identity evidence and are never rewritten: the current cover only changes
   what is drawn (pickedCovers.ts).

   The app asks about a game once (GET /api/games/covers, 100 games a
   request). After that it reads the server's list of replaced covers (GET
   /api/games/cover-changes): "what was replaced since my last time?", one
   request at a start and once a day, however big the library is. What it
   knows is kept on this PC (serverCache.ts), so the covers are right from the
   first moment of a start, also offline. See docs/cover-refresh-plan.md. */

const BATCH_SIZE = 100;
const REQUEST_TIMEOUT_MS = 20_000;
const REFRESH_EVERY_MS = 24 * 60 * 60 * 1000;
// How often a running app looks whether its day is over; also the wait
// after a failed refresh.
const CHECK_EVERY_MS = 60 * 60 * 1000;
// The server allows each of the two routes 30 requests a minute per address,
// and several PCs can share an address (requestPace.ts).
const REQUESTS_PER_MINUTE = 25;
const SAVED_AS = "currentCovers";

export const useCurrentCovers = create<{
  byIgdbId: ReadonlyMap<number, string>;
}>(() => ({ byIgdbId: new Map() }));

/** Every game asked about so far and its cover on the server; "" when the
 *  server has none. A game in here is never asked about again: the list of
 *  replaced covers keeps it current. */
let asked = new Map<number, string>();
/** How far the list of replaced covers is read. The server's own words,
 *  handed back as they came. */
let cursor: string | undefined;
/** The server all of this came from. */
let source: string | undefined;
let hydration: Promise<void> | undefined;

function publish() {
  const byIgdbId = new Map<number, string>();
  for (const [igdbId, coverUrl] of asked) {
    if (coverUrl) byIgdbId.set(igdbId, coverUrl);
  }
  useCurrentCovers.setState({ byIgdbId });
}

function isIgdbId(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function usableIds(igdbIds: Iterable<number>) {
  return [...new Set(igdbIds)].filter(isIgdbId);
}

/**
 * Reads what a start before this one learned, once: the covers are drawn
 * right away, before the server is asked anything. Something unreadable
 * counts as nothing saved.
 */
export function hydrateCurrentCovers() {
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
    if (!record.covers || typeof record.covers !== "object") return;
    const covers = new Map<number, string>();
    for (const [key, coverUrl] of Object.entries(record.covers)) {
      const igdbId = Number(key);
      if (isIgdbId(igdbId) && typeof coverUrl === "string") {
        covers.set(igdbId, coverUrl);
      }
    }
    source = record.endpoint;
    cursor =
      typeof record.cursor === "string" && record.cursor
        ? record.cursor
        : undefined;
    asked = covers;
    publish();
  })();
  return hydration;
}

async function save() {
  try {
    await writeServerCache(SAVED_AS, {
      endpoint: source,
      cursor,
      covers: Object.fromEntries(asked),
    });
  } catch {
    // It still counts until the app closes; the next start asks again.
  }
}

/** Another server, or one that no longer knows the app's place in its list:
 *  every game is asked about once more. */
function startOver(endpoint: string) {
  asked = new Map();
  cursor = undefined;
  source = endpoint;
  publish();
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

/** One request, in its turn (requestPace.ts). `signal` stops the wait. */
async function ask(url: string, signal?: AbortSignal) {
  await waitForRequestTurn(url.split("?")[0]!, REQUESTS_PER_MINUTE, signal);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await rateLimitedFetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function requestCovers(
  igdbIds: number[],
  endpoint: string,
  signal?: AbortSignal,
) {
  const response = await ask(
    `${endpoint}/api/games/covers?igdbIds=${igdbIds.join(",")}`,
    signal,
  );
  if (!response.ok) throw responseError(response);
  const body = (await response.json()) as Partial<GameCoversResponse>;
  return Array.isArray(body.covers) ? body.covers : [];
}

/** The list of replaced covers after `since`; without it, where to start. */
async function requestChanges(
  since: string | undefined,
  endpoint: string,
  signal?: AbortSignal,
) {
  const response = await ask(
    `${endpoint}/api/games/cover-changes${
      since === undefined ? "" : `?since=${encodeURIComponent(since)}`
    }`,
    signal,
  );
  if (response.status === 400 && since !== undefined) {
    // The server does not take this place in its list (it only refuses a
    // request for that): nothing read from here on could be trusted.
    startOver(endpoint);
    await save();
  }
  if (!response.ok) throw responseError(response);
  const body = (await response.json()) as Partial<GameCoverChangesResponse>;
  if (typeof body.next !== "string" || !body.next) {
    // i18n-exempt: diagnostic, never shown; the refresh is tried again later.
    throw new Error("The list of replaced covers came without its place.");
  }
  return {
    covers: Array.isArray(body.covers) ? body.covers : [],
    next: body.next,
    more: body.more === true,
  };
}

/**
 * Brings the current covers up to date for the given games.
 *
 * 1. On a PC new to this, asks where the list of replaced covers starts.
 * 2. Asks about every game not asked about yet, 100 games a request: all of
 *    them the first time, later only games new to the library.
 * 3. Reads the list of replaced covers on from where it stopped, usually one
 *    request, and takes the covers of the games it has.
 *
 * Saved after every answer, so a failed or stopped refresh goes on where it
 * was. A failed request throws; `signal` stops it (it throws then too).
 */
export async function refreshCurrentCovers(
  igdbIds: readonly number[],
  endpoint: string,
  signal?: AbortSignal,
) {
  await hydrateCurrentCovers();
  if (source !== endpoint) startOver(endpoint);

  // Before the games are asked about: a cover replaced in between is then
  // on the part of the list still to read.
  if (cursor === undefined) {
    cursor = (await requestChanges(undefined, endpoint, signal)).next;
    await save();
  }

  const fresh = usableIds(igdbIds).filter((igdbId) => !asked.has(igdbId));
  for (let start = 0; start < fresh.length; start += BATCH_SIZE) {
    signal?.throwIfAborted();
    const batch = fresh.slice(start, start + BATCH_SIZE);
    const covers = new Map<unknown, unknown>(
      (await requestCovers(batch, endpoint, signal)).map((cover) => [
        cover?.igdbId,
        cover?.coverUrl,
      ]),
    );
    for (const igdbId of batch) {
      const coverUrl = covers.get(igdbId);
      asked.set(igdbId, typeof coverUrl === "string" ? coverUrl : "");
    }
    publish();
    await save();
  }

  for (;;) {
    signal?.throwIfAborted();
    const answer = await requestChanges(cursor, endpoint, signal);
    let changed = false;
    for (const cover of answer.covers) {
      // The list names every game the server stores; only ours are kept.
      if (
        !cover ||
        !asked.has(cover.igdbId) ||
        typeof cover.coverUrl !== "string" ||
        !cover.coverUrl ||
        asked.get(cover.igdbId) === cover.coverUrl
      ) {
        continue;
      }
      asked.set(cover.igdbId, cover.coverUrl);
      changed = true;
    }
    cursor = answer.next;
    if (changed) publish();
    await save();
    if (!answer.more) return;
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
      await refreshCurrentCovers(igdbIds, endpoint, controller.signal);
      refreshedAt = Date.now();
    } catch {
      // Offline, throttled, a server error or stopped: what is known keeps
      // showing, and the hourly check asks again.
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

/** As after an app start: nothing in memory, what is saved stays. */
export function resetCurrentCoversForTests() {
  asked = new Map();
  cursor = undefined;
  source = undefined;
  hydration = undefined;
  useCurrentCovers.setState({ byIgdbId: new Map() });
}
