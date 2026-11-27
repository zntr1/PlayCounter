import {
  ChevronLeft,
  ChevronRight,
  ImageOff,
  Pencil,
  PenLine,
  Trash2,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
} from "react";
import type {
  ScreenshotBoxAction,
  ScreenshotBoxDone,
  ScreenshotBoxLabel,
  ScreenshotBoxPayload,
  ScreenshotBoxPicture,
  ScreenshotBoxState,
} from "../screenshotBox";
import { cn } from "./cn";
import { MARKUP_TEXTS, MarkupTools, type MarkupTexts } from "./MarkupTools";

/* The screenshot box (docs/session-screenshots-plan.md): the game's own
   pictures over the game, at the newest. It pages, marks up, writes captions
   and recycles; the main window does the work and sends the new list. Like
   the other boxes it has no i18n of its own: its texts come along. */

/** One line, like a photo caption (screenshot/caption.rs). */
const CAPTION_LIMIT = 150;

/** "{{index}} of {{total}}" with the numbers put in. */
function fill(text: string, values: Record<string, string | number>) {
  return text.replace(/\{\{(\w+)\}\}/g, (whole, name: string) =>
    name in values ? String(values[name]) : whole,
  );
}

function toBase64(bytes: Uint8Array) {
  let text = "";
  for (let start = 0; start < bytes.length; start += 0x8000)
    text += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  return btoa(text);
}

type Notice = { text: string; tone: "done" | "failed" };

function BoxIconButton({
  icon: Icon,
  danger = false,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: LucideIcon;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      title={rest["aria-label"]}
      className={cn(
        "inline-grid h-8 w-8 shrink-0 place-items-center rounded-md border border-border text-text-muted transition hover:bg-surface-hover hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
        danger &&
          "hover:border-danger-border hover:bg-danger-tint hover:text-danger",
        className,
      )}
      {...rest}
    >
      <Icon size={16} aria-hidden />
    </button>
  );
}

export function ScreenshotBoxWindow({
  payload,
  onAction,
  onClose,
  subscribe,
}: {
  payload: ScreenshotBoxPayload;
  onAction: (action: ScreenshotBoxAction) => void;
  /** `restoreFocus` is false when the box closes because the player went
   *  elsewhere. */
  onClose: (restoreFocus: boolean) => void;
  /** The main window's new lists; returns how to stop listening. */
  subscribe: (listener: (update: ScreenshotBoxState) => void) => () => void;
}) {
  const label = useCallback(
    (key: ScreenshotBoxLabel, values: Record<string, string | number> = {}) =>
      fill(payload.labels[key] ?? key, values),
    [payload.labels],
  );
  const markupTexts = useMemo(
    () =>
      Object.fromEntries(
        MARKUP_TEXTS.map((key) => [key, label(key)]),
      ) as MarkupTexts,
    [label],
  );
  const [pictures, setPictures] = useState(payload.screenshots.pictures);
  const [index, setIndex] = useState(() =>
    Math.min(
      Math.max(0, payload.screenshots.index),
      payload.screenshots.pictures.length - 1,
    ),
  );
  /** Opened to mark up the picture just taken: the tools close the box. */
  const markUpFirst = payload.screenshots.markUpFirst === true;
  const [marking, setMarking] = useState(markUpFirst);
  const [missing, setMissing] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const shot: ScreenshotBoxPicture | undefined = pictures[index];
  const rootRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const closed = useRef(false);
  const latest = useRef({ pictures, index, marking });
  latest.current = { pictures, index, marking };
  /** A caption on its way to the main window: Save with nothing drawn
   *  waits for it before the box closes, or closing could drop it. */
  const captionSaving = useRef<{
    done: Promise<void>;
    resolve: () => void;
  } | null>(null);
  /** The marks being saved, waiting for the main window's answer. */
  const savingMarks = useRef<{
    path: string;
    resolve: () => void;
    reject: (error: Error) => void;
  } | null>(null);

  const close = useCallback(
    (restoreFocus: boolean) => {
      if (closed.current) return;
      closed.current = true;
      onClose(restoreFocus);
    },
    [onClose],
  );

  const tell = useCallback((next: Notice) => {
    setNotice(next);
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 3500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const answered = useCallback(
    (done: ScreenshotBoxDone) => {
      if (done.kind === "markUp") {
        const waiting = savingMarks.current;
        if (!waiting || waiting.path !== done.path) return;
        savingMarks.current = null;
        if (done.ok) {
          waiting.resolve();
          tell({ text: label("Saved into the picture"), tone: "done" });
        } else
          // i18n-exempt: logged only; mark up shows its own message.
          waiting.reject(new Error("The main window didn't save it."));
      } else if (done.kind === "recycle")
        tell(
          done.ok
            ? { text: label("Moved to the Recycle Bin"), tone: "done" }
            : { text: label("That didn't work"), tone: "failed" },
        );
      else {
        captionSaving.current?.resolve();
        captionSaving.current = null;
        if (!done.ok)
          tell({
            text: label("The caption couldn't be saved."),
            tone: "failed",
          });
      }
    },
    [label, tell],
  );

  // A new list keeps the picture shown; a recycled one gives way to the next.
  useEffect(
    () =>
      subscribe((update) => {
        const { pictures: before, index: at } = latest.current;
        const path = before[at]?.path;
        const next = update.pictures;
        if (!next.length) {
          close(true);
          return;
        }
        const kept = next.findIndex((entry) => entry.path === path);
        setPictures(next);
        setIndex(kept >= 0 ? kept : Math.min(at, next.length - 1));
        if (update.done) answered(update.done);
      }),
    [subscribe, answered, close],
  );

  const go = useCallback(
    (step: number) =>
      setIndex(
        (current) =>
          (current + step + latest.current.pictures.length) %
          latest.current.pictures.length,
      ),
    [],
  );
  const shotPath = shot?.path;
  useEffect(() => setMissing(false), [shotPath]);

  useEffect(() => {
    rootRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      // Mark up handles its own keys (Esc leaves it, Ctrl+Z).
      if (event.defaultPrevented || latest.current.marking) return;
      if (
        event.target instanceof Element &&
        event.target.closest("input, textarea")
      )
        return;
      if (event.key === "Escape") close(true);
      else if (event.key === "ArrowLeft") go(-1);
      else if (event.key === "ArrowRight") go(1);
      else return;
      event.preventDefault();
    }
    // Alt-tab and the like: the box makes way, but never with marks unsaved.
    function onBlur() {
      if (!latest.current.marking) close(false);
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("blur", onBlur);
    };
  }, [close, go]);

  // The title and buttons line up with the picture's edges.
  const [pictureWidth, setPictureWidth] = useState<number | null>(null);
  useLayoutEffect(() => {
    const image = imageRef.current;
    if (!image || typeof ResizeObserver === "undefined") {
      setPictureWidth(null);
      return;
    }
    const measure = () =>
      setPictureWidth(image.getBoundingClientRect().width || null);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(image);
    return () => observer.disconnect();
  }, [shot?.url, missing]);

  if (!shot) return null;
  const captionLine = (
    <CaptionLine
      key={shot.path}
      shot={shot}
      label={label}
      onSave={(caption) => {
        let resolve = () => {};
        const done = new Promise<void>((settle) => (resolve = settle));
        captionSaving.current = { done, resolve };
        onAction({ kind: "caption", path: shot.path, caption });
      }}
    />
  );
  const saveMarks = (png: Uint8Array | null) =>
    png
      ? new Promise<void>((resolve, reject) => {
          savingMarks.current = { path: shot.path, resolve, reject };
          onAction({ kind: "markUp", path: shot.path, png: toBase64(png) });
        })
      : // Nothing drawn: done once a caption on its way is in (at most a
        // few seconds, should the main window not answer).
        Promise.race([
          captionSaving.current?.done ?? Promise.resolve(),
          new Promise<void>((resolve) => window.setTimeout(resolve, 3000)),
        ]);

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-labelledby="screenshot-box-title"
      className="relative flex h-full w-full flex-col items-center justify-center bg-black/85 px-16 pb-6 pt-8 outline-none"
    >
      <div
        style={
          pictureWidth ? { width: Math.max(pictureWidth, 360) } : undefined
        }
        className={cn(
          "flex max-w-full shrink-0 items-center gap-3 pb-3",
          !pictureWidth && "w-full max-w-3xl",
        )}
      >
        <div className="min-w-0 flex-1">
          <h2
            id="screenshot-box-title"
            className="truncate text-base font-semibold text-white"
          >
            {payload.gameName}
          </h2>
          <p className="flex items-center gap-2 text-sm text-white/60">
            {shot.group.current && !marking ? (
              <span
                data-current-session
                className="shrink-0 rounded-full bg-success/15 px-2 text-xs font-semibold text-success"
              >
                {label("This session")}
              </span>
            ) : null}
            <span className="truncate">
              {marking
                ? label(
                    "Draw on the picture. Drag stickers and numbers to move them.",
                  )
                : pictures.length > 1
                  ? label("{{takenAt}} · {{index}} of {{total}}", {
                      takenAt: shot.takenAt,
                      index: index + 1,
                      total: pictures.length,
                    })
                  : shot.takenAt}
            </span>
          </p>
        </div>
        {marking ? null : (
          <div className="flex items-center gap-3">
            {shot.markable && !missing ? (
              <BoxIconButton
                icon={PenLine}
                aria-label={label("Mark up")}
                onClick={() => setMarking(true)}
              />
            ) : null}
            <BoxIconButton
              icon={Trash2}
              danger
              aria-label={label("Move to the Recycle Bin")}
              onClick={() => onAction({ kind: "recycle", path: shot.path })}
            />
            <BoxIconButton
              icon={X}
              aria-label={label("Close")}
              onClick={() => close(true)}
            />
          </div>
        )}
      </div>
      {missing ? (
        <div className="flex flex-col items-center gap-3 text-center text-white/70">
          <ImageOff size={32} />
          <p className="max-w-sm text-sm">
            {label("The picture may have been moved or deleted.")}
          </p>
        </div>
      ) : (
        <>
          <img
            ref={imageRef}
            data-shown
            src={shot.url}
            alt=""
            decoding="async"
            draggable={false}
            onError={() => setMissing(true)}
            className={cn(
              "min-h-0 max-w-full rounded-lg object-contain shadow-raised",
              marking
                ? "max-h-[calc(100%-18rem)]"
                : pictures.length > 1
                  ? "max-h-[calc(100%-13rem)]"
                  : "max-h-[calc(100%-8.5rem)]",
            )}
          />
          {marking ? (
            <MarkupTools
              key={shot.path}
              image={imageRef}
              width={pictureWidth}
              texts={markupTexts}
              save={saveMarks}
              onDone={() => (markUpFirst ? close(true) : setMarking(false))}
              // A caption can come with the marks, under the tools.
              caption={
                <div className="flex h-16 max-w-full shrink-0 items-start justify-center">
                  {captionLine}
                </div>
              }
            />
          ) : (
            <div className="mt-3 flex h-16 max-w-full shrink-0 items-start justify-center">
              {captionLine}
            </div>
          )}
        </>
      )}
      {pictures.length > 1 && !marking ? (
        <PictureRow
          pictures={pictures}
          index={index}
          label={label}
          onPick={setIndex}
        />
      ) : null}
      {marking ? null : (
        <p className="mt-2 text-xs text-white/45">
          {label("Esc takes you back to the game.")}
        </p>
      )}
      {pictures.length > 1 && !marking ? (
        <>
          <BoxIconButton
            icon={ChevronLeft}
            aria-label={label("Previous screenshot")}
            onClick={() => go(-1)}
            className="absolute left-4 top-1/2 h-11 w-11 -translate-y-1/2 border-transparent bg-black/40"
          />
          <BoxIconButton
            icon={ChevronRight}
            aria-label={label("Next screenshot")}
            onClick={() => go(1)}
            className="absolute right-4 top-1/2 h-11 w-11 -translate-y-1/2 border-transparent bg-black/40"
          />
        </>
      ) : null}
      {notice ? (
        <div
          role="status"
          className={cn(
            "absolute bottom-5 right-5 rounded-xl border bg-surface px-4 py-2.5 text-sm text-text shadow-raised",
            notice.tone === "failed" ? "border-danger-border" : "border-border",
          )}
        >
          {notice.text}
        </div>
      ) : null}
    </div>
  );
}

/** Every picture as a small one, each session's under its label, the shown
 *  one marked; a click shows it. */
function PictureRow({
  pictures,
  index,
  label,
  onPick,
}: {
  pictures: ScreenshotBoxPicture[];
  index: number;
  label: (
    key: ScreenshotBoxLabel,
    values?: Record<string, string | number>,
  ) => string;
  onPick: (index: number) => void;
}) {
  const activeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    activeRef.current?.scrollIntoView?.({
      block: "nearest",
      inline: "nearest",
    });
  }, [index]);
  const groups: { label: string; current: boolean; at: number[] }[] = [];
  pictures.forEach((picture, position) => {
    const last = groups[groups.length - 1];
    if (last && pictures[position - 1].group.key === picture.group.key)
      last.at.push(position);
    else
      groups.push({
        label: picture.group.label,
        current: picture.group.current,
        at: [position],
      });
  });
  return (
    <div
      aria-label={label("All screenshots")}
      role="group"
      className="mt-2 flex max-w-full shrink-0 items-end gap-3.5 overflow-x-auto px-1 py-1"
    >
      {groups.map((group) => (
        <div
          key={group.at[0]}
          data-picture-group
          className="grid shrink-0 gap-0.5"
        >
          <span
            className={cn(
              "truncate text-[11px] font-semibold leading-4",
              group.current ? "text-success" : "text-white/50",
            )}
          >
            {group.label}
          </span>
          <div className="flex gap-1.5">
            {group.at.map((position) => (
              <button
                key={pictures[position].path}
                ref={position === index ? activeRef : undefined}
                type="button"
                aria-label={label("Open screenshot {{index}} of {{total}}", {
                  index: position + 1,
                  total: pictures.length,
                })}
                aria-current={position === index ? "true" : undefined}
                title={pictures[position].caption ?? undefined}
                onClick={() => onPick(position)}
                className={cn(
                  "relative block h-12 w-[86px] overflow-hidden rounded-md bg-white/5 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
                  position === index
                    ? "opacity-100 ring-2 ring-accent"
                    : "opacity-50 hover:opacity-90",
                )}
              >
                <img
                  src={pictures[position].thumbUrl}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  draggable={false}
                  className="h-full w-full object-cover"
                />
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** The picture's caption under it: click it to change it. Enter saves, Esc
 *  keeps the old one, clicking elsewhere saves too. */
function CaptionLine({
  shot,
  label,
  onSave,
}: {
  shot: ScreenshotBoxPicture;
  label: (
    key: ScreenshotBoxLabel,
    values?: Record<string, string | number>,
  ) => string;
  onSave: (caption: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(shot.caption ?? "");
  const inputRef = useRef<HTMLInputElement>(null);
  const finished = useRef(false);

  useEffect(() => {
    const input = inputRef.current;
    if (!editing || !input) return;
    finished.current = false;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }, [editing]);

  function finish(save: boolean) {
    if (finished.current) return;
    finished.current = true;
    setEditing(false);
    const caption = draft.trim() || null;
    if (save && caption !== (shot.caption ?? null)) onSave(caption);
    else setDraft(shot.caption ?? "");
  }

  if (editing)
    return (
      <div className="grid w-[36rem] max-w-full gap-1.5">
        <input
          ref={inputRef}
          aria-label={label("Caption")}
          value={draft}
          maxLength={CAPTION_LIMIT}
          placeholder={label("What's happening in this picture?")}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.nativeEvent.isComposing) {
              event.preventDefault();
              finish(true);
            } else if (event.key === "Escape") {
              // Only the editor closes, not the box.
              event.preventDefault();
              finish(false);
            }
          }}
          onBlur={() => finish(true)}
          className="w-full rounded-lg border border-accent bg-white/5 px-3 py-2 text-center text-[15px] text-white outline-none ring-2 ring-accent/30 placeholder:text-white/40"
        />
        <p className="text-center text-[11px] text-white/50">
          {label("Enter saves · Esc cancels")}
        </p>
      </div>
    );
  if (shot.caption)
    return (
      <button
        type="button"
        title={label("Change the caption")}
        onClick={() => setEditing(true)}
        className="group inline-flex max-w-3xl items-center gap-2 rounded-lg px-3 py-1.5 text-[15px] text-white/90 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
      >
        <span className="min-w-0 break-words">
          {label("“{{caption}}”", { caption: shot.caption })}
        </span>
        <Pencil
          size={14}
          aria-hidden
          className="shrink-0 text-white/55 opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100"
        />
      </button>
    );
  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="inline-flex items-center gap-2 rounded-lg border border-dashed border-white/25 px-3 py-1.5 text-sm text-white/60 transition hover:border-white/45 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
    >
      <Pencil size={14} aria-hidden />
      {label("Add a caption")}
    </button>
  );
}
