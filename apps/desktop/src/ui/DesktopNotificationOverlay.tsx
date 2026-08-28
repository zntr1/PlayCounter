import { useLayoutEffect, useState } from "react";
import type { DesktopOverlayMessage } from "../desktopOverlayProtocol";
import { applyTheme } from "../theme";

type Phase = "enter" | "hold" | "exit";

export function DesktopNotificationOverlay({
  message,
  onAction,
  onFinished,
}: {
  message: DesktopOverlayMessage | null;
  onAction: (id: string) => void;
  onFinished: (id: string) => void;
}) {
  const [phase, setPhase] = useState<Phase>("enter");
  const [coverFailed, setCoverFailed] = useState(false);
  const [logoFailed, setLogoFailed] = useState(false);

  // Layout effect, not a plain effect: a new message renders once while `phase`
  // still holds the previous card's value, and a deferred reset lets that stale
  // frame paint -- a visible flash before the enter animation starts.
  useLayoutEffect(() => {
    if (!message) return;
    applyTheme(message.theme, message.accentColor);
    setCoverFailed(false);
    setLogoFailed(false);
    setPhase("enter");
    const enterMs = message.reducedMotion ? 120 : 300;
    const exitMs = message.reducedMotion ? 120 : 200;
    const handles = [
      window.setTimeout(() => setPhase("hold"), enterMs),
      window.setTimeout(() => setPhase("exit"), enterMs + message.durationMs),
      window.setTimeout(
        () => onFinished(message.id),
        enterMs + message.durationMs + exitMs,
      ),
    ];
    return () => handles.forEach((handle) => window.clearTimeout(handle));
  }, [message, onFinished]);

  if (!message) return null;

  const celebration =
    message.kind === "first-detection" || message.kind === "milestone";
  const compact = message.kind === "session-start";
  const sessionSummary = message.kind === "session-summary";
  const phaseClass =
    phase === "enter"
      ? "overlay-card-enter"
      : phase === "exit"
        ? "overlay-card-exit"
        : "overlay-card-hold";

  return (
    <div
      className={`${message.action ? "pointer-events-auto" : "pointer-events-none"} flex h-full w-full items-start justify-end p-1`}
    >
      <article
        className={`desktop-overlay-card ${phaseClass} ${celebration ? "desktop-overlay-card-celebration" : ""} ${compact ? "desktop-overlay-card-compact" : ""} ${message.action ? "desktop-overlay-card-actionable" : ""}`}
        aria-live="polite"
        onClick={message.action ? () => onAction(message.id) : undefined}
      >
        {celebration && !message.reducedMotion ? (
          <div aria-hidden="true" className="desktop-overlay-glints">
            <i />
            <i />
            <i />
          </div>
        ) : null}
        <div className="desktop-overlay-cover">
          {message.coverUrl && !coverFailed ? (
            <img
              src={message.coverUrl}
              alt=""
              onError={() => setCoverFailed(true)}
            />
          ) : (
            <div className="desktop-overlay-cover-fallback" aria-hidden="true">
              {logoFailed ? (
                <span>PC</span>
              ) : (
                <img
                  src="/icon.png"
                  alt=""
                  className="desktop-overlay-logo"
                  onError={() => setLogoFailed(true)}
                />
              )}
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1 self-center">
          <div className="desktop-overlay-kicker">{message.kicker}</div>
          <div className="mt-1 truncate text-[17px] font-semibold leading-tight text-text">
            {message.title}
          </div>
          {message.body ? (
            <div className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-text-muted">
              {message.body}
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 self-center pl-2">
          {message.action && message.actionLabel ? (
            <button
              type="button"
              className="desktop-overlay-action"
              onClick={(event) => {
                event.stopPropagation();
                onAction(message.id);
              }}
            >
              {message.actionLabel}
            </button>
          ) : sessionSummary && message.metric ? (
            <div className="desktop-overlay-session-duration">
              <span>SESSION TIME</span>
              <strong>{message.metric}</strong>
            </div>
          ) : message.metric ? (
            <span className="desktop-overlay-metric">{message.metric}</span>
          ) : message.status === "live" ? (
            <span className="desktop-overlay-live">
              <i /> LIVE
            </span>
          ) : (
            <span className="desktop-overlay-mark" aria-hidden="true">
              P
            </span>
          )}
        </div>
      </article>
    </div>
  );
}
