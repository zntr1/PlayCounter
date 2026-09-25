import {
  CustomizeSection,
  LibraryCardControls,
  LibraryLayoutControls,
  OptionRow,
} from "../LibraryAppearanceControls";
import { PlayCounterAnimatedIcon } from "../../brand/PlayCounterAnimatedIcon";
import { useLibraryPractice } from "../PersonalLibraryContext";
import {
  publishLibraryHeroArt,
  publishLibrarySources,
  useLibrarySources,
} from "../librarySources";
import { GameBanner } from "../GameBanner";
import { useLibraryLaunchLock } from "../libraryLaunchLock";
import { ArtPickerDialog } from "../ArtPickerDialog";
import { matchesFeaturedGame, pickFeaturedGame } from "./games/featuredGame";
import clsx from "clsx";
import {
  AlertTriangle,
  Ban,
  CalendarDays,
  Clipboard,
  Check,
  CheckSquare,
  Clock3,
  ClockPlus,
  Download,
  ExternalLink,
  Flag,
  FolderOpen,
  FolderSearch,
  Gamepad2,
  Grid2X2,
  History,
  ImagePlus,
  Info,
  FolderTree,
  LayoutGrid,
  PanelTop,
  List,
  Loader2,
  MoveRight,
  Pencil,
  Pin,
  PinOff,
  Play,
  RotateCcw,
  Search,
  Send,
  Settings2,
  SlidersHorizontal,
  Trash2,
  WifiOff,
} from "lucide-react";
import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  acceptCommunityUpgrade,
  addManualSession,
  applyGameMatch,
  applyLocalLinkGameMatch,
  applyKnownGameMatch,
  cancelCommunitySuggestion,
  clearCustomGameCover,
  convertLocalSuggestionToCommunity,
  dismissCommunityUpgrade,
  doNotTrackGame,
  findGameMatches,
  forgetLaunchTarget,
  forgetManualLaunchTarget,
  forgetEmulatorLaunchTarget,
  confirmEmulatorLaunchCandidate,
  launchGame,
  launchEmulatorGame,
  convertToCustomGame,
  hydrateGameMetadata,
  markCommunitySuggestionRejected,
  renameCustomGame,
  revealGameExecutable,
  reportNegativeMatch,
  scanProcessesNow,
  chooseLaunchTarget,
  chooseEmulatorLaunchFile,
  setGamePlaytime,
  setCustomGameCover,
  suggestTrackedGameToCommunity,
  submitLocalLinkToCommunity,
  untrackGame,
  verifyLaunchTargetsThrottled,
  type GameAliasRef,
} from "../../tracker";
import {
  canSuggestCustomGameToCommunity,
  canSwitchApprovedSuggestionToCommunity,
  createGameIdentityResolver,
  findPendingCommunitySuggestionEntry,
  gameMetadataKey,
  resolvedCanonicalGameKey,
  useAppStore,
  useIsOffline,
  type ActiveSession,
  type ExeCacheEntry,
  type PendingCommunitySuggestionTarget,
} from "../../store";
import { CommunitySuggestionForm } from "./DiscoveredView";
import { matchesProcessPatternSet } from "../../ignoredProcessPatterns";
import { gameSecondsKeys } from "../../gameSeconds";
import { useCommunityGameCorrection } from "../useCommunityGameCorrection";
import {
  adjustmentSecondsFor,
  effectiveTotalSeconds,
} from "../../playtimeAdjustments";
import {
  providerFloorKey,
  providerFloorRecord,
  providerFloors,
  providerFloorsForProvider,
} from "../../library/playtimeFloor";
import { commitLibraryImports } from "../../library/commit";
import { MoveToPlayCounterDialog } from "./games/MoveToPlayCounterDialog";
import { LibraryMatchOffer } from "../LibraryMatchOffer";
import {
  dismissLibraryMatchOffer,
  useLibraryMatchOffers,
} from "../../library/matchOffers";
import {
  checkLibraryImportForMatches,
  type LibraryExecutableMatch,
  type LibraryImportMatchCheck,
} from "../../library/recheck";
import {
  libraryLaunchErrorMessage,
  shouldForgetLibraryInstallOnLaunchError,
} from "../../library/launchErrors";
import {
  libraryEntryKey,
  type LibraryImportEntry,
  type LibraryInstallEntry,
} from "../../library/types";
import { listLocalLinks, type LocalLink } from "../../localLinks";
import {
  GameMatchBadges,
  GameOriginBadges,
  GameProvenanceBadges,
  Panel,
  ProviderBadge,
  EmulatorBadge,
  SourceBadge,
  communitySuggestionApproval,
  formatDuration,
} from "../components";
import {
  Button,
  ContextMenu,
  ContextMenuSubmenu,
  ContextMenuItem,
  ContextMenuSeparator,
  IconButton,
  Input,
  Modal,
  useAnchoredMenu,
  useContextMenu,
  Select,
} from "../primitives";
import {
  initialMatchSelection,
  isSameGame,
  sortMatchCandidates,
} from "./matchCheckModel";
import { ReportWrongMatchDialog } from "../ReportWrongMatchDialog";
import { GameDetailsDialog } from "./games/GameDetailsDialog";
import { GameCover } from "../GameCover";
import { GameJournalBadges, GameJournalMenu } from "../GameJournalActions";
import {
  LibraryBulkActions,
  SelectableLibraryCard,
} from "../LibraryBulkActions";
import {
  librarySelectionKey,
  useLibrarySelection,
} from "../useLibrarySelection";
import { useGameJournal } from "../useGameJournal";
import { useLibrarySessionState } from "../useLibrarySessionState";
import {
  LibraryOrganizationToolbar,
  countShelfGames,
  matchesShelf,
  useLibraryJournalLookup,
} from "../LibraryOrganization";
import {
  useLibraryGameDrag,
  libraryGameDragSourceProps,
  type StartLibraryGameDrag,
} from "../libraryGameDrag";
import { LibraryGameDropHint } from "../LibraryGameDropHint";
import {
  DEFAULT_PLAYTHROUGH_NAME,
  matchesLibraryFilters,
  normalizeLibraryFilters,
  type LibraryFilters,
  type PersonalShelf,
} from "../../personalLibrary";
import { CancelCommunitySuggestionDialog } from "../CancelCommunitySuggestionDialog";
import type {
  ContributionStatus,
  Game,
  GameSource,
  IdentifierFlagReason,
  LibraryProviderId,
} from "@playcounter/shared";
import { TOUR_DEMO_GAME, TOUR_DEMO_EMULATOR } from "../tour/tourDemoGame";
import { emitTourEvent, useTourDemo } from "../tour/TourUI";
import { findTour } from "../tour/tourDefinitions";
import { TourSampleSearch } from "../tour/TourSampleSearch";
import { StatsPractice } from "../tour/TourStatsPractice";
import {
  LAST_PLAYED_PROMOTION_DELAY_MS,
  compareMyGames,
  mergeLastPlayedEvidence,
  shouldPromoteActiveGame,
  type MyGamesSortKey,
} from "../myGamesSort";
import {
  isTourDemoLibraryGame,
  type LibraryGameKind,
} from "../libraryGameKind";
import { CommunityLevelUpButton } from "../CommunityLevelUpButton";
import { XboxButtonGlyph } from "../XboxButtonGlyph";
import {
  findManualLaunchTarget,
  launchErrorDetail,
  launchErrorMessage,
  launchTargetsForGame,
} from "../../gameLaunch";
import {
  emulatorLaunchErrorMessage,
  resolveEmulatorLaunchTarget,
} from "../../emulatorLaunch";
import { adapterFor } from "../../emulators/registry";
import {
  emulatorMappingProvenance,
  emulatorSessionProvenance,
  type EmulatorMatchProvenance,
} from "../../emulators/provenance";
import { currentPlatform } from "../../platform";
import { CONTROLLER_LIBRARY_VIEW_EVENT } from "../../controllerBridge";
import {
  hasUnknownProviderPlaytime,
  libraryProviders,
  trackingUnavailableMessage,
} from "../providerLibrary";
import { myGamesLayout } from "../myGamesLayout";
import {
  filterByLibraryTab,
  hasEmptyProviderTabs,
  resolveLibraryTab,
  visibleLibraryTabs,
} from "../libraryTabs";
import {
  libraryStatCards,
  libraryStatDefinitionsForKind,
  resolveLibraryStatCardIds,
  summarizeLibraryStats,
  toggleLibraryStatCardIds,
  type LibraryStatCard,
} from "../myGamesStats";
import {
  importableProviderTabs,
  isImportableProviderTabConfig,
  providerTabConfig,
  PROVIDER_TAB_CONFIGS,
  type ImportableProviderTabConfig,
} from "../libraryProviderTabs";
import { type MyGamesCardSize } from "../myGamesPresentation";
import { useLibraryGridColumns } from "../useLibraryGridColumns";
import { useLibraryRenderWindow } from "../useLibraryRenderWindow";
import { libraryContextActions } from "../gameLibraryActions";

type SortKey = MyGamesSortKey;
type ViewMode = MyGamesCardSize;

const sortOptions: Array<{ key: SortKey; label: string }> = [
  { key: "recent", label: "Last played" },
  { key: "playtime", label: "Most played" },
  { key: "name", label: "Name" },
  { key: "sessions", label: "Sessions" },
];

const GTA_V_TOUR_COVER = "/tour/gta-v-cover.webp";
const DEMO_LAUNCH_MS = 2_500;

export type GameSummary = {
  kind: LibraryGameKind;
  gameId: number;
  igdbId?: number;
  name: string;
  coverUrl: string;
  source: GameSource | null;
  sources: GameSource[];
  emulatorSources?: GameSource[];
  emulatorApproval?: EmulatorMatchProvenance["approval"];
  hasExplicitIdentifierSource?: boolean;
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
  hasLastPlayedEvidence?: boolean;
  activeStartedAt?: string;
  exeNames: string[];
  emulatorLabels: string[];
  emulatorIds: string[];
  emulatorContentKeys: string[];
  libraryImports: Array<{
    provider: LibraryProviderId;
    externalId: string;
    installed: boolean;
    entry: LibraryImportEntry;
    install?: LibraryInstallEntry;
  }>;
  providerFloorSeconds: number;
};

type PendingRemoval = {
  gameId: number;
  source: GameSource | null;
  name: string;
  aliases: GameAliasRef[];
  libraryImports: GameSummary["libraryImports"];
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
  adjustmentSeconds = 0,
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
    totalSeconds: totalSeconds + adjustmentSeconds,
    sessionSeconds: totalSeconds,
    archivedSeconds: 0,
    adjustmentSeconds,
    recordedSeconds: totalSeconds,
    sessionCount: 3 + addedSessions,
    historyGameKey: null,
    lastPlayedAt: new Date().toISOString(),
    exeNames: [TOUR_DEMO_GAME.exeName],
    emulatorLabels: [],
    emulatorIds: [],
    emulatorContentKeys: [],
    libraryImports: [],
    providerFloorSeconds: 0,
  };
}

export function makeCoreTourDemoGames(): GameSummary[] {
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
      emulatorContentKeys: [],
      libraryImports: [],
      providerFloorSeconds: 0,
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
      emulatorContentKeys: [],
      libraryImports: [],
      providerFloorSeconds: 0,
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
  return game.hasLastPlayedEvidence || game.sessionCount > 0
    ? `Last played ${formatLastPlayed(game.lastPlayedAt)}`
    : `Added ${formatLastPlayed(game.lastPlayedAt)}`;
}

/* The summary used to be three big cards between the toolbar and the first
   row of covers, which pushed the games themselves below the fold. It is one
   chip beside the library's title now: the game count first, then whichever
   numbers the user picked, divided like a segmented control. My History is
   where these numbers are actually explored, so each segment only carries its
   long label as a tooltip. The count is the "Games" card itself: it keeps the
   first segment rather than repeating further down the row. */
function LibrarySummaryChip({
  countLabel,
  countTitle,
  showCount,
  cards,
  showDurationDays,
}: {
  countLabel: string;
  countTitle: string;
  showCount: boolean;
  cards: readonly LibraryStatCard[];
  showDurationDays: boolean;
}) {
  const stats = cards.filter((card) => card.id !== "games");
  if (!showCount && stats.length === 0) return null;
  return (
    // Stretched segments keep the dividers aligned; a long custom summary
    // can wrap without pushing the toolbar outside its content column.
    <div className="flex min-h-7 max-w-full flex-wrap items-stretch divide-x divide-border/70 rounded-2xl border border-border/70 bg-surface text-xs">
      {showCount ? (
        <span
          title={countTitle}
          className="flex min-h-[26px] items-center gap-1 whitespace-nowrap px-2.5 text-text-muted"
        >
          <span className="font-mono font-semibold tabular-nums text-text">
            {countLabel}
          </span>
          {" games"}
        </span>
      ) : null}
      {stats.map((card) => (
        <span
          key={card.id}
          title={card.label}
          className="library-summary-stat flex min-h-[26px] items-center gap-1 whitespace-nowrap px-2.5 text-text-muted"
        >
          <span className="font-mono font-semibold tabular-nums text-text">
            {card.format === "duration"
              ? formatDuration(card.value, showDurationDays)
              : card.value}
          </span>
          {card.short}
        </span>
      ))}
    </div>
  );
}

function playButtonState(
  gameName: string,
  launching: boolean,
  hasActiveSession: boolean,
  launchBlocked: boolean,
) {
  if (launching) {
    return {
      ariaLabel: `Starting ${gameName}`,
      title: "Starting…",
      disabled: true,
      loading: true,
    };
  }
  if (hasActiveSession) {
    return {
      ariaLabel: `${gameName} is already running`,
      title: "Already running",
      disabled: true,
      loading: false,
    };
  }
  if (launchBlocked) {
    return {
      ariaLabel: `Play ${gameName} (unavailable, another game is starting)`,
      title: "Another game is starting",
      disabled: true,
      loading: false,
    };
  }
  return {
    ariaLabel: `Play ${gameName}`,
    title: "Play",
    disabled: false,
    loading: false,
  };
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

export function MyGamesView({
  renderContent = true,
}: {
  renderContent?: boolean;
}) {
  const [shelfSelection, setShelfSelection] = useState("all");
  const [libraryFilters, setLibraryFilters] = useState<LibraryFilters>({});
  const [filtersOpen, setFiltersOpen] = useState(false);
  const personalShelves = useAppStore((s) => s.personalShelves);
  const savePersonalShelf = useAppStore((s) => s.savePersonalShelf);
  const journalFor = useLibraryJournalLookup();
  const tourDemo = useTourDemo();
  const [demoPlaytime, setDemoPlaytime] = useState({
    addedSeconds: 0,
    addedSessions: 0,
    adjustmentSeconds: 0,
  });
  const [pendingRemoval, setPendingRemoval] = useState<PendingRemoval>(null);
  const [pendingStopTracking, setPendingStopTracking] =
    useState<PendingStopTracking>(null);
  const [pendingBulkMove, setPendingBulkMove] = useState<{
    games: GameSummary[];
    skippedCount: number;
  } | null>(null);
  const query = useAppStore((state) => state.libraryQuery);
  const setQuery = useAppStore((state) => state.setLibraryQuery);
  const selectShelf = useCallback((id: string) => {
    setShelfSelection(id);
    const saved = useAppStore
      .getState()
      .personalShelves.find((s) => s.id === id)?.filters;
    const { source, search = "", ...filters } = saved ?? {};
    setLibraryFilters(filters);
    useAppStore.getState().setLibraryQuery(search);
    // Regular shelves narrow the current library. Only an explicitly saved
    // source filter should switch to another library.
    if (source) useAppStore.getState().setLibraryTab(source);
  }, []);
  const customizeMenu = useAnchoredMenu();
  const showHero = useAppStore(
    (state) => state.settings.libraryShowHero !== false,
  );
  const setMyGamesShowHero = useAppStore((state) => state.setMyGamesShowHero);
  const featuredSetting = useAppStore(
    (state) => state.settings.libraryFeaturedGame ?? null,
  );
  const setLibraryFeaturedGame = useAppStore(
    (state) => state.setLibraryFeaturedGame,
  );
  const [recentSortNow, setRecentSortNow] = useState(() => Date.now());
  const { launchingGameKey, acquireLaunchLock, releaseLaunchLock } =
    useLibraryLaunchLock();
  const {
    recentSessions: sessions,
    activeSessions,
    archivedGameSeconds,
  } = useLibrarySessionState();
  const libraryTab = useAppStore((state) => state.libraryTab);
  const setLibraryTab = useAppStore((state) => state.setLibraryTab);
  const setLibraryImportProvider = useAppStore(
    (state) => state.setLibraryImportProvider,
  );
  const setActiveView = useAppStore((state) => state.setActiveView);
  const playtimeAdjustments = useAppStore((state) => state.playtimeAdjustments);
  const exeCache = useAppStore((state) => state.exeCache);
  const scopedExeLinks = useAppStore((state) => state.scopedExeLinks);
  const libraryImports = useAppStore((state) => state.libraryImports);
  const playcounterLibrary = useAppStore((state) => state.playcounterLibrary);
  const libraryInstalls = useAppStore((state) => state.libraryInstalls);
  const hydratedGameMetadata = useAppStore((state) => state.gameMetadata);
  const emulatorMappings = useAppStore((state) => state.emulatorMappings);
  const showDurationDays = useAppStore(
    (state) => state.settings.showDurationDays,
  );
  const cardSize = useAppStore(
    (state) => state.settings.libraryCardSize ?? "grid",
  );
  const gridColumns = useAppStore(
    (state) => state.settings.libraryGridColumns ?? null,
  );
  const gridLayout = useLibraryGridColumns(
    cardSize,
    tourDemo.active ? 3 : gridColumns,
  );
  const sortKey = useAppStore(
    (state) => state.settings.librarySortKey ?? "recent",
  );
  const showOrigin = useAppStore(
    (state) => state.settings.libraryShowOriginBadges !== false,
  );
  const showMatch = useAppStore(
    (state) => state.settings.libraryShowMatchBadges !== false,
  );
  const showStatus = useAppStore(
    (state) => state.settings.libraryShowStatusBadges !== false,
  );
  const showNotes = useAppStore(
    (state) => state.settings.libraryShowNoteBadges !== false,
  );
  const setMyGamesCardSize = useAppStore((state) => state.setMyGamesCardSize);
  const setMyGamesGridColumns = useAppStore(
    (state) => state.setMyGamesGridColumns,
  );
  const setMyGamesSortKey = useAppStore((state) => state.setMyGamesSortKey);
  const setMyGamesShowOriginBadges = useAppStore(
    (state) => state.setMyGamesShowOriginBadges,
  );
  const setMyGamesShowMatchBadges = useAppStore(
    (state) => state.setMyGamesShowMatchBadges,
  );
  const setMyGamesShowStatusBadges = useAppStore(
    (state) => state.setMyGamesShowStatusBadges,
  );
  const setMyGamesShowNoteBadges = useAppStore(
    (state) => state.setMyGamesShowNoteBadges,
  );
  const highResCovers = useAppStore(
    (state) => state.settings.libraryHighResCovers === true,
  );
  const setMyGamesHighResCovers = useAppStore(
    (state) => state.setMyGamesHighResCovers,
  );
  const showStatCards = useAppStore(
    (state) => state.settings.libraryShowStatCards !== false,
  );
  const showShelves = useAppStore(
    (state) => state.settings.libraryShowShelves !== false,
  );
  const setMyGamesShowShelves = useAppStore(
    (state) => state.setMyGamesShowShelves,
  );
  const selectedShelf = showShelves
    ? personalShelves.find((shelf) => shelf.id === shelfSelection)
    : undefined;
  const editShelfFilters = filtersOpen && Boolean(selectedShelf);
  const sourceBeforeFilterEdit = useRef(libraryTab);
  const changeFiltersOpen = useCallback(
    (open: boolean, saved = false) => {
      if (open)
        sourceBeforeFilterEdit.current = useAppStore.getState().libraryTab;
      if (!open && selectedShelf) {
        selectShelf(selectedShelf.id);
        const savedSource = useAppStore
          .getState()
          .personalShelves.find((shelf) => shelf.id === selectedShelf.id)
          ?.filters?.source;
        if (!saved && !savedSource)
          useAppStore.getState().setLibraryTab(sourceBeforeFilterEdit.current);
      }
      setFiltersOpen(open);
    },
    [selectedShelf, selectShelf],
  );
  // A search started outside My Games widens the library to every game: the
  // shelf, source and filters left over from last time would otherwise hide
  // the very results the search was after. The text itself is kept.
  const libraryScopeReset = useAppStore((state) => state.libraryScopeReset);
  const lastScopeReset = useRef(libraryScopeReset);
  useEffect(() => {
    if (libraryScopeReset === lastScopeReset.current) return;
    lastScopeReset.current = libraryScopeReset;
    setShelfSelection("all");
    setLibraryFilters({});
    setFiltersOpen(false);
  }, [libraryScopeReset]);
  const clearLibraryFilters = useCallback(() => {
    setLibraryFilters({});
    setQuery("");
    setLibraryTab("all");
  }, [setLibraryTab, setQuery]);
  const statCardSetting = useAppStore(
    (state) => state.settings.libraryStatCards,
  );
  const setMyGamesShowStatCards = useAppStore(
    (state) => state.setMyGamesShowStatCards,
  );
  const setMyGamesStatCards = useAppStore((state) => state.setMyGamesStatCards);
  const showProviderTabs = useAppStore(
    (state) => state.settings.libraryShowProviderTabs !== false,
  );
  const setMyGamesShowProviderTabs = useAppStore(
    (state) => state.setMyGamesShowProviderTabs,
  );
  const hideEmptyProviderTabs = useAppStore(
    (state) => state.settings.libraryHideEmptyProviderTabs === true,
  );
  const setMyGamesHideEmptyProviderTabs = useAppStore(
    (state) => state.setMyGamesHideEmptyProviderTabs,
  );
  const statCardIds = useMemo(
    () => resolveLibraryStatCardIds({ libraryStatCards: statCardSetting }),
    [statCardSetting],
  );
  const view = cardSize;
  const gameLaunchingEnabled = useAppStore(
    (state) => state.settings.gameLaunchingEnabled === true,
  );
  const userIgnoredProcesses = useAppStore(
    (state) => state.userIgnoredProcesses,
  );
  const blacklist = useAppStore((state) => state.blacklist);
  const addToast = useAppStore((state) => state.addToast);
  const removeLibraryImport = useAppStore((state) => state.removeLibraryImport);
  const resolveIgdbId = useMemo(
    () =>
      createGameIdentityResolver(
        hydratedGameMetadata,
        exeCache,
        libraryImports,
      ),
    [exeCache, hydratedGameMetadata, libraryImports],
  );
  const providerFloorSeconds = useMemo(
    () => providerFloorRecord(providerFloors(libraryImports.values())),
    [libraryImports],
  );
  const localLinks = useMemo(
    () => listLocalLinks(exeCache, scopedExeLinks),
    [exeCache, scopedExeLinks],
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
    if (!renderContent) return;
    setDemoPlaytime({
      addedSeconds: 0,
      addedSessions: 0,
      adjustmentSeconds: 0,
    });
    setLibraryTab("all");
  }, [renderContent, tourDemo.active, tourDemo.resetToken]);

  // Hovering a card reveals its .exe names only while Shift is held.
  useEffect(() => {
    const setShiftHeld = (held: boolean) => {
      document.body.classList.toggle("shift-held", held);
    };
    const syncFromKey = (event: KeyboardEvent) => setShiftHeld(event.shiftKey);
    const clearShift = () => setShiftHeld(false);
    window.addEventListener("keydown", syncFromKey);
    window.addEventListener("keyup", syncFromKey);
    window.addEventListener("blur", clearShift);
    return () => {
      window.removeEventListener("keydown", syncFromKey);
      window.removeEventListener("keyup", syncFromKey);
      window.removeEventListener("blur", clearShift);
      clearShift();
    };
  }, []);

  useEffect(() => {
    const toggleControllerCardSize = () => {
      setMyGamesCardSize(cardSize === "large" ? "grid" : "large");
      requestAnimationFrame(() => {
        document
          .querySelector<HTMLElement>('[data-controller-selected="true"]')
          ?.scrollIntoView({ block: "center", inline: "nearest" });
      });
    };
    window.addEventListener(
      CONTROLLER_LIBRARY_VIEW_EVENT,
      toggleControllerCardSize,
    );
    return () =>
      window.removeEventListener(
        CONTROLLER_LIBRARY_VIEW_EVENT,
        toggleControllerCardSize,
      );
  }, [cardSize, setMyGamesCardSize]);

  useEffect(() => {
    if (tourDemo.active || !gameLaunchingEnabled) return;
    void verifyLaunchTargetsThrottled("my-games");
  }, [gameLaunchingEnabled, tourDemo.active]);

  useEffect(() => {
    const nowMs = Date.now();
    const nextPromotionAt = activeSessions.reduce<number | null>(
      (nearest, session) => {
        const promotionAt =
          Date.parse(session.startedAt) + LAST_PLAYED_PROMOTION_DELAY_MS;
        if (!Number.isFinite(promotionAt) || promotionAt <= nowMs) {
          return nearest;
        }
        return nearest === null ? promotionAt : Math.min(nearest, promotionAt);
      },
      null,
    );
    if (nextPromotionAt === null) return;

    const timer = window.setTimeout(
      () => setRecentSortNow(Date.now()),
      Math.max(0, nextPromotionAt - nowMs) + 10,
    );
    return () => window.clearTimeout(timer);
  }, [activeSessions, recentSortNow]);

  const games = useMemo(() => {
    const ignoredExeNames = new Set([...userIgnoredProcesses, ...blacklist]);
    const isIgnored = (exeName: string) =>
      matchesProcessPatternSet(exeName, ignoredExeNames);
    const metadata = matchedEntriesByGame(
      [
        ...exeCache.values(),
        ...[...scopedExeLinks.values()].map<ExeCacheEntry>((link) => ({
          exeName: link.exeName,
          state: "matched",
          gameId: link.gameId,
          igdbId: link.igdbId,
          gameName: link.gameName,
          coverUrl: link.coverUrl,
          source: link.source,
          identifierSource: link.identifierSource,
          pendingCommunityGame: link.pendingCommunityGame,
          communitySuggestionId: link.communitySuggestionId,
          communitySuggestionVerified: link.communitySuggestionVerified,
          communitySuggestionStatus: link.communitySuggestionStatus,
          communitySuggestionNote: link.communitySuggestionNote,
          shareState: link.shareState,
          lastCheckedAt: link.setAt,
        })),
      ].filter((entry) => !isIgnored(entry.exeName)),
      resolveIgdbId,
    );
    const summaries = new Map<string, GameSummary>();
    const summariesWithPlayEvidence = new Set<string>();

    const mergeEmulatorProvenance = (
      summary: GameSummary,
      provenance: EmulatorMatchProvenance,
    ) => {
      if (provenance.source) {
        summary.emulatorSources ??= [];
        if (!summary.emulatorSources.includes(provenance.source)) {
          summary.emulatorSources.push(provenance.source);
        }
      }
      summary.emulatorApproval ??= provenance.approval;
    };

    const addAlias = (
      summary: GameSummary,
      gameId: number,
      source: GameSource | null | undefined,
      identifierSource?: GameSource | null,
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
      const badgeSource =
        identifierSource === undefined
          ? summary.hasExplicitIdentifierSource
            ? null
            : source
          : identifierSource;
      if (badgeSource && !summary.sources.includes(badgeSource)) {
        summary.sources.push(badgeSource);
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
        if (
          entry.identifierSource !== undefined &&
          !summary.hasExplicitIdentifierSource
        ) {
          summary.sources = [];
          summary.hasExplicitIdentifierSource = true;
        }
        addAlias(summary, entry.gameId, entry.source, entry.identifierSource);
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
      // Identity aliases and match badges are collected independently below.
      sources: [],
      aliases: [{ gameId: params.gameId, source: params.source ?? null }],
      totalSeconds: 0,
      sessionSeconds: 0,
      archivedSeconds: 0,
      adjustmentSeconds: 0,
      recordedSeconds: 0,
      sessionCount: 0,
      historyGameKey: params.historyGameKey ?? null,
      lastPlayedAt: params.lastPlayedAt,
      exeNames: params.exeName ? [params.exeName] : [],
      emulatorLabels: [],
      emulatorIds: [],
      emulatorContentKeys: [],
      libraryImports: [],
      providerFloorSeconds: 0,
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
      addAlias(
        existing,
        session.gameId,
        session.source,
        session.emulator ? null : undefined,
      );
      if (session.source !== resolvedSource) {
        addAlias(
          existing,
          session.gameId,
          resolvedSource,
          session.emulator ? null : undefined,
        );
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
      summariesWithPlayEvidence.add(summaryKey);
      if (!existing.exeNames.includes(session.exeName)) {
        existing.exeNames.push(session.exeName);
      }
      if (session.emulator) {
        mergeEmulatorProvenance(
          existing,
          emulatorSessionProvenance(
            session,
            emulatorMappings.get(session.emulator.contentKey),
          ),
        );
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
      const promoteForRecentSort = shouldPromoteActiveGame(
        activeSession.startedAt,
        recentSortNow,
      );
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
      const gameEntries = metadata.get(summaryKey) ?? [];
      const previousLibraryTimestamp = gameEntries.reduce<string | null>(
        (latest, entry) =>
          latest === null ||
          Date.parse(entry.lastCheckedAt) > Date.parse(latest)
            ? entry.lastCheckedAt
            : latest,
        null,
      );
      let existing = summaries.get(summaryKey);

      if (!existing) {
        existing = createSummary({
          gameId: activeSession.gameId,
          igdbId,
          name: activeSession.gameName || hydratedMeta?.name || "",
          coverUrl: activeSession.coverUrl || hydratedMeta?.coverUrl || "",
          source: resolvedSource,
          lastPlayedAt:
            promoteForRecentSort || previousLibraryTimestamp === null
              ? activeSession.checkpointedAt
              : previousLibraryTimestamp,
          exeName: activeSession.exeName,
        });
        summaries.set(summaryKey, existing);
      }
      addAlias(
        existing,
        activeSession.gameId,
        activeSession.source,
        activeSession.emulator ? null : undefined,
      );
      if (activeSession.source !== resolvedSource) {
        addAlias(
          existing,
          activeSession.gameId,
          resolvedSource,
          activeSession.emulator ? null : undefined,
        );
      }
      for (const entry of gameEntries) {
        mergeEntry(existing, entry);
      }
      existing.sessionSeconds += activeSeconds;
      if (promoteForRecentSort) {
        existing.lastPlayedAt = activeSession.checkpointedAt;
        summariesWithPlayEvidence.add(summaryKey);
        if (
          existing.activeStartedAt === undefined ||
          Date.parse(activeSession.startedAt) >
            Date.parse(existing.activeStartedAt)
        ) {
          existing.activeStartedAt = activeSession.startedAt;
        }
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
        mergeEmulatorProvenance(
          existing,
          emulatorSessionProvenance(
            activeSession,
            emulatorMappings.get(activeSession.emulator.contentKey),
          ),
        );
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

    for (const entry of playcounterLibrary.values()) {
      const summaryKey = `igdb#${entry.igdbId}`;
      let summary = summaries.get(summaryKey);
      if (!summary) {
        summary = createSummary({
          gameId: entry.gameId,
          igdbId: entry.igdbId,
          name: entry.name,
          coverUrl: entry.coverUrl,
          source: entry.source,
          lastPlayedAt: entry.lastPlayedAt ?? entry.addedAt,
          exeName: "",
          historyGameKey: summaryKey,
        });
        summaries.set(summaryKey, summary);
      }
      addAlias(summary, entry.gameId, entry.source, null);
      for (const alias of entry.aliases ?? []) {
        addAlias(summary, alias.gameId, alias.source, null);
      }
      if (entry.lastPlayedAt) {
        summary.lastPlayedAt = mergeLastPlayedEvidence(
          summary.lastPlayedAt,
          entry.lastPlayedAt,
          summariesWithPlayEvidence.has(summaryKey),
        );
        summariesWithPlayEvidence.add(summaryKey);
      }
    }

    for (const entry of libraryImports.values()) {
      const summaryKey = `igdb#${entry.igdbId}`;
      let summary = summaries.get(summaryKey);
      if (!summary) {
        summary = createSummary({
          gameId: entry.gameId,
          igdbId: entry.igdbId,
          name: entry.name,
          coverUrl: entry.coverUrl,
          source: null,
          lastPlayedAt: entry.providerLastPlayedAt ?? entry.importedAt,
          exeName: entry.linkedExeNames[0] ?? "",
          historyGameKey: summaryKey,
        });
        summaries.set(summaryKey, summary);
      }
      if (entry.providerLastPlayedAt) {
        summary.lastPlayedAt = mergeLastPlayedEvidence(
          summary.lastPlayedAt,
          entry.providerLastPlayedAt,
          summariesWithPlayEvidence.has(summaryKey),
        );
        summariesWithPlayEvidence.add(summaryKey);
      }
      if (
        !summary.aliases.some(
          (alias) =>
            alias.gameId === entry.gameId && alias.source === entry.source,
        )
      ) {
        summary.aliases.push({ gameId: entry.gameId, source: entry.source });
      }
      for (const source of entry.linkedExeSources) {
        addAlias(summary, entry.gameId, entry.source, source);
      }
      if (summary.source === null) {
        summary.gameId = entry.gameId;
        summary.source = entry.source;
      }
      summary.igdbId = entry.igdbId;
      summary.name ||= entry.name;
      summary.coverUrl ||= entry.coverUrl;
      for (const exeName of entry.linkedExeNames) {
        if (!summary.exeNames.includes(exeName)) summary.exeNames.push(exeName);
      }
      if (
        !summary.libraryImports.some(
          (item) =>
            item.provider === entry.provider &&
            item.externalId === entry.externalId,
        )
      ) {
        const key = libraryEntryKey(entry.provider, entry.externalId);
        const install = libraryInstalls.get(key);
        summary.libraryImports.push({
          provider: entry.provider,
          externalId: entry.externalId,
          installed: Boolean(install),
          entry,
          install,
        });
      }
    }

    for (const mapping of emulatorMappings.values()) {
      if (
        mapping.decision !== "game" ||
        mapping.gameId === undefined ||
        !adapterFor(mapping.emulatorId)?.launch
      ) {
        continue;
      }
      const source = mapping.source ?? null;
      const summaryKey = resolvedCanonicalGameKey(
        {
          gameId: mapping.gameId,
          source,
          igdbId: mapping.igdbId,
          gameName: mapping.gameName,
          coverUrl: mapping.coverUrl,
        },
        resolveIgdbId,
      );
      let summary = summaries.get(summaryKey);
      if (!summary) {
        summary = createSummary({
          gameId: mapping.gameId,
          igdbId: mapping.igdbId,
          name: mapping.gameName ?? mapping.display,
          coverUrl: mapping.coverUrl ?? "",
          source,
          lastPlayedAt: mapping.lastSeenAt,
          exeName: "",
          historyGameKey: summaryKey,
        });
        summaries.set(summaryKey, summary);
      }
      addAlias(summary, mapping.gameId, source, null);
      mergeEmulatorProvenance(summary, emulatorMappingProvenance(mapping));
      if (!summary.emulatorContentKeys.includes(mapping.contentKey)) {
        summary.emulatorContentKeys.push(mapping.contentKey);
      }
      if (!summary.emulatorIds.includes(mapping.emulatorId)) {
        summary.emulatorIds.push(mapping.emulatorId);
      }
      const label = `${mapping.label} · ${mapping.display}`;
      if (!summary.emulatorLabels.includes(label)) {
        summary.emulatorLabels.push(label);
      }
    }

    const consumedKeys = new Set<string>();
    for (const summary of summaries.values()) {
      // Native/imported evidence can coexist with an emulator route for the
      // same game. Keep both; never add IGDB merely for the metadata namespace.
      const emulatorSources = summary.emulatorSources ?? [];
      summary.emulatorSources = emulatorSources.filter(
        (source) => !summary.sources.includes(source),
      );
      summary.sources = [
        ...new Set([...summary.sources, ...emulatorSources]),
      ].sort((left, right) => sourceRank(left) - sourceRank(right));
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
      const summaryKey = providerFloorKey(summary);
      summary.hasLastPlayedEvidence = summariesWithPlayEvidence.has(summaryKey);
      summary.providerFloorSeconds = providerFloorSeconds[summaryKey] ?? 0;
      summary.totalSeconds = effectiveTotalSeconds(
        summary.recordedSeconds,
        summary.adjustmentSeconds,
        summary.providerFloorSeconds,
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
    emulatorMappings,
    hydratedGameMetadata,
    libraryImports,
    libraryInstalls,
    playcounterLibrary,
    playtimeAdjustments,
    providerFloorSeconds,
    recentSortNow,
    resolveIgdbId,
    scopedExeLinks,
    sessions,
    userIgnoredProcesses,
  ]);

  const demoGames = useMemo<GameSummary[]>(() => {
    if (!tourDemo.active) return [];
    if (tourDemo.tourId === "core") return makeCoreTourDemoGames();
    if (tourDemo.tourId === "emulators")
      return [
        {
          ...makeCoreTourDemoGames()[0],
          gameId: TOUR_DEMO_EMULATOR.gameId,
          name: TOUR_DEMO_EMULATOR.gameName,
          coverUrl: TOUR_DEMO_EMULATOR.coverUrl,
          source: "igdb",
          sources: ["igdb"],
          totalSeconds: 24000,
          sessionSeconds: 24000,
          recordedSeconds: 24000,
          sessionCount: 5,
          emulatorIds: ["dolphin"],
          emulatorLabels: ["Dolphin"],
          exeNames: ["dolphin.exe"],
        },
      ];
    return [
      makeTourDemoGame(
        demoPlaytime.addedSeconds,
        demoPlaytime.addedSessions,
        tourDemo.tourId === "source-badges",
        tourDemo.tourId === "game-actions" ? "community" : null,
        demoPlaytime.adjustmentSeconds,
      ),
    ];
  }, [demoPlaytime, tourDemo.active, tourDemo.tourId]);
  const isCoreTourDemo = tourDemo.active && tourDemo.tourId === "core";
  const allLibraryGames = tourDemo.active ? demoGames : games;
  // Only shelves empty across the full library should preview every game.
  const allShelfCounts = useMemo(
    () =>
      countShelfGames(
        tourDemo.active ? demoGames : games,
        journalFor,
        personalShelves,
      ),
    [games, demoGames, tourDemo.active, journalFor, personalShelves],
  );
  // Apply shelf rules before the source selection so every badge describes
  // the games available in that source within the current view.
  const shelfGames = useMemo(() => {
    const savedFilterSelected = personalShelves.some(
      (s) => s.id === shelfSelection && s.filters,
    );
    // Filters stand in for the shelf's own membership while there is a filter
    // set to preview, and an empty shelf previews the whole library so the
    // drawer has something to narrow. Cleared back to "any" on a shelf that
    // holds games, they describe nothing: the shelf means its games again.
    const previewFilters =
      (savedFilterSelected || editShelfFilters) &&
      (Object.keys(normalizeLibraryFilters(libraryFilters)).length > 0 ||
        (allShelfCounts[shelfSelection] ?? 0) === 0);
    return games.filter((game) => {
      const journal = journalFor({ ...game, gameName: game.name });
      return (
        (previewFilters ||
          matchesShelf(game, journal, shelfSelection, personalShelves)) &&
        matchesLibraryFilters(game, journal, libraryFilters, recentSortNow)
      );
    });
  }, [
    games,
    journalFor,
    shelfSelection,
    personalShelves,
    editShelfFilters,
    libraryFilters,
    recentSortNow,
    allShelfCounts,
  ]);
  const matchingGames = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle
      ? shelfGames.filter(
          (game) =>
            game.name.toLowerCase().includes(needle) ||
            game.emulatorLabels.some((label) =>
              label.toLowerCase().includes(needle),
            ),
        )
      : shelfGames;
  }, [query, shelfGames]);
  const platform = currentPlatform();
  const providerTabGames = useMemo(
    () =>
      PROVIDER_TAB_CONFIGS.map((config) => ({
        config,
        games: filterByLibraryTab(games, config.id),
      })),
    [games],
  );
  const providerTabInputs = useMemo(
    () =>
      providerTabGames.map(({ config, games: providerGames }) => ({
        provider: config.id,
        label: config.label,
        importSupported:
          config.import.kind === "builtin" &&
          config.import.platforms.includes(platform),
        gameCount: providerGames.length,
      })),
    [platform, providerTabGames],
  );
  const unimportedGames = useMemo(
    () => filterByLibraryTab(games, "unimported"),
    [games],
  );
  const hasImportedGames = providerTabInputs.some(
    (provider) => provider.gameCount > 0,
  );
  const canHideEmptyProviderTabs =
    showProviderTabs &&
    hasImportedGames &&
    hasEmptyProviderTabs(providerTabInputs);
  // Tab visibility and import prompts still depend on the full library:
  // a shelf with no matches must not hide a source or imply it was never imported.
  const tabs = visibleLibraryTabs({
    showProviders: showProviderTabs,
    hideEmptyProviders: hideEmptyProviderTabs,
    allTabCount: allLibraryGames.length,
    unimportedGameCount: unimportedGames.length,
    providers: providerTabInputs,
  }).map((tab) => ({
    ...tab,
    count:
      tab.id === "all" && isCoreTourDemo
        ? demoGames.length
        : filterByLibraryTab(matchingGames, tab.id).length +
          (tab.id === "all" ? demoGames.length : 0),
  }));
  const activeLibraryTab = resolveLibraryTab(libraryTab, tabs);
  useEffect(() => {
    if (libraryTab !== activeLibraryTab) setLibraryTab(activeLibraryTab);
  }, [activeLibraryTab, libraryTab, setLibraryTab]);
  const activeTabDescriptor = tabs.find((tab) => tab.id === activeLibraryTab);
  const activeProviderConfig =
    activeTabDescriptor?.kind === "provider"
      ? providerTabConfig(activeTabDescriptor.id)
      : undefined;
  const activeImportableProviderConfig = isImportableProviderTabConfig(
    activeProviderConfig,
  )
    ? activeProviderConfig
    : undefined;
  const sourceGames = useMemo(() => {
    if (activeLibraryTab === "all") return games;
    if (activeLibraryTab === "unimported") return unimportedGames;
    return (
      providerTabGames.find((entry) => entry.config.id === activeLibraryTab)
        ?.games ?? []
    );
  }, [activeLibraryTab, games, providerTabGames, unimportedGames]);
  const shelfCounts = useMemo(
    () =>
      sourceGames === games
        ? allShelfCounts
        : countShelfGames(sourceGames, journalFor, personalShelves),
    [sourceGames, games, allShelfCounts, journalFor, personalShelves],
  );
  const tabGames = useMemo(
    () => filterByLibraryTab(shelfGames, activeLibraryTab),
    [shelfGames, activeLibraryTab],
  );
  const activeTabKind = activeTabDescriptor?.kind ?? "all";
  const statTabLabel =
    activeProviderConfig?.label ??
    (activeTabKind === "unimported" ? "PlayCounter" : "All games");
  const availableStatDefinitions = useMemo(
    () => libraryStatDefinitionsForKind(activeTabKind),
    [activeTabKind],
  );
  const displayedGames = useMemo(() => {
    const sorted = filterByLibraryTab(matchingGames, activeLibraryTab);
    sorted.sort((left, right) => compareMyGames(left, right, sortKey));
    return sorted;
  }, [activeLibraryTab, matchingGames, sortKey]);
  // Counted from what the library actually shows, search included, so the
  // numbers never contradict the count sitting right next to them.
  const statCards = useMemo(() => {
    if (!showStatCards || statCardIds.length === 0) return [];
    const metrics = summarizeLibraryStats(
      tourDemo.active ? demoGames : displayedGames,
      {
        provider: activeProviderConfig?.id,
        providerFloorSeconds: activeProviderConfig
          ? providerFloorRecord(
              providerFloorsForProvider(
                libraryImports.values(),
                activeProviderConfig.id,
              ),
            )
          : undefined,
        nowMs: recentSortNow,
      },
    );
    return libraryStatCards(statCardIds, metrics, {
      kind: activeTabKind,
      providerLabel: activeProviderConfig?.label,
    });
  }, [
    activeProviderConfig,
    activeTabKind,
    libraryImports,
    recentSortNow,
    showStatCards,
    statCardIds,
    displayedGames,
    demoGames,
    tourDemo.active,
  ]);
  const bulkSelection = useLibrarySelection(
    displayedGames,
    `${activeLibraryTab}\u0000${query}\u0000${shelfSelection}\u0000${JSON.stringify(libraryFilters)}\u0000${editShelfFilters}`,
    !tourDemo.active,
  );
  const libraryDrag = useLibraryGameDrag(
    bulkSelection.selectedGames,
    bulkSelection.finish,
  );
  const selectedLauncherGames = useMemo(
    () =>
      displayedGames.filter(
        (game) =>
          bulkSelection.selected.has(librarySelectionKey(game)) &&
          game.libraryImports.length > 0,
      ),
    [displayedGames, bulkSelection.selected],
  );
  const demoForTab = activeLibraryTab === "all" ? demoGames : [];
  const libraryGames =
    isCoreTourDemo && activeLibraryTab === "all"
      ? demoGames
      : [...demoForTab, ...tabGames];
  const visibleGames =
    isCoreTourDemo && activeLibraryTab === "all"
      ? demoGames
      : [...demoForTab, ...displayedGames];
  const layout = myGamesLayout({
    libraryGameCount: allLibraryGames.length,
    tabs,
    requestedTab: libraryTab,
    activeTabGameCount: sourceGames.length + demoForTab.length,
    visibleGameCount: visibleGames.length,
    importSupported: importableProviderTabs(platform).length > 0,
  });
  const defaultFeatured = useMemo(
    () => pickFeaturedGame(games, featuredSetting),
    [featuredSetting, games],
  );
  const featured = useMemo(
    () =>
      selectedShelf?.featuredGame
        ? pickFeaturedGame(games, selectedShelf.featuredGame, featuredSetting)
        : defaultFeatured,
    [defaultFeatured, featuredSetting, games, selectedShelf?.featuredGame],
  );
  const shelfBannerPinned = Boolean(
    featured &&
    selectedShelf?.featuredGame &&
    matchesFeaturedGame(featured.game, selectedShelf.featuredGame),
  );
  const heroVisible =
    renderContent &&
    showHero &&
    layout.panel !== "empty-library" &&
    featured !== null &&
    !isCoreTourDemo;
  useEffect(() => {
    publishLibrarySources({
      tabs,
      activeTab: activeLibraryTab,
      gameCount: isCoreTourDemo
        ? demoGames.length
        : matchingGames.length + demoGames.length,
      visible: layout.showTabs,
      heroVisible,
      heroArt: heroVisible ? useLibrarySources.getState().heroArt : null,
      featured: defaultFeatured,
      ready: true,
      nowArt: useLibrarySources.getState().nowArt,
    });
  });
  useEffect(
    () => () =>
      publishLibrarySources({
        ...useLibrarySources.getState(),
        heroVisible: false,
      }),
    [],
  );
  const renderWindowKey = `${activeLibraryTab}\u0000${query}\u0000${sortKey}\u0000${view}\u0000${shelfSelection}\u0000${JSON.stringify(libraryFilters)}`;
  const renderWindow = useLibraryRenderWindow(
    renderWindowKey,
    visibleGames.length,
  );
  const renderedGames = visibleGames.slice(0, renderWindow.limit);

  const demoNotice = useCallback(
    () =>
      addToast({
        tone: "info",
        title: "Tutorial game",
        detail: "The sample exists only for this guide - nothing was saved.",
      }),
    [addToast],
  );
  const requestRemoval = useCallback(
    (game: GameSummary) => {
      if (isTourDemoLibraryGame(game)) {
        demoNotice();
        return;
      }
      setPendingRemoval({
        gameId: game.gameId,
        source: game.source,
        name: game.name,
        aliases: game.aliases,
        libraryImports: game.libraryImports,
      });
    },
    [demoNotice],
  );
  const requestStopTracking = useCallback((game: GameSummary) => {
    if (!game.source || isTourDemoLibraryGame(game)) return;
    setPendingStopTracking({
      gameId: game.gameId,
      source: game.source,
      name: game.name,
      exeNames: game.exeNames,
      emulatorLabels: game.emulatorLabels,
      sessionCount: game.sessionCount,
      aliases: game.aliases,
    });
  }, []);

  // Other views can request the shared library data without mounting cards.
  // Once My Games has been opened, App keeps its content mounted as before.
  if (!renderContent) return null;

  return (
    <div ref={bulkSelection.rootRef} onKeyDown={bulkSelection.onKeyDown}>
      {tourDemo.active && tourDemo.tourId === "source-badges" ? (
        <div
          data-tour="demo-origin-examples"
          className="mb-4 grid gap-3 rounded-xl border border-border bg-surface p-4 text-sm"
        >
          <h3 className="font-semibold">
            Badge examples: origin and recognition
          </h3>
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-text-muted">Launcher origin</span>
            <ProviderBadge provider="steam" />
            <ProviderBadge provider="xbox" />
            <ProviderBadge provider="battlenet" />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-text-muted">Emulator</span>
            <EmulatorBadge emulatorId="dolphin" label="Dolphin" />
            <span className="text-text-muted">File match</span>
            <SourceBadge source="community" />
          </div>
          <p className="text-xs text-text-muted">
            An origin badge describes where a game came from. A file match
            explains how it was recognized. Neither alone proves a launch file
            is saved on this PC.
          </p>
        </div>
      ) : null}
      <LibraryGameDropHint
        hint={libraryDrag.hint}
        onDismiss={libraryDrag.dismissHint}
      />
      {layout.panel === "empty-library" ? (
        <EmptyLibraryPanel platform={platform} />
      ) : (
        <>
          {heroVisible && featured ? (
            <GameBanner
              key={`${selectedShelf?.id ?? "all"}:${featured.game.source ?? "unknown"}:${featured.game.gameId}`}
              game={featured.game}
              pinned={selectedShelf ? shelfBannerPinned : featured.pinned}
              shelfName={selectedShelf?.name}
              onArtworkChange={publishLibraryHeroArt}
              launchKey="library-hero"
              launchBlocked={launchingGameKey !== null}
              onAcquireLaunch={acquireLaunchLock}
              onReleaseLaunch={releaseLaunchLock}
              onPin={() => {
                const featuredGame = {
                  gameId: featured.game.gameId,
                  source: featured.game.source,
                  igdbId: featured.game.igdbId,
                };
                if (selectedShelf)
                  savePersonalShelf({ ...selectedShelf, featuredGame });
                else setLibraryFeaturedGame(featuredGame);
              }}
              onUnpin={() => {
                if (selectedShelf)
                  savePersonalShelf({ ...selectedShelf, featuredGame: null });
                else setLibraryFeaturedGame(null);
              }}
              onHide={() => setMyGamesShowHero(false)}
            />
          ) : null}

          <div className="grid gap-5">
            <div data-tour="games-toolbar" className="grid gap-3">
              <LibraryOrganizationToolbar
                showShelves={showShelves}
                selection={shelfSelection}
                onSelect={selectShelf}
                filters={libraryFilters}
                onFiltersChange={({ source, search, ...filters }) => {
                  setLibraryFilters(filters);
                  if (source !== undefined) setLibraryTab(source);
                  if (search !== undefined) setQuery(search);
                }}
                expanded={filtersOpen}
                onExpandedChange={changeFiltersOpen}
                onClearFilters={clearLibraryFilters}
                source={activeLibraryTab}
                query={query}
                counts={shelfCounts}
                leading={
                  <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
                    <h2 className="shrink-0 truncate text-[22px] font-bold tracking-tight text-text">
                      {activeProviderConfig
                        ? activeProviderConfig.headline
                        : activeTabKind === "unimported"
                          ? "PlayCounter games"
                          : "All games"}
                    </h2>
                    <LibrarySummaryChip
                      countLabel={
                        visibleGames.length === libraryGames.length
                          ? String(visibleGames.length)
                          : `${visibleGames.length} / ${libraryGames.length}`
                      }
                      countTitle={`${visibleGames.length} of ${libraryGames.length} tracked ${activeProviderConfig ? `${activeProviderConfig.label} games` : "games"}`}
                      // Turning the whole summary off leaves the plain count:
                      // "Games" is a choice among the numbers, not a way to
                      // lose the count while the rest of the row is hidden.
                      showCount={
                        !showStatCards || statCardIds.includes("games")
                      }
                      cards={statCards}
                      showDurationDays={showDurationDays}
                    />
                    {/* The empty tab has its own big import callout; two
                        buttons for the same thing would only compete. */}
                    {layout.panel !== "provider-empty" &&
                    activeImportableProviderConfig?.import.platforms.includes(
                      platform,
                    ) ? (
                      <Button
                        variant="secondary"
                        icon={Download}
                        data-controller-item="view-link"
                        onClick={() => {
                          setLibraryImportProvider(
                            activeImportableProviderConfig.id,
                          );
                          setActiveView("import");
                        }}
                        className="h-8 shrink-0 rounded-lg px-2.5 text-[13px]"
                      >
                        {activeImportableProviderConfig.importCtaLabel}
                      </Button>
                    ) : null}
                  </div>
                }
                selectionAction={
                  <Button
                    variant={bulkSelection.active ? "primary" : "secondary"}
                    icon={CheckSquare}
                    data-library-select=""
                    aria-label="Select games"
                    aria-pressed={bulkSelection.active}
                    title={
                      bulkSelection.active
                        ? "Exit selection mode (Esc)"
                        : "Select games to set their status"
                    }
                    data-controller-item="library-option"
                    disabled={
                      tourDemo.active ||
                      (!displayedGames.length && !bulkSelection.active)
                    }
                    onClick={bulkSelection.toggleMode}
                    className="h-9 shrink-0"
                  >
                    {bulkSelection.active ? "Selecting" : "Select"}
                  </Button>
                }
                trailing={
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <Select
                      aria-label="Sort games"
                      value={sortKey}
                      onChange={(event) =>
                        setMyGamesSortKey(event.target.value as MyGamesSortKey)
                      }
                      className="h-9 rounded-lg !py-0 font-medium"
                    >
                      {sortOptions.map((option) => (
                        <option key={option.key} value={option.key}>
                          Sort: {option.label}
                        </option>
                      ))}
                    </Select>
                    <div className="flex h-9 items-center gap-0.5 rounded-lg border border-border bg-surface p-0.5">
                      <button
                        type="button"
                        aria-label="Grid view"
                        aria-pressed={view === "grid"}
                        title="Standard cards"
                        onClick={() => setMyGamesCardSize("grid")}
                        className={clsx(
                          "grid h-full w-8 place-items-center rounded-md transition",
                          view === "grid"
                            ? "bg-accent text-accent-fg"
                            : "text-text-muted hover:bg-surface-hover hover:text-text",
                        )}
                      >
                        <LayoutGrid size={15} />
                      </button>
                      <button
                        type="button"
                        aria-label="Large card view"
                        aria-pressed={view === "large"}
                        title="Large cards"
                        onClick={() => setMyGamesCardSize("large")}
                        className={clsx(
                          "grid h-full w-8 place-items-center rounded-md transition",
                          view === "large"
                            ? "bg-accent text-accent-fg"
                            : "text-text-muted hover:bg-surface-hover hover:text-text",
                        )}
                      >
                        <Grid2X2 size={16} />
                      </button>
                      <button
                        type="button"
                        aria-label="List view"
                        aria-pressed={view === "list"}
                        title="List"
                        onClick={() => setMyGamesCardSize("list")}
                        className={clsx(
                          "grid h-full w-8 place-items-center rounded-md transition",
                          view === "list"
                            ? "bg-accent text-accent-fg"
                            : "text-text-muted hover:bg-surface-hover hover:text-text",
                        )}
                      >
                        <List size={15} />
                      </button>
                    </div>
                    <IconButton
                      ref={customizeMenu.anchorRef}
                      icon={Settings2}
                      aria-label="Customize library view"
                      title="Customize"
                      aria-haspopup="true"
                      aria-expanded={customizeMenu.open}
                      aria-controls="library-customize"
                      data-controller-item="library-customize"
                      onClick={customizeMenu.toggle}
                      className="h-9 w-9 rounded-lg"
                    />
                  </div>
                }
              />

              <ContextMenu
                open={customizeMenu.open}
                position={{
                  x: customizeMenu.position.x - 400 + 36,
                  y: customizeMenu.position.y,
                }}
                onClose={customizeMenu.close}
                anchorRef={customizeMenu.anchorRef}
              >
                <div
                  id="library-customize"
                  role="group"
                  aria-label="Customize library view"
                  className="w-[400px] max-w-[calc(100vw-2rem)]"
                >
                  <header className="flex items-center gap-3 border-b border-border px-4 pb-3 pt-3.5">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-accent/20 bg-accent-tint text-accent-ink">
                      <Settings2 size={18} />
                    </span>
                    <div className="min-w-0">
                      <h2 className="text-base font-bold text-text">
                        Customize Library
                      </h2>
                      <p className="text-xs text-text-faint">
                        Adjust how your library looks and behaves.
                      </p>
                    </div>
                  </header>
                  <div className="grid gap-3 p-3">
                    <CustomizeSection
                      icon={PanelTop}
                      title="Layout"
                      hint="The main structure of your library."
                    >
                      <OptionRow
                        id="library-show-hero"
                        label="Hero banner"
                        help="The featured game above your library."
                        checked={showHero}
                        onChange={setMyGamesShowHero}
                      />
                      <LibraryLayoutControls
                        view={view}
                        gridLayout={gridLayout}
                        showShelves={showShelves}
                        setMyGamesGridColumns={setMyGamesGridColumns}
                        setMyGamesShowShelves={setMyGamesShowShelves}
                      />
                      <OptionRow
                        id="library-high-res-covers"
                        label="Sharper covers"
                        help="Larger cover art. Looks better on big cards, uses more data."
                        checked={highResCovers}
                        onChange={setMyGamesHighResCovers}
                      />
                    </CustomizeSection>

                    <CustomizeSection
                      icon={LayoutGrid}
                      title="Card details"
                      hint="What each game card shows."
                    >
                      <LibraryCardControls
                        showOrigin={showOrigin}
                        showMatch={showMatch}
                        showStatus={showStatus}
                        showNotes={showNotes}
                        setMyGamesShowOriginBadges={setMyGamesShowOriginBadges}
                        setMyGamesShowMatchBadges={setMyGamesShowMatchBadges}
                        setMyGamesShowStatusBadges={setMyGamesShowStatusBadges}
                        setMyGamesShowNoteBadges={setMyGamesShowNoteBadges}
                      />
                    </CustomizeSection>

                    <CustomizeSection
                      icon={FolderTree}
                      title="Library structure"
                      hint="How your games are grouped."
                    >
                      <OptionRow
                        id="library-show-provider-tabs"
                        label="Launcher groups"
                        help="Steam, Xbox and Battle.net as their own entries under My Games."
                        checked={showProviderTabs}
                        onChange={setMyGamesShowProviderTabs}
                      />
                      <OptionRow
                        id="library-hide-empty-tabs"
                        label="Hide empty sources"
                        help={
                          !showProviderTabs
                            ? "Turn on launcher groups to choose which sources appear."
                            : !hasImportedGames
                              ? "Launcher groups appear after you import games."
                              : canHideEmptyProviderTabs
                                ? "Hide launchers you have not imported from yet."
                                : "All sources in the sidebar have games."
                        }
                        checked={hideEmptyProviderTabs}
                        disabled={!canHideEmptyProviderTabs}
                        onChange={setMyGamesHideEmptyProviderTabs}
                      />
                      <OptionRow
                        id="library-show-stats"
                        label="Summary numbers"
                        help="The line of numbers beside the library title."
                        checked={showStatCards}
                        onChange={setMyGamesShowStatCards}
                      />
                      {showStatCards ? (
                        <fieldset className="py-2.5">
                          <legend className="text-[13px] font-medium text-text">
                            Numbers on the {statTabLabel} tab
                          </legend>
                          <p className="text-xs leading-4 text-text-faint">
                            The game count always keeps the first slot.
                          </p>
                          <div className="mt-2 grid gap-1 sm:grid-cols-2">
                            {availableStatDefinitions.map((definition) => {
                              const checked = statCardIds.includes(
                                definition.id,
                              );
                              return (
                                <label
                                  key={definition.id}
                                  title={definition.help}
                                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] text-text transition hover:bg-surface-hover"
                                >
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    data-controller-item="library-option"
                                    onChange={(event) =>
                                      setMyGamesStatCards(
                                        toggleLibraryStatCardIds(
                                          statCardIds,
                                          definition.id,
                                          event.target.checked,
                                        ),
                                      )
                                    }
                                    className="h-4 w-4 shrink-0 rounded border-border accent-accent"
                                  />
                                  <span className="min-w-0 truncate">
                                    {definition.label({
                                      kind: activeTabKind,
                                      providerLabel:
                                        activeProviderConfig?.label,
                                    })}
                                  </span>
                                </label>
                              );
                            })}
                          </div>
                        </fieldset>
                      ) : null}
                    </CustomizeSection>
                  </div>
                </div>
              </ContextMenu>
            </div>

            <div
              id="library-tabpanel"
              role={layout.showTabs ? "tabpanel" : undefined}
              aria-labelledby={
                layout.showTabs ? `library-tab-${activeLibraryTab}` : undefined
              }
              className="grid gap-5"
            >
              <p className="sr-only" aria-live="polite">
                {layout.panel === "provider-empty" && activeProviderConfig
                  ? `No ${activeProviderConfig.label} games imported yet. Use Import from ${activeProviderConfig.label} to add them.`
                  : layout.panel === "unimported-empty"
                    ? "No games outside your imported libraries yet."
                    : `Showing ${visibleGames.length} ${activeProviderConfig ? `${activeProviderConfig.label} games` : "games"}.`}
              </p>

              <LibraryBulkActions
                active={bulkSelection.active}
                count={bulkSelection.selected.size}
                total={displayedGames.length}
                onSelectAll={bulkSelection.selectAll}
                onClear={bulkSelection.clear}
                onDone={bulkSelection.finish}
                onStatus={bulkSelection.applyStatus}
                moveToPlayCounterCount={selectedLauncherGames.length}
                onMoveToPlayCounter={() =>
                  setPendingBulkMove({
                    games: selectedLauncherGames,
                    skippedCount:
                      bulkSelection.selected.size -
                      selectedLauncherGames.length,
                  })
                }
              />

              {layout.panel === "provider-empty" &&
              activeImportableProviderConfig ? (
                <ProviderImportCallout
                  config={activeImportableProviderConfig}
                />
              ) : layout.panel === "unimported-empty" ? (
                <Panel className="px-6 py-12 text-center">
                  <h3 className="text-lg font-semibold text-text">
                    Everything here came from an import
                  </h3>
                  <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-text-muted">
                    Games PlayCounter finds on its own show up here: a disc
                    install, a game file you started yourself, an emulator, or
                    anything you added by hand.
                  </p>
                </Panel>
              ) : layout.panel === "no-search-results" ? (
                <Panel className="px-4 py-12 text-center text-sm text-text-muted">
                  {selectedShelf &&
                  !selectedShelf.filters &&
                  !filtersOpen &&
                  !allShelfCounts[selectedShelf.id] &&
                  !query &&
                  !Object.keys(libraryFilters).length ? (
                    <div className="mx-auto grid max-w-md justify-items-center gap-3">
                      <h3 className="font-semibold text-text">
                        This shelf is empty
                      </h3>
                      <p>
                        Drag games onto this shelf, or save filters so it fills
                        itself.
                      </p>
                      <Button
                        icon={SlidersHorizontal}
                        onClick={() => changeFiltersOpen(true)}
                      >
                        Add filters
                      </Button>
                    </div>
                  ) : query ? (
                    <>No games match &ldquo;{query}&rdquo;.</>
                  ) : showShelves ? (
                    "No games match this shelf and these filters yet."
                  ) : (
                    "No games match these filters yet."
                  )}
                </Panel>
              ) : (
                <>
                  <div
                    ref={gridLayout.gridRef}
                    style={
                      tourDemo.active && cardSize !== "list"
                        ? {
                            gridTemplateColumns: `repeat(${Math.min(gridLayout.columns, 2)}, minmax(0, 260px))`,
                          }
                        : gridLayout.style
                    }
                    data-tour={isCoreTourDemo ? "core-library-demo" : undefined}
                    className={clsx(
                      "grid",
                      view === "grid" &&
                        "grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-[repeat(auto-fill,minmax(216px,1fr))]",
                      view === "large" &&
                        "grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-[repeat(auto-fill,minmax(300px,1fr))]",
                      view === "list" && "gap-3",
                    )}
                  >
                    {renderedGames.map((game) => {
                      const isDemo = isTourDemoLibraryGame(game);
                      const cardKey = isDemo
                        ? `tour-demo-${game.gameId}-${tourDemo.resetToken}`
                        : game.igdbId !== undefined
                          ? `igdb#${game.igdbId}`
                          : `${game.source ?? "unknown"}:${game.gameId}`;
                      return (
                        <MemoizedGameLibraryCard
                          key={cardKey}
                          launchKey={cardKey}
                          launchBlocked={launchingGameKey !== null}
                          onAcquireLaunch={acquireLaunchLock}
                          onReleaseLaunch={releaseLaunchLock}
                          onDragGame={libraryDrag.start}
                          selectionMode={!isDemo && bulkSelection.active}
                          selected={bulkSelection.selected.has(
                            librarySelectionKey(game),
                          )}
                          onToggleSelection={bulkSelection.toggleGame}
                          game={game}
                          bannerShelf={selectedShelf}
                          localLinks={localLinks}
                          demo={isDemo}
                          onDemoPlaytimeLogged={
                            isDemo
                              ? (durationSeconds) =>
                                  setDemoPlaytime((current) => ({
                                    ...current,
                                    addedSeconds:
                                      current.addedSeconds + durationSeconds,
                                    addedSessions: current.addedSessions + 1,
                                  }))
                              : undefined
                          }
                          onDemoTotalAdjusted={
                            isDemo
                              ? (total) =>
                                  setDemoPlaytime((current) => ({
                                    ...current,
                                    adjustmentSeconds:
                                      total - 7200 - current.addedSeconds,
                                  }))
                              : undefined
                          }
                          showDurationDays={showDurationDays}
                          showOrigin={showOrigin}
                          showMatch={showMatch}
                          view={view}
                          onRemove={requestRemoval}
                          onStopTracking={
                            !isDemo && game.source
                              ? requestStopTracking
                              : undefined
                          }
                        />
                      );
                    })}
                  </div>
                  {renderWindow.hasMore ? (
                    <div
                      ref={renderWindow.sentinelRef}
                      className="flex justify-center py-2"
                    >
                      <Button
                        variant="ghost"
                        data-controller-item="library-option"
                        loading={renderWindow.pending}
                        onClick={renderWindow.loadMore}
                      >
                        Show more games
                      </Button>
                    </div>
                  ) : null}
                </>
              )}
            </div>
          </div>
        </>
      )}
      {pendingBulkMove ? (
        <MoveToPlayCounterDialog
          games={pendingBulkMove.games}
          skippedCount={pendingBulkMove.skippedCount}
          onClose={() => setPendingBulkMove(null)}
          onMoved={bulkSelection.finish}
        />
      ) : null}
      {pendingRemoval ? (
        <RemoveGameDialog
          game={pendingRemoval}
          onCancel={() => setPendingRemoval(null)}
          onConfirm={(removeHistory) => {
            for (const entry of pendingRemoval.libraryImports) {
              removeLibraryImport(entry.provider, entry.externalId);
            }
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

function EmptyLibraryPanel({
  platform,
}: {
  platform: ReturnType<typeof currentPlatform>;
}) {
  const setActiveView = useAppStore((state) => state.setActiveView);
  const setLibraryImportProvider = useAppStore(
    (state) => state.setLibraryImportProvider,
  );
  const importProviders = importableProviderTabs(platform);

  return (
    <Panel className="overflow-hidden text-center">
      <div className="bg-gradient-to-b from-accent/[0.06] to-transparent px-6 py-10 sm:px-10 sm:py-12">
        <img
          src="/brand/playcounter-mark.svg"
          alt=""
          aria-hidden="true"
          className="mx-auto h-16 w-16 object-contain"
        />
        <h2 className="mt-5 text-2xl font-semibold tracking-tight text-text sm:text-3xl">
          No games detected yet
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-text-muted sm:text-base sm:leading-7">
          Start a game from any launcher or a standalone install. Keep
          PlayCounter running, and it will add recognized games here and track
          your playtime automatically.
        </p>
      </div>
      {importProviders.length > 0 ? (
        <div className="border-t border-border/60 px-6 py-6">
          <p className="text-sm text-text-muted">
            You can also import games and past playtime. It&apos;s completely
            optional.
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-3">
            {importProviders.map((config) => (
              <Button
                key={config.id}
                variant="secondary"
                data-controller-item="view-link"
                onClick={() => {
                  setLibraryImportProvider(config.id);
                  setActiveView("import");
                }}
              >
                {config.iconUrl ? (
                  <img
                    src={config.iconUrl}
                    alt=""
                    aria-hidden="true"
                    className="h-4 w-4 shrink-0 object-contain"
                  />
                ) : null}
                {config.firstImportCtaLabel}
              </Button>
            ))}
          </div>
        </div>
      ) : null}
    </Panel>
  );
}

function ProviderImportCallout({
  config,
}: {
  config: ImportableProviderTabConfig;
}) {
  const setActiveView = useAppStore((state) => state.setActiveView);
  const setLibraryImportProvider = useAppStore(
    (state) => state.setLibraryImportProvider,
  );

  return (
    <Panel className="px-6 py-12 text-center">
      {config.iconUrl ? (
        <img
          src={config.iconUrl}
          alt=""
          aria-hidden="true"
          className="mx-auto h-10 w-10"
        />
      ) : null}
      <h3 className="mt-4 text-lg font-semibold text-text">
        {config.emptyTitle}
      </h3>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-text-muted">
        {config.emptyBody}
      </p>
      <Button
        variant="primary"
        icon={Download}
        className="mx-auto mt-6"
        data-controller-item="view-link"
        onClick={() => {
          setLibraryImportProvider(config.id);
          setActiveView("import");
        }}
      >
        {config.firstImportCtaLabel}
      </Button>
    </Panel>
  );
}

function LaunchStartingOverlay({
  gameName,
  detected,
  compact = false,
}: {
  gameName: string;
  detected: boolean;
  compact?: boolean;
}) {
  // Game cards isolate their stacking contexts so this local overlay cannot
  // paint over context menus portalled to document.body.
  return (
    <div
      role="status"
      aria-live="polite"
      className="absolute inset-0 z-[70] flex items-center justify-center rounded-xl bg-bg/85 p-4 backdrop-blur-sm"
    >
      <div
        className={clsx(
          "flex min-w-0 max-w-full items-center rounded-xl border border-accent/50 bg-surface/95 text-center shadow-raised",
          compact ? "gap-3 px-4 py-2.5" : "flex-col gap-3 px-6 py-5",
        )}
      >
        <PlayCounterAnimatedIcon size={compact ? 40 : 64} />
        <div className={clsx("min-w-0 max-w-full", compact && "text-left")}>
          <div className="max-w-64 whitespace-normal break-words text-sm font-bold text-text">
            Starting {gameName}…
          </div>
          <div className="mt-1 text-xs text-text-muted">
            {detected
              ? "Game detected · finishing startup"
              : "Waiting for Windows to open the game"}
          </div>
        </div>
      </div>
    </div>
  );
}

export function GameLibraryCard({
  game: originalGame,
  bannerShelf,
  localLinks,
  launchKey,
  launchBlocked,
  onAcquireLaunch,
  onReleaseLaunch,
  showDurationDays,
  showOrigin,
  showMatch,
  view,
  onRemove,
  onStopTracking,
  onDemoPlaytimeLogged,
  onDemoTotalAdjusted,
  onDragGame,
  selectionMode,
  selected,
  onToggleSelection,
  demo = false,
}: {
  game: GameSummary;
  bannerShelf?: PersonalShelf;
  localLinks: readonly LocalLink[];
  launchKey: string;
  launchBlocked: boolean;
  onAcquireLaunch: (gameKey: string) => boolean;
  onReleaseLaunch: (gameKey: string) => void;
  showDurationDays: boolean;
  showOrigin: boolean;
  showMatch: boolean;
  view: ViewMode;
  onRemove: (game: GameSummary) => void;
  onStopTracking?: (game: GameSummary) => void;
  onDemoPlaytimeLogged?: (durationSeconds: number) => void;
  onDemoTotalAdjusted?: (seconds: number) => void;
  onDragGame: StartLibraryGameDrag;
  selectionMode: boolean;
  selected: boolean;
  onToggleSelection: (key: string, range: boolean) => void;
  demo?: boolean;
}) {
  const [demoTotal, setDemoTotal] = useState<number | null>(null);
  const [demoIdentity, setDemoIdentity] = useState<{
    name: string;
    source: GameSource;
  } | null>(null);
  const game = useMemo(
    () =>
      demo
        ? {
            ...originalGame,
            ...(demoIdentity
              ? { ...demoIdentity, sources: [demoIdentity.source] }
              : {}),
            ...(demoTotal !== null
              ? {
                  totalSeconds: demoTotal,
                  adjustmentSeconds: demoTotal - originalGame.recordedSeconds,
                }
              : {}),
          }
        : originalGame,
    [demo, demoTotal, demoIdentity, originalGame],
  );
  const libraryPractice = useLibraryPractice();
  // The tour walks through both halves, so its demo card always shows them.
  const originVisible = (demo && !libraryPractice) || showOrigin;
  const matchVisible = (demo && !libraryPractice) || showMatch;
  const averageSeconds = Math.round(
    game.sessionSeconds / Math.max(1, game.sessionCount),
  );
  const isList = view === "list";
  const isLarge = view === "large";
  const addToast = useAppStore((state) => state.addToast);
  const setActiveView = useAppStore((state) => state.setActiveView);
  const setHistoryQuery = useAppStore((state) => state.setHistoryQuery);
  const setHistoryGameKey = useAppStore((state) => state.setHistoryGameKey);
  const removeLibraryInstall = useAppStore(
    (state) => state.removeLibraryInstall,
  );
  const [demoAction, setDemoAction] = useState<
    "history" | "matching" | "remove" | "ignore" | "launch" | null
  >(null);
  const [demoRemoved, setDemoRemoved] = useState(false);
  const [demoLaunchPath, setDemoLaunchPath] = useState<string | null>(
    TOUR_DEMO_GAME.exePath,
  );
  const showDemoContextMenu = useAppStore(
    (state) =>
      (state.activeTour?.tourId === "log-playtime" &&
        [2, 3, 6].includes(state.activeTour.stepIndex)) ||
      (state.activeTour?.tourId === "game-actions" &&
        state.activeTour.stepIndex >= 2) ||
      (state.activeTour?.tourId === "launch-games" &&
        state.activeTour.stepIndex === 3),
  );
  const activeTour = useAppStore((state) => state.activeTour);
  const launchTourDemo = demo && activeTour?.tourId === "launch-games";
  const setLibraryFeaturedGame = useAppStore(
    (state) => state.setLibraryFeaturedGame,
  );
  const saveBannerShelf = useAppStore((state) => state.savePersonalShelf);
  const featuredInBanner = useAppStore((state) => {
    const featured = bannerShelf
      ? bannerShelf.featuredGame
      : state.settings.libraryFeaturedGame;
    return Boolean(featured && matchesFeaturedGame(game, featured));
  });
  const contextMenu = useContextMenu();
  const gameDragProps = libraryGameDragSourceProps(
    {
      gameId: game.gameId,
      source: game.source,
      igdbId: game.igdbId,
      gameName: game.name,
      coverUrl: game.coverUrl,
    },
    onDragGame,
    (demo && !libraryPractice) || (selectionMode && !selected),
  );
  const cardRef = useRef<HTMLElement | null>(null);
  const coverInputRef = useRef<HTMLInputElement | null>(null);
  const [coverBusy, setCoverBusy] = useState(false);
  const [showAddPlaytime, setShowAddPlaytime] = useState(
    () =>
      demo &&
      activeTour?.tourId === "log-playtime" &&
      activeTour.stepIndex === 4,
  );
  const [showAdjustPlaytime, setShowAdjustPlaytime] = useState(false);
  const [showMatchCheck, setShowMatchCheck] = useState(false);
  const libraryMatchOffers = useLibraryMatchOffers((state) => state.offers);
  const [showDetails, setShowDetails] = useState(false);
  const [showMoveToPlayCounter, setShowMoveToPlayCounter] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [cancelSuggestionTarget, setCancelSuggestionTarget] =
    useState<PendingCommunitySuggestionTarget | null>(null);
  const apiEndpoint = useAppStore((state) => state.settings.apiEndpoint);
  const ignoredProcesses = useAppStore((state) => state.ignoredProcesses);
  const isOffline = useIsOffline();
  const [shareOpen, setShareOpen] = useState(false);
  const [showConvert, setShowConvert] = useState(false);
  const [convertName, setConvertName] = useState("");
  const [showRename, setShowRename] = useState(false);
  const [showArtPicker, setShowArtPicker] = useState(false);
  const [artPickerTab, setArtPickerTab] = useState<"banner" | "cover">(
    "banner",
  );
  const [renameName, setRenameName] = useState("");
  const [launching, setLaunching] = useState(false);

  const closeDemoDialogs = () => {
    setDemoAction(null);
    setShowDetails(false);
    setShowConvert(false);
    setReportOpen(false);
    setShowAdjustPlaytime(false);
    setShowAddPlaytime(false);
    setShowMatchCheck(false);
    setDemoRemoved(false);
  };
  // Next on a free-practice step closes whatever the learner opened there,
  // including when the next step shows another view.
  const previousDemoStep = useRef(activeTour);
  useEffect(() => {
    const left = previousDemoStep.current;
    previousDemoStep.current = activeTour;
    if (!demo || libraryPractice || !left) return;
    if (
      left.tourId === activeTour?.tourId &&
      left.stepIndex === activeTour.stepIndex
    )
      return;
    if (findTour(left.tourId)?.steps[left.stepIndex]?.manualAdvance) {
      contextMenu.close();
      closeDemoDialogs();
    }
  }, [activeTour?.tourId, activeTour?.stepIndex]);

  useEffect(() => {
    if (!demo || libraryPractice) return;
    if (!showDemoContextMenu) {
      contextMenu.close();
      return;
    }
    closeDemoDialogs();
    const frame = requestAnimationFrame(() => {
      const rect = cardRef.current?.getBoundingClientRect();
      if (!rect) return;
      contextMenu.openAt({
        x: rect.left + rect.width / 2,
        y: rect.top + Math.min(rect.height / 2, 160),
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [
    demo,
    showDemoContextMenu,
    showDemoContextMenu ? activeTour?.stepIndex : null,
  ]);
  const hasActiveSession = useAppStore((state) =>
    state.activeSessions.some((session) =>
      game.aliases.some(
        (alias) =>
          session.gameId === alias.gameId &&
          (session.source ?? null) === alias.source,
      ),
    ),
  );
  useEffect(() => {
    if (!launching || !launchTourDemo) return;
    const timeout = window.setTimeout(() => {
      setLaunching(false);
      emitTourEvent(
        "mygames.demo-launch-attempted",
        "Sample launch complete. No program was started.",
      );
    }, DEMO_LAUNCH_MS);
    return () => window.clearTimeout(timeout);
  }, [launchTourDemo, launching]);
  useEffect(() => {
    if (!launching || hasActiveSession || launchTourDemo) return;
    const timeout = window.setTimeout(() => {
      setLaunching(false);
      onReleaseLaunch(launchKey);
      addToast({
        tone: "info",
        title: "Launch request sent",
        detail: `${game.name} has not appeared in PlayCounter yet. It may still be starting or waiting on its own launcher.`,
      });
    }, 8_000);
    return () => window.clearTimeout(timeout);
  }, [
    addToast,
    game.name,
    hasActiveSession,
    launchKey,
    launchTourDemo,
    launching,
    onReleaseLaunch,
  ]);
  useEffect(() => {
    if (!launching || !hasActiveSession) return;
    const timeout = window.setTimeout(() => {
      setLaunching(false);
      onReleaseLaunch(launchKey);
    }, 10_000);
    return () => window.clearTimeout(timeout);
  }, [hasActiveSession, launchKey, launching, onReleaseLaunch]);
  useEffect(
    () => () => onReleaseLaunch(launchKey),
    [launchKey, onReleaseLaunch],
  );
  const launchTargets = useAppStore((state) => state.launchTargets);
  const manualLaunchTargets = useAppStore((state) => state.manualLaunchTargets);
  const emulatorMappings = useAppStore((state) => state.emulatorMappings);
  const emulatorAutoLaunchTargets = useAppStore(
    (state) => state.emulatorAutoLaunchTargets,
  );
  const emulatorManualLaunchTargets = useAppStore(
    (state) => state.emulatorManualLaunchTargets,
  );
  const emulatorLaunchCandidates = useAppStore(
    (state) => state.emulatorLaunchCandidates,
  );
  const exeCache = useAppStore((state) => state.exeCache);
  const scopedExeLinks = useAppStore((state) => state.scopedExeLinks);
  const launcherEnabled = useAppStore(
    (state) => state.settings.gameLaunchingEnabled === true,
  );
  const isWindows = currentPlatform() === "windows";
  const canLaunchExecutables = isWindows && launcherEnabled;
  const canConfigureLaunch =
    canLaunchExecutables &&
    game.exeNames.some((exeName) => /\.exe$/i.test(exeName));
  const manualTarget = useMemo(
    () => findManualLaunchTarget(game.aliases, manualLaunchTargets),
    [game.aliases, manualLaunchTargets],
  );
  const autoLaunchTargets = useMemo(
    () =>
      launchTargetsForGame({
        exeNames: game.exeNames,
        aliases: game.aliases,
        launchTargets,
        exeCache,
      }),
    [exeCache, game.aliases, game.exeNames, launchTargets],
  );
  const ownedLaunchTargets = useMemo(() => {
    if (!manualTarget) return autoLaunchTargets;
    const manualKey = manualTarget.exeName.toLowerCase();
    return [
      manualTarget,
      ...autoLaunchTargets.filter(
        (target) => target.exeName.toLowerCase() !== manualKey,
      ),
    ];
  }, [autoLaunchTargets, manualTarget]);
  const primaryLaunchTarget = ownedLaunchTargets[0];
  const steamImportEntry = game.libraryImports.find(
    (entry) => entry.provider === "steam",
  );
  const steamLaunchEntry = game.libraryImports.find(
    (entry) => entry.provider === "steam" && entry.installed,
  );
  const xboxImportEntry = game.libraryImports.find(
    (entry) => entry.provider === "xbox",
  );
  const xboxLaunchEntry = game.libraryImports.find(
    (entry) => entry.provider === "xbox" && entry.installed,
  );
  const battleNetImportEntry = game.libraryImports.find(
    (entry) => entry.provider === "battlenet",
  );
  const importedProviders = libraryProviders(game.libraryImports);
  const unknownDurationProviders = importedProviders.filter((provider) =>
    hasUnknownProviderPlaytime(game.libraryImports, provider),
  );
  const communityApproval =
    game.emulatorApproval ??
    communitySuggestionApproval({
      suggestionId: game.communitySuggestionId,
      verified: game.communitySuggestionVerified,
      status: game.communitySuggestionStatus,
    });
  const steamActions = libraryContextActions({
    demo,
    isWindows,
    launcherEnabled,
    hasImport: Boolean(steamImportEntry),
    installed: Boolean(steamLaunchEntry),
  });
  const xboxActions = libraryContextActions({
    demo,
    isWindows,
    launcherEnabled,
    hasImport: Boolean(xboxImportEntry),
    installed: Boolean(xboxLaunchEntry),
  });
  const gameEmulatorMappings = useMemo(
    () =>
      game.emulatorContentKeys.flatMap((contentKey) => {
        const mapping = emulatorMappings.get(contentKey);
        return mapping?.decision === "game" &&
          adapterFor(mapping.emulatorId)?.launch
          ? [mapping]
          : [];
      }),
    [emulatorMappings, game.emulatorContentKeys],
  );
  const primaryEmulatorMapping =
    gameEmulatorMappings.length === 1 ? gameEmulatorMappings[0] : undefined;
  const primaryEmulatorTarget = primaryEmulatorMapping
    ? resolveEmulatorLaunchTarget(
        primaryEmulatorMapping.contentKey,
        emulatorAutoLaunchTargets,
        emulatorManualLaunchTargets,
      )
    : undefined;
  const primaryEmulatorCandidate = primaryEmulatorMapping
    ? emulatorLaunchCandidates.get(primaryEmulatorMapping.contentKey)
    : undefined;
  const showPlayButton =
    (launchTourDemo && Boolean(demoLaunchPath)) ||
    (!demo &&
      canLaunchExecutables &&
      Boolean(
        primaryLaunchTarget ||
        primaryEmulatorTarget ||
        steamLaunchEntry ||
        xboxLaunchEntry,
      ));
  const showLaunchFooter =
    showPlayButton ||
    launchTourDemo ||
    (!demo &&
      canLaunchExecutables &&
      (canConfigureLaunch || gameEmulatorMappings.length > 0));
  const showLaunchNote = !showLaunchFooter && !demo && canLaunchExecutables;
  const basePlayState = playButtonState(
    game.name,
    launching,
    hasActiveSession,
    launchBlocked,
  );
  const playState =
    xboxLaunchEntry && !manualTarget
      ? {
          ...basePlayState,
          ariaLabel: `Play ${game.name} on Xbox`,
          title: "Play on Xbox",
        }
      : steamLaunchEntry && !primaryLaunchTarget && !primaryEmulatorTarget
        ? {
            ...basePlayState,
            ariaLabel: `Play ${game.name} in Steam`,
            title: "Play in Steam",
          }
        : basePlayState;
  const playButtonRunning = !launching && hasActiveSession;
  const controllerNavigable = !demo && !selectionMode && canLaunchExecutables;
  const hasPrimaryLaunchTarget = Boolean(
    primaryLaunchTarget ||
    primaryEmulatorTarget ||
    steamLaunchEntry ||
    xboxLaunchEntry,
  );
  const canEditCover = game.source === "custom";
  const primaryExeName = game.exeNames[0];
  const primaryExeEntry = primaryExeName
    ? exeCache.get(primaryExeName.toLowerCase())
    : undefined;
  const primaryLocalLink = useMemo(
    () =>
      localLinks.find(
        (link) =>
          game.exeNames.some(
            (exeName) => exeName.toLowerCase() === link.exeName.toLowerCase(),
          ) &&
          game.aliases.some(
            (alias) =>
              alias.gameId === link.gameId && alias.source === link.source,
          ),
      ),
    [game.aliases, game.exeNames, localLinks],
  );
  const shareTarget = primaryLocalLink?.ref ?? primaryExeName;
  const pendingCommunitySuggestion = useMemo(
    () =>
      findPendingCommunitySuggestionEntry(
        game.exeNames,
        exeCache,
        scopedExeLinks,
      ),
    [exeCache, game.exeNames, scopedExeLinks],
  );
  const canSuggestToCommunity = canSuggestCustomGameToCommunity({
    source: primaryLocalLink?.source ?? primaryExeEntry?.source ?? game.source,
    exeName: primaryExeName,
    communitySuggestionId:
      primaryLocalLink?.communitySuggestionId ??
      primaryExeEntry?.communitySuggestionId ??
      game.communitySuggestionId,
    communitySuggestionStatus:
      primaryLocalLink?.communitySuggestionStatus ??
      primaryExeEntry?.communitySuggestionStatus ??
      game.communitySuggestionStatus,
  });
  // Shown in place of the title while hovering the card with Shift held.
  const exeLabel =
    game.exeNames.filter(Boolean).join(", ") || game.emulatorLabels.join(", ");
  const localDisplayedSeconds = Math.max(
    0,
    game.recordedSeconds + game.adjustmentSeconds,
  );
  const playtimeTitle =
    game.libraryImports.length > 0
      ? `Launchers combined: ${formatDuration(game.providerFloorSeconds, showDurationDays)} · PlayCounter: ${formatDuration(localDisplayedSeconds, showDurationDays)} · shown: ${formatDuration(game.totalSeconds, showDurationDays)} (higher total).`
      : undefined;
  const trackingUnavailable =
    game.exeNames.length === 0 && game.emulatorContentKeys.length === 0;
  const offeredImport = game.libraryImports.find(
    (item) =>
      libraryMatchOffers.get(libraryEntryKey(item.provider, item.externalId))
        ?.entry === item.entry,
  );
  const matchCheckImportEntry =
    offeredImport ??
    steamImportEntry ??
    xboxImportEntry ??
    battleNetImportEntry;
  const libraryMatchOffer =
    !demo && trackingUnavailable && offeredImport
      ? libraryMatchOffers.get(
          libraryEntryKey(offeredImport.provider, offeredImport.externalId),
        )
      : undefined;
  const libraryMatchPrompt = libraryMatchOffer ? (
    <LibraryMatchOffer
      gameName={game.name}
      executableMatches={libraryMatchOffer.executableMatches}
      onCover={!isList}
      onReview={() => setShowMatchCheck(true)}
      onDismiss={() =>
        dismissLibraryMatchOffer(
          libraryEntryKey(
            libraryMatchOffer.entry.provider,
            libraryMatchOffer.entry.externalId,
          ),
        )
      }
    />
  ) : null;
  const canCheckMatches = Boolean(
    (game.source && game.exeNames[0]) ||
    (trackingUnavailable && matchCheckImportEntry),
  );
  const trackingWarningMessage = trackingUnavailableMessage(
    importedProviders,
    canCheckMatches,
  );
  const showLaunchActions =
    launchTourDemo ||
    (!demo &&
      (canConfigureLaunch ||
        (canLaunchExecutables && gameEmulatorMappings.length > 0)));
  const showLaunchOptions =
    showLaunchActions ||
    steamActions.showOpenInLauncher ||
    xboxActions.showOpenInLauncher ||
    (!demo && isWindows && Boolean(battleNetImportEntry));
  const showMatchingActions =
    canCheckMatches ||
    Boolean(
      game.source &&
      game.exeNames[0] &&
      (pendingCommunitySuggestion ||
        canSuggestToCommunity ||
        game.source === "igdb" ||
        game.source === "community"),
    );

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
    if (demo) {
      setDemoIdentity({ name, source: "custom" });
      setShowConvert(false);
      emitTourEvent(
        "demo.action-completed",
        `Sample converted to ${name}. Its time is kept and nothing is shared.`,
      );
      return;
    }
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
        shareTarget ?? exeName,
        match.name,
        match.coverUrl,
        match.id,
        false,
        match.igdbId,
      );
    } else {
      if (primaryLocalLink?.ref.kind === "scoped") {
        applyLocalLinkGameMatch(primaryLocalLink.ref, match);
      } else {
        applyKnownGameMatch(exeName, match);
      }
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

  const correction = useCommunityGameCorrection({
    exeName: primaryExeName ?? "",
    targetKey:
      typeof shareTarget === "string"
        ? shareTarget
        : shareTarget
          ? `${shareTarget.kind}:${shareTarget.key}`
          : "",
    resultInstruction: "Pick the right game.",
    onKnownGame: (matchedGame) => {
      if (!shareTarget) return;
      applyLocalLinkGameMatch(shareTarget, matchedGame);
      closeShare();
      addToast({
        tone: "success",
        title: "Already in IGDB",
        detail: `${matchedGame.name} is a known IGDB match for ${primaryExeName} and was applied directly.`,
      });
    },
    onRejected: (id, reviewNote, { selection }) => {
      if (!shareTarget) return;
      suggestTrackedGameToCommunity(
        shareTarget,
        selection.name,
        selection.coverUrl,
        id,
        false,
        selection.igdbId,
      );
      markCommunitySuggestionRejected(shareTarget, reviewNote);
      closeShare();
      addToast({
        tone: "info",
        title: "Suggestion already reviewed",
        detail: reviewNote ?? "This suggestion was not accepted.",
      });
    },
    onSuggested: (id, verified, { selection }) => {
      if (!shareTarget) return;
      suggestTrackedGameToCommunity(
        shareTarget,
        selection.name,
        selection.coverUrl,
        id,
        verified,
        selection.igdbId,
      );
      closeShare();
      addToast({
        tone: "success",
        title: "Suggested to community",
        detail: `Your community suggestion was submitted for ${primaryExeName}.`,
      });
    },
  });

  function closeShare() {
    setShareOpen(false);
    correction.reset();
  }

  async function handleShareAction() {
    if (
      !primaryLocalLink ||
      (primaryLocalLink.shareState !== "failed" &&
        primaryLocalLink.shareState !== "unshared")
    ) {
      setShareOpen(true);
      return;
    }
    const outcome = await submitLocalLinkToCommunity(primaryLocalLink.ref);
    if (outcome.kind === "failed") {
      addToast({
        tone: "error",
        title: "Could not share executable",
        detail: outcome.error,
      });
      return;
    }
    addToast({
      tone: outcome.kind === "rejected" ? "info" : "success",
      title:
        outcome.kind === "already-known"
          ? "Known match applied"
          : outcome.kind === "rejected"
            ? "Suggestion already reviewed"
            : "Suggested to community",
      detail: `${primaryLocalLink.exeName} remains linked to ${game.name} on this PC.`,
    });
  }

  function handleCancelSuggestion(target: PendingCommunitySuggestionTarget) {
    setCancelSuggestionTarget(null);
    void cancelCommunitySuggestion(target.ref, target.gameId).then(
      (outcome) => {
        if (outcome.kind === "cancelled") {
          addToast({
            tone: "success",
            title: "Suggestion cancelled",
            detail: `${game.name} is back to a private custom game. You can suggest it again anytime.`,
          });
        } else if (outcome.kind === "not-pending") {
          addToast({
            tone: "info",
            title: "Suggestion changed",
            detail:
              "This suggestion is no longer pending and could not be cancelled.",
          });
        } else if (outcome.kind === "not-owner") {
          addToast({
            tone: "info",
            title: "Can't cancel automatically",
            detail:
              "PlayCounter can't verify this suggestion as yours, so it remains in review.",
          });
        } else if (outcome.kind === "unavailable") {
          addToast({
            tone: "info",
            title: "Not available yet",
            detail:
              "This server does not support cancelling suggestions yet. Try again later.",
          });
        } else if (outcome.kind === "offline") {
          addToast({
            tone: "error",
            title: "You're offline",
            detail: "Reconnect and try cancelling again.",
          });
        } else {
          addToast({
            tone: "error",
            title: "Could not cancel suggestion",
            detail: outcome.error,
          });
        }
      },
    );
  }

  const handleShowHistory = () => {
    if (demo) {
      contextMenu.close();
      setDemoAction("history");
      return;
    }
    setHistoryQuery(game.name);
    setHistoryGameKey(game.historyGameKey);
    setActiveView("history");
    contextMenu.close();
  };

  const handleAddPlaytime = (
    durationSeconds: number,
    endedAt: string,
    playthroughId?: string,
  ) => {
    if (demo) {
      setShowAddPlaytime(false);
      if (demoTotal !== null) setDemoTotal(demoTotal + durationSeconds);
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
      playthroughId,
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
      if (onDemoTotalAdjusted) onDemoTotalAdjusted(targetSeconds);
      else setDemoTotal(targetSeconds);
      emitTourEvent(
        "demo.action-completed",
        `Sample total updated to ${formatDuration(targetSeconds)}. No session was added.`,
      );
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
      // Show the usual Starting… state first; the sample finishes on a timer.
      if (demoLaunchPath) setLaunching(true);
      else
        emitTourEvent(
          "mygames.demo-launch-attempted",
          "This sample has no saved launch file. Set one in Launch options to restore Play.",
        );
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
    if (launching || launchBlocked) {
      addToast({
        tone: "info",
        title: "A game is already starting",
        detail: "Wait for PlayCounter to finish the current launch first.",
      });
      return;
    }
    if (!onAcquireLaunch(launchKey)) {
      addToast({
        tone: "info",
        title: "A game is already starting",
        detail: "Wait for PlayCounter to finish the current launch first.",
      });
      return;
    }
    setLaunching(true);
    let keepLaunchFeedback = false;
    try {
      const outcome = await launchGame(target);
      if (outcome === "busy") {
        addToast({
          tone: "info",
          title: `${game.name} is starting`,
          detail: "PlayCounter already sent the launch request.",
        });
        return;
      }
      keepLaunchFeedback = true;
      void scanProcessesNow().catch((error) =>
        console.warn("post-launch process scan failed", error),
      );
    } catch (error) {
      const message = launchErrorMessage(error, game.name);
      addToast({ tone: "error", ...message });
    } finally {
      if (!keepLaunchFeedback) {
        setLaunching(false);
        onReleaseLaunch(launchKey);
      }
    }
  }

  async function handleEmulatorLaunch(
    mapping: (typeof gameEmulatorMappings)[number],
  ) {
    contextMenu.close();
    if (hasActiveSession) {
      addToast({
        tone: "info",
        title: `${game.name} is already running`,
        detail: "PlayCounter is already tracking this game.",
      });
      return;
    }
    if (launching || launchBlocked || !onAcquireLaunch(launchKey)) {
      addToast({
        tone: "info",
        title: "A game is already starting",
        detail: "Wait for PlayCounter to finish the current launch first.",
      });
      return;
    }

    setLaunching(true);
    let keepLaunchFeedback = false;
    try {
      const outcome = await launchEmulatorGame(mapping);
      if (outcome.kind === "busy") {
        addToast({
          tone: "info",
          title: `${game.name} is starting`,
          detail: "PlayCounter already sent the launch request.",
        });
        return;
      }
      if (outcome.kind === "hostRunning") {
        addToast({
          tone: "info",
          title: `${mapping.label} is still busy`,
          detail: `Stop the current emulated game first. PlayCounter only replaces ${mapping.label} automatically when it is safely idle.`,
        });
        return;
      }
      keepLaunchFeedback = true;
      void scanProcessesNow().catch((error) =>
        console.warn("post-launch process scan failed", error),
      );
    } catch (error) {
      addToast({
        tone: "error",
        ...emulatorLaunchErrorMessage(error, game.name),
      });
    } finally {
      if (!keepLaunchFeedback) {
        setLaunching(false);
        onReleaseLaunch(launchKey);
      }
    }
  }

  async function handleSteamLaunch() {
    if (!steamLaunchEntry) return;
    contextMenu.close();
    if (hasActiveSession) {
      addToast({
        tone: "info",
        title: `${game.name} is already running`,
        detail: "PlayCounter is already tracking this game.",
      });
      return;
    }
    if (launching || launchBlocked || !onAcquireLaunch(launchKey)) {
      addToast({
        tone: "info",
        title: "A game is already starting",
        detail: "Wait for PlayCounter to finish the current launch first.",
      });
      return;
    }
    setLaunching(true);
    let keepLaunchFeedback = false;
    try {
      const provider = await import("../../library/providers").then((module) =>
        module.loadLibraryProvider("steam"),
      );
      await provider.launch(steamLaunchEntry.externalId);
      keepLaunchFeedback = true;
      void scanProcessesNow().catch((error) =>
        console.warn("post-launch process scan failed", error),
      );
    } catch (error) {
      if (shouldForgetLibraryInstallOnLaunchError(error)) {
        removeLibraryInstall("steam", steamLaunchEntry.externalId);
      }
      addToast({
        tone: "error",
        ...libraryLaunchErrorMessage(error, game.name, "Steam"),
      });
    } finally {
      if (!keepLaunchFeedback) {
        setLaunching(false);
        onReleaseLaunch(launchKey);
      }
    }
  }

  async function handleXboxLaunch() {
    if (!xboxLaunchEntry) return;
    contextMenu.close();
    if (hasActiveSession) {
      addToast({
        tone: "info",
        title: `${game.name} is already running`,
        detail: "PlayCounter is already tracking this game.",
      });
      return;
    }
    if (launching || launchBlocked || !onAcquireLaunch(launchKey)) {
      addToast({
        tone: "info",
        title: "A game is already starting",
        detail: "Wait for PlayCounter to finish the current launch first.",
      });
      return;
    }
    setLaunching(true);
    let keepLaunchFeedback = false;
    try {
      const provider = await import("../../library/providers").then((module) =>
        module.loadLibraryProvider("xbox"),
      );
      await provider.launch(xboxLaunchEntry.externalId);
      keepLaunchFeedback = true;
      void scanProcessesNow().catch((error) =>
        console.warn("post-launch process scan failed", error),
      );
    } catch (error) {
      if (shouldForgetLibraryInstallOnLaunchError(error)) {
        removeLibraryInstall("xbox", xboxLaunchEntry.externalId);
      }
      addToast({
        tone: "error",
        ...libraryLaunchErrorMessage(error, game.name, "Xbox"),
      });
    } finally {
      if (!keepLaunchFeedback) {
        setLaunching(false);
        onReleaseLaunch(launchKey);
      }
    }
  }

  async function handleOpenInSteam() {
    if (!steamImportEntry) return;
    contextMenu.close();
    try {
      const provider = await import("../../library/providers").then((module) =>
        module.loadLibraryProvider("steam"),
      );
      await provider.launch(steamImportEntry.externalId, "store");
    } catch (error) {
      addToast({
        tone: "error",
        title: `Could not open ${game.name} in Steam`,
        detail: launchErrorDetail(error),
      });
    }
  }
  async function handleOpenBattleNet() {
    if (!battleNetImportEntry) return;
    contextMenu.close();
    try {
      const { loadLibraryProvider } = await import("../../library/providers");
      const provider = await loadLibraryProvider("battlenet");
      await provider.launch(battleNetImportEntry.externalId, "store");
    } catch (error) {
      addToast({
        tone: "error",
        title: "Could not open Battle.net",
        detail:
          error instanceof Error
            ? error.message
            : "Check that Battle.net is installed on this PC.",
      });
    }
  }

  async function handleOpenXboxApp() {
    if (!xboxImportEntry) return;
    contextMenu.close();
    try {
      const provider = await import("../../library/providers").then((module) =>
        module.loadLibraryProvider("xbox"),
      );
      await provider.launch(xboxImportEntry.externalId, "store");
    } catch (error) {
      addToast({
        tone: "error",
        title: "Could not open the Xbox app",
        detail: formatError(error),
      });
    }
  }

  async function handleSetEmulatorLaunchFile(
    mapping: (typeof gameEmulatorMappings)[number],
  ) {
    contextMenu.close();
    try {
      const target = await chooseEmulatorLaunchFile(mapping);
      if (!target) return;
      addToast({
        tone: "success",
        title: "Launch file saved",
        detail: `${game.name} can now be started with ${mapping.label}.`,
      });
    } catch (error) {
      addToast({
        tone: "error",
        title: "Launch file not set",
        detail: formatError(error),
      });
    }
  }

  function handleConfirmEmulatorCandidate(
    mapping: (typeof gameEmulatorMappings)[number],
  ) {
    contextMenu.close();
    const target = confirmEmulatorLaunchCandidate(mapping.contentKey);
    addToast(
      target
        ? {
            tone: "success",
            title: "Detected launch file confirmed",
            detail: `${game.name} can now be started with ${mapping.label}.`,
          }
        : {
            tone: "error",
            title: "Detected file is no longer available",
            detail: `Start ${game.name} again or select its game file manually.`,
          },
    );
  }

  function handleForgetEmulatorLaunchFile(
    mapping: (typeof gameEmulatorMappings)[number],
  ) {
    contextMenu.close();
    forgetEmulatorLaunchTarget(mapping.contentKey);
    addToast({
      tone: "info",
      title: "Launch file forgotten",
      detail: `Start ${game.name} once or select its game file again.`,
    });
  }

  function handlePreferredLaunch() {
    if (manualTarget) {
      void handleLaunch(manualTarget);
    } else if (xboxLaunchEntry) {
      void handleXboxLaunch();
    } else if (primaryLaunchTarget) {
      void handleLaunch(primaryLaunchTarget);
    } else if (primaryEmulatorMapping && primaryEmulatorTarget) {
      void handleEmulatorLaunch(primaryEmulatorMapping);
    } else if (steamLaunchEntry) {
      void handleSteamLaunch();
    } else {
      void handleLaunch();
    }
  }

  function handleLaunchFooterClick(element: HTMLElement) {
    if (launchTourDemo && !demoLaunchPath) {
      setDemoAction("launch");
      return;
    }
    if (showPlayButton) {
      handlePreferredLaunch();
    } else if (primaryEmulatorMapping && primaryEmulatorCandidate) {
      handleConfirmEmulatorCandidate(primaryEmulatorMapping);
    } else if (primaryEmulatorMapping) {
      void handleSetEmulatorLaunchFile(primaryEmulatorMapping);
    } else if (gameEmulatorMappings.length > 1) {
      openDemoMenu(element);
    } else {
      void handleSetLaunchFile();
    }
  }

  async function handleSetLaunchFile() {
    contextMenu.close();
    try {
      const target = await chooseLaunchTarget(
        game.exeNames,
        {
          gameId: game.gameId,
          source: game.source,
        },
        game.aliases,
      );
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
    if (manualTarget && primaryLaunchTarget === manualTarget) {
      forgetManualLaunchTarget(manualTarget.owner);
    } else {
      forgetLaunchTarget(primaryLaunchTarget.exeName);
    }
    addToast({
      tone: "info",
      title: "Launch file forgotten",
      detail: `Start ${game.name} once, or set its launch file again.`,
    });
  }

  async function handleOpenInExplorer() {
    contextMenu.close();
    if (!primaryLaunchTarget) return;
    try {
      await revealGameExecutable(primaryLaunchTarget);
    } catch (error) {
      addToast({
        tone: "error",
        title: "Could not open the game file",
        detail: formatError(error),
      });
    }
  }

  const requestMoveToPlayCounter = () => {
    contextMenu.close();
    setShowDetails(false);
    setShowMoveToPlayCounter(true);
  };
  const renderDetailsDialog = () =>
    showArtPicker ? (
      <ArtPickerDialog
        game={{
          gameId: game.gameId,
          source: game.source,
          name: game.name,
          canEditCover,
        }}
        initialTab={artPickerTab}
        onClose={() => setShowArtPicker(false)}
      />
    ) : showMoveToPlayCounter ? (
      <MoveToPlayCounterDialog
        games={[game]}
        onClose={() => setShowMoveToPlayCounter(false)}
      />
    ) : showDetails ? (
      <GameDetailsDialog
        game={game}
        launchKey={`${launchKey}:details`}
        launchBlocked={launchBlocked}
        onAcquireLaunch={onAcquireLaunch}
        onReleaseLaunch={onReleaseLaunch}
        onClose={() => setShowDetails(false)}
        onDemoHistory={() => {
          setShowDetails(false);
          setDemoAction("history");
        }}
        onMoveToPlayCounter={
          !demo && game.libraryImports.length > 0
            ? requestMoveToPlayCounter
            : undefined
        }
      />
    ) : null;

  const renderContextMenu = () => {
    if (!contextMenu.open) return null;
    if (libraryPractice)
      return (
        <ContextMenu
          open
          position={contextMenu.position}
          onClose={contextMenu.close}
          dataTour="demo-library-menu"
          focusFirstItem
        >
          <GameJournalMenu
            game={{ ...game, gameName: game.name }}
            onClose={contextMenu.close}
          />
        </ContextMenu>
      );
    return (
      <ContextMenu
        open={contextMenu.open}
        position={contextMenu.position}
        onClose={contextMenu.close}
        returnFocusRef={contextMenu.anchorRef}
        ariaLabel={`${game.name} actions`}
        className="min-w-56"
        dataTour={demo ? "demo-context-menu" : undefined}
        focusFirstItem
      >
        {showPlayButton ? (
          <ContextMenuItem
            icon={Play}
            disabled={hasActiveSession || launching || launchBlocked}
            onClick={handlePreferredLaunch}
          >
            Play
          </ContextMenuItem>
        ) : null}
        <ContextMenuItem
          icon={Info}
          dataTour={demo ? "demo-menu-details" : undefined}
          onClick={() => {
            contextMenu.close();
            setShowDetails(true);
          }}
        >
          Open Details
        </ContextMenuItem>
        <ContextMenuItem
          dataTour={demo ? "demo-menu-show-history" : undefined}
          icon={History}
          onClick={handleShowHistory}
        >
          Show History
        </ContextMenuItem>
        {!demo ? (
          <ContextMenuItem
            icon={featuredInBanner ? PinOff : Pin}
            onClick={() => {
              contextMenu.close();
              const featuredGame = featuredInBanner
                ? null
                : {
                    gameId: game.gameId,
                    source: game.source,
                    igdbId: game.igdbId,
                  };
              if (bannerShelf)
                saveBannerShelf({ ...bannerShelf, featuredGame });
              else setLibraryFeaturedGame(featuredGame);
            }}
          >
            {bannerShelf
              ? featuredInBanner
                ? "Use library banner"
                : "Pin to shelf banner"
              : featuredInBanner
                ? "Unpin from banner"
                : "Pin to banner"}
          </ContextMenuItem>
        ) : null}
        {!demo ? <ContextMenuSeparator /> : null}
        {!demo ? (
          <GameJournalMenu
            heading={false}
            game={{ ...game, gameName: game.name }}
            onClose={contextMenu.close}
          />
        ) : null}
        {canEditCover ? (
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
        ) : null}
        <ContextMenuSeparator />
        {showLaunchOptions ? (
          <ContextMenuSubmenu
            label="Launch options"
            icon={FolderSearch}
            dataTour={demo ? "demo-menu-launch-options" : undefined}
            menuDataTour={demo ? "demo-launch-menu" : undefined}
          >
            {steamActions.showOpenInLauncher ? (
              <>
                {steamActions.showPlayInLauncher ? (
                  <ContextMenuItem
                    icon={Play}
                    disabled={hasActiveSession || launching || launchBlocked}
                    onClick={() => void handleSteamLaunch()}
                  >
                    Play in Steam
                  </ContextMenuItem>
                ) : null}
                <ContextMenuItem
                  icon={ExternalLink}
                  onClick={() => void handleOpenInSteam()}
                >
                  Open in Steam
                </ContextMenuItem>
              </>
            ) : null}
            {xboxActions.showOpenInLauncher ? (
              <>
                {xboxActions.showPlayInLauncher ? (
                  <ContextMenuItem
                    icon={Play}
                    disabled={hasActiveSession || launching || launchBlocked}
                    onClick={() => void handleXboxLaunch()}
                  >
                    Play on Xbox
                  </ContextMenuItem>
                ) : null}
                <ContextMenuItem
                  icon={ExternalLink}
                  onClick={() => void handleOpenXboxApp()}
                >
                  Open Xbox app
                </ContextMenuItem>
              </>
            ) : null}
            {!demo && isWindows && battleNetImportEntry ? (
              <>
                <ContextMenuItem
                  icon={ExternalLink}
                  onClick={() => void handleOpenBattleNet()}
                >
                  Open Battle.net
                </ContextMenuItem>
              </>
            ) : null}
            {launchTourDemo ? (
              <ContextMenuItem
                dataTour="demo-menu-launch-file"
                icon={FolderSearch}
                onClick={() => {
                  contextMenu.close();
                  setDemoAction("launch");
                }}
              >
                Set or change launch file…
              </ContextMenuItem>
            ) : null}
            {!demo && canConfigureLaunch ? (
              <>
                {ownedLaunchTargets.length > 0
                  ? ownedLaunchTargets.map((target) => (
                      <ContextMenuItem
                        key={target.exeName.toLowerCase()}
                        icon={Play}
                        disabled={
                          hasActiveSession || launching || launchBlocked
                        }
                        title={
                          hasActiveSession
                            ? "Already running"
                            : launching
                              ? "Starting…"
                              : launchBlocked
                                ? "Another game is starting"
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
                {primaryLaunchTarget ? (
                  <ContextMenuItem
                    icon={FolderOpen}
                    title={primaryLaunchTarget.path}
                    onClick={() => void handleOpenInExplorer()}
                  >
                    Open in Explorer
                  </ContextMenuItem>
                ) : null}
                {ownedLaunchTargets.length > 0 ? (
                  <ContextMenuItem
                    icon={Trash2}
                    onClick={handleForgetLaunchFile}
                  >
                    Forget launch file
                  </ContextMenuItem>
                ) : null}
              </>
            ) : null}
            {!demo &&
            canLaunchExecutables &&
            gameEmulatorMappings.length > 0 ? (
              <>
                {gameEmulatorMappings.map((mapping) => {
                  const target = resolveEmulatorLaunchTarget(
                    mapping.contentKey,
                    emulatorAutoLaunchTargets,
                    emulatorManualLaunchTargets,
                  );
                  const candidate = emulatorLaunchCandidates.get(
                    mapping.contentKey,
                  );
                  return (
                    <Fragment key={mapping.contentKey}>
                      {target ? (
                        <ContextMenuItem
                          icon={Play}
                          disabled={
                            hasActiveSession || launching || launchBlocked
                          }
                          onClick={() => void handleEmulatorLaunch(mapping)}
                        >
                          Play with {mapping.label} · {mapping.display}
                        </ContextMenuItem>
                      ) : candidate ? (
                        <ContextMenuItem
                          icon={Check}
                          onClick={() =>
                            handleConfirmEmulatorCandidate(mapping)
                          }
                        >
                          Use detected {candidate.displayName}
                        </ContextMenuItem>
                      ) : null}
                      <ContextMenuItem
                        icon={FolderSearch}
                        onClick={() =>
                          void handleSetEmulatorLaunchFile(mapping)
                        }
                      >
                        {target ? "Change" : "Set"} {mapping.label} game file…
                      </ContextMenuItem>
                      {target ? (
                        <ContextMenuItem
                          icon={Trash2}
                          onClick={() =>
                            handleForgetEmulatorLaunchFile(mapping)
                          }
                        >
                          Forget {mapping.label} game file
                        </ContextMenuItem>
                      ) : null}
                    </Fragment>
                  );
                })}
              </>
            ) : null}
          </ContextMenuSubmenu>
        ) : null}
        <ContextMenuSubmenu
          label="Playtime"
          defaultOpen={
            demo &&
            activeTour?.tourId === "log-playtime" &&
            activeTour.stepIndex === 3
          }
          icon={Clock3}
          dataTour={demo ? "demo-menu-playtime" : undefined}
          menuDataTour={demo ? "demo-playtime-menu" : undefined}
        >
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
        </ContextMenuSubmenu>
        {!demo ? (
          canEditCover ? (
            <ContextMenuSubmenu label="Cover and Banner" icon={ImagePlus}>
              <ContextMenuItem
                icon={ImagePlus}
                onClick={() => {
                  contextMenu.close();
                  setArtPickerTab("banner");
                  setShowArtPicker(true);
                }}
              >
                Choose banner…
              </ContextMenuItem>
              <ContextMenuItem
                icon={ImagePlus}
                onClick={() => {
                  contextMenu.close();
                  setArtPickerTab("cover");
                  setShowArtPicker(true);
                }}
              >
                Choose cover…
              </ContextMenuItem>
              <ContextMenuItem
                icon={ImagePlus}
                onClick={() => {
                  contextMenu.close();
                  coverInputRef.current?.click();
                }}
              >
                Upload cover
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
            </ContextMenuSubmenu>
          ) : (
            <ContextMenuItem
              icon={ImagePlus}
              onClick={() => {
                contextMenu.close();
                setArtPickerTab("banner");
                setShowArtPicker(true);
              }}
            >
              Choose banner…
            </ContextMenuItem>
          )
        ) : null}
        {showMatchingActions ? (
          <ContextMenuSubmenu
            label="Matching"
            icon={Search}
            dataTour={demo ? "demo-menu-matching" : undefined}
            menuDataTour={demo ? "demo-matching-menu" : undefined}
          >
            {canCheckMatches ? (
              <ContextMenuItem
                dataTour={demo ? "demo-menu-check-matches" : undefined}
                icon={Search}
                onClick={() => {
                  contextMenu.close();
                  if (demo) setDemoAction("matching");
                  else setShowMatchCheck(true);
                }}
              >
                Check for Matches
              </ContextMenuItem>
            ) : null}
            {game.source && game.exeNames[0] ? (
              <>
                {pendingCommunitySuggestion ? (
                  <ContextMenuItem
                    icon={RotateCcw}
                    onClick={() => {
                      contextMenu.close();
                      setCancelSuggestionTarget(pendingCommunitySuggestion);
                    }}
                  >
                    Cancel Suggestion
                  </ContextMenuItem>
                ) : canSuggestToCommunity ? (
                  <ContextMenuItem
                    dataTour={demo ? "demo-menu-suggest-community" : undefined}
                    icon={Send}
                    onClick={() => {
                      contextMenu.close();
                      if (demo) {
                        setDemoAction("matching");
                        return;
                      }
                      void handleShareAction();
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
          </ContextMenuSubmenu>
        ) : null}
        {!demo && game.libraryImports.length > 0 ? (
          <>
            <ContextMenuItem
              icon={MoveRight}
              onClick={requestMoveToPlayCounter}
            >
              Move to PlayCounter
            </ContextMenuItem>
          </>
        ) : null}
        <ContextMenuSeparator />
        {onStopTracking || demo ? (
          <ContextMenuItem
            dataTour={demo ? "demo-menu-ignore" : undefined}
            icon={Ban}
            onClick={() => {
              if (demo) setDemoAction("ignore");
              else onStopTracking?.(game);
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
            if (demo) setDemoAction("remove");
            else onRemove(game);
            contextMenu.close();
          }}
        >
          Remove from Library
        </ContextMenuItem>
      </ContextMenu>
    );
  };

  const renderDemoAction = () => {
    if (!demo || !demoAction) return null;
    if (demoAction === "matching")
      return (
        <TourSampleSearch
          exeName={game.exeNames[0] ?? "Wow.exe"}
          onClose={() => setDemoAction(null)}
          onConfirm={(choice) => {
            setDemoIdentity({ name: choice.name, source: "igdb" });
            setDemoAction(null);
            emitTourEvent(
              "demo.action-completed",
              `Sample reviewed as ${choice.name}. Nothing was submitted or saved to your library.`,
            );
          }}
        />
      );
    if (demoAction === "ignore")
      return (
        <StopTrackingDialog
          demo
          game={{
            gameId: game.gameId,
            source: game.source ?? "community",
            name: game.name,
            exeNames: game.exeNames,
            emulatorLabels: game.emulatorLabels,
            sessionCount: game.sessionCount,
            aliases: game.aliases,
          }}
          onCancel={() => setDemoAction(null)}
          onConfirm={(clearHistory) => {
            setDemoAction(null);
            setDemoRemoved(true);
            emitTourEvent(
              "demo.action-completed",
              clearHistory
                ? "Sample ignored and its history cleared. Nothing on this PC was blocked."
                : "Sample ignored. Its history is kept, and nothing on this PC was blocked.",
            );
          }}
        />
      );
    if (demoAction === "remove")
      return (
        <RemoveGameDialog
          demo
          game={game}
          onCancel={() => setDemoAction(null)}
          onConfirm={(clearHistory) => {
            setDemoAction(null);
            setDemoRemoved(true);
            emitTourEvent(
              "demo.action-completed",
              clearHistory
                ? "Sample removed together with its history, notes, playthroughs, and shelf membership."
                : "Sample removed. Its history is kept; notes, playthroughs, and shelf membership are removed.",
            );
          }}
        />
      );
    return (
      <Modal
        dataTour="demo-game-action-dialog"
        backdropDataTour="demo-library-modal"
        labelId="demo-game-action-title"
        size="xl"
        title={
          demoAction === "history" ? "Sample history" : "Sample launch file"
        }
        onClose={() => setDemoAction(null)}
        footer={<Button onClick={() => setDemoAction(null)}>Done</Button>}
      >
        {demoAction === "history" ? (
          <StatsPractice game={game} />
        ) : (
          <div className="grid gap-4 text-sm">
            <p className="break-all">
              {demoLaunchPath ?? "No launch file saved for this sample."}
            </p>
            <p className="text-text-muted">
              Choose a sample file or forget it. A real file picker would let
              you select the game's executable; this practice never opens or
              starts a program.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => {
                  setDemoLaunchPath(TOUR_DEMO_GAME.exePath);
                  emitTourEvent(
                    "demo.action-completed",
                    "Sample launch file selected. The path is local to this exercise.",
                  );
                }}
              >
                Use sample Wow.exe
              </Button>
              <Button
                disabled={!demoLaunchPath}
                onClick={() => {
                  setDemoLaunchPath(null);
                  emitTourEvent(
                    "demo.action-completed",
                    "Sample launch path forgotten. Game history is unchanged.",
                  );
                }}
              >
                Forget sample file
              </Button>
            </div>
          </div>
        )}
      </Modal>
    );
  };

  const demoCardProps = demo
    ? {
        "data-tour": "demo-game-card",
        "data-tour-game-id": game.gameId,
        onKeyDown: libraryPractice
          ? (event: React.KeyboardEvent<HTMLElement>) => {
              if (
                event.key === "ContextMenu" ||
                (event.shiftKey && event.key === "F10")
              ) {
                event.preventDefault();
                const rect = event.currentTarget.getBoundingClientRect();
                contextMenu.openAt({ x: rect.left + 20, y: rect.top + 40 });
              }
            }
          : undefined,
      }
    : {};

  if (demoRemoved)
    return (
      <div
        data-tour="demo-action-result"
        className="rounded-xl border border-border bg-surface p-4"
      >
        <p role="status" className="mb-3 text-sm">
          Sample removed from this practice library.
        </p>
        <Button onClick={() => setDemoRemoved(false)}>
          Restore sample card
        </Button>
      </div>
    );

  if (!isList) {
    return (
      <SelectableLibraryCard
        selectionMode={selectionMode}
        selected={selected}
        gameName={game.name}
        onToggleSelection={(range) =>
          onToggleSelection(librarySelectionKey(game), range)
        }
        ref={cardRef}
        {...gameDragProps}
        {...(selectionMode ? {} : contextMenu.props)}
        {...demoCardProps}
        data-controller-item={controllerNavigable ? "game-card" : undefined}
        aria-busy={launching}
        tabIndex={libraryPractice ? 0 : controllerNavigable ? -1 : undefined}
        aria-label={
          controllerNavigable
            ? launching
              ? `${game.name}, starting`
              : `${game.name}, ${hasPrimaryLaunchTarget ? "press A to play" : "no launch file saved"}`
            : undefined
        }
        className="game-library-card group relative isolate flex flex-col overflow-hidden rounded-xl border border-border/70 bg-surface shadow-raised transition duration-200 hover:-translate-y-1 hover:border-accent/80 hover:shadow-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg data-[controller-selected=true]:z-20 data-[controller-selected=true]:scale-[1.04] data-[controller-selected=true]:border-accent data-[controller-selected=true]:brightness-110 data-[controller-selected=true]:shadow-card-hover data-[controller-selected=true]:outline data-[controller-selected=true]:outline-2 data-[controller-selected=true]:outline-offset-[7px] data-[controller-selected=true]:outline-white/80 data-[controller-selected=true]:ring-[7px] data-[controller-selected=true]:ring-accent data-[controller-selected=true]:ring-offset-4 data-[controller-selected=true]:ring-offset-bg"
      >
        {controllerNavigable ? (
          <button
            type="button"
            tabIndex={-1}
            aria-hidden="true"
            data-controller-launch="game"
            disabled={launching || launchBlocked}
            className="hidden"
            onClick={handlePreferredLaunch}
          />
        ) : null}
        {launching ? (
          <LaunchStartingOverlay
            gameName={game.name}
            detected={hasActiveSession}
          />
        ) : null}
        {/* The cover is absolute inside this box so the 3:4 ratio wins. A
            percentage height against an aspect-ratio box is indefinite, so a
            cover in another ratio (SteamGridDB grids are 2:3) would otherwise
            stretch the whole card. */}
        <div className="relative aspect-[3/4] w-full shrink-0 bg-surface-hover">
          {!demo || libraryPractice ? (
            <GameJournalBadges game={{ ...game, gameName: game.name }} />
          ) : null}
          {game.coverUrl ? (
            <GameCover
              src={game.coverUrl}
              alt=""
              draggable={false}
              className="game-card-cover-image absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
            />
          ) : (
            <div className="grid h-full place-items-center text-xs text-text-faint">
              No cover
            </div>
          )}

          {/* Match seals top left. Origin coins sit beside the game name, so the
              right column is just the tracking warning and the hover actions. */}
          {matchVisible && !selectionMode ? (
            <GameProvenanceBadges
              className="peer/provenance absolute left-2 top-2 z-40 drop-shadow-md"
              sources={game.sources}
              emulatorSources={game.emulatorSources}
              approval={communityApproval}
              providers={importedProviders}
              emulatorIds={game.emulatorIds}
              unknownDurationProviders={unknownDurationProviders}
              describeOrigins={originVisible}
              dataTourPrefix={demo ? "demo-source" : undefined}
            />
          ) : null}

          {trackingUnavailable && !libraryMatchOffer ? (
            <div className="peer/tracking-warning group/tracking-warning absolute right-2 top-2 z-40">
              <span
                role="img"
                tabIndex={0}
                aria-label={trackingWarningMessage}
                title="New sessions won't be tracked yet"
                className="grid h-8 w-8 cursor-help place-items-center rounded-full border border-warning-border bg-warning-tint text-warning shadow-raised outline-none transition hover:brightness-110 focus-visible:ring-2 focus-visible:ring-warning focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
              >
                <AlertTriangle size={16} />
              </span>
              <div
                role="tooltip"
                className="pointer-events-none invisible absolute right-0 top-full mt-2 w-52 translate-y-1 rounded-md border border-warning-border bg-surface px-3 py-2 text-left opacity-0 shadow-raised transition group-hover/tracking-warning:visible group-hover/tracking-warning:translate-y-0 group-hover/tracking-warning:opacity-100 group-focus-within/tracking-warning:visible group-focus-within/tracking-warning:translate-y-0 group-focus-within/tracking-warning:opacity-100"
              >
                <div className="text-xs font-semibold text-warning">
                  New sessions won&apos;t be tracked yet
                </div>
                <div className="mt-1 text-[11px] leading-4 text-text-muted">
                  {trackingWarningMessage}
                </div>
              </div>
            </div>
          ) : null}

          {/* Hover Actions - Top Right (constructive first, destructive last) */}
          {!selectionMode ? (
            <div
              className={clsx(
                "game-card-hover-actions absolute right-2 z-30 flex translate-x-2 flex-col gap-1.5 opacity-0 transition-all duration-200 group-hover:translate-x-0 group-hover:opacity-100 focus-within:translate-x-0 focus-within:opacity-100 peer-hover/provenance:pointer-events-none peer-hover/provenance:!opacity-0",
                trackingUnavailable &&
                  "peer-focus-within/tracking-warning:pointer-events-none peer-focus-within/tracking-warning:!opacity-0 peer-hover/tracking-warning:pointer-events-none peer-hover/tracking-warning:!opacity-0",
                trackingUnavailable && !libraryMatchOffer ? "top-12" : "top-2",
                launchTourDemo && "translate-x-0 opacity-100",
              )}
            >
              <IconButton
                icon={Info}
                aria-label={`Open details for ${game.name}`}
                title="Open details"
                onClick={() => setShowDetails(true)}
                className="bg-bg text-text-muted shadow-raised border-bg hover:bg-accent hover:border-accent hover:text-accent-fg"
              />
              <IconButton
                icon={ImagePlus}
                aria-label={`Choose artwork for ${game.name}`}
                title="Choose artwork"
                onClick={() => {
                  if (demo) return demoNotice();
                  setArtPickerTab("banner");
                  setShowArtPicker(true);
                }}
                className="bg-bg text-text-muted shadow-raised border-bg hover:bg-accent hover:border-accent hover:text-accent-fg"
              />
              {canCheckMatches ? (
                <IconButton
                  icon={Search}
                  aria-label={`Check matches for ${game.name}`}
                  title="Check for matches"
                  onClick={() => setShowMatchCheck(true)}
                  className="bg-bg text-text-muted shadow-raised border-bg hover:bg-accent hover:border-accent hover:text-accent-fg"
                />
              ) : null}
              {pendingCommunitySuggestion ? (
                <IconButton
                  icon={RotateCcw}
                  aria-label={`Cancel community suggestion for ${game.name}`}
                  title="Cancel suggestion"
                  onClick={() =>
                    setCancelSuggestionTarget(pendingCommunitySuggestion)
                  }
                  className="bg-bg text-text-muted shadow-raised border-bg hover:bg-accent hover:border-accent hover:text-accent-fg"
                />
              ) : canSuggestToCommunity ? (
                <IconButton
                  icon={Send}
                  aria-label={`Suggest ${game.name} to the community`}
                  title="Suggest to community"
                  onClick={() => void handleShareAction()}
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
                  onClick={() => onStopTracking(game)}
                  className="bg-bg text-text-muted shadow-raised border-bg hover:bg-warning hover:border-warning hover:text-white"
                />
              ) : null}
              <IconButton
                icon={Trash2}
                intent="danger"
                aria-label={`Remove ${game.name} from library`}
                title="Remove from library"
                onClick={() => onRemove(game)}
                className="bg-bg text-text-muted shadow-raised border-bg hover:!bg-danger-solid hover:!border-danger-solid hover:!text-white"
              />
            </div>
          ) : null}

          {libraryMatchPrompt ? (
            <div className="absolute inset-x-2 bottom-2 z-30">
              {libraryMatchPrompt}
            </div>
          ) : null}
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
        <div
          className={clsx(
            "flex flex-1 flex-col border-t border-border bg-surface",
            isLarge ? "p-4" : "p-3",
          )}
        >
          <div className="flex min-w-0 items-center gap-2">
            {/* Origin leads the name: where the game came from, then what it is */}
            {originVisible ? (
              <GameOriginBadges
                providers={importedProviders}
                emulatorIds={game.emulatorIds}
                unknownDurationProviders={unknownDurationProviders}
              />
            ) : null}
            <h2
              className={clsx(
                "min-w-0 flex-1 truncate font-semibold text-text",
                isLarge ? "text-lg" : "text-[15px]",
              )}
              title={exeLabel ? `${game.name} (${exeLabel})` : game.name}
            >
              {exeLabel ? (
                <>
                  <span className="game-card-name-default">{game.name}</span>
                  <span className="game-card-name-exe hidden font-mono text-[13px]">
                    {exeLabel}
                  </span>
                </>
              ) : (
                game.name
              )}
            </h2>
          </div>
          <div
            data-tour={demo ? "demo-playtime-result" : undefined}
            className="mt-1 flex min-w-0 items-baseline gap-1.5"
          >
            <span
              title={playtimeTitle}
              className={clsx(
                "font-mono font-bold tracking-tight text-text",
                isLarge ? "text-xl" : "text-lg",
              )}
            >
              {formatDuration(game.totalSeconds, showDurationDays)}
            </span>
            <span className="text-[11px] font-medium text-text-muted">in</span>
            <button
              type="button"
              disabled={game.sessionCount === 0}
              onClick={handleShowHistory}
              className="truncate text-[11px] font-medium text-text-muted underline decoration-text-faint underline-offset-2 transition-colors hover:text-accent-ink disabled:no-underline"
              aria-label={`Show ${game.sessionCount} session${game.sessionCount === 1 ? "" : "s"} for ${game.name} in history`}
            >
              {game.sessionCount} session
              {game.sessionCount !== 1 ? "s" : ""}
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
        {primaryEmulatorCandidate && primaryEmulatorMapping ? (
          <button
            type="button"
            title={`Confirm ${primaryEmulatorCandidate.displayName} as the ${primaryEmulatorMapping.label} game file for ${game.name}`}
            onClick={() =>
              handleConfirmEmulatorCandidate(primaryEmulatorMapping)
            }
            className="flex items-center gap-2 border-t border-warning-border bg-warning-tint px-3 py-2 text-left text-warning transition hover:brightness-110"
          >
            <AlertTriangle size={14} className="shrink-0" />
            <span className="min-w-0">
              <span className="block text-[10px] font-bold uppercase tracking-wide">
                Action required
              </span>
              <span className="block truncate text-xs">
                Confirm {primaryEmulatorCandidate.displayName} to enable Play
              </span>
            </span>
          </button>
        ) : null}
        {showLaunchFooter ? (
          <button
            type="button"
            aria-label={
              showPlayButton
                ? playState.ariaLabel
                : primaryEmulatorCandidate
                  ? `Confirm ${primaryEmulatorCandidate.displayName} as the ${primaryEmulatorMapping?.label ?? "emulator"} game file for ${game.name}`
                  : gameEmulatorMappings.length > 1
                    ? `Choose an emulator launch option for ${game.name}`
                    : `Set launch file for ${game.name}`
            }
            title={
              showPlayButton
                ? playState.title
                : primaryEmulatorCandidate
                  ? `Confirm ${primaryEmulatorCandidate.displayName} for ${game.name}`
                  : gameEmulatorMappings.length > 1
                    ? "Choose emulator game…"
                    : "Set launch file…"
            }
            data-tour={launchTourDemo ? "demo-launch-play" : undefined}
            disabled={showPlayButton && playState.disabled}
            onClick={(event) => handleLaunchFooterClick(event.currentTarget)}
            className={clsx(
              "flex shrink-0 items-center justify-center gap-2 border-t font-semibold transition disabled:cursor-not-allowed",
              isLarge ? "h-12 text-sm" : "h-10 text-xs",
              !showPlayButton
                ? "border-border text-text-faint hover:bg-surface-hover hover:text-text-muted"
                : playButtonRunning
                  ? "border-success-border bg-success-tint text-success disabled:opacity-100"
                  : "border-accent/30 bg-accent-tint text-accent-ink hover:bg-accent hover:text-accent-fg",
            )}
          >
            {!showPlayButton ? (
              <>
                {primaryEmulatorCandidate ? (
                  <>
                    <Check size={isLarge ? 16 : 14} className="shrink-0" />
                    <span className="min-w-0 truncate">
                      Use {primaryEmulatorCandidate.displayName}
                    </span>
                  </>
                ) : (
                  <>
                    <FolderSearch size={isLarge ? 16 : 14} />
                    {gameEmulatorMappings.length > 1
                      ? "Choose emulator game"
                      : "Set launch file"}
                  </>
                )}
              </>
            ) : playButtonRunning ? (
              <>
                <span className="relative flex h-2.5 w-2.5 items-center justify-center">
                  <span className="absolute inline-flex h-full w-full animate-pulse rounded-full bg-success opacity-50 duration-1000" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-success shadow-[0_0_6px_rgb(var(--color-success)/0.8)]" />
                </span>
                Running
              </>
            ) : playState.loading ? (
              <>
                <Loader2 size={isLarge ? 16 : 14} className="animate-spin" />
                Starting…
              </>
            ) : (
              <>
                {/* Under controller nav the selected card swaps the play icon
                    for the A glyph, so the button doubles as the button hint. */}
                <Play
                  size={isLarge ? 16 : 14}
                  className={clsx(
                    controllerNavigable &&
                      "group-data-[controller-selected=true]:hidden",
                  )}
                />
                {controllerNavigable ? (
                  <span className="hidden group-data-[controller-selected=true]:inline-flex">
                    <XboxButtonGlyph button="A" size="small" />
                  </span>
                ) : null}
                Play
              </>
            )}
          </button>
        ) : showLaunchNote ? (
          <div
            title="PlayCounter can't launch this game directly"
            className={clsx(
              "flex shrink-0 items-center justify-center gap-2 border-t border-border text-text-faint",
              isLarge ? "h-12 text-sm" : "h-10 text-xs",
            )}
          >
            <Info size={isLarge ? 16 : 14} />
            Not launchable
          </div>
        ) : null}
        {renderContextMenu()}
        {renderDetailsDialog()}
        {renderDemoAction()}
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
          trackingUnavailable && matchCheckImportEntry ? (
            <LibraryImportMatchCheckDialog
              apiEndpoint={apiEndpoint}
              entry={matchCheckImportEntry.entry}
              install={matchCheckImportEntry.install}
              ignoredProcesses={ignoredProcesses}
              offeredExecutableMatches={libraryMatchOffer?.executableMatches}
              onCancel={() => setShowMatchCheck(false)}
              onApplied={(executableNames) => {
                setShowMatchCheck(false);
                addToast({
                  tone: "success",
                  title: "Match applied",
                  detail: `${executableNames.join(", ")} will now be tracked as ${game.name}.`,
                });
              }}
            />
          ) : (
            <MatchCheckDialog
              game={game}
              onCancel={() => setShowMatchCheck(false)}
              onApply={handleApplyMatch}
              onReportNotAGame={() => void handleNegativeReport()}
              onSearchCommunity={
                canSuggestToCommunity
                  ? () => {
                      setShowMatchCheck(false);
                      void handleShareAction();
                    }
                  : undefined
              }
            />
          )
        ) : null}
        {reportOpen ? (
          <ReportWrongMatchDialog
            demo={demo}
            exeName={game.exeNames[0] ?? ""}
            gameName={game.name}
            coverUrl={game.coverUrl}
            onCancel={() => setReportOpen(false)}
            onDifferentGame={() => {
              setReportOpen(false);
              if (demo) setDemoAction("matching");
              else setShareOpen(true);
            }}
            onNotAGame={() => {
              if (demo) {
                setReportOpen(false);
                setDemoRemoved(true);
                emitTourEvent(
                  "demo.action-completed",
                  "Sample ignored. No anonymous report was sent.",
                );
              } else void handleNegativeReport();
            }}
          />
        ) : null}
        {cancelSuggestionTarget ? (
          <CancelCommunitySuggestionDialog
            gameName={game.name}
            exeName={cancelSuggestionTarget.exeName}
            isOffline={isOffline}
            onCancel={() => setCancelSuggestionTarget(null)}
            onConfirm={() => handleCancelSuggestion(cancelSuggestionTarget)}
          />
        ) : null}
        {shareOpen ? (
          <CommunitySuggestionForm
            candidates={correction.candidates}
            exeName={primaryExeName ?? ""}
            hasMore={correction.hasMore}
            message={correction.message}
            search={correction.search}
            selection={correction.selection}
            state={correction.state}
            isOffline={isOffline}
            onApplyCandidate={correction.applyCandidate}
            onCancel={closeShare}
            onLoadMore={correction.loadMore}
            onSearch={correction.searchFirstPage}
            onSearchChange={correction.setSearch}
            onSearchOptionsChange={correction.resetResults}
            onSubmit={() => void correction.submit()}
          />
        ) : null}
        {showConvert ? (
          <GameNameDialog
            demo={demo}
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
            demo={demo}
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
      </SelectableLibraryCard>
    );
  }

  // List View
  return (
    <SelectableLibraryCard
      selectionMode={selectionMode}
      selected={selected}
      gameName={game.name}
      onToggleSelection={(range) =>
        onToggleSelection(librarySelectionKey(game), range)
      }
      ref={cardRef}
      {...gameDragProps}
      {...(selectionMode ? {} : contextMenu.props)}
      {...demoCardProps}
      data-controller-item={controllerNavigable ? "game-card" : undefined}
      aria-busy={launching}
      tabIndex={libraryPractice ? 0 : controllerNavigable ? -1 : undefined}
      aria-label={
        controllerNavigable
          ? launching
            ? `${game.name}, starting`
            : `${game.name}, ${hasPrimaryLaunchTarget ? "press A to play" : "no launch file saved"}`
          : undefined
      }
      className="game-library-card group relative isolate rounded-xl border border-border/70 bg-surface shadow-raised transition duration-200 hover:border-accent/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg data-[controller-selected=true]:z-20 data-[controller-selected=true]:scale-[1.025] data-[controller-selected=true]:border-accent data-[controller-selected=true]:brightness-110 data-[controller-selected=true]:shadow-card-hover data-[controller-selected=true]:outline data-[controller-selected=true]:outline-2 data-[controller-selected=true]:outline-offset-[7px] data-[controller-selected=true]:outline-white/80 data-[controller-selected=true]:ring-[7px] data-[controller-selected=true]:ring-accent data-[controller-selected=true]:ring-offset-4 data-[controller-selected=true]:ring-offset-bg"
    >
      {controllerNavigable ? (
        <button
          type="button"
          tabIndex={-1}
          aria-hidden="true"
          data-controller-launch="game"
          disabled={launching || launchBlocked}
          className="hidden"
          onClick={handlePreferredLaunch}
        />
      ) : null}
      {launching ? (
        <LaunchStartingOverlay
          gameName={game.name}
          detected={hasActiveSession}
          compact
        />
      ) : null}
      <div className="grid grid-cols-[72px_minmax(0,1fr)_auto] items-center gap-4 p-3">
        <div className="relative w-[72px] shrink-0">
          {!demo || libraryPractice ? (
            <GameJournalBadges
              game={{ ...game, gameName: game.name }}
              compact
            />
          ) : null}
          {game.coverUrl ? (
            <GameCover
              src={game.coverUrl}
              alt=""
              draggable={false}
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
                  <span className="game-card-name-default">{game.name}</span>
                  <span className="game-card-name-exe hidden font-mono text-sm">
                    {exeLabel}
                  </span>
                </>
              ) : (
                game.name
              )}
            </h2>
            {matchVisible ? (
              <GameMatchBadges
                variant="label"
                sources={game.sources}
                emulatorSources={game.emulatorSources}
                approval={communityApproval}
                dataTourPrefix={demo ? "demo-source" : undefined}
              />
            ) : null}
            {originVisible ? (
              <GameOriginBadges
                variant="label"
                providers={importedProviders}
                emulatorIds={game.emulatorIds}
                unknownDurationProviders={unknownDurationProviders}
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

          {primaryEmulatorCandidate && primaryEmulatorMapping ? (
            <button
              type="button"
              title={`Confirm ${primaryEmulatorCandidate.displayName} as the ${primaryEmulatorMapping.label} game file for ${game.name}`}
              onClick={() =>
                handleConfirmEmulatorCandidate(primaryEmulatorMapping)
              }
              className="mt-2 inline-flex max-w-full items-center gap-1.5 rounded-md border border-warning-border bg-warning-tint px-2 py-1 text-xs font-medium text-warning transition hover:brightness-110"
            >
              <AlertTriangle size={13} className="shrink-0" />
              <span className="truncate">
                Action required: confirm {primaryEmulatorCandidate.displayName}
              </span>
            </button>
          ) : null}

          {libraryMatchPrompt}
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

        <div className="flex items-center gap-3 pr-2 lg:gap-6">
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
                <span title={playtimeTitle}>
                  {formatDuration(game.totalSeconds, showDurationDays)}
                </span>
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

          {showPlayButton ? (
            <IconButton
              aria-label={playState.ariaLabel}
              title={playState.title}
              data-tour={launchTourDemo ? "demo-launch-play" : undefined}
              disabled={playState.disabled}
              onClick={handlePreferredLaunch}
              className={clsx(
                "shrink-0",
                playButtonRunning
                  ? "border-success-border bg-success-tint disabled:opacity-100"
                  : "border-accent/30 bg-accent-tint text-accent-ink hover:border-accent hover:bg-accent hover:text-accent-fg",
              )}
            >
              {playButtonRunning ? (
                <span className="relative flex h-2.5 w-2.5 items-center justify-center">
                  <span className="absolute inline-flex h-full w-full animate-pulse rounded-full bg-success opacity-50 duration-1000" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-success shadow-[0_0_6px_rgb(var(--color-success)/0.8)]" />
                </span>
              ) : playState.loading ? (
                <Loader2 size={15} className="animate-spin" />
              ) : controllerNavigable ? (
                <>
                  <Play
                    size={15}
                    className="group-data-[controller-selected=true]:hidden"
                  />
                  <span className="hidden group-data-[controller-selected=true]:inline-flex">
                    <XboxButtonGlyph button="A" size="small" />
                  </span>
                </>
              ) : (
                <Play size={15} />
              )}
            </IconButton>
          ) : null}

          {!selectionMode ? (
            <div
              className={clsx(
                "flex flex-col gap-1.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100",
                launchTourDemo && "opacity-100",
              )}
            >
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
                  onClick={() => onStopTracking(game)}
                />
              ) : null}
              <IconButton
                icon={Trash2}
                intent="danger"
                aria-label={`Remove ${game.name} from library`}
                title="Remove from library"
                onClick={() => onRemove(game)}
              />
            </div>
          ) : null}
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
      {renderDetailsDialog()}
      {renderDemoAction()}
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
        trackingUnavailable && matchCheckImportEntry ? (
          <LibraryImportMatchCheckDialog
            apiEndpoint={apiEndpoint}
            entry={matchCheckImportEntry.entry}
            install={matchCheckImportEntry.install}
            ignoredProcesses={ignoredProcesses}
            offeredExecutableMatches={libraryMatchOffer?.executableMatches}
            onCancel={() => setShowMatchCheck(false)}
            onApplied={(executableNames) => {
              setShowMatchCheck(false);
              addToast({
                tone: "success",
                title: "Match applied",
                detail: `${executableNames.join(", ")} will now be tracked as ${game.name}.`,
              });
            }}
          />
        ) : (
          <MatchCheckDialog
            game={game}
            onCancel={() => setShowMatchCheck(false)}
            onApply={handleApplyMatch}
            onReportNotAGame={() => void handleNegativeReport()}
            onSearchCommunity={
              canSuggestToCommunity
                ? () => {
                    setShowMatchCheck(false);
                    void handleShareAction();
                  }
                : undefined
            }
          />
        )
      ) : null}
      {reportOpen ? (
        <ReportWrongMatchDialog
          demo={demo}
          exeName={game.exeNames[0] ?? ""}
          gameName={game.name}
          coverUrl={game.coverUrl}
          onCancel={() => setReportOpen(false)}
          onDifferentGame={() => {
            setReportOpen(false);
            if (demo) setDemoAction("matching");
            else setShareOpen(true);
          }}
          onNotAGame={() => {
            if (demo) {
              setReportOpen(false);
              setDemoRemoved(true);
              emitTourEvent(
                "demo.action-completed",
                "Sample ignored. No anonymous report was sent.",
              );
            } else void handleNegativeReport();
          }}
        />
      ) : null}
      {cancelSuggestionTarget ? (
        <CancelCommunitySuggestionDialog
          gameName={game.name}
          exeName={cancelSuggestionTarget.exeName}
          isOffline={isOffline}
          onCancel={() => setCancelSuggestionTarget(null)}
          onConfirm={() => handleCancelSuggestion(cancelSuggestionTarget)}
        />
      ) : null}
      {shareOpen ? (
        <CommunitySuggestionForm
          candidates={correction.candidates}
          exeName={primaryExeName ?? ""}
          hasMore={correction.hasMore}
          message={correction.message}
          search={correction.search}
          selection={correction.selection}
          state={correction.state}
          isOffline={isOffline}
          onApplyCandidate={correction.applyCandidate}
          onCancel={closeShare}
          onLoadMore={correction.loadMore}
          onSearch={correction.searchFirstPage}
          onSearchChange={correction.setSearch}
          onSearchOptionsChange={correction.resetResults}
          onSubmit={() => void correction.submit()}
        />
      ) : null}
      {showConvert ? (
        <GameNameDialog
          demo={demo}
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
          demo={demo}
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
    </SelectableLibraryCard>
  );
}

const MemoizedGameLibraryCard = memo(GameLibraryCard);

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
  demo = false,
}: {
  game: Exclude<PendingStopTracking, null>;
  onCancel: () => void;
  onConfirm: (clearHistory: boolean) => void;
  demo?: boolean;
}) {
  return (
    <Modal
      dataTour={demo ? "demo-ignore-dialog" : undefined}
      backdropDataTour={demo ? "demo-library-modal" : undefined}
      size="sm"
      labelId="stop-tracking-dialog-title"
      eyebrow="My Games"
      title="Ignore this game?"
      subtitle={game.name}
      icon={Ban}
      onClose={onCancel}
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2 [&>button]:whitespace-nowrap">
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
          History or cleared now. Clearing also deletes the game's notes and
          playthroughs and takes it off your shelves.
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
  demo = false,
}: {
  game: Exclude<PendingRemoval, null>;
  onCancel: () => void;
  onConfirm: (removeHistory: boolean) => void;
  demo?: boolean;
}) {
  return (
    <Modal
      dataTour={demo ? "demo-remove-dialog" : undefined}
      backdropDataTour={demo ? "demo-library-modal" : undefined}
      size="sm"
      labelId="remove-game-dialog-title"
      eyebrow="My Games"
      title="Remove from library?"
      subtitle={game.name}
      icon={Trash2}
      onClose={onCancel}
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2 [&>button]:whitespace-nowrap">
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
      <p className="mt-2 text-sm leading-6 text-text-muted">
        This also deletes the game's notes and playthroughs and takes it off
        your shelves.
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
  onConfirm: (
    durationSeconds: number,
    endedAt: string,
    playthroughId?: string,
  ) => void;
}) {
  const journal = useGameJournal({ ...game, gameName: game.name });
  const [playthroughId, setPlaythroughId] = useState("");
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
    onConfirm(
      durationSeconds,
      parsedDate.toISOString(),
      playthroughId || undefined,
    );
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
        <History size={17} className="mt-0.5 shrink-0 text-accent-ink" />
        <div>
          <div className="font-semibold text-text">Added to History</div>
          <p className="mt-0.5 leading-5 text-text-muted">
            This session will affect dates, streaks, and other play stats.
          </p>
        </div>
      </div>

      <div className="mt-5 rounded-xl border border-border bg-bg/60 p-4">
        {!demo ? (
          <label className="mb-4 grid gap-2 text-sm text-text-muted">
            Playthrough
            <Select
              aria-label="Manual session playthrough"
              value={playthroughId}
              onChange={(event) => setPlaythroughId(event.target.value)}
            >
              <option value="">{DEFAULT_PLAYTHROUGH_NAME}</option>
              {journal.playthroughs.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </label>
        ) : null}
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
      dataTour={game.kind === "tour-demo" ? "demo-adjust-dialog" : undefined}
      backdropDataTour={
        game.kind === "tour-demo" ? "demo-library-modal" : undefined
      }
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
          <span className="font-mono text-base font-bold text-accent-ink">
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

function LibraryImportMatchCheckDialog({
  apiEndpoint,
  entry,
  install,
  ignoredProcesses,
  offeredExecutableMatches,
  onCancel,
  onApplied,
}: {
  apiEndpoint: string;
  entry: LibraryImportEntry;
  install?: LibraryInstallEntry;
  ignoredProcesses: ReadonlySet<string>;
  offeredExecutableMatches?: readonly LibraryExecutableMatch[];
  onCancel: () => void;
  onApplied: (executableNames: string[]) => void;
}) {
  const providerLabel =
    providerTabConfig(entry.provider)?.label ?? entry.provider;
  const isOffline = useIsOffline();
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<LibraryImportMatchCheck | null>(null);
  const [error, setError] = useState("");
  const [applying, setApplying] = useState(false);
  const checking = !result && !error && !isOffline;
  // The startup offer is a preview only; applying still requires a fresh result.
  const executableMatches =
    result?.kind === "found"
      ? result.executableMatches
      : checking
        ? (offeredExecutableMatches ?? [])
        : [];
  const showingMatch = executableMatches.length > 0;

  useEffect(() => {
    if (isOffline) return;
    let cancelled = false;
    const controller = new AbortController();
    setResult(null);
    setError("");
    void checkLibraryImportForMatches({
      apiEndpoint,
      entry,
      install,
      ignoredProcesses,
      signal: controller.signal,
    })
      .then((next) => {
        if (!cancelled) setResult(next);
      })
      .catch((cause) => {
        if (!cancelled) setError(formatError(cause));
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [apiEndpoint, attempt, entry, ignoredProcesses, install, isOffline]);

  function applyMatch() {
    if (isOffline || applying || result?.kind !== "found") return;
    setApplying(true);
    setError("");
    try {
      commitLibraryImports([result.commit]);
      onApplied(result.executableNames);
    } catch (cause) {
      setError(formatError(cause));
      setApplying(false);
    }
  }

  const retry = () => setAttempt((value) => value + 1);
  const footer = (
    <div className="grid gap-2 sm:grid-cols-2">
      <Button
        variant={showingMatch ? "primary" : "secondary"}
        icon={showingMatch ? Check : Search}
        className="h-10"
        loading={checking || applying}
        aria-busy={checking || applying}
        disabled={isOffline}
        onClick={result?.kind === "found" ? applyMatch : retry}
      >
        {showingMatch
          ? `Use ${executableMatches.length === 1 ? "match" : "matches"}`
          : checking
            ? "Checking…"
            : "Check again"}
      </Button>
      <Button
        variant="ghost"
        className="h-10"
        disabled={applying}
        onClick={onCancel}
      >
        {showingMatch || checking ? "Cancel" : "Close"}
      </Button>
    </div>
  );

  return (
    <Modal
      size="md"
      labelId="library-match-check-title"
      eyebrow={`${providerLabel} executable`}
      title={`Check matches for ${entry.name}`}
      subtitle={`${providerLabel} ${entry.provider === "battlenet" ? "product" : entry.provider === "steam" ? "AppID" : "Title ID"} ${entry.externalId}`}
      icon={Search}
      onClose={onCancel}
      footer={footer}
    >
      <p className="text-sm leading-6 text-text-muted">
        Checks whether IGDB or the approved Community database now knows an
        executable for this {providerLabel} game.
      </p>

      <div
        className={clsx(
          "mt-3 max-h-60 overflow-y-auto break-words rounded-xl border px-3 py-2.5 text-sm",
          isOffline
            ? "border-warning-border bg-warning-tint text-warning"
            : error
              ? "border-danger-border bg-danger-tint text-danger"
              : showingMatch
                ? "border-success-border/35 bg-bg/60 text-success"
                : result?.kind === "needs_install" ||
                    result?.kind === "unsupported"
                  ? "border-warning-border bg-warning-tint text-warning"
                  : "border-border bg-bg/60 text-text-muted",
        )}
        role="status"
        aria-live="polite"
        aria-busy={checking}
      >
        {isOffline ? (
          <div className="flex items-center gap-2 font-medium">
            <WifiOff size={17} className="shrink-0" /> Checking the database
            needs an internet connection.
          </div>
        ) : error ? (
          <>
            <div className="font-semibold">The match check failed</div>
            <div className="mt-1 text-text-muted">{error}</div>
          </>
        ) : showingMatch ? (
          <>
            <div className="flex items-center gap-2 font-semibold">
              <Check size={18} className="shrink-0" />{" "}
              {executableMatches.length === 1
                ? "Executable match found"
                : "Executable matches found"}
            </div>
            <ul className="mt-1.5 space-y-1.5">
              {executableMatches.map((match) => (
                <li
                  key={match.name.toLowerCase()}
                  className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5"
                >
                  <span className="min-w-0 max-w-full break-words font-mono text-xs leading-5 text-text">
                    {match.name}
                  </span>
                  <GameMatchBadges sources={match.sources} variant="label" />
                </li>
              ))}
            </ul>
            {checking ? (
              <span className="sr-only">Confirming the latest match…</span>
            ) : null}
          </>
        ) : !result ? (
          <div className="flex items-center gap-2">
            <Loader2 size={18} className="shrink-0 animate-spin" />
            Checking IGDB and community databases…
          </div>
        ) : result.kind === "needs_install" ? (
          <>
            <div className="font-semibold">Local confirmation required</div>
            <p className="mt-1 leading-5 text-text-muted">
              The database knows {result.executableNames.join(", ")}, but the
              filename can&apos;t be linked globally. Install the game and run a{" "}
              {providerLabel} scan so PlayCounter can safely scope it to that
              folder.
            </p>
          </>
        ) : result.kind === "unsupported" ? (
          <>
            This PlayCounter backend does not support {providerLabel} executable
            checks yet.
          </>
        ) : (
          <>
            <div className="font-semibold text-text">No match found yet</div>
            <p className="mt-1 leading-5">
              There is still no approved executable for this {providerLabel}{" "}
              game. You can check again after a Community suggestion has been
              approved.
            </p>
          </>
        )}
      </div>
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
                    <Check size={18} className="shrink-0 text-accent-ink" />
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
  demo = false,
}: {
  title: string;
  subtitle: string;
  description: string;
  confirmLabel: string;
  name: string;
  onNameChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
  demo?: boolean;
}) {
  return (
    <Modal
      dataTour={demo ? "demo-game-name-dialog" : undefined}
      backdropDataTour={demo ? "demo-library-modal" : undefined}
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
            placeholder="e.g. Stardew Valley (modded)"
          />
        </label>
      </form>
    </Modal>
  );
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
