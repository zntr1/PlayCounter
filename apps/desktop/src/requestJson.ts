const DEFAULT_TIMEOUT_MS = 8_000;

type RequestOptions = RequestInit & { timeoutMs?: number };

/** Keeps cancellation and the deadline active until the response body is read. */
export async function requestJson<T>(
  input: RequestInfo | URL,
  init: RequestOptions = {},
): Promise<T> {
  const result = await requestJsonResponse<T>(input, init);
  if (!result.ok) throw new Error(`${result.status} ${result.statusText}`);
  return result.data;
}

type JsonResponse<T> = { status: number; statusText: string } & (
  | { ok: true; data: T }
  | { ok: false; data?: never }
);

/** Exposes HTTP status for callers with endpoint-specific fallback behavior. */
export function requestJsonResponse<T>(
  input: RequestInfo | URL,
  init: RequestOptions = {},
): Promise<JsonResponse<T>> {
  return requestWithTimeout(
    input,
    init,
    async (response): Promise<JsonResponse<T>> => {
      const status = {
        status: response.status,
        statusText: response.statusText,
      };
      if (!response.ok) return { ...status, ok: false };
      return { ...status, ok: true, data: (await response.json()) as T };
    },
  );
}

/** The deadline covers both fetching and consuming the response. */
export async function requestWithTimeout<T>(
  input: RequestInfo | URL,
  { signal, timeoutMs = DEFAULT_TIMEOUT_MS, ...init }: RequestOptions,
  consume: (response: Response) => T | Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const onAbort = () => controller.abort(signal?.reason);
  if (signal?.aborted) onAbort();
  else signal?.addEventListener("abort", onAbort, { once: true });
  const timeout = globalThis.setTimeout(
    () =>
      controller.abort(
        new DOMException("Request timed out. Try again.", "TimeoutError"),
      ),
    timeoutMs,
  );

  try {
    controller.signal.throwIfAborted();
    const response = await fetch(input, { ...init, signal: controller.signal });
    controller.signal.throwIfAborted();
    const result = await consume(response);
    controller.signal.throwIfAborted();
    return result;
  } catch (error) {
    if (controller.signal.aborted) throw controller.signal.reason;
    throw error;
  } finally {
    globalThis.clearTimeout(timeout);
    signal?.removeEventListener("abort", onAbort);
  }
}
