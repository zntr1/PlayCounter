import type { GameSource, Session } from "@playcounter/shared";
import clsx from "clsx";
import { GameCover } from "../GameCover";
import { ChevronDown, Search, Timer, Trash2, X } from "lucide-react";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  getSessionGameKey,
  historyRange,
  type HistoryFilter,
} from "../../historyStats";
import {
  createGameIdentityResolver,
  gameMetadataKey,
  useAppStore,
} from "../../store";
import { hydrateGameMetadata, removeHistorySession } from "../../tracker";
import { SectionToggle, useSectionCollapse } from "../CollapsibleSection";
import { Panel, formatDuration } from "../components";
import { Button, Input, Modal } from "../primitives";
import {
  hasCachedHistoryInsights,
  HistoryInsights,
} from "./history/HistoryInsights";
import {
  HistorySessionRow,
  type HistoryRowMetadata,
} from "./history/HistorySessionRow";

type HistorySort = "newest" | "oldest" | "duration";

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

function formatSessionCount(count: number) {
  return `${count} session${count === 1 ? "" : "s"}`;
}

function useHistoryNow() {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    let timer: number | undefined;
    const schedule = () => {
      const nextMidnight = new Date();
      nextMidnight.setHours(24, 0, 0, 100);
      timer = window.setTimeout(
        () => {
          setNowMs(Date.now());
          schedule();
        },
        Math.max(100, nextMidnight.getTime() - Date.now()),
      );
    };
    schedule();
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, []);
  return nowMs;
}

export function HistoryView() {
  const query = useAppStore((state) => state.historyQuery);
  const setQuery = useAppStore((state) => state.setHistoryQuery);
  const selectedGameKey = useAppStore((state) => state.historyGameKey);
  const setSelectedGameKey = useAppStore((state) => state.setHistoryGameKey);
  const sessions = useAppStore((state) => state.recentSessions);
  const exeCache = useAppStore((state) => state.exeCache);
  const hydratedGameMetadata = useAppStore((state) => state.gameMetadata);
  const showDurationDays = useAppStore(
    (state) => state.settings.showDurationDays,
  );
  const addToast = useAppStore((state) => state.addToast);
  const [filter, setFilter] = useState<HistoryFilter>("all");
  const [sort, setSort] = useState<HistorySort>("newest");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [visibleCount, setVisibleCount] = useState(25);
  const [pendingDeletion, setPendingDeletion] = useState<Session | null>(null);
  const timelineSection = useSectionCollapse("history.timeline");
  const viewRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLDivElement>(null);
  const timelineBodyRef = useRef<HTMLDivElement>(null);
  const nowMs = useHistoryNow();
  const [insightsReady, setInsightsReady] = useState(() =>
    hasCachedHistoryInsights(sessions, nowMs),
  );
  const deferredQuery = useDeferredValue(query);
  const resolveIgdbId = useMemo(
    () => createGameIdentityResolver(hydratedGameMetadata, exeCache),
    [exeCache, hydratedGameMetadata],
  );

  useEffect(() => {
    if (insightsReady) return;
    let timer: number | undefined;
    const frame = window.requestAnimationFrame(() => {
      timer = window.setTimeout(() => setInsightsReady(true), 0);
    });
    return () => {
      window.cancelAnimationFrame(frame);
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [insightsReady]);

  useEffect(() => {
    const scroller = viewRef.current?.parentElement;
    const toolbar = viewRef.current?.querySelector(".history-toolbar");
    if (!scroller || !toolbar) return;
    const updateElevation = () =>
      toolbar.classList.toggle(
        "history-toolbar-elevated",
        scroller.scrollTop > 8,
      );
    updateElevation();
    scroller.addEventListener("scroll", updateElevation, { passive: true });
    return () => {
      scroller.removeEventListener("scroll", updateElevation);
      toolbar.classList.remove("history-toolbar-elevated");
    };
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        searchRef.current &&
        !searchRef.current.contains(event.target as Node)
      ) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    const refs = new Map<
      string,
      { gameId: number; source?: Session["source"] }
    >();
    for (const session of sessions) {
      if (session.gameId <= 0 || session.source === "custom") continue;
      refs.set(`${session.source ?? "unknown"}:${session.gameId}`, {
        gameId: session.gameId,
        source: session.source,
      });
    }
    void hydrateGameMetadata([...refs.values()]);
  }, [sessions]);

  const gameMetadata = useMemo(() => {
    const metadata = new Map<string, HistoryRowMetadata>();
    for (const entry of exeCache.values()) {
      if (entry.state !== "matched" || !entry.gameId || !entry.gameName)
        continue;
      const key =
        entry.source === "igdb" || entry.source === "community"
          ? gameMetadataKey({ id: entry.gameId, source: entry.source })
          : `unknown:${entry.gameId}`;
      if (!metadata.has(key)) {
        metadata.set(key, {
          gameName: entry.gameName,
          coverUrl: entry.coverUrl ?? "",
          source: (entry.source as GameSource | undefined) ?? null,
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
          source: game.source,
        });
      }
    }
    return metadata;
  }, [exeCache, hydratedGameMetadata]);

  const lookupMetadata = useCallback(
    (session: Session) =>
      session.source === "igdb" || session.source === "community"
        ? gameMetadata.get(
            gameMetadataKey({ id: session.gameId, source: session.source }),
          )
        : (gameMetadata.get(`unknown:${session.gameId}`) ??
          gameMetadata.get(`igdb:${session.gameId}`) ??
          gameMetadata.get(`community:${session.gameId}`)),
    [gameMetadata],
  );

  const resolveGame = useCallback(
    (session: Session) => {
      const metadata = lookupMetadata(session);
      return {
        name:
          session.gameName ??
          metadata?.gameName ??
          fallbackGameName(session.exeName),
        coverUrl: session.coverUrl ?? metadata?.coverUrl ?? "",
      };
    },
    [lookupMetadata],
  );

  const gameOptions = useMemo(() => {
    if (!showSuggestions) return [];
    const options = new Map<
      string,
      { key: string; name: string; sessionCount: number }
    >();
    for (const session of sessions) {
      const key = getSessionGameKey(session, resolveIgdbId);
      const existing = options.get(key);
      if (existing) existing.sessionCount += 1;
      else {
        options.set(key, {
          key,
          name: resolveGame(session).name,
          sessionCount: 1,
        });
      }
    }
    return [...options.values()].sort((left, right) =>
      left.name.localeCompare(right.name),
    );
  }, [resolveGame, resolveIgdbId, sessions, showSuggestions]);

  const gameFilteredSessions = useMemo(() => {
    const needle = deferredQuery.trim().toLowerCase();
    if (!selectedGameKey && !needle) return sessions;
    return sessions.filter((session) => {
      if (selectedGameKey) {
        return getSessionGameKey(session, resolveIgdbId) === selectedGameKey;
      }
      if (!needle) return true;
      return (
        resolveGame(session).name.toLowerCase().includes(needle) ||
        session.exeName.toLowerCase().includes(needle)
      );
    });
  }, [deferredQuery, resolveGame, resolveIgdbId, selectedGameKey, sessions]);

  const selectedRange = useMemo(
    () => historyRange(filter, nowMs),
    [filter, nowMs],
  );
  const timelineSessions = useMemo(() => {
    if (!selectedRange) return gameFilteredSessions;
    return gameFilteredSessions.filter((session) => {
      const startedAt = Date.parse(session.startedAt);
      return (
        startedAt >= selectedRange.fromMs && startedAt < selectedRange.toMs
      );
    });
  }, [gameFilteredSessions, selectedRange]);
  const sortedSessions = useMemo(() => {
    if (sort === "newest") return timelineSessions;
    const result = [...timelineSessions];
    result.sort((left, right) => {
      if (sort === "oldest") {
        return Date.parse(left.startedAt) - Date.parse(right.startedAt);
      }
      if (sort === "duration") {
        return (
          (right.durationSeconds ?? 0) - (left.durationSeconds ?? 0) ||
          Date.parse(right.startedAt) - Date.parse(left.startedAt)
        );
      }
      return 0;
    });
    return result;
  }, [sort, timelineSessions]);

  useEffect(
    () => setVisibleCount(25),
    [deferredQuery, filter, selectedGameKey, sort],
  );
  const visibleSessions = useMemo(
    () => sortedSessions.slice(0, visibleCount),
    [sortedSessions, visibleCount],
  );
  const groups = useMemo(() => {
    const today = new Date(nowMs);
    today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const weekStart = new Date(today);
    weekStart.setDate(weekStart.getDate() - 6);
    const bucketFor = (startedAt: string) => {
      const value = Date.parse(startedAt);
      if (value >= today.getTime()) return "Today";
      if (value >= yesterday.getTime()) return "Yesterday";
      if (value >= weekStart.getTime()) return "Earlier this week";
      return "Earlier";
    };
    return ["Today", "Yesterday", "Earlier this week", "Earlier"]
      .map((label) => {
        const items = visibleSessions.filter(
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
  }, [nowMs, visibleSessions]);

  const suggestionNeedle = query.trim().toLowerCase();
  const suggestions = gameOptions.filter((game) =>
    game.name.toLowerCase().includes(suggestionNeedle),
  );
  const clearGameFilter = useCallback(() => {
    setQuery("");
    setSelectedGameKey(null);
    setShowSuggestions(false);
    setHighlightedIndex(-1);
  }, [setQuery, setSelectedGameKey]);
  const selectGame = useCallback(
    (key: string, name: string) => {
      setSelectedGameKey(key);
      setQuery(name);
      setShowSuggestions(false);
      setHighlightedIndex(-1);
    },
    [setQuery, setSelectedGameKey],
  );
  const pendingDeletionGame = pendingDeletion
    ? resolveGame(pendingDeletion)
    : null;
  const focusTimelineSession = useCallback((sessionId: number | null) => {
    if (sessionId === null) return;
    window.requestAnimationFrame(() => {
      const rows = timelineBodyRef.current?.querySelectorAll<HTMLElement>(
        "[data-history-session-row]",
      );
      const row = rows
        ? [...rows].find(
            (entry) => entry.dataset.historySessionId === String(sessionId),
          )
        : undefined;
      row?.focus({ preventScroll: true });
      row?.scrollIntoView({ block: "nearest" });
    });
  }, []);
  const cancelDeletion = useCallback(() => {
    const sessionId = pendingDeletion?.id ?? null;
    setPendingDeletion(null);
    focusTimelineSession(sessionId);
  }, [focusTimelineSession, pendingDeletion]);
  const focusSessionFromTimelineClick = useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (
        target.closest("button, a, input, select, textarea, [role='button']")
      ) {
        return;
      }
      const group = target.closest("[data-history-session-group]");
      const row =
        target.closest<HTMLElement>("[data-history-session-row]") ??
        group?.querySelector<HTMLElement>("[data-history-session-row]") ??
        timelineBodyRef.current?.querySelector<HTMLElement>(
          "[data-history-session-row]",
        );
      if (!row) return;
      event.preventDefault();
      row.focus({ preventScroll: true });
    },
    [],
  );
  const confirmDeletion = useCallback(() => {
    if (!pendingDeletion || !pendingDeletionGame) return;
    const rows = timelineBodyRef.current
      ? [
          ...timelineBodyRef.current.querySelectorAll<HTMLElement>(
            "[data-history-session-row]",
          ),
        ]
      : [];
    const deletedIndex = rows.findIndex(
      (row) => row.dataset.historySessionId === String(pendingDeletion.id),
    );
    const nextRow =
      deletedIndex >= 0
        ? (rows[deletedIndex + 1] ?? rows[deletedIndex - 1])
        : undefined;
    const nextSessionId = nextRow?.dataset.historySessionId
      ? Number(nextRow.dataset.historySessionId)
      : null;
    removeHistorySession(pendingDeletion.id);
    addToast({
      tone: "success",
      title: "Session removed",
      detail: `${pendingDeletionGame.name} was removed from history.`,
    });
    setPendingDeletion(null);
    focusTimelineSession(nextSessionId);
  }, [addToast, focusTimelineSession, pendingDeletion, pendingDeletionGame]);

  return (
    <div ref={viewRef} className="flex min-w-0 flex-col gap-6">
      <Panel
        dataTour="history-toolbar"
        className="history-toolbar sticky top-0 z-30 flex min-w-0 flex-wrap items-center justify-between gap-4 bg-surface p-4"
      >
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {historyFilters.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => setFilter(entry.id)}
              className={clsx(
                "rounded-full border px-4 py-1.5 text-sm font-semibold transition-all",
                filter === entry.id
                  ? "border-accent bg-accent text-accent-fg shadow-sm"
                  : "border-border bg-surface text-text-muted hover:border-text-muted/30 hover:text-text",
              )}
            >
              {entry.label}
            </button>
          ))}
        </div>
        <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-3 sm:flex-none">
          <label className="sr-only" htmlFor="history-sort">
            Sort sessions
          </label>
          <div className="relative shrink-0">
            <select
              id="history-sort"
              value={sort}
              onChange={(event) => setSort(event.target.value as HistorySort)}
              className="appearance-none rounded-full border border-border bg-surface py-2 pl-3 pr-9 text-sm text-text-muted outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/30"
            >
              {historySorts.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label}
                </option>
              ))}
            </select>
            <ChevronDown
              aria-hidden="true"
              size={14}
              className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-text-faint"
            />
          </div>
          <div
            ref={searchRef}
            className="relative min-w-0 flex-1 sm:w-72 sm:flex-none"
          >
            <Search
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-faint"
            />
            <Input
              value={query}
              role="combobox"
              aria-expanded={showSuggestions && suggestions.length > 0}
              aria-controls="history-game-suggestions"
              onChange={(event) => {
                setQuery(event.target.value);
                setSelectedGameKey(null);
                setShowSuggestions(true);
                setHighlightedIndex(-1);
              }}
              onFocus={() => setShowSuggestions(true)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  clearGameFilter();
                  return;
                }
                if (!showSuggestions || suggestions.length === 0) return;
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setHighlightedIndex((index) =>
                    Math.min(index + 1, suggestions.length - 1),
                  );
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setHighlightedIndex((index) => Math.max(index - 1, 0));
                } else if (event.key === "Enter" && highlightedIndex >= 0) {
                  event.preventDefault();
                  const match = suggestions[highlightedIndex];
                  selectGame(match.key, match.name);
                }
              }}
              placeholder="Search games or file names..."
              className="w-full rounded-full bg-surface py-2 pl-9 pr-16 text-sm"
            />
            {query || selectedGameKey ? (
              <button
                type="button"
                onClick={clearGameFilter}
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
            {showSuggestions && suggestions.length > 0 ? (
              <ul
                id="history-game-suggestions"
                className="absolute left-0 right-0 top-full z-50 mt-1 max-h-48 overflow-y-auto rounded-xl border border-border bg-surface shadow-raised"
              >
                {suggestions.map((game, index) => (
                  <li key={game.key}>
                    <button
                      type="button"
                      className={clsx(
                        "w-full px-4 py-2 text-left text-sm text-text",
                        index === highlightedIndex
                          ? "bg-accent/20 text-accent"
                          : "hover:bg-surface-hover",
                      )}
                      onMouseDown={(event) => {
                        event.preventDefault();
                        selectGame(game.key, game.name);
                      }}
                      onMouseEnter={() => setHighlightedIndex(index)}
                    >
                      {game.name}
                      <span className="ml-2 text-xs text-text-faint">
                        {formatSessionCount(game.sessionCount)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
      </Panel>

      {insightsReady ? (
        <HistoryInsights
          sessions={gameFilteredSessions}
          filter={filter}
          nowMs={nowMs}
          showDurationDays={showDurationDays}
          resolveGame={resolveGame}
          resolveIgdbId={resolveIgdbId}
          onSelectGame={selectGame}
        />
      ) : (
        <HistoryInsightsPlaceholder />
      )}

      <div onMouseDownCapture={focusSessionFromTimelineClick}>
        <Panel className="overflow-hidden">
          <div
            className={clsx(
              "flex flex-wrap items-center justify-between gap-3 px-5 py-4",
              !timelineSection.collapsed && "border-b border-border",
            )}
          >
            <div>
              <h2 className="text-xl font-bold tracking-tight text-text">
                Session timeline
              </h2>
              <p className="mt-0.5 text-sm text-text-muted">
                {sessions[0]
                  ? `Last session ${formatStartTime(sessions[0].startedAt)}`
                  : "Completed sessions will appear here."}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <div className="rounded-md border border-border bg-surface-hover px-3 py-1.5 text-sm font-medium text-text-muted">
                Showing{" "}
                <span className="font-mono text-text">
                  {timelineSessions.length}
                </span>{" "}
                of{" "}
                <span className="font-mono text-text">{sessions.length}</span>{" "}
                sessions
              </div>
              <SectionToggle
                collapsed={timelineSection.collapsed}
                onToggle={timelineSection.toggle}
                controls="session-timeline-body"
                label="Session timeline"
              />
            </div>
          </div>
          {!timelineSection.collapsed ? (
            <div
              ref={timelineBodyRef}
              id="session-timeline-body"
              className="p-4 sm:p-5"
            >
              {sessions.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-16 text-center">
                  <div className="mb-4 grid h-16 w-16 place-items-center rounded-full bg-surface-hover text-text-faint">
                    <Timer size={32} />
                  </div>
                  <h3 className="mb-1 text-lg font-bold text-text">
                    No history yet
                  </h3>
                  <p className="text-sm text-text-muted">
                    Start playing a tracked game to build your timeline.
                  </p>
                </div>
              ) : groups.length === 0 ? (
                <div className="py-12 text-center text-sm font-medium text-text-muted">
                  No sessions match your filters.
                </div>
              ) : (
                <div className="flex flex-col gap-8">
                  {groups.map((group) => (
                    <section key={group.label} data-history-session-group>
                      <div className="mb-4 flex items-baseline justify-between px-2">
                        <div className="flex items-center gap-3">
                          <h3 className="text-lg font-bold text-text">
                            {group.label}
                          </h3>
                          <span className="rounded-full bg-surface-hover px-2.5 py-0.5 text-xs font-semibold text-text-muted">
                            {formatSessionCount(group.items.length)}
                          </span>
                        </div>
                        <span className="font-mono text-sm font-bold text-text-muted">
                          {formatDuration(group.seconds, showDurationDays)}{" "}
                          shown
                        </span>
                      </div>
                      <div className="flex flex-col gap-2">
                        {group.items.map((session) => (
                          <HistorySessionRow
                            key={session.id}
                            session={session}
                            metadata={lookupMetadata(session)}
                            resolveIgdbId={resolveIgdbId}
                            selectedGameKey={selectedGameKey}
                            onFilterGame={selectGame}
                            onClearGameFilter={clearGameFilter}
                            onRequestDelete={setPendingDeletion}
                          />
                        ))}
                      </div>
                    </section>
                  ))}
                  {visibleSessions.length < sortedSessions.length ? (
                    <div className="flex justify-center">
                      <Button
                        onClick={() => setVisibleCount((count) => count + 25)}
                      >
                        Show 25 more
                      </Button>
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          ) : null}
        </Panel>
      </div>
      {pendingDeletion && pendingDeletionGame ? (
        <DeleteSessionDialog
          session={pendingDeletion}
          gameName={pendingDeletionGame.name}
          coverUrl={pendingDeletionGame.coverUrl}
          showDurationDays={showDurationDays}
          onCancel={cancelDeletion}
          onConfirm={confirmDeletion}
        />
      ) : null}
    </div>
  );
}

function DeleteSessionDialog({
  session,
  gameName,
  coverUrl,
  showDurationDays,
  onCancel,
  onConfirm,
}: {
  session: Session;
  gameName: string;
  coverUrl: string;
  showDurationDays: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal
      size="sm"
      labelId="delete-history-session-title"
      eyebrow="My History"
      title="Delete this session?"
      subtitle={gameName}
      icon={Trash2}
      onClose={onCancel}
      footer={
        <form
          className="flex justify-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            onConfirm();
          }}
        >
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" variant="danger" icon={Trash2} data-autofocus>
            Delete session
          </Button>
        </form>
      }
    >
      <p className="text-sm leading-6 text-text-muted">
        This permanently removes the session from your play history. This action
        cannot be undone.
      </p>
      <div className="mt-4 flex items-stretch gap-4 rounded-lg border border-border bg-surface-hover p-4">
        {coverUrl ? (
          <GameCover
            src={coverUrl}
            alt={`${gameName} cover`}
            className="h-[88px] w-16 shrink-0 rounded-md object-cover shadow-sm"
          />
        ) : (
          <div
            aria-hidden="true"
            className="grid h-[88px] w-16 shrink-0 place-items-center rounded-md border border-border bg-surface text-text-faint shadow-sm"
          >
            <Timer size={22} />
          </div>
        )}
        <dl className="grid min-w-0 flex-1 grid-cols-[auto_minmax(0,1fr)] content-center gap-x-4 gap-y-3 text-sm">
          <dt className="text-text-faint">Started</dt>
          <dd className="text-right font-medium text-text">
            {formatStartTime(session.startedAt)}
          </dd>
          <dt className="text-text-faint">Playtime</dt>
          <dd className="text-right font-mono font-bold text-text">
            {formatDuration(session.durationSeconds ?? 0, showDurationDays)}
          </dd>
        </dl>
      </div>
    </Modal>
  );
}

function HistoryInsightsPlaceholder() {
  return (
    <div
      className="grid min-w-0 gap-6"
      aria-label="Loading history insights"
      aria-busy="true"
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
        {Array.from({ length: 6 }, (_, index) => (
          <div
            key={index}
            className="h-[70px] animate-pulse rounded-lg border border-border bg-surface"
          />
        ))}
      </div>
      <Panel className="h-[270px] animate-pulse bg-surface" />
      <Panel className="h-[240px] animate-pulse bg-surface" />
      <div className="grid gap-6 2xl:grid-cols-[minmax(0,2fr)_minmax(520px,3fr)]">
        <Panel className="h-[300px] animate-pulse bg-surface" />
        <Panel className="h-[300px] animate-pulse bg-surface" />
      </div>
    </div>
  );
}
