// The scroll offset (in viewport heights) after which "back to top" is offered.
export const BACK_TO_TOP_VIEWPORTS = 1.5;

export function shouldShowBackToTop(scrollTop: number, viewportHeight: number) {
  if (viewportHeight <= 0) return false;
  return scrollTop > viewportHeight * BACK_TO_TOP_VIEWPORTS;
}
