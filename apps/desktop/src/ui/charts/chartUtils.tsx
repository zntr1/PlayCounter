import { useEffect, useRef, useState } from "react";

export const heatmapColors = [
  "#d8f3df",
  "#91dda7",
  "#3fc66a",
  "#00a83d",
] as const;

export function heatmapColor(level: number, stepCount: number) {
  if (level <= 0) return null;
  if (stepCount <= 1) return heatmapColors.at(-1)!;
  const index = Math.round(
    ((level - 1) * (heatmapColors.length - 1)) / (stepCount - 1),
  );
  return heatmapColors[index];
}

export function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      setWidth(Math.max(0, Math.round(entry.contentRect.width)));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
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
