import { requestJsonResponse } from "../requestJson";
import { rateLimitDelay } from "../rateLimitedFetch";

export type RateLimitWaitListener = (waiting: boolean) => void;

/** For library lookups and Xbox start's pre-handler 429 only. Never retry a
 * network error: a write may have succeeded before its response was lost. */
export async function requestLibraryJson<T>(
  input: string,
  {
    onRateLimitWait,
    ...init
  }: RequestInit & { onRateLimitWait?: RateLimitWaitListener } = {},
) {
  const waitDeadline = Date.now() + 120_000;
  for (let attempt = 0; ; attempt++) {
    try {
      let delay: number;
      while ((delay = rateLimitDelay(input)) > 0) {
        init.signal?.throwIfAborted();
        const remaining = waitDeadline - Date.now();
        if (remaining <= 0) {
          throw new Error(
            "The server is still busy. Please try importing again after the pause.",
          );
        }
        onRateLimitWait?.(true);
        await pause(Math.min(delay, remaining, 60_000), init.signal);
      }
    } finally {
      onRateLimitWait?.(false);
    }
    const result = await requestJsonResponse<T>(input, {
      ...init,
      timeoutMs: 15_000,
    });
    if (result.status !== 429 || attempt >= 2) return result;
  }
}

function pause(
  milliseconds: number,
  signal?: AbortSignal | null,
): Promise<void> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      globalThis.clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(signal?.reason);
    };
    const timer = globalThis.setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
