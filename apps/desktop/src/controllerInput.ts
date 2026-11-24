import type { MyGamesCardSize } from "./ui/myGamesPresentation";

export type ControllerAction =
  | "reveal"
  | "toggleLibraryView"
  | "up"
  | "down"
  | "left"
  | "right"
  | "scrollUp"
  | "scrollDown"
  | "confirm"
  | "back"
  | "toggleFullscreen"
  | "stopGame"
  | "openDetails"
  | "previousTab"
  | "nextTab";

export type ControllerItemRect = {
  top: number;
  left: number;
  width: number;
  height: number;
};

export function nextControllerIndex(
  rects: readonly ControllerItemRect[],
  current: number,
  action: Extract<ControllerAction, "up" | "down" | "left" | "right">,
  // Cards: with nothing to the side, Left and Right go on to the card before
  // or after in reading order. Settings controls stay put instead.
  { readingOrder = true }: { readingOrder?: boolean } = {},
) {
  if (rects.length === 0) return -1;
  if (current < 0 || current >= rects.length) return 0;
  const origin = center(rects[current]);
  let best = current;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let index = 0; index < rects.length; index += 1) {
    if (index === current) continue;
    const candidate = center(rects[index]);
    const dx = candidate.x - origin.x;
    const dy = candidate.y - origin.y;
    const inDirection =
      (action === "left" && dx < -1) ||
      (action === "right" && dx > 1) ||
      (action === "up" && dy < -1) ||
      (action === "down" && dy > 1);
    if (!inDirection) continue;
    const primary =
      action === "left" || action === "right" ? Math.abs(dx) : Math.abs(dy);
    const cross =
      action === "left" || action === "right" ? Math.abs(dy) : Math.abs(dx);
    // Keep navigation inside a natural directional cone. Without this, a
    // control in the header can steal Right from the final card in a row just
    // because it is technically a few pixels farther right.
    if (cross > primary * 1.75 + 80) continue;
    const score = primary + cross * 2.5;
    if (score < bestScore) {
      best = index;
      bestScore = score;
    }
  }
  if (!readingOrder) return best;
  if (best === current && action === "right" && current < rects.length - 1) {
    return current + 1;
  }
  if (best === current && action === "left" && current > 0) {
    return current - 1;
  }
  return best;
}

// View / Create cycles My Games through these. The list stays out: on a TV
// it shows too little, and from the list the button starts at Standard.
const CONTROLLER_LIBRARY_VIEWS: readonly MyGamesCardSize[] = [
  "grid",
  "large",
  "covers",
];

export function nextControllerLibraryView(view: MyGamesCardSize) {
  const index = CONTROLLER_LIBRARY_VIEWS.indexOf(view);
  return CONTROLLER_LIBRARY_VIEWS[
    (index + 1) % CONTROLLER_LIBRARY_VIEWS.length
  ]!;
}

export function isLeftmostVisualItem(
  rects: readonly ControllerItemRect[],
  current: number,
) {
  if (current < 0 || current >= rects.length) return false;
  const origin = rects[current];
  const originCenter = center(origin);
  return !rects.some((candidate, index) => {
    if (index === current) return false;
    const overlap =
      Math.min(origin.top + origin.height, candidate.top + candidate.height) -
      Math.max(origin.top, candidate.top);
    const sameRow = overlap > Math.min(origin.height, candidate.height) * 0.35;
    return sameRow && center(candidate).x < originCenter.x - 1;
  });
}

function center(rect: ControllerItemRect) {
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  };
}
