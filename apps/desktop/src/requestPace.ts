/* The server allows a route a number of requests a minute per address (30 for
   the covers and the sort numbers). The next request gets a 429, and a 429
   pauses every call of the app until the minute is over
   (rateLimitedFetch.ts): no game is recognised meanwhile. Work that sends
   many requests in a row, like a whole library at 100 games a request, waits
   for its turn here before each one. */

// A little more than the server's minute, for clocks that do not agree.
const WINDOW_MS = 61_000;

/** Route → when its last requests were let through. */
const sent = new Map<string, number[]>();

function pause(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const stop = () => {
      clearTimeout(timer);
      reject(signal!.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", stop);
      resolve();
    }, ms);
    signal?.addEventListener("abort", stop, { once: true });
  });
}

/**
 * Resolves when one more request to `route` keeps it at `perMinute` requests
 * in any minute, and counts that request. The first `perMinute` go through
 * at once. Rejects when `signal` stops the work; a stopped wait takes no
 * turn.
 */
export async function waitForRequestTurn(
  route: string,
  perMinute: number,
  signal?: AbortSignal,
) {
  for (;;) {
    signal?.throwIfAborted();
    const now = Date.now();
    const recent = (sent.get(route) ?? []).filter((at) => now - at < WINDOW_MS);
    sent.set(route, recent);
    if (recent.length < perMinute) {
      recent.push(now);
      return;
    }
    await pause(recent[0]! + WINDOW_MS - now, signal);
  }
}

/** As after an app start: no request counted yet. */
export function resetRequestPaceForTests() {
  sent.clear();
}
