import clsx from "clsx";
import {
  AlertTriangle,
  Ban,
  CalendarDays,
  Clipboard,
  Check,
  Clock3,
  ClockPlus,
  Copy,
  Flag,
  FolderSearch,
  Gamepad2,
  History,
  ImagePlus,
  LayoutGrid,
  List,
  Loader2,
  Pencil,
  Play,
  RotateCcw,
  Search,
  Send,
  Trash2,
  WifiOff,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  acceptCommunityUpgrade,
  addManualSession,
  applyGameMatch,
  applyKnownGameMatch,
  clearCustomGameCover,
  convertLocalSuggestionToCommunity,
  dismissCommunityUpgrade,
  doNotTrackGame,
  findGameMatches,
  forgetLaunchTarget,
  launchGame,
  convertToCustomGame,
  hydrateGameMetadata,
  markCommunitySuggestionRejected,
  renameCustomGame,
  reportNegativeMatch,
  chooseLaunchTarget,
  setGamePlaytime,
  setCustomGameCover,
  suggestTrackedGameToCommunity,
  untrackGame,
  verifyLaunchTargetsThrottled,
  type GameAliasRef,
} from "../../tracker";
import {
  canSuggestCustomGameToCommunity,
  canSwitchApprovedSuggestionToCommunity,
  createGameIdentityResolver,
  gameMetadataKey,
  resolvedCanonicalGameKey,
  useAppStore,
  useIsOffline,
  type ActiveSession,
  type ExeCacheEntry,
} from "../../store";
import { CommunitySuggestionForm } from "./DiscoveredView";
import { matchesProcessPatternSet } from "../../ignoredProcessPatterns";
import { gameSecondsKeys } from "../../gameSeconds";
import {
  communityMetadataSearchUrl,
  mergeCommunityMetadataCandidates,
  type CommunityMetadataSearchOptions,
} from "../../communityMetadataSearch";
import {
  adjustmentSecondsFor,
  displayTotalSeconds,
} from "../../playtimeAdjustments";
import {
  CommunityApprovalBadge,
  EmulatorBadge,
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
  Modal,
  useContextMenu,
} from "../primitives";
import {
  initialMatchSelection,
  isSameGame,
  sortMatchCandidates,
} from "./matchCheckModel";
import { ReportWrongMatchDialog } from "../ReportWrongMatchDialog";
import type {
  CommunityGameSuggestionResponse,
  CommunityMetadataCandidate,
  CommunityMetadataSearchResponse,
  ContributionStatus,
  Game,
  GameSource,
  IdentifierFlagReason,
} from "@playcounter/shared";
import { TOUR_DEMO_GAME } from "../tour/tourDemoGame";
import { emitTourEvent, useTourDemo } from "../tour/TourUI";
import { compareMyGames, type MyGamesSortKey } from "../myGamesSort";
import {
  isTourDemoLibraryGame,
  type LibraryGameKind,
} from "../libraryGameKind";
import { CommunityLevelUpButton } from "../CommunityLevelUpButton";
import { XboxButtonGlyph } from "../XboxButtonGlyph";
import { launchErrorMessage, launchTargetsForGame } from "../../gameLaunch";
import { currentPlatform } from "../../platform";

type SortKey = MyGamesSortKey;
type ViewMode = "grid" | "list";

const sortOptions: Array<{ key: SortKey; label: string }> = [
  { key: "recent", label: "Last played" },
  { key: "playtime", label: "Most played" },
  { key: "name", label: "Name" },
  { key: "sessions", label: "Sessions" },
];

const GTA_V_TOUR_COVER =
  "https://images.igdb.com/igdb/image/upload/t_cover_big/co2lbd.webp";

type GameSummary = {
  kind: LibraryGameKind;
  gameId: number;
  igdbId?: number;
  name: string;
  coverUrl: string;
  source: GameSource | null;
  sources: GameSource[];
  aliases: GameAliasRef[];
  communitySuggestionId?: number;
  communitySuggestionVerified?: boolean;
  communitySuggestionStatus?: ContributionStatus;
  communitySuggestionNote?: string;
  communitySuggestionExeName?: string;
  communityUpgradeExeName?: string;
  communityUpgradeGameName?: string;
  totalSeconds: number;
  sessionSeconds: number;
  archivedSeconds: number;
  adjustmentSeconds: number;
  recordedSeconds: number;
  sessionCount: number;
  historyGameKey: string | null;
  lastPlayedAt: string;
  activeStartedAt?: string;
  exeNames: string[];
  emulatorLabels: string[];
  emulatorIds: string[];
};

type PendingRemoval = {
  gameId: number;
  source: GameSource | null;
  name: string;
  aliases: GameAliasRef[];
} | null;

type PendingStopTracking = {
  gameId: number;
  source: GameSource;
  name: string;
  exeNames: string[];
  emulatorLabels: string[];
  sessionCount: number;
  aliases: GameAliasRef[];
} | null;

function makeTourDemoGame(
  addedSeconds: number,
  addedSessions: number,
  showSourceBadges: boolean,
  source: GameSource | null = null,
): GameSummary {
  const totalSeconds = 7_200 + addedSeconds;
  return {
    kind: "tour-demo",
    gameId: TOUR_DEMO_GAME.gameId,
    name: TOUR_DEMO_GAME.name,
    coverUrl: TOUR_DEMO_GAME.coverUrl,
    source,
    sources: showSourceBadges
      ? ["community", "igdb", "custom"]
      : source
        ? [source]
        : [],
    aliases: [],
    totalSeconds,
    sessionSeconds: totalSeconds,
    archivedSeconds: 0,
    adjustmentSeconds: 0,
    recordedSeconds: totalSeconds,
    sessionCount: 3 + addedSessions,
    historyGameKey: null,
    lastPlayedAt: new Date().toISOString(),
    exeNames: [TOUR_DEMO_GAME.exeName],
    emulatorLabels: [],
    emulatorIds: [],
  };
}

function makeCoreTourDemoGames(): GameSummary[] {
  const now = Date.now();
  return [
    {
      kind: "tour-demo",
      gameId: TOUR_DEMO_GAME.gameId,
      name: TOUR_DEMO_GAME.name,
      coverUrl: TOUR_DEMO_GAME.coverUrl,
      source: "community",
      sources: ["community"],
      aliases: [],
      totalSeconds: 894_720,
      sessionSeconds: 894_720,
      archivedSeconds: 0,
      adjustmentSeconds: 0,
      recordedSeconds: 894_720,
      sessionCount: 127,
      historyGameKey: null,
      lastPlayedAt: new Date(now - 3_600_000).toISOString(),
      exeNames: [TOUR_DEMO_GAME.exeName],
      emulatorLabels: [],
      emulatorIds: [],
    },
    {
      kind: "tour-demo",
      gameId: -2,
      name: "Grand Theft Auto V",
      coverUrl: GTA_V_TOUR_COVER,
      source: "igdb",
      sources: ["igdb"],
      aliases: [],
      totalSeconds: 310_320,
      sessionSeconds: 310_320,
      archivedSeconds: 0,
      adjustmentSeconds: 0,
      recordedSeconds: 310_320,
      sessionCount: 46,
      historyGameKey: null,
      lastPlayedAt: new Date(now - 86_400_000).toISOString(),
      exeNames: ["GTA5.exe"],
      emulatorLabels: [],
      emulatorIds: [],
    },
  ];
}

function matchedEntriesByGame(
  entries: ExeCacheEntry[],
  resolveIgdbId: ReturnType<typeof createGameIdentityResolver>,
) {
  const byGameId = new Map<string, ExeCacheEntry[]>();

  for (const entry of entries) {
    if (entry.state !== "matched" || !entry.gameId) continue;
    const key = resolvedCanonicalGameKey(
      {
        gameId: entry.gameId,
        source: entry.source,
        igdbId: entry.igdbId,
        gameName: entry.gameName,
        coverUrl: entry.coverUrl,
      },
      resolveIgdbId,
    );
    const grouped = byGameId.get(key) ?? [];
    grouped.push(entry);
    byGameId.set(key, grouped);
  }

  return byGameId;
}

function fallbackGameName(exeName: string) {
  return exeName.replace(/\.exe$/i, "");
}

function sourceRank(source: GameSource | null | undefined) {
  return source === "igdb" ? 0 : source === "community" ? 1 : 2;
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
  const tourDemo = useTourDemo();
  const [demoPlaytime, setDemoPlaytime] = useState({
    addedSeconds: 0,
    addedSessions: 0,
  });
  const [pendingRemoval, setPendingRemoval] = useState<PendingRemoval>(null);
  const [pendingStopTracking, setPendingStopTracking] =
    useState<PendingStopTracking>(null);
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("recent");
  const [view, setView] = useState<ViewMode>("grid");
  const sessions = useAppStore((state) => state.recentSessions);
  const activeSessions = useAppStore((state) => state.activeSessions);
  const archivedGameSeconds = useAppStore((state) => state.archivedGameSeconds);
  const playtimeAdjustments = useAppStore((state) => state.playtimeAdjustments);
  const exeCache = useAppStore((state) => state.exeCache);
  const hydratedGameMetadata = useAppStore((state) => state.gameMetadata);
  const showDurationDays = useAppStore(
    (state) => state.settings.showDurationDays,
  );
  const gameLaunchingEnabled = useAppStore(
    (state) => state.settings.gameLaunchingEnabled === true,
  );
  const userIgnoredProcesses = useAppStore(
    (state) => state.userIgnoredProcesses,
  );
  const blacklist = useAppStore((state) => state.blacklist);
  const addToast = useAppStore((state) => state.addToast);
  const resolveIgdbId = useMemo(
    () => createGameIdentityResolver(hydratedGameMetadata, exeCache),
    [exeCache, hydratedGameMetadata],
  );

  useEffect(() => {
    void hydrateGameMetadata(
      sessions.map((session) => ({
        gameId: session.gameId,
        source: session.source,
      })),
    );
  }, [sessions]);

  useEffect(() => {
    setDemoPlaytime({ addedSeconds: 0, addedSessions: 0 });
  }, [tourDemo.active, tourDemo.resetToken]);

  useEffect(() => {
    if (tourDemo.active || !gameLaunchingEnabled) return;
    void verifyLaunchTargetsThrottled("my-games");
  }, [gameLaunchingEnabled, tourDemo.active]);

  const games = useMemo(() => {
    const ignoredExeNames = new Set([...userIgnoredProcesses, ...blacklist]);
    const isIgnored = (exeName: string) =>
      matchesProcessPatternSet(exeName, ignoredExeNames);
    const metadata = matchedEntriesByGame(
      [...exeCache.values()].filter((entry) => !isIgnored(entry.exeName)),
      resolveIgdbId,
    );
    const summaries = new Map<string, GameSummary>();

    const addAlias = (
      summary: GameSummary,
      gameId: number,
      source: GameSource | null | undefined,
    ) => {
      const normalizedSource = source ?? null;
      if (
        !summary.aliases.some(
          (alias) =>
            alias.gameId === gameId && alias.source === normalizedSource,
        )
      ) {
        summary.aliases.push({ gameId, source: normalizedSource });
      }
      if (source && !summary.sources.includes(source)) {
        summary.sources.push(source);
        summary.sources.sort(
          (left, right) => sourceRank(left) - sourceRank(right),
        );
      }
      const primary = [...summary.aliases].sort(
        (left, right) => sourceRank(left.source) - sourceRank(right.source),
      )[0];
      if (primary) {
        summary.gameId = primary.gameId;
        summary.source = primary.source;
      }
    };

    const mergeEntry = (summary: GameSummary, entry: ExeCacheEntry) => {
      if (entry.gameId !== undefined) {
        addAlias(summary, entry.gameId, entry.source);
      }
      summary.igdbId ??= entry.igdbId;
      if (!summary.exeNames.includes(entry.exeName)) {
        if (entry.source === summary.source)
          summary.exeNames.unshift(entry.exeName);
        else summary.exeNames.push(entry.exeName);
      }
      summary.communitySuggestionId ??= entry.communitySuggestionId;
      summary.communitySuggestionVerified ??= entry.communitySuggestionVerified;
      summary.communitySuggestionStatus ??= entry.communitySuggestionStatus;
      summary.communitySuggestionNote ??= entry.communitySuggestionNote;
      if (canSwitchApprovedSuggestionToCommunity(entry)) {
        summary.communitySuggestionExeName ??= entry.exeName;
      }
      if (entry.communityUpgradeGame) {
        summary.communityUpgradeExeName ??= entry.exeName;
        summary.communityUpgradeGameName ??= entry.communityUpgradeGame.name;
      }
    };

    const createSummary = (params: {
      gameId: number;
      igdbId?: number;
      name: string;
      coverUrl: string;
      source?: GameSource | null;
      lastPlayedAt: string;
      exeName: string;
      historyGameKey?: string | null;
    }): GameSummary => ({
      kind: "tracked",
      gameId: params.gameId,
      igdbId: params.igdbId,
      name: params.name,
      coverUrl: params.coverUrl,
      source: params.source ?? null,
      sources: params.source ? [params.source] : [],
      aliases: [{ gameId: params.gameId, source: params.source ?? null }],
      totalSeconds: 0,
      sessionSeconds: 0,
      archivedSeconds: 0,
      adjustmentSeconds: 0,
      recordedSeconds: 0,
      sessionCount: 0,
      historyGameKey: params.historyGameKey ?? null,
      lastPlayedAt: params.lastPlayedAt,
      exeNames: [params.exeName],
      emulatorLabels: [],
      emulatorIds: [],
    });

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
      const resolvedIgdbId = resolveIgdbId(
        session.gameId,
        resolvedSource,
        session.gameName,
      );
      const igdbId =
        resolvedIgdbId === null
          ? undefined
          : (session.igdbId ??
            hydratedMeta?.igdbId ??
            resolvedIgdbId ??
            undefined);
      const summaryKey = resolvedCanonicalGameKey({
        gameId: session.gameId,
        source: resolvedSource,
        igdbId,
        gameName: session.gameName,
        coverUrl: session.coverUrl,
      });
      const gameEntries = metadata.get(summaryKey) ?? [];
      const gameMeta =
        gameEntries.find(
          (entry) =>
            entry.exeName.toLowerCase() === session.exeName.toLowerCase(),
        ) ?? gameEntries[0];
      let existing = summaries.get(summaryKey);
      const endedOrStartedAt = session.endedAt ?? session.startedAt;

      if (!existing) {
        existing = createSummary({
          gameId: session.gameId,
          igdbId,
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
          source: resolvedSource,
          lastPlayedAt: endedOrStartedAt,
          exeName: session.exeName,
          historyGameKey: summaryKey,
        });
        summaries.set(summaryKey, existing);
      }
      addAlias(existing, session.gameId, session.source);
      if (session.source !== resolvedSource) {
        addAlias(existing, session.gameId, resolvedSource);
      }
      for (const entry of gameEntries) mergeEntry(existing, entry);
      existing.sessionSeconds += session.durationSeconds ?? 0;
      existing.sessionCount += 1;
      existing.historyGameKey = summaryKey;
      existing.communitySuggestionId ??=
        session.communitySuggestionId ?? gameMeta?.communitySuggestionId;
      existing.communitySuggestionVerified ??=
        session.communitySuggestionVerified ??
        gameMeta?.communitySuggestionVerified;
      existing.communitySuggestionStatus ??=
        session.communitySuggestionStatus ??
        gameMeta?.communitySuggestionStatus;
      existing.communitySuggestionNote ??=
        session.communitySuggestionNote ?? gameMeta?.communitySuggestionNote;
      if (
        canSwitchApprovedSuggestionToCommunity({
          source: session.source ?? gameMeta?.source,
          communitySuggestionId:
            session.communitySuggestionId ?? gameMeta?.communitySuggestionId,
          communitySuggestionVerified:
            session.communitySuggestionVerified ??
            gameMeta?.communitySuggestionVerified,
        })
      ) {
        existing.communitySuggestionExeName ??= session.exeName;
      }
      if (Date.parse(endedOrStartedAt) > Date.parse(existing.lastPlayedAt)) {
        existing.lastPlayedAt = endedOrStartedAt;
      }
      if (!existing.exeNames.includes(session.exeName)) {
        existing.exeNames.push(session.exeName);
      }
      if (session.emulator) {
        const label = `${session.emulator.label} · ${session.emulator.display}`;
        if (!existing.emulatorLabels.includes(label)) {
          existing.emulatorLabels.push(label);
        }
        if (!existing.emulatorIds.includes(session.emulator.emulatorId)) {
          existing.emulatorIds.push(session.emulator.emulatorId);
        }
      }
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
      const resolvedIgdbId = resolveIgdbId(
        activeSession.gameId,
        resolvedSource,
        activeSession.gameName,
      );
      const igdbId =
        resolvedIgdbId === null
          ? undefined
          : (activeSession.igdbId ??
            hydratedMeta?.igdbId ??
            resolvedIgdbId ??
            undefined);
      const summaryKey = resolvedCanonicalGameKey({
        gameId: activeSession.gameId,
        source: resolvedSource,
        igdbId,
        gameName: activeSession.gameName,
        coverUrl: activeSession.coverUrl,
      });
      let existing = summaries.get(summaryKey);

      if (!existing) {
        existing = createSummary({
          gameId: activeSession.gameId,
          igdbId,
          name: activeSession.gameName || hydratedMeta?.name || "",
          coverUrl: activeSession.coverUrl || hydratedMeta?.coverUrl || "",
          source: resolvedSource,
          lastPlayedAt: activeSession.checkpointedAt,
          exeName: activeSession.exeName,
        });
        summaries.set(summaryKey, existing);
      }
      addAlias(existing, activeSession.gameId, activeSession.source);
      if (activeSession.source !== resolvedSource) {
        addAlias(existing, activeSession.gameId, resolvedSource);
      }
      for (const entry of metadata.get(summaryKey) ?? []) {
        mergeEntry(existing, entry);
      }
      existing.sessionSeconds += activeSeconds;
      existing.lastPlayedAt = activeSession.checkpointedAt;
      if (
        existing.activeStartedAt === undefined ||
        Date.parse(activeSession.startedAt) >
          Date.parse(existing.activeStartedAt)
      ) {
        existing.activeStartedAt = activeSession.startedAt;
      }
      existing.communitySuggestionId ??= activeSession.communitySuggestionId;
      existing.communitySuggestionVerified ??=
        activeSession.communitySuggestionVerified;
      existing.communitySuggestionStatus ??=
        activeSession.communitySuggestionStatus;
      existing.communitySuggestionNote ??=
        activeSession.communitySuggestionNote;
      if (canSwitchApprovedSuggestionToCommunity(activeSession)) {
        existing.communitySuggestionExeName ??= activeSession.exeName;
      }
      if (!existing.exeNames.includes(activeSession.exeName)) {
        existing.exeNames.push(activeSession.exeName);
      }
      if (activeSession.emulator) {
        const label = `${activeSession.emulator.label} · ${activeSession.emulator.display}`;
        if (!existing.emulatorLabels.includes(label)) {
          existing.emulatorLabels.push(label);
        }
        if (!existing.emulatorIds.includes(activeSession.emulator.emulatorId)) {
          existing.emulatorIds.push(activeSession.emulator.emulatorId);
        }
      }
    }

    for (const [summaryKey, gameEntries] of metadata) {
      for (const gameMeta of gameEntries) {
        if (gameMeta.gameId === undefined) continue;
        let summary = summaries.get(summaryKey);
        if (!summary) {
          summary = createSummary({
            gameId: gameMeta.gameId,
            igdbId: gameMeta.igdbId,
            name: gameMeta.gameName ?? fallbackGameName(gameMeta.exeName),
            coverUrl: gameMeta.coverUrl ?? "",
            source: gameMeta.source,
            lastPlayedAt: gameMeta.lastCheckedAt,
            exeName: gameMeta.exeName,
          });
          summaries.set(summaryKey, summary);
        }
        mergeEntry(summary, gameMeta);
      }
    }

    const consumedKeys = new Set<string>();
    for (const summary of summaries.values()) {
      const keys = gameSecondsKeys(summary.aliases).filter((key) => {
        if (consumedKeys.has(key)) return false;
        consumedKeys.add(key);
        return true;
      });
      summary.archivedSeconds = keys.reduce(
        (total, key) => total + Math.max(0, archivedGameSeconds[key] ?? 0),
        0,
      );
      summary.adjustmentSeconds = adjustmentSecondsFor(
        playtimeAdjustments,
        keys,
      );
      summary.recordedSeconds =
        summary.sessionSeconds + summary.archivedSeconds;
      summary.totalSeconds = displayTotalSeconds(
        summary.recordedSeconds,
        summary.adjustmentSeconds,
      );
    }

    return [...summaries.values()].sort(
      (left, right) =>
        Date.parse(right.lastPlayedAt) - Date.parse(left.lastPlayedAt),
    );
  }, [
    activeSessions,
    archivedGameSeconds,
    blacklist,
    exeCache,
    hydratedGameMetadata,
    playtimeAdjustments,
    resolveIgdbId,
    sessions,
    userIgnoredProcesses,
  ]);

  const displayedGames = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = needle
      ? games.filter(
          (game) =>
            game.name.toLowerCase().includes(needle) ||
            game.emulatorLabels.some((label) =>
              label.toLowerCase().includes(needle),
            ),
        )
      : games;

    const sorted = [...filtered];
    sorted.sort((left, right) => compareMyGames(left, right, sortKey));
    return sorted;
  }, [games, query, sortKey]);
  const demoGames = useMemo(() => {
    if (!tourDemo.active) return [];
    if (tourDemo.tourId === "core") return makeCoreTourDemoGames();
    return [
      makeTourDemoGame(
        demoPlaytime.addedSeconds,
        demoPlaytime.addedSessions,
        tourDemo.tourId === "source-badges",
        tourDemo.tourId === "game-actions" ? "community" : null,
      ),
    ];
  }, [demoPlaytime, tourDemo.active, tourDemo.tourId]);
  const isCoreTourDemo = tourDemo.active && tourDemo.tourId === "core";
  const libraryGames = isCoreTourDemo ? demoGames : [...demoGames, ...games];
  const visibleGames = isCoreTourDemo
    ? demoGames
    : [...demoGames, ...displayedGames];

  const demoNotice = () =>
    addToast({
      tone: "info",
      title: "Tutorial game",
      detail: "The sample exists only for this guide - nothing was saved.",
    });

  return (
    <div className="grid gap-5">
      {libraryGames.length === 0 ? (
        <Panel className="px-4 py-12 text-center text-sm text-text-muted">
          No discovered games have completed a session yet.
        </Panel>
      ) : (
        <>
          <Panel dataTour="games-toolbar" className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-4">
              <div>
                <h2 className="font-semibold text-text">Library</h2>
                <p className="mt-1 text-sm text-text-muted">
                  {visibleGames.length} of {libraryGames.length} tracked games
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

          {visibleGames.length === 0 ? (
            <Panel className="px-4 py-12 text-center text-sm text-text-muted">
              No games match &ldquo;{query}&rdquo;.
            </Panel>
          ) : (
            <div
              data-tour={isCoreTourDemo ? "core-library-demo" : undefined}
              className={
                view === "grid"
                  ? "grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-[repeat(auto-fill,minmax(216px,1fr))]"
                  : "grid gap-3"
              }
            >
              {visibleGames.map((game) => {
                const isDemo = isTourDemoLibraryGame(game);
                return (
                  <GameLibraryCard
                    key={
                      isDemo
                        ? `tour-demo-${game.gameId}-${tourDemo.resetToken}`
                        : game.igdbId !== undefined
                          ? `igdb#${game.igdbId}`
                          : `${game.source ?? "unknown"}:${game.gameId}`
                    }
                    game={game}
                    demo={isDemo}
                    onDemoPlaytimeLogged={
                      isDemo && tourDemo.tourId === "log-playtime"
                        ? (durationSeconds) =>
                            setDemoPlaytime((current) => ({
                              addedSeconds:
                                current.addedSeconds + durationSeconds,
                              addedSessions: current.addedSessions + 1,
                            }))
                        : undefined
                    }
                    showDurationDays={showDurationDays}
                    view={view}
                    onRemove={
                      isDemo
                        ? demoNotice
                        : () =>
                            setPendingRemoval({
                              gameId: game.gameId,
                              source: game.source,
                              name: game.name,
                              aliases: game.aliases,
                            })
                    }
                    onStopTracking={
                      isDemo
                        ? undefined
                        : game.source
                          ? () =>
                              setPendingStopTracking({
                                gameId: game.gameId,
                                source: game.source!,
                                name: game.name,
                                exeNames: game.exeNames,
                                emulatorLabels: game.emulatorLabels,
                                sessionCount: game.sessionCount,
                                aliases: game.aliases,
                              })
                          : undefined
                    }
                  />
                );
              })}
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
              pendingRemoval.aliases,
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
              game.aliases,
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
  onDemoPlaytimeLogged,
  demo = false,
}: {
  game: GameSummary;
  showDurationDays: boolean;
  view: ViewMode;
  onRemove: () => void;
  onStopTracking?: () => void;
  onDemoPlaytimeLogged?: (durationSeconds: number) => void;
  demo?: boolean;
}) {
  const averageSeconds = Math.round(
    game.sessionSeconds / Math.max(1, game.sessionCount),
  );
  const isList = view === "list";
  const addToast = useAppStore((state) => state.addToast);
  const setActiveView = useAppStore((state) => state.setActiveView);
  const setHistoryQuery = useAppStore((state) => state.setHistoryQuery);
  const setHistoryGameKey = useAppStore((state) => state.setHistoryGameKey);
  const showDemoContextMenu = useAppStore(
    (state) =>
      (state.activeTour?.tourId === "log-playtime" &&
        state.activeTour.stepIndex === 5) ||
      (state.activeTour?.tourId === "game-actions" &&
        state.activeTour.stepIndex >= 2) ||
      (state.activeTour?.tourId === "launch-games" &&
        state.activeTour.stepIndex === 4),
  );
  const activeTour = useAppStore((state) => state.activeTour);
  const contextMenu = useContextMenu();
  const cardRef = useRef<HTMLElement | null>(null);
  const coverInputRef = useRef<HTMLInputElement | null>(null);
  const [coverBusy, setCoverBusy] = useState(false);
  const [showAddPlaytime, setShowAddPlaytime] = useState(false);
  const [showAdjustPlaytime, setShowAdjustPlaytime] = useState(false);
  const [showMatchCheck, setShowMatchCheck] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const apiEndpoint = useAppStore((state) => state.settings.apiEndpoint);
  const installUuid = useAppStore((state) => state.installUuid);
  const isOffline = useIsOffline();
  const [shareOpen, setShareOpen] = useState(false);
  const [shareSearch, setShareSearch] = useState("");
  const [shareCandidates, setShareCandidates] = useState<
    CommunityMetadataCandidate[]
  >([]);
  const [shareHasMore, setShareHasMore] = useState(false);
  const [shareNextOffset, setShareNextOffset] = useState(0);
  const [shareSelection, setShareSelection] =
    useState<CommunityMetadataCandidate | null>(null);
  const [shareState, setShareState] = useState<
    "idle" | "loading" | "loading-more" | "saving" | "saved" | "error"
  >("idle");
  const [shareMessage, setShareMessage] = useState("");
  const [showConvert, setShowConvert] = useState(false);
  const [convertName, setConvertName] = useState("");
  const [showRename, setShowRename] = useState(false);
  const [renameName, setRenameName] = useState("");
  const [launching, setLaunching] = useState(false);

  useEffect(() => {
    if (!demo) return;
    if (!showDemoContextMenu) {
      contextMenu.close();
      return;
    }
    const frame = requestAnimationFrame(() => {
      const rect = cardRef.current?.getBoundingClientRect();
      if (!rect) return;
      contextMenu.openAt({
        x: rect.left + rect.width / 2,
        y: rect.top + Math.min(rect.height / 2, 160),
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [demo, showDemoContextMenu]);
  const hasActiveSession = useAppStore((state) =>
    state.activeSessions.some((session) =>
      game.aliases.some(
        (alias) =>
          session.gameId === alias.gameId &&
          (session.source ?? null) === alias.source,
      ),
    ),
  );
  const launchTargets = useAppStore((state) => state.launchTargets);
  const exeCache = useAppStore((state) => state.exeCache);
  const launcherEnabled = useAppStore(
    (state) => state.settings.gameLaunchingEnabled === true,
  );
  const canLaunchExecutables =
    currentPlatform() === "windows" && launcherEnabled;
  const launchTourDemo = demo && activeTour?.tourId === "launch-games";
  const canConfigureLaunch =
    canLaunchExecutables &&
    game.exeNames.some((exeName) => /\.exe$/i.test(exeName));
  const ownedLaunchTargets = useMemo(
    () =>
      launchTargetsForGame({
        exeNames: game.exeNames,
        aliases: game.aliases,
        launchTargets,
        exeCache,
      }),
    [exeCache, game.aliases, game.exeNames, launchTargets],
  );
  const primaryLaunchTarget = ownedLaunchTargets[0];
  const controllerNavigable = !demo && canLaunchExecutables;
  const canEditCover = game.source === "custom";
  const primaryExeName = game.exeNames[0];
  const primaryExeEntry = primaryExeName
    ? exeCache.get(primaryExeName.toLowerCase())
    : undefined;
  const canSuggestToCommunity = canSuggestCustomGameToCommunity({
    source: primaryExeEntry?.source ?? game.source,
    exeName: primaryExeName,
    communitySuggestionId:
      primaryExeEntry?.communitySuggestionId ?? game.communitySuggestionId,
    communitySuggestionStatus:
      primaryExeEntry?.communitySuggestionStatus ??
      game.communitySuggestionStatus,
  });
  // Shown in place of the title while hovering the card.
  const exeLabel =
    game.exeNames.filter(Boolean).join(", ") || game.emulatorLabels.join(", ");

  const demoNotice = () =>
    addToast({
      tone: "info",
      title: "Tutorial game",
      detail: "The sample exists only for this guide - nothing was saved.",
    });

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

  const handleApplyMatch = (match: Game, pendingCommunity: boolean) => {
    const exeName = game.exeNames[0];
    if (!exeName) return;
    if (pendingCommunity && match.source === "community") {
      suggestTrackedGameToCommunity(
        exeName,
        match.name,
        match.coverUrl,
        match.id,
        false,
        match.igdbId,
      );
    } else {
      applyKnownGameMatch(exeName, match);
    }
    addToast({
      tone: "success",
      title: "Match applied",
      detail: `${game.name} is now tracked as ${match.name}.`,
    });
    setShowMatchCheck(false);
  };

  async function handleNegativeReport() {
    const exeName = game.exeNames[0];
    if (!exeName) return;
    setReportOpen(false);
    setShowMatchCheck(false);
    const outcome = await reportNegativeMatch(exeName);
    if (!outcome.localBlockApplied) {
      addToast({
        tone: "error",
        title: `Could not ignore ${exeName}`,
        detail: "PlayCounter could not ignore it on this PC. Try again.",
      });
      return;
    }
    if (!outcome.ignoreFileUpdated) {
      addToast({
        tone: "error",
        title: `${exeName} ignored`,
        detail:
          "It comes back when you restart PlayCounter - the ignore file could not be saved.",
      });
      return;
    }
    if (outcome.report === "failed" || outcome.report === "skipped") {
      addToast({
        tone: "info",
        title: "Fixed on this PC",
        detail: "The community report could not be sent.",
      });
      return;
    }
    addToast({
      tone: "success",
      title: "Wrong match reported",
      detail:
        outcome.report === "already_reviewed"
          ? `${exeName} is no longer tracked here. Your earlier report was already reviewed.`
          : `${exeName} is no longer tracked here. Your report is queued for review.`,
    });
  }

  function closeShare() {
    setShareOpen(false);
    setShareSearch("");
    setShareCandidates([]);
    setShareHasMore(false);
    setShareNextOffset(0);
    setShareSelection(null);
    setShareState("idle");
    setShareMessage("");
  }

  async function searchShareCandidatePage(
    offset: number,
    append: boolean,
    options: CommunityMetadataSearchOptions,
  ) {
    const query = shareSearch.trim();
    if (query.length < 2 || isOffline) return;

    setShareState(append ? "loading-more" : "loading");
    setShareMessage("");
    if (!append) setShareCandidates([]);
    try {
      const response = await fetch(
        communityMetadataSearchUrl(apiEndpoint, query, offset, options),
      );
      if (!response.ok)
        throw new Error(`${response.status} ${response.statusText}`);
      const body = (await response.json()) as CommunityMetadataSearchResponse;
      const candidates = append
        ? mergeCommunityMetadataCandidates(shareCandidates, body.candidates)
        : body.candidates;
      setShareCandidates(candidates);
      setShareHasMore(Boolean(body.hasMore));
      setShareNextOffset(body.nextOffset ?? 0);
      setShareMessage(
        candidates.length > 0
          ? body.hasMore
            ? `${candidates.length} matches shown. Load more to keep looking.`
            : `All ${candidates.length} matches shown. Pick the right game.`
          : "No matching games found.",
      );
      setShareState("idle");
    } catch (error) {
      setShareState("error");
      setShareMessage(formatError(error));
    }
  }

  function searchShareCandidates(options: CommunityMetadataSearchOptions) {
    return searchShareCandidatePage(0, false, options);
  }

  function loadMoreShareCandidates(options: CommunityMetadataSearchOptions) {
    if (!shareHasMore) return;
    return searchShareCandidatePage(shareNextOffset, true, options);
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
          igdbId: shareSelection.igdbId,
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
      if (result.rejected) {
        if (result.id === undefined) throw new Error("Unexpected response");
        suggestTrackedGameToCommunity(
          exeName,
          shareSelection.name,
          shareSelection.coverUrl,
          result.id,
          false,
          shareSelection.igdbId,
        );
        markCommunitySuggestionRejected(exeName, result.reviewNote);
        closeShare();
        addToast({
          tone: "info",
          title: "Suggestion already reviewed",
          detail: result.reviewNote ?? "This suggestion was not accepted.",
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
        shareSelection.igdbId,
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
    if (demo) return demoNotice();
    navigator.clipboard.writeText(game.exeNames[0]);
    addToast({
      tone: "success",
      title: "Copied",
      detail: "File name copied to clipboard.",
    });
    contextMenu.close();
  };

  const handleCopyName = () => {
    if (demo) return demoNotice();
    navigator.clipboard.writeText(game.name);
    addToast({
      tone: "success",
      title: "Copied",
      detail: "Game name copied to clipboard.",
    });
    contextMenu.close();
  };

  const handleShowHistory = () => {
    if (demo) return demoNotice();
    setHistoryQuery(game.name);
    setHistoryGameKey(game.historyGameKey);
    setActiveView("history");
    contextMenu.close();
  };

  const handleAddPlaytime = (durationSeconds: number, endedAt: string) => {
    if (demo) {
      setShowAddPlaytime(false);
      onDemoPlaytimeLogged?.(durationSeconds);
      addToast({
        tone: "success",
        title: "Tutorial session added",
        detail: `${formatDuration(durationSeconds, showDurationDays)} was added to the sample. It now shows ${formatDuration(game.totalSeconds + durationSeconds, showDurationDays)} across ${game.sessionCount + 1} sessions. Nothing was saved.`,
      });
      emitTourEvent("mygames.demo-session-logged");
      return;
    }
    addManualSession({
      gameId: game.gameId,
      igdbId: game.igdbId,
      gameName: game.name,
      coverUrl: game.coverUrl,
      source: game.source,
      exeName: game.exeNames[0] ?? "",
      durationSeconds,
      endedAt,
      communitySuggestionId: game.communitySuggestionId,
      communitySuggestionVerified: game.communitySuggestionVerified,
      communitySuggestionStatus: game.communitySuggestionStatus,
      communitySuggestionNote: game.communitySuggestionNote,
    });
    addToast({
      tone: "success",
      title: "Playtime added",
      detail: `${formatDuration(durationSeconds, showDurationDays)} added to ${game.name}.`,
    });
    setShowAddPlaytime(false);
  };

  const handleAdjustPlaytime = (targetSeconds: number) => {
    if (demo) {
      setShowAdjustPlaytime(false);
      demoNotice();
      return;
    }
    try {
      setGamePlaytime({
        gameId: game.gameId,
        igdbId: game.igdbId,
        gameName: game.name,
        coverUrl: game.coverUrl,
        source: game.source,
        exeName: game.exeNames[0] ?? "",
        targetSeconds,
        communitySuggestionId: game.communitySuggestionId,
        communitySuggestionVerified: game.communitySuggestionVerified,
        communitySuggestionStatus: game.communitySuggestionStatus,
        communitySuggestionNote: game.communitySuggestionNote,
        aliases: game.aliases,
      });
      addToast({
        tone: "success",
        title: "Playtime adjusted",
        detail: `${game.name} now has ${formatDuration(targetSeconds, showDurationDays)} of playtime. History was not changed.`,
      });
      setShowAdjustPlaytime(false);
    } catch (error) {
      addToast({
        tone: "error",
        title: "Could not adjust playtime",
        detail: formatError(error),
      });
    }
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

  function openDemoMenu(element: HTMLElement) {
    const card = element.closest("article") ?? element;
    const rect = card.getBoundingClientRect();
    contextMenu.openAt({
      x: rect.left + rect.width / 2,
      y: rect.top + Math.min(rect.height / 2, 160),
    });
  }

  async function handleLaunch(target = primaryLaunchTarget) {
    contextMenu.close();
    if (launchTourDemo) {
      emitTourEvent("mygames.demo-launch-attempted");
      demoNotice();
      return;
    }
    if (!target) {
      addToast({
        tone: "info",
        title: "No launch file saved",
        detail: canConfigureLaunch
          ? `Start ${game.name} normally once, or set its launch file from the right-click menu.`
          : `${game.name} does not have a Windows .exe that PlayCounter can launch directly. Use its normal launcher.`,
      });
      return;
    }
    if (hasActiveSession) {
      addToast({
        tone: "info",
        title: `${game.name} is already running`,
        detail: "PlayCounter is already tracking this game.",
      });
      return;
    }
    if (launching) {
      addToast({
        tone: "info",
        title: `${game.name} is starting`,
        detail: "PlayCounter already sent the launch request.",
      });
      return;
    }
    setLaunching(true);
    try {
      const outcome = await launchGame(target);
      if (outcome === "busy") {
        addToast({
          tone: "info",
          title: `${game.name} is starting`,
          detail: "PlayCounter already sent the launch request.",
        });
      }
    } catch (error) {
      const message = launchErrorMessage(error, game.name);
      addToast({ tone: "error", ...message });
    } finally {
      setLaunching(false);
    }
  }

  async function handleSetLaunchFile() {
    contextMenu.close();
    try {
      const target = await chooseLaunchTarget(game.exeNames, {
        gameId: game.gameId,
        source: game.source,
      });
      if (!target) return;
      addToast({
        tone: "success",
        title: "Launch file saved",
        detail: `${game.name} can now be started from My Games.`,
      });
    } catch (error) {
      addToast({
        tone: "error",
        title: "Launch file not set",
        detail: formatError(error),
      });
    }
  }

  function handleForgetLaunchFile() {
    contextMenu.close();
    if (!primaryLaunchTarget) return;
    forgetLaunchTarget(primaryLaunchTarget.exeName);
    addToast({
      tone: "info",
      title: "Launch file forgotten",
      detail: `Start ${game.name} once, or set its launch file again.`,
    });
  }

  const renderContextMenu = () => (
    <ContextMenu
      open={contextMenu.open}
      position={contextMenu.position}
      onClose={contextMenu.close}
      dataTour={demo ? "demo-context-menu" : undefined}
      focusFirstItem={demo}
    >
      {launchTourDemo ? (
        <>
          <ContextMenuItem
            dataTour="demo-menu-launch-file"
            icon={FolderSearch}
            onClick={demoNotice}
          >
            Set or change launch file…
          </ContextMenuItem>
          <ContextMenuSeparator />
        </>
      ) : null}
      {!demo && canConfigureLaunch ? (
        <>
          {ownedLaunchTargets.length > 0
            ? ownedLaunchTargets.map((target) => (
                <ContextMenuItem
                  key={target.exeName.toLowerCase()}
                  icon={Play}
                  title={
                    hasActiveSession
                      ? "Already running"
                      : launching
                        ? "Starting…"
                        : undefined
                  }
                  onClick={() => void handleLaunch(target)}
                >
                  {ownedLaunchTargets.length > 1
                    ? `Play (${target.exeName})`
                    : "Play"}
                </ContextMenuItem>
              ))
            : null}
          <ContextMenuItem
            icon={FolderSearch}
            onClick={() => void handleSetLaunchFile()}
          >
            {ownedLaunchTargets.length > 0
              ? "Change launch file…"
              : "Set launch file…"}
          </ContextMenuItem>
          {ownedLaunchTargets.length > 0 ? (
            <ContextMenuItem icon={Trash2} onClick={handleForgetLaunchFile}>
              Forget launch file
            </ContextMenuItem>
          ) : null}
          <ContextMenuSeparator />
        </>
      ) : null}
      <ContextMenuItem
        dataTour={demo ? "demo-menu-show-history" : undefined}
        icon={History}
        onClick={handleShowHistory}
      >
        Show History
      </ContextMenuItem>
      <ContextMenuItem
        dataTour={demo ? "demo-menu-log-session" : undefined}
        icon={ClockPlus}
        onClick={() => {
          contextMenu.close();
          setShowAddPlaytime(true);
        }}
      >
        Log missed session
      </ContextMenuItem>
      <ContextMenuItem
        dataTour={demo ? "demo-menu-adjust-playtime" : undefined}
        icon={Clock3}
        onClick={() => {
          contextMenu.close();
          setShowAdjustPlaytime(true);
        }}
      >
        Adjust total playtime
      </ContextMenuItem>
      {game.source && game.exeNames[0] ? (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem
            dataTour={demo ? "demo-menu-check-matches" : undefined}
            icon={Search}
            onClick={() => {
              contextMenu.close();
              setShowMatchCheck(true);
            }}
          >
            Check for Matches
          </ContextMenuItem>
          {canSuggestToCommunity ? (
            <ContextMenuItem
              dataTour={demo ? "demo-menu-suggest-community" : undefined}
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
                dataTour={demo ? "demo-menu-report-match" : undefined}
                icon={Flag}
                onClick={() => {
                  contextMenu.close();
                  setReportOpen(true);
                }}
              >
                Report Wrong Match
              </ContextMenuItem>
              <ContextMenuItem
                dataTour={demo ? "demo-menu-convert-custom" : undefined}
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
            dataTour={demo ? "demo-menu-rename" : undefined}
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
            dataTour={demo ? "demo-menu-set-cover" : undefined}
            icon={ImagePlus}
            onClick={() => {
              contextMenu.close();
              coverInputRef.current?.click();
            }}
          >
            Set Cover
          </ContextMenuItem>
          <ContextMenuItem
            dataTour={demo ? "demo-menu-paste-cover" : undefined}
            icon={Clipboard}
            onClick={() => void handlePasteCover()}
          >
            Paste Cover
          </ContextMenuItem>
          {game.coverUrl ? (
            <ContextMenuItem
              dataTour={demo ? "demo-menu-delete-cover" : undefined}
              icon={Trash2}
              onClick={handleClearCover}
            >
              Delete Cover
            </ContextMenuItem>
          ) : null}
        </>
      ) : null}
      <ContextMenuSeparator />
      <ContextMenuItem
        dataTour={demo ? "demo-menu-copy-name" : undefined}
        icon={Copy}
        onClick={handleCopyName}
      >
        Copy Game Name
      </ContextMenuItem>
      <ContextMenuItem
        dataTour={demo ? "demo-menu-copy-exe" : undefined}
        icon={Copy}
        onClick={handleCopyExe}
      >
        Copy File Name
      </ContextMenuItem>
      <ContextMenuSeparator />
      {onStopTracking ? (
        <ContextMenuItem
          dataTour={demo ? "demo-menu-ignore" : undefined}
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
        dataTour={demo ? "demo-menu-remove" : undefined}
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

  const demoCardProps = demo
    ? {
        "data-tour": "demo-game-card",
      }
    : {};

  if (!isList) {
    return (
      <article
        ref={cardRef}
        {...contextMenu.props}
        {...demoCardProps}
        data-controller-item={controllerNavigable ? "game-card" : undefined}
        tabIndex={controllerNavigable ? -1 : undefined}
        aria-label={
          controllerNavigable
            ? `${game.name}, ${primaryLaunchTarget ? "press A to play" : "no launch file saved"}`
            : undefined
        }
        className="game-library-card group relative flex flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-raised transition-all duration-200 hover:-translate-y-1 hover:border-accent/50 hover:shadow-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg data-[controller-selected=true]:z-20 data-[controller-selected=true]:scale-[1.04] data-[controller-selected=true]:border-accent data-[controller-selected=true]:brightness-110 data-[controller-selected=true]:shadow-card-hover data-[controller-selected=true]:outline data-[controller-selected=true]:outline-2 data-[controller-selected=true]:outline-offset-[7px] data-[controller-selected=true]:outline-white/80 data-[controller-selected=true]:ring-[7px] data-[controller-selected=true]:ring-accent data-[controller-selected=true]:ring-offset-4 data-[controller-selected=true]:ring-offset-bg"
      >
        {controllerNavigable ? (
          <button
            type="button"
            tabIndex={-1}
            aria-hidden="true"
            data-controller-launch="game"
            className="hidden"
            onClick={() => void handleLaunch()}
          />
        ) : null}
        {controllerNavigable ? (
          <span className="pointer-events-none absolute left-1/2 top-3 z-50 hidden -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-full border-2 border-white/80 bg-accent px-3 py-1.5 text-xs font-bold text-accent-fg shadow-raised group-data-[controller-selected=true]:flex">
            <Gamepad2 size={14} />
            <span>Selected</span>
            <span aria-hidden="true">·</span>
            <XboxButtonGlyph button="A" size="small" />
            <span>{primaryLaunchTarget ? "Play" : "Info"}</span>
          </span>
        ) : null}
        <div className="relative aspect-[3/4] w-full shrink-0 bg-surface-hover">
          {game.coverUrl ? (
            <img
              src={game.coverUrl}
              alt=""
              className="game-card-cover-image h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
            />
          ) : (
            <div className="grid h-full place-items-center text-xs text-text-faint">
              No cover
            </div>
          )}

          {/* Badges top left */}
          <div className="absolute left-2 top-2 z-20 flex flex-col items-start gap-1.5 drop-shadow-md">
            {game.sources.map((source) => (
              <span
                key={source}
                data-tour={demo ? `demo-source-${source}` : undefined}
              >
                <SourceBadge source={source} />
              </span>
            ))}
            {game.emulatorIds.map((emulatorId) => (
              <EmulatorBadge key={emulatorId} emulatorId={emulatorId} />
            ))}
            {game.sources.includes("custom") ? (
              <CommunityApprovalBadge
                suggestionId={game.communitySuggestionId}
                verified={game.communitySuggestionVerified}
                status={game.communitySuggestionStatus}
              />
            ) : null}
          </div>

          {/* Hover Actions - Top Right (constructive first, destructive last) */}
          <div
            className={clsx(
              "game-card-hover-actions absolute right-2 top-2 z-30 flex translate-x-2 flex-col gap-1.5 opacity-0 transition-all duration-200 group-hover:translate-x-0 group-hover:opacity-100 focus-within:translate-x-0 focus-within:opacity-100",
              launchTourDemo && "translate-x-0 opacity-100",
            )}
          >
            {launchTourDemo ||
            (!demo && canLaunchExecutables && primaryLaunchTarget) ? (
              <IconButton
                icon={Play}
                aria-label={`Play ${game.name}`}
                title={
                  hasActiveSession
                    ? "Already running"
                    : launching
                      ? "Starting…"
                      : "Play"
                }
                data-tour={launchTourDemo ? "demo-launch-play" : undefined}
                onClick={() => void handleLaunch()}
                className="bg-bg text-text-muted shadow-raised border-bg hover:bg-accent hover:border-accent hover:text-accent-fg"
              />
            ) : null}
            {game.source && game.exeNames[0] ? (
              <IconButton
                icon={Search}
                aria-label={`Check matches for ${game.name}`}
                title="Check for matches"
                onClick={() => setShowMatchCheck(true)}
                className="bg-bg text-text-muted shadow-raised border-bg hover:bg-accent hover:border-accent hover:text-accent-fg"
              />
            ) : null}
            {canSuggestToCommunity ? (
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
                onClick={() => setReportOpen(true)}
                className="bg-bg text-text-muted shadow-raised border-bg hover:bg-accent hover:border-accent hover:text-accent-fg"
              />
            ) : null}
            <IconButton
              icon={ClockPlus}
              aria-label={`Log a missed session for ${game.name}`}
              title="Log missed session"
              onClick={(event) =>
                demo
                  ? openDemoMenu(event.currentTarget)
                  : setShowAddPlaytime(true)
              }
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

          {game.communitySuggestionExeName && !game.communityUpgradeExeName ? (
            <div className="absolute inset-x-2 bottom-2 z-30 drop-shadow-lg">
              <CommunityLevelUpButton
                gameName={game.name}
                variant="cover-card"
                onLevelUp={() => {
                  convertLocalSuggestionToCommunity(
                    game.communitySuggestionExeName!,
                  );
                  addToast({
                    tone: "success",
                    title: "Community match applied",
                    detail: `${game.name} now uses the approved community match.`,
                  });
                }}
              />
            </div>
          ) : null}
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
                <span className="game-card-name-default group-hover:hidden">
                  {game.name}
                </span>
                <span className="game-card-name-exe hidden font-mono text-[13px] group-hover:inline">
                  {exeLabel}
                </span>
              </>
            ) : (
              game.name
            )}
          </h2>
          <div
            data-tour={demo ? "demo-playtime-result" : undefined}
            className="mt-1 flex items-baseline gap-1.5"
          >
            <span className="font-mono text-lg font-bold tracking-tight text-text">
              {formatDuration(game.totalSeconds, showDurationDays)}
            </span>
            <span className="text-[11px] font-medium text-text-muted">in</span>
            <button
              type="button"
              disabled={game.sessionCount === 0}
              onClick={handleShowHistory}
              className="text-[11px] font-medium text-text-muted underline decoration-text-faint underline-offset-2 transition-colors hover:text-accent disabled:no-underline"
              aria-label={`Show ${game.sessionCount} session${game.sessionCount === 1 ? "" : "s"} for ${game.name} in history`}
            >
              {game.sessionCount} session{game.sessionCount !== 1 ? "s" : ""}
            </button>
          </div>

          {/* Persistent Community Prompts */}
          {game.communityUpgradeExeName ? (
            <div className="mt-3 flex flex-col gap-2 border-t border-border/50 pt-3">
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
            </div>
          ) : null}
        </div>
        {renderContextMenu()}
        {showAddPlaytime ? (
          <AddPlaytimeDialog
            game={game}
            demo={demo}
            onCancel={() => setShowAddPlaytime(false)}
            onConfirm={handleAddPlaytime}
          />
        ) : null}
        {showAdjustPlaytime ? (
          <AdjustPlaytimeDialog
            game={game}
            disabled={hasActiveSession}
            onCancel={() => setShowAdjustPlaytime(false)}
            onConfirm={handleAdjustPlaytime}
          />
        ) : null}
        {showMatchCheck ? (
          <MatchCheckDialog
            game={game}
            onCancel={() => setShowMatchCheck(false)}
            onApply={handleApplyMatch}
            onReportNotAGame={() => void handleNegativeReport()}
            onSearchCommunity={
              canSuggestToCommunity
                ? () => {
                    setShowMatchCheck(false);
                    setShareOpen(true);
                  }
                : undefined
            }
          />
        ) : null}
        {reportOpen ? (
          <ReportWrongMatchDialog
            exeName={game.exeNames[0] ?? ""}
            gameName={game.name}
            onCancel={() => setReportOpen(false)}
            onDifferentGame={() => {
              setReportOpen(false);
              setShareOpen(true);
            }}
            onNotAGame={() => void handleNegativeReport()}
          />
        ) : null}
        {shareOpen ? (
          <CommunitySuggestionForm
            candidates={shareCandidates}
            exeName={game.exeNames[0] ?? ""}
            hasMore={shareHasMore}
            message={shareMessage}
            search={shareSearch}
            selection={shareSelection}
            state={shareState}
            isOffline={isOffline}
            onApplyCandidate={applyShareCandidate}
            onCancel={closeShare}
            onLoadMore={loadMoreShareCandidates}
            onSearch={(options) => void searchShareCandidates(options)}
            onSearchChange={(value) => {
              setShareSearch(value);
              setShareSelection(null);
              setShareCandidates([]);
              setShareHasMore(false);
              setShareNextOffset(0);
              setShareMessage("");
            }}
            onSearchOptionsChange={() => {
              setShareSelection(null);
              setShareCandidates([]);
              setShareHasMore(false);
              setShareNextOffset(0);
              setShareMessage("");
            }}
            onSubmit={() => void submitShareSuggestion()}
          />
        ) : null}
        {showConvert ? (
          <GameNameDialog
            title="Convert to a custom game"
            subtitle={game.name}
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
            title="Rename game"
            subtitle={game.name}
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
      ref={cardRef}
      {...contextMenu.props}
      {...demoCardProps}
      data-controller-item={controllerNavigable ? "game-card" : undefined}
      tabIndex={controllerNavigable ? -1 : undefined}
      aria-label={
        controllerNavigable
          ? `${game.name}, ${primaryLaunchTarget ? "press A to play" : "no launch file saved"}`
          : undefined
      }
      className="game-library-card group relative rounded-xl border border-border bg-surface shadow-raised transition duration-200 hover:border-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg data-[controller-selected=true]:z-20 data-[controller-selected=true]:scale-[1.025] data-[controller-selected=true]:border-accent data-[controller-selected=true]:brightness-110 data-[controller-selected=true]:shadow-card-hover data-[controller-selected=true]:outline data-[controller-selected=true]:outline-2 data-[controller-selected=true]:outline-offset-[7px] data-[controller-selected=true]:outline-white/80 data-[controller-selected=true]:ring-[7px] data-[controller-selected=true]:ring-accent data-[controller-selected=true]:ring-offset-4 data-[controller-selected=true]:ring-offset-bg"
    >
      {controllerNavigable ? (
        <button
          type="button"
          tabIndex={-1}
          aria-hidden="true"
          data-controller-launch="game"
          className="hidden"
          onClick={() => void handleLaunch()}
        />
      ) : null}
      {controllerNavigable ? (
        <span className="pointer-events-none absolute left-1/2 top-2 z-50 hidden -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-full border-2 border-white/80 bg-accent px-3 py-1.5 text-xs font-bold text-accent-fg shadow-raised group-data-[controller-selected=true]:flex">
          <Gamepad2 size={14} />
          <span>Selected</span>
          <span aria-hidden="true">·</span>
          <XboxButtonGlyph button="A" size="small" />
          <span>{primaryLaunchTarget ? "Play" : "Info"}</span>
        </span>
      ) : null}
      <div className="grid grid-cols-[72px_minmax(0,1fr)_auto] items-center gap-4 p-3">
        <div className="relative w-[72px] shrink-0">
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
          {game.communitySuggestionExeName && !game.communityUpgradeExeName ? (
            <div className="absolute inset-x-1 bottom-1 z-20 drop-shadow-md">
              <CommunityLevelUpButton
                gameName={game.name}
                variant="cover-list"
                onLevelUp={() => {
                  convertLocalSuggestionToCommunity(
                    game.communitySuggestionExeName!,
                  );
                  addToast({
                    tone: "success",
                    title: "Community match applied",
                    detail: `${game.name} now uses the approved community match.`,
                  });
                }}
              />
            </div>
          ) : null}
        </div>

        <div className="min-w-0 py-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2
              className="truncate text-base font-semibold text-text"
              title={exeLabel ? `${game.name} (${exeLabel})` : game.name}
            >
              {exeLabel ? (
                <>
                  <span className="game-card-name-default group-hover:hidden">
                    {game.name}
                  </span>
                  <span className="game-card-name-exe hidden font-mono text-sm group-hover:inline">
                    {exeLabel}
                  </span>
                </>
              ) : (
                game.name
              )}
            </h2>
            <div className="flex flex-wrap items-center gap-1.5">
              {game.sources.map((source) => (
                <span
                  key={source}
                  data-tour={demo ? `demo-source-${source}` : undefined}
                >
                  <SourceBadge source={source} />
                </span>
              ))}
              {game.emulatorIds.map((emulatorId) => (
                <EmulatorBadge key={emulatorId} emulatorId={emulatorId} />
              ))}
            </div>
            {game.sources.includes("custom") ? (
              <CommunityApprovalBadge
                suggestionId={game.communitySuggestionId}
                verified={game.communitySuggestionVerified}
                status={game.communitySuggestionStatus}
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
              {game.exeNames.filter(Boolean).join(", ") ||
                game.emulatorLabels.join(", ")}
            </span>
          </div>

          {game.communityUpgradeExeName ? (
            <div className="mt-3 flex gap-2">
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
            </div>
          ) : null}
        </div>

        <div className="flex items-center gap-6 pr-2">
          <div
            data-tour={demo ? "demo-playtime-result" : undefined}
            className={clsx(
              "grid-cols-3 gap-6",
              demo ? "grid" : "hidden sm:grid",
            )}
          >
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

          <div
            className={clsx(
              "flex flex-col gap-1.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100",
              launchTourDemo && "opacity-100",
            )}
          >
            {launchTourDemo ||
            (!demo && canLaunchExecutables && primaryLaunchTarget) ? (
              <IconButton
                icon={Play}
                aria-label={`Play ${game.name}`}
                title={
                  hasActiveSession
                    ? "Already running"
                    : launching
                      ? "Starting…"
                      : "Play"
                }
                data-tour={launchTourDemo ? "demo-launch-play" : undefined}
                onClick={() => void handleLaunch()}
              />
            ) : null}
            <IconButton
              icon={ClockPlus}
              aria-label={`Log a missed session for ${game.name}`}
              title="Log missed session"
              onClick={(event) =>
                demo
                  ? openDemoMenu(event.currentTarget)
                  : setShowAddPlaytime(true)
              }
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
          demo={demo}
          onCancel={() => setShowAddPlaytime(false)}
          onConfirm={handleAddPlaytime}
        />
      ) : null}
      {showAdjustPlaytime ? (
        <AdjustPlaytimeDialog
          game={game}
          disabled={hasActiveSession}
          onCancel={() => setShowAdjustPlaytime(false)}
          onConfirm={handleAdjustPlaytime}
        />
      ) : null}
      {showMatchCheck ? (
        <MatchCheckDialog
          game={game}
          onCancel={() => setShowMatchCheck(false)}
          onApply={handleApplyMatch}
          onReportNotAGame={() => void handleNegativeReport()}
          onSearchCommunity={
            canSuggestToCommunity
              ? () => {
                  setShowMatchCheck(false);
                  setShareOpen(true);
                }
              : undefined
          }
        />
      ) : null}
      {reportOpen ? (
        <ReportWrongMatchDialog
          exeName={game.exeNames[0] ?? ""}
          gameName={game.name}
          onCancel={() => setReportOpen(false)}
          onDifferentGame={() => {
            setReportOpen(false);
            setShareOpen(true);
          }}
          onNotAGame={() => void handleNegativeReport()}
        />
      ) : null}
      {shareOpen ? (
        <CommunitySuggestionForm
          candidates={shareCandidates}
          exeName={game.exeNames[0] ?? ""}
          hasMore={shareHasMore}
          message={shareMessage}
          search={shareSearch}
          selection={shareSelection}
          state={shareState}
          isOffline={isOffline}
          onApplyCandidate={applyShareCandidate}
          onCancel={closeShare}
          onLoadMore={loadMoreShareCandidates}
          onSearch={(options) => void searchShareCandidates(options)}
          onSearchChange={(value) => {
            setShareSearch(value);
            setShareSelection(null);
            setShareCandidates([]);
            setShareHasMore(false);
            setShareNextOffset(0);
            setShareMessage("");
          }}
          onSearchOptionsChange={() => {
            setShareSelection(null);
            setShareCandidates([]);
            setShareHasMore(false);
            setShareNextOffset(0);
            setShareMessage("");
          }}
          onSubmit={() => void submitShareSuggestion()}
        />
      ) : null}
      {showConvert ? (
        <GameNameDialog
          title="Convert to a custom game"
          subtitle={game.name}
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
          title="Rename game"
          subtitle={game.name}
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
  return (
    <Modal
      size="sm"
      labelId="stop-tracking-dialog-title"
      eyebrow="My Games"
      title="Ignore this game?"
      subtitle={game.name}
      icon={Ban}
      onClose={onCancel}
      footer={
        <div className="grid gap-2 sm:grid-cols-3">
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
          <Button variant="ghost" onClick={onCancel} data-autofocus>
            Cancel
          </Button>
        </div>
      }
    >
      <p className="text-sm leading-6 text-text-muted">
        {game.emulatorLabels.length > 0
          ? "PlayCounter will ignore this local emulator-content mapping from now on. The emulator itself remains detectable."
          : "PlayCounter ignores this game's file from now on - it will never be tracked again. You can undo this anytime under Discovered → Ignored."}
      </p>
      {game.sessionCount > 0 ? (
        <p className="mt-2 text-sm leading-6 text-text-muted">
          {game.sessionCount} completed{" "}
          {game.sessionCount === 1 ? "session" : "sessions"} can be kept in My
          History or cleared now.
        </p>
      ) : null}
      <div className="mt-4 rounded-xl border border-border bg-bg px-3 py-2 text-xs text-text-faint">
        {game.exeNames.filter(Boolean).join(", ") ||
          game.emulatorLabels.join(", ")}
      </div>
    </Modal>
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
    <Modal
      size="sm"
      labelId="remove-game-dialog-title"
      eyebrow="My Games"
      title="Remove from library?"
      subtitle={game.name}
      icon={Trash2}
      onClose={onCancel}
      footer={
        <div className="grid gap-2 sm:grid-cols-3">
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
      }
    >
      <p className="text-sm leading-6 text-text-muted">
        The game and its file match are removed, and a running session stops.
        PlayCounter will detect it again the next time you play, use Ignore game
        if you want it gone for good.
      </p>
    </Modal>
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
  demo,
  onCancel,
  onConfirm,
}: {
  game: GameSummary;
  demo?: boolean;
  onCancel: () => void;
  onConfirm: (durationSeconds: number, endedAt: string) => void;
}) {
  const [hours, setHours] = useState("");
  const [minutes, setMinutes] = useState("");
  const [dateValue, setDateValue] = useState(() =>
    localDateTimeValue(new Date()),
  );

  const durationSeconds =
    (Math.max(0, Number(hours) || 0) * 60 + Math.max(0, Number(minutes) || 0)) *
    60;
  const parsedDate = new Date(dateValue);
  const dateInvalid = Number.isNaN(parsedDate.getTime());
  const canSubmit = durationSeconds >= 1 && !dateInvalid;

  const handleSubmit = () => {
    if (!canSubmit) return;
    onConfirm(durationSeconds, parsedDate.toISOString());
  };

  return (
    <Modal
      size="sm"
      labelId="log-session-title"
      eyebrow="History"
      title="Log a missed session"
      subtitle={game.name}
      icon={ClockPlus}
      onClose={onCancel}
      dataTour={demo ? "demo-log-session-dialog" : undefined}
      backdropDataTour={demo ? "demo-log-session-backdrop" : undefined}
      footer={
        <div className="grid gap-2 sm:grid-cols-2">
          <Button
            data-tour={demo ? "demo-log-session-confirm" : undefined}
            variant="primary"
            icon={ClockPlus}
            onClick={handleSubmit}
            disabled={!canSubmit}
          >
            Log session
          </Button>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      }
    >
      <p className="text-sm leading-6 text-text-muted">
        Use this when PlayCounter missed a session you actually played. Choose
        how long you played and when the session ended.
      </p>

      <div className="mt-4 flex gap-3 rounded-xl border border-accent/20 bg-accent-tint px-3.5 py-3 text-sm">
        <History size={17} className="mt-0.5 shrink-0 text-accent" />
        <div>
          <div className="font-semibold text-text">Added to History</div>
          <p className="mt-0.5 leading-5 text-text-muted">
            This session will affect dates, streaks, and other play stats.
          </p>
        </div>
      </div>

      <div className="mt-5 rounded-xl border border-border bg-bg/60 p-4">
        <div className="mb-3">
          <h3 className="text-sm font-semibold text-text">Session length</h3>
          <p className="mt-0.5 text-xs text-text-faint">
            Enter the time you played in this session.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="grid gap-1.5 text-xs font-medium text-text-muted">
            Hours
            <Input
              type="number"
              min={0}
              inputMode="numeric"
              value={hours}
              onChange={(event) => setHours(event.target.value)}
              placeholder="0"
              data-autofocus
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

        <label className="mt-4 grid gap-1.5 text-xs font-medium text-text-muted">
          <span className="inline-flex items-center gap-1.5">
            <CalendarDays size={13} />
            When did the session end?
          </span>
          <Input
            type="datetime-local"
            value={dateValue}
            max={localDateTimeValue(new Date())}
            onChange={(event) => setDateValue(event.target.value)}
            className="w-full"
          />
        </label>
      </div>

      <p className="mt-3 text-xs leading-5 text-text-faint">
        Only know the game&apos;s total time? Use Adjust total playtime instead.
        It will not create a History entry.
      </p>
    </Modal>
  );
}

function AdjustPlaytimeDialog({
  game,
  disabled,
  onCancel,
  onConfirm,
}: {
  game: GameSummary;
  disabled: boolean;
  onCancel: () => void;
  onConfirm: (targetSeconds: number) => void;
}) {
  const [hours, setHours] = useState(() =>
    Math.floor(game.totalSeconds / 3600).toString(),
  );
  const [minutes, setMinutes] = useState(() =>
    Math.floor((game.totalSeconds % 3600) / 60).toString(),
  );
  const hoursNumber = Number(hours);
  const minutesNumber = Number(minutes);
  const valuesValid =
    Number.isInteger(hoursNumber) &&
    hoursNumber >= 0 &&
    Number.isInteger(minutesNumber) &&
    minutesNumber >= 0 &&
    minutesNumber <= 59;
  const targetSeconds = valuesValid
    ? (hoursNumber * 60 + minutesNumber) * 60
    : 0;

  return (
    <Modal
      size="sm"
      labelId="adjust-playtime-title"
      eyebrow="Library total"
      title="Adjust total playtime"
      subtitle={game.name}
      icon={Clock3}
      onClose={onCancel}
      footer={
        <>
          <div className="grid gap-2 sm:grid-cols-2">
            <Button
              variant="primary"
              icon={Clock3}
              type="submit"
              form="adjust-playtime-form"
              disabled={!valuesValid || disabled}
            >
              Save total
            </Button>
            <Button type="button" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          </div>
          {game.adjustmentSeconds !== 0 ? (
            <Button
              type="button"
              variant="ghost"
              icon={RotateCcw}
              className="mt-2 w-full"
              disabled={disabled}
              onClick={() => onConfirm(game.recordedSeconds)}
            >
              Reset to recorded time
            </Button>
          ) : null}
        </>
      }
    >
      <p className="text-sm leading-6 text-text-muted">
        Already played this game before using PlayCounter? Enter the full
        playtime shown by Steam or another launcher. You can also use this to
        correct a total that is wrong.
      </p>

      <div className="mt-4 flex gap-3 rounded-xl border border-border bg-bg/60 px-3.5 py-3 text-sm">
        <History size={17} className="mt-0.5 shrink-0 text-text-faint" />
        <div>
          <div className="font-semibold text-text">History stays unchanged</div>
          <p className="mt-0.5 leading-5 text-text-muted">
            No session is added, edited, or removed.
          </p>
        </div>
      </div>

      <div className="mt-5 overflow-hidden rounded-xl border border-border bg-bg/60 text-sm">
        <div className="flex items-center justify-between gap-3 px-4 py-2.5 text-text-muted">
          <span>Time from sessions</span>
          <span className="font-mono font-medium text-text">
            {formatDuration(game.recordedSeconds)}
          </span>
        </div>
        {game.adjustmentSeconds !== 0 ? (
          <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-2.5 text-text-muted">
            <span>Current adjustment</span>
            <span className="font-mono font-medium text-text">
              {game.adjustmentSeconds > 0 ? "+" : "−"}
              {formatDuration(Math.abs(game.adjustmentSeconds))}
            </span>
          </div>
        ) : null}
        <div className="flex items-center justify-between gap-3 border-t border-accent/20 bg-accent-tint px-4 py-3">
          <span className="font-semibold text-text">Current total</span>
          <span className="font-mono text-base font-bold text-accent">
            {formatDuration(game.totalSeconds)}
          </span>
        </div>
      </div>

      {disabled ? (
        <div className="mt-4 rounded-xl border border-warning-border bg-warning-tint px-3.5 py-3 text-sm leading-5 text-warning">
          Stop the active session before changing the total.
        </div>
      ) : null}

      <form
        id="adjust-playtime-form"
        className="mt-5"
        onSubmit={(event) => {
          event.preventDefault();
          if (valuesValid && !disabled) onConfirm(targetSeconds);
        }}
      >
        <div className="rounded-xl border border-border bg-bg/60 p-4">
          <div className="mb-3">
            <h3 className="text-sm font-semibold text-text">New total</h3>
            <p className="mt-0.5 text-xs text-text-faint">
              Enter the full total, not only the hours that are missing.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="grid gap-1.5 text-xs font-medium text-text-muted">
              Hours
              <Input
                type="number"
                min={0}
                step={1}
                inputMode="numeric"
                value={hours}
                onChange={(event) => setHours(event.target.value)}
                data-autofocus
              />
            </label>
            <label className="grid gap-1.5 text-xs font-medium text-text-muted">
              Minutes
              <Input
                type="number"
                min={0}
                max={59}
                step={1}
                inputMode="numeric"
                value={minutes}
                onChange={(event) => setMinutes(event.target.value)}
              />
            </label>
          </div>
        </div>

        {valuesValid && targetSeconds < game.recordedSeconds ? (
          <div className="mt-3 rounded-xl border border-warning-border bg-warning-tint px-3.5 py-3 text-sm leading-5 text-warning">
            This total is lower than your recorded sessions. Those sessions will
            still stay in History.
          </div>
        ) : null}
      </form>
    </Modal>
  );
}

function MatchCheckDialog({
  game,
  onCancel,
  onApply,
  onReportNotAGame,
  onSearchCommunity,
}: {
  game: GameSummary;
  onCancel: () => void;
  onApply: (match: Game, pendingCommunity: boolean) => void;
  onReportNotAGame: () => void;
  onSearchCommunity?: () => void;
}) {
  const isOffline = useIsOffline();
  const exeName = game.exeNames[0] ?? "";
  const [state, setState] = useState<"loading" | "error" | "done">("loading");
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState("");
  const [candidates, setCandidates] = useState<Game[]>([]);
  const [selection, setSelection] = useState<Game | null>(null);
  const [pendingCommunityGameIds, setPendingCommunityGameIds] = useState<
    ReadonlySet<number>
  >(new Set());
  const [flaggedIdentifier, setFlaggedIdentifier] = useState<{
    reason: IdentifierFlagReason;
  }>();
  const [confirmNotAGame, setConfirmNotAGame] = useState(false);

  const isPendingCommunityMatch = (match: Game) =>
    match.source === "community" && pendingCommunityGameIds.has(match.id);
  const isCurrentMatch = (match: Game) =>
    isSameGame(match, { id: game.gameId, source: game.source });

  useEffect(() => {
    if (isOffline) return;
    let cancelled = false;
    setState("loading");
    setError("");
    void (async () => {
      try {
        const {
          games,
          pendingCommunityGameIds: pendingIds,
          flaggedIdentifier: flag,
        } = await findGameMatches(exeName);
        if (cancelled) return;
        const pendingIdSet = new Set(pendingIds ?? []);
        setCandidates(sortMatchCandidates(games));
        setPendingCommunityGameIds(pendingIdSet);
        setFlaggedIdentifier(flag);
        // A single combined IGDB/community result is preselected so applying
        // is one click - unless it is what the exe already uses. An ambiguous
        // set requires an explicit pick.
        setSelection(initialMatchSelection(games, game));
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
  }, [attempt, exeName, game.gameId, game.source, isOffline]);

  const footer = (
    <div className="grid gap-3">
      {selection ? (
        <p className="text-xs text-text-muted">
          <strong className="text-text">{selection.name}</strong> will be used
          for {exeName} on this PC.
        </p>
      ) : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="ghost" onClick={onCancel}>
          {game.source === "custom" ? "Keep custom game" : "Keep current match"}
        </Button>
        <Button
          variant="primary"
          icon={Check}
          disabled={!selection || isOffline || isCurrentMatch(selection)}
          onClick={() => {
            if (selection && !isCurrentMatch(selection))
              onApply(selection, isPendingCommunityMatch(selection));
          }}
        >
          Use this match
        </Button>
      </div>
      <div className="border-t border-border pt-3">
        {confirmNotAGame ? (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span className="text-sm text-danger">
              Report and stop tracking {exeName}?
            </span>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setConfirmNotAGame(false)}>
                Cancel
              </Button>
              <Button variant="danger" onClick={onReportNotAGame}>
                Report
              </Button>
            </div>
          </div>
        ) : (
          <Button
            variant="ghost"
            className="text-danger"
            onClick={() => setConfirmNotAGame(true)}
          >
            This is not a game
          </Button>
        )}
      </div>
    </div>
  );

  return (
    <Modal
      size="md"
      labelId="match-check-title"
      eyebrow="Database match"
      title={`Check matches for ${game.name}`}
      subtitle={exeName}
      icon={state === "loading" && !isOffline ? Loader2 : Search}
      iconSpin={state === "loading" && !isOffline}
      onClose={onCancel}
      footer={footer}
    >
      <p className="text-sm leading-6 text-text-muted">
        Looks <span className="font-mono font-medium text-text">{exeName}</span>{" "}
        up in IGDB and in approved community matches. Picking one changes it on
        this PC only.
      </p>

      {flaggedIdentifier ? (
        <div className="mt-4 flex gap-3 rounded-xl border border-warning-border bg-warning-tint p-4 text-sm text-warning">
          <AlertTriangle size={18} className="mt-0.5 shrink-0" />
          <span>
            {flaggedIdentifier.reason === "not_a_game"
              ? "Apps that are not games use this file name too, so PlayCounter no longer picks a game automatically."
              : "Several games use this file name, so PlayCounter no longer picks a game automatically."}
          </span>
        </div>
      ) : null}

      <div className="mt-5" role="status" aria-live="polite">
        {isOffline ? (
          <div className="rounded-xl border border-warning-border bg-warning-tint p-5 text-sm text-warning">
            <div className="flex items-center gap-2 font-medium">
              <WifiOff size={17} /> Checking the database needs an internet
              connection.
            </div>
            <Button
              className="mt-3"
              variant="secondary"
              onClick={() => setAttempt((value) => value + 1)}
            >
              Try again
            </Button>
          </div>
        ) : state === "loading" ? (
          <div className="grid gap-2" aria-busy>
            {Array.from({ length: 3 }, (_, index) => (
              <div
                key={index}
                className="h-[88px] animate-pulse rounded-xl border border-border bg-surface-hover"
              />
            ))}
            <span className="sr-only">
              Checking IGDB and community databases…
            </span>
          </div>
        ) : state === "error" ? (
          <div className="rounded-xl border border-danger-border bg-danger-tint p-5 text-sm text-danger">
            <div className="font-medium">Match check failed</div>
            <div className="mt-1">{error}</div>
            <Button
              className="mt-3"
              variant="secondary"
              onClick={() => setAttempt((value) => value + 1)}
            >
              Try again
            </Button>
          </div>
        ) : candidates.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-bg/60 p-6 text-center text-sm text-text-muted">
            <div className="font-medium text-text">
              No database match for {exeName}.
            </div>
            {game.source === "custom" ? (
              <div className="mt-1">{game.name} stays a custom game.</div>
            ) : null}
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <Button
                variant="secondary"
                icon={RotateCcw}
                onClick={() => setAttempt((value) => value + 1)}
              >
                Check again
              </Button>
              {onSearchCommunity ? (
                <Button
                  variant="primary"
                  icon={Search}
                  onClick={onSearchCommunity}
                >
                  Search the database
                </Button>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="grid gap-2">
            {candidates.map((match) => {
              const selected = selection ? isSameGame(selection, match) : false;
              const current = isCurrentMatch(match);
              const content = (
                <>
                  {match.coverUrl ? (
                    <img
                      src={match.coverUrl}
                      alt=""
                      className="h-16 w-12 shrink-0 rounded-md bg-surface-hover object-cover"
                    />
                  ) : (
                    <span className="grid h-16 w-12 shrink-0 place-items-center rounded-md bg-surface-hover text-text-faint">
                      <Gamepad2 size={20} />
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span
                      className="block truncate font-semibold text-text"
                      title={match.name}
                    >
                      {match.name}
                    </span>
                    <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <SourceBadge source={match.source} />
                      {match.releaseYear ? (
                        <span className="text-xs text-text-faint">
                          {match.releaseYear}
                        </span>
                      ) : null}
                      {current ? (
                        <span className="rounded border border-border bg-surface-hover px-1.5 py-0.5 text-[11px] font-medium text-text-muted">
                          Current match
                        </span>
                      ) : null}
                      {isPendingCommunityMatch(match) ? (
                        <span
                          title="Someone suggested this match and it is still being reviewed. Until it is approved, it only counts on this PC."
                          className="rounded border border-warning-border bg-warning-tint px-1.5 py-0.5 text-[11px] font-medium text-warning"
                        >
                          In review
                        </span>
                      ) : null}
                    </span>
                  </span>
                  {selected ? (
                    <Check size={18} className="shrink-0 text-accent" />
                  ) : null}
                </>
              );
              const className = clsx(
                "flex min-w-0 items-center gap-3 rounded-xl border p-3 text-left transition",
                current
                  ? "border-border bg-surface-hover/60 opacity-75"
                  : selected
                    ? "border-accent bg-accent/10 ring-1 ring-accent"
                    : "border-border bg-bg hover:border-accent/40 hover:bg-surface-hover",
              );
              return current ? (
                <div key={`${match.source}:${match.id}`} className={className}>
                  {content}
                </div>
              ) : (
                <button
                  key={`${match.source}:${match.id}`}
                  type="button"
                  aria-pressed={selected}
                  className={className}
                  onClick={() => setSelection(selected ? null : match)}
                >
                  {content}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </Modal>
  );
}

function GameNameDialog({
  title,
  subtitle,
  description,
  confirmLabel,
  name,
  onNameChange,
  onCancel,
  onConfirm,
}: {
  title: string;
  subtitle: string;
  description: string;
  confirmLabel: string;
  name: string;
  onNameChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal
      size="sm"
      labelId="game-name-dialog-title"
      eyebrow="Custom game"
      title={title}
      subtitle={subtitle}
      icon={Pencil}
      onClose={onCancel}
      footer={
        <div className="grid gap-2 sm:grid-cols-2">
          <Button
            variant="primary"
            type="submit"
            form="game-name-form"
            disabled={!name.trim()}
          >
            {confirmLabel}
          </Button>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      }
    >
      <p className="mt-2 text-sm text-text-muted">{description}</p>

      <form
        id="game-name-form"
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
            data-autofocus
            placeholder="Game name..."
          />
        </label>
      </form>
    </Modal>
  );
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
