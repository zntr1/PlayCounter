import clsx from "clsx";
import {
  Eye,
  EyeOff,
  Gamepad2,
  Keyboard,
  Minus,
  Plus,
  Skull,
  Tally5,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type {
  CounterBoxAction,
  CounterBoxLabel,
  CounterBoxPayload,
  CounterBoxRow,
  CounterBoxState,
} from "../counterBox";
import { shortcutFromKey } from "../shortcutKeys";

/* The counter box (docs/counters-plan.md): the running game's counters over
   the game. ↑↓ pick a counter, + and − count it, Esc goes back to the game.
   Each row has its eye (shown while you play) and its keyboard (its own key:
   click, then press a key). The box only shows and sends; the main window
   counts and answers with what it shows next. */

export function CounterBoxWindow({
  payload,
  onAction,
  onFit,
  onClose,
  subscribe,
}: {
  payload: CounterBoxPayload;
  onAction: (action: CounterBoxAction) => void;
  /** The height the window needs, in CSS pixels. */
  onFit: (height: number) => void;
  onClose: (restoreFocus: boolean) => void;
  /** The main window's updates. Returns the unsubscribe. */
  subscribe: (listener: (next: CounterBoxState) => void) => () => void;
}) {
  const label = (key: CounterBoxLabel) => payload.labels[key] ?? key;
  const [box, setBox] = useState(payload.counterBox);
  const [mark, setMark] = useState(0);
  const [name, setName] = useState("");
  const [recording, setRecording] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const closed = useRef(false);
  const latest = useRef({ onClose, onFit });
  latest.current = { onClose, onFit };

  function close(restoreFocus: boolean) {
    if (closed.current) return;
    closed.current = true;
    latest.current.onClose(restoreFocus);
  }

  useEffect(() => {
    rootRef.current?.focus();
    const unsubscribe = subscribe((next) => setBox(next));
    const onBlur = () => close(false);
    window.addEventListener("blur", onBlur);
    return () => {
      unsubscribe();
      window.removeEventListener("blur", onBlur);
    };
    // Runs once: the box lives as long as this window.
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() =>
      latest.current.onFit(Math.ceil(root.getBoundingClientRect().height)),
    );
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  const rows = box.rows;
  const marked = Math.min(mark, Math.max(0, rows.length - 1));

  useEffect(() => {
    listRef.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView?.({ block: "nearest" });
  }, [marked, rows.length]);

  const count = (row: CounterBoxRow | undefined, delta: 1 | -1) => {
    if (row) onAction({ kind: "count", counterId: row.id, delta });
  };

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.target instanceof HTMLInputElement) return;
    if (recording) {
      event.preventDefault();
      if (event.key === "Escape") {
        setRecording(null);
        return;
      }
      // A counter's key may be a Numpad key alone (shortcutKeys.ts).
      const key = shortcutFromKey(event.nativeEvent, { plain: true });
      if (key) {
        onAction({ kind: "key", counterId: recording, key });
        setRecording(null);
      }
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      close(true);
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (rows.length === 0) return;
      setMark(
        (marked + (event.key === "ArrowDown" ? 1 : -1) + rows.length) %
          rows.length,
      );
    } else if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      count(rows[marked], 1);
    } else if (event.key === "-") {
      event.preventDefault();
      count(rows[marked], -1);
    }
  }

  function add() {
    const trimmed = name.trim();
    if (!trimmed) return;
    onAction({ kind: "add", name: trimmed });
    setName("");
    // The new counter comes back on top.
    setMark(0);
  }

  const playthrough = (value: number) => {
    const [before, after = ""] = label(
      "<b>{{value}}</b> this playthrough",
    ).split("<b>{{value}}</b>");
    return (
      <>
        {before}
        <b className="font-mono font-semibold text-text/90">{value}</b>
        {after}
      </>
    );
  };

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className="w-full p-1 outline-none"
    >
      <div className="quick-note-card quick-add-card">
        <div className="flex shrink-0 items-center gap-2.5">
          {box.coverUrl ? (
            <img
              src={box.coverUrl}
              alt=""
              className="h-10 w-[30px] shrink-0 rounded-[5px] object-cover"
            />
          ) : null}
          <div className="min-w-0">
            <div className="desktop-overlay-kicker">{label("Counters")}</div>
            <div className="truncate text-[15px] font-bold text-text">
              {box.gameName}{" "}
              <span className="text-xs font-semibold text-text-muted">
                · {box.playthroughName}
              </span>
            </div>
          </div>
        </div>

        <div
          ref={listRef}
          role="listbox"
          aria-label={label("Counters")}
          className="grid min-h-0 flex-initial content-start gap-1.5 overflow-y-auto pr-0.5"
        >
          {rows.map((row, index) => (
            <div
              key={row.id}
              role="option"
              aria-selected={index === marked}
              onClick={() => setMark(index)}
              className={clsx(
                "flex items-center gap-2.5 rounded-[10px] border px-2.5 py-1.5",
                index === marked
                  ? "border-accent/70 bg-accent-tint"
                  : "border-border bg-surface",
              )}
            >
              <span className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-full bg-surface-hover text-text/85">
                {row.id === "deaths" ? (
                  <Skull size={15} aria-hidden />
                ) : (
                  <Tally5 size={15} aria-hidden />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-text">
                  {row.name}
                </div>
                <div className="truncate text-xs text-text-muted">
                  {playthrough(row.playthrough)}
                </div>
                {row.keyError ? (
                  <div className="truncate text-xs text-danger">
                    {row.keyError}
                  </div>
                ) : null}
              </div>
              <button
                type="button"
                title={
                  row.shown
                    ? label("Shown while you play. Click to hide.")
                    : label("Hidden while you play. Click to show.")
                }
                aria-label={
                  row.shown
                    ? label("Shown while you play. Click to hide.")
                    : label("Hidden while you play. Click to show.")
                }
                aria-pressed={row.shown}
                onClick={() =>
                  onAction({
                    kind: "shown",
                    counterId: row.id,
                    shown: !row.shown,
                  })
                }
                className={clsx(
                  "grid h-7 w-7 shrink-0 place-items-center rounded-lg transition hover:bg-surface-hover",
                  row.shown ? "text-accent-ink" : "text-text-faint",
                )}
              >
                {row.shown ? (
                  <Eye size={15} aria-hidden />
                ) : (
                  <EyeOff size={15} aria-hidden />
                )}
              </button>
              {box.controllerEnabled ? (
                <button
                  type="button"
                  title={
                    row.controller
                      ? label("View + D-pad up counts this one. Click to stop.")
                      : label("Count this one with View + D-pad up.")
                  }
                  aria-label={
                    row.controller
                      ? label("View + D-pad up counts this one. Click to stop.")
                      : label("Count this one with View + D-pad up.")
                  }
                  aria-pressed={row.controller}
                  onClick={() =>
                    onAction({ kind: "controller", counterId: row.id })
                  }
                  className={clsx(
                    "grid h-7 w-7 shrink-0 place-items-center rounded-lg transition hover:bg-surface-hover",
                    row.controller
                      ? "bg-accent/15 text-accent-ink"
                      : "text-text-faint",
                  )}
                >
                  <Gamepad2 size={15} aria-hidden />
                </button>
              ) : null}
              {/* The keyboard is the counter's own key: click, press a key. */}
              <span className="flex shrink-0 items-center gap-0.5">
                <button
                  type="button"
                  title={
                    recording === row.id
                      ? label("Press a key combination…")
                      : row.keyLabel
                        ? label("Click to change the key.")
                        : label(
                            "Set a key that counts this counter while the game runs.",
                          )
                  }
                  aria-label={
                    row.keyLabel
                      ? `${row.keyLabel}. ${label("Click to change the key.")}`
                      : label(
                          "Set a key that counts this counter while the game runs.",
                        )
                  }
                  aria-pressed={recording === row.id}
                  onClick={() =>
                    setRecording(recording === row.id ? null : row.id)
                  }
                  className={clsx(
                    "flex h-7 items-center gap-1.5 rounded-lg px-1.5 transition hover:bg-surface-hover",
                    recording === row.id
                      ? "border border-accent text-accent-ink"
                      : row.keyError
                        ? "text-danger"
                        : row.keyLabel
                          ? "text-accent-ink"
                          : "text-text-faint",
                  )}
                >
                  <Keyboard size={15} aria-hidden />
                  {recording === row.id ? (
                    <span className="text-[11px] font-semibold">
                      {label("Press a key combination…")}
                    </span>
                  ) : row.keyLabel ? (
                    <span className="font-mono text-[11px] font-semibold">
                      {row.keyLabel}
                    </span>
                  ) : null}
                </button>
                {row.keyLabel && recording !== row.id ? (
                  <button
                    type="button"
                    title={label("Remove the key")}
                    aria-label={label("Remove the key")}
                    onClick={() =>
                      onAction({ kind: "key", counterId: row.id, key: null })
                    }
                    className="grid h-5 w-5 place-items-center rounded text-text-faint hover:text-text"
                  >
                    <X size={12} aria-hidden />
                  </button>
                ) : null}
              </span>
              <div className="min-w-[46px] shrink-0 text-right">
                <div className="font-mono text-[22px] font-bold leading-none text-text">
                  {row.session}
                </div>
                <div className="mt-0.5 text-[10.5px] text-text-faint">
                  {label("this session")}
                </div>
              </div>
              <button
                type="button"
                title={label("Take one back")}
                aria-label={label("Take one back")}
                onClick={() => count(row, -1)}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-border bg-bg/50 text-text-muted transition hover:border-text-muted hover:text-text"
              >
                <Minus size={15} strokeWidth={2.5} aria-hidden />
              </button>
              <button
                type="button"
                title={label("Add one")}
                aria-label={label("Add one")}
                onClick={() => count(row, 1)}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-accent/50 bg-accent/10 text-accent-ink transition hover:border-accent hover:bg-accent hover:text-accent-fg"
              >
                <Plus size={15} strokeWidth={2.5} aria-hidden />
              </button>
            </div>
          ))}
        </div>

        {box.notice ? (
          <p role="status" className="shrink-0 text-xs text-danger">
            {box.notice}
          </p>
        ) : null}

        <div className="flex shrink-0 gap-2">
          <input
            value={name}
            maxLength={60}
            aria-label={label("New counter, for example Wins")}
            placeholder={label("New counter, for example Wins")}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                close(true);
              } else if (
                event.key === "Enter" &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                add();
              }
            }}
            className="h-[38px] min-w-0 flex-1 rounded-[10px] border border-border bg-bg px-3 text-sm text-text outline-none placeholder:text-text-faint focus:border-accent focus:ring-2 focus:ring-accent/30"
          />
          <button
            type="button"
            disabled={!name.trim()}
            onClick={add}
            className="rounded-lg bg-accent px-3 text-xs font-semibold text-accent-fg hover:bg-accent-hover disabled:opacity-45"
          >
            {label("Add")}
          </button>
        </div>
        <p className="flex shrink-0 flex-wrap gap-x-3 text-[11px] text-text-faint">
          <span>{label("↑↓ picks · + and − count · Esc closes")}</span>
          {box.undoHint ? <span>{box.undoHint}</span> : null}
        </p>
      </div>
    </div>
  );
}

