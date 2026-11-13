import { Pause, Play, Skull } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { LiveTimerPayload } from "../liveTimer";

/** h:mm:ss, the same digits in every language. */
export function formatLiveTimer(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor((safe % 3600) / 60);
  const rest = safe % 60;
  return `${Math.floor(safe / 3600)}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

/** The pause button's room, kept even while it is hidden, so it never pushes
 *  the pill out of its window. */
const BUTTON_ROOM = 30;
/** .live-timer's padding on both sides. */
const WINDOW_PADDING = 16;

export function LiveTimerPill({
  payload,
  hovered = false,
  onTogglePause,
  onFit,
}: {
  payload: LiveTimerPayload;
  /** The mouse rests on the pill: it takes clicks and shows its button. */
  hovered?: boolean;
  onTogglePause?: () => void;
  /** The width the window needs for the pill, in CSS pixels. */
  onFit?: (width: number) => void;
}) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const paused = payload.pausedAtMs !== null;
  const pillRef = useRef<HTMLDivElement>(null);
  const counts = payload.counts ?? [];
  const pulse = payload.pulse ?? null;
  const [pulsing, setPulsing] = useState<string | null>(null);

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

  // One short pulse per press; nothing in the pill animates on its own.
  useEffect(() => {
    if (!pulse) return undefined;
    setPulsing(pulse.id);
    const handle = window.setTimeout(() => setPulsing(null), 600);
    return () => window.clearTimeout(handle);
  }, [pulse?.id, pulse?.seq]);

  const countsKey = JSON.stringify(counts);
  // The time only changes the width at ten hours; counts change it often.
  const hours = Math.floor((nowMs - payload.countFromMs) / 3_600_000);
  useLayoutEffect(() => {
    const pill = pillRef.current;
    if (!pill || !onFit) return;
    const buttonShown = Boolean(pill.querySelector(".live-timer-button"));
    onFit(
      Math.ceil(pill.offsetWidth) +
        WINDOW_PADDING +
        (buttonShown ? 0 : BUTTON_ROOM),
    );
  }, [countsKey, onFit, hours]);

  const shownMs = payload.pausedAtMs ?? nowMs;
  // While paused, Resume stays in sight, so the way back is clear.
  const showButton = Boolean(onTogglePause) && (hovered || paused);

  return (
    <div
      className={`live-timer ${payload.corner.endsWith("right") ? "live-timer-right" : ""}`}
    >
      <div
        ref={pillRef}
        className={`live-timer-pill ${paused ? "live-timer-paused" : ""} ${pulsing ? "live-timer-pulse" : ""}`}
      >
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
        {counts.map((count) => (
          <span key={count.id} className="live-timer-count-part">
            <span className="live-timer-divider" aria-hidden="true" />
            <span
              className={`live-timer-count ${pulsing === count.id ? "live-timer-count-pulse" : ""}`}
            >
              {count.label === null ? (
                <Skull className="live-timer-skull" aria-hidden="true" />
              ) : (
                <span className="live-timer-count-name">{count.label}</span>
              )}
              <b>{count.value}</b>
            </span>
          </span>
        ))}
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
