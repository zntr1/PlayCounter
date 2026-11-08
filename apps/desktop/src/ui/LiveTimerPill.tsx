import { Pause, Play } from "lucide-react";
import { useEffect, useState } from "react";
import type { LiveTimerPayload } from "../liveTimer";

/** h:mm:ss, the same digits in every language. */
export function formatLiveTimer(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor((safe % 3600) / 60);
  const rest = safe % 60;
  return `${Math.floor(safe / 3600)}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

export function LiveTimerPill({
  payload,
  hovered = false,
  onTogglePause,
}: {
  payload: LiveTimerPayload;
  /** The mouse rests on the pill: it takes clicks and shows its button. */
  hovered?: boolean;
  onTogglePause?: () => void;
}) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const paused = payload.pausedAtMs !== null;

  useEffect(() => {
    // Paused: the digits stand still, nothing to wake up for.
    if (paused) return undefined;
    let handle: number | undefined;
    const tick = () => {
      const now = Date.now();
      setNowMs(now);
      // Wake just after the session's next whole second, so the digits
      // change evenly instead of drifting against the clock.
      const intoSecond = (((now - payload.countFromMs) % 1000) + 1000) % 1000;
      handle = window.setTimeout(tick, 1000 - intoSecond + 10);
    };
    tick();
    return () => window.clearTimeout(handle);
  }, [payload.countFromMs, paused]);

  const shownMs = payload.pausedAtMs ?? nowMs;
  // While paused, Resume stays in sight, so the way back is clear.
  const showButton = Boolean(onTogglePause) && (hovered || paused);

  return (
    <div
      className={`live-timer ${payload.corner.endsWith("right") ? "live-timer-right" : ""}`}
    >
      <div className={`live-timer-pill ${paused ? "live-timer-paused" : ""}`}>
        {paused ? (
          <Pause
            className="live-timer-pause-mark"
            fill="currentColor"
            strokeWidth={0}
            aria-hidden="true"
          />
        ) : (
          <img src="/brand/playcounter-mark-small.svg" alt="" />
        )}
        <time>{formatLiveTimer((shownMs - payload.countFromMs) / 1000)}</time>
        {showButton ? (
          <button
            type="button"
            className="live-timer-button"
            aria-label={paused ? payload.resumeLabel : payload.pauseLabel}
            onClick={onTogglePause}
          >
            {paused ? (
              <Play size={12} fill="currentColor" aria-hidden="true" />
            ) : (
              <Pause size={12} fill="currentColor" aria-hidden="true" />
            )}
          </button>
        ) : null}
      </div>
    </div>
  );
}
