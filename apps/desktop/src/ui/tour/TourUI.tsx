import { Check, CircleHelp, X } from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useAppStore } from "../../store";
import { Button, IconButton } from "../primitives";
import { CORE_TOUR_ID, TOURS, findTour } from "./tourDefinitions";
import { backStepIndex, nextStepIndex } from "./tourNavigation";
import { shouldShowWelcome } from "./tourState";

const TOUR_EVENT = "playcounter:tour-event";

export function emitTourEvent(name: "mygames.demo-session-logged") {
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
        <div className="absolute right-0 top-11 z-50 w-80 overflow-hidden rounded-xl border border-border bg-surface shadow-raised">
          <div className="border-b border-border px-4 py-3">
            <div className="font-semibold text-text">Help & tutorials</div>
            <div className="mt-0.5 text-xs text-text-muted">
              Learn the basics or practice a common task.
            </div>
          </div>
          <div className="grid gap-1 p-2">
            {TOURS.map((tour) => {
              const complete = progress.completed[tour.id] === tour.version;
              return (
                <button
                  key={tour.id}
                  type="button"
                  className="flex items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-surface-hover"
                  onClick={() => startTour(tour.id)}
                >
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent-tint text-accent">
                    {complete ? <Check size={16} /> : <CircleHelp size={16} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-text">
                      {tour.title}
                    </span>
                    <span className="block truncate text-xs text-text-muted">
                      {tour.description}
                    </span>
                  </span>
                  <span className="text-[11px] text-text-muted">
                    {complete ? "Replay" : tour.duration}
                  </span>
                </button>
              );
            })}
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
  const markSeen = useAppStore((state) => state.markTourWelcomeSeen);
  const startTour = useAppStore((state) => state.startTour);
  const setAutoShareIgnoredProcesses = useAppStore(
    (state) => state.setAutoShareIgnoredProcesses,
  );

  useEffect(() => {
    const timer = window.setTimeout(() => setReady(true), 1200);
    return () => window.clearTimeout(timer);
  }, []);
  const visible = ready && shouldShowWelcome(progress);

  useEffect(() => {
    if (visible) setHelpImprove(true);
  }, [visible]);

  if (!visible) return null;

  const close = () => {
    setAutoShareIgnoredProcesses(helpImprove);
    markSeen();
  };
  return createPortal(
    <ModalFrame onEscape={close}>
      <div className="w-[440px] max-w-[calc(100vw-32px)] rounded-2xl border border-border bg-surface p-6 shadow-raised">
        <div className="mb-4 grid h-11 w-11 place-items-center rounded-xl bg-accent-tint text-accent">
          <CircleHelp size={23} />
        </div>
        <h2 className="text-xl font-semibold text-text">
          Welcome to PlayCounter
        </h2>
        <p className="mt-2 leading-6 text-text-muted">
          PlayCounter watches for games you launch and tracks how long you play,
          no matter where they came from. A quick tour shows you around.
        </p>
        <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-bg p-4 transition hover:border-accent/40">
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
              When you ignore an unrecognized process, share its executable
              name, platform, and anonymous install ID for community review.
              Playtime and game history are never included. You can change this
              anytime in Settings.
            </span>
          </span>
        </label>
        <div className="mt-6 grid gap-1">
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

type TargetRect = { top: number; left: number; width: number; height: number };

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
  const [rect, setRect] = useState<TargetRect | null>(null);
  const [additionalRects, setAdditionalRects] = useState<TargetRect[]>([]);
  const [missing, setMissing] = useState(false);
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
    const frame = requestAnimationFrame(() => {
      document.querySelector(step.anchor!)?.scrollIntoView({
        block: step.cardPlacement === "below" ? "start" : "center",
        inline: "nearest",
        behavior: "instant",
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [step]);

  useEffect(() => {
    if (!step) {
      endTour("dismissed");
      return;
    }
    let frame = 0;
    const started = performance.now();
    const update = () => {
      const element = step.anchor ? document.querySelector(step.anchor) : null;
      if (element) {
        const next = element.getBoundingClientRect();
        setRect((current) => {
          const measured = {
            top: next.top,
            left: next.left,
            width: next.width,
            height: next.height,
          };
          return current &&
            current.top === measured.top &&
            current.left === measured.left &&
            current.width === measured.width &&
            current.height === measured.height
            ? current
            : measured;
        });
        const measuredAdditional = (step.additionalAnchors ?? []).flatMap(
          (selector) => {
            const additional = document.querySelector(selector);
            if (!additional) return [];
            const bounds = additional.getBoundingClientRect();
            return [
              {
                top: bounds.top,
                left: bounds.left,
                width: bounds.width,
                height: bounds.height,
              },
            ];
          },
        );
        setAdditionalRects((current) =>
          sameRects(current, measuredAdditional) ? current : measuredAdditional,
        );
        setMissing(false);
      } else {
        setRect(null);
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
    return () => {
      events.forEach((name) => document.removeEventListener(name, block, true));
      document.removeEventListener("focusin", focus, true);
    };
  }, [step]);

  useEffect(() => {
    if (!step) return;
    if (step.interactive && step.allow?.[0]) {
      const root = document.querySelector(step.allow[0]) as HTMLElement | null;
      const focusable = root?.matches("button,input,select,textarea,[tabindex]")
        ? root
        : (root?.querySelector(
            "button,input,select,textarea,[tabindex]",
          ) as HTMLElement | null);
      (focusable ?? cardRef.current)?.focus({ preventScroll: true });
    } else {
      cardRef.current?.focus({ preventScroll: true });
    }

    const handleArrowNavigation = (event: KeyboardEvent) => {
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
    if (step.interactive) {
      return () =>
        window.removeEventListener("keydown", handleArrowNavigation, true);
    }

    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") endTour("dismissed");
      if (["Enter", " "].includes(event.key)) {
        event.preventDefault();
        advance();
      }
    };
    window.addEventListener("keydown", handler);
    return () => {
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
    while (index < tour.steps.length && tour.steps[index].interactive)
      index += 1;
    if (index >= tour.steps.length) endTour("completed");
    else goTo(index, true);
  };
  const continueWithPersonalization = () => {
    endTour("completed");
    startTour("settings");
  };
  const isLast = active.stepIndex === tour.steps.length - 1;
  const style = cardPosition(rect, step.cardPlacement);
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
        role="dialog"
        aria-modal={!step.interactive}
        tabIndex={-1}
        className="pointer-events-auto fixed max-h-[calc(100vh-32px)] w-[390px] max-w-[calc(100vw-32px)] overflow-y-auto rounded-2xl border border-border bg-surface p-5 text-text shadow-raised outline-none"
        style={style}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="text-xs font-semibold uppercase tracking-wider text-accent">
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
        <h2 className="mt-2 text-lg font-semibold">{step.title}</h2>
        <p className="mt-2 whitespace-pre-line text-sm leading-6 text-text-muted">
          {step.body}
        </p>
        {step.keyboardHint ? (
          <p className="mt-2 text-xs text-text-muted">{step.keyboardHint}</p>
        ) : null}
        {missing ? (
          <p className="mt-2 text-xs text-warning">
            This control is not available right now. You can still continue.
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

function sameRects(left: TargetRect[], right: TargetRect[]) {
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

function cardPosition(
  rect: TargetRect | null,
  preferredPlacement?: "below",
): CSSProperties {
  if (!rect)
    return { top: "50%", left: "50%", transform: "translate(-50%, -50%)" };
  const width = 390;
  const gap = 16;
  const edge = 16;
  const minimumCardHeight = 220;

  if (preferredPlacement === "below") {
    const top = rect.top + rect.height + gap;
    if (top + minimumCardHeight <= window.innerHeight - edge) {
      const left = Math.min(
        window.innerWidth - width - edge,
        Math.max(edge, rect.left + (rect.width - width) / 2),
      );
      return {
        top,
        left,
        maxHeight: window.innerHeight - top - edge,
      };
    }
  }

  let left = Math.min(
    window.innerWidth - width - edge,
    Math.max(edge, rect.left + rect.width + gap),
  );
  let top = Math.min(window.innerHeight - 260, Math.max(edge, rect.top));
  if (left < rect.left + rect.width && rect.left - width - gap >= edge)
    left = rect.left - width - gap;
  if (window.innerWidth < 700) {
    left = edge;
    top = Math.max(edge, window.innerHeight - 300);
  }
  return {
    top,
    left,
    maxHeight: Math.max(minimumCardHeight, window.innerHeight - top - edge),
  };
}

export function TutorialSettingsPanel() {
  const setOpen = useAppStore((state) => state.setHelpMenuOpen);
  return (
    <div
      data-tour="settings-help"
      className="flex flex-wrap items-center justify-between gap-4"
    >
      <div className="flex min-w-0 items-start gap-3">
        <CircleHelp size={20} className="mt-0.5 shrink-0 text-accent" />
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
