import {
  formatHistoryDays,
  resolveHistorySelection,
  type HistoryRange,
  type HistorySelection,
} from "../../../historyStats";
import { appLocale, getT } from "../../../i18n";

const t = getT("history");

export type HistoryChipKind = "all" | "month" | "last30" | "last7" | "day";

/** The range chips. Built while rendering, so a language switch renames them. */
export function historyChips(): Array<{
  kind: HistoryChipKind;
  label: string;
}> {
  return [
    { kind: "all", label: t("All time") },
    { kind: "month", label: t("This month") },
    { kind: "last30", label: t("30 days") },
    { kind: "last7", label: t("7 days") },
    { kind: "day", label: t("Today") },
  ];
}

function monthName(ms: number) {
  return new Date(ms).toLocaleDateString(appLocale(), {
    month: "long",
    year: "numeric",
  });
}

function yearName(ms: number) {
  return new Date(ms).toLocaleDateString(appLocale(), { year: "numeric" });
}

function monthSpan(range: HistoryRange) {
  const last = new Date(range.toMs);
  last.setDate(last.getDate() - 1);
  const from = new Date(range.fromMs);
  if (
    from.getFullYear() === last.getFullYear() &&
    from.getMonth() === last.getMonth()
  )
    return monthName(range.fromMs);
  return new Intl.DateTimeFormat(appLocale(), {
    month: "short",
    year: "numeric",
  }).formatRange(from, last);
}

/** What the eyebrow, the active chip and the strip call the selection. */
export function historySelectionLabel(
  selection: HistorySelection,
  nowMs: number,
): string {
  if (selection.kind === "all") return t("All time");
  const range = resolveHistorySelection(selection, nowMs)!;
  const days = () => formatHistoryDays(range.fromMs, range.toMs, nowMs);
  const current = selection.offset === 0;
  switch (selection.kind) {
    case "month":
      return current ? t("This month") : monthName(range.fromMs);
    case "year":
      return current ? t("This year") : yearName(range.fromMs);
    case "week":
      return current
        ? t("This week")
        : selection.offset === -1
          ? t("Last week")
          : days();
    case "day":
      return current
        ? t("Today")
        : selection.offset === -1
          ? t("Yesterday")
          : days();
    case "last7":
      return current ? t("7 days") : days();
    case "last30":
      return current ? t("30 days") : days();
    case "last90":
      return current ? t("90 days") : days();
    case "span":
      return selection.unit === "month" ? monthSpan(range) : days();
  }
}

/** Days by their dates: "September 2026", "2025", "Oct 1 – 6". The period
 *  before uses it too: dates, not "Yesterday" or "Last week", so every
 *  language can put it into "18% more than …". */
export function historySpanLabel(range: HistoryRange, nowMs: number) {
  const from = new Date(range.fromMs);
  if (from.getDate() === 1) {
    const year = from.getFullYear();
    if (range.toMs === new Date(year, from.getMonth() + 1, 1).getTime())
      return monthName(range.fromMs);
    if (
      from.getMonth() === 0 &&
      range.toMs === new Date(year + 1, 0, 1).getTime()
    )
      return yearName(range.fromMs);
  }
  return formatHistoryDays(range.fromMs, range.toMs, nowMs);
}
