import type { GameSource, Session } from "@playcounter/shared";
import clsx from "clsx";
import { GameCover } from "../GameCover";
import {
  BarChart3,
  Gamepad2,
  ListOrdered,
  Timer,
  Trash2,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  getSessionGameKey,
  groupSessionsByDay,
  sessionMarkers,
  withLifetimeTotals,
  type HistoryFilter,
  type HistoryHighlight,
} from "../../historyStats";
import { providerFloorKey, providerFloors } from "../../library/playtimeFloor";
import { gameLifetimeTotals } from "../../milestones";
import {
  createGameIdentityResolver,
  gameMetadataKey,
  useAppStore,
} from "../../store";
import { hydrateGameMetadata, removeHistorySession } from "../../tracker";
import { TopGamesBars } from "../charts/TopGamesBars";
import { formatDuration } from "../components";
import { hasOpenContextMenu } from "../ContextMenu";
import { Button, Modal, Select } from "../primitives";
import { findTour } from "../tour/tourDefinitions";
import {
  useLibraryPractice,
  usePersonalLibraryApi,
  usePersonalLibraryState,
} from "../PersonalLibraryContext";
import { HistoryHero, type HeroArtworkGame } from "./history/HistoryHero";
import {
  getHistoryAnalytics,
  hasCachedHistoryInsights,
  HistoryInsights,
} from "./history/HistoryInsights";
import {
  HistorySessionRow,
  type HistoryRowMetadata,
} from "./history/HistorySessionRow";

type HistorySort = "newest" | "oldest" | "duration";
type HistoryTab = "sessions" | "insights" | "games";

const historySorts: Array<{ id: HistorySort; label: string }> = [
  { id: "newest", label: "Newest first" },
  { id: "oldest", label: "Oldest first" },
  { id: "duration", label: "Longest first" },
];

const TABS: Array<{ id: HistoryTab; label: string; icon: LucideIcon }> = [
  { id: "sessions", label: "Sessions", icon: ListOrdered },
  { id: "insights", label: "Insights", icon: BarChart3 },
  { id: "games", label: "Games", icon: Gamepad2 },
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
  const practice = useLibraryPractice();
  const libraryApi = usePersonalLibraryApi();
  const realQuery = useAppStore((state) => state.historyQuery);
  const setRealQuery = useAppStore((state) => state.setHistoryQuery);
  const realGameKey = useAppStore((state) => state.historyGameKey);
  const setRealGameKey = useAppStore((state) => state.setHistoryGameKey);
  const [sampleQuery, setSampleQuery] = useState("");
  const [sampleGameKey, setSampleGameKey] = useState<string | null>(null);
  const query = practice ? sampleQuery : realQuery;
  const setQuery = practice ? setSampleQuery : setRealQuery;
  const selectedGameKey = practice ? sampleGameKey : realGameKey;
  const setSelectedGameKey = practice ? setSampleGameKey : setRealGameKey;
  const sessions = usePersonalLibraryState((state) => state.recentSessions);
  const exeCache = usePersonalLibraryState((state) => state.exeCache);
  const hydratedGameMetadata = usePersonalLibraryState(
    (state) => state.gameMetadata,
  );
  const libraryImports = usePersonalLibraryState(
    (state) => state.libraryImports,
  );
  const archivedGameSeconds = usePersonalLibraryState(
    (state) => state.archivedGameSeconds,
  );
  const playtimeAdjustments = usePersonalLibraryState(
    (state) => state.playtimeAdjustments,
  );
  const showDurationDays = useAppStore(
    (state) => state.settings.showDurationDays,
  );
  const addToast = usePersonalLibraryState((state) => state.addToast);
  // The tour's chart step points at the Insights tab; open it for the tour.
  const tourWantsInsights = useAppStore((state) => {
    const active = state.activeTour;
    if (!active) return false;
    const step = findTour(active.tourId)?.steps[active.stepIndex];
    return active.tourId === "stats" && step?.id === "charts";
  });
  const [filter, setFilter] = useState<HistoryFilter>("all");
  const [sort, setSort] = useState<HistorySort>("newest");
  const [tab, setTab] = useState<HistoryTab>("sessions");
  const [detailedChart, setDetailedChart] = useState(false);
  const [visibleCount, setVisibleCount] = useState(25);
  const [pendingDeletion, setPendingDeletion] = useState<Session | null>(null);
  const timelineBodyRef = useRef<HTMLDivElement>(null);
  const nowMs = useHistoryNow();
  const [insightsReady, setInsightsReady] = useState(() =>
    hasCachedHistoryInsights(sessions, nowMs),
  );
  const deferredQuery = useDeferredValue(query);
  // Same identity rules as My Games, so launcher totals land on the same
  // game as its sessions.
  const resolveIgdbId = useMemo(
    () =>
      createGameIdentityResolver(
        hydratedGameMetadata,
        exeCache,
        libraryImports,
      ),
    [exeCache, hydratedGameMetadata, libraryImports],
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
    if (tourWantsInsights) setTab("insights");
  }, [tourWantsInsights]);

  // A game filter set from elsewhere (banner menu, game details) lands on
  // the journal, which is where it applies.
  useEffect(() => {
    if (selectedGameKey) setTab("sessions");
  }, [selectedGameKey]);

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

  const gamesByKey = useMemo(() => {
    const games = new Map<string, { name: string; coverUrl: string }>();
    for (const session of sessions) {
      const key = getSessionGameKey(session, resolveIgdbId);
      if (!games.has(key)) games.set(key, resolveGame(session));
    }
    return games;
  }, [resolveGame, resolveIgdbId, sessions]);
  const resolveGameCover = useCallback(
    (key: string | null) =>
      key ? (gamesByKey.get(key)?.coverUrl ?? null) : null,
    [gamesByKey],
  );

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

  const analytics = useMemo(
    () =>
      getHistoryAnalytics(
        gameFilteredSessions,
        filter,
        nowMs,
        resolveIgdbId,
        resolveGame,
      ),
    [filter, gameFilteredSessions, nowMs, resolveGame, resolveIgdbId],
  );
  const markers = useMemo(
    () => sessionMarkers(sessions, resolveIgdbId),
    [resolveIgdbId, sessions],
  );

  const lifetime = useMemo(
    () =>
      filter === "all"
        ? gameLifetimeTotals({
            sessions,
            archivedGameSeconds,
            playtimeAdjustments,
            providerFloors: providerFloors(libraryImports.values()),
            resolveIgdbId,
          })
        : null,
    [
      archivedGameSeconds,
      filter,
      libraryImports,
      playtimeAdjustments,
      resolveIgdbId,
      sessions,
    ],
  );
  // Name, cover and last played for games no session describes.
  const describeLifetimeGame = useMemo(() => {
    const imported = new Map<
      string,
      { name: string; coverUrl: string; lastPlayedMs: number }
    >();
    for (const entry of libraryImports.values()) {
      const key = providerFloorKey(entry);
      const current = imported.get(key);
      const playedMs = entry.providerLastPlayedAt
        ? Date.parse(entry.providerLastPlayedAt)
        : 0;
      imported.set(key, {
        name: current?.name || entry.name,
        coverUrl: current?.coverUrl || entry.coverUrl,
        lastPlayedMs: Math.max(
          current?.lastPlayedMs ?? 0,
          Number.isFinite(playedMs) ? playedMs : 0,
        ),
      });
    }
    const aliasesByKey = new Map<string, string[]>();
    for (const [alias, key] of lifetime?.canonicalByAlias ?? []) {
      aliasesByKey.set(key, [...(aliasesByKey.get(key) ?? []), alias]);
    }
    return (key: string) => {
      const aliases = [
        key.startsWith("igdb#") ? `igdb:${key.slice(5)}` : key,
        ...(aliasesByKey.get(key) ?? []),
      ];
      const metadata = aliases
        .map((alias) => gameMetadata.get(alias))
        .find(Boolean);
      const fromImport = imported.get(key);
      return {
        name: fromImport?.name || metadata?.gameName || "Unknown game",
        coverUrl: fromImport?.coverUrl || metadata?.coverUrl || "",
        lastPlayedMs: fromImport?.lastPlayedMs ?? 0,
      };
    };
  }, [gameMetadata, libraryImports, lifetime]);
  const leaderboardGames = useMemo(() => {
    if (!lifetime) return analytics.games;
    // analytics.games already honours the game and search filters; games
    // without sessions have to pass the same filters to join.
    const needle = deferredQuery.trim().toLowerCase();
    const matchedKeys = needle
      ? new Set(
          gameFilteredSessions.map((session) =>
            getSessionGameKey(session, resolveIgdbId),
          ),
        )
      : null;
    const totals = new Map(
      [...lifetime.games].filter(([key, total]) => {
        if (selectedGameKey) return key === selectedGameKey;
        if (!matchedKeys || matchedKeys.has(key)) return true;
        if (gamesByKey.has(key)) return false;
        const name = total.name || describeLifetimeGame(key).name;
        return name.toLowerCase().includes(needle);
      }),
    );
    return withLifetimeTotals(analytics.games, totals, describeLifetimeGame);
  }, [
    analytics.games,
    deferredQuery,
    describeLifetimeGame,
    gameFilteredSessions,
    gamesByKey,
    lifetime,
    resolveIgdbId,
    selectedGameKey,
  ]);
  const { selectedRange } = analytics;
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
      return (
        (right.durationSeconds ?? 0) - (left.durationSeconds ?? 0) ||
        Date.parse(right.startedAt) - Date.parse(left.startedAt)
      );
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
  const maxVisibleSeconds = useMemo(
    () =>
      Math.max(
        1,
        ...visibleSessions.map((session) => session.durationSeconds ?? 0),
      ),
    [visibleSessions],
  );
  const groups = useMemo(
    () => (sort === "duration" ? [] : groupSessionsByDay(visibleSessions)),
    [sort, visibleSessions],
  );

  // Key art for the hero: the most played game in range, when it has an IGDB
  // identity to look up. Anything else falls back to its cover.
  const artworkGame = useMemo((): HeroArtworkGame | null => {
    const mostPlayed = analytics.highlights.find(
      (highlight) => highlight.kind === "mostPlayed",
    );
    if (!mostPlayed || mostPlayed.kind !== "mostPlayed") return null;
    const session = gameFilteredSessions.find(
      (entry) => getSessionGameKey(entry, resolveIgdbId) === mostPlayed.gameKey,
    );
    if (!session) return null;
    const resolved = resolveIgdbId(
      session.gameId,
      session.source,
      session.gameName,
    );
    const igdbId =
      session.igdbId ??
      (resolved === null
        ? undefined
        : (resolved ??
          (session.source === "igdb" && session.gameId > 0
            ? session.gameId
            : undefined)));
    return {
      gameId: session.gameId,
      source: session.source,
      igdbId,
      coverUrl: mostPlayed.coverUrl,
    };
  }, [analytics.highlights, gameFilteredSessions, resolveIgdbId]);

  const clearGameFilter = useCallback(() => {
    setQuery("");
    setSelectedGameKey(null);
  }, [setQuery, setSelectedGameKey]);
  // Escape drops the game filter, unless something else owns the key: a
  // dialog, a menu or the tour card. The search field clears its own text
  // first and marks the event handled.
  const hasGameFilter = Boolean(selectedGameKey || query);
  useEffect(() => {
    if (!hasGameFilter) return;
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (hasOpenContextMenu()) return;
      const dialogOpen = [
        ...document.querySelectorAll<HTMLElement>('[role="dialog"]'),
      ].some((dialog) => dialog.getClientRects().length > 0);
      if (dialogOpen) return;
      event.preventDefault();
      clearGameFilter();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [clearGameFilter, hasGameFilter]);
  const selectGame = useCallback(
    (key: string) => {
      setSelectedGameKey(key);
      setTab("sessions");
    },
    [setSelectedGameKey],
  );
  const handleHighlight = useCallback(
    (highlight: HistoryHighlight) => {
      switch (highlight.kind) {
        case "longestSession":
          setSelectedGameKey(highlight.gameKey);
          setSort("duration");
          setTab("sessions");
          break;
        case "mostPlayed":
        case "mostSessions":
        case "comeback":
          setSelectedGameKey(highlight.gameKey);
          setSort("newest");
          setTab("sessions");
          break;
        case "bestStreak":
        case "busiestDay":
          setTab("insights");
          break;
      }
    },
    [setSelectedGameKey],
  );
  const selectedGameName = selectedGameKey
    ? (gamesByKey.get(selectedGameKey)?.name ?? query)
    : null;

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
    if (practice)
      libraryApi.setState((state) => ({
        recentSessions: state.recentSessions.filter(
          (session) => session.id !== pendingDeletion.id,
        ),
      }));
    else removeHistorySession(pendingDeletion.id);
    addToast({
      tone: "success",
      title: "Session removed",
      detail: `${pendingDeletionGame.name} was removed from history.`,
    });
    setPendingDeletion(null);
    focusTimelineSession(nextSessionId);
  }, [
    addToast,
    focusTimelineSession,
    pendingDeletion,
    pendingDeletionGame,
    practice,
    libraryApi,
  ]);

  const handleTabKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const index = TABS.findIndex((entry) => entry.id === tab);
    const step = event.key === "ArrowRight" ? 1 : -1;
    const next = TABS[(index + step + TABS.length) % TABS.length]!;
    setTab(next.id);
    document.getElementById(`history-tab-${next.id}`)?.focus();
  };
  const gamesInRange = leaderboardGames.filter((game) => game.key).length;
  const tabCounts: Record<HistoryTab, number | null> = {
    sessions: timelineSessions.length,
    insights: null,
    games: gamesInRange,
  };

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <HistoryHero
        filter={filter}
        onFilterChange={setFilter}
        rangeStats={analytics.rangeStats}
        allTimeStats={analytics.allTimeStats}
        highlights={analytics.highlights}
        firstSessionMs={analytics.firstSessionMs}
        showDurationDays={showDurationDays}
        artworkGame={artworkGame}
        resolveGameCover={resolveGameCover}
        onHighlight={handleHighlight}
      />

      <div
        data-tour="history-toolbar"
        className="-mx-1 flex min-w-0 flex-wrap items-end justify-between gap-3 border-b border-border px-1"
      >
        <div
          role="tablist"
          aria-label="History sections"
          onKeyDown={handleTabKeyDown}
          className="flex gap-1"
        >
          {TABS.map(({ id, label, icon: Icon }) => {
            const selected = tab === id;
            const count = tabCounts[id];
            return (
              <button
                key={id}
                type="button"
                role="tab"
                id={`history-tab-${id}`}
                data-tour={
                  id === "insights" ? "history-playtime-chart" : undefined
                }
                aria-selected={selected}
                aria-controls={`history-panel-${id}`}
                tabIndex={selected ? 0 : -1}
                onClick={() => setTab(id)}
                className={clsx(
                  "relative inline-flex items-center gap-2 rounded-t-lg px-4 py-2.5 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
                  selected
                    ? "text-accent-ink after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-accent"
                    : "text-text-muted hover:text-text",
                )}
              >
                <Icon size={15} />
                {label}
                {count !== null ? (
                  <span
                    className={clsx(
                      "font-mono text-[11px] tabular-nums",
                      selected ? "text-accent-ink/70" : "text-text-faint",
                    )}
                  >
                    {count.toLocaleString()}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
        {tab === "sessions" ? (
          <div className="flex flex-wrap items-center gap-2 pb-2">
            {selectedGameKey ? (
              <span className="inline-flex max-w-[280px] items-center gap-1.5 rounded-lg border border-accent/45 bg-accent/10 py-1 pl-2.5 pr-1 text-[13px] font-semibold text-text">
                <span className="truncate">{selectedGameName}</span>
                <button
                  type="button"
                  aria-label="Clear game filter"
                  onClick={clearGameFilter}
                  className="grid h-5 w-5 place-items-center rounded-md text-text-muted transition hover:bg-accent/20 hover:text-text"
                >
                  <X size={13} />
                </button>
              </span>
            ) : null}
            <label className="sr-only" htmlFor="history-sort">
              Sort sessions
            </label>
            <Select
              id="history-sort"
              value={sort}
              onChange={(event) => setSort(event.target.value as HistorySort)}
              containerClassName="shrink-0"
              className="h-9 rounded-lg !py-0 text-[13px]"
            >
              {historySorts.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
      </div>

      {tab === "sessions" ? (
        <div
          id="history-panel-sessions"
          role="tabpanel"
          aria-labelledby="history-tab-sessions"
          onMouseDownCapture={focusSessionFromTimelineClick}
        >
          <div ref={timelineBodyRef} id="session-timeline-body">
            {sessions.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-16 text-center">
                <div className="mb-4 grid h-16 w-16 place-items-center rounded-full bg-surface-hover text-text-faint">
                  <Timer size={32} />
                </div>
                <h3 className="mb-1 text-lg font-bold text-text">
                  No history yet
                </h3>
                <p className="text-sm text-text-muted">
                  Start playing a tracked game to build your journal.
                </p>
              </div>
            ) : sortedSessions.length === 0 ? (
              <div className="py-12 text-center text-sm font-medium text-text-muted">
                No sessions match your filters.
              </div>
            ) : sort === "duration" ? (
              <div className="flex flex-col gap-1.5">
                {visibleSessions.map((session) => (
                  <HistorySessionRow
                    key={session.id}
                    session={session}
                    metadata={lookupMetadata(session)}
                    marker={markers.get(session.id)}
                    maxSeconds={maxVisibleSeconds}
                    showDate
                    resolveIgdbId={resolveIgdbId}
                    selectedGameKey={selectedGameKey}
                    onFilterGame={selectGame}
                    onClearGameFilter={clearGameFilter}
                    onRequestDelete={setPendingDeletion}
                  />
                ))}
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                {groups.map((month) => (
                  <section key={month.monthKey} data-history-session-group>
                    <div className="flex items-baseline gap-3 px-1 pb-2 pt-4 text-[11px] font-bold uppercase tracking-[0.14em] text-text-faint">
                      <span>
                        {new Date(month.monthMs).toLocaleDateString([], {
                          month: "long",
                          year: "numeric",
                        })}
                      </span>
                      <span className="h-px flex-1 bg-border" />
                      <span className="font-mono text-xs font-semibold normal-case tracking-normal text-text-muted">
                        {formatSessionCount(month.sessionCount)} ·{" "}
                        {formatDuration(month.seconds, showDurationDays)}
                      </span>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      {month.days.map((day) => (
                        <DayGroup
                          key={day.dateKey}
                          dayMs={day.dayMs}
                          nowMs={nowMs}
                          seconds={day.seconds}
                          count={day.items.length}
                          showDurationDays={showDurationDays}
                        >
                          {day.items.map((session) => (
                            <HistorySessionRow
                              key={session.id}
                              session={session}
                              metadata={lookupMetadata(session)}
                              marker={markers.get(session.id)}
                              maxSeconds={maxVisibleSeconds}
                              resolveIgdbId={resolveIgdbId}
                              selectedGameKey={selectedGameKey}
                              onFilterGame={selectGame}
                              onClearGameFilter={clearGameFilter}
                              onRequestDelete={setPendingDeletion}
                            />
                          ))}
                        </DayGroup>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )}
            {visibleSessions.length < sortedSessions.length ? (
              <div className="mt-6 flex justify-center">
                <Button onClick={() => setVisibleCount((count) => count + 25)}>
                  Show 25 more
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {tab === "insights" ? (
        <div
          id="history-panel-insights"
          role="tabpanel"
          aria-labelledby="history-tab-insights"
        >
          {insightsReady ? (
            <HistoryInsights
              sessions={gameFilteredSessions}
              filter={filter}
              nowMs={nowMs}
              showDurationDays={showDurationDays}
              resolveGame={resolveGame}
              resolveIgdbId={resolveIgdbId}
              detailedChart={detailedChart}
              onDetailedChartChange={setDetailedChart}
            />
          ) : (
            <HistoryInsightsPlaceholder />
          )}
        </div>
      ) : null}

      {tab === "games" ? (
        <div
          id="history-panel-games"
          role="tabpanel"
          aria-labelledby="history-tab-games"
        >
          {gamesInRange === 0 ? (
            <div className="py-12 text-center text-sm text-text-muted">
              No games in this range.
            </div>
          ) : (
            <TopGamesBars
              games={leaderboardGames}
              showDurationDays={showDurationDays}
              nowMs={nowMs}
              onSelectGame={selectGame}
            />
          )}
        </div>
      ) : null}

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

/* One day of the journal: the date column on the left, its sessions on the
   right. The column sticks to the top while the day scrolls by. */
function DayGroup({
  dayMs,
  nowMs,
  seconds,
  count,
  showDurationDays,
  children,
}: {
  dayMs: number;
  nowMs: number;
  seconds: number;
  count: number;
  showDurationDays: boolean;
  children: React.ReactNode;
}) {
  const today = new Date(nowMs);
  today.setHours(0, 0, 0, 0);
  const daysAgo = Math.round((today.getTime() - dayMs) / 86_400_000);
  const day = new Date(dayMs);
  const weekday =
    daysAgo === 0
      ? "Today"
      : daysAgo === 1
        ? "Yesterday"
        : day.toLocaleDateString([], { weekday: "long" });
  return (
    <div className="grid gap-2 py-1.5 sm:grid-cols-[132px_minmax(0,1fr)] sm:gap-4">
      <div className="flex items-baseline gap-2 sm:sticky sm:top-4 sm:block sm:self-start sm:pl-1 sm:pt-2.5">
        <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-text-faint">
          {weekday}
        </div>
        <div
          className={clsx(
            "text-[15px] font-bold leading-tight",
            daysAgo === 0 ? "text-accent-ink" : "text-text",
          )}
        >
          {day.toLocaleDateString([], { day: "numeric", month: "short" })}
        </div>
        <div className="font-mono text-xs text-text-muted sm:mt-1">
          <span className="font-semibold text-text">
            {formatDuration(seconds, showDurationDays)}
          </span>{" "}
          · {formatSessionCount(count)}
        </div>
      </div>
      <div className="flex flex-col gap-1.5">{children}</div>
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
  const practice = useLibraryPractice();
  return (
    <Modal
      dataTour={practice ? "demo-history-delete" : undefined}
      backdropDataTour={practice ? "demo-library-modal" : undefined}
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
      <div className="h-[270px] animate-pulse rounded-lg border border-border bg-surface" />
      <div className="grid gap-6 2xl:grid-cols-[minmax(0,3fr)_minmax(360px,2fr)]">
        <div className="h-[240px] animate-pulse rounded-lg border border-border bg-surface" />
        <div className="h-[240px] animate-pulse rounded-lg border border-border bg-surface" />
      </div>
      <div className="h-[300px] animate-pulse rounded-lg border border-border bg-surface" />
    </div>
  );
}
