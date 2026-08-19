import type { ViewId } from "../../store";
import type { TourStep } from "./tourDefinitions";

export function stepView(
  step: TourStep,
  activeView: ViewId,
  returnView: ViewId,
) {
  if (step.view === "keep") return activeView;
  return step.view === "return" ? returnView : step.view;
}

export function nextStepIndex(
  steps: TourStep[],
  from: number,
  direction: 1 | -1,
  anchorPresent: (selector: string) => boolean,
) {
  let index = from + direction;
  while (
    index >= 0 &&
    index < steps.length &&
    steps[index].optional &&
    steps[index].anchor &&
    !anchorPresent(steps[index].anchor!)
  )
    index += direction;
  return index;
}

export function backStepIndex(
  steps: TourStep[],
  from: number,
  anchorPresent: (selector: string) => boolean,
) {
  const backTo = steps[from]?.backTo;
  if (backTo) {
    const target = steps.findIndex((step) => step.id === backTo);
    if (target >= 0) return target;
  }
  return nextStepIndex(steps, from, -1, anchorPresent);
}
