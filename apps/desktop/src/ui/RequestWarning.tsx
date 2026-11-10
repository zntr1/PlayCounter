import { CircleAlert, Clock3 } from "lucide-react";
import { useEffect, useState } from "react";
import { rateLimitDelay, subscribeRateLimit } from "../rateLimitedFetch";
import { getT } from "../i18n";
import { NoticeCard } from "./NoticeCard";

const t = getT("common");

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
  runtimeErrorClosable = true,
}: {
  apiEndpoint: string;
  runtimeError: string | null;
  runtimeErrorClosable?: boolean;
}) {
  const seconds = useRateLimitSeconds(apiEndpoint);
  // Closed for the rest of this pause; the next pause shows again.
  const [pauseClosed, setPauseClosed] = useState(false);
  if (seconds === 0 && pauseClosed) setPauseClosed(false);
  // Closed until a different error comes, or this one goes away and returns.
  const [closedError, setClosedError] = useState<string | null>(null);
  if (!runtimeError && closedError !== null) setClosedError(null);

  const countdown =
    seconds < 60
      ? t("{{seconds}}s", { seconds })
      : t("{{minutes}}m {{seconds}}s", {
          minutes: Math.floor(seconds / 60),
          seconds: seconds % 60,
        });
  const showError =
    runtimeError !== null &&
    (!runtimeErrorClosable || runtimeError !== closedError);
  return (
    <>
      {seconds > 0 && !pauseClosed ? (
        <NoticeCard
          tone="warning"
          icon={<Clock3 size={18} />}
          title={t("Online requests paused")}
          text={t(
            "The server is temporarily busy. Background lookups will retry automatically. Other actions can be tried again after this pause.",
          )}
          aside={
            <span
              role="timer"
              aria-live="off"
              aria-label={t("Time until requests can resume")}
              className="shrink-0 rounded-full bg-warning/15 px-2 font-mono text-xs font-semibold leading-5 tabular-nums text-warning"
            >
              {countdown}
            </span>
          }
          onClose={() => setPauseClosed(true)}
        />
      ) : null}
      {showError ? (
        <NoticeCard
          tone="danger"
          live="alert"
          icon={<CircleAlert size={18} />}
          text={runtimeError}
          onClose={
            runtimeErrorClosable
              ? () => setClosedError(runtimeError)
              : undefined
          }
        />
      ) : null}
    </>
  );
}
