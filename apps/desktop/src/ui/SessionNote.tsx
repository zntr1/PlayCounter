import { NotebookPen } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { SESSION_NOTE_LIMIT } from "../personalLibrary";
import { usePersonalLibraryState } from "./PersonalLibraryContext";
import { appLocale, getT } from "../i18n";

const t = getT("history");

/* A session's own note, the log book entry for that evening. Shown under the
   session and edited in place: Enter saves, Shift+Enter starts a new line,
   Escape cancels, and clicking away keeps what was typed. */
export function SessionNote({
  session,
  editing,
  onEditingChange,
}: {
  session: { id: number; note?: string };
  editing: boolean;
  onEditingChange: (editing: boolean) => void;
}) {
  const setSessionNote = usePersonalLibraryState((s) => s.setSessionNote);
  const note = session.note ?? "";
  const [draft, setDraft] = useState(note);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // Escape closes without saving, even if the closing editor still blurs.
  const done = useRef(false);

  useEffect(() => {
    if (!editing) return;
    done.current = false;
    setDraft(note);
    const input = inputRef.current;
    if (input) {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }
    // Only when the editor opens; a note saved elsewhere meanwhile is kept
    // until then.
  }, [editing]);

  function finish(keep: boolean) {
    if (done.current) return;
    done.current = true;
    if (keep && draft.trim() !== note) setSessionNote(session.id, draft);
    onEditingChange(false);
  }

  if (editing) {
    return (
      <div
        className="grid gap-1.5"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <textarea
          ref={inputRef}
          aria-label={t("Session note")}
          rows={3}
          maxLength={SESSION_NOTE_LIMIT}
          value={draft}
          placeholder={t("What happened? Where did you stop?")}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => finish(true)}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Escape") {
              event.preventDefault();
              finish(false);
            } else if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              finish(true);
            }
          }}
          className="w-full resize-y rounded-lg border border-border bg-bg px-3 py-2 text-[13px] leading-relaxed text-text outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/30"
        />
        <div className="flex items-center gap-3 text-[11px] text-text-faint">
          <span className="min-w-0 flex-1 truncate">
            {t("Enter saves · Shift+Enter starts a new line · Esc cancels")}
          </span>
          <span className="font-mono tabular-nums">
            {draft.length.toLocaleString(appLocale())} /{" "}
            {SESSION_NOTE_LIMIT.toLocaleString(appLocale())}
          </span>
        </div>
      </div>
    );
  }

  if (!note) return null;
  return (
    <button
      type="button"
      title={t("Edit session note")}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        onEditingChange(true);
      }}
      className="flex w-full min-w-0 items-start gap-2 rounded-lg border border-transparent bg-surface-hover/60 px-2.5 py-1.5 text-left text-[13px] leading-relaxed text-text-muted transition hover:border-accent/40 hover:text-text"
    >
      <NotebookPen
        aria-hidden="true"
        size={13}
        className="mt-[3px] shrink-0 text-accent-ink"
      />
      <span className="line-clamp-3 min-w-0 whitespace-pre-wrap break-words">
        {note}
      </span>
    </button>
  );
}
