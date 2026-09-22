import { useEffect, useRef, useState } from "react";

/* Four steps of the accent so heatmaps sit in the same palette as every
   other chart; alpha keeps the ramp readable in the light theme too. */
export const heatmapColors = [
  "rgb(var(--color-accent) / 0.3)",
  "rgb(var(--color-accent) / 0.52)",
  "rgb(var(--color-accent) / 0.76)",
  "rgb(var(--color-accent))",
] as const;

export function heatmapColor(level: number, stepCount: number) {
  if (level <= 0) return null;
  if (stepCount <= 1) return heatmapColors.at(-1)!;
  const index = Math.round(
    ((level - 1) * (heatmapColors.length - 1)) / (stepCount - 1),
  );
  return heatmapColors[index];
}

const identityWidth = (width: number) => width;

export function useElementWidth<T extends HTMLElement>(
  selectWidth: (width: number) => number = identityWidth,
) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(() => selectWidth(0));
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    let lastWidth: number | undefined;
    const observer = new ResizeObserver(([entry]) => {
      // Heatmaps only need an update when their cell size changes, not for
      // every intermediate pixel of a sidebar or window resize.
      const nextWidth = selectWidth(
        Math.max(0, Math.round(entry.contentRect.width)),
      );
      if (nextWidth === lastWidth) return;
      lastWidth = nextWidth;
      setWidth(nextWidth);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [selectWidth]);
  return [ref, width] as const;
}

export function localDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function addDays(date: Date, days: number) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  result.setHours(0, 0, 0, 0);
  return result;
}

export function formatAccessibleDate(date: Date) {
  return date.toLocaleDateString([], {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}
