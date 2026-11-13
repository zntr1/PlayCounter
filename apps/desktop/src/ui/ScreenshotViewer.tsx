import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FolderOpen,
  ImageOff,
  Pencil,
  Trash2,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import clsx from "clsx";
import { createPortal } from "react-dom";
import {
  closeScreenshotViewer,
  deleteScreenshot,
  openScreenshot,
  revealScreenshot,
  screenshotSource,
  setScreenshotCaption,
  useScreenshotViewer,
  type Screenshot,
} from "../screenshots";
import { isSampleShot } from "../screenshotSample";
import { useAppStore } from "../store";
import { IconButton, useDialogFocus, useEscapeKey } from "./primitives";
import { ModalWindowDragRegion } from "./shell/ModalWindowDragRegion";
import { appLocale, getT } from "../i18n";

const t = getT("history");

/** One line, like a photo caption (screenshot/caption.rs). */
const CAPTION_LIMIT = 150;

/** A session's screenshots, one at a time, over the whole window. */
export function ScreenshotViewer() {
  const shots = useScreenshotViewer((state) => state.shots);
  if (!shots.length) return null;
  return <OpenViewer />;
}

function OpenViewer() {
  const { shots, index, title } = useScreenshotViewer();
  const shot = shots[Math.min(index, shots.length - 1)];
  const panelRef = useRef<HTMLDivElement>(null);
  const [missing, setMissing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  useEscapeKey(closeScreenshotViewer, panelRef);
  useDialogFocus(panelRef);

  const go = useCallback(
    (step: number) =>
      useScreenshotViewer.setState((state) => ({
        index: (state.index + step + state.shots.length) % state.shots.length,
      })),
    [],
  );
  useEffect(() => setMissing(false), [shot.path]);

  // The title and buttons line up with the picture's edges, so they take
  // its width as shown.
  const imageRef = useRef<HTMLImageElement>(null);
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
  }, [shot.path, missing]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented) return;
      // Arrows in the caption field move the text cursor.
      if (
        event.target instanceof Element &&
        event.target.closest("input, textarea")
      )
        return;
      if (event.key === "ArrowLeft") go(-1);
      else if (event.key === "ArrowRight") go(1);
      else return;
      event.preventDefault();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [go]);

  const failed = () =>
    useAppStore.getState().addToast({
      tone: "error",
      title: t("That didn't work"),
      detail: t("The picture may have been moved or deleted."),
    });

  async function remove() {
    setDeleting(true);
    try {
      await deleteScreenshot(shot.path);
      const rest = shots.filter((entry) => entry.path !== shot.path);
      if (!rest.length) closeScreenshotViewer();
      else
        useScreenshotViewer.setState({
          shots: rest,
          index: Math.min(index, rest.length - 1),
        });
      useAppStore.getState().addToast({
        tone: "success",
        title: t("Moved to the Recycle Bin"),
      });
    } catch (error) {
      console.error("screenshot delete failed", error);
      failed();
    } finally {
      setDeleting(false);
    }
  }

  const takenAt = new Date(shot.takenAtMs).toLocaleString(appLocale(), {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const name = title || shot.folder;

  return createPortal(
    <div
      data-modal-backdrop
      data-tour={isSampleShot(shot.path) ? "demo-screenshot-viewer" : undefined}
      className="fixed inset-0 z-50 flex flex-col bg-black/90 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) closeScreenshotViewer();
      }}
    >
      <ModalWindowDragRegion />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="screenshot-viewer-title"
        tabIndex={-1}
        className="relative flex min-h-0 flex-1 flex-col items-center justify-center px-16 pb-6 pt-14 outline-none"
      >
        {/* Lined up with the picture's edges; full width until it shows. */}
        <div
          style={
            pictureWidth ? { width: Math.max(pictureWidth, 360) } : undefined
          }
          className={clsx(
            "flex max-w-full shrink-0 items-center gap-3 pb-3",
            !pictureWidth && "w-full max-w-3xl",
          )}
        >
          <div className="min-w-0 flex-1">
            <h2
              id="screenshot-viewer-title"
              className="truncate text-base font-semibold text-white"
            >
              {name || t("Screenshot")}
            </h2>
            <p className="text-sm text-white/60">
              {shots.length > 1
                ? t("{{takenAt}} · {{index}} of {{total}}", {
                    takenAt,
                    index: index + 1,
                    total: shots.length,
                  })
                : takenAt}
            </p>
          </div>
          {/* Above the window's drag region, which reaches as far down as
              the app's title bar; the title stays draggable. */}
          <div className="relative z-10 flex items-center gap-3">
            <IconButton
              icon={ExternalLink}
              aria-label={t("Open in your picture app")}
              title={t("Open in your picture app")}
              onClick={() =>
                void openScreenshot(shot.path).catch((error) => {
                  console.error("screenshot open failed", error);
                  failed();
                })
              }
            />
            <IconButton
              icon={FolderOpen}
              aria-label={t("Show in folder")}
              title={t("Show in folder")}
              onClick={() =>
                void revealScreenshot(shot.path).catch((error) => {
                  console.error("screenshot reveal failed", error);
                  failed();
                })
              }
            />
            <IconButton
              icon={Trash2}
              intent="danger"
              disabled={deleting}
              aria-label={t("Move to the Recycle Bin")}
              title={t("Move to the Recycle Bin")}
              onClick={() => void remove()}
            />
            <IconButton
              icon={X}
              aria-label={t("Close")}
              title={t("Close")}
              data-autofocus
              onClick={closeScreenshotViewer}
            />
          </div>
        </div>
        {missing ? (
          <div className="flex flex-col items-center gap-3 text-center text-white/70">
            <ImageOff size={32} />
            <p className="max-w-sm text-sm">
              {t("The picture may have been moved or deleted.")}
            </p>
          </div>
        ) : (
          <>
            {/* Leaves room for the title above and the caption below. */}
            <img
              key={shot.path}
              ref={imageRef}
              src={screenshotSource(shot.path)}
              alt={t("Screenshot from {{takenAt}}", { takenAt })}
              decoding="async"
              draggable={false}
              onError={() => setMissing(true)}
              className="max-h-[calc(100%-8.5rem)] min-h-0 max-w-full rounded-lg object-contain shadow-raised"
            />
            <div className="mt-3 flex h-16 max-w-full shrink-0 items-start justify-center">
              <CaptionLine key={shot.path} shot={shot} />
            </div>
          </>
        )}
        {shots.length > 1 ? (
          <>
            <IconButton
              icon={ChevronLeft}
              aria-label={t("Previous screenshot")}
              title={t("Previous screenshot")}
              onClick={() => go(-1)}
              className="absolute left-4 top-1/2 h-11 w-11 -translate-y-1/2 bg-black/40"
            />
            <IconButton
              icon={ChevronRight}
              aria-label={t("Next screenshot")}
              title={t("Next screenshot")}
              onClick={() => go(1)}
              className="absolute right-4 top-1/2 h-11 w-11 -translate-y-1/2 bg-black/40"
            />
          </>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

/** The picture's caption under it: click it to change it. */
function CaptionLine({ shot }: { shot: Screenshot }) {
  const [editing, setEditing] = useState(false);
  const guide = isSampleShot(shot.path) ? "demo-screenshot-caption" : undefined;
  if (editing)
    return (
      <div data-tour={guide} className="w-full max-w-xl">
        <CaptionEditor shot={shot} onDone={() => setEditing(false)} />
      </div>
    );
  if (shot.caption)
    return (
      <button
        data-tour={guide}
        type="button"
        title={t("Change the caption")}
        onClick={() => setEditing(true)}
        className="group inline-flex max-w-3xl items-center gap-2 rounded-lg px-3 py-1.5 text-[15px] text-white/90 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
      >
        <span className="min-w-0 break-words">
          {t("“{{caption}}”", { caption: shot.caption })}
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
      data-tour={guide}
      type="button"
      onClick={() => setEditing(true)}
      className="inline-flex items-center gap-2 rounded-lg border border-dashed border-white/25 px-3 py-1.5 text-sm text-white/60 transition hover:border-white/45 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
    >
      <Pencil size={14} aria-hidden />
      {t("Add a caption")}
    </button>
  );
}

/** Enter saves, Escape keeps the old caption, clicking elsewhere saves too.
 *  An empty caption removes it. */
function CaptionEditor({
  shot,
  onDone,
}: {
  shot: Screenshot;
  onDone: () => void;
}) {
  const [draft, setDraft] = useState(shot.caption ?? "");
  const inputRef = useRef<HTMLInputElement>(null);
  const finished = useRef(false);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }, []);

  function finish(save: boolean) {
    if (finished.current) return;
    finished.current = true;
    onDone();
    const caption = draft.trim() || null;
    if (!save || caption === (shot.caption ?? null)) return;
    void setScreenshotCaption(shot.path, caption).catch((error) => {
      console.error("screenshot caption failed", error);
      useAppStore.getState().addToast({
        tone: "error",
        title: t("That didn't work"),
        detail: t("The caption couldn't be saved."),
      });
    });
  }

  return (
    <div className="grid w-full max-w-xl gap-1.5">
      <input
        ref={inputRef}
        aria-label={t("Caption")}
        value={draft}
        maxLength={CAPTION_LIMIT}
        placeholder={t("What's happening in this picture?")}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.nativeEvent.isComposing) {
            event.preventDefault();
            finish(true);
          } else if (event.key === "Escape") {
            // Only the editor closes, not the viewer.
            event.preventDefault();
            finish(false);
          }
        }}
        onBlur={() => finish(true)}
        className="w-full rounded-lg border border-accent bg-white/5 px-3 py-2 text-center text-[15px] text-white outline-none ring-2 ring-accent/30 placeholder:text-white/40"
      />
      <p className="text-center text-[11px] text-white/50">
        {t("Enter saves · Esc cancels")}
      </p>
    </div>
  );
}
