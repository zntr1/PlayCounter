// Cooldowns are session-only and shared across API routes on the same origin.
// Do not replay writes automatically: callers retain control of retries.
const cooldowns = new Map<string, number>();
const listeners = new Set<() => void>();
export type RateLimitScope = "origin" | "endpoint";

export const RATE_LIMIT_MESSAGE =
  "The server is temporarily busy. Please try this action again after the pause.";

export class RateLimitError extends Error {
  readonly status = 429;
  constructor() {
    super(RATE_LIMIT_MESSAGE);
    this.name = "RateLimitError";
  }
}

export function responseError(
  response: { status: number; statusText: string },
  fallback?: string,
): Error {
  return response.status === 429
    ? new RateLimitError()
    : new Error(fallback ?? `${response.status} ${response.statusText}`);
}

export function subscribeRateLimit(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function cooldownKey(input: RequestInfo | URL, scope: RateLimitScope): string {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
  const parsed = new URL(url, globalThis.location?.href ?? "http://localhost");
  return scope === "endpoint"
    ? `${parsed.origin}${parsed.pathname}`
    : parsed.origin;
}

export function rateLimitDelay(
  input: RequestInfo | URL,
  scope: RateLimitScope = "origin",
): number {
  const key = cooldownKey(input, scope);
  const delay = Math.max(0, (cooldowns.get(key) ?? 0) - Date.now());
  if (!delay) cooldowns.delete(key);
  return delay;
}

export async function rateLimitedFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
  scope: RateLimitScope = "origin",
): Promise<Response> {
  const signal =
    init?.signal ?? (input instanceof Request ? input.signal : undefined);
  signal?.throwIfAborted();
  const delay = rateLimitDelay(input, scope);
  if (delay > 0) {
    return new Response(null, {
      status: 429,
      statusText: "Too Many Requests",
      headers: { "Retry-After": String(Math.ceil(delay / 1000)) },
    });
  }
  const response = await fetch(input, init);
  if (response.status === 429) {
    const value = response.headers.get("Retry-After")?.trim();
    const seconds =
      value && /^\d+(?:\.\d+)?$/.test(value) ? Number(value) : NaN;
    const until = Number.isFinite(seconds)
      ? Date.now() + seconds * 1000
      : value && !/^[+-]?[\d.]+$/.test(value)
        ? Date.parse(value)
        : NaN;
    // Older deployments do not expose Retry-After to the WebView.
    const deadline = Number.isFinite(until)
      ? Math.max(Date.now() + 1_000, until)
      : Date.now() + 60_000;
    // Exempt probes can run during an API cooldown, but must still respect
    // their own 429s (including older servers with a global health limit).
    for (const key of new Set([
      cooldownKey(input, "origin"),
      cooldownKey(input, scope),
    ])) {
      cooldowns.set(key, Math.max(cooldowns.get(key) ?? 0, deadline));
    }
    for (const listener of listeners) listener();
  }
  return response;
}
