import clsx from "clsx";
import { Check, ChevronLeft, ChevronRight, X } from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import {
  formatHistoryDays,
  historySelectionFromRange,
  quantileLevel,
  quantileThresholds,
  resolveHistorySelection,
  type DailyTotal,
  type HistorySelection,
} from "../../../historyStats";
import { formatDuration } from "../../components";
import {
  formatAccessibleDate,
  heatmapColor,
  localDateKey,
} from "../../charts/chartUtils";
import { appLocale, getT, weekdayNames } from "../../../i18n";

const t = getT("history");
const tc = getT("common");

type PickerMode = "days" | "months" | "years";
type Span = { fromMs: number; lastMs: number };

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

function startOfMonth(ms: number) {
  const date = new Date(ms);
  return new Date(date.getFullYear(), date.getMonth(), 1).getTime();
}

function addMonths(ms: number, months: number) {
  const date = new Date(startOfMonth(ms));
  date.setMonth(date.getMonth() + months);
  return date.getTime();
}

function monthKey(ms: number) {
  return localDateKey(new Date(ms)).slice(0, 7);
}

/** Quick picks: they apply at once. */
function quickPicks(): Array<{ label: string; selection: HistorySelection }> {
  return [
    { label: t("Yesterday"), selection: { kind: "day", offset: -1 } },
    { label: t("This week"), selection: { kind: "week", offset: 0 } },
    { label: t("Last week"), selection: { kind: "week", offset: -1 } },
    { label: t("Last month"), selection: { kind: "month", offset: -1 } },
    { label: t("90 days"), selection: { kind: "last90", offset: 0 } },
    { label: t("This year"), selection: { kind: "year", offset: 0 } },
    { label: t("Last year"), selection: { kind: "year", offset: -1 } },
  ];
}

function pickerModes(): Array<{ id: PickerMode; label: string }> {
  return [
    { id: "days", label: t("Days") },
    { id: "months", label: t("Months") },
    { id: "years", label: t("Years") },
  ];
}

/* Pick dates: quick picks on the left; on the right two months of days, the
   months of a year, or the years. Click one day (month), then another; the
   footer says what that holds. Show applies it, Esc or a click outside
   closes without a change. */
export function HistoryDatePicker({
  anchorRef,
  selection,
  nowMs,
  firstSessionMs,
  historyDaily,
  showDurationDays,
  practice,
  onPick,
  onClose,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  selection: HistorySelection;
  nowMs: number;
  firstSessionMs: number | null;
  /** Playtime per day over the whole history. */
  historyDaily: ReadonlyMap<string, DailyTotal>;
  showDurationDays: boolean;
  practice: boolean;
  onPick: (selection: HistorySelection) => void;
  onClose: () => void;
}) {
  const todayMs = startOfDay(nowMs);
  const firstDayMs =
    firstSessionMs === null ? todayMs : startOfDay(firstSessionMs);
  const [initial] = useState<Span>(() => {
    const range = resolveHistorySelection(selection, nowMs) ?? {
      fromMs: firstDayMs,
      toMs: addDays(todayMs, 1),
    };
    return { fromMs: range.fromMs, lastMs: addDays(range.toMs, -1) };
  });
  const [mode, setMode] = useState<PickerMode>("days");
  const [draft, setDraft] = useState<Span>(initial);
  const [pending, setPending] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [viewMonth, setViewMonth] = useState(() =>
    addMonths(initial.lastMs, -1),
  );
  const [viewYear, setViewYear] = useState(() =>
    new Date(initial.lastMs).getFullYear(),
  );
  const panelRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 0, top: 0 });

  const thresholds = useMemo(
    () =>
      quantileThresholds([...historyDaily.values()].map((day) => day.seconds)),
    [historyDaily],
  );
  const monthTotals = useMemo(() => {
    const totals = new Map<string, number>();
    for (const [key, day] of historyDaily) {
      const month = key.slice(0, 7);
      totals.set(month, (totals.get(month) ?? 0) + day.seconds);
    }
    return totals;
  }, [historyDaily]);
  const monthMax = Math.max(1, ...monthTotals.values());

  const shown: Span =
    pending !== null && hover !== null
      ? {
          fromMs: Math.min(pending, hover),
          lastMs: Math.max(pending, hover),
        }
      : draft;
  const shownSeconds = useMemo(() => {
    let seconds = 0;
    for (let day = shown.fromMs; day <= shown.lastMs; day = addDays(day, 1))
      seconds += historyDaily.get(localDateKey(new Date(day)))?.seconds ?? 0;
    return seconds;
  }, [historyDaily, shown.fromMs, shown.lastMs]);
  const shownDays = Math.round((shown.lastMs - shown.fromMs) / 86_400_000) + 1;
  const shownText = formatHistoryDays(
    shown.fromMs,
    addDays(shown.lastMs, 1),
    nowMs,
  );

  useLayoutEffect(() => {
    const place = () => {
      const anchor = anchorRef.current?.getBoundingClientRect();
      const panel = panelRef.current?.getBoundingClientRect();
      if (!anchor || !panel) return;
      const left = Math.max(
        8,
        Math.min(anchor.left, window.innerWidth - panel.width - 8),
      );
      const below = anchor.bottom + 8;
      const top =
        below + panel.height <= window.innerHeight - 8
          ? below
          : Math.max(8, anchor.top - panel.height - 8);
      setPosition((current) =>
        current.left === left && current.top === top ? current : { left, top },
      );
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchorRef, mode]);

  useEffect(() => {
    panelRef.current?.focus({ preventScroll: true });
    const outside = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (
        panelRef.current?.contains(target) ||
        anchorRef.current?.contains(target) ||
        target.closest("[data-tour-card]")
      )
        return;
      onClose();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      onClose();
      anchorRef.current?.focus({ preventScroll: true });
    };
    window.addEventListener("mousedown", outside);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("mousedown", outside);
      window.removeEventListener("keydown", escape);
    };
  }, [anchorRef, onClose]);

  const pickDay = (dayMs: number) => {
    if (pending === null) {
      setPending(dayMs);
      setDraft({ fromMs: dayMs, lastMs: dayMs });
    } else {
      setDraft({
        fromMs: Math.min(pending, dayMs),
        lastMs: Math.max(pending, dayMs),
      });
      setPending(null);
    }
    setHover(null);
  };
  const monthEnd = (monthMs: number) =>
    Math.min(addDays(addMonths(monthMs, 1), -1), todayMs);
  const pickMonth = (monthMs: number) => {
    if (pending === null) {
      setPending(monthMs);
      setDraft({ fromMs: monthMs, lastMs: monthEnd(monthMs) });
    } else {
      setDraft({
        fromMs: Math.min(pending, monthMs),
        lastMs: monthEnd(Math.max(pending, monthMs)),
      });
      setPending(null);
    }
    setHover(null);
  };
  const apply = () =>
    onPick(
      historySelectionFromRange(
        draft.fromMs,
        addDays(draft.lastMs, 1),
        nowMs,
        firstSessionMs,
      ),
    );

  const weekdays = weekdayNames("short");
  const monthGrid = (monthMs: number, side: "left" | "right") => {
    const lead = (new Date(monthMs).getDay() + 6) % 7;
    const next = addMonths(monthMs, 1);
    const days: number[] = [];
    for (let day = monthMs; day < next; day = addDays(day, 1)) days.push(day);
    const earlier = side === "left";
    const navDisabled = earlier
      ? monthMs <= startOfMonth(firstDayMs)
      : next > todayMs;
    const nav = (
      <button
        type="button"
        aria-label={earlier ? t("Earlier months") : t("Later months")}
        disabled={navDisabled}
        onClick={() =>
          setViewMonth((month) => addMonths(month, earlier ? -1 : 1))
        }
        className="grid h-7 w-7 place-items-center rounded-lg text-text-muted transition-colors hover:bg-surface-hover hover:text-text disabled:pointer-events-none disabled:opacity-25"
      >
        {earlier ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
      </button>
    );
    return (
      <div className="min-w-0">
        <div className="mb-1 flex items-center justify-between gap-1">
          {earlier ? nav : <span className="w-7" />}
          <button
            type="button"
            title={t("Pick the whole month")}
            onClick={() => {
              setDraft({ fromMs: monthMs, lastMs: monthEnd(monthMs) });
              setPending(null);
              setHover(null);
            }}
            className="rounded-lg px-2 py-1 text-sm font-bold text-text transition-colors hover:bg-surface-hover hover:text-accent-ink"
          >
            {new Date(monthMs).toLocaleDateString(appLocale(), {
              month: "long",
              year: "numeric",
            })}
          </button>
          {earlier ? <span className="w-7" /> : nav}
        </div>
        <div className="grid grid-cols-7 gap-y-0.5">
          {weekdays.map((weekday) => (
            <span
              key={weekday}
              aria-hidden="true"
              className="py-1 text-center text-[11px] font-semibold text-text-faint"
            >
              {weekday}
            </span>
          ))}
          {Array.from({ length: lead }, (_, index) => (
            <span key={`lead-${index}`} />
          ))}
          {days.map((dayMs) => {
            const inSpan = dayMs >= shown.fromMs && dayMs <= shown.lastMs;
            const start = dayMs === shown.fromMs;
            const end = dayMs === shown.lastMs;
            const seconds =
              historyDaily.get(localDateKey(new Date(dayMs)))?.seconds ?? 0;
            const level = quantileLevel(seconds, thresholds);
            return (
              <button
                key={dayMs}
                type="button"
                aria-label={formatAccessibleDate(new Date(dayMs))}
                aria-pressed={start || end}
                disabled={dayMs > todayMs}
                onClick={() => pickDay(dayMs)}
                onPointerEnter={() => {
                  if (pending !== null) setHover(dayMs);
                }}
                className={clsx(
                  "relative h-[34px] text-[13px] tabular-nums transition-colors disabled:text-text-faint/50",
                  inSpan && !start && !end && "bg-accent/15",
                  (start || end) && "bg-accent font-bold text-accent-fg",
                  start && !end && "rounded-l-lg",
                  end && !start && "rounded-r-lg",
                  start && end && "rounded-lg",
                  !inSpan &&
                    "rounded-lg text-text enabled:hover:bg-surface-hover",
                  dayMs === todayMs &&
                    "after:pointer-events-none after:absolute after:inset-[3px] after:rounded-[7px] after:border after:border-text/40",
                )}
              >
                {new Date(dayMs).getDate()}
                {level > 0 ? (
                  <span
                    aria-hidden="true"
                    className="absolute bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full"
                    style={{
                      background:
                        start || end
                          ? "rgb(var(--color-accent-fg))"
                          : (heatmapColor(level, thresholds.length) ??
                            undefined),
                    }}
                  />
                ) : null}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  const monthTiles = () => {
    const tiles = Array.from({ length: 12 }, (_, month) =>
      new Date(viewYear, month, 1).getTime(),
    );
    return (
      <>
        <div className="mb-2.5 flex items-center justify-between">
          <button
            type="button"
            aria-label={t("Earlier year")}
            disabled={viewYear <= new Date(firstDayMs).getFullYear()}
            onClick={() => setViewYear((year) => year - 1)}
            className="grid h-7 w-7 place-items-center rounded-lg text-text-muted transition-colors hover:bg-surface-hover hover:text-text disabled:pointer-events-none disabled:opacity-25"
          >
            <ChevronLeft size={16} />
          </button>
          <span className="text-[15px] font-bold text-text">
            {new Date(viewYear, 0, 1).toLocaleDateString(appLocale(), {
              year: "numeric",
            })}
          </span>
          <button
            type="button"
            aria-label={t("Later year")}
            disabled={viewYear >= new Date(todayMs).getFullYear()}
            onClick={() => setViewYear((year) => year + 1)}
            className="grid h-7 w-7 place-items-center rounded-lg text-text-muted transition-colors hover:bg-surface-hover hover:text-text disabled:pointer-events-none disabled:opacity-25"
          >
            <ChevronRight size={16} />
          </button>
        </div>
        <div className="grid grid-cols-4 gap-2">
          {tiles.map((monthMs) => {
            const seconds = monthTotals.get(monthKey(monthMs)) ?? 0;
            const disabled =
              monthMs > todayMs || monthEnd(monthMs) < firstDayMs;
            const inSpan =
              monthMs >= startOfMonth(shown.fromMs) &&
              monthMs <= startOfMonth(shown.lastMs);
            const edge =
              monthMs === startOfMonth(shown.fromMs) ||
              monthMs === startOfMonth(shown.lastMs);
            return (
              <button
                key={monthMs}
                type="button"
                data-month={monthKey(monthMs)}
                disabled={disabled}
                aria-pressed={inSpan}
                onClick={() => pickMonth(monthMs)}
                className={clsx(
                  "grid gap-1 rounded-[10px] border px-2.5 py-2 text-left transition-colors disabled:opacity-35",
                  edge
                    ? "border-accent bg-accent text-accent-fg"
                    : inSpan
                      ? "border-accent/40 bg-accent/15 text-text"
                      : "border-border text-text enabled:hover:border-accent/55",
                )}
              >
                <span className="text-[13px] font-bold">
                  {new Date(monthMs).toLocaleDateString(appLocale(), {
                    month: "long",
                  })}
                </span>
                <span
                  className={clsx(
                    "font-mono text-xs font-semibold",
                    edge ? "text-accent-fg/75" : "text-text-muted",
                  )}
                >
                  {disabled ? "–" : formatDuration(seconds, showDurationDays)}
                </span>
                <span
                  aria-hidden="true"
                  className={clsx(
                    "h-1 overflow-hidden rounded-full",
                    edge ? "bg-accent-fg/15" : "bg-surface-hover",
                  )}
                >
                  <span
                    className={clsx(
                      "block h-full",
                      edge ? "bg-accent-fg/60" : "bg-accent/80",
                    )}
                    style={{ width: `${(seconds / monthMax) * 100}%` }}
                  />
                </span>
              </button>
            );
          })}
        </div>
      </>
    );
  };

  const yearTiles = () => {
    const years: number[] = [];
    for (
      let year = new Date(firstDayMs).getFullYear();
      year <= new Date(todayMs).getFullYear();
      year += 1
    )
      years.push(year);
    return (
      <div className="grid grid-cols-2 gap-2.5">
        {years.map((year) => {
          const fromMs = new Date(year, 0, 1).getTime();
          const lastMs = Math.min(new Date(year, 11, 31).getTime(), todayMs);
          let seconds = 0;
          for (const [key, day] of historyDaily)
            if (key.startsWith(`${year}-`)) seconds += day.seconds;
          const picked = draft.fromMs === fromMs && draft.lastMs === lastMs;
          return (
            <button
              key={year}
              type="button"
              aria-pressed={picked}
              onClick={() => {
                setDraft({ fromMs, lastMs });
                setPending(null);
              }}
              className={clsx(
                "grid gap-1 rounded-[10px] border p-3.5 text-left transition-colors",
                picked
                  ? "border-accent bg-accent text-accent-fg"
                  : "border-border text-text hover:border-accent/55",
              )}
            >
              <span className="text-lg font-bold">
                {new Date(fromMs).toLocaleDateString(appLocale(), {
                  year: "numeric",
                })}
              </span>
              <span
                className={clsx(
                  "font-mono text-xs font-semibold",
                  picked ? "text-accent-fg/75" : "text-text-muted",
                )}
              >
                {formatDuration(seconds, showDurationDays)}
              </span>
            </button>
          );
        })}
      </div>
    );
  };

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label={t("Pick dates")}
      tabIndex={-1}
      data-tour={practice ? "demo-library-menu" : undefined}
      className="fixed z-50 w-[720px] max-w-[calc(100vw-1rem)] overflow-hidden rounded-xl border border-border bg-surface shadow-raised outline-none"
      style={position}
    >
      <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2.5">
        <div
          role="group"
          aria-label={t("Pick by")}
          className="inline-flex overflow-hidden rounded-lg border border-border"
        >
          {pickerModes().map((entry) => (
            <button
              key={entry.id}
              type="button"
              aria-pressed={mode === entry.id}
              onClick={() => {
                setMode(entry.id);
                setPending(null);
                setHover(null);
              }}
              className={clsx(
                "px-2.5 py-1 text-xs font-semibold transition-colors",
                mode === entry.id
                  ? "bg-surface-hover text-text"
                  : "text-text-muted hover:text-text",
              )}
            >
              {entry.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          aria-label={tc("Close")}
          onClick={onClose}
          className="grid h-8 w-8 place-items-center rounded-lg text-text-muted transition-colors hover:bg-surface-hover hover:text-text"
        >
          <X size={16} />
        </button>
      </div>
      <div className="grid min-h-[318px] grid-cols-[168px_minmax(0,1fr)]">
        <div className="flex flex-col gap-0.5 border-r border-border p-2">
          {quickPicks().map((entry) => {
            const range = resolveHistorySelection(entry.selection, nowMs)!;
            const matches =
              range.fromMs === draft.fromMs &&
              addDays(range.toMs, -1) === draft.lastMs;
            return (
              <button
                key={entry.label}
                type="button"
                onClick={() => onPick(entry.selection)}
                className={clsx(
                  "flex h-8 items-center justify-between gap-2 rounded-lg px-2.5 text-left text-[13px] text-text transition-colors hover:bg-surface-hover/70",
                  matches && "font-bold",
                )}
              >
                {entry.label}
                {matches ? (
                  <Check
                    aria-hidden="true"
                    size={16}
                    strokeWidth={3}
                    className="text-accent-ink"
                  />
                ) : null}
              </button>
            );
          })}
        </div>
        <div className="min-w-0 px-4 pb-3.5 pt-2.5">
          {mode === "days" ? (
            <>
              <div className="grid grid-cols-2 gap-6">
                {monthGrid(viewMonth, "left")}
                {monthGrid(addMonths(viewMonth, 1), "right")}
              </div>
              <p className="mt-2.5 flex items-center gap-1.5 text-xs text-text-faint">
                <span
                  aria-hidden="true"
                  className="h-1.5 w-1.5 rounded-full bg-accent"
                />
                {t(
                  "Days you played · click a month's name to take the whole month",
                )}
              </p>
            </>
          ) : mode === "months" ? (
            <>
              {monthTiles()}
              <p className="mt-2.5 text-xs text-text-faint">
                {t("Click a month, or two months for everything in between.")}
              </p>
            </>
          ) : (
            yearTiles()
          )}
        </div>
      </div>
      <div className="flex items-center gap-2.5 border-t border-border px-3 py-2.5">
        <span
          data-picker-summary
          className="min-w-0 flex-1 truncate text-[13px] text-text-muted"
        >
          {pending !== null && hover === null
            ? mode === "months"
              ? t("{{range}} · now pick the last month", { range: shownText })
              : t("{{range}} · now pick the last day", { range: shownText })
            : t("{{range}} · {{count}} days · {{duration}} played", {
                range: shownText,
                count: shownDays,
                duration: formatDuration(shownSeconds, showDurationDays),
              })}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="h-9 rounded-lg border border-border bg-surface px-3.5 text-[13px] font-semibold text-text transition-colors hover:bg-surface-hover"
        >
          {t("Cancel")}
        </button>
        <button
          type="button"
          onClick={apply}
          className="h-9 rounded-lg border border-accent bg-accent px-3.5 text-[13px] font-semibold text-accent-fg transition-colors hover:bg-accent-hover"
        >
          {t("Show")}
        </button>
      </div>
    </div>,
    document.body,
  );
}
