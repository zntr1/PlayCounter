import clsx from "clsx";
import {
  CalendarDays,
  Clock3,
  Maximize2,
  Search,
  Timer,
  Trash2,
  ChevronDown,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { hydrateGameMetadata, removeHistorySession } from "../../tracker";
import { gameMetadataKey, useAppStore } from "../../store";
import {
  CommunityApprovalBadge,
  Panel,
  SourceBadge,
  Stat,
  formatDuration,
} from "../components";
import {
  IconButton,
  Input,
  useContextMenu,
  useEscapeKey,
  ContextMenu,
  ContextMenuItem,
} from "../primitives";
import type { GameSource } from "@playcounter/shared";

type HistoryFilter = "all" | "today" | "week" | "month";
type HistorySort = "newest" | "oldest" | "duration";
type ChartBucket = { label: string; tooltip: string; seconds: number };

const historyFilters: Array<{ id: HistoryFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "today", label: "Today" },
  { id: "week", label: "7 days" },
  { id: "month", label: "30 days" },
];

const historySorts: Array<{ id: HistorySort; label: string }> = [
  { id: "newest", label: "Newest first" },
  { id: "oldest", label: "Oldest first" },
  { id: "duration", label: "Longest first" },
];

function fallbackGameName(exeName: string) {
  return exeName.replace(/\.exe$/i, "");
}

function formatStartTime(startedAt: string) {
  const date = new Date(startedAt);
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

function formatTimeRange(startedAt: string, endedAt: string | null) {
  const start = new Date(startedAt);
  const startTime = start.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  if (!endedAt) return startTime;

  const end = new Date(endedAt);
  const sameDay = start.toDateString() === end.toDateString();
  const endTime = end.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  return sameDay ? `${startTime} - ${endTime}` : `${startTime} - next day`;
}

function formatSessionDate(startedAt: string) {
  return new Date(startedAt).toLocaleDateString();
}

function formatSessionCount(count: number) {
  return `${count} session${count === 1 ? "" : "s"}`;
}

export function HistoryView() {
  const query = useAppStore((state) => state.historyQuery);
  const setQuery = useAppStore((state) => state.setHistoryQuery);
  const selectedGameKey = useAppStore((state) => state.historyGameKey);
  const setSelectedGameKey = useAppStore(
    (state) => state.setHistoryGameKey,
  );
  const [filter, setFilter] = useState<HistoryFilter>("all");
  const [sort, setSort] = useState<HistorySort>("newest");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [chartExpanded, setChartExpanded] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const searchRef = useRef<HTMLDivElement>(null);
  const sessions = useAppStore((state) => state.recentSessions);
  const exeCache = useAppStore((state) => state.exeCache);
  const hydratedGameMetadata = useAppStore((state) => state.gameMetadata);
  const showDurationDays = useAppStore(
    (state) => state.settings.showDurationDays,
  );
  const addToast = useAppStore((state) => state.addToast);

  useEffect(() => {
    setQuery("");
    setSelectedGameKey(null);
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    void hydrateGameMetadata(
      sessions.map((session) => ({
        gameId: session.gameId,
        source: session.source,
      })),
    );
  }, [sessions]);

  const gameMetadata = useMemo(() => {
    const metadata = new Map<
      string,
      {
        gameName: string;
        coverUrl: string;
        source: GameSource | null;
        communitySuggestionId?: number;
        communitySuggestionVerified?: boolean;
      }
    >();

    for (const entry of exeCache.values()) {
      if (entry.state !== "matched" || !entry.gameId || !entry.gameName) {
        continue;
      }

      const key =
        entry.source === "igdb" || entry.source === "community"
          ? gameMetadataKey({ id: entry.gameId, source: entry.source })
          : `unknown:${entry.gameId}`;
      if (!metadata.has(key)) {
        metadata.set(key, {
          gameName: entry.gameName,
          coverUrl: entry.coverUrl ?? "",
          source: entry.source ?? null,
          communitySuggestionId: entry.communitySuggestionId,
          communitySuggestionVerified: entry.communitySuggestionVerified,
        });
      }
    }

    for (const game of hydratedGameMetadata.values()) {
      const key = gameMetadataKey(game);
      if (!metadata.has(key)) {
        metadata.set(key, {
          gameName: game.name,
          coverUrl: game.coverUrl,
          source: game.source ?? null,
        });
      }
    }

    return metadata;
  }, [exeCache, hydratedGameMetadata]);

  const lastSession = sessions[0];

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const todayMs = startOfToday.getTime();
  const dayMs = 86_400_000;

  const bucketOrder = ["Today", "Yesterday", "Earlier this week", "Earlier"];
  function bucketFor(startedAt: string) {
    const t = Date.parse(startedAt);
    if (t >= todayMs) return "Today";
    if (t >= todayMs - dayMs) return "Yesterday";
    if (t >= todayMs - 6 * dayMs) return "Earlier this week";
    return "Earlier";
  }

  function lookupMetadata(session: (typeof sessions)[number]) {
    return session.source === "igdb" || session.source === "community"
      ? gameMetadata.get(
          gameMetadataKey({ id: session.gameId, source: session.source }),
        )
      : (gameMetadata.get(`igdb:${session.gameId}`) ??
          gameMetadata.get(`community:${session.gameId}`));
  }

  function getSessionGameName(session: (typeof sessions)[number]) {
    const metadata = lookupMetadata(session);
    return (
      session.gameName ??
      metadata?.gameName ??
      fallbackGameName(session.exeName)
    );
  }

  function getSessionGameKey(session: (typeof sessions)[number]) {
    return `${session.source ?? "unknown"}:${session.gameId}`;
  }

  const gameOptions = useMemo(() => {
    const options = new Map<
      string,
      { key: string; name: string; sessionCount: number }
    >();

    for (const session of sessions) {
      const key = getSessionGameKey(session);
      const existing = options.get(key);
      if (existing) {
        existing.sessionCount += 1;
        continue;
      }
      options.set(key, {
        key,
        name: getSessionGameName(session),
        sessionCount: 1,
      });
    }

    return [...options.values()].sort((left, right) =>
      left.name.localeCompare(right.name),
    );
  }, [gameMetadata, sessions]);

  const filteredSessions = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const minStartedAt =
      filter === "today"
        ? todayMs
        : filter === "week"
          ? todayMs - 6 * dayMs
          : filter === "month"
            ? todayMs - 29 * dayMs
            : null;

    return sessions.filter((session) => {
      const startedAt = Date.parse(session.startedAt);
      if (minStartedAt !== null && startedAt < minStartedAt) return false;

      if (selectedGameKey) {
        return getSessionGameKey(session) === selectedGameKey;
      }

      if (!needle) return true;

      const gameName = getSessionGameName(session);

      return (
        gameName.toLowerCase().includes(needle) ||
        session.exeName.toLowerCase().includes(needle)
      );
    });
  }, [dayMs, filter, query, selectedGameKey, sessions, todayMs]);

  const chartData = useMemo(() => {
    type Bucket = { label: string; tooltip: string; seconds: number };
    type Chart = { title: string; compact: Bucket[]; full: Bucket[] };

    const formatHour = (hour: number) =>
      new Date(todayMs + hour * 3_600_000).toLocaleTimeString([], {
        hour: "numeric",
      });
    const formatDate = (ms: number) =>
      new Date(ms).toLocaleDateString([], { month: "short", day: "numeric" });
    const distribute = (buckets: Bucket[], spanMs: number, startMs: number) => {
      for (const session of filteredSessions) {
        const index = Math.floor(
          (Date.parse(session.startedAt) - startMs) / spanMs,
        );
        if (index >= 0 && index < buckets.length) {
          buckets[index].seconds += session.durationSeconds ?? 0;
        }
      }
      return buckets;
    };

    if (filter === "today") {
      const compact = Array.from({ length: 4 }, (_, index) => {
        const startHour = index * 6;
        return {
          label: formatHour(startHour),
          tooltip: `${formatHour(startHour)} - ${formatHour(startHour + 6)}`,
          seconds: 0,
        };
      });
      const full = Array.from({ length: 24 }, (_, hour) => ({
        label: formatHour(hour),
        tooltip: formatHour(hour),
        seconds: 0,
      }));
      return {
        title: "Today",
        compact: distribute(compact, 6 * 3_600_000, todayMs),
        full: distribute(full, 3_600_000, todayMs),
      };
    }

    if (filter === "month") {
      const startMs = todayMs - 29 * dayMs;
      const compact = Array.from({ length: 5 }, (_, index) => {
        const weekStart = startMs + index * 7 * dayMs;
        return {
          label: formatDate(weekStart),
          tooltip: `${formatDate(weekStart)} - ${formatDate(weekStart + 6 * dayMs)}`,
          seconds: 0,
        };
      });
      const full = Array.from({ length: 30 }, (_, index) => {
        const dayStart = startMs + index * dayMs;
        return {
          label: new Date(dayStart).toLocaleDateString([], {
            weekday: "narrow",
          }),
          tooltip: formatDate(dayStart),
          seconds: 0,
        };
      });
      return {
        title: "Last 30 Days",
        compact: distribute(compact, 7 * dayMs, startMs),
        full: distribute(full, dayMs, startMs),
      };
    }

    if (filter === "all") {
      const timestamps = filteredSessions.map((session) =>
        Date.parse(session.startedAt),
      );
      const empty: Chart = { title: "All Time", compact: [], full: [] };
      if (timestamps.length === 0) return empty;

      const first = new Date(Math.min(...timestamps));
      first.setDate(1);
      first.setHours(0, 0, 0, 0);
      const now = new Date();
      const monthCount =
        (now.getFullYear() - first.getFullYear()) * 12 +
        (now.getMonth() - first.getMonth()) +
        1;

      const buckets: Bucket[] = [];
      const cursor = new Date(first);
      for (let i = 0; i < monthCount; i++) {
        buckets.push({
          label: cursor.toLocaleDateString([], { month: "narrow" }),
          tooltip: cursor.toLocaleDateString([], {
            month: "short",
            year: "numeric",
          }),
          seconds: 0,
        });
        cursor.setMonth(cursor.getMonth() + 1);
      }
      for (const session of filteredSessions) {
        const d = new Date(session.startedAt);
        const index =
          (d.getFullYear() - first.getFullYear()) * 12 +
          (d.getMonth() - first.getMonth());
        if (index >= 0 && index < buckets.length) {
          buckets[index].seconds += session.durationSeconds ?? 0;
        }
      }

      const full = buckets;
      const compact =
        buckets.length <= 6
          ? buckets
          : Array.from({ length: 6 }, (_, index) => {
              const from = Math.floor((index * buckets.length) / 6);
              const to = Math.floor(((index + 1) * buckets.length) / 6);
              return {
                label: buckets[from].label,
                tooltip:
                  to - from === 1
                    ? buckets[from].tooltip
                    : `${buckets[from].tooltip} - ${buckets[to - 1].tooltip}`,
                seconds: buckets
                  .slice(from, to)
                  .reduce((sum, b) => sum + b.seconds, 0),
              };
            });
      return { title: "All Time", compact, full };
    }

    const startMs = todayMs - 6 * dayMs;
    const buckets = Array.from({ length: 7 }, (_, index) => {
      const dayStart = startMs + index * dayMs;
      return {
        label:
          index === 6
            ? "Today"
            : new Date(dayStart).toLocaleDateString([], { weekday: "short" }),
        tooltip: index === 6 ? "Today" : formatDate(dayStart),
        seconds: 0,
      };
    });
    return {
      title: "Last 7 Days",
      compact: distribute(buckets, dayMs, startMs),
      full: distribute([...buckets.map((b) => ({ ...b }))], dayMs, startMs),
    };
  }, [filteredSessions, filter, todayMs, dayMs]);
  const chartTotal = chartData.compact.reduce(
    (sum, bucket) => sum + bucket.seconds,
    0,
  );

  const total = filteredSessions.reduce(
    (sum, session) => sum + (session.durationSeconds ?? 0),
    0,
  );
  const average = Math.round(total / Math.max(1, filteredSessions.length));

  const sortedSessions = useMemo(() => {
    const items = [...filteredSessions];
    items.sort((left, right) => {
      switch (sort) {
        case "oldest":
          return Date.parse(left.startedAt) - Date.parse(right.startedAt);
        case "duration":
          return (
            (right.durationSeconds ?? 0) - (left.durationSeconds ?? 0) ||
            Date.parse(right.startedAt) - Date.parse(left.startedAt)
          );
        case "newest":
        default:
          return Date.parse(right.startedAt) - Date.parse(left.startedAt);
      }
    });
    return items;
  }, [filteredSessions, gameMetadata, sort]);

  const groups = bucketOrder
    .map((label) => {
      const items = sortedSessions.filter(
        (session) => bucketFor(session.startedAt) === label,
      );
      return {
        label,
        items,
        seconds: items.reduce(
          (sum, session) => sum + (session.durationSeconds ?? 0),
          0,
        ),
      };
    })
    .filter((group) => group.items.length > 0);

  function HistorySessionRow({
    session,
    metadata,
    addToast,
  }: {
    session: any; // We can infer or use any if needed, but let's use the explicit type later, or pass properties
    metadata: any;
    addToast: any;
  }) {
    const contextMenu = useContextMenu();
    const source = session.source ?? metadata?.source;
    const gameName =
      session.gameName ||
      metadata?.gameName ||
      session.exeName.replace(/\.exe$/i, "");
    const coverUrl = session.coverUrl ?? metadata?.coverUrl;

    const handleRemove = () => {
      removeHistorySession(session.id);
      addToast({
        tone: "success",
        title: "Session removed",
        detail: `${gameName} was removed from history.`,
      });
      contextMenu.close();
    };

    return (
      <article
        {...contextMenu.props}
        className="group grid animate-fade-in grid-cols-[auto_minmax(0,1fr)_auto] gap-4 rounded-xl border border-border bg-surface px-4 py-3 transition hover:border-accent/40 hover:shadow-raised"
      >
        {coverUrl ? (
          <img
            src={coverUrl}
            alt=""
            loading="lazy"
            className="h-[52px] w-10 shrink-0 rounded object-cover shadow-sm"
          />
        ) : (
          <div className="grid h-[52px] w-10 shrink-0 place-items-center rounded bg-surface-hover text-text-faint shadow-sm">
            <Timer size={16} />
          </div>
        )}
        <div className="flex min-w-0 flex-col justify-center">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="truncate text-base font-bold text-text">
              {gameName}
            </h3>
            <div className="hidden shrink-0 items-center gap-2 sm:flex">
              <SourceBadge source={source} />
              {source === "custom" ? (
                <CommunityApprovalBadge
                  suggestionId={
                    session.communitySuggestionId ??
                    metadata?.communitySuggestionId
                  }
                  verified={
                    session.communitySuggestionVerified ??
                    metadata?.communitySuggestionVerified
                  }
                />
              ) : null}
            </div>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-text-muted">
            <span className="truncate">{session.exeName}</span>
            <span className="h-1 w-1 shrink-0 rounded-full bg-border" />
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
              <CalendarDays size={13} className="text-text-faint" />
              {formatSessionDate(session.startedAt)}
            </span>
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
              <Clock3 size={13} className="text-text-faint" />
              {formatTimeRange(session.startedAt, session.endedAt)}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-4">
          <div className="text-right">
            <div className="text-[11px] font-medium uppercase tracking-wider text-text-faint">
              Playtime
            </div>
            <div className="font-mono text-[15px] font-bold text-accent">
              {formatDuration(session.durationSeconds ?? 0, showDurationDays)}
            </div>
          </div>
          <IconButton
            icon={Trash2}
            intent="danger"
            aria-label={`Remove history entry for ${gameName}`}
            onClick={handleRemove}
            className="hidden opacity-0 transition-opacity group-hover:grid group-hover:opacity-100"
          />
        </div>

        <ContextMenu
          open={contextMenu.open}
          position={contextMenu.position}
          onClose={contextMenu.close}
        >
          <ContextMenuItem icon={Trash2} danger onClick={handleRemove}>
            Delete Session
          </ContextMenuItem>
        </ContextMenu>
      </article>
    );
  }

  return (
    <div className="grid h-full items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex min-w-0 flex-col gap-6">
        <Panel className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
            <div>
              <h2 className="text-xl font-bold tracking-tight text-text">
                Session Timeline
              </h2>
              <p className="mt-0.5 text-sm text-text-muted">
                {lastSession
                  ? `Last session ${formatStartTime(lastSession.startedAt)}`
                  : "Completed sessions will appear here."}
              </p>
            </div>
            <div className="rounded-md border border-border bg-surface-hover px-3 py-1.5 text-sm font-medium text-text-muted">
              Showing{" "}
              <span className="font-mono text-text">
                {filteredSessions.length}
              </span>{" "}
              of {formatSessionCount(sessions.length)}
            </div>
          </div>

          <div className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-4 border-b border-border bg-bg/90 p-4 backdrop-blur-md">
            <div className="flex flex-wrap items-center gap-2">
              {historyFilters.map((entry) => {
                const active = filter === entry.id;
                return (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => setFilter(entry.id)}
                    className={clsx(
                      "rounded-full border px-4 py-1.5 text-sm font-semibold transition-all",
                      active
                        ? "border-accent bg-accent text-accent-fg shadow-sm"
                        : "border-border bg-surface text-text-muted hover:border-text-muted/30 hover:text-text",
                    )}
                  >
                    {entry.label}
                  </button>
                );
              })}
            </div>
            <div className="flex min-w-[240px] flex-1 items-center lg:ml-auto lg:max-w-xs">
              <div ref={searchRef} className="relative flex-1">
                <Search
                  size={16}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-faint"
                />
                <Input
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setSelectedGameKey(null);
                    setShowSuggestions(true);
                    setHighlightedIndex(-1);
                  }}
                  onFocus={() => setShowSuggestions(true)}
                  onKeyDown={(event) => {
                    if (!showSuggestions) return;
                    const needle = query.trim().toLowerCase();
                    const matches = gameOptions.filter((g) =>
                      g.name.toLowerCase().includes(needle),
                    );
                    if (matches.length === 0) return;
                    if (event.key === "ArrowDown") {
                      event.preventDefault();
                      setHighlightedIndex((i) =>
                        Math.min(i + 1, matches.length - 1),
                      );
                    } else if (event.key === "ArrowUp") {
                      event.preventDefault();
                      setHighlightedIndex((i) => Math.max(i - 1, 0));
                    } else if (event.key === "Enter" && highlightedIndex >= 0) {
                      event.preventDefault();
                      const match = matches[highlightedIndex];
                      setSelectedGameKey(match.key);
                      setQuery(match.name);
                      setShowSuggestions(false);
                      setHighlightedIndex(-1);
                    } else if (event.key === "Escape") {
                      setQuery("");
                      setSelectedGameKey(null);
                      setShowSuggestions(false);
                      setHighlightedIndex(-1);
                    }
                  }}
                  placeholder="Search games or executables..."
                  className="w-full rounded-full bg-surface py-2 pl-9 pr-16 text-sm"
                />
                {query ? (
                  <button
                    type="button"
                    onClick={() => {
                      setQuery("");
                      setSelectedGameKey(null);
                      setShowSuggestions(false);
                      setHighlightedIndex(-1);
                    }}
                    className="absolute right-8 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-text-faint transition-colors hover:bg-surface-hover hover:text-text"
                    aria-label="Clear search"
                  >
                    <X size={14} />
                  </button>
                ) : null}
                <ChevronDown
                  size={14}
                  className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-text-faint"
                />
                {showSuggestions &&
                  (() => {
                    const needle = query.trim().toLowerCase();
                    const matches = gameOptions.filter((g) =>
                      g.name.toLowerCase().includes(needle),
                    );
                    if (matches.length === 0) return null;
                    return (
                      <ul className="absolute left-0 right-0 top-full z-50 mt-1 max-h-48 overflow-y-auto rounded-xl border border-border bg-surface shadow-raised">
                        {matches.map((game, index) => (
                          <li key={game.key}>
                            <button
                              type="button"
                              className={clsx(
                                "w-full px-4 py-2 text-left text-sm text-text",
                                index === highlightedIndex
                                  ? "bg-accent/20 text-accent"
                                  : "hover:bg-surface-hover",
                              )}
                              onMouseDown={(e) => {
                                e.preventDefault();
                                setSelectedGameKey(game.key);
                                setQuery(game.name);
                                setShowSuggestions(false);
                                setHighlightedIndex(-1);
                              }}
                              onMouseEnter={() => setHighlightedIndex(index)}
                            >
                              {game.name}
                              <span
                                className={clsx(
                                  "ml-2 text-xs",
                                  index === highlightedIndex
                                    ? "text-accent/60"
                                    : "text-text-faint",
                                )}
                              >
                                {game.sessionCount} session
                                {game.sessionCount !== 1 ? "s" : ""}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    );
                  })()}
              </div>
            </div>
          </div>

          <div className="p-4 sm:p-5">
            {sessions.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-16 text-center">
                <div className="mb-4 grid h-16 w-16 place-items-center rounded-full bg-surface-hover text-text-faint">
                  <Timer size={32} />
                </div>
                <h3 className="mb-1 text-lg font-bold text-text">
                  No History Yet
                </h3>
                <p className="text-sm text-text-muted">
                  Start playing a tracked game to build your timeline.
                </p>
              </div>
            ) : groups.length === 0 ? (
              <div className="py-12 text-center text-sm font-medium text-text-muted">
                No sessions match your search filters.
              </div>
            ) : (
              <div className="flex flex-col gap-8">
                {groups.map((group) => (
                  <section key={group.label} className="relative">
                    <div className="mb-4 flex items-baseline justify-between px-2">
                      <div className="flex items-center gap-3">
                        <h3 className="text-lg font-bold text-text">
                          {group.label}
                        </h3>
                        <span className="rounded-full bg-surface-hover px-2.5 py-0.5 text-xs font-semibold text-text-muted">
                          {group.items.length} session
                          {group.items.length !== 1 ? "s" : ""}
                        </span>
                      </div>
                      <span className="font-mono text-sm font-bold text-text-muted">
                        {formatDuration(group.seconds, showDurationDays)} total
                      </span>
                    </div>
                    <div className="flex flex-col gap-2">
                      {group.items.map((session) => (
                        <HistorySessionRow
                          key={session.id}
                          session={session}
                          metadata={lookupMetadata(session)}
                          addToast={addToast}
                        />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </div>
        </Panel>
      </div>

      <aside className="sticky top-0 flex flex-col gap-6">
        <Panel className="p-6">
          <h3 className="mb-4 text-sm font-bold uppercase tracking-wider text-text-faint">
            Global Analytics
          </h3>
          <div className="flex flex-col gap-5">
            <div>
              <div className="text-[13px] font-medium text-text-muted">
                Total Time Logged
              </div>
              <div className="mt-1 font-mono text-3xl font-black text-text">
                {formatDuration(total, showDurationDays)}
              </div>
            </div>
            <div className="h-px w-full bg-border" />
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-[13px] font-medium text-text-muted">
                  Sessions
                </div>
                <div className="mt-1 font-mono text-xl font-bold text-text">
                  {filteredSessions.length}
                </div>
              </div>
              <div>
                <div className="text-[13px] font-medium text-text-muted">
                  Average Length
                </div>
                <div className="mt-1 font-mono text-xl font-bold text-text">
                  {formatDuration(average, showDurationDays)}
                </div>
              </div>
            </div>
          </div>
        </Panel>

        <Panel className="p-6">
          <div className="mb-6 flex items-end justify-between">
            <div>
              <h3 className="text-sm font-bold uppercase tracking-wider text-text-faint">
                {chartData.title}
              </h3>
              <div className="mt-1 text-sm font-medium text-text">
                <span className="font-mono font-bold text-accent">
                  {formatDuration(chartTotal, showDurationDays)}
                </span>{" "}
                logged
              </div>
            </div>
            <IconButton
              icon={Maximize2}
              aria-label="Expand chart"
              onClick={() => setChartExpanded(true)}
            />
          </div>

          {chartData.compact.length === 0 ? (
            <div className="py-8 text-center text-sm font-medium text-text-muted">
              No sessions in this range.
            </div>
          ) : (
            <BarChart buckets={chartData.compact} />
          )}
        </Panel>
      </aside>

      {chartExpanded ? (
        <ChartModal
          title={chartData.title}
          total={chartTotal}
          buckets={chartData.full}
          onClose={() => setChartExpanded(false)}
        />
      ) : null}
    </div>
  );
}

function BarChart({
  buckets,
  className = "h-32",
}: {
  buckets: ChartBucket[];
  className?: string;
}) {
  const showDurationDays = useAppStore(
    (state) => state.settings.showDurationDays,
  );
  const maxSeconds = Math.max(1, ...buckets.map((bucket) => bucket.seconds));
  return (
    <div className={clsx("flex items-end justify-between gap-1.5", className)}>
      {buckets.map((bucket, index) => {
        const heightPct = Math.max(
          4,
          bucket.seconds > 0 ? Math.round((bucket.seconds / maxSeconds) * 100) : 0,
        );
        return (
          <div
            key={index}
            className="group relative flex h-full min-w-0 flex-1 flex-col items-center justify-end"
          >
            <div
              className={clsx(
                "w-full max-w-[28px] rounded-t-sm transition-all duration-500",
                bucket.seconds > 0
                  ? "bg-accent/80 group-hover:bg-accent"
                  : "bg-surface-hover",
              )}
              style={{ height: `${heightPct}%` }}
            />

            {/* Tooltip on hover */}
            <div className="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 scale-95 rounded bg-surface px-2 py-1 text-xs font-bold text-text opacity-0 shadow-raised transition-all group-hover:scale-100 group-hover:opacity-100 whitespace-nowrap z-10">
              {bucket.tooltip ? `${bucket.tooltip} · ` : ""}
              {formatDuration(bucket.seconds, showDurationDays)}
            </div>

            <div className="mt-3 w-full truncate text-center text-[9px] font-bold uppercase tracking-normal text-text-faint">
              {bucket.label}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ChartModal({
  title,
  total,
  buckets,
  onClose,
}: {
  title: string;
  total: number;
  buckets: ChartBucket[];
  onClose: () => void;
}) {
  useEscapeKey(onClose);
  const showDurationDays = useAppStore(
    (state) => state.settings.showDurationDays,
  );
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 px-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="flex h-[80vh] w-[90vw] max-w-6xl flex-col rounded-lg border border-border bg-surface p-6 shadow-raised">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-bold uppercase tracking-wider text-text-faint">
              {title}
            </h2>
            <div className="mt-1 text-sm font-medium text-text">
              <span className="font-mono font-bold text-accent">
                {formatDuration(total, showDurationDays)}
              </span>{" "}
              logged
            </div>
          </div>
          <IconButton icon={X} aria-label="Close chart" onClick={onClose} />
        </div>
        {buckets.length === 0 ? (
          <div className="grid flex-1 place-items-center text-sm font-medium text-text-muted">
            No sessions in this range.
          </div>
        ) : (
          <BarChart buckets={buckets} className="min-h-0 flex-1" />
        )}
      </div>
    </div>
  );
}
