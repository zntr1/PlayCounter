import type { ViewId } from "../../store";
import type { TourStep } from "./tourDefinitions";
import { settingsTourAnchorAvailable } from "../views/settings/settingsGroups";

export function stepView(
  step: TourStep,
  activeView: ViewId,
  returnView: ViewId,
) {
  if (step.view === "keep") return activeView;
  return step.view === "return" ? returnView : step.view;
}

/** Whether an optional step can show its control. A Settings step opens
 *  its own group first, so it asks the group instead of the screen. */
function stepAvailable(
  step: TourStep,
  anchorPresent: (selector: string) => boolean,
) {
  if (!step.optional || !step.anchor) return true;
  if (step.settingsGroup)
    return settingsTourAnchorAvailable(step.settingsGroup, step.anchor);
  return anchorPresent(step.anchor);
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
    !stepAvailable(steps[index], anchorPresent)
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
