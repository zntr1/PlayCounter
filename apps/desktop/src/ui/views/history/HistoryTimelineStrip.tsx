import clsx from "clsx";
import { useMemo, useRef, useState } from "react";
import type { DailyTotal, HistoryRange } from "../../../historyStats";
import { useElementWidth } from "../../charts/chartUtils";
import { appLocale, getT } from "../../../i18n";
import {
  stripDragMode,
  stripDragRange,
  stripWeekAt,
  stripWeeks,
  type StripDragMode,
} from "./timelineStrip";

const t = getT("history");

function startOfDay(ms: number) {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function addDays(ms: number, days: number) {
  const date = new Date(ms);
  date.setDate(date.getDate() + days);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/* The hero's timeline: the whole history as weekly bars, the range as a
   window over them. Drag on the bars for new days, drag the window to move
   it, drag its edges to resize it, click a bar for that week. A pointer
   control only: the chips and Pick dates do the same by keyboard. */
export function HistoryTimelineStrip({
  historyDaily,
  firstSessionMs,
  nowMs,
  range,
  describe,
  onPick,
}: {
  historyDaily: ReadonlyMap<string, DailyTotal>;
  firstSessionMs: number;
  nowMs: number;
  /** The range on show; null = all time. */
  range: HistoryRange | null;
  /** The label above the strip for a span: "Oct 3 – 19 · 17 days". */
  describe: (range: HistoryRange) => string;
  onPick: (range: HistoryRange) => void;
}) {
  const minMs = startOfDay(firstSessionMs);
  const maxMs = addDays(startOfDay(nowMs), 1);
  const weeks = useMemo(
    () => stripWeeks(historyDaily, firstSessionMs, maxMs),
    [firstSessionMs, historyDaily, maxMs],
  );
  const startMs = weeks[0]?.fromMs ?? minMs;
  const [trackRef, width] = useElementWidth<HTMLDivElement>();
  const [preview, setPreview] = useState<HistoryRange | null>(null);
  const drag = useRef<{
    mode: StripDragMode;
    startMs: number;
    x0: number;
    moved: boolean;
  } | null>(null);
  const shown = range ?? { fromMs: minMs, toMs: maxMs };
  const visible = preview ?? shown;
  const span = Math.max(1, maxMs - startMs);
  const xOf = (ms: number) => ((ms - startMs) / span) * width;
  const msAt = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return startMs;
    return startMs + ((clientX - rect.left) / rect.width) * span;
  };
  const most = Math.max(1, ...weeks.map((week) => week.seconds));
  const months = useMemo(() => {
    const labels: Array<{ ms: number; label: string }> = [];
    const first = new Date(startMs);
    let month = new Date(first.getFullYear(), first.getMonth(), 1).getTime();
    if (month < startMs)
      month = new Date(first.getFullYear(), first.getMonth() + 1, 1).getTime();
    for (let index = 0; month < maxMs; index += 1) {
      const date = new Date(month);
      labels.push({
        ms: month,
        label: date.toLocaleDateString(
          appLocale(),
          index === 0 || date.getMonth() === 0
            ? { month: "short", year: "numeric" }
            : { month: "short" },
        ),
      });
      month = new Date(date.getFullYear(), date.getMonth() + 1, 1).getTime();
    }
    return labels;
  }, [maxMs, startMs]);
  let lastLabelX = Number.NEGATIVE_INFINITY;

  return (
    <div className="border-t border-border/60 pt-3.5 lg:col-span-2">
      <div className="mb-2 flex items-baseline justify-between gap-3 text-xs text-text-faint">
        <span>{t("Your whole history · drag to pick days")}</span>
        <span data-strip-label className="font-mono font-semibold text-text">
          {describe(visible)}
        </span>
      </div>
      <div
        ref={trackRef}
        aria-hidden="true"
        className="relative h-[68px] cursor-crosshair touch-none select-none"
        onPointerDown={(event) => {
          if (event.button !== 0 || width === 0) return;
          const target = event.target as Element;
          const handle = target
            .closest("[data-strip-handle]")
            ?.getAttribute("data-strip-handle");
          const mode = stripDragMode(
            {
              handle: handle === "start" || handle === "end" ? handle : null,
              insideWindow: Boolean(target.closest("[data-strip-window]")),
            },
            (xOf(shown.toMs) - xOf(shown.fromMs)) / width,
          );
          drag.current = {
            mode,
            startMs: msAt(event.clientX),
            x0: event.clientX,
            moved: false,
          };
          event.currentTarget.setPointerCapture?.(event.pointerId);
          event.preventDefault();
        }}
        onPointerMove={(event) => {
          const current = drag.current;
          if (!current) return;
          if (!current.moved && Math.abs(event.clientX - current.x0) < 4)
            return;
          current.moved = true;
          setPreview(
            stripDragRange(current.mode, {
              startMs: current.startMs,
              pointerMs: msAt(event.clientX),
              range: shown,
              minMs,
              maxMs,
            }),
          );
        }}
        onPointerUp={(event) => {
          const current = drag.current;
          drag.current = null;
          setPreview(null);
          if (!current) return;
          if (current.moved)
            onPick(
              stripDragRange(current.mode, {
                startMs: current.startMs,
                pointerMs: msAt(event.clientX),
                range: shown,
                minMs,
                maxMs,
              }),
            );
          else if (current.mode === "new")
            onPick(stripWeekAt(current.startMs, minMs, maxMs));
        }}
        onPointerCancel={() => {
          drag.current = null;
          setPreview(null);
        }}
      >
        {width > 0 ? (
          <>
            <div className="absolute inset-x-0 top-0.5 h-[46px]">
              {weeks.map((week) => {
                const left = xOf(week.fromMs);
                return (
                  <span
                    key={week.fromMs}
                    className={clsx(
                      "absolute bottom-0 rounded-t-[2px]",
                      week.toMs > visible.fromMs && week.fromMs < visible.toMs
                        ? "bg-accent"
                        : "bg-text-muted/30",
                    )}
                    style={{
                      left: left + 1,
                      width: Math.max(1, xOf(week.toMs) - left - 2),
                      height:
                        week.seconds > 0
                          ? Math.max(2, (week.seconds / most) * 44)
                          : 0,
                    }}
                  />
                );
              })}
            </div>
            <div
              data-strip-window
              className="absolute -top-[3px] h-14 cursor-grab rounded-md border-[1.5px] border-accent bg-accent/[0.08]"
              style={{
                left: xOf(visible.fromMs),
                width: Math.max(6, xOf(visible.toMs) - xOf(visible.fromMs)),
              }}
            >
              <span
                data-strip-handle="start"
                className="absolute -left-[5px] top-1/2 h-[26px] w-2 -translate-y-1/2 cursor-ew-resize rounded bg-accent shadow-[0_0_0_2px_rgb(var(--color-surface))]"
              />
              <span
                data-strip-handle="end"
                className="absolute -right-[5px] top-1/2 h-[26px] w-2 -translate-y-1/2 cursor-ew-resize rounded bg-accent shadow-[0_0_0_2px_rgb(var(--color-surface))]"
              />
            </div>
            <div className="pointer-events-none absolute inset-x-0 top-[55px] h-3.5">
              {months.map((month) => {
                const x = xOf(month.ms);
                if (x - lastLabelX < 34) return null;
                lastLabelX = x;
                return (
                  <span
                    key={month.ms}
                    className="absolute whitespace-nowrap border-l border-border pl-1 text-[10px] font-semibold leading-[13px] text-text-faint"
                    style={{ left: x }}
                  >
                    {month.label}
                  </span>
                );
              })}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
