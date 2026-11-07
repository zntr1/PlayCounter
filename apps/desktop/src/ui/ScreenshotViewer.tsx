import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FolderOpen,
  ImageOff,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  closeScreenshotViewer,
  deleteScreenshot,
  openScreenshot,
  revealScreenshot,
  screenshotSource,
  useScreenshotViewer,
} from "../screenshots";
import { useAppStore } from "../store";
import { IconButton, useDialogFocus, useEscapeKey } from "./primitives";
import { ModalWindowDragRegion } from "./shell/ModalWindowDragRegion";
import { appLocale, getT } from "../i18n";

const t = getT("history");

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
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented) return;
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
        className="flex min-h-0 flex-1 flex-col outline-none"
      >
        <div className="flex shrink-0 items-center gap-3 px-5 pb-3 pt-12">
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
        <div className="relative flex min-h-0 flex-1 items-center justify-center px-16 pb-8">
          {missing ? (
            <div className="flex flex-col items-center gap-3 text-center text-white/70">
              <ImageOff size={32} />
              <p className="max-w-sm text-sm">
                {t("The picture may have been moved or deleted.")}
              </p>
            </div>
          ) : (
            <img
              key={shot.path}
              src={screenshotSource(shot.path)}
              alt={t("Screenshot from {{takenAt}}", { takenAt })}
              decoding="async"
              draggable={false}
              onError={() => setMissing(true)}
              className="max-h-full max-w-full rounded-lg object-contain shadow-raised"
            />
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
      </div>
    </div>,
    document.body,
  );
}
