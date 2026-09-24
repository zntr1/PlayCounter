import {
  findTourElement,
  findTourTarget,
  tourFocusTarget,
  tourTargetRect,
} from "./tourTargetRect";
import { Check, CircleHelp, X } from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { PlayCounterAnimatedIcon } from "../../brand/PlayCounterAnimatedIcon";
import { currentPlatform } from "../../platform";
import { useAppStore } from "../../store";
import { Button, IconButton } from "../primitives";
import { tourCardPosition, type TourTargetRect } from "./tourCardPosition";
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

const HELP_TOUR_GROUPS = TOUR_CATEGORIES.map((category) => ({
  ...category,
  tours: TOURS.filter((tour) => tour.category === category.id),
})).filter((group) => group.tours.length > 0);

export function emitTourEvent(name: TourEventName) {
  window.dispatchEvent(new CustomEvent(TOUR_EVENT, { detail: { name } }));
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
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open, setOpen]);

  return (
    <div ref={rootRef} className="relative">
      <span data-tour="help">
        <IconButton
          aria-label="Help and tutorials"
          title="Help and tutorials"
          icon={CircleHelp}
          onClick={() => setOpen(!open)}
        />
      </span>
      {open ? (
        <div
          className="absolute right-0 top-11 z-50 flex max-h-[calc(100vh-100px)] w-[420px] max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-raised"
          onKeyDown={(event) => {
            if (event.key === "Escape") setOpen(false);
          }}
        >
          <div className="border-b border-border px-4 py-3">
            <h2 className="font-semibold text-text">Help & tutorials</h2>
            <div className="mt-0.5 text-xs text-text-muted">
              Browse by topic and pick a guide to get started.
            </div>
          </div>
          <div className="min-h-0 overflow-y-auto px-2 pb-2">
            {HELP_TOUR_GROUPS.map((group) => (
              <section
                key={group.id}
                aria-labelledby={`help-category-${group.id}`}
                className="mb-3 grid gap-1 last:mb-0"
              >
                <h3
                  id={`help-category-${group.id}`}
                  className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-border bg-surface px-3 py-2 text-xs font-semibold text-accent-ink"
                >
                  {group.title}
                  <span className="text-[11px] font-normal text-text-faint">
                    {group.tours.length}{" "}
                    {group.tours.length === 1 ? "guide" : "guides"}
                  </span>
                </h3>
                {group.tours.map((tour) => {
                  const complete = progress.completed[tour.id] === tour.version;
                  return (
                    <button
                      key={tour.id}
                      type="button"
                      className="flex scroll-mt-10 items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60"
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
                        <span className="block text-sm font-medium text-text">
                          {tour.title}
                        </span>
                        <span className="block text-xs leading-relaxed text-text-muted">
                          {tour.description}
                        </span>
                      </span>
                      <span className="shrink-0 whitespace-nowrap text-[11px] text-text-muted">
                        {complete ? "Replay" : tour.duration}
                      </span>
                    </button>
                  );
                })}
              </section>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function WelcomePrompt() {
  const [ready, setReady] = useState(false);
  const [helpImprove, setHelpImprove] = useState(true);
  const progress = useAppStore((state) => state.tourProgress);
  const [enableLauncher, setEnableLauncher] = useState(true);
  const markSeen = useAppStore((state) => state.markTourWelcomeSeen);
  const startTour = useAppStore((state) => state.startTour);
  const setLauncherSetting = useAppStore((state) => state.setLauncherSetting);
  const setAutoShareIgnoredProcesses = useAppStore(
    (state) => state.setAutoShareIgnoredProcesses,
  );
  const launcherAvailable = currentPlatform() === "windows";

  useEffect(() => {
    const timer = window.setTimeout(() => setReady(true), 1200);
    return () => window.clearTimeout(timer);
  }, []);
  const visible = ready && shouldShowWelcome(progress);

  useEffect(() => {
    if (visible) {
      setHelpImprove(true);
      setEnableLauncher(true);
    }
  }, [visible]);

  if (!visible) return null;

  const close = () => {
    setAutoShareIgnoredProcesses(helpImprove);
    if (launcherAvailable) {
      setLauncherSetting("gameLaunchingEnabled", enableLauncher);
    }
    markSeen();
  };
  return createPortal(
    <ModalFrame onEscape={close}>
      <div className="flex max-h-[calc(100vh-2rem)] w-[440px] max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-raised">
        <div className="shrink-0 px-6 pt-6">
          <PlayCounterAnimatedIcon size={72} playback="once" className="mb-4" />
          <h2 className="text-xl font-semibold text-text">
            Welcome to PlayCounter
          </h2>
          <p className="mt-2 leading-6 text-text-muted">
            PlayCounter watches for games you launch and tracks how long you
            play, no matter where they came from. A quick tour shows you around.
          </p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-bg p-4 transition hover:border-accent/40">
            <input
              type="checkbox"
              checked={helpImprove}
              onChange={(event) => setHelpImprove(event.target.checked)}
              className="mt-1 h-5 w-5 shrink-0 accent-accent"
            />
            <span>
              <span className="block font-semibold text-text">
                Help improve PlayCounter
              </span>
              <span className="mt-1 block text-sm leading-5 text-text-muted">
                When you ignore an app that isn&apos;t a game, PlayCounter
                anonymously shares its file name (like discord.exe) so other
                players don&apos;t have to ignore it too. Your playtime and game
                history aren&apos;t included. You can change this anytime in
                Settings.
              </span>
            </span>
          </label>
          {launcherAvailable ? (
            <label className="mt-3 flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-bg p-4 transition hover:border-accent/40">
              <input
                type="checkbox"
                checked={enableLauncher}
                onChange={(event) => setEnableLauncher(event.target.checked)}
                className="mt-1 h-5 w-5 shrink-0 accent-accent"
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
          ) : null}
        </div>
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
  return <TourRunner />;
}

function TourRunner() {
  const active = useAppStore((state) => state.activeTour)!;
  const startTour = useAppStore((state) => state.startTour);
  const goTo = useAppStore((state) => state.goToTourStep);
  const endTour = useAppStore((state) => state.endTour);
  const openGuides = useAppStore((state) => state.finishTourAndOpenHelp);
  const tour = findTour(active.tourId);
  const step = tour?.steps[active.stepIndex];
  const [rect, setRect] = useState<TourTargetRect | null>(null);
  const [positionRect, setPositionRect] = useState<TourTargetRect | null>(null);
  const [additionalRects, setAdditionalRects] = useState<TourTargetRect[]>([]);
  const [missing, setMissing] = useState(false);
  const [cardHeight, setCardHeight] = useState(260);
  const cardRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

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
    if (
      !step?.anchor ||
      (step.cardPlacement !== "below" && !step.scrollIntoView)
    )
      return;
    const scrollTarget = () => {
      findTourTarget(step)?.scrollIntoView({
        block:
          step.cardPlacement === "below" || tour?.practice ? "start" : "center",
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

  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const measure = () => setCardHeight(card.scrollHeight);
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [missing, step]);

  useEffect(() => {
    if (!step) {
      endTour("dismissed");
      return;
    }
    let frame = 0;
    let previousTarget: HTMLElement | null = null;
    const started = performance.now();
    const update = () => {
      const element = findTourTarget(step);
      if (element) {
        if (element !== previousTarget) {
          const layer = element.closest('[role="dialog"], [role="menu"]');
          if (step.scrollIntoView || step.cardPlacement === "below" || layer) {
            element.scrollIntoView({
              block: "nearest",
              inline: "nearest",
              behavior: "instant",
            });
          }
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
        const positionElement = step.positionAnchor
          ? findTourElement(step.positionAnchor)
          : null;
        const measuredPosition = positionElement
          ? tourTargetRect(positionElement)
          : null;
        setPositionRect((current) =>
          current &&
          measuredPosition &&
          sameRects([current], [measuredPosition])
            ? current
            : measuredPosition,
        );
        setRect((current) =>
          current && measured && sameRects([current], [measured])
            ? current
            : measured,
        );
        const measuredAdditional = (step.additionalAnchors ?? []).flatMap(
          (selector) => {
            const additional = findTourElement(selector);
            const layer = element.closest('[role="dialog"], [role="menu"]');
            if (
              additional === element ||
              (layer && additional && !layer.contains(additional))
            )
              return [];
            const rect = additional ? tourTargetRect(additional) : null;
            return rect ? [rect] : [];
          },
        );
        setAdditionalRects((current) =>
          sameRects(current, measuredAdditional) ? current : measuredAdditional,
        );
        setMissing(false);
      } else {
        setRect(null);
        setPositionRect(null);
        setAdditionalRects([]);
        if (step.anchor && performance.now() - started > 1500) setMissing(true);
      }
      frame = requestAnimationFrame(update);
    };
    frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  }, [endTour, step]);

  useEffect(() => {
    if (tour?.id === "fix-detection" && step?.id === "intro") {
      window.dispatchEvent(new CustomEvent("playcounter:discovered-reset"));
    }
  }, [step?.id, tour?.id]);

  useEffect(() => {
    if (!tour || !step) return;
    const present = (selector: string) =>
      Boolean(document.querySelector(selector));
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
      if (next < tour.steps.length) goTo(next);
    };
    window.addEventListener(TOUR_EVENT, handler);
    return () => window.removeEventListener(TOUR_EVENT, handler);
  }, [active.stepIndex, goTo, step, tour]);

  useEffect(() => {
    if (!step) return;
    const allow = step.allow ?? [];
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
      if (isAllowed(event)) return;
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
      if (!isAllowed(event)) cardRef.current?.focus({ preventScroll: true });
    };
    document.addEventListener("focusin", focus, true);
    const tab = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || event.defaultPrevented) return;
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
  }, [step]);

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
      // Arrow keys belong to text fields, sliders, menus and the playthrough
      // ledger. Navigate the guide only while its own card has focus.
      if (
        event.isComposing ||
        event.defaultPrevented ||
        (step.interactive &&
          !(
            event.target instanceof Element &&
            event.target.closest("[data-tour-card]")
          ))
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

    window.addEventListener("keydown", handleArrowNavigation, true);
    const handler = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
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
        ["Enter", " "].includes(event.key) &&
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
      window.removeEventListener("keydown", handler);
    };
  }, [active.stepIndex, endTour, step, tour]);

  if (!tour || !step) return null;
  const present = (selector: string) =>
    Boolean(document.querySelector(selector));
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
  const style = tour.practice
    ? undefined
    : tourCardPosition(positionRect ?? rect, step.cardPlacement, cardHeight, {
        width: window.innerWidth,
        height: window.innerHeight,
      });
  const hasOwnBackdrop = step.id === "fill-dialog";
  const highlightedRects = rect ? [rect, ...additionalRects] : [];

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
            fill="rgb(0 0 0 / 0.62)"
            mask="url(#tour-backdrop-mask)"
          />
        </svg>
      ) : !hasOwnBackdrop && !rect ? (
        <div className="absolute inset-0 bg-black/60" />
      ) : null}
      {highlightedRects.map((highlight, index) => (
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
        className="pointer-events-auto fixed max-h-[calc(100vh-32px)] w-[390px] max-w-[calc(100vw-32px)] overflow-y-auto rounded-2xl border border-border bg-surface p-5 text-text shadow-raised outline-none"
        style={style}
      >
        <div className="flex items-start justify-between gap-3">
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
            {tour.practice ? (
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
        {tour.id === CORE_TOUR_ID && isLast ? (
          <div className="mt-5 grid gap-2">
            <Button
              variant="primary"
              className="w-full"
              onClick={continueWithPersonalization}
            >
              Personalize PlayCounter (1 min)
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
          <div className="mt-5 flex items-center justify-between gap-2">
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
                  {isLast ? "Finish" : "Next"}
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
