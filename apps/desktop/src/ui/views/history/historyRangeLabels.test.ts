// @vitest-environment happy-dom
import { beforeAll, describe, expect, it } from "vitest";
import type { HistorySelection } from "../../../historyStats";
import { historySpanLabel, historySelectionLabel } from "./historyRangeLabels";

/* Plan: docs/history-ranges-plan.md. Today is Friday, 6 Nov 2026. */
beforeAll(() => {
  process.env.TZ = "Europe/Berlin";
});

const nowMs = Date.parse("2026-11-06T21:40:00+01:00");
const local = (key: string) => {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day).getTime();
};
// Intl puts thin spaces around the dash of a date range.
const plain = (text: string) => text.replace(/\s+/g, " ");
const label = (selection: HistorySelection) =>
  plain(historySelectionLabel(selection, nowMs));
const before = (from: string, to: string) =>
  plain(historySpanLabel({ fromMs: local(from), toMs: local(to) }, nowMs));

describe("range labels", () => {
  // 1: the chips keep their names on the current period
  it("names the current period like its chip", () => {
    expect(label({ kind: "all" })).toBe("All time");
    expect(label({ kind: "month", offset: 0 })).toBe("This month");
    expect(label({ kind: "last30", offset: 0 })).toBe("30 days");
    expect(label({ kind: "last7", offset: 0 })).toBe("7 days");
    expect(label({ kind: "day", offset: 0 })).toBe("Today");
  });

  // 2 + 7: stepped periods and the quick picks
  it("names a stepped period by what it is", () => {
    expect(label({ kind: "month", offset: -1 })).toBe("October 2026");
    expect(label({ kind: "month", offset: -14 })).toBe("September 2025");
    expect(label({ kind: "day", offset: -1 })).toBe("Yesterday");
    expect(label({ kind: "day", offset: -2 })).toBe("Wed, Nov 4");
    expect(label({ kind: "last7", offset: -1 })).toBe("Oct 24 – 30");
    expect(label({ kind: "last30", offset: -1 })).toBe("Sep 8 – Oct 7");
    expect(label({ kind: "last90", offset: 0 })).toBe("90 days");
    expect(label({ kind: "week", offset: 0 })).toBe("This week");
    expect(label({ kind: "week", offset: -1 })).toBe("Last week");
    expect(label({ kind: "week", offset: -2 })).toBe("Oct 19 – 25");
    expect(label({ kind: "year", offset: 0 })).toBe("This year");
    expect(label({ kind: "year", offset: -1 })).toBe("2025");
  });

  // 5: a picked span
  it("names a picked span by its dates, with the year when it isn't this one", () => {
    expect(
      label({
        kind: "span",
        unit: "day",
        fromKey: "2026-10-03",
        length: 17,
        offset: 0,
      }),
    ).toBe("Oct 3 – 19");
    expect(
      label({
        kind: "span",
        unit: "month",
        fromKey: "2026-06-01",
        length: 3,
        offset: 0,
      }),
    ).toBe("Jun – Aug 2026");
    expect(
      label({
        kind: "span",
        unit: "day",
        fromKey: "2025-12-20",
        length: 20,
        offset: 0,
      }),
    ).toBe("Dec 20, 2025 – Jan 8, 2026");
  });

  // 17: "18% more than …" names the period before by its dates, so no
  // language has to fit "Yesterday" or "Last week" into the sentence
  it("names the period before by its dates", () => {
    expect(before("2026-09-01", "2026-10-01")).toBe("September 2026");
    expect(before("2025-01-01", "2026-01-01")).toBe("2025");
    expect(before("2026-10-01", "2026-10-07")).toBe("Oct 1 – 6");
    expect(before("2026-11-05", "2026-11-06")).toBe("Thu, Nov 5");
  });
});
