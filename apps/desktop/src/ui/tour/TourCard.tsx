import { Check, Minus, MousePointerClick, X } from "lucide-react";
import { useEffect, useRef, type CSSProperties, type RefObject } from "react";
import { getT } from "../../i18n";
import type { ViewId } from "../../store";
import { cn } from "../cn";
import { Button } from "../primitives";
import { findTour, isHandsOn, type TourDefinition } from "./tourDefinitions";
import { TourRichText } from "./tourRichText";

const t = getT("tour");

function finishLabel(view: ViewId | undefined) {
  if (view === "games") return t("Open My Games");
  if (view === "history") return t("Open My History");
  if (view === "discovered") return t("Open Discovered");
  return t("Finish");
}

export function HandsOnPill() {
  return (
    <span className="shrink-0 rounded-full bg-info/15 px-[7px] py-px text-[10.5px] font-bold uppercase tracking-wide text-info ring-1 ring-inset ring-info/25">
      {t("Hands-on")}
    </span>
  );
}

export type TourCardProps = {
  tour: TourDefinition;
  stepIndex: number;
  /** The steps this computer can show, in order. */
  visibleSteps: number[];
  /** The step's task was noticed; the guide is about to move on. */
  done: boolean;
  /** Exercises the player stepped over. */
  skippedSteps: ReadonlySet<number>;
  missing: boolean;
  outcome: string | null;
  cardRef: RefObject<HTMLDivElement | null>;
  outcomeRef: RefObject<HTMLParagraphElement | null>;
  style?: CSSProperties;
  onBack: () => void;
  onNext: () => void;
  onSkip: () => void;
  onExit: () => void;
  onJump: (index: number) => void;
  onShowStep: () => void;
  onStartNext: () => void;
  onMoreGuides: () => void;
  onFinish: () => void;
};

/** The guide's card: every step as a checklist, the current one open. In a
 *  narrow window it docks at the bottom and shows the current step only
 *  (styles.css, .tour-guide-card). */
export function TourCard({
  tour,
  stepIndex,
  visibleSteps,
  done,
  skippedSteps,
  missing,
  outcome,
  cardRef,
  outcomeRef,
  style,
  onBack,
  onNext,
  onSkip,
  onExit,
  onJump,
  onShowStep,
  onStartNext,
  onMoreGuides,
  onFinish,
}: TourCardProps) {
  const step = tour.steps[stepIndex];
  const position = Math.max(0, visibleSteps.indexOf(stepIndex));
  const isFirst = position === 0;
  const isLast = position === visibleSteps.length - 1;
  const next = isLast && tour.nextTourId ? findTour(tour.nextTourId) : null;
  const NextIcon = next?.icon;
  const Icon = tour.icon;
  const handsOn = isHandsOn(tour);
  const count = `${position + 1} / ${visibleSteps.length}`;
  const progress =
    ((position + (done || isLast ? 1 : 0)) / visibleSteps.length) * 100;
  const hasTask = Boolean(step.task);
  const canSkip =
    !done && !isLast && ((step.interactive && !step.manualAdvance) || hasTask);
  const skippedExercise = skippedSteps.size > 0;

  // Long guides scroll their list: keep the open step in sight.
  const nowRef = useRef<HTMLLIElement>(null);
  useEffect(() => {
    nowRef.current?.scrollIntoView({ block: "nearest", behavior: "instant" });
  }, [stepIndex]);

  return (
    <div
      ref={cardRef}
      data-tour-card
      data-tour-practice-card={tour.practice || undefined}
      role="dialog"
      aria-labelledby="tour-step-title"
      aria-modal={!step.interactive}
      tabIndex={-1}
      style={style}
      className="tour-guide-card pointer-events-auto fixed flex flex-col rounded-2xl border border-border bg-surface text-text shadow-raised outline-none"
    >
      <div className="tour-card-head flex shrink-0 items-center gap-3 pb-3 pl-[18px] pr-3.5 pt-4">
        <span className="tour-card-icon grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent-tint text-accent-ink">
          <Icon size={16} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="tour-card-title truncate text-[15px] font-semibold">
            {tour.title}
          </div>
          <div className="tour-card-meta mt-0.5 flex items-center gap-2 text-xs text-text-faint">
            {handsOn ? <HandsOnPill /> : null}
            {tour.duration}
          </div>
        </div>
        <span className="tour-card-count font-mono text-xs font-semibold tabular-nums text-text-muted">
          {count}
        </span>
        <button
          type="button"
          className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-text-muted hover:bg-surface-hover hover:text-text"
          onClick={onExit}
          aria-label={t("Exit tutorial")}
        >
          <X size={16} />
        </button>
      </div>
      <div className="tour-card-progress flex shrink-0 items-center gap-2.5 border-b border-border/70 px-[18px] pb-3.5">
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={visibleSteps.length}
          aria-valuenow={position + 1}
          aria-label={t("Step {{current}} of {{total}}", {
            current: position + 1,
            total: visibleSteps.length,
          })}
          className="h-[5px] flex-1 overflow-hidden rounded-full bg-border"
        >
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
        <span className="font-mono text-xs font-semibold tabular-nums text-text-muted">
          {count}
        </span>
      </div>
      <ol className="tour-steps m-0 min-h-0 flex-1 list-none overflow-y-auto px-[18px] pb-2 pt-3.5">
        {visibleSteps.map((index, order) => {
          const item = tour.steps[index];
          const state =
            index === stepIndex ? "now" : order < position ? "was" : "next";
          const skipped = state === "was" && skippedSteps.has(index);
          const checked =
            (state === "was" && !skipped) ||
            (state === "now" && (done || isLast));
          return (
            <li
              key={item.id}
              ref={state === "now" ? nowRef : undefined}
              data-state={state}
              className="tour-step relative flex gap-3 pb-3.5"
            >
              <span
                aria-hidden="true"
                className={cn(
                  "tour-step-dot relative grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 bg-surface text-[11px] font-bold",
                  checked
                    ? "border-success bg-success text-bg"
                    : state === "now"
                      ? "border-accent text-accent-ink shadow-[0_0_0_4px_rgb(var(--color-accent)/0.16)]"
                      : "border-border text-text-faint",
                  state === "now" && checked && "tour-done-pop",
                )}
              >
                {checked ? (
                  <Check size={13} strokeWidth={3} />
                ) : skipped ? (
                  <Minus size={13} strokeWidth={3} />
                ) : (
                  order + 1
                )}
              </span>
              <div className="min-w-0 flex-1 pt-px">
                {state === "now" ? (
                  <>
                    <h2
                      id="tour-step-title"
                      className="text-[17px] font-semibold leading-6 tracking-tight"
                    >
                      {item.title}
                    </h2>
                    <p className="mt-1.5 whitespace-pre-line text-sm leading-[22px] text-text-muted">
                      <TourRichText text={item.body} />
                    </p>
                    {item.task ? (
                      <div
                        data-tour-task={done ? "done" : "open"}
                        className={cn(
                          "mt-3 flex items-start gap-2.5 rounded-[10px] px-3 py-2.5 text-sm leading-[21px] ring-1 ring-inset transition-colors duration-200",
                          done
                            ? "bg-success/10 ring-success/35"
                            : "bg-accent/10 ring-accent/30",
                        )}
                      >
                        <span
                          aria-hidden="true"
                          className={cn(
                            "-mt-px grid h-6 w-6 shrink-0 place-items-center rounded-md",
                            done
                              ? "tour-done-pop bg-success text-bg"
                              : "bg-accent text-accent-fg",
                          )}
                        >
                          {done ? (
                            <Check size={14} strokeWidth={3} />
                          ) : (
                            <MousePointerClick size={14} />
                          )}
                        </span>
                        <span className="min-w-0">
                          <span
                            className={cn(
                              "block text-[10.5px] font-bold uppercase tracking-[0.1em]",
                              done ? "text-success" : "text-accent-ink",
                            )}
                          >
                            {done ? t("Done") : t("Your turn")}
                          </span>
                          {done ? (
                            (outcome ?? t("Nice. Moving on…"))
                          ) : (
                            <TourRichText
                              text={item.task}
                              boldClassName="font-semibold text-accent-ink"
                            />
                          )}
                        </span>
                      </div>
                    ) : null}
                    {item.keyboardHint ? (
                      <p className="mt-2 text-xs text-text-muted">
                        {item.keyboardHint}
                      </p>
                    ) : null}
                    {missing ? (
                      <p className="mt-2 text-xs text-warning">
                        {t(
                          "This control is not available right now. You can still continue.",
                        )}
                        {tour.practice || tour.demoGame || tour.simulation ? (
                          <button
                            type="button"
                            className="ml-1 underline"
                            onClick={onShowStep}
                          >
                            {t("Show this step")}
                          </button>
                        ) : null}
                      </p>
                    ) : null}
                    {outcome && !(done && item.task) ? (
                      <p
                        ref={outcomeRef}
                        role="status"
                        className="mt-2 text-sm text-success"
                      >
                        {outcome}
                      </p>
                    ) : null}
                    {isLast && skippedExercise ? (
                      <p className="mt-2 text-xs text-text-muted">
                        {t(
                          "You skipped an exercise. Replay this guide from Help to try it later.",
                        )}
                      </p>
                    ) : null}
                    {next && NextIcon ? (
                      <div className="mt-3.5 flex items-center gap-3 rounded-xl border border-border bg-bg p-3">
                        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent-tint text-accent-ink">
                          <NextIcon size={16} aria-hidden="true" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[10.5px] font-bold uppercase tracking-[0.1em] text-text-faint">
                            {t("Next up")}
                          </span>
                          <span className="block truncate font-semibold">
                            {next.title}
                          </span>
                          <span className="block text-xs text-text-faint">
                            {isHandsOn(next)
                              ? t("Hands-on · {{duration}}", {
                                  duration: next.duration,
                                })
                              : next.duration}
                          </span>
                        </span>
                        <Button onClick={onStartNext}>{t("Start")}</Button>
                      </div>
                    ) : null}
                  </>
                ) : state === "was" ? (
                  <button
                    type="button"
                    className="text-left text-sm font-medium text-text-muted hover:text-text hover:underline"
                    onClick={() => onJump(index)}
                  >
                    {item.title}
                  </button>
                ) : (
                  <span className="text-sm font-medium text-text-faint">
                    {item.title}
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      <div className="shrink-0 border-t border-border/70 px-[18px] pb-3.5 pt-3">
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button disabled={isFirst} onClick={onBack} className="mr-auto">
            {t("Back")}
          </Button>
          {isLast ? (
            <>
              <Button variant="ghost" onClick={onMoreGuides}>
                {t("More guides")}
              </Button>
              <Button variant="primary" onClick={onFinish}>
                {finishLabel(tour.finishView)}
              </Button>
            </>
          ) : canSkip ? (
            <Button variant="ghost" onClick={onSkip}>
              {t("Skip step")}
            </Button>
          ) : done ? null : (
            <Button variant="primary" onClick={onNext}>
              {t("Next")}
            </Button>
          )}
        </div>
        <div className="tour-card-keys mt-2.5 flex items-center justify-between text-[11.5px] text-text-faint">
          <span className="flex items-center gap-1.5">
            <TourRichText text={t("<kbd>←</kbd> <kbd>→</kbd> step")} />
          </span>
          <span className="flex items-center gap-1.5">
            <TourRichText text={t("<kbd>Esc</kbd> exit")} />
          </span>
        </div>
      </div>
    </div>
  );
}
