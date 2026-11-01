import {
  ArrowRight,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CornerDownRight,
  Sparkles,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { appLanguage, getT } from "../i18n";
import {
  toWhatsNew,
  WHATS_NEW_IMAGES,
  type ReleaseNote,
  type WhatsNewPoint,
} from "../releaseNotes";
import { Button, Modal } from "./primitives";
import { tours } from "./tour/tourDefinitions";

const t = getT("shell");

type Page =
  | { kind: "feature"; point: WhatsNewPoint }
  | { kind: "also" }
  | { kind: "earlier" };

/* What's new, after an update and from Settings: one feature per page with
   its picture, then the points without one, then the updates skipped since
   the last time, folded. A release written before pictures existed shows its
   headline and list. "Update available" stays in ReleaseNotesDialog: it only
   has the update's text. */
export function WhatsNewDialog({
  releases,
  onClose,
  onStartTour,
  images = WHATS_NEW_IMAGES,
}: {
  /** Newest first, as findUnseenReleaseNotes returns them. */
  releases: readonly ReleaseNote[];
  onClose: () => void;
  onStartTour?: (id: string) => void;
  images?: Readonly<Record<string, string>>;
}) {
  const language = appLanguage();
  const views = useMemo(
    () => releases.map((note) => toWhatsNew(note, language, images)),
    [releases, language, images],
  );
  const [newest, ...older] = views;
  const pages = useMemo<Page[]>(() => {
    if (!newest) return [];
    return [
      ...newest.pages.map((point) => ({ kind: "feature" as const, point })),
      ...(newest.more.length > 0 || newest.pages.length === 0
        ? [{ kind: "also" as const }]
        : []),
      ...(views.length > 1 ? [{ kind: "earlier" as const }] : []),
    ];
  }, [newest, views.length]);
  const [index, setIndex] = useState(0);
  const [unfolded, setUnfolded] = useState<ReadonlySet<string>>(new Set());
  const count = pages.length;

  // The arrow keys turn the pages. Caught before the controller bridge sees
  // them, so they don't also move the focus.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
      if (
        event.defaultPrevented ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey
      )
        return;
      event.preventDefault();
      const step = event.key === "ArrowRight" ? 1 : -1;
      setIndex((current) => Math.min(count - 1, Math.max(0, current + step)));
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [count]);

  // Next, or Got it on the last page, keeps the focus: A on a controller and
  // Enter turn the pages.
  useEffect(() => {
    document.querySelector<HTMLElement>("[data-whats-new-primary]")?.focus();
  }, [index]);

  if (!newest) return null;
  const page = pages[Math.min(index, count - 1)];
  const last = index >= count - 1;
  const guidesOf = (version: string) =>
    onStartTour ? tours().filter((tour) => tour.release === version) : [];
  const newestGuides = guidesOf(newest.version);
  const pageLabel = (number: number) =>
    t("{{page}} of {{pages}}", { page: number, pages: count });

  return (
    <Modal
      size="wide"
      labelId="whats-new-title"
      eyebrow={t("New update")}
      title={
        views.length > 1
          ? t("What's new since your last update")
          : t("What's new in {{version}}", { version: newest.version })
      }
      icon={Sparkles}
      onClose={onClose}
      // Every page as tall as a picture page, so the buttons don't jump.
      bodyClassName={
        newest.pages.length > 0
          ? "min-h-[min(38.5rem,calc(90vh_-_11rem))]"
          : undefined
      }
      footer={
        <div className="flex items-center gap-3">
          {count > 1 ? (
            <>
              <div className="flex items-center gap-1.5">
                {pages.map((_, number) => (
                  <button
                    key={number}
                    type="button"
                    aria-label={pageLabel(number + 1)}
                    aria-current={number === index ? "step" : undefined}
                    onClick={() => setIndex(number)}
                    className={clsx(
                      "h-2 rounded-full transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
                      number === index
                        ? "w-5 bg-accent"
                        : "w-2 bg-border hover:bg-text-faint",
                    )}
                  />
                ))}
              </div>
              <span className="text-xs tabular-nums text-text-faint">
                {pageLabel(index + 1)}
              </span>
            </>
          ) : null}
          <span className="flex-1" />
          {index > 0 ? (
            <Button
              variant="ghost"
              icon={ChevronLeft}
              onClick={() => setIndex(index - 1)}
            >
              {t("Back")}
            </Button>
          ) : null}
          {last ? (
            <Button
              variant="primary"
              data-autofocus
              data-whats-new-primary
              onClick={onClose}
            >
              {t("Got it")}
            </Button>
          ) : (
            <Button
              variant="primary"
              data-autofocus
              data-whats-new-primary
              onClick={() => setIndex(index + 1)}
            >
              {t("Next")}
              <ChevronRight size={15} aria-hidden="true" />
            </Button>
          )}
        </div>
      }
    >
      <div className="grid gap-5 break-words">
        {page.kind === "feature" ? (
          <FeaturePage point={page.point} />
        ) : page.kind === "also" ? (
          <div className="grid gap-4">
            {newest.pages.length > 0 ? (
              <h3 className="text-xl font-bold text-text">
                {t("Also new in {{version}}", { version: newest.version })}
              </h3>
            ) : (
              <p className="text-base leading-relaxed text-text">
                {newest.headline}
              </p>
            )}
            <PointList points={newest.more} />
          </div>
        ) : (
          <div className="grid gap-4">
            <h3 className="text-xl font-bold text-text">
              {t("Also since your last update")}
            </h3>
            {older.map((release) => {
              const open = unfolded.has(release.version);
              return (
                <section
                  key={release.version}
                  className="rounded-xl border border-border bg-bg p-3.5"
                >
                  <div className="flex items-start gap-3">
                    <span className="shrink-0 rounded-full border border-accent/35 bg-accent-tint px-2 py-0.5 text-xs font-semibold tabular-nums text-accent-ink">
                      {release.version}
                    </span>
                    <p className="min-w-0 text-sm font-semibold text-text">
                      {release.headline}
                    </p>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                    <button
                      type="button"
                      aria-expanded={open}
                      onClick={() =>
                        setUnfolded((previous) => {
                          const next = new Set(previous);
                          if (open) next.delete(release.version);
                          else next.add(release.version);
                          return next;
                        })
                      }
                      className="inline-flex items-center gap-1 text-sm font-medium text-accent-ink hover:underline"
                    >
                      {open ? t("Hide changes") : t("Show changes")}
                      <ChevronDown
                        size={14}
                        aria-hidden="true"
                        className={clsx(
                          "transition-transform",
                          open && "rotate-180",
                        )}
                      />
                    </button>
                    {guidesOf(release.version).map((tour) => (
                      <button
                        key={tour.id}
                        type="button"
                        onClick={() => onStartTour?.(tour.id)}
                        className="inline-flex items-center gap-1 text-sm font-medium text-accent-ink hover:underline"
                      >
                        {tour.title}
                        <ArrowRight size={14} aria-hidden="true" />
                      </button>
                    ))}
                  </div>
                  {open ? (
                    <div className="mt-3">
                      <PointList points={[...release.pages, ...release.more]} />
                    </div>
                  ) : null}
                </section>
              );
            })}
          </div>
        )}
        {last && newestGuides.length > 0 ? (
          <section className="rounded-xl border border-accent/30 bg-accent-tint p-3">
            <h3 className="font-semibold text-text">
              {t("Try the new features")}
            </h3>
            <p className="mb-2 mt-1 text-xs text-text-muted">
              {t(
                "Short guides with sample games to practice on. Nothing you do in them changes your library. You can also start them from ? Help.",
              )}
            </p>
            <div className="grid gap-1">
              {newestGuides.map((tour) => (
                <button
                  key={tour.id}
                  type="button"
                  onClick={() => onStartTour?.(tour.id)}
                  className="flex items-center gap-2 rounded-lg px-2 py-2 text-left text-sm text-text transition hover:bg-surface-hover"
                >
                  <span className="min-w-0 flex-1">{tour.title}</span>
                  <span className="text-xs text-text-muted">
                    {tour.duration}
                  </span>
                  <ArrowRight size={14} className="shrink-0 text-accent-ink" />
                </button>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </Modal>
  );
}

function FeaturePage({ point }: { point: WhatsNewPoint }) {
  return (
    <div>
      {point.imageUrl ? (
        <div className="mb-5 aspect-[2/1] w-full overflow-hidden rounded-xl border border-border bg-bg shadow-raised">
          <img
            src={point.imageUrl}
            alt=""
            decoding="async"
            className="h-full w-full object-cover object-top"
          />
        </div>
      ) : null}
      <h3 className="text-xl font-bold text-text">{point.title}</h3>
      <p className="mt-1.5 max-w-prose text-[15px] leading-relaxed text-text-muted">
        {point.text}
      </p>
      {point.hint ? (
        <p className="mt-3 inline-flex items-center gap-2 rounded-lg bg-surface-hover px-2.5 py-1.5 text-sm text-text-muted">
          <CornerDownRight
            size={15}
            aria-hidden="true"
            className="shrink-0 text-accent-ink"
          />
          {point.hint}
        </p>
      ) : null}
    </div>
  );
}

function PointList({ points }: { points: readonly WhatsNewPoint[] }) {
  return (
    <ul className="grid gap-2.5">
      {points.map((point, index) => (
        <li
          key={`${index}:${point.title ?? point.text}`}
          className="rounded-xl border border-border bg-bg px-3.5 py-3 text-sm leading-relaxed"
        >
          {point.title ? (
            <p className="font-semibold text-text">{point.title}</p>
          ) : null}
          <p className="text-text-muted">{point.text}</p>
        </li>
      ))}
    </ul>
  );
}
