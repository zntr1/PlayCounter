import clsx from "clsx";
import { createPortal } from "react-dom";
import {
  Ban,
  Clipboard,
  Clock3,
  ClockPlus,
  Copy,
  Flag,
  Gamepad2,
  History,
  ImagePlus,
  LayoutGrid,
  List,
  Pencil,
  Search,
  Send,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  acceptCommunityUpgrade,
  addManualSession,
  applyGameMatch,
  clearCustomGameCover,
  convertLocalSuggestionToCommunity,
  dismissCommunityUpgrade,
  doNotTrackGame,
  findGameMatches,
  convertToCustomGame,
  hydrateGameMetadata,
  renameCustomGame,
  setCustomGameCover,
  suggestTrackedGameToCommunity,
  untrackGame,
} from "../../tracker";
import {
  gameMetadataKey,
  useAppStore,
  useIsOffline,
  type ActiveSession,
  type ExeCacheEntry,
} from "../../store";
import { CommunitySuggestionForm } from "./DiscoveredView";
import { matchesProcessPatternSet } from "../../ignoredProcessPatterns";
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
  useEscapeKey,
} from "../primitives";
import type {
  CommunityGameSuggestionResponse,
  CommunityMetadataCandidate,
  CommunityMetadataSearchResponse,
  Game,
  GameSource,
} from "@playcounter/shared";

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
  source: GameSource;
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
  const showDurationDays = useAppStore(
    (state) => state.settings.showDurationDays,
  );
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
      matchesProcessPatternSet(exeName, ignoredExeNames);
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
                  showDurationDays={showDurationDays}
                  view={view}
                  onRemove={() =>
                    setPendingRemoval({
                      gameId: game.gameId,
                      source: game.source,
                      name: game.name,
                    })
                  }
                  onStopTracking={
                    game.source
                      ? () =>
                          setPendingStopTracking({
                            gameId: game.gameId,
                            source: game.source!,
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
                ? "Removed from library and history cleared"
                : "Removed from library",
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
                    ? "Game ignored and history cleared"
                    : "Game ignored",
                  detail: clearHistory
                    ? `${game.name} will be ignored from now on. Existing history was cleared.`
                    : `${game.name} will be ignored from now on. History was kept.`,
                });
              })
              .catch((error) => {
                addToast({
                  tone: "error",
                  title: "Could not ignore game",
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
  showDurationDays,
  view,
  onRemove,
  onStopTracking,
}: {
  game: GameSummary;
  showDurationDays: boolean;
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
  const [showAddPlaytime, setShowAddPlaytime] = useState(false);
  const [showMatchCheck, setShowMatchCheck] = useState(false);
  const apiEndpoint = useAppStore((state) => state.settings.apiEndpoint);
  const installUuid = useAppStore((state) => state.installUuid);
  const isOffline = useIsOffline();
  const [shareOpen, setShareOpen] = useState(false);
  const [shareSearch, setShareSearch] = useState("");
  const [shareCandidates, setShareCandidates] = useState<
    CommunityMetadataCandidate[]
  >([]);
  const [shareSelection, setShareSelection] =
    useState<CommunityMetadataCandidate | null>(null);
  const [shareState, setShareState] = useState<
    "idle" | "loading" | "saving" | "saved" | "error"
  >("idle");
  const [shareMessage, setShareMessage] = useState("");
  const [showConvert, setShowConvert] = useState(false);
  const [convertName, setConvertName] = useState("");
  const [showRename, setShowRename] = useState(false);
  const [renameName, setRenameName] = useState("");
  const canEditCover = game.source === "custom";
  // Shown in place of the title while hovering the card.
  const exeLabel = game.exeNames.filter(Boolean).join(", ");

  function submitRename() {
    const name = renameName.trim();
    if (!name) return;
    renameCustomGame(game.gameId, name);
    addToast({
      tone: "success",
      title: "Game renamed",
      detail: `The custom game is now called ${name}.`,
    });
    setShowRename(false);
  }

  function submitConvertToCustom() {
    const exeName = game.exeNames[0];
    const name = convertName.trim();
    if (!exeName || !name) return;
    convertToCustomGame(exeName, name);
    addToast({
      tone: "success",
      title: "Converted to custom game",
      detail: `${exeName} is now tracked as ${name}.`,
    });
    setShowConvert(false);
  }

  const handleApplyMatch = (match: Game) => {
    applyGameMatch(game.exeNames[0], match);
    addToast({
      tone: "success",
      title: "Match applied",
      detail: `${game.name} is now tracked as ${match.name}.`,
    });
    setShowMatchCheck(false);
  };

  function closeShare() {
    setShareOpen(false);
    setShareSearch("");
    setShareCandidates([]);
    setShareSelection(null);
    setShareState("idle");
    setShareMessage("");
  }

  async function searchShareCandidates() {
    const query = shareSearch.trim();
    if (query.length < 2 || isOffline) return;

    setShareState("loading");
    setShareMessage("");
    setShareCandidates([]);
    try {
      const response = await fetch(
        `${apiEndpoint}/api/community/metadata?query=${encodeURIComponent(query)}`,
      );
      if (!response.ok)
        throw new Error(`${response.status} ${response.statusText}`);
      const body = (await response.json()) as CommunityMetadataSearchResponse;
      setShareCandidates(body.candidates);
      setShareMessage(
        body.candidates.length > 0
          ? "Pick the exact game this executable belongs to."
          : "No matching games found.",
      );
      setShareState("idle");
    } catch (error) {
      setShareState("error");
      setShareMessage(formatError(error));
    }
  }

  function applyShareCandidate(candidate: CommunityMetadataCandidate) {
    if (!candidate.coverUrl) {
      setShareSelection(null);
      setShareMessage(
        `${candidate.name} has no cover art. Pick a result with cover art.`,
      );
      return;
    }

    setShareSelection(candidate);
    setShareMessage(`Selected ${candidate.name} from the database.`);
  }

  async function submitShareSuggestion() {
    const exeName = game.exeNames[0];
    if (!shareSelection?.coverUrl || !exeName) return;

    setShareState("saving");
    setShareMessage("");
    try {
      const response = await fetch(`${apiEndpoint}/api/community/suggestions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          exeName,
          name: shareSelection.name,
          coverUrl: shareSelection.coverUrl,
          installUuid: installUuid ?? undefined,
        }),
      });
      if (!response.ok)
        throw new Error(`${response.status} ${response.statusText}`);

      const result = (await response.json()) as CommunityGameSuggestionResponse;
      if (result.igdbGame) {
        applyGameMatch(exeName, result.igdbGame);
        closeShare();
        addToast({
          tone: "success",
          title: "Already in IGDB",
          detail: `${result.igdbGame.name} is a known IGDB match for ${exeName} and was applied directly.`,
        });
        return;
      }
      if (result.id === undefined) throw new Error("Unexpected response");
      suggestTrackedGameToCommunity(
        exeName,
        shareSelection.name,
        shareSelection.coverUrl,
        result.id,
        result.verified ?? false,
      );
      closeShare();
      addToast({
        tone: "success",
        title: "Suggested to community",
        detail: `Your community suggestion was submitted for ${exeName}.`,
      });
    } catch (error) {
      setShareState("error");
      setShareMessage(formatError(error));
    }
  }

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

  const handleAddPlaytime = (durationSeconds: number, endedAt?: string) => {
    addManualSession({
      gameId: game.gameId,
      gameName: game.name,
      coverUrl: game.coverUrl,
      source: game.source,
      exeName: game.exeNames[0] ?? "",
      durationSeconds,
      endedAt,
      communitySuggestionId: game.communitySuggestionId,
      communitySuggestionVerified: game.communitySuggestionVerified,
    });
    addToast({
      tone: "success",
      title: "Playtime added",
      detail: `${formatDuration(durationSeconds, showDurationDays)} added to ${game.name}.`,
    });
    setShowAddPlaytime(false);
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
      <ContextMenuItem
        icon={ClockPlus}
        onClick={() => {
          contextMenu.close();
          setShowAddPlaytime(true);
        }}
      >
        Add playtime manually
      </ContextMenuItem>
      {game.source && game.exeNames[0] ? (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem
            icon={Search}
            onClick={() => {
              contextMenu.close();
              setShowMatchCheck(true);
            }}
          >
            Check for Matches
          </ContextMenuItem>
          {game.source === "custom" && !game.communitySuggestionId ? (
            <ContextMenuItem
              icon={Send}
              onClick={() => {
                contextMenu.close();
                setShareOpen(true);
              }}
            >
              Suggest to Community
            </ContextMenuItem>
          ) : null}
          {game.source === "igdb" || game.source === "community" ? (
            <>
              <ContextMenuItem
                icon={Flag}
                onClick={() => {
                  contextMenu.close();
                  setShareOpen(true);
                }}
              >
                Report Wrong Match
              </ContextMenuItem>
              <ContextMenuItem
                icon={Gamepad2}
                onClick={() => {
                  contextMenu.close();
                  setConvertName(game.name);
                  setShowConvert(true);
                }}
              >
                Convert to Custom Game
              </ContextMenuItem>
            </>
          ) : null}
        </>
      ) : null}
      {canEditCover ? (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem
            icon={Pencil}
            onClick={() => {
              contextMenu.close();
              setRenameName(game.name);
              setShowRename(true);
            }}
          >
            Rename Game
          </ContextMenuItem>
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
          Ignore Game
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
        Remove from Library
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

          {/* Hover Actions - Top Right (constructive first, destructive last) */}
          <div className="absolute right-2 top-2 z-30 flex translate-x-2 flex-col gap-1.5 opacity-0 transition-all duration-200 group-hover:translate-x-0 group-hover:opacity-100">
            {game.source && game.exeNames[0] ? (
              <IconButton
                icon={Search}
                aria-label={`Check matches for ${game.name}`}
                title="Check for matches"
                onClick={() => setShowMatchCheck(true)}
                className="bg-bg text-text-muted shadow-raised border-bg hover:bg-accent hover:border-accent hover:text-accent-fg"
              />
            ) : null}
            {game.source === "custom" &&
            game.exeNames[0] &&
            !game.communitySuggestionId ? (
              <IconButton
                icon={Send}
                aria-label={`Suggest ${game.name} to the community`}
                title="Suggest to community"
                onClick={() => setShareOpen(true)}
                className="bg-bg text-text-muted shadow-raised border-bg hover:bg-accent hover:border-accent hover:text-accent-fg"
              />
            ) : null}
            {(game.source === "igdb" || game.source === "community") &&
            game.exeNames[0] ? (
              <IconButton
                icon={Flag}
                aria-label={`Report wrong match for ${game.name}`}
                title="Report wrong match"
                onClick={() => setShareOpen(true)}
                className="bg-bg text-text-muted shadow-raised border-bg hover:bg-accent hover:border-accent hover:text-accent-fg"
              />
            ) : null}
            <IconButton
              icon={ClockPlus}
              aria-label={`Add playtime manually to ${game.name}`}
              title="Add playtime manually"
              onClick={() => setShowAddPlaytime(true)}
              className="bg-bg text-text-muted shadow-raised border-bg hover:bg-accent hover:border-accent hover:text-accent-fg"
            />
            {onStopTracking ? (
              <IconButton
                icon={Ban}
                aria-label={`Ignore ${game.name}`}
                title="Ignore game (never track again)"
                onClick={onStopTracking}
                className="bg-bg text-text-muted shadow-raised border-bg hover:bg-warning hover:border-warning hover:text-white"
              />
            ) : null}
            <IconButton
              icon={Trash2}
              intent="danger"
              aria-label={`Remove ${game.name} from library`}
              title="Remove from library"
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
            title={exeLabel ? `${game.name} (${exeLabel})` : game.name}
          >
            {exeLabel ? (
              <>
                <span className="group-hover:hidden">{game.name}</span>
                <span className="hidden font-mono text-[13px] group-hover:inline">
                  {exeLabel}
                </span>
              </>
            ) : (
              game.name
            )}
          </h2>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="font-mono text-lg font-bold tracking-tight text-text">
              {formatDuration(game.totalSeconds, showDurationDays)}
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
                    title={`Found in database: ${game.communityUpgradeGameName}`}
                  >
                    Match found: {game.communityUpgradeGameName}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="primary"
                      title={`Track this exe as ${game.communityUpgradeGameName} from now on`}
                      onClick={() => {
                        acceptCommunityUpgrade(game.communityUpgradeExeName!);
                        addToast({
                          tone: "success",
                          title: "Match applied",
                          detail: `${game.name} now uses ${game.communityUpgradeGameName}.`,
                        });
                      }}
                      className="flex-1 px-0 py-1 text-[11px]"
                    >
                      Use match
                    </Button>
                    <Button
                      variant="secondary"
                      title="Keep the custom game and never show this match again"
                      onClick={() =>
                        dismissCommunityUpgrade(game.communityUpgradeExeName!)
                      }
                      className="px-2 py-1 text-[11px]"
                    >
                      Keep custom
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <div className="text-[11px] font-semibold text-success">
                    Your community suggestion was approved
                  </div>
                  <Button
                    variant="primary"
                    title="Track this game as the approved community game from now on"
                    onClick={() => {
                      convertLocalSuggestionToCommunity(
                        game.communitySuggestionExeName!,
                      );
                      addToast({
                        tone: "success",
                        title: "Community match applied",
                        detail: `${game.name} now uses the approved community match.`,
                      });
                    }}
                    className="w-full py-1 text-[11px]"
                  >
                    Switch to community version
                  </Button>
                </>
              )}
            </div>
          )}
        </div>
        {renderContextMenu()}
        {showAddPlaytime ? (
          <AddPlaytimeDialog
            game={game}
            onCancel={() => setShowAddPlaytime(false)}
            onConfirm={handleAddPlaytime}
          />
        ) : null}
        {showMatchCheck ? (
          <MatchCheckDialog
            game={game}
            onCancel={() => setShowMatchCheck(false)}
            onApply={handleApplyMatch}
          />
        ) : null}
        {shareOpen ? (
          <CommunitySuggestionForm
            candidates={shareCandidates}
            exeName={game.exeNames[0] ?? ""}
            message={shareMessage}
            search={shareSearch}
            selection={shareSelection}
            state={shareState}
            isOffline={isOffline}
            onApplyCandidate={applyShareCandidate}
            onCancel={closeShare}
            onSearch={() => void searchShareCandidates()}
            onSearchChange={(value) => {
              setShareSearch(value);
              setShareSelection(null);
            }}
            onSubmit={() => void submitShareSuggestion()}
          />
        ) : null}
        {showConvert ? (
          <GameNameDialog
            title={`Convert ${game.name} to a custom game`}
            description="Use this when the database match is wrong and the real game is not in any database. Recorded playtime stays with the game; the change is only on this PC."
            confirmLabel="Convert to custom"
            name={convertName}
            onNameChange={setConvertName}
            onCancel={() => setShowConvert(false)}
            onConfirm={submitConvertToCustom}
          />
        ) : null}
        {showRename ? (
          <GameNameDialog
            title={`Rename ${game.name}`}
            description="Changes the display name of this custom game everywhere, including recorded sessions."
            confirmLabel="Rename"
            name={renameName}
            onNameChange={setRenameName}
            onCancel={() => setShowRename(false)}
            onConfirm={submitRename}
          />
        ) : null}
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
            <h2
              className="truncate text-base font-semibold text-text"
              title={exeLabel ? `${game.name} (${exeLabel})` : game.name}
            >
              {exeLabel ? (
                <>
                  <span className="group-hover:hidden">{game.name}</span>
                  <span className="hidden font-mono text-sm group-hover:inline">
                    {exeLabel}
                  </span>
                </>
              ) : (
                game.name
              )}
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
                    title={`Track this exe as ${game.communityUpgradeGameName} from now on`}
                    onClick={() => {
                      acceptCommunityUpgrade(game.communityUpgradeExeName!);
                      addToast({
                        tone: "success",
                        title: "Match applied",
                        detail: `${game.name} now uses ${game.communityUpgradeGameName}.`,
                      });
                    }}
                    className="max-w-64 border-success-border bg-success-tint px-3 py-1 text-xs text-success"
                  >
                    <span className="truncate">
                      Use match: {game.communityUpgradeGameName}
                    </span>
                  </Button>
                  <Button
                    variant="secondary"
                    title="Keep the custom game and never show this match again"
                    onClick={() =>
                      dismissCommunityUpgrade(game.communityUpgradeExeName!)
                    }
                    className="px-3 py-1 text-xs"
                  >
                    Keep custom
                  </Button>
                </>
              ) : (
                <Button
                  variant="secondary"
                  title="Your community suggestion was approved — track this game as the community game from now on"
                  onClick={() => {
                    convertLocalSuggestionToCommunity(
                      game.communitySuggestionExeName!,
                    );
                    addToast({
                      tone: "success",
                      title: "Community match applied",
                      detail: `${game.name} now uses the approved community match.`,
                    });
                  }}
                  className="border-success-border bg-success-tint px-3 py-1 text-xs text-success"
                >
                  Suggestion approved — switch to community version
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
                {formatDuration(game.totalSeconds, showDurationDays)}
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
                {formatDuration(averageSeconds, showDurationDays)}
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-1.5 opacity-0 transition-opacity group-hover:opacity-100">
            <IconButton
              icon={ClockPlus}
              aria-label={`Add playtime manually to ${game.name}`}
              title="Add playtime manually"
              onClick={() => setShowAddPlaytime(true)}
            />
            {onStopTracking ? (
              <IconButton
                icon={Ban}
                aria-label={`Ignore ${game.name}`}
                title="Ignore game (never track again)"
                onClick={onStopTracking}
              />
            ) : null}
            <IconButton
              icon={Trash2}
              intent="danger"
              aria-label={`Remove ${game.name} from library`}
              title="Remove from library"
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
      {showAddPlaytime ? (
        <AddPlaytimeDialog
          game={game}
          onCancel={() => setShowAddPlaytime(false)}
          onConfirm={handleAddPlaytime}
        />
      ) : null}
      {showMatchCheck ? (
        <MatchCheckDialog
          game={game}
          onCancel={() => setShowMatchCheck(false)}
          onApply={handleApplyMatch}
        />
      ) : null}
      {shareOpen ? (
        <CommunitySuggestionForm
          candidates={shareCandidates}
          exeName={game.exeNames[0] ?? ""}
          message={shareMessage}
          search={shareSearch}
          selection={shareSelection}
          state={shareState}
          isOffline={isOffline}
          onApplyCandidate={applyShareCandidate}
          onCancel={closeShare}
          onSearch={() => void searchShareCandidates()}
          onSearchChange={(value) => {
            setShareSearch(value);
            setShareSelection(null);
          }}
          onSubmit={() => void submitShareSuggestion()}
        />
      ) : null}
      {showConvert ? (
        <GameNameDialog
          title={`Convert ${game.name} to a custom game`}
          description="Use this when the database match is wrong and the real game is not in any database. Recorded playtime stays with the game; the change is only on this PC."
          confirmLabel="Convert to custom"
          name={convertName}
          onNameChange={setConvertName}
          onCancel={() => setShowConvert(false)}
          onConfirm={submitConvertToCustom}
        />
      ) : null}
      {showRename ? (
        <GameNameDialog
          title={`Rename ${game.name}`}
          description="Changes the display name of this custom game everywhere, including recorded sessions."
          confirmLabel="Rename"
          name={renameName}
          onNameChange={setRenameName}
          onCancel={() => setShowRename(false)}
          onConfirm={submitRename}
        />
      ) : null}
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
  useEscapeKey(onCancel);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 px-4">
      <div className="w-full max-w-md rounded-lg border border-border bg-surface p-5 shadow-raised">
        <h2 className="text-lg font-semibold text-text">
          Ignore {game.name}?
        </h2>
        <p className="mt-2 text-sm text-text-muted">
          PlayCounter ignores this game&apos;s executable from now on — it will
          never be tracked again. You can undo this anytime under Discovered
          &rarr; Ignored.
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
            Ignore game
          </Button>
          <Button
            variant="danger"
            onClick={() => onConfirm(true)}
            disabled={game.sessionCount === 0}
          >
            Ignore + clear history
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
  useEscapeKey(onCancel);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 px-4">
      <div className="w-full max-w-md rounded-lg border border-border bg-surface p-5 shadow-raised">
        <h2 className="text-lg font-semibold text-text">
          Remove {game.name} from library?
        </h2>
        <p className="mt-2 text-sm text-text-muted">
          Removes the game and its executable link, and stops an active session.
          If the game runs again it will be re-detected — use Ignore Game to
          block it for good.
        </p>
        <div className="mt-5 grid gap-2 sm:grid-cols-3">
          <Button variant="secondary" onClick={() => onConfirm(false)}>
            Remove
          </Button>
          <Button variant="danger" onClick={() => onConfirm(true)}>
            Remove + clear history
          </Button>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}

function localDateTimeValue(date: Date) {
  // Format a Date as the value expected by <input type="datetime-local">
  // (local time, no timezone suffix): YYYY-MM-DDTHH:mm.
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

function AddPlaytimeDialog({
  game,
  onCancel,
  onConfirm,
}: {
  game: GameSummary;
  onCancel: () => void;
  onConfirm: (durationSeconds: number, endedAt?: string) => void;
}) {
  useEscapeKey(onCancel);
  const [hours, setHours] = useState("");
  const [minutes, setMinutes] = useState("");
  const [useDate, setUseDate] = useState(false);
  const [dateValue, setDateValue] = useState(() =>
    localDateTimeValue(new Date()),
  );

  const durationSeconds =
    (Math.max(0, Number(hours) || 0) * 60 + Math.max(0, Number(minutes) || 0)) *
    60;
  const parsedDate = useDate ? new Date(dateValue) : null;
  const dateInvalid = useDate && Number.isNaN(parsedDate?.getTime());
  const canSubmit = durationSeconds >= 1 && !dateInvalid;

  const handleSubmit = () => {
    if (!canSubmit) return;
    onConfirm(
      durationSeconds,
      parsedDate ? parsedDate.toISOString() : undefined,
    );
  };

  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 px-4">
      <div className="w-full max-w-md rounded-lg border border-border bg-surface p-5 shadow-raised">
        <h2 className="text-lg font-semibold text-text">
          Add playtime to {game.name}
        </h2>
        <p className="mt-2 text-sm text-text-muted">
          Log a session manually — for time played before PlayCounter, or when a
          session was missed.
        </p>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <label className="grid gap-1.5 text-xs font-medium text-text-muted">
            Hours
            <Input
              type="number"
              min={0}
              inputMode="numeric"
              value={hours}
              onChange={(event) => setHours(event.target.value)}
              placeholder="0"
            />
          </label>
          <label className="grid gap-1.5 text-xs font-medium text-text-muted">
            Minutes
            <Input
              type="number"
              min={0}
              max={59}
              inputMode="numeric"
              value={minutes}
              onChange={(event) => setMinutes(event.target.value)}
              placeholder="0"
            />
          </label>
        </div>

        <label className="mt-4 flex items-center gap-2 text-sm text-text">
          <input
            type="checkbox"
            checked={useDate}
            onChange={(event) => setUseDate(event.target.checked)}
            className="h-4 w-4 accent-accent"
          />
          Set a specific date for this session
        </label>
        {useDate ? (
          <Input
            type="datetime-local"
            value={dateValue}
            max={localDateTimeValue(new Date())}
            onChange={(event) => setDateValue(event.target.value)}
            className="mt-2 w-full"
          />
        ) : null}

        <div className="mt-5 grid gap-2 sm:grid-cols-2">
          <Button variant="primary" onClick={handleSubmit} disabled={!canSubmit}>
            Add playtime
          </Button>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function MatchCheckDialog({
  game,
  onCancel,
  onApply,
}: {
  game: GameSummary;
  onCancel: () => void;
  onApply: (match: Game) => void;
}) {
  useEscapeKey(onCancel);
  const exeName = game.exeNames[0] ?? "";
  const [state, setState] = useState<"loading" | "error" | "done">("loading");
  const [error, setError] = useState("");
  const [candidates, setCandidates] = useState<Game[]>([]);
  const [selection, setSelection] = useState<Game | null>(null);

  const isCurrentMatch = (match: Game) =>
    match.source === game.source && match.id === game.gameId;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const games = await findGameMatches(exeName);
        if (cancelled) return;
        setCandidates(games);
        // A single combined IGDB/community result is preselected so applying
        // is one click — unless it is what the exe already uses. An ambiguous
        // set requires an explicit pick.
        setSelection(
          games.length === 1 &&
            !(games[0].source === game.source && games[0].id === game.gameId)
            ? games[0]
            : null,
        );
        setState("done");
      } catch (err) {
        if (cancelled) return;
        setError(formatError(err));
        setState("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [exeName, game.gameId, game.source]);

  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 px-4">
      <div className="w-full max-w-lg rounded-lg border border-border bg-surface p-5 shadow-raised">
        <h2 className="text-lg font-semibold text-text">
          Check matches for {game.name}
        </h2>
        <p className="mt-2 text-sm text-text-muted">
          Looks up{" "}
          <span
            className="inline-block max-w-full truncate align-bottom font-medium text-text"
            title={exeName}
          >
            {exeName}
          </span>{" "}
          in the IGDB and community databases.
        </p>

        <div className="mt-4 max-h-80 overflow-y-auto">
          {state === "loading" ? (
            <div className="rounded-md border border-dashed border-border bg-bg p-8 text-center text-sm text-text-muted">
              Checking databases...
            </div>
          ) : state === "error" ? (
            <div className="rounded-md border border-border bg-bg p-4 text-sm text-text-muted">
              Match check failed: {error}
            </div>
          ) : candidates.length === 0 ? (
            <div className="rounded-md border border-dashed border-border bg-bg p-8 text-center text-sm text-text-muted">
              No database match found.
              {game.source === "custom"
                ? ` ${game.name} stays a custom game.`
                : ""}
            </div>
          ) : (
            <div className="grid gap-2">
              {candidates.map((match) => {
                const selected =
                  selection?.id === match.id &&
                  selection.source === match.source;
                return (
                  <button
                    key={`${match.source}:${match.id}`}
                    type="button"
                    onClick={() => setSelection(selected ? null : match)}
                    className={clsx(
                      "flex min-w-0 items-center gap-3 rounded-lg border p-3 text-left transition",
                      selected
                        ? "border-accent bg-surface-hover"
                        : "border-border bg-surface hover:border-accent/40 hover:bg-surface-hover",
                    )}
                  >
                    {match.coverUrl ? (
                      <img
                        src={match.coverUrl}
                        alt=""
                        className="h-16 w-12 shrink-0 rounded bg-surface-hover object-cover"
                      />
                    ) : (
                      <div className="h-16 w-12 shrink-0 rounded bg-surface-hover" />
                    )}
                    <div className="min-w-0">
                      <div className="truncate font-semibold text-text">
                        {match.name}
                      </div>
                      <div className="mt-1.5 flex items-center gap-1.5">
                        <SourceBadge source={match.source} />
                        {isCurrentMatch(match) ? (
                          <span className="rounded border border-border bg-surface-hover px-1.5 py-0.5 text-[11px] font-medium text-text-muted">
                            Current match
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="mt-5 grid gap-2 sm:grid-cols-2">
          <Button
            variant="primary"
            disabled={!selection || isCurrentMatch(selection)}
            onClick={() => {
              if (selection) onApply(selection);
            }}
          >
            Apply match
          </Button>
          <Button variant="ghost" onClick={onCancel}>
            {game.source === "custom" ? "Keep custom game" : "Keep current match"}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function GameNameDialog({
  title,
  description,
  confirmLabel,
  name,
  onNameChange,
  onCancel,
  onConfirm,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  name: string;
  onNameChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEscapeKey(onCancel);
  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 px-4">
      <div className="w-full max-w-md rounded-lg border border-border bg-surface p-5 shadow-raised">
        <h2 className="text-lg font-semibold text-text">{title}</h2>
        <p className="mt-2 text-sm text-text-muted">{description}</p>

        <form
          className="mt-4"
          onSubmit={(event) => {
            event.preventDefault();
            onConfirm();
          }}
        >
          <label className="grid gap-1.5 text-xs font-medium text-text-muted">
            Game name
            <Input
              value={name}
              onChange={(event) => onNameChange(event.target.value)}
              maxLength={120}
              autoFocus
              placeholder="Game name..."
            />
          </label>

          <div className="mt-5 grid gap-2 sm:grid-cols-2">
            <Button variant="primary" type="submit" disabled={!name.trim()}>
              {confirmLabel}
            </Button>
            <Button variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
