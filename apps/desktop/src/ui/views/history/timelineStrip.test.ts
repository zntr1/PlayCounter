import { beforeAll, describe, expect, it } from "vitest";
import type { DailyTotal } from "../../../historyStats";
import {
  stripDragMode,
  stripDragRange,
  stripWeekAt,
  stripWeeks,
} from "./timelineStrip";

/* Plan: docs/history-ranges-plan.md, sentences 12–13. History from
   1 Sep 2025 to today, Friday 6 Nov 2026. */
beforeAll(() => {
  const runtime = globalThis as typeof globalThis & {
    process?: { env: Record<string, string | undefined> };
  };
  if (runtime.process) runtime.process.env.TZ = "Europe/Berlin";
});

const local = (key: string) => {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day).getTime();
};
const at = (key: string, hour: number) => local(key) + hour * 3_600_000;
const days = (from: string, to: string) => ({
  fromMs: local(from),
  toMs: local(to),
});
const limits = () => ({
  minMs: local("2025-09-01"),
  maxMs: local("2026-11-07"),
});
const drag = (
  mode: Parameters<typeof stripDragRange>[0],
  startMs: number,
  pointerMs: number,
  range: { fromMs: number; toMs: number },
) => stripDragRange(mode, { startMs, pointerMs, range, ...limits() });

describe("timeline strip", () => {
  it("drags a new range in whole days, in either direction", () => {
    const shown = days("2026-11-01", "2026-11-07");
    expect(
      drag("new", at("2026-10-03", 12), at("2026-10-19", 8), shown),
    ).toEqual(days("2026-10-03", "2026-10-20"));
    expect(
      drag("new", at("2026-10-19", 8), at("2026-10-03", 12), shown),
    ).toEqual(days("2026-10-03", "2026-10-20"));
  });

  it("moves the window by whole days and keeps its length", () => {
    const picked = days("2026-10-03", "2026-10-20");
    expect(
      drag("move", at("2026-10-05", 12), at("2026-10-08", 22), picked),
    ).toEqual(days("2026-10-06", "2026-10-23"));
    // never past today
    expect(
      drag("move", at("2026-10-05", 12), at("2026-12-30", 0), picked),
    ).toEqual(days("2026-10-21", "2026-11-07"));
    // never before the first session
    expect(
      drag("move", at("2026-10-05", 12), at("2024-01-01", 0), picked),
    ).toEqual(days("2025-09-01", "2025-09-18"));
  });

  it("resizes from either edge, never below one day", () => {
    const picked = days("2026-10-03", "2026-10-20");
    expect(drag("start", 0, at("2026-09-28", 15), picked)).toEqual(
      days("2026-09-28", "2026-10-20"),
    );
    expect(drag("start", 0, at("2026-10-25", 15), picked)).toEqual(
      days("2026-10-19", "2026-10-20"),
    );
    expect(drag("end", 0, at("2026-10-24", 1), picked)).toEqual(
      days("2026-10-03", "2026-10-25"),
    );
    expect(drag("end", 0, at("2026-09-01", 1), picked)).toEqual(
      days("2026-10-03", "2026-10-04"),
    );
  });

  it("opens the week of a clicked bar, cut at the history's edges", () => {
    const { minMs, maxMs } = limits();
    expect(stripWeekAt(at("2026-10-08", 9), minMs, maxMs)).toEqual(
      days("2026-10-05", "2026-10-12"),
    );
    expect(stripWeekAt(at("2026-11-05", 9), minMs, maxMs)).toEqual(
      days("2026-11-02", "2026-11-07"),
    );
    expect(stripWeekAt(at("2025-09-02", 9), minMs, maxMs)).toEqual(
      days("2025-09-01", "2025-09-08"),
    );
  });

  it("starts a new range inside a window that covers almost everything", () => {
    expect(stripDragMode({ handle: null, insideWindow: true }, 0.4)).toBe(
      "move",
    );
    expect(stripDragMode({ handle: null, insideWindow: true }, 0.95)).toBe(
      "new",
    );
    expect(stripDragMode({ handle: "start", insideWindow: true }, 0.95)).toBe(
      "start",
    );
    expect(stripDragMode({ handle: null, insideWindow: false }, 0.4)).toBe(
      "new",
    );
  });

  it("adds up the history per week, Monday to Sunday", () => {
    const total = (seconds: number): DailyTotal => ({
      seconds,
      sessionCount: 1,
      topGameKey: null,
    });
    const daily = new Map([
      ["2026-10-05", total(3600)],
      ["2026-10-11", total(1800)],
      ["2026-10-12", total(600)],
    ]);
    expect(
      stripWeeks(daily, at("2026-10-06", 20), local("2026-10-14")),
    ).toEqual([
      { ...days("2026-10-05", "2026-10-12"), seconds: 5400 },
      { ...days("2026-10-12", "2026-10-14"), seconds: 600 },
    ]);
  });
});
