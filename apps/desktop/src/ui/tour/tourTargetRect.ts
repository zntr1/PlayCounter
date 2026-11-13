import type { TourStep } from "./tourDefinitions";

export type TourTargetRect = {
  top: number;
  left: number;
  width: number;
  height: number;
};

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
  step: Pick<TourStep, "anchor" | "anchorTargets" | "interactive">,
) {
  const dialog = step.interactive
    ? [
        ...document.querySelectorAll<HTMLElement>(
          '[data-tour="demo-library-modal"] [role="dialog"]',
        ),
      ]
        .filter(
          (element) =>
            !element.closest('[hidden], [inert], [aria-hidden="true"]'),
        )
        .at(-1)
    : undefined;
  for (const selector of [
    ...(step.anchorTargets ?? []),
    ...(step.anchor ? [step.anchor] : []),
  ]) {
    const element = findTourElement(selector);
    if (element) {
      const menu = element.closest('[role="menu"]');
      const newerMenu =
        dialog &&
        menu &&
        dialog.compareDocumentPosition(menu) & Node.DOCUMENT_POSITION_FOLLOWING;
      return dialog && !dialog.contains(element) && !newerMenu
        ? dialog
        : element;
    }
  }
  return dialog ?? null;
}

/** Read-only fields are skipped: the hotkey recorder starts listening on
 *  focus and would swallow the keys that page through the guide. */
export function tourFocusTarget(element: HTMLElement | null) {
  const selector =
    'button:not(:disabled),a[href],input:not(:disabled):not([readonly]),textarea:not(:disabled),select:not(:disabled),[tabindex]:not([tabindex="-1"]):not(:disabled)';
  if (element?.matches(selector)) return element;
  const preferred = element?.querySelector<HTMLElement>("[data-autofocus]");
  if (preferred?.matches(selector)) return preferred;
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

/** How far apart two targets may be for their rings to touch: a ring is drawn
 *  6 px outside its target on every side. */
const RING_REACH = 12;

/** Where the ring around a target is drawn: 6 px outside it, but never
 *  closer than 4 px to the window's edge, so its line and glow stay in
 *  view around a target at the edge, like the title bar. */
export function tourRingBox(rect: TourTargetRect): TourTargetRect {
  const left = Math.max(4, rect.left - 6);
  const top = Math.max(4, rect.top - 6);
  const right = Math.min(window.innerWidth - 4, rect.left + rect.width + 6);
  const bottom = Math.min(window.innerHeight - 4, rect.top + rect.height + 6);
  return { left, top, width: right - left, height: bottom - top };
}

/** Targets that sit right next to each other share one ring instead of two
 *  rings that touch or overlap. The result keeps the order of `rects`; a
 *  merged ring takes the place of its first target. */
export function mergeTouchingRects(rects: TourTargetRect[]) {
  const merged = rects.map((rect) => ({ ...rect }));
  const gap = (
    from: number,
    size: number,
    otherFrom: number,
    otherSize: number,
  ) => Math.max(0, otherFrom - (from + size), from - (otherFrom + otherSize));
  for (let index = 0; index < merged.length; index += 1) {
    for (let other = index + 1; other < merged.length; other += 1) {
      const a = merged[index];
      const b = merged[other];
      if (
        gap(a.left, a.width, b.left, b.width) > RING_REACH ||
        gap(a.top, a.height, b.top, b.height) > RING_REACH
      )
        continue;
      const left = Math.min(a.left, b.left);
      const top = Math.min(a.top, b.top);
      merged[index] = {
        left,
        top,
        width: Math.max(a.left + a.width, b.left + b.width) - left,
        height: Math.max(a.top + a.height, b.top + b.height) - top,
      };
      merged.splice(other, 1);
      // The grown ring may now reach a target it passed before.
      other = index;
    }
  }
  return merged;
}
