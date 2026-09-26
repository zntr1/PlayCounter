import {
  findTourElement,
  findTourTarget,
  tourFocusTarget,
  tourTargetRect,
} from "./tourTargetRect";
import { Check, CircleHelp, MessageSquareHeart, X } from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { PlayCounterAnimatedIcon } from "../../brand/PlayCounterAnimatedIcon";
import {
  DEFAULT_MENU_SCALE,
  normalizeInterfaceScale,
} from "../../interfaceScale";
import { currentPlatform } from "../../platform";
import { useAppStore } from "../../store";
import { Button, IconButton, Switch } from "../primitives";
import type { TourTargetRect } from "./tourCardPosition";
import {
  CORE_TOUR_ID,
  TOUR_CATEGORIES,
  TOURS,
  findTour,
  type TourEventName,
} from "./tourDefinitions";
import { backStepIndex, nextStepIndex } from "./tourNavigation";
import { shouldShowWelcome } from "./tourState";

const TOUR_EVENT = "playcounter:tour-event";
// A real dialog the app opened from a highlighted control, e.g. a confirmation
// behind a setting. It belongs to that control: it takes clicks and keys, and
// its own backdrop replaces the guide's. Practice dialogs carry data-tour and
// stay under the guide's control.
const APP_MODAL = "[data-modal-backdrop]:not([data-tour])";
const insideAppModal = (target: EventTarget | null) =>
  target instanceof Element && Boolean(target.closest(APP_MODAL));

const HELP_TOUR_GROUPS = TOUR_CATEGORIES.map((category) => ({
  ...category,
  tours: TOURS.filter((tour) => tour.category === category.id),
})).filter((group) => group.tours.length > 0);

export function emitTourEvent(name: TourEventName, message?: string) {
  window.dispatchEvent(
    new CustomEvent(TOUR_EVENT, { detail: { name, message } }),
  );
}

export function useTourDemo() {
  const active = useAppStore((state) => state.activeTour);
  const resetToken = useAppStore((state) => state.demoResetToken);
  const tour = active ? findTour(active.tourId) : undefined;
  const step = active && tour ? tour.steps[active.stepIndex] : undefined;
  return {
    active: Boolean(
      active &&
      (tour?.demoGame || (tour?.id === CORE_TOUR_ID && step?.id === "games")),
    ),
    tourId: active?.tourId ?? null,
    resetToken,
  };
}

export function HelpButton() {
  const open = useAppStore((state) => state.helpMenuOpen);
  const setOpen = useAppStore((state) => state.setHelpMenuOpen);
  const startTour = useAppStore((state) => state.startTour);
  const progress = useAppStore((state) => state.tourProgress);
  const menuScale = useAppStore((state) =>
    normalizeInterfaceScale(state.settings.menuScale, DEFAULT_MENU_SCALE),
  );
  const [categoryId, setCategoryId] = useState(HELP_TOUR_GROUPS[0].id);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open) return;
    // The title bar can be scaled independently. Keep the wider picker inside
    // the window, even when its right edge cannot stay under the Help button.
    const position = () => {
      const root = rootRef.current;
      const panel = panelRef.current;
      if (!root || !panel) return;
      const anchor = root.getBoundingClientRect();
      const width = Math.min(720, (window.innerWidth - 32) / menuScale);
      const left = Math.max(
        16,
        Math.min(anchor.right, window.innerWidth - 16) - width * menuScale,
      );
      panel.style.width = `${width}px`;
      panel.style.right = `${(anchor.right - left - width * menuScale) / menuScale}px`;
      panel.style.maxHeight = `${Math.max(0, (window.innerHeight - panel.getBoundingClientRect().top - 16) / menuScale)}px`;
    };
    position();
    window.addEventListener("resize", position);
    return () => window.removeEventListener("resize", position);
  }, [open, menuScale]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      rootRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", escape);
    };
  }, [open, setOpen]);

  return (
    <div ref={rootRef} className="relative">
      {/* inline-flex: an inline span measures only its line box, which made the
          guide's highlight ring flatter than the button. */}
      <span data-tour="help" className="inline-flex">
        <IconButton
          aria-label="Help and tutorials"
          title="Help and tutorials"
          aria-expanded={open}
          aria-controls="help-tutorials"
          icon={CircleHelp}
          onClick={() => setOpen(!open)}
        />
      </span>
      {open ? (
        <div
          ref={panelRef}
          id="help-tutorials"
          className="absolute right-0 top-11 z-50 flex w-[720px] flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-raised"
        >
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3">
            <div>
              <h2 className="font-semibold text-text">Help & tutorials</h2>
              <div className="mt-0.5 text-xs text-text-muted">
                Choose a topic, then pick a guide.
              </div>
            </div>
            <IconButton
              aria-label="Close help"
              icon={X}
              onClick={() => {
                setOpen(false);
                rootRef.current
                  ?.querySelector<HTMLButtonElement>("button")
                  ?.focus();
              }}
            />
          </div>
          {/* As tall as the longest guide list; it only scrolls when the
              window is too short. */}
          <div className="flex min-h-0">
            <div
              role="tablist"
              aria-label="Guide categories"
              aria-orientation="vertical"
              className="flex w-[188px] shrink-0 flex-col gap-1 overflow-y-auto border-r border-border bg-surface-hover/30 p-2"
            >
              {HELP_TOUR_GROUPS.map((group, index) => {
                const selected = group.id === categoryId;
                return (
                  <button
                    key={group.id}
                    id={`help-category-${group.id}`}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    aria-controls={`help-guides-${group.id}`}
                    tabIndex={selected ? 0 : -1}
                    className={`flex shrink-0 items-center justify-between gap-2 rounded-lg px-3 py-3 text-left text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60 ${
                      selected
                        ? "bg-accent-tint text-accent-ink"
                        : "text-text-muted hover:bg-surface-hover hover:text-text"
                    }`}
                    onClick={() => setCategoryId(group.id)}
                    onKeyDown={(event) => {
                      let next = index;
                      if (event.key === "ArrowDown") next += 1;
                      else if (event.key === "ArrowUp") next -= 1;
                      else if (event.key === "Home") next = 0;
                      else if (event.key === "End")
                        next = HELP_TOUR_GROUPS.length - 1;
                      else return;
                      event.preventDefault();
                      const target =
                        HELP_TOUR_GROUPS[
                          (next + HELP_TOUR_GROUPS.length) %
                            HELP_TOUR_GROUPS.length
                        ];
                      setCategoryId(target.id);
                      document
                        .getElementById(`help-category-${target.id}`)
                        ?.focus();
                    }}
                  >
                    <span>{group.title}</span>
                    <span
                      aria-label={`${group.tours.length} ${group.tours.length === 1 ? "guide" : "guides"}`}
                      className="shrink-0 rounded-md bg-surface px-1.5 py-0.5 text-[10px] tabular-nums"
                    >
                      {group.tours.length}
                    </span>
                  </button>
                );
              })}
            </div>
            {/* Every list shares one grid cell so switching topics never
                resizes the panel; hidden lists only keep their height. */}
            <div className="grid min-w-0 flex-1 grid-rows-[minmax(0,1fr)]">
              {HELP_TOUR_GROUPS.map((group) => (
                <div
                  key={group.id}
                  id={`help-guides-${group.id}`}
                  role="tabpanel"
                  aria-labelledby={`help-category-${group.id}`}
                  aria-hidden={group.id !== categoryId}
                  className={`col-start-1 row-start-1 flex min-h-0 min-w-0 flex-col ${
                    group.id === categoryId ? "" : "invisible"
                  }`}
                >
                  <h3 className="shrink-0 px-4 pb-2 pt-4 text-sm font-semibold text-text">
                    {group.title}
                  </h3>
                  <div className="min-h-0 overflow-y-auto px-2 pb-2">
                    {group.tours.map((tour) => {
                      const complete =
                        progress.completed[tour.id] === tour.version;
                      return (
                        <button
                          key={tour.id}
                          type="button"
                          className="flex w-full items-start gap-3 rounded-lg px-2 py-3 text-left hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60"
                          onClick={() => startTour(tour.id)}
                        >
                          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent-tint text-accent-ink">
                            {complete ? (
                              <Check size={16} />
                            ) : (
                              <CircleHelp size={16} />
                            )}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-baseline justify-between gap-3 text-sm font-medium text-text">
                              <span>{tour.title}</span>
                              <span className="shrink-0 whitespace-nowrap text-[11px] font-normal text-text-muted">
                                {complete ? "Replay" : tour.duration}
                              </span>
                            </span>
                            <span className="block text-xs leading-relaxed text-text-muted">
                              {tour.description}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function WelcomePrompt() {
  const [ready, setReady] = useState(false);
  const progress = useAppStore((state) => state.tourProgress);
  const [enableLauncher, setEnableLauncher] = useState(true);
  const markSeen = useAppStore((state) => state.markTourWelcomeSeen);
  const startTour = useAppStore((state) => state.startTour);
  const setLauncherSetting = useAppStore((state) => state.setLauncherSetting);
  const launcherAvailable = currentPlatform() === "windows";

  useEffect(() => {
    const timer = window.setTimeout(() => setReady(true), 1200);
    return () => window.clearTimeout(timer);
  }, []);
  const visible = ready && shouldShowWelcome(progress);

  useEffect(() => {
    if (visible) setEnableLauncher(true);
  }, [visible]);

  if (!visible) return null;

  const close = () => {
    if (launcherAvailable) {
      setLauncherSetting("gameLaunchingEnabled", enableLauncher);
    }
    markSeen();
  };
  return createPortal(
    <ModalFrame onEscape={close}>
      <div className="flex max-h-[calc(100vh-2rem)] w-[440px] max-w-[calc(100vw-32px)] select-text flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-raised">
        <div className="shrink-0 px-6 pt-6">
          <div className="flex flex-col items-center text-center">
            <PlayCounterAnimatedIcon
              size={72}
              playback="once"
              className="mb-4"
            />
            <h2 className="text-xl font-semibold text-text">
              Welcome to PlayCounter
            </h2>
            <p className="mt-2 leading-6 text-text-muted">
              PlayCounter watches for games you launch and tracks how long you
              play, no matter where they came from. A quick tour shows you
              around.
            </p>
          </div>
          <div className="mt-4 flex items-start gap-3 rounded-xl bg-bg p-3">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent-tint text-accent-ink">
              <MessageSquareHeart size={16} />
            </span>
            <p className="text-xs leading-5 text-text-muted">
              <span className="font-medium text-text">
                Built by one developer.
              </span>{" "}
              PlayCounter is new, so expect a few rough edges. Spot one? Use{" "}
              <span className="font-medium text-text">Help & Feedback</span> or join our Discord. I
              read every message and reply.
            </p>
          </div>
        </div>
        {launcherAvailable ? (
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-bg p-4 transition hover:border-accent/40">
              <Switch
                checked={enableLauncher}
                onChange={(event) => setEnableLauncher(event.target.checked)}
                className="mt-1"
              />
              <span>
                <span className="block font-semibold text-text">
                  Use PlayCounter as a launcher
                </span>
                <span className="mt-1 block text-sm leading-5 text-text-muted">
                  Show Play buttons for games PlayCounter can start directly.
                  This is optional, and you can turn it off anytime in Settings
                  if you don't need it or find it annoying.
                </span>
              </span>
            </label>
          </div>
        ) : null}
        <div className="shrink-0 px-6 pb-6 pt-2">
          <div className="grid gap-1">
            <Button
              variant="primary"
              className="w-full py-2.5"
              onClick={() => {
                close();
                startTour(CORE_TOUR_ID);
              }}
            >
              Take the tour
            </Button>
            <Button
              variant="ghost"
              className="mx-auto px-2 py-1 text-xs text-text-faint"
              onClick={close}
            >
              Maybe later
            </Button>
          </div>
        </div>
      </div>
    </ModalFrame>,
    document.body,
  );
}

function ModalFrame({
  children,
  onEscape,
}: {
  children: ReactNode;
  onEscape: () => void;
}) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") onEscape();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onEscape]);
  return (
    <div
      // The backdrop covers the title bar, so it must also allow window dragging.
      data-tauri-drag-region
      className="fixed inset-0 z-[70] grid place-items-center bg-black/65 p-4"
      role="dialog"
      aria-modal="true"
    >
      {children}
    </div>
  );
}

export function TourOverlay() {
  const active = useAppStore((state) => state.activeTour);
  if (!active) return null;
  return <TourRunner key={active.tourId} />;
}

function TourRunner() {
  const active = useAppStore((state) => state.activeTour)!;
  const startTour = useAppStore((state) => state.startTour);
  const goTo = useAppStore((state) => state.goToTourStep);
  const finishTour = useAppStore((state) => state.endTour);
  const skipped = useRef(false);
  // Reaching the end finishes the guide, even with a skipped exercise; the
  // last step still suggests replaying it. Closing the last step with ✕ or
  // Escape counts as finishing it too.
  const endTour = (outcome: "completed" | "dismissed") => {
    const finished =
      outcome === "completed" ||
      (tour !== undefined && active.stepIndex === tour.steps.length - 1);
    finishTour(finished ? "completed" : "dismissed");
    if (finished && tour?.finishView)
      useAppStore.getState().setActiveView(tour.finishView);
  };
  const openGuides = () => {
    endTour("completed");
    useAppStore.getState().setHelpMenuOpen(true);
  };
  const tour = findTour(active.tourId);
  const step = tour?.steps[active.stepIndex];
  const sandbox = Boolean(tour?.practice || tour?.simulation);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [rect, setRect] = useState<TourTargetRect | null>(null);
  const [additionalRects, setAdditionalRects] = useState<TourTargetRect[]>([]);
  const [missing, setMissing] = useState(false);
  const [appModalOpen, setAppModalOpen] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const outcomeRef = useRef<HTMLParagraphElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const measure = () =>
      document.body.style.setProperty(
        "--tour-guide-space",
        `${card.getBoundingClientRect().height}px`,
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(card);
    return () => {
      observer.disconnect();
      document.body.style.removeProperty("--tour-guide-space");
    };
  }, []);

  // Reserve space in the viewport, including portalled dialogs. All measurements
  // stay in viewport pixels, independent of the app's content zoom.
  useLayoutEffect(() => {
    const update = () => {
      document.body.dataset.tourDock =
        window.innerWidth < 1200 ? "bottom" : "side";
    };
    update();
    window.addEventListener("resize", update);
    return () => {
      delete document.body.dataset.tourDock;
      window.removeEventListener("resize", update);
    };
  }, []);

  // A side-docked card would cover a popover at the top right, such as the
  // notification panel. Sit directly to its left instead.
  const [cardRight, setCardRight] = useState<number | null>(null);
  useEffect(() => {
    const selector = step?.positionAnchor;
    if (!selector) {
      setCardRight(null);
      return;
    }
    let frame = 0;
    const update = () => {
      const anchor = findTourElement(selector);
      const bounds = anchor?.getBoundingClientRect();
      const width = cardRef.current?.offsetWidth ?? 390;
      const right =
        window.innerWidth >= 1200 && bounds && bounds.width > 0
          ? Math.min(
              window.innerWidth - width - 16,
              Math.round(window.innerWidth - bounds.left + 16),
            )
          : null;
      setCardRight(right);
      frame = requestAnimationFrame(update);
    };
    update();
    return () => cancelAnimationFrame(frame);
  }, [step?.positionAnchor]);

  useLayoutEffect(() => {
    previousFocus.current = document.activeElement as HTMLElement | null;
    return () => {
      const target = previousFocus.current;
      window.setTimeout(() => {
        if (target?.isConnected) target.focus({ preventScroll: true });
        else
          (
            document.querySelector(
              '[data-tour="help"] button',
            ) as HTMLElement | null
          )?.focus();
      });
    };
  }, []);

  useLayoutEffect(() => {
    if (!step?.anchor) return;
    const scrollTarget = () => {
      findTourTarget(step)?.scrollIntoView({
        block: "nearest",
        inline: "nearest",
        behavior: "instant",
      });
    };
    const frame = requestAnimationFrame(scrollTarget);
    window.addEventListener("resize", scrollTarget);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", scrollTarget);
    };
  }, [step, tour?.practice]);

  useEffect(() => {
    setOutcome(null);
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ message?: string }>).detail;
      if (detail.message) setOutcome(detail.message);
    };
    window.addEventListener(TOUR_EVENT, handler);
    return () => window.removeEventListener(TOUR_EVENT, handler);
  }, [step]);

  useEffect(() => {
    if (!outcome) return;
    const frame = requestAnimationFrame(() =>
      outcomeRef.current?.scrollIntoView({
        block: "nearest",
        behavior: "instant",
      }),
    );
    return () => cancelAnimationFrame(frame);
  }, [outcome]);

  useEffect(() => {
    if (!step) {
      endTour("dismissed");
      return;
    }
    let frame = 0;
    let previousTarget: HTMLElement | null = null;
    const started = performance.now();
    // Images and responsive cards can move a target after the first scroll.
    // Keep pulling it fully into view briefly, unless the reader scrolls.
    let revealUntil = 0;
    const stopReveal = () => {
      revealUntil = 0;
    };
    window.addEventListener("wheel", stopReveal, { passive: true });
    window.addEventListener("touchmove", stopReveal, { passive: true });
    const update = () => {
      setAppModalOpen(Boolean(document.querySelector(APP_MODAL)));
      const element = findTourTarget(step);
      if (element) {
        if (element !== previousTarget) {
          const layer = element.closest('[role="dialog"], [role="menu"]');
          element.scrollIntoView({
            block: "nearest",
            inline: "nearest",
            behavior: "instant",
          });
          revealUntil = performance.now() + 1500;
          // Follow a newly opened menu/dialog without taking focus away from
          // someone reading or navigating the guide's own controls.
          if (
            step.interactive &&
            layer &&
            layer !==
              previousTarget?.closest('[role="dialog"], [role="menu"]') &&
            !cardRef.current?.contains(document.activeElement)
          ) {
            tourFocusTarget(element)?.focus({ preventScroll: true });
          }
          previousTarget = element;
        }
        const measured = tourTargetRect(element);
        if (
          performance.now() < revealUntil &&
          !fullyVisible(element, measured)
        ) {
          element.scrollIntoView({
            block: "nearest",
            inline: "nearest",
            behavior: "instant",
          });
        }
        setRect((current) =>
          current && measured && sameRects([current], [measured])
            ? current
            : measured,
        );
        const measuredAdditional = [
          ...(step.additionalAnchors ?? []),
          ...(sandbox
            ? [
                '[data-tour="demo-library-stage"]',
                '[data-tour="demo-journal"]',
                '[data-tour="demo-library-menu"]',
                '[data-tour="demo-shelf-editor"]',
                '[data-tour="demo-sample-search"]',
              ]
            : []),
        ].flatMap((selector) => {
          const additional = findTourElement(selector);
          const layer = element.closest('[role="dialog"], [role="menu"]');
          if (
            additional === element ||
            (layer && additional && !layer.contains(additional))
          )
            return [];
          const rect = additional ? tourTargetRect(additional) : null;
          return rect ? [rect] : [];
        });
        setAdditionalRects((current) =>
          sameRects(current, measuredAdditional) ? current : measuredAdditional,
        );
        setMissing(false);
      } else {
        setRect(null);
        setAdditionalRects((current) => (current.length ? [] : current));
        if (step.anchor && performance.now() - started > 1500) setMissing(true);
      }
      frame = requestAnimationFrame(update);
    };
    frame = requestAnimationFrame(update);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("wheel", stopReveal);
      window.removeEventListener("touchmove", stopReveal);
    };
  }, [finishTour, step, sandbox]);

  useEffect(() => {
    if (tour?.id === "fix-detection" && step?.id === "intro") {
      window.dispatchEvent(new CustomEvent("playcounter:discovered-reset"));
    }
  }, [step?.id, tour?.id]);

  useEffect(() => {
    if (!tour || !step) return;
    const present = (selector: string) => Boolean(findTourElement(selector));
    const tick = () => {
      if (
        step.advanceOn?.type === "anchor-present" &&
        present(step.advanceOn.selector)
      ) {
        const next = nextStepIndex(tour.steps, active.stepIndex, 1, present);
        if (next < tour.steps.length) goTo(next);
        return;
      }
      if (
        step.retreatWhenMissing &&
        Date.now() - active.enteredStepAt > 300 &&
        !present(step.retreatWhenMissing)
      ) {
        const back = backStepIndex(tour.steps, active.stepIndex, present);
        if (back >= 0) goTo(back, true);
      }
    };
    const timer = window.setInterval(tick, 100);
    return () => window.clearInterval(timer);
  }, [active.enteredStepAt, active.stepIndex, goTo, step, tour]);

  useEffect(() => {
    if (step?.advanceOn?.type !== "event" || !tour) return;
    const eventName = step.advanceOn.name;
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ name?: string }>).detail;
      if (detail?.name !== eventName) return;
      const next = nextStepIndex(tour.steps, active.stepIndex, 1, (selector) =>
        Boolean(document.querySelector(selector)),
      );
      // A step with Next still moves on by itself once its task is done.
      if (next < tour.steps.length) goTo(next);
    };
    window.addEventListener(TOUR_EVENT, handler);
    return () => window.removeEventListener(TOUR_EVENT, handler);
  }, [active.stepIndex, goTo, step, tour]);

  // On a sample game's free-practice step, Next closes any dialog opened
  // there. Closing it yourself counts as Next. A short grace period lets one
  // dialog hand over to the next without skipping ahead.
  useEffect(() => {
    if (!tour?.demoGame || !step?.interactive || !step.manualAdvance) return;
    let opened = false;
    let closedAt = 0;
    const tick = () => {
      if (findTourTarget(step)?.closest('[role="dialog"]')) {
        opened = true;
        closedAt = 0;
        return;
      }
      if (!opened) return;
      closedAt ||= Date.now();
      if (Date.now() - closedAt < 300) return;
      opened = false;
      const next = nextStepIndex(tour.steps, active.stepIndex, 1, (selector) =>
        Boolean(findTourElement(selector)),
      );
      if (next < tour.steps.length) goTo(next);
    };
    const timer = window.setInterval(tick, 100);
    return () => window.clearInterval(timer);
  }, [active.stepIndex, goTo, step, tour]);

  useEffect(() => {
    if (!step) return;
    const allow = [
      ...(step.allow ?? []),
      APP_MODAL,
      ...(step.interactive && sandbox
        ? [
            '[data-tour="demo-library-stage"]',
            '[data-tour="demo-library-modal"]',
            '[data-tour="demo-library-menu"]',
          ]
        : []),
    ];
    const isAllowed = (event: Event) => {
      const path = event.composedPath();
      return path.some(
        (item) =>
          item instanceof Element &&
          (item.matches("[data-tour-card]") ||
            allow.some((selector) => item.matches(selector))),
      );
    };
    const block = (event: Event) => {
      if (event.type === "wheel") return;
      if (isAllowed(event) || isWindowChrome(event)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    const events = [
      "pointerdown",
      "mousedown",
      "click",
      "dblclick",
      "contextmenu",
      "touchstart",
      "wheel",
    ];
    events.forEach((name) =>
      document.addEventListener(name, block, { capture: true, passive: false }),
    );
    const focus = (event: FocusEvent) => {
      if (!isAllowed(event) && !isWindowChrome(event))
        cardRef.current?.focus({ preventScroll: true });
    };
    document.addEventListener("focusin", focus, true);
    const tab = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || event.defaultPrevented) return;
      // An open dialog keeps Tab inside itself.
      if (document.querySelector(APP_MODAL)) return;
      const selector =
        'button:not(:disabled),a[href],input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex]:not([tabindex="-1"])';
      const roots = [
        ...allow.flatMap((entry) => [...document.querySelectorAll(entry)]),
        cardRef.current,
      ].filter((root): root is Element => Boolean(root));
      const controls = [
        ...new Set(
          roots.flatMap((root) => [
            ...(root.matches(selector) ? [root] : []),
            ...root.querySelectorAll(selector),
          ]),
        ),
      ].filter(
        (element): element is HTMLElement =>
          element instanceof HTMLElement &&
          element.getClientRects().length > 0 &&
          !element.closest("[inert]"),
      );
      if (!controls.length) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const current = controls.indexOf(document.activeElement as HTMLElement);
      controls[
        (current + (event.shiftKey ? -1 : 1) + controls.length) %
          controls.length
      ].focus();
    };
    document.addEventListener("keydown", tab, true);
    return () => {
      events.forEach((name) => document.removeEventListener(name, block, true));
      document.removeEventListener("focusin", focus, true);
      document.removeEventListener("keydown", tab, true);
    };
  }, [step, sandbox]);

  useEffect(() => {
    if (!step) return;
    // Wait for the practice step's layout effects to prepare its controls.
    const focusFrame = requestAnimationFrame(() => {
      const target = step.interactive
        ? tourFocusTarget(findTourTarget(step))
        : null;
      (target ?? cardRef.current)?.focus({ preventScroll: true });
    });

    const handleArrowNavigation = (event: KeyboardEvent) => {
      // Page through the guide from anywhere, except inside controls that
      // use the arrow keys themselves: text fields, sliders, menus, tabs,
      // the playthrough ledger and chart cells.
      if (
        event.isComposing ||
        event.defaultPrevented ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        insideAppModal(event.target) ||
        (!(
          event.target instanceof Element &&
          event.target.closest("[data-tour-card]")
        ) &&
          usesArrowKeys(event.target))
      )
        return;
      if (event.key === "ArrowRight") {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (step.interactive && !step.manualAdvance) skipInteractive();
        else advance();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        event.stopImmediatePropagation();
        back();
      }
    };

    // Space always pages the guide, even on a focused checkbox or button, so
    // it never toggles a setting by accident. Typing a space still works.
    const handleSpace = (event: KeyboardEvent) => {
      if (
        event.key !== " " ||
        event.isComposing ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        acceptsText(event.target) ||
        insideAppModal(event.target)
      )
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.type !== "keydown" || event.repeat) return;
      if (step.interactive && !step.manualAdvance) skipInteractive();
      else advance();
    };

    window.addEventListener("keydown", handleArrowNavigation, true);
    window.addEventListener("keydown", handleSpace, true);
    window.addEventListener("keyup", handleSpace, true);
    const handler = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        insideAppModal(event.target)
      )
        return;
      if (event.key === "Escape") {
        // An open practice dialog or menu handles its own Escape first.
        const insideCard =
          event.target instanceof Element &&
          event.target.closest("[data-tour-card]");
        if (
          !step.interactive ||
          insideCard ||
          !document.querySelector(
            '[data-tour="demo-library-modal"], [data-tour="demo-library-menu"], [data-tour="demo-context-menu"], [data-tour="demo-log-session-dialog"]',
          )
        )
          endTour("dismissed");
      }
      if (
        !step.interactive &&
        event.key === "Enter" &&
        !(
          event.target instanceof Element &&
          event.target.closest("button,a,input,textarea,select")
        )
      ) {
        event.preventDefault();
        advance();
      }
    };
    window.addEventListener("keydown", handler);
    return () => {
      cancelAnimationFrame(focusFrame);
      window.removeEventListener("keydown", handleArrowNavigation, true);
      window.removeEventListener("keydown", handleSpace, true);
      window.removeEventListener("keyup", handleSpace, true);
      window.removeEventListener("keydown", handler);
    };
  }, [active.stepIndex, finishTour, step, tour]);

  if (!tour || !step) return null;
  const present = (selector: string) => Boolean(findTourElement(selector));
  const back = () => {
    const index = backStepIndex(tour.steps, active.stepIndex, present);
    if (index >= 0) goTo(index, true);
  };
  const advance = () => {
    const index = nextStepIndex(tour.steps, active.stepIndex, 1, present);
    if (index >= tour.steps.length) endTour("completed");
    else goTo(index);
  };
  const skipInteractive = () => {
    skipped.current = true;
    let index = step.skipTo
      ? tour.steps.findIndex((candidate) => candidate.id === step.skipTo)
      : active.stepIndex + 1;
    if (index < 0) index = active.stepIndex + 1;
    while (
      !step.skipTo &&
      index < tour.steps.length &&
      tour.steps[index].interactive
    )
      index += 1;
    if (index >= tour.steps.length) endTour("completed");
    else goTo(index, true);
  };
  const continueWithPersonalization = () => {
    endTour("completed");
    startTour("settings");
  };
  const isLast = active.stepIndex === tour.steps.length - 1;
  const hasOwnBackdrop = step.id === "fill-dialog" || appModalOpen;
  const highlightedRects = rect ? [rect, ...additionalRects] : [];
  // Keep the surrounding practice visible without drawing nested rings around
  // both the active control and its enclosing stage or dialog.
  // A ring drawn over an app dialog would sit on top of it; the dialog's own
  // backdrop already sets the section apart.
  const outlinedRects =
    rect && !appModalOpen
      ? [
          rect,
          ...additionalRects.filter(
            (other) =>
              other.left >= rect.left + rect.width ||
              other.left + other.width <= rect.left ||
              other.top >= rect.top + rect.height ||
              other.top + other.height <= rect.top,
          ),
        ]
      : [];

  return createPortal(
    <div
      className="fixed inset-0 z-[70] pointer-events-none"
      aria-live="polite"
    >
      {!hasOwnBackdrop && highlightedRects.length > 0 ? (
        <svg
          aria-hidden="true"
          className="fixed inset-0 h-full w-full"
          preserveAspectRatio="none"
        >
          <defs>
            <mask id="tour-backdrop-mask">
              <rect width="100%" height="100%" fill="white" />
              {highlightedRects.map((highlight, index) => (
                <rect
                  key={index}
                  x={highlight.left - 6}
                  y={highlight.top - 6}
                  width={highlight.width + 12}
                  height={highlight.height + 12}
                  rx={14}
                  fill="black"
                />
              ))}
            </mask>
          </defs>
          <rect
            width="100%"
            height="100%"
            fill={step.interactive ? "rgb(0 0 0 / 0.28)" : "rgb(0 0 0 / 0.48)"}
            mask="url(#tour-backdrop-mask)"
          />
        </svg>
      ) : !hasOwnBackdrop && !rect ? (
        <div className="absolute inset-0 bg-black/60" />
      ) : null}
      {outlinedRects.map((highlight, index) => (
        <div
          key={index}
          className="tour-ring"
          style={{
            top: highlight.top - 6,
            left: highlight.left - 6,
            width: highlight.width + 12,
            height: highlight.height + 12,
          }}
        />
      ))}
      <div
        ref={cardRef}
        data-tour-card
        data-tour-practice-card={tour.practice || undefined}
        role="dialog"
        aria-labelledby="tour-step-title"
        aria-modal={!step.interactive}
        tabIndex={-1}
        style={cardRight === null ? undefined : { right: cardRight }}
        className="tour-guide-card pointer-events-auto fixed flex flex-col rounded-2xl border border-border bg-surface text-text shadow-raised outline-none"
      >
        <div className="flex shrink-0 items-start justify-between gap-3 px-5 pt-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-accent-ink">
            {tour.title} · {active.stepIndex + 1}/{tour.steps.length}
          </div>
          <button
            type="button"
            className="rounded p-1 text-text-muted hover:bg-surface-hover hover:text-text"
            onClick={() => endTour("dismissed")}
            aria-label="Exit tutorial"
          >
            <X size={16} />
          </button>
        </div>
        <div className="min-h-0 overflow-y-auto px-5 pb-1">
          <h2 id="tour-step-title" className="mt-2 text-lg font-semibold">
            {step.title}
          </h2>
          <p className="mt-2 whitespace-pre-line text-sm leading-6 text-text-muted">
            {step.body}
          </p>
          {step.keyboardHint ? (
            <p className="mt-2 text-xs text-text-muted">{step.keyboardHint}</p>
          ) : null}
          {missing ? (
            <p className="mt-2 text-xs text-warning">
              This control is not available right now. You can still continue.
              {tour.practice || tour.demoGame || tour.simulation ? (
                <button
                  type="button"
                  className="ml-1 underline"
                  onClick={() => goTo(active.stepIndex, true)}
                >
                  Show this step
                </button>
              ) : null}
            </p>
          ) : null}
          {outcome ? (
            <p
              ref={outcomeRef}
              role="status"
              className="mt-2 text-sm text-success"
            >
              {outcome}
            </p>
          ) : null}
          {isLast && skipped.current ? (
            <p className="mt-2 text-xs text-text-muted">
              You skipped an exercise. Replay this guide from Help to try it
              later.
            </p>
          ) : null}
        </div>
        {tour.id === CORE_TOUR_ID && isLast ? (
          <div className="grid shrink-0 gap-2 px-5 py-3">
            <Button
              variant="primary"
              className="w-full"
              onClick={continueWithPersonalization}
            >
              Personalize PlayCounter ({findTour("settings")?.duration})
            </Button>
            <div className="flex items-center justify-between gap-2">
              <Button onClick={back}>Back</Button>
              <div className="flex gap-2">
                <Button onClick={openGuides}>View other guides</Button>
                <Button variant="ghost" onClick={() => endTour("completed")}>
                  Finish
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex shrink-0 items-center justify-between gap-2 px-5 py-3">
            <Button disabled={active.stepIndex === 0} onClick={back}>
              Back
            </Button>
            <div className="flex flex-wrap justify-end gap-2">
              {isLast && tour.nextTourId ? (
                <Button
                  onClick={() => {
                    endTour("completed");
                    startTour(tour.nextTourId!);
                  }}
                >
                  {findTour(tour.nextTourId)?.title}
                </Button>
              ) : null}
              {isLast && !tour.nextTourId ? (
                <Button onClick={openGuides}>More guides</Button>
              ) : null}
              {step.interactive && !step.manualAdvance ? (
                <Button onClick={skipInteractive}>Skip step</Button>
              ) : null}
              {!step.interactive || step.manualAdvance ? (
                <Button variant="primary" onClick={advance}>
                  {isLast
                    ? tour.finishView === "games"
                      ? "Open My Games"
                      : tour.finishView === "history"
                        ? "Open My History"
                        : tour.finishView === "discovered"
                          ? "Open Discovered"
                          : "Finish"
                    : "Next"}
                </Button>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** The window must stay movable and closable while a guide is running: the
 *  empty title bar (and a dialog's drag strip) and the window buttons. */
function isWindowChrome(event: Event) {
  const target = event.target;
  return (
    target instanceof Element &&
    (target.hasAttribute("data-tauri-drag-region") ||
      Boolean(target.closest(".window-controls")))
  );
}

/** Text fields keep the space bar during a guide. */
export function acceptsText(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;
  if (target.closest('[contenteditable="true"], textarea')) return true;
  return (
    target instanceof HTMLInputElement &&
    ![
      "button",
      "checkbox",
      "color",
      "file",
      "image",
      "radio",
      "range",
      "reset",
      "submit",
    ].includes(target.type)
  );
}

/** Controls that handle the arrow keys themselves keep them during a guide. */
export function usesArrowKeys(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;
  if (target.closest('[contenteditable="true"], textarea, select')) return true;
  if (
    target instanceof HTMLInputElement &&
    !["button", "checkbox", "color", "file", "reset", "submit"].includes(
      target.type,
    )
  )
    return true;
  return Boolean(
    target.closest(
      '[role="grid"], [role="listbox"], [role="menu"], [role="menubar"], [role="radiogroup"], [role="slider"], [role="spinbutton"], [role="tablist"], [role="tree"]',
    ) || target.matches("button[tabindex]"),
  );
}

/** A target counts as shown once no scroll panel or window edge clips it.
 *  Targets taller or wider than their panel can never be fully shown. */
function fullyVisible(element: Element, visible: TourTargetRect | null) {
  if (!visible) return false;
  const bounds = element.getBoundingClientRect();
  return (
    visible.width >= Math.min(bounds.width, window.innerWidth) - 1 &&
    visible.height >= Math.min(bounds.height, window.innerHeight) - 1
  );
}

function sameRects(left: TourTargetRect[], right: TourTargetRect[]) {
  return (
    left.length === right.length &&
    left.every(
      (rect, index) =>
        rect.top === right[index].top &&
        rect.left === right[index].left &&
        rect.width === right[index].width &&
        rect.height === right[index].height,
    )
  );
}

export function TutorialSettingsPanel() {
  const setOpen = useAppStore((state) => state.setHelpMenuOpen);
  return (
    <div
      data-tour="settings-help"
      className="flex flex-wrap items-center justify-between gap-4"
    >
      <div className="flex min-w-0 items-start gap-3">
        <CircleHelp size={20} className="mt-0.5 shrink-0 text-accent-ink" />
        <p className="text-sm leading-5 text-text-muted">
          Use the <span className="font-semibold text-text">?</span> button in
          the top-right corner to start or replay the Quick Tour and every
          step-by-step guide.
        </p>
      </div>
      <Button icon={CircleHelp} onClick={() => setOpen(true)}>
        Open Help menu
      </Button>
    </div>
  );
}
