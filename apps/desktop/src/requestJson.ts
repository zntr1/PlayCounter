const DEFAULT_TIMEOUT_MS = 8_000;

/** Keeps cancellation and the deadline active until the response body is read. */
export async function requestJson<T>(
  input: RequestInfo | URL,
  {
    signal,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    ...init
  }: RequestInit & {
    timeoutMs?: number;
  } = {},
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
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }
    return (await response.json()) as T;
  } catch (error) {
    if (controller.signal.aborted) throw controller.signal.reason;
    throw error;
  } finally {
    globalThis.clearTimeout(timeout);
    signal?.removeEventListener("abort", onAbort);
  }
}
