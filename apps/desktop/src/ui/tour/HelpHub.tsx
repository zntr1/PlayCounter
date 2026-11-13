import { getVersion } from "@tauri-apps/api/app";
import { ArrowRight, Check, CircleHelp, Search, X } from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { Trans } from "react-i18next";
import { getT } from "../../i18n";
import {
  DEFAULT_MENU_SCALE,
  normalizeInterfaceScale,
} from "../../interfaceScale";
import { useAppStore } from "../../store";
import { cn } from "../cn";
import { Button, IconButton } from "../primitives";
import { HandsOnPill } from "./TourCard";
import {
  CORE_TOUR_ID,
  isHandsOn,
  tourCategories,
  tours,
  type TourDefinition,
} from "./tourDefinitions";
import type { TourProgress } from "./tourState";

const t = getT("tour");

/** done: finished as the guide is today. updated: finished before the guide
 *  changed; it still counts as finished, with an "Updated" pill. */
type GuideState = "done" | "updated" | "open";

function guideState(tour: TourDefinition, progress: TourProgress): GuideState {
  const finished = progress.completed[tour.id];
  if (finished === tour.version) return "done";
  return typeof finished === "number" && finished < tour.version
    ? "updated"
    : "open";
}

/** The running app's version, e.g. "1.6.0"; null until it is known. */
function useAppVersion() {
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    getVersion().then(
      (value) => {
        if (current) setVersion(value);
      },
      // Outside the app window (a browser, a test) nothing counts as new.
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, []);
  return version;
}

export function HelpButton() {
  const open = useAppStore((state) => state.helpMenuOpen);
  const setOpen = useAppStore((state) => state.setHelpMenuOpen);
  const menuScale = useAppStore((state) =>
    normalizeInterfaceScale(state.settings.menuScale, DEFAULT_MENU_SCALE),
  );
  // Read once at start, so the hub opens with its "New" marks in place.
  const appVersion = useAppVersion();
  const rootRef = useRef<HTMLDivElement>(null);

  return (
    <div ref={rootRef} className="relative">
      {/* inline-flex: an inline span measures only its line box, which made the
          guide's highlight ring flatter than the button. */}
      <span data-tour="help" className="inline-flex">
        <IconButton
          aria-label={t("Help and tutorials")}
          title={t("Help and tutorials")}
          aria-expanded={open}
          aria-controls="help-tutorials"
          icon={CircleHelp}
          onClick={() => setOpen(!open)}
        />
      </span>
      {open ? (
        <GuideHub
          rootRef={rootRef}
          menuScale={menuScale}
          appVersion={appVersion}
          onClose={(refocus) => {
            setOpen(false);
            if (refocus)
              rootRef.current
                ?.querySelector<HTMLButtonElement>("button")
                ?.focus();
          }}
        />
      ) : null}
    </div>
  );
}

function GuideHub({
  rootRef,
  menuScale,
  appVersion,
  onClose,
}: {
  rootRef: RefObject<HTMLDivElement | null>;
  menuScale: number;
  appVersion: string | null;
  /** refocus: give the keyboard focus back to the ? button. */
  onClose: (refocus: boolean) => void;
}) {
  const startTour = useAppStore((state) => state.startTour);
  const progress = useAppStore((state) => state.tourProgress);
  const [query, setQuery] = useState("");
  const panelRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  // The hub's height with every guide listed.
  const fullHeight = useRef(Infinity);

  // Built on each render, so the hub follows the current language.
  const guides = tours().map((tour) => {
    const state = guideState(tour, progress);
    return {
      tour,
      state,
      // A guide the player finished before is updated for them, not new.
      isNew:
        state === "open" && appVersion !== null && tour.release === appVersion,
    };
  });
  const doneCount = guides.filter((guide) => guide.state !== "open").length;
  const newCount = guides.filter((guide) => guide.isNew).length;
  const unfinished = guides.filter((guide) => guide.state === "open");
  const next =
    unfinished.find((guide) => guide.tour.id === CORE_TOUR_ID) ??
    unfinished[0] ??
    null;
  const firstStart = guides.every((guide) => guide.state === "open");

  const needle = query.trim().toLowerCase();
  const searching = needle !== "";
  const topics = tourCategories()
    .map((category) => {
      const all = guides.filter((guide) => guide.tour.category === category.id);
      return {
        ...category,
        total: all.length,
        done: all.filter((guide) => guide.state !== "open").length,
        shown: all.filter(
          (guide) =>
            !searching ||
            // The app's name is in many texts and has "counter" inside.
            `${guide.tour.title} ${guide.tour.description}`
              .replace(/PlayCounter/g, " ")
              .toLowerCase()
              .includes(needle),
        ),
      };
    })
    .filter((topic) => topic.shown.length > 0);

  useLayoutEffect(() => {
    // The title bar can be scaled independently. Keep the hub inside the
    // window, even when its right edge cannot stay under the Help button.
    const position = () => {
      const root = rootRef.current;
      const panel = panelRef.current;
      if (!root || !panel) return;
      const anchor = root.getBoundingClientRect();
      const width = Math.min(1000, (window.innerWidth - 32) / menuScale);
      const left = Math.max(
        16,
        Math.min(anchor.right, window.innerWidth - 16) - width * menuScale,
      );
      panel.style.width = `${width}px`;
      panel.style.right = `${(anchor.right - left - width * menuScale) / menuScale}px`;
      const room = Math.max(
        0,
        (window.innerHeight - panel.getBoundingClientRect().top - 16) /
          menuScale,
      );
      // As tall as the full list or the window, whichever is less, and the
      // same while a search shortens the list: typing never resizes the hub.
      const scroller = scrollRef.current;
      const list = scroller?.firstElementChild;
      if (!searching && scroller && list instanceof HTMLElement) {
        const listHeight = list.offsetHeight;
        if (listHeight > 0)
          fullHeight.current =
            panel.offsetHeight - scroller.clientHeight + listHeight;
      }
      panel.style.height = `${Math.min(room, fullHeight.current)}px`;
    };
    position();
    window.addEventListener("resize", position);
    return () => window.removeEventListener("resize", position);
  }, [rootRef, menuScale, searching]);

  // Typing searches right away.
  useEffect(() => {
    searchRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const outside = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) onClose(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing) return;
      event.preventDefault();
      // A typed search goes first; the next press closes the hub.
      if (query) {
        setQuery("");
        searchRef.current?.focus();
      } else onClose(true);
    };
    window.addEventListener("mousedown", outside);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("mousedown", outside);
      window.removeEventListener("keydown", escape);
    };
  }, [rootRef, query, onClose]);

  return (
    <div
      ref={panelRef}
      id="help-tutorials"
      // Marks the hub as the owner of Escape, so the page under it keeps its
      // own search and selection.
      role="dialog"
      aria-labelledby="help-hub-title"
      className="absolute right-0 top-11 z-50 flex w-[1000px] flex-col overflow-hidden rounded-[14px] border border-border bg-surface shadow-raised"
    >
      <div className="flex shrink-0 items-center gap-3.5 border-b border-border py-3 pl-4 pr-3">
        <div className="min-w-0 flex-1">
          <h2
            id="help-hub-title"
            className="text-[15px] font-semibold text-text"
          >
            {t("Help & guides")}
          </h2>
          <p className="text-xs text-text-muted">
            {t(
              "Short guides with sample games. Nothing you try changes your library.",
            )}
          </p>
        </div>
        <label className="flex h-[34px] w-[260px] min-w-0 items-center gap-2 rounded-[9px] border border-border bg-bg px-3 text-[13px] text-text-faint transition focus-within:border-accent/70 focus-within:ring-2 focus-within:ring-accent/25">
          <Search size={16} aria-hidden="true" className="shrink-0" />
          <input
            ref={searchRef}
            type="text"
            role="searchbox"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("Search guides…")}
            aria-label={t("Search guides…")}
            className="min-w-0 flex-1 bg-transparent text-text outline-none placeholder:text-text-faint"
          />
        </label>
        <IconButton
          aria-label={t("Close help")}
          icon={X}
          onClick={() => onClose(true)}
        />
      </div>
      {/* A window shorter than the list scrolls it: the bar is easy to see
          here, and the list fades out where more follows. */}
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable] [&::-webkit-scrollbar-thumb:hover]:bg-text-faint [&::-webkit-scrollbar-thumb]:border-surface [&::-webkit-scrollbar-thumb]:bg-text-faint/60"
      >
        <div className="px-[18px] pb-6 pt-4">
          {searching ? null : (
            <div className="flex flex-wrap gap-3.5">
              <ProgressRing
                done={doneCount}
                total={guides.length}
                newCount={newCount}
              />
              {next ? (
                <div
                  data-guide-next
                  className="flex min-w-0 flex-[1_1_320px] items-center gap-3 rounded-xl bg-gradient-to-r from-accent/[0.16] to-accent/[0.04] px-4 py-3.5 ring-1 ring-inset ring-accent/30"
                >
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[11px] bg-accent-tint text-accent-ink ring-1 ring-inset ring-accent/20">
                    <next.tour.icon size={22} aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-accent-ink">
                      {firstStart ? t("Start here") : t("Continue")}
                    </div>
                    <div className="text-[17px] font-semibold leading-6 text-text">
                      {next.tour.title}
                    </div>
                    <div className="text-xs text-text-muted">
                      {next.tour.description}
                    </div>
                  </div>
                  <Button
                    variant="primary"
                    className="shrink-0 whitespace-nowrap"
                    onClick={() => startTour(next.tour.id)}
                  >
                    {t("Start · {{duration}}", {
                      duration: next.tour.duration,
                    })}
                  </Button>
                </div>
              ) : (
                <div
                  data-guide-next
                  className="flex min-w-0 flex-[1_1_320px] items-center gap-3 rounded-xl bg-success/10 px-4 py-3.5 ring-1 ring-inset ring-success/30"
                >
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[11px] bg-success/15 text-success ring-1 ring-inset ring-success/25">
                    <Check size={22} aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-success">
                      {t("All done")}
                    </div>
                    <div className="text-[17px] font-semibold leading-6 text-text">
                      {t("You finished every guide")}
                    </div>
                    <div className="text-xs text-text-muted">
                      {t("Pick any guide below to go through it again.")}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
          {topics.map((topic) => (
            <section
              key={topic.id}
              data-guide-topic={topic.id}
              aria-labelledby={`help-topic-${topic.id}`}
            >
              <div className="mb-2 mt-5 flex items-baseline gap-2.5 px-0.5">
                <h3
                  id={`help-topic-${topic.id}`}
                  className="text-[11.5px] font-bold uppercase tracking-[0.14em] text-text-muted"
                >
                  {topic.title}
                </h3>
                <span className="font-mono text-[11px] font-semibold tabular-nums text-text-faint">
                  {`${topic.done}/${topic.total}`}
                </span>
              </div>
              {/* Three in a row at full width, fewer in a narrow hub. */}
              <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-2.5">
                {topic.shown.map((guide) => (
                  <GuideTile
                    key={guide.tour.id}
                    tour={guide.tour}
                    state={guide.state}
                    isNew={guide.isNew}
                    onStart={() => startTour(guide.tour.id)}
                  />
                ))}
              </div>
            </section>
          ))}
          {topics.length === 0 ? (
            <p className="py-10 text-center text-sm text-text-faint">
              {t("No guide matches that.")}
            </p>
          ) : null}
        </div>
        {/* Sticks to the lower edge while guides follow below it; at the end
            of the list it lies on the empty space under the last row. */}
        <div
          aria-hidden="true"
          className="pointer-events-none sticky bottom-0 -mt-6 h-6 bg-gradient-to-t from-surface to-transparent"
        />
      </div>
    </div>
  );
}

function ProgressRing({
  done,
  total,
  newCount,
}: {
  done: number;
  total: number;
  newCount: number;
}) {
  const radius = 26;
  const length = 2 * Math.PI * radius;
  return (
    <div
      data-guide-progress
      className="flex flex-[0_0_250px] items-center gap-3.5 rounded-xl border border-border bg-bg px-4 py-3.5"
    >
      <svg
        viewBox="0 0 64 64"
        aria-hidden="true"
        className="h-16 w-16 shrink-0"
      >
        <circle
          cx="32"
          cy="32"
          r={radius}
          fill="none"
          strokeWidth="6"
          className="stroke-border"
        />
        {done > 0 ? (
          <circle
            cx="32"
            cy="32"
            r={radius}
            fill="none"
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={`${(length * done) / total} ${length}`}
            transform="rotate(-90 32 32)"
            className="stroke-accent"
          />
        ) : null}
      </svg>
      <div className="min-w-0">
        <div className="text-[13px] font-medium text-text-muted">
          <Trans
            t={t}
            i18nKey="<n>{{done}}</n> of {{total}}"
            values={{ done, total }}
            components={{
              n: (
                <span className="text-[22px] font-bold leading-7 tracking-tight text-text" />
              ),
            }}
          />
        </div>
        <div className="text-xs text-text-muted">
          {newCount > 0
            ? t("guides done · {{count}} new", { count: newCount })
            : t("guides done")}
        </div>
      </div>
    </div>
  );
}

function GuideTile({
  tour,
  state,
  isNew,
  onStart,
}: {
  tour: TourDefinition;
  state: GuideState;
  isNew: boolean;
  onStart: () => void;
}) {
  const done = state !== "open";
  const Icon = done ? Check : tour.icon;
  return (
    <button
      type="button"
      data-guide-tile={tour.id}
      className="group relative flex min-h-[118px] flex-col gap-2 rounded-xl border border-border/80 bg-bg/60 p-3 text-left transition-colors hover:border-accent/50 hover:bg-surface-hover/60 focus-visible:border-accent/50 focus-visible:bg-surface-hover/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
      onClick={onStart}
    >
      {state === "updated" ? (
        <span className="absolute -top-[7px] right-2.5 rounded-full bg-surface px-[7px] py-px text-[10.5px] font-bold uppercase tracking-wide text-accent-ink ring-1 ring-inset ring-accent/60">
          {t("Updated")}
        </span>
      ) : isNew ? (
        <span className="absolute -top-[7px] right-2.5 rounded-full bg-accent px-[7px] py-px text-[10.5px] font-bold uppercase tracking-wide text-accent-fg">
          {t("New")}
        </span>
      ) : null}
      <span className="flex items-center gap-2.5">
        <span
          className={cn(
            "grid h-8 w-8 shrink-0 place-items-center rounded-lg ring-1 ring-inset",
            done
              ? "bg-success/15 text-success ring-success/25"
              : "bg-accent-tint text-accent-ink ring-accent/20",
          )}
        >
          <Icon size={16} aria-hidden="true" />
        </span>
        <span
          className={cn(
            "min-w-0 flex-1 text-sm font-semibold leading-[18px]",
            done ? "text-text-muted" : "text-text",
          )}
        >
          {tour.title}
        </span>
      </span>
      <span className="flex-1">
        <span className="line-clamp-2 text-xs leading-[17px] text-text-muted">
          {tour.description}
        </span>
      </span>
      <span className="flex items-center gap-2 text-[11px] text-text-faint">
        {isHandsOn(tour) ? <HandsOnPill /> : null}
        <span>{tour.duration}</span>
        <span className="ml-auto inline-flex items-center gap-1 font-semibold text-accent-ink opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
          {done ? t("Replay") : t("Start")}
          <ArrowRight size={12} aria-hidden="true" />
        </span>
      </span>
    </button>
  );
}
