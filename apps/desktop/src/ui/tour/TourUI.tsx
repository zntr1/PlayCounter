import {
  findTourElement,
  findTourTarget,
  mergeTouchingRects,
  tourFocusTarget,
  tourRingBox,
  tourTargetRect,
  type TourTargetRect,
} from "./tourTargetRect";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAppStore } from "../../store";
import { CORE_TOUR_ID, findTour } from "./tourDefinitions";
import { TOUR_EVENT } from "./tourEvents";
import { TourCard } from "./TourCard";
import {
  availableStepIndexes,
  backStepIndex,
  nextStepIndex,
} from "./tourNavigation";

export { HelpButton } from "./HelpHub";
export { emitTourEvent } from "./tourEvents";
export { WelcomePrompt } from "./WelcomePrompt";

// A real dialog the app opened from a highlighted control, e.g. a confirmation
// behind a setting. It belongs to that control: it takes clicks and keys, and
// its own backdrop replaces the guide's. Practice dialogs carry data-tour and
// stay under the guide's control.
const APP_MODAL = "[data-modal-backdrop]:not([data-tour])";
const insideAppModal = (target: EventTarget | null) =>
  target instanceof Element && Boolean(target.closest(APP_MODAL));

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

/** How long the card keeps a finished task on screen as "Done" before it
 *  opens the next step. The guide itself has already moved on, so the ring is
 *  on the next control at once. Tests run without it. */
export const tourDoneFlash = {
  ms: import.meta.env.MODE === "test" ? 0 : 900,
};

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
  const [skippedSteps, setSkippedSteps] = useState<ReadonlySet<number>>(
    () => new Set(),
  );
  const markSkipped = (index: number, skipped: boolean) =>
    setSkippedSteps((current) => {
      if (current.has(index) === skipped) return current;
      const next = new Set(current);
      if (skipped) next.add(index);
      else next.delete(index);
      return next;
    });
  // The step whose task was just done, shown as "Done" for a moment.
  const [flash, setFlash] = useState<{
    stepIndex: number;
    message: string | null;
  } | null>(null);
  useEffect(() => {
    if (!flash) return;
    const timer = window.setTimeout(() => setFlash(null), tourDoneFlash.ms);
    return () => window.clearTimeout(timer);
  }, [flash]);
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
  // How many of them the step names itself; the rest frame the practice.
  const [ownRectCount, setOwnRectCount] = useState(0);
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
        const measureAdditional = (selector: string) => {
          const additional = findTourElement(selector);
          const layer = element.closest('[role="dialog"], [role="menu"]');
          if (
            additional === element ||
            (layer && additional && !layer.contains(additional))
          )
            return [];
          const rect = additional ? tourTargetRect(additional) : null;
          return rect ? [rect] : [];
        };
        const ownRects = (step.additionalAnchors ?? []).flatMap(
          measureAdditional,
        );
        const measuredAdditional = [
          ...ownRects,
          ...(sandbox
            ? [
                '[data-tour="demo-library-stage"]',
                '[data-tour="demo-journal"]',
                '[data-tour="demo-library-menu"]',
                '[data-tour="demo-shelf-editor"]',
                '[data-tour="demo-sample-search"]',
              ]
            : []
          ).flatMap(measureAdditional),
        ];
        setAdditionalRects((current) =>
          sameRects(current, measuredAdditional) ? current : measuredAdditional,
        );
        setOwnRectCount(ownRects.length);
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
    if (step?.resetsDiscoveredSample) {
      window.dispatchEvent(new CustomEvent("playcounter:discovered-reset"));
    }
  }, [step?.id, step?.resetsDiscoveredSample, tour?.id]);

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
      const detail = (event as CustomEvent<{ name?: string; message?: string }>)
        .detail;
      if (detail?.name !== eventName) return;
      const next = nextStepIndex(tour.steps, active.stepIndex, 1, (selector) =>
        Boolean(document.querySelector(selector)),
      );
      // A step with Next still moves on by itself once its task is done.
      if (next >= tour.steps.length) return;
      markSkipped(active.stepIndex, false);
      if (step.task && tourDoneFlash.ms > 0)
        setFlash({
          stepIndex: active.stepIndex,
          message: detail.message ?? null,
        });
      goTo(next);
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
    markSkipped(active.stepIndex, true);
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
  // A task that can simply be stepped over: the same as Next, but the list
  // remembers that the exercise was not done.
  const skipStep = () => {
    if (step.interactive && !step.manualAdvance) return skipInteractive();
    markSkipped(active.stepIndex, true);
    advance();
  };
  const visibleSteps = availableStepIndexes(
    tour.steps,
    active.stepIndex,
    present,
  );
  const shown =
    flash && tour.steps[flash.stepIndex] ? flash.stepIndex : active.stepIndex;
  const hasOwnBackdrop = Boolean(step.ownBackdrop) || appModalOpen;
  const highlightedRects = rect ? [rect, ...additionalRects] : [];
  // Keep the surrounding practice visible without drawing nested rings around
  // both the active control and its enclosing stage or dialog.
  // A ring drawn over an app dialog would sit on top of it; the dialog's own
  // backdrop already sets the section apart.
  const apartFromTarget = (other: TourTargetRect) =>
    rect !== null &&
    (other.left >= rect.left + rect.width ||
      other.left + other.width <= rect.left ||
      other.top >= rect.top + rect.height ||
      other.top + other.height <= rect.top);
  // Controls the step names share one ring when they sit next to each other.
  // The frames around the practice keep their own.
  const outlinedRects =
    rect && !appModalOpen
      ? [
          ...mergeTouchingRects([
            rect,
            ...additionalRects.slice(0, ownRectCount).filter(apartFromTarget),
          ]),
          ...additionalRects.slice(ownRectCount).filter(apartFromTarget),
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
              {highlightedRects.map(tourRingBox).map((box, index) => (
                <rect
                  key={index}
                  x={box.left}
                  y={box.top}
                  width={box.width}
                  height={box.height}
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
      {outlinedRects.map(tourRingBox).map((box, index) => (
        <div
          key={index}
          className="tour-ring"
          style={{
            top: box.top,
            left: box.left,
            width: box.width,
            height: box.height,
          }}
        />
      ))}
      <TourCard
        tour={tour}
        stepIndex={shown}
        visibleSteps={visibleSteps}
        done={shown !== active.stepIndex}
        skippedSteps={skippedSteps}
        missing={missing && shown === active.stepIndex}
        outcome={shown === active.stepIndex ? outcome : flash!.message}
        cardRef={cardRef}
        outcomeRef={outcomeRef}
        style={cardRight === null ? undefined : { right: cardRight }}
        onBack={back}
        onNext={advance}
        onSkip={skipStep}
        onExit={() => endTour("dismissed")}
        onJump={(index) => goTo(index, true)}
        onShowStep={() => goTo(active.stepIndex, true)}
        onStartNext={() => {
          endTour("completed");
          if (tour.nextTourId) startTour(tour.nextTourId);
        }}
        onMoreGuides={openGuides}
        onFinish={() => endTour("completed")}
      />
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
