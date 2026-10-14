import { useEffect, useRef, useState } from "react";
import type { QuickNoteLabel, QuickNotePayload } from "../quickNote";

const NOTE_LIMIT = 1000;

function elapsed(startedAt: string, nowMs: number) {
  const seconds = Math.max(
    0,
    Math.floor((nowMs - Date.parse(startedAt)) / 1000),
  );
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(rest)}`
    : `${minutes}:${pad(rest)}`;
}

/* The box the quick note hotkey opens over the game. Enter saves, Escape
   cancels, and clicking anywhere else keeps what was typed. Every close
   hands focus back to the game except that last one, where the player already
   chose where to go. */
export function QuickNoteWindow({
  payload,
  onClose,
}: {
  payload: QuickNotePayload;
  /** `note` is null when nothing should be saved. */
  onClose: (note: string | null, restoreFocus: boolean) => void;
}) {
  const label = (key: QuickNoteLabel) => payload.labels[key] ?? key;
  const [draft, setDraft] = useState(payload.note);
  const [now, setNow] = useState(Date.now);
  const [coverFailed, setCoverFailed] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const closed = useRef(false);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  function close(save: boolean, restoreFocus: boolean) {
    if (closed.current) return;
    closed.current = true;
    const text = draftRef.current.trim();
    onClose(save && text !== payload.note.trim() ? text : null, restoreFocus);
  }

  useEffect(() => {
    const input = inputRef.current;
    if (input) {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }
    const onBlur = () => close(true, false);
    window.addEventListener("blur", onBlur);
    return () => window.removeEventListener("blur", onBlur);
    // Runs once: the box closes with whatever is typed at that moment.
  }, []);

  useEffect(() => {
    if (!payload.startedAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [payload.startedAt]);

  return (
    <div className="h-full w-full p-1">
      <form
        className="quick-note-card"
        onSubmit={(event) => {
          event.preventDefault();
          close(true, true);
        }}
      >
        <header className="flex items-center gap-3">
          {payload.coverUrl && !coverFailed ? (
            <img
              src={payload.coverUrl}
              alt=""
              onError={() => setCoverFailed(true)}
              className="h-10 w-[30px] shrink-0 rounded object-cover"
            />
          ) : null}
          <div className="min-w-0 flex-1">
            <div className="desktop-overlay-kicker">
              {label("Session note")}
            </div>
            <div className="truncate text-[15px] font-semibold leading-tight text-text">
              {payload.gameName}
            </div>
          </div>
          <div className="shrink-0 text-right text-[11px] text-text-muted">
            {payload.startedAt ? (
              <span className="inline-flex items-center gap-1.5">
                <i className="h-1.5 w-1.5 rounded-full bg-success" />
                {label("Playing now")}
                <strong className="font-mono tabular-nums text-text">
                  {elapsed(payload.startedAt, now)}
                </strong>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5">
                {label("Session saved")}
                <strong className="font-mono tabular-nums text-text">
                  {payload.duration}
                </strong>
              </span>
            )}
          </div>
        </header>
        <textarea
          ref={inputRef}
          aria-label={label("Session note")}
          value={draft}
          maxLength={NOTE_LIMIT}
          placeholder={label("What happened? Where did you stop?")}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              close(false, true);
            } else if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              close(true, true);
            }
          }}
          className="min-h-0 flex-1 resize-none rounded-xl border border-border bg-bg px-3 py-2 text-sm leading-relaxed text-text outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
        />
        <footer className="flex items-center gap-3 text-[11px] text-text-faint">
          <span className="min-w-0 flex-1 truncate">
            {label("Enter saves · Shift+Enter starts a new line · Esc cancels")}
          </span>
          <span className="font-mono tabular-nums">
            {draft.length.toLocaleString(payload.locale ?? [])} /{" "}
            {NOTE_LIMIT.toLocaleString(payload.locale ?? [])}
          </span>
          <button
            type="button"
            onClick={() => close(false, true)}
            className="rounded-lg px-2.5 py-1 text-xs font-semibold text-text-muted hover:bg-surface-hover hover:text-text"
          >
            {label("Cancel")}
          </button>
          <button
            type="submit"
            className="rounded-lg bg-accent px-3 py-1 text-xs font-semibold text-accent-fg hover:bg-accent-hover"
          >
            {label("Save")}
          </button>
        </footer>
      </form>
    </div>
  );
}
