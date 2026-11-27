import { PenLine } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { CaptionLabel, CaptionPayload } from "../quickNote";

/** One line, like a photo caption (screenshot/caption.rs). */
const CAPTION_LIMIT = 150;

/* The box the caption key opens over the game, with the picture just taken.
   The picture is already saved: Enter adds the caption, Escape and Skip keep
   the picture without one, and clicking anywhere else keeps what was typed.
   Every close hands focus back to the game except that last one, where the
   player already chose where to go. A click on the picture opens it to mark
   up over the game (docs/session-screenshots-plan.md), with what was typed
   saved as its caption. */
export function ScreenshotCaptionWindow({
  payload,
  onClose,
}: {
  payload: CaptionPayload;
  /** `caption` is null when there is nothing to save. `markUp`: the
   *  picture was clicked to mark it up. */
  onClose: (
    caption: string | null,
    restoreFocus: boolean,
    markUp?: boolean,
  ) => void;
}) {
  const label = (key: CaptionLabel) => payload.labels[key] ?? key;
  const [draft, setDraft] = useState("");
  const [pictureFailed, setPictureFailed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const closed = useRef(false);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  function close(save: boolean, restoreFocus: boolean) {
    if (closed.current) return;
    closed.current = true;
    const text = draftRef.current.trim();
    onClose(save && text ? text : null, restoreFocus);
  }

  function markUp() {
    if (closed.current) return;
    closed.current = true;
    onClose(draftRef.current.trim() || null, false, true);
  }

  useEffect(() => {
    inputRef.current?.focus();
    const onBlur = () => close(true, false);
    window.addEventListener("blur", onBlur);
    return () => window.removeEventListener("blur", onBlur);
    // Runs once: the box closes with whatever is typed at that moment.
  }, []);

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
          <div className="min-w-0 flex-1">
            <div className="desktop-overlay-kicker">{label("SCREENSHOT")}</div>
            <div className="truncate text-[15px] font-semibold leading-tight text-text">
              {payload.gameName}
            </div>
          </div>
          <span className="inline-flex shrink-0 items-center gap-1.5 text-[11px] text-text-muted">
            <i className="h-1.5 w-1.5 rounded-full bg-success" />
            {label("Picture saved · {{time}}").replace(
              "{{time}}",
              payload.caption.takenAt,
            )}
          </span>
        </header>
        {pictureFailed ? (
          <div className="aspect-video w-full shrink-0 rounded-[10px] border border-border bg-surface-hover" />
        ) : (
          <button
            type="button"
            aria-label={label("Mark up")}
            title={label("Mark up")}
            onClick={markUp}
            className="group relative block aspect-video w-full shrink-0 overflow-hidden rounded-[10px] border border-border transition hover:border-accent/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          >
            <img
              src={payload.caption.pictureUrl}
              alt=""
              draggable={false}
              onError={() => setPictureFailed(true)}
              className="h-full w-full object-cover"
            />
            <span
              aria-hidden
              className="absolute bottom-2 right-2 inline-flex items-center gap-1.5 rounded-lg bg-black/70 px-2.5 py-1 text-xs font-semibold text-white opacity-80 transition group-hover:bg-accent group-hover:text-accent-fg group-hover:opacity-100"
            >
              <PenLine size={13} />
              {label("Mark up")}
            </span>
          </button>
        )}
        <input
          ref={inputRef}
          aria-label={label("Caption")}
          value={draft}
          maxLength={CAPTION_LIMIT}
          placeholder={label("What's happening in this picture?")}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              close(false, true);
            } else if (
              event.key === "Enter" &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              close(true, true);
            }
          }}
          className="w-full shrink-0 rounded-xl border border-border bg-bg px-3 py-2 text-sm text-text outline-none placeholder:text-text-faint focus:border-accent focus:ring-2 focus:ring-accent/30"
        />
        <footer className="flex items-center gap-3 text-[11px] text-text-faint">
          {/* Long in some languages: it may take a second line. */}
          <span className="min-w-0 flex-1 leading-snug">
            {label("Enter saves · Esc keeps the picture without a caption")}
          </span>
          <span className="font-mono tabular-nums">
            {draft.length.toLocaleString(payload.locale ?? [])} /{" "}
            {CAPTION_LIMIT.toLocaleString(payload.locale ?? [])}
          </span>
          <button
            type="button"
            onClick={() => close(false, true)}
            className="rounded-lg px-2.5 py-1 text-xs font-semibold text-text-muted hover:bg-surface-hover hover:text-text"
          >
            {label("Skip")}
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
