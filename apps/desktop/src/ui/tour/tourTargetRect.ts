import type { TourTargetRect } from "./tourCardPosition";
import type { TourStep } from "./tourDefinitions";

export function findTourElement(selector: string): HTMLElement | null {
  return (
    [...document.querySelectorAll<HTMLElement>(selector)].find((element) => {
      if (element.closest('[hidden], [inert], [aria-hidden="true"]'))
        return false;
      for (
        let parent: HTMLElement | null = element;
        parent;
        parent = parent.parentElement
      ) {
        const style = getComputedStyle(parent);
        if (style.display === "none" || style.visibility === "hidden")
          return false;
      }
      return true;
    }) ?? null
  );
}

/** A dialog/menu action takes over from the button that opened it. */
export function findTourTarget(
  step: Pick<TourStep, "anchor" | "anchorTargets">,
) {
  for (const selector of [
    ...(step.anchorTargets ?? []),
    ...(step.anchor ? [step.anchor] : []),
  ]) {
    const element = findTourElement(selector);
    if (element) return element;
  }
  return null;
}

export function tourFocusTarget(element: HTMLElement | null) {
  const selector =
    'button:not(:disabled),a[href],input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex]:not([tabindex="-1"]):not(:disabled)';
  if (element?.matches(selector)) return element;
  return element?.querySelector<HTMLElement>(selector) ?? null;
}

/** Highlight the visible part of a control inside scrolling panels. */
export function tourTargetRect(element: Element): TourTargetRect | null {
  const bounds = element.getBoundingClientRect();
  let left = Math.max(0, bounds.left);
  let top = Math.max(0, bounds.top);
  let right = Math.min(window.innerWidth, bounds.right);
  let bottom = Math.min(window.innerHeight, bounds.bottom);
  for (
    let parent = element.parentElement;
    parent;
    parent = parent.parentElement
  ) {
    const style = getComputedStyle(parent);
    const clipX = /auto|scroll|hidden|clip/.test(style.overflowX);
    const clipY = /auto|scroll|hidden|clip/.test(style.overflowY);
    if (!clipX && !clipY) continue;
    const rect = parent.getBoundingClientRect();
    if (clipX) {
      left = Math.max(left, rect.left);
      right = Math.min(right, rect.right);
    }
    if (clipY) {
      top = Math.max(top, rect.top);
      bottom = Math.min(bottom, rect.bottom);
    }
  }
  return right > left && bottom > top
    ? { top, left, width: right - left, height: bottom - top }
    : null;
}
