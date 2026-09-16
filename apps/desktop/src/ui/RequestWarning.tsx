import { Clock3 } from "lucide-react";
import { useEffect, useState } from "react";
import { rateLimitDelay, subscribeRateLimit } from "../rateLimitedFetch";

function useRateLimitSeconds(apiEndpoint: string): number {
  const [seconds, setSeconds] = useState(() =>
    Math.ceil(rateLimitDelay(apiEndpoint) / 1_000),
  );
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const update = () => {
      if (timer !== undefined) globalThis.clearTimeout(timer);
      const delay = rateLimitDelay(apiEndpoint);
      setSeconds(Math.ceil(delay / 1_000));
      timer =
        delay > 0
          ? globalThis.setTimeout(update, Math.min(delay, 1_000))
          : undefined;
    };
    const unsubscribe = subscribeRateLimit(update);
    update();
    return () => {
      unsubscribe();
      if (timer !== undefined) globalThis.clearTimeout(timer);
    };
  }, [apiEndpoint]);
  return seconds;
}

export function RequestWarning({
  apiEndpoint,
  runtimeError,
}: {
  apiEndpoint: string;
  runtimeError: string | null;
}) {
  const seconds = useRateLimitSeconds(apiEndpoint);
  const countdown =
    seconds < 60
      ? `${seconds}s`
      : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return (
    <>
      {seconds > 0 ? (
        <div className="flex items-start gap-3 border-b border-warning-border bg-warning-tint px-7 py-3 text-sm text-warning">
          <Clock3 size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1" role="status">
            <p className="font-medium">Online requests paused</p>
            <p className="mt-0.5">
              The server is temporarily busy. Background lookups will retry
              automatically. Other actions can be tried again after this pause.
            </p>
          </div>
          <span
            role="timer"
            aria-live="off"
            aria-label="Time until requests can resume"
            className="shrink-0 rounded-md border border-warning-border px-2 py-0.5 font-medium tabular-nums"
          >
            {countdown}
          </span>
        </div>
      ) : null}
      {runtimeError ? (
        <div
          role="alert"
          className="border-b border-warning-border bg-warning-tint px-7 py-2 text-sm text-warning"
        >
          {runtimeError}
        </div>
      ) : null}
    </>
  );
}
