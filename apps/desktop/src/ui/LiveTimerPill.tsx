import { useEffect, useState } from "react";
import type { LiveTimerPayload } from "../liveTimer";

/** h:mm:ss, the same digits in every language. */
export function formatLiveTimer(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor((safe % 3600) / 60);
  const rest = safe % 60;
  return `${Math.floor(safe / 3600)}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

export function LiveTimerPill({ payload }: { payload: LiveTimerPayload }) {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    let handle: number | undefined;
    const tick = () => {
      const now = Date.now();
      setNowMs(now);
      // Wake just after the session's next whole second, so the digits
      // change evenly instead of drifting against the clock.
      const intoSecond = (((now - payload.startedAtMs) % 1000) + 1000) % 1000;
      handle = window.setTimeout(tick, 1000 - intoSecond + 10);
    };
    tick();
    return () => window.clearTimeout(handle);
  }, [payload.startedAtMs]);

  return (
    <div
      className={`live-timer ${payload.corner.endsWith("right") ? "live-timer-right" : ""}`}
    >
      <div className="live-timer-pill">
        <img src="/brand/playcounter-mark-small.svg" alt="" />
        <time>{formatLiveTimer((nowMs - payload.startedAtMs) / 1000)}</time>
      </div>
    </div>
  );
}
