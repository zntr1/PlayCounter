import { LIBRARY_PROVIDER_LABELS } from "@playcounter/shared";
import { LibraryTourPractice } from "./tour/LibraryTourPractice";
import { TourPracticeSurface } from "./tour/TourPracticeSurface";
import { findTour } from "./tour/tourDefinitions";
import {
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  Bug,
  Check,
  ChevronDown,
  Cpu,
  Download,
  EyeOff,
  Gamepad2,
  Info,
  Image as ImageIcon,
  ListChecks,
  LoaderCircle,
  MessageSquarePlus,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  Settings,
  Trophy,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import clsx from "clsx";
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import {
  Component,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ErrorInfo,
  type ReactNode,
  lazy,
  Suspense,
} from "react";
import { initializeTracker } from "../tracker";
import { PlayCounterLoader } from "../brand/PlayCounterLoader";
import { PlayCounterAnimatedIcon } from "../brand/PlayCounterAnimatedIcon";
import { PlayCounterWordmark } from "../brand/PlayCounterWordmark";
import {
  CONTROLLER_MODE_EVENT,
  deactivateControllerMode,
} from "../controllerBridge";
import { emulatorAssetUrls } from "../emulators/assets";
import { BackToTopButton } from "./BackToTopButton";
import { FeedbackDialog } from "./FeedbackDialog";
import { RequestWarning } from "./RequestWarning";
import { GameJournalHost } from "./GameJournalDialog";
import { NotificationBell } from "./NotificationBell";
import { ReleaseNotesDialog } from "./ReleaseNotesDialog";
import { SidebarButton } from "./SidebarButton";
import { GlobalSearch } from "./shell/GlobalSearch";
import { GlobalTooltip } from "./shell/GlobalTooltip";
import { HeaderLinks } from "./shell/HeaderLinks";
import { SidebarSources } from "./shell/SidebarSources";
import { WindowControls } from "./shell/WindowControls";
import { useLibrarySources } from "./librarySources";
import { ViewBanner } from "./ViewBanner";
import { artSrcSet } from "./artSrcSet";
import {
  DEFAULT_CONTENT_SCALE,
  DEFAULT_MENU_SCALE,
  normalizeInterfaceScale,
} from "../interfaceScale";
import { XboxButtonGlyph, type XboxControl } from "./XboxButtonGlyph";
import { Button, IconButton } from "./primitives";
import { useNeedsReviewCount } from "./views/DiscoveredView";
import { DevToolsView } from "./views/DevToolsView";
import { HistoryView } from "./views/HistoryView";
import { AchievementsView } from "./views/AchievementsView";
import { MyGamesView } from "./views/MyGamesView";
import { NowPlayingView } from "./views/NowPlayingView";
import { NowEmulatingView } from "./views/NowEmulatingView";
import { DolphinView, DosboxView, Pcsx2View } from "./views/EmulatorsView";
import { DiscoveredView } from "./views/DiscoveredView";
import { SettingsView } from "./views/SettingsView";
import { HelpButton, TourOverlay, WelcomePrompt } from "./tour/TourUI";
import { emulatorTourDemoActive } from "./tour/tourDemoGame";
import { shouldShowWelcome } from "./tour/tourState";
import {
  BUILD_STAGE,
  useAppStore,
  useIsOffline,
  type Stage,
  type Toast,
  type ViewId,
} from "../store";
import {
  checkForUpdate,
  installAvailableUpdate,
  type InstallProgress,
  type UpdateCheckResult,
} from "../updater";
import {
  planUpdateNotice,
  UPDATE_FIRST_CHECK_DELAY_MS,
  type UpdateCheckOutcome,
} from "../updateNotice";
import {
  decideReleaseNotesDisplay,
  findUnseenReleaseNotes,
  isEmptyDisplayNotes,
  parseManifestNotes,
  toDisplayNotes,
} from "../releaseNotes";

const ImportLibraryView = lazy(() => import("./views/ImportLibraryView"));

class ImporterErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Library importer failed to render", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="rounded-lg border border-danger-border bg-danger-tint px-4 py-3 text-sm text-danger">
          The library importer could not be opened: {this.state.error.message}
        </div>
      );
    }
    return this.props.children;
  }
}

function backToMyGames() {
  const { libraryImportProvider, setActiveView, setLibraryTab } =
    useAppStore.getState();
  setLibraryTab(libraryImportProvider);
  setActiveView("games");
}

const views: Record<
  ViewId,
  {
    label: string;
    subtitle: string;
    icon: typeof Play;
    imageSrc?: string;
    component: ReactNode;
  }
> = {
  now: {
    label: "Now Playing",
    subtitle: "What you're playing right now",
    icon: Play,
    component: <NowPlayingView />,
  },
  emulating: {
    label: "Now Emulating",
    subtitle: "Games currently running inside emulators",
    icon: Play,
    component: <NowEmulatingView />,
  },
  dosbox: {
    label: "DOSBox",
    subtitle: "DOS games, mappings, and emulator playtime",
    icon: Cpu,
    imageSrc: emulatorAssetUrls.dosbox,
    component: <DosboxView />,
  },
  dolphin: {
    label: "Dolphin",
    subtitle: "GameCube and Wii games, mappings, and emulator playtime",
    icon: Cpu,
    imageSrc: emulatorAssetUrls.dolphin,
    component: <DolphinView />,
  },
  pcsx2: {
    label: "PCSX2",
    subtitle: "PlayStation 2 games, mappings, and emulator playtime",
    icon: Cpu,
    imageSrc: emulatorAssetUrls.pcsx2,
    component: <Pcsx2View />,
  },
  games: {
    label: "My Games",
    subtitle: "Every game PlayCounter has tracked for you",
    icon: Gamepad2,
    // Mounted separately so its shared data can load before the cards.
    component: null,
  },
  import: {
    label: "Import library",
    subtitle: "Bring an existing game library into PlayCounter",
    icon: Download,
    component: (
      <div className="grid gap-4">
        <div>
          <Button
            variant="secondary"
            icon={ArrowLeft}
            data-controller-item="view-link"
            onClick={backToMyGames}
          >
            Back to My Games
          </Button>
        </div>
        <ImporterErrorBoundary>
          <Suspense
            fallback={
              <PlayCounterLoader
                label="Loading importer…"
                className="min-h-[320px] text-text-muted"
              />
            }
          >
            <ImportLibraryView />
          </Suspense>
        </ImporterErrorBoundary>
      </div>
    ),
  },
  discovered: {
    label: "Discovered",
    subtitle: "Apps found on your system, ready to match",
    icon: ListChecks,
    component: <DiscoveredView />,
  },
  history: {
    label: "My History",
    subtitle: "Your past play sessions",
    icon: BarChart3,
    component: <HistoryView />,
  },
  achievements: {
    label: "Achievements",
    subtitle: "Unlocked achievements and progress toward what comes next",
    icon: Trophy,
    component: <AchievementsView />,
  },
  settings: {
    label: "Settings",
    subtitle: "Configure how PlayCounter runs",
    icon: Settings,
    component: <SettingsView />,
  },
  dev: {
    label: "Dev Tools",
    subtitle: "Diagnostics and developer tools",
    icon: Bug,
    component: <DevToolsView />,
  },
};

const sidebarSections: Array<{
  id: string;
  label: string;
  items: ViewId[];
}> = [
  { id: "library", label: "Library", items: ["now", "games"] },
  { id: "discover", label: "Discover", items: ["achievements", "history"] },
  {
    id: "emulators",
    label: "Tools",
    items: ["emulating", "dosbox", "dolphin", "pcsx2"],
  },
  { id: "system", label: "System", items: ["discovered", "settings", "dev"] },
];

const STORAGE_KEY = "playcounter:v1";

let startupPreferenceSynced = false;

export function App() {
  const contentRef = useRef<HTMLDivElement>(null);
  const titleBarRef = useRef<HTMLElement>(null);
  const titleBarArtRef = useRef<HTMLDivElement>(null);
  // Fade only the artwork layer. Changing an inherited header variable and
  // then measuring width here forces style recalculation on every scroll.
  const syncTitleBarFade = (content: HTMLElement) => {
    const art = titleBarArtRef.current;
    if (!art) return;
    const fade = Math.max(0, Math.min(1, 1 - content.scrollTop / 180));
    art.style.opacity = `calc(var(--titlebar-art-opacity) * ${fade.toFixed(3)})`;
  };
  const controllerModeRef = useRef(false);
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [controllerModeActive, setControllerModeActive] = useState(false);
  const [startupUpdate, setStartupUpdate] = useState<UpdateCheckResult | null>(
    null,
  );
  const [installProgress, setInstallProgress] =
    useState<InstallProgress | null>(null);
  const [installingUpdate, setInstallingUpdate] = useState(false);
  const [startupNotesOpen, setStartupNotesOpen] = useState(false);
  const [devToolsEnabled, setDevToolsEnabled] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const activeView = useAppStore((state) => state.activeView);
  // My Games and Now Playing carry their own hero; My History too, built
  // from the play history itself, so the pinned-game banner stays off there.
  const viewBannerEnabled = useAppStore(
    (state) =>
      activeView !== "games" &&
      activeView !== "now" &&
      activeView !== "history" &&
      state.settings.viewShowHero?.[activeView] === true,
  );
  const setViewShowHero = useAppStore((state) => state.setViewShowHero);
  const [viewBannerArt, setViewBannerArt] = useState<string | null>(null);
  const [importerMounted, setImporterMounted] = useState(
    activeView === "import",
  );
  const renderImporter = importerMounted || activeView === "import";
  useEffect(() => {
    if (activeView === "import") setImporterMounted(true);
  }, [activeView]);
  // Paint navigation first, then build the library in an interruptible render.
  // Keep it mounted after opening so filters, card state, and covers survive.
  const deferredGamesRequested = useDeferredValue(
    activeView === "games" || viewBannerEnabled,
    false,
  );
  const [gamesMounted, setGamesMounted] = useState(false);
  const [gamesOpened, setGamesOpened] = useState(false);
  const renderGames = gamesMounted || deferredGamesRequested;
  useEffect(() => {
    if (deferredGamesRequested) setGamesMounted(true);
    if (activeView === "games") setGamesOpened(true);
  }, [activeView, deferredGamesRequested]);
  const libraryImportProvider = useAppStore(
    (state) => state.libraryImportProvider,
  );
  const activeViewLabel =
    activeView === "import"
      ? `Import from ${LIBRARY_PROVIDER_LABELS[libraryImportProvider]}`
      : views[activeView].label;
  const activeViewSubtitle =
    activeView === "import"
      ? libraryImportProvider === "xbox"
        ? "Bring your Xbox games and playtime into PlayCounter"
        : libraryImportProvider === "battlenet"
          ? "Add your Battle.net games to PlayCounter"
          : libraryImportProvider === "epic"
            ? "Bring your Epic Games library and playtime into PlayCounter"
            : "Bring your Steam library and playtime into PlayCounter"
      : views[activeView].subtitle;
  const activeTour = useAppStore((state) => state.activeTour);
  const activeTourId = activeTour?.tourId ?? null;
  const tour = activeTourId ? findTour(activeTourId) : undefined;
  const practiceStep =
    (tour?.practice || tour?.simulation) && activeTour
      ? tour.steps[activeTour.stepIndex]
      : undefined;
  const showViewBanner = viewBannerEnabled && !activeTour;
  const tourProgress = useAppStore((state) => state.tourProgress);
  const lastSeenReleaseNotesVersion = useAppStore(
    (state) => state.lastSeenReleaseNotesVersion,
  );
  const hadPersistedStateOnStartup = useAppStore(
    (state) => state.hadPersistedStateOnStartup,
  );
  const currentNotesOpen = useAppStore((state) => state.currentNotesOpen);
  const markReleaseNotesSeen = useAppStore(
    (state) => state.markReleaseNotesSeen,
  );
  const openCurrentReleaseNotes = useAppStore(
    (state) => state.openCurrentReleaseNotes,
  );
  const closeCurrentReleaseNotes = useAppStore(
    (state) => state.closeCurrentReleaseNotes,
  );
  const setActiveView = useAppStore((state) => state.setActiveView);
  const setHistoryQuery = useAppStore((state) => state.setHistoryQuery);
  const setHistoryGameKey = useAppStore((state) => state.setHistoryGameKey);
  const runtimeError = useAppStore((state) => state.runtimeError);
  const backendHealth = useAppStore((state) => state.backendHealth);
  const isOffline = useIsOffline();
  const apiEndpoint = useAppStore((state) => state.settings.apiEndpoint);
  const addToast = useAppStore((state) => state.addToast);
  const needsReviewCount = useNeedsReviewCount();
  const hasAmbiguousMatch = useAppStore(
    (state) => state.ambiguousMatches.length > 0,
  );
  const activeSessionsCount = useAppStore(
    (state) =>
      state.activeSessions.filter((session) => !session.emulator).length,
  );
  const knownEmulators = useAppStore((state) => state.knownEmulators);
  const emulatorDetectionEnabled = useAppStore(
    (state) => state.settings.emulatorDetection !== false,
  );
  const ignoredEmulatorIds = useAppStore(
    (state) => state.settings.ignoredEmulatorIds ?? [],
  );
  const ignoredEmulatorSet = new Set(
    ignoredEmulatorIds.map((id) => id.toLowerCase()),
  );
  const emulatorIsRunning = useAppStore((state) => {
    if (state.settings.emulatorDetection === false) return false;
    const ignored = new Set(
      (state.settings.ignoredEmulatorIds ?? []).map((id) => id.toLowerCase()),
    );
    return (
      state.processes.some(
        (process) =>
          process.emulatorId && !ignored.has(process.emulatorId.toLowerCase()),
      ) ||
      state.activeSessions.some(
        (session) =>
          session.emulator &&
          !ignored.has(session.emulator.emulatorId.toLowerCase()),
      )
    );
  });
  const emulatorObservations = useAppStore(
    (state) => state.emulatorObservations,
  );
  const emulatorMappings = useAppStore((state) => state.emulatorMappings);
  const emulatorReviewCount = (emulatorId: string) =>
    emulatorObservations.filter(
      (item) => item.kind === "content" && item.emulatorId === emulatorId,
    ).length +
    [...emulatorMappings.values()].filter(
      (mapping) =>
        mapping.emulatorId === emulatorId && mapping.needsConfirmation,
    ).length;
  const emulatorTourDemo = emulatorTourDemoActive(activeTourId);
  const sidebarEmulatorBadge = (item: "dosbox" | "dolphin" | "pcsx2") =>
    emulatorTourDemo && item === "dolphin" ? 1 : emulatorReviewCount(item);
  const sidebarCollapsed = useAppStore(
    (state) => state.settings.sidebarCollapsed === true,
  );
  // Banner artwork continues behind the title bar at either banner size.
  // Two independent zooms: navigation chrome and the content area. CSS zoom
  // keeps pointer coordinates consistent; portals to <body> stay at 100%.
  const contentScale = useAppStore((state) =>
    normalizeInterfaceScale(state.settings.contentScale, DEFAULT_CONTENT_SCALE),
  );
  const menuScale = useAppStore((state) =>
    normalizeInterfaceScale(state.settings.menuScale, DEFAULT_MENU_SCALE),
  );
  const setSidebarCollapsed = useAppStore((state) => state.setSidebarCollapsed);
  const sourcesCollapsed = useAppStore(
    (state) => state.settings.sidebarSourcesCollapsed === true,
  );
  const setSidebarSourcesCollapsed = useAppStore(
    (state) => state.setSidebarSourcesCollapsed,
  );
  const libraryTab = useAppStore((state) => state.libraryTab);
  // The title bar uses the same image frame as the banner and its lower
  // continuation, darkened so the controls stay readable.
  const heroArt = useLibrarySources((state) =>
    state.heroVisible ? state.heroArt : null,
  );
  const nowArt = useLibrarySources((state) => state.nowArt);
  const hasFeaturedGame = useLibrarySources((state) => state.featured !== null);
  const compactBannerVisible = showViewBanner && hasFeaturedGame;
  const viewBannerDetails = useAppStore(
    (state) => state.settings.viewBannerDetails === true,
  );
  // Now Playing always follows the first running game, including when older
  // settings still have its optional library banner enabled.
  const titleBarArt =
    activeView === "now"
      ? nowArt
      : activeView === "games" && !practiceStep
        ? heroArt
        : compactBannerVisible
          ? viewBannerArt
          : null;
  const artFrame: "card" | "full" = activeView === "now" ? "full" : "card";
  const libraryCount = useLibrarySources((state) =>
    state.ready ? state.gameCount : undefined,
  );
  const hasLibrarySources = useLibrarySources(
    (state) => state.visible && state.tabs.length > 0,
  );
  const setLibraryTab = useAppStore((state) => state.setLibraryTab);

  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    content.scrollTop = 0;
    content.scrollLeft = 0;
    syncTitleBarFade(content);
  }, [activeTourId, activeView]);

  useLayoutEffect(() => {
    const content = contentRef.current;
    if (content) syncTitleBarFade(content);
  }, [titleBarArt]);

  useLayoutEffect(() => {
    const content = contentRef.current;
    const bar = titleBarRef.current;
    if (!content || !bar) return;
    // Match the banner's crop when the content resizes, including when its
    // scrollbar appears or disappears. Scrolling needs no width measurement.
    const syncWidth = () => {
      const width = `${content.clientWidth}px`;
      if (bar.style.getPropertyValue("--content-width") !== width)
        bar.style.setProperty("--content-width", width);
    };
    syncWidth();
    const observer = new ResizeObserver(syncWidth);
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const handleControllerMode = (event: Event) => {
      const detail = (event as CustomEvent<{ active?: boolean }>).detail;
      const active = detail?.active === true;
      controllerModeRef.current = active;
      setControllerModeActive(active);
      if (active) {
        document.documentElement.setAttribute("data-controller-mode", "true");
      } else {
        document.documentElement.removeAttribute("data-controller-mode");
      }
    };
    const leaveControllerMode = (event: Event) => {
      if (event.type === "keydown" && !event.isTrusted) return;
      if (!controllerModeRef.current) return;
      deactivateControllerMode();
    };

    window.addEventListener(CONTROLLER_MODE_EVENT, handleControllerMode);
    window.addEventListener("pointermove", leaveControllerMode, true);
    window.addEventListener("pointerdown", leaveControllerMode, true);
    window.addEventListener("keydown", leaveControllerMode, true);
    return () => {
      window.removeEventListener(CONTROLLER_MODE_EVENT, handleControllerMode);
      window.removeEventListener("pointermove", leaveControllerMode, true);
      window.removeEventListener("pointerdown", leaveControllerMode, true);
      window.removeEventListener("keydown", leaveControllerMode, true);
      document.documentElement.removeAttribute("data-controller-mode");
    };
  }, []);

  useEffect(() => {
    void initializeTracker();
    void syncLaunchOnStartupPreference();
    void getVersion()
      .then(setAppVersion)
      .catch(() => setAppVersion(null));

    let cancelled = false;
    let hadSuccessfulCheck = false;
    let updateCheckTimer: number | undefined;

    async function runUpdateCheck() {
      let outcome: UpdateCheckOutcome = "failed";
      try {
        const result = await checkForUpdate();
        outcome = result.status;
        if (!cancelled && result.status === "available") {
          setStartupUpdate(result);
          void invoke("set_tray_update", { version: result.version }).catch(
            () => undefined,
          );
        }
      } catch {
        outcome = "failed";
      }
      if (cancelled) return;

      const plan = planUpdateNotice({
        outcome,
        hadSuccessfulCheck,
        gameRunning: useAppStore.getState().activeSessions.length > 0,
      });
      if (outcome !== "failed") hadSuccessfulCheck = true;
      if (plan.reveal) {
        void invoke("show_main_window_for_update").catch(() => undefined);
      }
      updateCheckTimer = window.setTimeout(
        () => void runUpdateCheck(),
        plan.nextCheckMs,
      );
    }

    updateCheckTimer = window.setTimeout(
      () => void runUpdateCheck(),
      UPDATE_FIRST_CHECK_DELAY_MS,
    );

    return () => {
      cancelled = true;
      window.clearTimeout(updateCheckTimer);
    };
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (!event.ctrlKey || event.altKey || event.metaKey) return;
      const key = event.key.toLowerCase();
      if (event.shiftKey && key === "d") {
        event.preventDefault();
        setDevToolsEnabled((enabled) => !enabled);
      } else if (!event.shiftKey && key === "b") {
        event.preventDefault();
        const { settings, setSidebarCollapsed } = useAppStore.getState();
        setSidebarCollapsed(settings.sidebarCollapsed !== true);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    if (!devToolsEnabled && activeView === "dev") setActiveView("now");
  }, [activeView, devToolsEnabled, setActiveView]);

  useEffect(() => {
    const decision = decideReleaseNotesDisplay({
      version: appVersion,
      lastSeenVersion: lastSeenReleaseNotesVersion,
      hadPersistedState: hadPersistedStateOnStartup,
      blocked: activeTourId !== null || shouldShowWelcome(tourProgress),
    });
    if (decision.action === "show") openCurrentReleaseNotes();
    if (decision.action === "mark-seen") {
      markReleaseNotesSeen(decision.version);
    }
  }, [
    activeTourId,
    appVersion,
    hadPersistedStateOnStartup,
    lastSeenReleaseNotesVersion,
    markReleaseNotesSeen,
    openCurrentReleaseNotes,
    tourProgress,
  ]);

  async function handleInstallStartupUpdate() {
    setStartupNotesOpen(false);
    setInstallingUpdate(true);
    setInstallProgress(null);

    try {
      const installed = await installAvailableUpdate(setInstallProgress);
      if (!installed) {
        setStartupUpdate(null);
        setInstallingUpdate(false);
      }
    } catch {
      setInstallingUpdate(false);
    }
  }

  const startupDisplayNotes =
    startupUpdate?.status === "available"
      ? parseManifestNotes(startupUpdate.notes)
      : parseManifestNotes(null);
  const installedReleaseNotes = findUnseenReleaseNotes(
    appVersion,
    lastSeenReleaseNotesVersion,
  );

  return (
    <main
      className="app-shell flex h-screen min-h-[620px] bg-bg text-text selection:bg-accent selection:text-bg"
      data-banner-layout={
        compactBannerVisible && !viewBannerDetails ? "compact" : "full"
      }
      style={
        {
          // Content and menu zoom differently; the banner art has to line up
          // across both, so both sides read the same ratio.
          "--zoom-ratio": contentScale / menuScale,
          // On My Games the bar is 72px tall: 64px of controls plus the
          // 8px gap above the banner, so the key art covers the gap too.
          "--hero-lead": `calc(72px / ${contentScale / menuScale})`,
        } as CSSProperties
      }
    >
      <aside
        data-tour="sidebar"
        data-collapsed={sidebarCollapsed ? "true" : undefined}
        style={{ zoom: menuScale }}
        className={clsx(
          "app-sidebar flex shrink-0 flex-col transition-[width] duration-200 ease-out motion-reduce:transition-none",
          sidebarCollapsed ? "w-[68px]" : "w-[248px]",
        )}
      >
        <div
          data-tauri-drag-region
          className={clsx(
            "flex h-[72px] shrink-0 items-center",
            sidebarCollapsed ? "justify-center px-2" : "gap-2 px-4",
          )}
        >
          {/* Collapsed, the logo is the way back: a toggle of its own would
              cost a second row on a rail that is all vertical space. */}
          {sidebarCollapsed ? (
            <button
              type="button"
              aria-label="Expand sidebar"
              aria-expanded={false}
              title="Expand sidebar (Ctrl+B)"
              onClick={() => setSidebarCollapsed(false)}
              className="group grid h-11 w-11 place-items-center rounded-xl transition hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
            >
              <img
                src="/brand/playcounter-mark-small.svg"
                alt=""
                draggable={false}
                className="col-start-1 row-start-1 h-9 w-9 object-contain transition group-hover:opacity-0"
              />
              <PanelLeftOpen
                size={18}
                className="col-start-1 row-start-1 text-text-muted opacity-0 transition group-hover:opacity-100"
              />
            </button>
          ) : (
            <>
              <img
                data-tauri-drag-region
                src="/brand/playcounter-mark.svg"
                alt=""
                draggable={false}
                className="h-11 w-11 shrink-0 object-contain"
              />
              <span
                data-tauri-drag-region
                className="min-w-0 flex-1 animate-label-in leading-none motion-reduce:animate-none"
              >
                <PlayCounterWordmark
                  size={23}
                  className="pointer-events-none"
                />
              </span>
              <SidebarToggle
                collapsed={false}
                onClick={() => setSidebarCollapsed(true)}
              />
            </>
          )}
        </div>
        <nav
          data-controller-scroll
          className={clsx(
            "flex-1 overflow-y-auto overflow-x-hidden pb-6",
            sidebarCollapsed ? "px-2.5" : "px-3",
          )}
        >
          <div className="mx-3 mb-4 h-px bg-border/60" aria-hidden="true" />
          {sidebarSections.map((section, sectionIndex) => {
            if (
              section.id === "emulators" &&
              !emulatorTourDemo &&
              (!emulatorDetectionEnabled ||
                [...knownEmulators.keys()].every((id) =>
                  ignoredEmulatorSet.has(id.toLowerCase()),
                ))
            ) {
              return null;
            }
            const items = section.items.filter(
              (item) =>
                (item !== "dev" || devToolsEnabled) &&
                (item !== "emulating" ||
                  emulatorTourDemo ||
                  emulatorIsRunning ||
                  activeView === "emulating") &&
                (item !== "dosbox" ||
                  (knownEmulators.has("dosbox") &&
                    !ignoredEmulatorSet.has("dosbox"))) &&
                (item !== "dolphin" ||
                  emulatorTourDemo ||
                  (knownEmulators.has("dolphin") &&
                    !ignoredEmulatorSet.has("dolphin"))) &&
                (item !== "pcsx2" ||
                  (knownEmulators.has("pcsx2") &&
                    !ignoredEmulatorSet.has("pcsx2"))),
            );
            if (items.length === 0) return null;

            return (
              <div
                key={section.id}
                data-tour={
                  section.id === "emulators" ? "nav-emulators" : undefined
                }
              >
                {sectionIndex > 0 ? (
                  <div
                    className="mx-3 my-4 h-px bg-border/60"
                    aria-hidden="true"
                  />
                ) : null}
                {sidebarCollapsed ? null : (
                  <div className="animate-label-in px-3 pb-2.5 text-[11px] font-bold uppercase tracking-[0.16em] text-text-muted/70 motion-reduce:animate-none">
                    {section.label}
                  </div>
                )}
                <div className="flex flex-col gap-1">
                  {items.map((item) => {
                    const view = views[item];
                    const canExpandSources =
                      item === "games" &&
                      hasLibrarySources &&
                      !sidebarCollapsed;
                    // Keep available source groups accessible across views.
                    const showSources = canExpandSources && !sourcesCollapsed;
                    return (
                      <div
                        key={item}
                        className="relative flex flex-col gap-0.5"
                      >
                        <SidebarButton
                          icon={view.icon}
                          imageSrc={view.imageSrc}
                          label={view.label}
                          count={item === "games" ? libraryCount : undefined}
                          trailingSpace={canExpandSources}
                          collapsed={sidebarCollapsed}
                          active={
                            activeView === item ||
                            (item === "games" && activeView === "import")
                          }
                          controllerEnabled={
                            item !== "discovered" && item !== "dev"
                          }
                          dataTour={`nav-${item}`}
                          badge={
                            item === "discovered"
                              ? needsReviewCount
                              : item === "dosbox" ||
                                  item === "dolphin" ||
                                  item === "pcsx2"
                                ? sidebarEmulatorBadge(item)
                                : undefined
                          }
                          warn={item === "now" ? hasAmbiguousMatch : undefined}
                          isPlaying={
                            item === "now" && !hasAmbiguousMatch
                              ? activeSessionsCount > 0
                              : item === "emulating"
                                ? emulatorTourDemo || emulatorIsRunning
                                : undefined
                          }
                          onClick={() => {
                            if (item === "discovered" && activeView === item) {
                              window.dispatchEvent(
                                new CustomEvent("playcounter:discovered-reset"),
                              );
                            }
                            if (item === "history") {
                              setHistoryQuery("");
                              setHistoryGameKey(null);
                            }
                            // Second click on My Games: back to the whole
                            // library instead of staying on a source.
                            if (
                              item === "games" &&
                              activeView === "games" &&
                              libraryTab !== "all"
                            ) {
                              setLibraryTab("all");
                            }
                            setActiveView(item);
                          }}
                        />
                        {canExpandSources ? (
                          <button
                            type="button"
                            aria-label={
                              sourcesCollapsed ? "Show sources" : "Hide sources"
                            }
                            title={
                              sourcesCollapsed ? "Show sources" : "Hide sources"
                            }
                            aria-expanded={!sourcesCollapsed}
                            onClick={() =>
                              setSidebarSourcesCollapsed(!sourcesCollapsed)
                            }
                            className="absolute right-1.5 top-1.5 grid h-8 w-8 place-items-center rounded-lg text-text-muted transition hover:bg-surface-hover hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                          >
                            <ChevronDown
                              size={16}
                              className={clsx(
                                "transition-transform duration-200",
                                sourcesCollapsed && "-rotate-90",
                              )}
                            />
                          </button>
                        ) : null}
                        {showSources ? <SidebarSources /> : null}
                      </div>
                    );
                  })}
                  {section.id === "system" ? (
                    <SidebarButton
                      icon={MessageSquarePlus}
                      label="Help & Feedback"
                      collapsed={sidebarCollapsed}
                      active={feedbackOpen}
                      disabled={isOffline}
                      title={
                        isOffline ? "Feedback unavailable offline" : undefined
                      }
                      dataTour="send-feedback"
                      onClick={() => setFeedbackOpen(true)}
                    />
                  ) : null}
                </div>
              </div>
            );
          })}
        </nav>
        <div
          className={clsx(
            "border-t border-border/50 py-3",
            sidebarCollapsed ? "px-2" : "px-5",
          )}
        >
          <AppStatusIndicator
            apiEndpoint={apiEndpoint}
            health={backendHealth}
            version={appVersion}
            compact={sidebarCollapsed}
          />
        </div>
      </aside>
      <section
        data-controller-mode={controllerModeActive ? "true" : undefined}
        className="relative flex min-w-0 flex-1 flex-col"
      >
        <header
          ref={titleBarRef}
          data-tour="header"
          data-tauri-drag-region
          style={{ zoom: menuScale }}
          className={clsx(
            // z-30 lifts help and notification popovers above the content;
            // the art clips itself instead of the bar.
            "app-titlebar relative z-30 flex shrink-0 items-stretch",
            titleBarArt ? "h-[72px] pb-2" : "h-16",
          )}
        >
          {titleBarArt ? (
            <div
              ref={titleBarArtRef}
              aria-hidden="true"
              className="titlebar-art pointer-events-none absolute inset-0 -z-10 overflow-hidden"
            >
              {/* Same image frame as the card and lower continuation. The
                  card starts its crop --hero-lead lower, leaving this strip
                  directly above it. */}
              <img
                src={titleBarArt}
                alt=""
                style={
                  // Replaced elements do not stretch between left and right;
                  // the width has to be explicit.
                  artFrame === "card"
                    ? {
                        left: 0,
                        width:
                          "calc(var(--content-width, 100%) * var(--zoom-ratio))",
                        height:
                          "calc((var(--banner-height) + var(--banner-tail)) * var(--zoom-ratio) + 72px)",
                      }
                    : {
                        left: 0,
                        width:
                          "calc(var(--content-width, 100%) * var(--zoom-ratio))",
                        height: "calc(560px * var(--zoom-ratio) + 72px)",
                      }
                }
                className={clsx(
                  "absolute top-0 object-cover",
                  artFrame === "card" ? "object-[72%_0%]" : "object-[60%_0%]",
                )}
              />
            </div>
          ) : null}
          <div
            data-tauri-drag-region
            className="flex min-w-0 flex-1 items-center justify-center px-4"
          >
            <GlobalSearch />
          </div>
          <div className="titlebar-actions flex shrink-0 items-center gap-1.5 pr-3">
            <HelpButton />
            <NotificationBell />
            <HeaderLinks />
          </div>
          <WindowControls />
        </header>
        <RequestWarning apiEndpoint={apiEndpoint} runtimeError={runtimeError} />
        {startupUpdate?.status === "available" ? (
          <div className="flex items-center justify-between gap-4 border-b border-info-border bg-info-tint px-7 py-2 text-sm text-info">
            <div
              className="flex min-w-0 items-center gap-3"
              role="status"
              aria-live="polite"
              aria-atomic="true"
            >
              {installingUpdate ? <PlayCounterAnimatedIcon size={40} /> : null}
              <span className="min-w-0">
                Version {startupUpdate.version} is available
                {installingUpdate
                  ? ` - ${formatInstallProgress(installProgress)}`
                  : ""}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {!isEmptyDisplayNotes(startupDisplayNotes) ? (
                <Button
                  variant="secondary"
                  onClick={() => setStartupNotesOpen(true)}
                  disabled={installingUpdate}
                  className="px-3 py-1.5"
                >
                  What's new
                </Button>
              ) : null}
              <Button
                variant="primary"
                icon={installingUpdate ? undefined : Download}
                disabled={installingUpdate}
                aria-busy={installingUpdate}
                onClick={() => void handleInstallStartupUpdate()}
                className="px-3 py-1.5"
              >
                {installingUpdate ? "Installing…" : "Install"}
              </Button>
            </div>
          </div>
        ) : null}
        <div data-tour-viewport className="relative min-h-0 flex-1">
          <div
            ref={contentRef}
            data-tour="content"
            data-controller-scroll
            data-controller-content="true"
            tabIndex={-1}
            aria-busy={activeView === "games" && !renderGames}
            aria-label={`${activeViewLabel} content`}
            style={{ zoom: contentScale }}
            onScroll={(event) => syncTitleBarFade(event.currentTarget)}
            className={clsx(
              "controller-content absolute inset-0 isolate overflow-auto px-7 pb-8",
              titleBarArt ? "pt-0" : "pt-5",
            )}
          >
            {titleBarArt && artFrame === "full" ? (
              <div
                aria-hidden="true"
                className="view-backdrop pointer-events-none absolute inset-x-0 top-0 -z-10"
                // 560px of art inside the content; the image reaches
                // --hero-lead further up, behind the title bar, so both halves
                // are one crop of the same picture.
                style={{ height: "560px" }}
              >
                <img
                  src={titleBarArt}
                  srcSet={artSrcSet(titleBarArt)}
                  sizes="100vw"
                  alt=""
                  style={{
                    top: "calc(var(--hero-lead, 0px) * -1)",
                    height: "calc(100% + var(--hero-lead, 0px))",
                  }}
                  className="absolute inset-x-0 w-full object-cover object-[60%_0%]"
                />
                <div className="view-backdrop-shade absolute inset-0" />
              </div>
            ) : null}
            {activeView !== "games" && showViewBanner ? (
              <ViewBanner
                view={activeView}
                onArtworkChange={setViewBannerArt}
              />
            ) : null}
            {activeView !== "games" ? (
              <ViewHeading
                label={activeViewLabel}
                subtitle={activeViewSubtitle}
                action={
                  !activeTour &&
                  activeView !== "now" &&
                  activeView !== "history" ? (
                    <Button
                      variant="ghost"
                      icon={viewBannerEnabled ? EyeOff : ImageIcon}
                      aria-pressed={viewBannerEnabled}
                      title={`${viewBannerEnabled ? "Hide" : "Show"} banner in ${activeViewLabel}`}
                      onClick={() =>
                        setViewShowHero(activeView, !viewBannerEnabled)
                      }
                      className="shrink-0 text-xs"
                    >
                      {viewBannerEnabled ? "Hide banner" : "Show banner"}
                    </Button>
                  ) : undefined
                }
              />
            ) : null}
            {!tour?.simulation &&
            activeView !== "import" &&
            activeView !== "games"
              ? views[activeView].component
              : null}
            {activeView === "games" && !renderGames && !practiceStep ? (
              <PlayCounterLoader
                label="Loading your games…"
                className="min-h-[320px] text-text-muted"
              />
            ) : null}
            {renderGames ? (
              <div hidden={activeView !== "games" || Boolean(practiceStep)}>
                <MyGamesView
                  renderContent={gamesOpened || activeView === "games"}
                />
              </div>
            ) : null}
            {practiceStep && tour?.simulation ? (
              <TourPracticeSurface
                key={tour.id}
                tour={tour}
                stepId={practiceStep.id}
              />
            ) : practiceStep && activeTourId ? (
              <LibraryTourPractice
                key={activeTourId}
                tourId={activeTourId}
                stepId={practiceStep.id}
              />
            ) : null}
            {renderImporter ? (
              <div
                hidden={activeView !== "import" || Boolean(tour?.simulation)}
              >
                {views.import.component}
              </div>
            ) : null}
          </div>
          {controllerModeActive ? (
            <div
              aria-hidden="true"
              className="controller-scroll-focus-indicator pointer-events-none absolute right-5 top-5 z-40 flex items-center gap-2 rounded-full border border-accent/60 bg-bg/95 px-3 py-2 text-xs font-semibold text-accent-ink shadow-raised backdrop-blur"
            >
              <XboxButtonGlyph button="RIGHT_STICK" size="small" />
              <span>Scrolling this view</span>
            </div>
          ) : null}
          {/* Scroll Fade Overlay */}
          <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-10 bg-gradient-to-t from-bg to-transparent" />
          {activeView === "games" ? (
            <BackToTopButton containerRef={contentRef} />
          ) : null}
        </div>
        {controllerModeActive ? <ControllerModeFooter /> : null}
      </section>
      {feedbackOpen ? (
        <FeedbackDialog onClose={() => setFeedbackOpen(false)} />
      ) : null}
      {currentNotesOpen && appVersion && installedReleaseNotes.length > 0 ? (
        <ReleaseNotesDialog
          version={appVersion}
          eyebrow="New update"
          sections={installedReleaseNotes.map((note) => ({
            version: note.version,
            notes: toDisplayNotes(note),
          }))}
          onClose={() => closeCurrentReleaseNotes(appVersion)}
          onStartTour={(id) => {
            closeCurrentReleaseNotes(appVersion);
            useAppStore.getState().startTour(id);
          }}
          footer={
            <div className="flex justify-end">
              <Button
                variant="primary"
                data-autofocus
                onClick={() => closeCurrentReleaseNotes(appVersion)}
              >
                Got it
              </Button>
            </div>
          }
        />
      ) : null}
      {startupNotesOpen && startupUpdate?.status === "available" ? (
        <ReleaseNotesDialog
          version={startupUpdate.version}
          eyebrow="Update available"
          sections={[
            {
              version: startupUpdate.version,
              notes: startupDisplayNotes,
            },
          ]}
          onClose={() => setStartupNotesOpen(false)}
          footer={
            <div className="flex justify-end">
              <Button
                variant="primary"
                icon={Download}
                loading={installingUpdate}
                data-autofocus
                onClick={() => void handleInstallStartupUpdate()}
              >
                {installingUpdate ? "Installing…" : "Install update"}
              </Button>
            </div>
          }
        />
      ) : null}
      <ToastViewport />
      <WelcomePrompt />
      <GameJournalHost />
      <TourOverlay />
      <GlobalTooltip />
    </main>
  );
}

function SidebarToggle({
  collapsed,
  onClick,
}: {
  collapsed: boolean;
  onClick: () => void;
}) {
  const label = collapsed ? "Expand sidebar" : "Collapse sidebar";
  return (
    <button
      type="button"
      aria-label={label}
      title={`${label} (Ctrl+B)`}
      aria-expanded={!collapsed}
      onClick={onClick}
      className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-text-faint transition hover:bg-surface-hover hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
    >
      {collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
    </button>
  );
}

/* The view's name used to live in the window header. The header is a title
   bar now, so each view introduces itself at the top of its own content. */
function ViewHeading({
  label,
  subtitle,
  action,
}: {
  label: string;
  subtitle: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-5 flex items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-[22px] font-bold tracking-tight text-text">
          {label}
        </h1>
        <p className="mt-0.5 text-sm text-text-muted">{subtitle}</p>
      </div>
      {action}
    </div>
  );
}

function ControllerModeFooter() {
  return (
    <div
      aria-label="Controller mode controls"
      className="flex h-[49px] shrink-0 items-center justify-between gap-6 overflow-hidden border-t border-border/50 bg-surface/30 px-7 text-xs font-medium text-text-muted backdrop-blur-xl"
    >
      <div className="flex shrink-0 items-center gap-2 font-semibold text-accent-ink">
        <span className="grid h-7 w-7 place-items-center rounded-full border border-accent/40 bg-accent/10 shadow-[0_0_12px_rgb(var(--color-accent)/0.22)]">
          <Gamepad2 size={15} strokeWidth={2.4} />
        </span>
        <span>Controller mode</span>
      </div>
      <div className="flex min-w-0 items-center justify-end gap-5 whitespace-nowrap">
        <ControllerHint button="DPAD" label="Navigate" />
        <ControllerHint button="A" label="Select" />
        <ControllerHint button="B" label="Back" />
        <ControllerHint button="RIGHT_STICK" label="Scroll" />
        <ControllerHint button="VIEW" label="Card size" />
        <div
          className="flex min-w-0 items-center gap-1.5"
          aria-label="Hold View plus right bumper for two seconds to bring PlayCounter forward"
        >
          <XboxButtonGlyph button="VIEW" />
          <span className="text-text-faint">+</span>
          <XboxButtonGlyph button="RB" />
          <span className="truncate text-text-faint">
            Hold 2 sec · Bring PlayCounter forward
          </span>
        </div>
      </div>
    </div>
  );
}

const controllerNames: Record<XboxControl, string> = {
  A: "A",
  B: "B",
  DPAD: "D-pad",
  RIGHT_STICK: "Right stick",
  VIEW: "View",
  RB: "Right bumper",
};

function ControllerHint({
  button,
  label,
}: {
  button: XboxControl;
  label: string;
}) {
  return (
    <span
      className="flex items-center gap-2"
      aria-label={`${controllerNames[button]}: ${label}`}
    >
      <XboxButtonGlyph button={button} />
      <span>{label}</span>
    </span>
  );
}

async function syncLaunchOnStartupPreference() {
  if (startupPreferenceSynced) return;
  startupPreferenceSynced = true;

  const setLaunchOnStartup = useAppStore.getState().setLaunchOnStartup;
  const addRuntimeLogEntry = useAppStore.getState().addRuntimeLogEntry;
  const addToast = useAppStore.getState().addToast;
  const desired = readPersistedLaunchOnStartup();

  try {
    const enabled = await isEnabled();
    if (desired && !enabled) await enable();
    if (!desired && enabled) await disable();
    setLaunchOnStartup(desired);
    addRuntimeLogEntry(`launch on startup ${desired ? "enabled" : "disabled"}`);
  } catch (error) {
    const detail = formatError(error);
    addRuntimeLogEntry(`launch on startup sync failed: ${detail}`);
    addToast({
      tone: "error",
      title: "Startup setting failed",
      detail,
    });
  }
}

function readPersistedLaunchOnStartup() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return true;
    const parsed = JSON.parse(raw) as {
      settings?: { launchOnStartup?: unknown };
    };
    return parsed.settings?.launchOnStartup !== false;
  } catch {
    return true;
  }
}

function ToastViewport() {
  const toasts = useAppStore((state) => state.toasts);
  const dismissToast = useAppStore((state) => state.dismissToast);

  return (
    <div
      aria-label="Notifications"
      className="pointer-events-none fixed bottom-5 right-5 z-50 grid w-[min(22rem,calc(100vw-2.5rem))] gap-3"
    >
      {toasts.map((toast) => (
        <ToastCard
          key={toast.id}
          toast={toast}
          onDismiss={() => dismissToast(toast.id)}
        />
      ))}
    </div>
  );
}

function ToastCard({
  toast,
  onDismiss,
}: {
  toast: Toast;
  onDismiss: () => void;
}) {
  const [leaving, setLeaving] = useState(false);
  // Errors stay twice as long: they carry detail worth reading.
  const lifetimeMs = toast.tone === "error" ? 8400 : 4200;
  // The parent re-renders on every store change; keep the latest callback
  // without restarting the exit timer, or a burst of toasts keeps a fading
  // card stuck on screen.
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  useEffect(() => {
    const hideTimer = window.setTimeout(() => setLeaving(true), lifetimeMs);
    return () => window.clearTimeout(hideTimer);
  }, [lifetimeMs]);

  useEffect(() => {
    if (!leaving) return;
    const removeTimer = window.setTimeout(() => onDismissRef.current(), 260);
    return () => window.clearTimeout(removeTimer);
  }, [leaving]);

  const presentation =
    toast.tone === "success"
      ? { icon: Check, toneClass: "app-toast-success" }
      : toast.tone === "error"
        ? { icon: AlertTriangle, toneClass: "app-toast-error" }
        : { icon: Info, toneClass: "app-toast-info" };
  const ToneIcon = presentation.icon;

  return (
    <article
      aria-atomic="true"
      aria-live={toast.tone === "error" ? "assertive" : "polite"}
      className={`app-toast pointer-events-auto ${presentation.toneClass} ${leaving ? "animate-toast-out" : "animate-toast-in"}`}
      style={{ "--toast-lifetime": `${lifetimeMs}ms` } as CSSProperties}
    >
      <div className="flex items-start gap-3 py-3 pl-4 pr-2.5">
        <span aria-hidden="true" className="app-toast-symbol">
          {toast.emoji ? (
            <span className="text-base leading-none">{toast.emoji}</span>
          ) : (
            <ToneIcon size={18} strokeWidth={2.2} />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="break-words text-sm font-medium leading-5 text-text">
            {toast.title}
          </div>
          {toast.detail ? (
            <div className="mt-0.5 break-words text-xs leading-[1.45] text-text-muted">
              {toast.detail}
            </div>
          ) : null}
        </div>
        <button
          type="button"
          aria-label="Dismiss notification"
          onClick={() => setLeaving(true)}
          className="app-toast-dismiss -mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <X size={15} />
        </button>
      </div>
      <div aria-hidden="true" className="app-toast-progress" />
    </article>
  );
}

function AppStatusIndicator({
  apiEndpoint,
  health,
  version,
  compact = false,
}: {
  apiEndpoint: string;
  health: {
    status: "checking" | "online" | "offline" | "reconnecting";
    checkedAt: string | null;
    detail: string | null;
  };
  version: string | null;
  compact?: boolean;
}) {
  const environment = stageBadge(BUILD_STAGE);
  const title = health.checkedAt
    ? `${health.detail ?? health.status} - ${new Date(health.checkedAt).toLocaleTimeString()} - ${apiEndpoint}`
    : `Checking backend health - ${apiEndpoint}`;

  if (compact) {
    return (
      <div
        title={`${title} - ${environment.label} ${version ? `v${version}` : ""}`}
        className="flex justify-center text-[11px] font-medium"
      >
        <BackendStatusIndicator health={health} iconOnly />
      </div>
    );
  }

  return (
    <div
      title={title}
      className="flex items-center justify-between gap-3 text-[11px] font-medium"
    >
      <BackendStatusIndicator health={health} />
      <div className="flex min-w-0 items-center gap-2 text-text-faint">
        <span className={environment.className}>{environment.label}</span>
        <span
          className="h-3 w-[1.5px] shrink-0 rounded-full bg-border"
          aria-hidden="true"
        />
        <span className="truncate tracking-wider">
          {version ? `v${version}` : "v..."}
        </span>
      </div>
    </div>
  );
}

function BackendStatusIndicator({
  health,
  iconOnly = false,
}: {
  health: {
    status: "checking" | "online" | "offline" | "reconnecting";
    checkedAt: string | null;
    detail: string | null;
  };
  iconOnly?: boolean;
}) {
  const label = (text: string) =>
    iconOnly ? (
      <span className="sr-only">{text}</span>
    ) : (
      <span className="tracking-wide">{text}</span>
    );

  if (health.status === "online") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1.5 text-success drop-shadow-[0_0_6px_rgb(var(--color-success)/0.4)] transition-all">
        <Wifi size={13} strokeWidth={2.5} />
        {label("Online")}
      </span>
    );
  }

  if (health.status === "offline") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1.5 text-warning drop-shadow-[0_0_6px_rgb(var(--color-warning)/0.4)] transition-all">
        <WifiOff size={13} strokeWidth={2.5} />
        {label("Offline")}
      </span>
    );
  }

  if (health.status === "reconnecting") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1.5 text-info transition-all">
        <LoaderCircle size={13} strokeWidth={2.5} className="animate-spin" />
        {label("Reconnecting")}
      </span>
    );
  }

  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 text-text-muted transition-all">
      <LoaderCircle size={13} strokeWidth={2.5} className="animate-spin" />
      {label("Checking")}
    </span>
  );
}

function stageBadge(stage: Stage) {
  switch (stage) {
    case "local":
      return { label: "Local", className: "font-medium text-text-muted" };
    case "test":
      return { label: "Test", className: "font-medium text-info" };
    case "prod":
      return { label: "Prod", className: "font-medium text-danger" };
  }
}

function formatInstallProgress(progress: InstallProgress | null) {
  if (!progress) return "preparing update";

  const downloaded = formatBytes(progress.downloadedBytes);
  if (!progress.totalBytes) return `downloading ${downloaded}`;

  return `downloading ${downloaded} of ${formatBytes(progress.totalBytes)}`;
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
