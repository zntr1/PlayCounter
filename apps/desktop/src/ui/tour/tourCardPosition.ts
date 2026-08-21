import type { CSSProperties } from "react";

export type TourTargetRect = {
  top: number;
  left: number;
  width: number;
  height: number;
};

type Viewport = { width: number; height: number };

export function tourCardPosition(
  rect: TourTargetRect | null,
  preferredPlacement: "below" | undefined,
  measuredCardHeight: number,
  viewport: Viewport,
): CSSProperties {
  if (!rect) {
    return { top: "50%", left: "50%", transform: "translate(-50%, -50%)" };
  }

  const width = Math.min(390, viewport.width - 32);
  const gap = 16;
  const edge = 16;
  const availableHeight = Math.max(0, viewport.height - edge * 2);
  const cardHeight = Math.min(measuredCardHeight, availableHeight);
  const clampLeft = (left: number) =>
    Math.min(viewport.width - width - edge, Math.max(edge, left));

  if (preferredPlacement === "below") {
    const top = rect.top + rect.height + gap;
    if (top + cardHeight <= viewport.height - edge) {
      return {
        top,
        left: clampLeft(rect.left + (rect.width - width) / 2),
      };
    }
  }

  const right = rect.left + rect.width + gap;
  const left = rect.left - width - gap;
  const horizontalPosition =
    right + width <= viewport.width - edge
      ? right
      : left >= edge
        ? left
        : clampLeft(rect.left + (rect.width - width) / 2);

  return {
    top: Math.min(
      viewport.height - cardHeight - edge,
      Math.max(edge, rect.top),
    ),
    left: horizontalPosition,
  };
}
