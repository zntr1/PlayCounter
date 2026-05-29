import clsx from "clsx";
import {
  Ban,
  Clipboard,
  Clock3,
  Copy,
  History,
  ImagePlus,
  LayoutGrid,
  List,
  Search,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  acceptCommunityUpgrade,
  clearCustomGameCover,
  convertLocalSuggestionToCommunity,
  dismissCommunityUpgrade,
  doNotTrackGame,
  hydrateGameMetadata,
  setCustomGameCover,
  untrackGame,
} from "../../tracker";
import {
  gameMetadataKey,
  useAppStore,
  type ActiveSession,
  type ExeCacheEntry,
} from "../../store";
import {
  CommunityApprovalBadge,
  Panel,
  SourceBadge,
  formatDuration,
} from "../components";
import {
  Button,
  ContextMenu,
  ContextMenuItem,
  ContextMenuSeparator,
  IconButton,
  Input,
  useContextMenu,
} from "../primitives";
import type { GameSource } from "@playcounter/shared";

type SortKey = "recent" | "playtime" | "name" | "sessions";
type ViewMode = "grid" | "list";

const sortOptions: Array<{ key: SortKey; label: string }> = [
  { key: "recent", label: "Last played" },
  { key: "playtime", label: "Most played" },
  { key: "name", label: "Name" },
  { key: "sessions", label: "Sessions" },
];

type GameSummary = {
  gameId: number;
  name: string;
  coverUrl: string;
  source: GameSource | null;
  communitySuggestionId?: number;
  communitySuggestionVerified?: boolean;
  communitySuggestionExeName?: string;
  communityUpgradeExeName?: string;
  communityUpgradeGameName?: string;
  totalSeconds: number;
  sessionCount: number;
  lastPlayedAt: string;
  exeNames: string[];
};

type PendingRemoval = {
  gameId: number;
  source: GameSource | null;
  name: string;
} | null;

type PendingStopTracking = {
  gameId: number;
  source: Exclude<GameSource, "custom">;
  name: string;
  exeNames: string[];
  sessionCount: number;
} | null;

function matchedEntriesByGame(entries: ExeCacheEntry[]) {
  const byGameId = new Map<string, ExeCacheEntry>();

  for (const entry of entries) {
    if (entry.state !== "matched" || !entry.gameId) continue;
    const key =
      entry.source === "igdb" || entry.source === "community"
        ? gameMetadataKey({ id: entry.gameId, source: entry.source })
        : `unknown:${entry.gameId}`;
    if (!byGameId.has(key)) byGameId.set(key, entry);
  }

  return byGameId;
}

function fallbackGameName(exeName: string) {
  return exeName.replace(/\.exe$/i, "");
}

function gameSummaryKey(gameId: number, source: GameSource | null | undefined) {
  return source === "igdb" || source === "community"
    ? gameMetadataKey({ id: gameId, source })
    : `unknown:${gameId}`;
}

function formatLastPlayed(value: string) {
  const date = new Date(value);
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

function formatGameActivity(game: GameSummary) {
  return game.sessionCount > 0
    ? `Last played ${formatLastPlayed(game.lastPlayedAt)}`
    : `Added ${formatLastPlayed(game.lastPlayedAt)}`;
}

function activeDurationSeconds(activeSession: ActiveSession) {
  return Math.max(
    0,
    Math.round(
      (Date.parse(activeSession.checkpointedAt) -
        Date.parse(activeSession.startedAt)) /
        1000,
    ),
  );
}

export function MyGamesView() {
  const [pendingRemoval, setPendingRemoval] = useState<PendingRemoval>(null);
  const [pendingStopTracking, setPendingStopTracking] =
    useState<PendingStopTracking>(null);
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("recent");
  const [view, setView] = useState<ViewMode>("grid");
  const sessions = useAppStore((state) => state.recentSessions);
  const activeSessions = useAppStore((state) => state.activeSessions);
  const exeCache = useAppStore((state) => state.exeCache);
  const hydratedGameMetadata = useAppStore((state) => state.gameMetadata);
  const userIgnoredProcesses = useAppStore(
    (state) => state.userIgnoredProcesses,
  );
  const blacklist = useAppStore((state) => state.blacklist);
  const addToast = useAppStore((state) => state.addToast);

  useEffect(() => {
    void hydrateGameMetadata(
      sessions.map((session) => ({
        gameId: session.gameId,
        source: session.source,
      })),
    );
  }, [sessions]);

  const games = useMemo(() => {
    const ignoredExeNames = new Set([...userIgnoredProcesses, ...blacklist]);
    const isIgnored = (exeName: string) =>
      ignoredExeNames.has(exeName.toLowerCase());
    const metadata = matchedEntriesByGame(
      [...exeCache.values()].filter((entry) => !isIgnored(entry.exeName)),
    );
    const summaries = new Map<string, GameSummary>();

    for (const session of sessions) {
      if (isIgnored(session.exeName)) continue;

      const hydratedMeta =
        session.source === "igdb" || session.source === "community"
          ? hydratedGameMetadata.get(
              gameMetadataKey({ id: session.gameId, source: session.source }),
            )
          : (hydratedGameMetadata.get(`igdb:${session.gameId}`) ??
            hydratedGameMetadata.get(`community:${session.gameId}`));
      const resolvedSource = session.source ?? hydratedMeta?.source ?? null;
      const summaryKey = gameSummaryKey(session.gameId, resolvedSource);
      const gameMeta = metadata.get(summaryKey);
      const existing = summaries.get(summaryKey);
      const endedOrStartedAt = session.endedAt ?? session.startedAt;

      if (existing) {
        existing.totalSeconds += session.durationSeconds ?? 0;
        existing.sessionCount += 1;
        if (Date.parse(endedOrStartedAt) > Date.parse(existing.lastPlayedAt)) {
          existing.lastPlayedAt = endedOrStartedAt;
        }
        if (!existing.exeNames.includes(session.exeName)) {
          existing.exeNames.push(session.exeName);
        }
        continue;
      }

      summaries.set(summaryKey, {
        gameId: session.gameId,
        name:
          session.gameName ??
          gameMeta?.gameName ??
          hydratedMeta?.name ??
          fallbackGameName(session.exeName),
        coverUrl:
          session.coverUrl ??
          gameMeta?.coverUrl ??
          hydratedMeta?.coverUrl ??
          "",
        source:
          session.source ?? gameMeta?.source ?? hydratedMeta?.source ?? null,
        communitySuggestionId: gameMeta?.communitySuggestionId,
        communitySuggestionVerified: gameMeta?.communitySuggestionVerified,
        communitySuggestionExeName:
          gameMeta?.communitySuggestionId &&
          gameMeta.communitySuggestionVerified
            ? session.exeName
            : undefined,
        communityUpgradeExeName: gameMeta?.communityUpgradeGame
          ? session.exeName
          : undefined,
        communityUpgradeGameName: gameMeta?.communityUpgradeGame?.name,
        totalSeconds: session.durationSeconds ?? 0,
        sessionCount: 1,
        lastPlayedAt: endedOrStartedAt,
        exeNames: [session.exeName],
      });
    }

    for (const activeSession of activeSessions) {
      if (isIgnored(activeSession.exeName)) continue;

      const activeSeconds = activeDurationSeconds(activeSession);
      const hydratedMeta =
        activeSession.source === "igdb" || activeSession.source === "community"
          ? hydratedGameMetadata.get(
              gameMetadataKey({
                id: activeSession.gameId,
                source: activeSession.source,
              }),
            )
          : (hydratedGameMetadata.get(`igdb:${activeSession.gameId}`) ??
            hydratedGameMetadata.get(`community:${activeSession.gameId}`));
      const resolvedSource =
        activeSession.source ?? hydratedMeta?.source ?? null;
      const summaryKey = gameSummaryKey(activeSession.gameId, resolvedSource);
      const existing = summaries.get(summaryKey);

      if (existing) {
        existing.totalSeconds += activeSeconds;
        existing.lastPlayedAt = activeSession.checkpointedAt;
        existing.communitySuggestionId ??= activeSession.communitySuggestionId;
        existing.communitySuggestionVerified ??=
          activeSession.communitySuggestionVerified;
        if (!existing.exeNames.includes(activeSession.exeName)) {
          existing.exeNames.push(activeSession.exeName);
        }
      } else {
        summaries.set(summaryKey, {
          gameId: activeSession.gameId,
          name: activeSession.gameName || hydratedMeta?.name || "",
          coverUrl: activeSession.coverUrl || hydratedMeta?.coverUrl || "",
          source: resolvedSource,
          communitySuggestionId: activeSession.communitySuggestionId,
          communitySuggestionVerified:
            activeSession.communitySuggestionVerified,
          totalSeconds: activeSeconds,
          sessionCount: 0,
          lastPlayedAt: activeSession.checkpointedAt,
          exeNames: [activeSession.exeName],
        });
      }
    }

    for (const gameMeta of metadata.values()) {
      const summaryKey =
        gameMeta.source === "igdb" || gameMeta.source === "community"
          ? gameMetadataKey({ id: gameMeta.gameId!, source: gameMeta.source })
          : `unknown:${gameMeta.gameId}`;

      if (summaries.has(summaryKey)) continue;

      summaries.set(summaryKey, {
        gameId: gameMeta.gameId!,
        name: gameMeta.gameName ?? fallbackGameName(gameMeta.exeName),
        coverUrl: gameMeta.coverUrl ?? "",
        source: gameMeta.source ?? null,
        communitySuggestionId: gameMeta.communitySuggestionId,
        communitySuggestionVerified: gameMeta.communitySuggestionVerified,
        communitySuggestionExeName:
          gameMeta.communitySuggestionId && gameMeta.communitySuggestionVerified
            ? gameMeta.exeName
            : undefined,
        communityUpgradeExeName: gameMeta.communityUpgradeGame
          ? gameMeta.exeName
          : undefined,
        communityUpgradeGameName: gameMeta.communityUpgradeGame?.name,
        totalSeconds: 0,
        sessionCount: 0,
        lastPlayedAt: gameMeta.lastCheckedAt,
        exeNames: [gameMeta.exeName],
      });
    }

    return [...summaries.values()].sort(
      (left, right) =>
        Date.parse(right.lastPlayedAt) - Date.parse(left.lastPlayedAt),
    );
  }, [
    activeSessions,
    blacklist,
    exeCache,
    hydratedGameMetadata,
    sessions,
    userIgnoredProcesses,
  ]);

  const displayedGames = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = needle
      ? games.filter((game) => game.name.toLowerCase().includes(needle))
      : games;

    const sorted = [...filtered];
    sorted.sort((left, right) => {
      switch (sortKey) {
        case "playtime":
          return right.totalSeconds - left.totalSeconds;
        case "name":
          return left.name.localeCompare(right.name);
        case "sessions":
          return right.sessionCount - left.sessionCount;
        case "recent":
        default:
          return Date.parse(right.lastPlayedAt) - Date.parse(left.lastPlayedAt);
      }
    });
    return sorted;
  }, [games, query, sortKey]);

  return (
    <div className="grid gap-5">
      {games.length === 0 ? (
        <Panel className="px-4 py-12 text-center text-sm text-text-muted">
          No discovered games have completed a session yet.
        </Panel>
      ) : (
        <>
          <Panel className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-4">
              <div>
                <h2 className="font-semibold text-text">Library</h2>
                <p className="mt-1 text-sm text-text-muted">
                  {displayedGames.length} of {games.length} tracked games
                </p>
              </div>
              <div className="flex items-center gap-1 rounded-md border border-border bg-bg p-1">
                <button
                  type="button"
                  aria-label="Grid view"
                  onClick={() => setView("grid")}
                  className={clsx(
                    "grid h-8 w-8 place-items-center rounded transition",
                    view === "grid"
                      ? "bg-accent text-accent-fg"
                      : "text-text-muted hover:bg-surface-hover hover:text-text",
                  )}
                >
                  <LayoutGrid size={15} />
                </button>
                <button
                  type="button"
                  aria-label="List view"
                  onClick={() => setView("list")}
                  className={clsx(
                    "grid h-8 w-8 place-items-center rounded transition",
                    view === "list"
                      ? "bg-accent text-accent-fg"
                      : "text-text-muted hover:bg-surface-hover hover:text-text",
                  )}
                >
                  <List size={15} />
                </button>
              </div>
            </div>

            <div className="grid gap-2 border-b border-border bg-bg px-4 py-3 lg:grid-cols-[minmax(220px,1fr)_220px]">
              <div className="relative min-w-0">
                <Search
                  size={15}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-faint"
                />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search games..."
                  className="w-full bg-surface pl-9"
                />
              </div>
              <select
                aria-label="Sort games"
                value={sortKey}
                onChange={(event) => setSortKey(event.target.value as SortKey)}
                className="min-w-0 rounded-md border border-border bg-surface px-3 py-2 text-sm text-text outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/30"
              >
                {sortOptions.map((option) => (
                  <option key={option.key} value={option.key}>
                    Sort: {option.label}
                  </option>
                ))}
              </select>
            </div>
          </Panel>

          {displayedGames.length === 0 ? (
            <Panel className="px-4 py-12 text-center text-sm text-text-muted">
              No games match &ldquo;{query}&rdquo;.
            </Panel>
          ) : (
            <div
              className={
                view === "grid"
                  ? "grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5"
                  : "grid gap-3"
              }
            >
              {displayedGames.map((game) => (
                <GameLibraryCard
                  key={`${game.source ?? "unknown"}:${game.gameId}`}
                  game={game}
                  view={view}
                  onRemove={() =>
                    setPendingRemoval({
                      gameId: game.gameId,
                      source: game.source,
                      name: game.name,
                    })
                  }
                  onStopTracking={
                    game.source === "igdb"
                      ? () =>
                          setPendingStopTracking({
                            gameId: game.gameId,
                            source: "igdb",
                            name: game.name,
                            exeNames: game.exeNames,
                            sessionCount: game.sessionCount,
                          })
                      : game.source === "community"
                        ? () =>
                            setPendingStopTracking({
                              gameId: game.gameId,
                              source: "community",
                              name: game.name,
                              exeNames: game.exeNames,
                              sessionCount: game.sessionCount,
                            })
                        : undefined
                  }
                />
              ))}
            </div>
          )}
        </>
      )}
      {pendingRemoval ? (
        <RemoveGameDialog
          game={pendingRemoval}
          onCancel={() => setPendingRemoval(null)}
          onConfirm={(removeHistory) => {
            untrackGame(
              pendingRemoval.gameId,
              pendingRemoval.source,
              removeHistory,
            );
            addToast({
              tone: "success",
              title: removeHistory
                ? "Game untracked and history cleared"
                : "Game untracked",
              detail: removeHistory
                ? `${pendingRemoval.name} was removed from your library and history.`
                : `${pendingRemoval.name} was removed from your library. History was kept.`,
            });
            setPendingRemoval(null);
          }}
        />
      ) : null}
      {pendingStopTracking ? (
        <StopTrackingDialog
          game={pendingStopTracking}
          onCancel={() => setPendingStopTracking(null)}
          onConfirm={(clearHistory) => {
            const game = pendingStopTracking;
            setPendingStopTracking(null);
            void doNotTrackGame(
              game.gameId,
              game.source,
              game.exeNames,
              clearHistory,
            )
              .then(() => {
                addToast({
                  tone: "success",
                  title: clearHistory
                    ? "Tracking stopped and history cleared"
                    : "Tracking stopped",
                  detail: clearHistory
                    ? `${game.name} will be ignored from now on. Existing history was cleared.`
                    : `${game.name} will be ignored from now on. History was kept.`,
                });
              })
              .catch((error) => {
                addToast({
                  tone: "error",
                  title: "Stop tracking failed",
                  detail: formatError(error),
                });
              });
          }}
        />
      ) : null}
    </div>
  );
}

function GameLibraryCard({
  game,
  view,
  onRemove,
  onStopTracking,
}: {
  game: GameSummary;
  view: ViewMode;
  onRemove: () => void;
  onStopTracking?: () => void;
}) {
  const averageSeconds = Math.round(
    game.totalSeconds / Math.max(1, game.sessionCount),
  );
  const isList = view === "list";
  const addToast = useAppStore((state) => state.addToast);
  const setActiveView = useAppStore((state) => state.setActiveView);
  const setHistoryQuery = useAppStore((state) => state.setHistoryQuery);
  const contextMenu = useContextMenu();
  const coverInputRef = useRef<HTMLInputElement | null>(null);
  const [coverBusy, setCoverBusy] = useState(false);
  const canEditCover = game.source === "custom";

  const handleCopyExe = () => {
    navigator.clipboard.writeText(game.exeNames[0]);
    addToast({
      tone: "success",
      title: "Copied",
      detail: "Executable name copied to clipboard.",
    });
    contextMenu.close();
  };

  const handleCopyName = () => {
    navigator.clipboard.writeText(game.name);
    addToast({
      tone: "success",
      title: "Copied",
      detail: "Game name copied to clipboard.",
    });
    contextMenu.close();
  };

  const handleShowHistory = () => {
    setHistoryQuery(game.name);
    setActiveView("history");
    contextMenu.close();
  };

  async function saveCover(file: File | Blob | null) {
    if (!file || !canEditCover || coverBusy) return;

    setCoverBusy(true);
    try {
      await setCustomGameCover(game.gameId, file);
      addToast({
        tone: "success",
        title: "Cover updated",
        detail: `${game.name} now uses the selected cover.`,
      });
    } catch (error) {
      addToast({
        tone: "error",
        title: "Cover update failed",
        detail: formatError(error),
      });
    } finally {
      setCoverBusy(false);
      if (coverInputRef.current) coverInputRef.current.value = "";
    }
  }

  async function handlePasteCover() {
    contextMenu.close();
    if (!navigator.clipboard?.read) {
      addToast({
        tone: "error",
        title: "Clipboard unavailable",
        detail: "This system does not expose image clipboard access.",
      });
      return;
    }

    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const imageType = item.types.find((type) => type.startsWith("image/"));
        if (!imageType) continue;
        await saveCover(await item.getType(imageType));
        return;
      }

      addToast({
        tone: "error",
        title: "No image in clipboard",
        detail: "Copy an image, then try Paste cover again.",
      });
    } catch (error) {
      addToast({
        tone: "error",
        title: "Paste cover failed",
        detail: formatError(error),
      });
    }
  }

  function handleClearCover() {
    clearCustomGameCover(game.gameId);
    addToast({
      tone: "success",
      title: "Cover removed",
      detail: `${game.name} no longer uses a custom cover.`,
    });
    contextMenu.close();
  }

  const renderContextMenu = () => (
    <ContextMenu
      open={contextMenu.open}
      position={contextMenu.position}
      onClose={contextMenu.close}
    >
      <ContextMenuItem icon={History} onClick={handleShowHistory}>
        Show History
      </ContextMenuItem>
      {canEditCover ? (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem
            icon={ImagePlus}
            onClick={() => {
              contextMenu.close();
              coverInputRef.current?.click();
            }}
          >
            Set Cover
          </ContextMenuItem>
          <ContextMenuItem
            icon={Clipboard}
            onClick={() => void handlePasteCover()}
          >
            Paste Cover
          </ContextMenuItem>
          {game.coverUrl ? (
            <ContextMenuItem icon={Trash2} onClick={handleClearCover}>
              Delete Cover
            </ContextMenuItem>
          ) : null}
        </>
      ) : null}
      <ContextMenuSeparator />
      <ContextMenuItem icon={Copy} onClick={handleCopyName}>
        Copy Game Name
      </ContextMenuItem>
      <ContextMenuItem icon={Copy} onClick={handleCopyExe}>
        Copy Executable Name
      </ContextMenuItem>
      <ContextMenuSeparator />
      {onStopTracking ? (
        <ContextMenuItem
          icon={Ban}
          onClick={() => {
            onStopTracking();
            contextMenu.close();
          }}
        >
          Stop Tracking
        </ContextMenuItem>
      ) : null}
      <ContextMenuItem
        icon={Trash2}
        danger
        onClick={() => {
          onRemove();
          contextMenu.close();
        }}
      >
        Untrack Game
      </ContextMenuItem>
    </ContextMenu>
  );

  if (!isList) {
    return (
      <article
        {...contextMenu.props}
        className="group flex flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-raised transition-all duration-300 hover:-translate-y-1 hover:border-accent/50 hover:shadow-[0_8px_30px_rgba(0,0,0,0.4)]"
      >
        <div className="relative aspect-[3/4] w-full shrink-0 bg-surface-hover">
          {game.coverUrl ? (
            <img
              src={game.coverUrl}
              alt=""
              className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
            />
          ) : (
            <div className="grid h-full place-items-center text-xs text-text-faint">
              No cover
            </div>
          )}

          {/* Badges top left */}
          <div className="absolute left-2 top-2 z-20 flex flex-col items-start gap-1.5 drop-shadow-md">
            <SourceBadge source={game.source} />
            {game.source === "custom" ? (
              <CommunityApprovalBadge
                suggestionId={game.communitySuggestionId}
                verified={game.communitySuggestionVerified}
              />
            ) : null}
          </div>

          {/* Hover Actions - Top Right (Destructive Actions) */}
          <div className="absolute right-2 top-2 z-30 flex translate-x-2 flex-col gap-1.5 opacity-0 transition-all duration-200 group-hover:translate-x-0 group-hover:opacity-100">
            {onStopTracking ? (
              <IconButton
                icon={Ban}
                aria-label={`Stop tracking ${game.name}`}
                title="Stop tracking"
                onClick={onStopTracking}
                className="bg-bg text-text-muted shadow-raised border-bg hover:bg-warning hover:border-warning hover:text-white"
              />
            ) : null}
            <IconButton
              icon={Trash2}
              intent="danger"
              aria-label={`Untrack ${game.name}`}
              title="Untrack game"
              onClick={onRemove}
              className="bg-bg text-text-muted shadow-raised border-bg hover:!bg-danger-solid hover:!border-danger-solid hover:!text-white"
            />
          </div>
        </div>
        <input
          ref={coverInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          disabled={!canEditCover || coverBusy}
          onChange={(event) => {
            void saveCover(event.currentTarget.files?.[0] ?? null);
          }}
        />

        {/* Info Panel Below Cover */}
        <div className="flex flex-1 flex-col border-t border-border bg-surface p-3">
          <h2
            className="truncate text-[15px] font-semibold text-text"
            title={game.name}
          >
            {game.name}
          </h2>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="font-mono text-lg font-bold tracking-tight text-text">
              {formatDuration(game.totalSeconds)}
            </span>
            <span className="text-[11px] font-medium text-text-muted">
              in {game.sessionCount} session{game.sessionCount !== 1 ? "s" : ""}
            </span>
          </div>

          {/* Persistent Community Prompts */}
          {(game.communityUpgradeExeName ||
            (game.source === "custom" && game.communitySuggestionExeName)) && (
            <div className="mt-3 flex flex-col gap-2 border-t border-border/50 pt-3">
              {game.communityUpgradeExeName ? (
                <>
                  <div
                    className="truncate text-[11px] font-semibold text-success"
                    title={`Match: ${game.communityUpgradeGameName}`}
                  >
                    Update: {game.communityUpgradeGameName}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="primary"
                      onClick={() => {
                        acceptCommunityUpgrade(game.communityUpgradeExeName!);
                        addToast({
                          tone: "success",
                          title: "Community match applied",
                          detail: `${game.name} now uses ${game.communityUpgradeGameName}.`,
                        });
                      }}
                      className="flex-1 px-0 py-1 text-[11px]"
                    >
                      Update
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() =>
                        dismissCommunityUpgrade(game.communityUpgradeExeName!)
                      }
                      className="px-2 py-1 text-[11px]"
                    >
                      Dismiss
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <div className="text-[11px] font-semibold text-success">
                    Community approved
                  </div>
                  <Button
                    variant="primary"
                    onClick={() => {
                      convertLocalSuggestionToCommunity(
                        game.communitySuggestionExeName!,
                      );
                      addToast({
                        tone: "success",
                        title: "Community version applied",
                        detail: `${game.name} now uses the approved community match.`,
                      });
                    }}
                    className="w-full py-1 text-[11px]"
                  >
                    Apply Update
                  </Button>
                </>
              )}
            </div>
          )}
        </div>
        {renderContextMenu()}
      </article>
    );
  }

  // List View
  return (
    <article
      {...contextMenu.props}
      className="group rounded-xl border border-border bg-surface shadow-raised transition hover:border-accent/40"
    >
      <div className="grid grid-cols-[72px_minmax(0,1fr)_auto] items-center gap-4 p-3">
        <div className="w-[72px] shrink-0">
          {game.coverUrl ? (
            <img
              src={game.coverUrl}
              alt=""
              className="aspect-[3/4] w-full rounded-lg object-cover"
            />
          ) : (
            <div className="grid aspect-[3/4] w-full place-items-center rounded-lg bg-surface-hover text-xs text-text-faint">
              No cover
            </div>
          )}
        </div>

        <div className="min-w-0 py-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-base font-semibold text-text">
              {game.name}
            </h2>
            <SourceBadge source={game.source} />
            {game.source === "custom" ? (
              <CommunityApprovalBadge
                suggestionId={game.communitySuggestionId}
                verified={game.communitySuggestionVerified}
              />
            ) : null}
          </div>
          <div className="mt-1.5 flex items-center gap-3 text-xs text-text-faint">
            <div className="flex items-center gap-1.5">
              <Clock3 size={13} />
              <span>{formatGameActivity(game)}</span>
            </div>
            <span className="h-1 w-1 rounded-full bg-border" />
            <span className="truncate font-mono">
              {game.exeNames.join(", ")}
            </span>
          </div>

          {(game.communityUpgradeExeName ||
            (game.source === "custom" && game.communitySuggestionExeName)) && (
            <div className="mt-3 flex gap-2">
              {game.communityUpgradeExeName ? (
                <>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      acceptCommunityUpgrade(game.communityUpgradeExeName!);
                      addToast({
                        tone: "success",
                        title: "Community match applied",
                        detail: `${game.name} now uses ${game.communityUpgradeGameName}.`,
                      });
                    }}
                    className="border-success-border bg-success-tint px-3 py-1 text-xs text-success"
                  >
                    Use community match
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() =>
                      dismissCommunityUpgrade(game.communityUpgradeExeName!)
                    }
                    className="px-3 py-1 text-xs"
                  >
                    Dismiss
                  </Button>
                </>
              ) : (
                <Button
                  variant="secondary"
                  onClick={() => {
                    convertLocalSuggestionToCommunity(
                      game.communitySuggestionExeName!,
                    );
                    addToast({
                      tone: "success",
                      title: "Community version applied",
                      detail: `${game.name} now uses the approved community match.`,
                    });
                  }}
                  className="border-success-border bg-success-tint px-3 py-1 text-xs text-success"
                >
                  Apply approved community match
                </Button>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-6 pr-2">
          <div className="hidden grid-cols-3 gap-6 sm:grid">
            <div className="text-right">
              <div className="text-[11px] font-medium uppercase tracking-wide text-text-faint">
                Playtime
              </div>
              <div className="mt-0.5 font-mono text-sm font-semibold text-text">
                {formatDuration(game.totalSeconds)}
              </div>
            </div>
            <div className="text-right">
              <div className="text-[11px] font-medium uppercase tracking-wide text-text-faint">
                Sessions
              </div>
              <div className="mt-0.5 font-mono text-sm font-semibold text-text">
                {game.sessionCount}
              </div>
            </div>
            <div className="text-right">
              <div className="text-[11px] font-medium uppercase tracking-wide text-text-faint">
                Average
              </div>
              <div className="mt-0.5 font-mono text-sm font-semibold text-text">
                {formatDuration(averageSeconds)}
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-1.5 opacity-0 transition-opacity group-hover:opacity-100">
            {onStopTracking ? (
              <IconButton
                icon={Ban}
                aria-label={`Stop tracking ${game.name}`}
                title="Stop tracking"
                onClick={onStopTracking}
              />
            ) : null}
            <IconButton
              icon={Trash2}
              intent="danger"
              aria-label={`Untrack ${game.name}`}
              title="Untrack game"
              onClick={onRemove}
            />
          </div>
        </div>
      </div>
      <input
        ref={coverInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        disabled={!canEditCover || coverBusy}
        onChange={(event) => {
          void saveCover(event.currentTarget.files?.[0] ?? null);
        }}
      />
      {renderContextMenu()}
    </article>
  );
}

function GameMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-bg px-3 py-2">
      <div className="text-xs text-text-faint">{label}</div>
      <div className="mt-1 truncate font-mono text-sm font-medium text-text">
        {value}
      </div>
    </div>
  );
}

function StopTrackingDialog({
  game,
  onCancel,
  onConfirm,
}: {
  game: Exclude<PendingStopTracking, null>;
  onCancel: () => void;
  onConfirm: (clearHistory: boolean) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 px-4">
      <div className="w-full max-w-md rounded-lg border border-border bg-surface p-5 shadow-raised">
        <h2 className="text-lg font-semibold text-text">
          Stop tracking {game.name}?
        </h2>
        <p className="mt-2 text-sm text-text-muted">
          PlayCounter will ignore this game&apos;s executable matches going
          forward. Choose whether to keep or remove its existing history.
        </p>
        {game.sessionCount > 0 ? (
          <p className="mt-2 text-sm text-text-muted">
            {game.sessionCount} completed{" "}
            {game.sessionCount === 1 ? "session" : "sessions"} can be kept in My
            History or cleared now.
          </p>
        ) : null}
        <div className="mt-3 rounded-md border border-border bg-bg px-3 py-2 text-xs text-text-faint">
          {game.exeNames.join(", ")}
        </div>
        <div className="mt-5 grid gap-2 sm:grid-cols-3">
          <Button variant="secondary" onClick={() => onConfirm(false)}>
            Keep history
          </Button>
          <Button
            variant="danger"
            onClick={() => onConfirm(true)}
            disabled={game.sessionCount === 0}
          >
            Clear history
          </Button>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}

function RemoveGameDialog({
  game,
  onCancel,
  onConfirm,
}: {
  game: Exclude<PendingRemoval, null>;
  onCancel: () => void;
  onConfirm: (removeHistory: boolean) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 px-4">
      <div className="w-full max-w-md rounded-lg border border-border bg-surface p-5 shadow-raised">
        <h2 className="text-lg font-semibold text-text">
          Untrack {game.name}?
        </h2>
        <p className="mt-2 text-sm text-text-muted">
          This removes the local executable mapping and stops active tracking if
          it is currently running. Do you also want to remove its history?
        </p>
        <div className="mt-5 grid gap-2 sm:grid-cols-3">
          <Button variant="secondary" onClick={() => onConfirm(false)}>
            Keep history
          </Button>
          <Button variant="danger" onClick={() => onConfirm(true)}>
            Clear history
          </Button>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
