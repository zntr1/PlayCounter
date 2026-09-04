import type { GameDetails, GameDetailsResponse } from "@playcounter/shared";
import { useEffect, useState } from "react";
import { isOfflineStatus, useAppStore } from "./store";

/* IGDB details for the game details view ─────────────────────────────────────
   Descriptions, genres and companies are decoration: nice to have
   open in front of you, worthless to keep. So they are fetched on demand and
   cached in memory only - never persisted, because the WebView storage budget
   is already spent on sessions and matches (see sessionPersistence.ts).

   One promise per game id for the app's lifetime, the same shape ExeIcon.tsx
   uses for icon extraction, so opening the same card twice costs one request. */

const REQUEST_TIMEOUT_MS = 8_000;

const cache = new Map<number, Promise<GameDetails | null>>();

export type GameDetailsState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; details: GameDetails }
  | { status: "empty" }
  | { status: "offline" }
  | { status: "error" };

async function requestGameDetails(
  igdbId: number,
  endpoint: string,
): Promise<GameDetails | null> {
  const controller = new AbortController();
  const timeout = window.setTimeout(
    () => controller.abort(),
    REQUEST_TIMEOUT_MS,
  );
  try {
    const response = await fetch(
      `${endpoint}/api/games/details?igdbIds=${igdbId}`,
      { signal: controller.signal },
    );
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }
    const body = (await response.json()) as GameDetailsResponse;
    // An API released before this endpoint answers 404, which throws above; an
    // API that knows the route but not the game answers with an empty list.
    return body.details?.find((entry) => entry.igdbId === igdbId) ?? null;
  } finally {
    window.clearTimeout(timeout);
  }
}

export function loadGameDetails(igdbId: number, endpoint: string) {
  let pending = cache.get(igdbId);
  if (!pending) {
    pending = requestGameDetails(igdbId, endpoint).catch((error) => {
      // A failure must not be cached as "this game has no details" - drop the
      // entry so reopening the card tries again.
      cache.delete(igdbId);
      throw error;
    });
    cache.set(igdbId, pending);
  }
  return pending;
}

/** Forgets everything cached. Used when the API endpoint changes. */
export function clearGameDetailsCache() {
  cache.clear();
}

/**
 * Details for one game, or a state explaining why there are none. Addressed by
 * IGDB id so a cache built against another deployment still resolves; pass
 * undefined for a game with no IGDB identity and nothing is requested.
 */
export function useGameDetails(igdbId: number | undefined): GameDetailsState {
  const endpoint = useAppStore((state) => state.settings.apiEndpoint);
  const offline = useAppStore((state) =>
    isOfflineStatus(state.backendHealth.status),
  );
  const [state, setState] = useState<GameDetailsState>({ status: "idle" });

  useEffect(() => {
    if (!igdbId || igdbId <= 0) {
      setState({ status: "empty" });
      return;
    }
    // A cached answer stays usable offline; only a cold read has to give up.
    if (offline && !cache.has(igdbId)) {
      setState({ status: "offline" });
      return;
    }

    let cancelled = false;
    setState({ status: "loading" });
    loadGameDetails(igdbId, endpoint)
      .then((details) => {
        if (cancelled) return;
        setState(details ? { status: "ready", details } : { status: "empty" });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [endpoint, igdbId, offline]);

  return state;
}
