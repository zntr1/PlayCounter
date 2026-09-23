import type { GameSource } from "@playcounter/shared";
import clsx from "clsx";
import { BarChart3, Flame, Timer } from "lucide-react";
import type { ReactNode } from "react";
import { useGameDetails } from "../../../gameDetails";
import type {
  HistoryFilter,
  HistoryHighlight,
  SummaryStats,
} from "../../../historyStats";
import { customHeroArtKey, useAppStore } from "../../../store";
import { formatDuration } from "../../components";
import { heroArtwork } from "../../GameBanner";
import { GameCover } from "../../GameCover";

/* The History hero: one headline number for the selected range, the range
   chips that scope the whole page, and the highlights worth noticing. The
   most played game's key art sits behind it, the way the library hero does. */

export const historyFilters: Array<{ id: HistoryFilter; label: string }> = [
  { id: "all", label: "All time" },
  { id: "currentMonth", label: "This month" },
  { id: "month", label: "30 days" },
  { id: "week", label: "7 days" },
  { id: "today", label: "Today" },
];

export type HeroArtworkGame = {
  gameId: number;
  source?: GameSource | null;
  igdbId?: number;
  coverUrl: string;
};

function formatDay(dateKey: string, withWeekday = false) {
  return new Date(`${dateKey}T00:00:00`).toLocaleDateString([], {
    ...(withWeekday ? { weekday: "short" } : {}),
    month: "short",
    day: "numeric",
  });
}

function formatStart(startedAt: string) {
  return new Date(startedAt).toLocaleDateString([], {
    month: "short",
    day: "numeric",
  });
}

export function HistoryHero({
  filter,
  onFilterChange,
  rangeStats,
  allTimeStats,
  highlights,
  firstSessionMs,
  showDurationDays,
  artworkGame,
  resolveGameCover,
  onHighlight,
}: {
  filter: HistoryFilter;
  onFilterChange: (filter: HistoryFilter) => void;
  rangeStats: SummaryStats;
  allTimeStats: SummaryStats;
  highlights: HistoryHighlight[];
  firstSessionMs: number | null;
  showDurationDays: boolean;
  artworkGame: HeroArtworkGame | null;
  resolveGameCover: (key: string | null) => string | null;
  onHighlight: (highlight: HistoryHighlight) => void;
}) {
  const details = useGameDetails(artworkGame?.igdbId);
  const pickedArt = useAppStore((state) =>
    artworkGame
      ? state.customHeroArt[customHeroArtKey(artworkGame)]
      : undefined,
  );
  const wideArt = heroArtwork(
    pickedArt,
    details.status === "ready" ? details.details : null,
  );
  // Without wide art the portrait cover stands in, blurred into a colour
  // wash the way the library banner does it, never stretched as a photo.
  const artwork = wideArt ?? artworkGame?.coverUrl ?? null;
  const coverOnly = !wideArt && artwork !== null;
  const rangeLabel = historyFilters.find((entry) => entry.id === filter)!.label;
  const hasSessions = rangeStats.sessionCount > 0;

  return (
    <section
      aria-label="History summary"
      data-tour="history-hero"
      className="relative overflow-hidden rounded-2xl border border-border/80 bg-surface shadow-raised"
    >
      {artwork ? (
        <img
          src={artwork}
          alt=""
          aria-hidden="true"
          className={clsx(
            "history-hero-art pointer-events-none absolute inset-0 h-full w-full object-cover object-[50%_30%]",
            coverOnly && "scale-125 blur-3xl saturate-150",
          )}
        />
      ) : null}
      <div
        aria-hidden="true"
        className={clsx(
          "pointer-events-none absolute inset-0",
          artwork ? "history-hero-shade" : "history-hero-glow",
        )}
      />
      <div className="relative grid gap-6 p-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-8 lg:p-7">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-accent-ink">
            <BarChart3 aria-hidden="true" size={12} />
            {rangeLabel}
          </p>
          {hasSessions ? (
            <>
              <h1 className="mt-2 font-serif text-[34px] font-normal leading-[1.1] tracking-tight text-text drop-shadow-md [text-wrap:balance] sm:text-[42px]">
                <span className="font-mono font-bold tracking-tighter">
                  {formatDuration(rangeStats.totalSeconds, showDurationDays)}
                </span>{" "}
                played
                {filter === "today" ? (
                  " today"
                ) : (
                  <>
                    <br />
                    across {rangeStats.activeDays} day
                    {rangeStats.activeDays === 1 ? "" : "s"}
                  </>
                )}
              </h1>
              <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-text-muted">
                <Fact value={String(rangeStats.sessionCount)} unit="sessions" />
                <Fact
                  label="average"
                  value={formatDuration(
                    rangeStats.averageSeconds,
                    showDurationDays,
                  )}
                />
                <Fact
                  label="current streak"
                  value={`${allTimeStats.currentStreakDays} day${allTimeStats.currentStreakDays === 1 ? "" : "s"}`}
                />
                {firstSessionMs !== null ? (
                  <Fact
                    label="first session"
                    value={new Date(firstSessionMs).toLocaleDateString([], {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  />
                ) : null}
              </p>
            </>
          ) : (
            <>
              <h1 className="mt-2 font-serif text-[34px] font-normal leading-[1.1] tracking-tight text-text sm:text-[42px]">
                Nothing played {filter === "all" ? "yet" : "in this range"}
              </h1>
              <p className="mt-3 text-sm text-text-muted">
                {filter === "all"
                  ? "Start a tracked game and your first session lands here."
                  : "Pick a wider range to see your sessions."}
              </p>
            </>
          )}
          <div
            role="group"
            aria-label="Range"
            className="mt-5 flex flex-wrap gap-1.5"
          >
            {historyFilters.map((entry) => (
              <button
                key={entry.id}
                type="button"
                aria-pressed={filter === entry.id}
                onClick={() => onFilterChange(entry.id)}
                className={clsx(
                  "rounded-full border px-3.5 py-1.5 text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
                  filter === entry.id
                    ? "border-accent bg-accent text-accent-fg shadow-sm"
                    : "border-border bg-bg/50 text-text-muted hover:border-text-faint hover:text-text",
                )}
              >
                {entry.label}
              </button>
            ))}
          </div>
        </div>
        {highlights.length > 0 ? (
          <ul
            aria-label="Highlights"
            className="grid auto-rows-fr content-start gap-2.5 sm:grid-cols-2 xl:grid-cols-3"
          >
            {highlights.map((highlight) => (
              <li key={highlight.kind} className="min-w-0">
                <HighlightCard
                  highlight={highlight}
                  showDurationDays={showDurationDays}
                  resolveGameCover={resolveGameCover}
                  onClick={() => onHighlight(highlight)}
                />
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}

function Fact({
  label,
  value,
  unit,
}: {
  label?: string;
  value: string;
  unit?: string;
}) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      {label ? <span>{label}</span> : null}
      <span className="font-mono font-semibold text-text">{value}</span>
      {unit ? <span>{unit}</span> : null}
    </span>
  );
}

function highlightCopy(
  highlight: HistoryHighlight,
  showDurationDays: boolean,
): { label: string; value: string; detail: ReactNode; title: string } {
  switch (highlight.kind) {
    case "longestSession":
      return {
        label: "Longest session",
        value: formatDuration(highlight.seconds, showDurationDays),
        detail: (
          <>
            <Em>{highlight.name}</Em> ·{" "}
            {formatStart(highlight.session.startedAt)}
          </>
        ),
        title: "Show this session",
      };
    case "bestStreak":
      return {
        label: "Best streak",
        value: `${highlight.days} days`,
        detail: (
          <>
            {formatDay(highlight.fromKey)} – {formatDay(highlight.toKey)} ·{" "}
            <Em>{formatDuration(highlight.seconds, showDurationDays)}</Em>
          </>
        ),
        title: "Open the activity calendar",
      };
    case "mostPlayed":
      return {
        label: "Most played",
        value: formatDuration(highlight.seconds, showDurationDays),
        detail: (
          <>
            <Em>{highlight.name}</Em> · {Math.round(highlight.share * 100)} %
          </>
        ),
        title: "Show sessions of this game",
      };
    case "busiestDay":
      return {
        label: "Busiest day",
        value: formatDuration(highlight.seconds, showDurationDays),
        detail: (
          <>
            {formatDay(highlight.dateKey, true)} ·{" "}
            <Em>
              {highlight.gameCount} game{highlight.gameCount === 1 ? "" : "s"}
            </Em>
          </>
        ),
        title: "Open the activity calendar",
      };
    case "mostSessions":
      return {
        label: "On a roll",
        value: `${highlight.sessionCount} sessions`,
        detail: <Em>{highlight.name}</Em>,
        title: "Show sessions of this game",
      };
    case "comeback":
      return {
        label: "Came back after",
        value: `${highlight.gapDays} days`,
        detail: (
          <>
            <Em>{highlight.name}</Em> ·{" "}
            {formatStart(highlight.session.startedAt)}
          </>
        ),
        title: "Show sessions of this game",
      };
  }
}

function Em({ children }: { children: ReactNode }) {
  return <span className="font-semibold text-text">{children}</span>;
}

function HighlightCard({
  highlight,
  showDurationDays,
  resolveGameCover,
  onClick,
}: {
  highlight: HistoryHighlight;
  showDurationDays: boolean;
  resolveGameCover: (key: string | null) => string | null;
  onClick: () => void;
}) {
  const copy = highlightCopy(highlight, showDurationDays);
  const coverUrl =
    highlight.kind === "busiestDay"
      ? resolveGameCover(highlight.topGameKey)
      : highlight.kind === "bestStreak"
        ? null
        : highlight.coverUrl;

  return (
    <button
      type="button"
      title={copy.title}
      onClick={onClick}
      className="grid h-full w-full grid-cols-[44px_minmax(0,1fr)] items-center gap-3 rounded-xl border border-border/90 bg-bg/60 p-3 text-left backdrop-blur-sm transition hover:-translate-y-px hover:border-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
    >
      {highlight.kind === "bestStreak" ? (
        <span
          aria-hidden="true"
          className="grid aspect-[3/4] w-11 place-items-center rounded-md bg-gradient-to-br from-accent to-accent/40 text-accent-fg shadow-sm"
        >
          <Flame size={20} />
        </span>
      ) : coverUrl ? (
        <GameCover
          src={coverUrl}
          alt=""
          loading="lazy"
          draggable={false}
          className="aspect-[3/4] w-11 rounded-md object-cover shadow-sm"
        />
      ) : (
        <span
          aria-hidden="true"
          className="grid aspect-[3/4] w-11 place-items-center rounded-md bg-surface-hover text-text-faint shadow-sm"
        >
          <Timer size={16} />
        </span>
      )}
      <span className="min-w-0">
        <span className="block text-[10px] font-bold uppercase tracking-[0.14em] text-text-faint">
          {copy.label}
        </span>
        <span className="mt-0.5 block truncate font-mono text-lg font-bold leading-tight text-text">
          {copy.value}
        </span>
        <span className="mt-0.5 block truncate text-xs text-text-muted">
          {copy.detail}
        </span>
      </span>
    </button>
  );
}
