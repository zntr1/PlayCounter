import { useLayoutEffect, useState } from "react";
import {
  MAX_LIBRARY_GRID_COLUMNS,
  type MyGamesCardSize,
} from "./myGamesPresentation";

const MIN_CARD_WIDTH = 160;

/** Read preset columns from CSS so the slider follows the responsive layouts. */
export function useLibraryGridColumns(
  view: MyGamesCardSize,
  requestedColumns: number | null,
) {
  const [grid, setGrid] = useState<HTMLDivElement | null>(null);
  // Only the derived column counts live in state. Keeping the raw width here
  // re-rendered the whole library on every observed pixel, which is every
  // frame while the sidebar animates its width.
  const [measurement, setMeasurement] = useState({
    capacity: 0,
    presetColumns: 0,
    view,
  });
  const custom = requestedColumns !== null;

  useLayoutEffect(() => {
    if (!grid || view === "list") return;
    const measure = () => {
      // Hidden views have no layout; keep the last measurement until visible.
      if (!grid.clientWidth) return;
      const style = window.getComputedStyle(grid);
      const gap = Number.parseFloat(style.columnGap) || 0;
      const capacity = Math.max(
        1,
        Math.min(
          MAX_LIBRARY_GRID_COLUMNS,
          Math.floor((grid.clientWidth + gap) / (MIN_CARD_WIDTH + gap)),
        ),
      );
      const presetColumns = custom
        ? 0
        : (style.gridTemplateColumns.match(/[\d.]+px/g)?.length ?? 0);
      setMeasurement((current) =>
        current.capacity === capacity &&
        current.presetColumns === presetColumns &&
        current.view === view
          ? current
          : { capacity, presetColumns, view },
      );
    };
    measure();
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(measure);
    observer?.observe(grid);
    // A CSS breakpoint can change the columns without changing the grid width.
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [grid, view, custom]);

  const capacity = measurement.capacity || MAX_LIBRARY_GRID_COLUMNS;
  const presetColumns =
    (measurement.view === view && measurement.presetColumns) ||
    (view === "large" ? 3 : 4);
  const columns = custom ? Math.min(requestedColumns, capacity) : presetColumns;

  return {
    gridRef: setGrid,
    columns,
    // Resizing never overwrites the saved choice or moves its slider thumb.
    sliderValue: requestedColumns ?? columns,
    maxColumns: Math.max(capacity, requestedColumns ?? columns),
    style:
      view !== "list" && custom
        ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }
        : undefined,
  };
}
