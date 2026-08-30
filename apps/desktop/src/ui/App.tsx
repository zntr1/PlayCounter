import {
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  Bug,
  Check,
  Cpu,
  Download,
  Gamepad2,
  Globe,
  Info,
  ListChecks,
  LoaderCircle,
  MessageSquarePlus,
  Moon,
  Play,
  Settings,
  Sun,
  Trophy,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import {
  Component,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ErrorInfo,
  type ReactNode,
  lazy,
  Suspense,
} from "react";
import { initializeTracker } from "../tracker";
import {
  CONTROLLER_MODE_EVENT,
  deactivateControllerMode,
} from "../controllerBridge";
import { emulatorAssetUrls } from "../emulators/assets";
import { FeedbackDialog } from "./FeedbackDialog";
import { NotificationBell } from "./NotificationBell";
import { ReleaseNotesDialog } from "./ReleaseNotesDialog";
import { SidebarButton } from "./SidebarButton";
import { XboxButtonGlyph, type XboxControl } from "./XboxButtonGlyph";
import { Button, IconButton } from "./primitives";
import { useNeedsReviewCount } from "./views/DiscoveredView";
import { DevToolsView } from "./views/DevToolsView";
import { HistoryView } from "./views/HistoryView";
import { AchievementsView } from "./views/AchievementsView";
import { MyGamesView } from "./views/MyGamesView";
import { NowPlayingView } from "./views/NowPlayingView";
import { NowEmulatingView } from "./views/NowEmulatingView";
import { DolphinView, DosboxView } from "./views/EmulatorsView";
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
  decideReleaseNotesDisplay,
  findUnseenReleaseNotes,
  isEmptyDisplayNotes,
  parseManifestNotes,
  toDisplayNotes,
} from "../releaseNotes";

const ImportLibraryView = lazy(() =>
  import("./views/ImportLibraryView").then((module) => ({
    default: module.ImportLibraryView,
  })),
);

class ImporterErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Steam importer failed to render", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="rounded-lg border border-danger-border bg-danger-tint px-4 py-3 text-sm text-danger">
          The Steam importer could not be opened: {this.state.error.message}
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
  games: {
    label: "My Games",
    subtitle: "Every game PlayCounter has tracked for you",
    icon: Gamepad2,
    component: <MyGamesView />,
  },
  import: {
    label: "Import from Steam",
    subtitle: "Bring your Steam library and playtime into PlayCounter",
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
              <div className="text-sm text-text-muted">Loading importer…</div>
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

const sidebarSections: Array<{ label: string; items: ViewId[] }> = [
  {
    label: "Library",
    items: ["now", "games", "history", "achievements"],
  },
  { label: "Emulators", items: ["emulating", "dosbox", "dolphin"] },
  { label: "System", items: ["discovered", "settings", "dev"] },
];

const WEBSITE_URL = "https://playcounter.app/";
const DISCORD_URL = "https://discord.gg/t2nG3jaEEY";
const STORAGE_KEY = "playcounter:v1";

let startupPreferenceSynced = false;

export function App() {
  const contentRef = useRef<HTMLDivElement>(null);
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
  const activeTourId = useAppStore((state) => state.activeTour?.tourId ?? null);
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
  const sidebarEmulatorBadge = (item: "dosbox" | "dolphin") =>
    emulatorTourDemo && item === "dolphin" ? 1 : emulatorReviewCount(item);
  const theme = useAppStore((state) => state.settings.theme);
  const setTheme = useAppStore((state) => state.setTheme);

  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    content.scrollTop = 0;
    content.scrollLeft = 0;
  }, [activeTourId, activeView]);

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

    const updateCheckTimer = window.setTimeout(() => {
      void checkForUpdate()
        .then((result) => {
          if (result.status === "available") setStartupUpdate(result);
        })
        .catch(() => undefined);
    }, 8_000);

    return () => window.clearTimeout(updateCheckTimer);
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (
        !event.ctrlKey ||
        !event.shiftKey ||
        event.key.toLowerCase() !== "d"
      ) {
        return;
      }

      event.preventDefault();
      setDevToolsEnabled((enabled) => !enabled);
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

  async function openExternalUrl(url: string, label: string) {
    try {
      if (isOffline) {
        addToast({
          tone: "info",
          title: "Offline",
          detail: `${label} unavailable offline.`,
        });
        return;
      }
      await invoke("open_external_url", { url });
    } catch (error) {
      addToast({
        tone: "error",
        title: `Could not open ${label}`,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return (
    <main className="flex h-screen min-h-[620px] bg-bg text-text selection:bg-accent selection:text-bg">
      <aside
        data-tour="sidebar"
        className="flex w-[260px] flex-col border-r border-border bg-surface/50 shadow-sidebar backdrop-blur-xl"
      >
        <div className="flex items-center justify-center gap-3 px-4 py-8">
          <img
            src="/icon.png"
            alt=""
            className="h-14 w-14 shrink-0 object-contain"
          />
          <div className="min-w-0">
            <div className="truncate text-xl font-bold tracking-tight text-text">
              PlayCounter
            </div>
          </div>
        </div>
        <nav data-controller-scroll className="flex-1 overflow-auto px-4 pb-4">
          {sidebarSections.map((section) => {
            if (
              section.label === "Emulators" &&
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
                    !ignoredEmulatorSet.has("dolphin"))),
            );
            if (items.length === 0) return null;

            return (
              <div
                key={section.label}
                className="mb-6"
                data-tour={
                  section.label === "Emulators" ? "nav-emulators" : undefined
                }
              >
                <div className="px-3 pb-2 text-[11px] font-bold uppercase tracking-widest text-text-muted/70">
                  {section.label}
                </div>
                <div className="flex flex-col gap-1">
                  {items.map((item) => {
                    const view = views[item];
                    return (
                      <SidebarButton
                        key={item}
                        icon={view.icon}
                        imageSrc={view.imageSrc}
                        label={view.label}
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
                            : item === "dosbox" || item === "dolphin"
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
                          setActiveView(item);
                        }}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>
        <div className="border-t border-border/50 bg-surface/30 px-5 py-4">
          <AppStatusIndicator
            apiEndpoint={apiEndpoint}
            health={backendHealth}
            version={appVersion}
          />
        </div>
      </aside>
      <section
        data-controller-mode={controllerModeActive ? "true" : undefined}
        className="flex min-w-0 flex-1 flex-col"
      >
        <header
          data-tour="header"
          className="flex h-16 items-center justify-between border-b border-border bg-surface px-7"
        >
          <div>
            <h1 className="text-xl font-semibold tracking-normal text-text">
              {views[activeView].label}
            </h1>
            <p className="text-sm text-text-muted">
              {views[activeView].subtitle}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <HelpButton />
            <NotificationBell />
            <IconButton
              aria-label={
                theme === "dark"
                  ? "Switch to light theme"
                  : "Switch to dark theme"
              }
              title={
                theme === "dark"
                  ? "Switch to light theme"
                  : "Switch to dark theme"
              }
              icon={theme === "dark" ? Sun : Moon}
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            />
            <IconButton
              aria-label="Open PlayCounter website"
              title={
                isOffline
                  ? "Website unavailable offline"
                  : "Open PlayCounter website"
              }
              disabled={isOffline}
              icon={Globe}
              onClick={() => void openExternalUrl(WEBSITE_URL, "website")}
            />
            <IconButton
              aria-label="Open PlayCounter Discord"
              title={
                isOffline
                  ? "Discord unavailable offline"
                  : "Open PlayCounter Discord"
              }
              disabled={isOffline}
              onClick={() => void openExternalUrl(DISCORD_URL, "Discord")}
            >
              <DiscordIcon />
            </IconButton>
            <Button
              variant="secondary"
              icon={MessageSquarePlus}
              disabled={isOffline}
              title={isOffline ? "Feedback unavailable offline" : undefined}
              onClick={() => setFeedbackOpen(true)}
            >
              Send feedback
            </Button>
          </div>
        </header>
        {runtimeError ? (
          <div className="border-b border-warning-border bg-warning-tint px-7 py-2 text-sm text-warning">
            {runtimeError}
          </div>
        ) : null}
        {startupUpdate?.status === "available" ? (
          <div className="flex items-center justify-between gap-4 border-b border-info-border bg-info-tint px-7 py-2 text-sm text-info">
            <span className="min-w-0">
              Version {startupUpdate.version} is available
              {installingUpdate
                ? ` - ${formatInstallProgress(installProgress)}`
                : ""}
            </span>
            <div className="flex shrink-0 items-center gap-2">
              {!isEmptyDisplayNotes(startupDisplayNotes) ? (
                <Button
                  variant="secondary"
                  onClick={() => setStartupNotesOpen(true)}
                  className="px-3 py-1.5"
                >
                  What's new
                </Button>
              ) : null}
              <Button
                variant="primary"
                icon={Download}
                loading={installingUpdate}
                onClick={() => void handleInstallStartupUpdate()}
                className="px-3 py-1.5"
              >
                {installingUpdate ? "Installing…" : "Install"}
              </Button>
            </div>
          </div>
        ) : null}
        <div className="relative min-h-0 flex-1">
          <div
            ref={contentRef}
            data-tour="content"
            data-controller-scroll
            data-controller-content="true"
            tabIndex={-1}
            aria-label={`${views[activeView].label} content`}
            className="controller-content absolute inset-0 overflow-auto px-7 py-6"
          >
            {views[activeView].component}
          </div>
          {controllerModeActive ? (
            <div
              aria-hidden="true"
              className="controller-scroll-focus-indicator pointer-events-none absolute right-5 top-5 z-40 flex items-center gap-2 rounded-full border border-accent/60 bg-bg/95 px-3 py-2 text-xs font-semibold text-accent shadow-raised backdrop-blur"
            >
              <XboxButtonGlyph button="RIGHT_STICK" size="small" />
              <span>Scrolling this view</span>
            </div>
          ) : null}
          {/* Scroll Fade Overlay */}
          <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-10 bg-gradient-to-t from-bg to-transparent" />
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
      <TourOverlay />
    </main>
  );
}

function ControllerModeFooter() {
  return (
    <div
      aria-label="Controller mode controls"
      className="flex h-[49px] shrink-0 items-center justify-between gap-6 overflow-hidden border-t border-border/50 bg-surface/30 px-7 text-xs font-medium text-text-muted backdrop-blur-xl"
    >
      <div className="flex shrink-0 items-center gap-2 font-semibold text-accent">
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

function DiscordIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="currentColor"
      className="h-[15px] w-[15px]"
    >
      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.095.25-.193.371-.292a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.028zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
    </svg>
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

  useEffect(() => {
    const hideTimer = window.setTimeout(() => setLeaving(true), 4200);
    return () => window.clearTimeout(hideTimer);
  }, []);

  useEffect(() => {
    if (!leaving) return;
    const removeTimer = window.setTimeout(onDismiss, 260);
    return () => window.clearTimeout(removeTimer);
  }, [leaving, onDismiss]);

  const presentation =
    toast.tone === "success"
      ? {
          icon: Check,
          label: "Success",
          toneClass: "app-toast-success",
        }
      : toast.tone === "error"
        ? {
            icon: AlertTriangle,
            label: "Something went wrong",
            toneClass: "app-toast-error",
          }
        : {
            icon: Info,
            label: "Heads up",
            toneClass: "app-toast-info",
          };
  const ToneIcon = presentation.icon;

  return (
    <article
      aria-atomic="true"
      aria-live={toast.tone === "error" ? "assertive" : "polite"}
      className={`app-toast pointer-events-auto ${presentation.toneClass} ${leaving ? "animate-toast-out" : "animate-toast-in"}`}
    >
      <div className="flex items-start gap-3.5 p-3.5">
        <span aria-hidden="true" className="app-toast-symbol">
          {toast.emoji ? (
            <span className="text-xl leading-none">{toast.emoji}</span>
          ) : (
            <ToneIcon size={18} strokeWidth={2.4} />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="app-toast-kicker">{presentation.label}</div>
          <div className="mt-0.5 break-words text-sm font-semibold leading-5 text-text">
            {toast.title}
          </div>
          {toast.detail ? (
            <div className="mt-1 break-words text-xs leading-[1.45] text-text-muted">
              {toast.detail}
            </div>
          ) : null}
        </div>
        <button
          type="button"
          aria-label="Dismiss notification"
          onClick={() => setLeaving(true)}
          className="app-toast-dismiss grid h-7 w-7 shrink-0 place-items-center rounded-lg text-text-muted transition hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <X size={14} />
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
}: {
  apiEndpoint: string;
  health: {
    status: "checking" | "online" | "offline" | "reconnecting";
    checkedAt: string | null;
    detail: string | null;
  };
  version: string | null;
}) {
  const environment = stageBadge(BUILD_STAGE);
  const title = health.checkedAt
    ? `${health.detail ?? health.status} - ${new Date(health.checkedAt).toLocaleTimeString()} - ${apiEndpoint}`
    : `Checking backend health - ${apiEndpoint}`;

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
}: {
  health: {
    status: "checking" | "online" | "offline" | "reconnecting";
    checkedAt: string | null;
    detail: string | null;
  };
}) {
  if (health.status === "online") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1.5 text-success drop-shadow-[0_0_6px_rgb(var(--color-success)/0.4)] transition-all">
        <Wifi size={13} strokeWidth={2.5} />
        <span className="tracking-wide">Online</span>
      </span>
    );
  }

  if (health.status === "offline") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1.5 text-warning drop-shadow-[0_0_6px_rgb(var(--color-warning)/0.4)] transition-all">
        <WifiOff size={13} strokeWidth={2.5} />
        <span className="tracking-wide">Offline</span>
      </span>
    );
  }

  if (health.status === "reconnecting") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1.5 text-info transition-all">
        <LoaderCircle size={13} strokeWidth={2.5} className="animate-spin" />
        <span className="tracking-wide">Reconnecting</span>
      </span>
    );
  }

  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 text-text-muted transition-all">
      <LoaderCircle size={13} strokeWidth={2.5} className="animate-spin" />
      <span className="tracking-wide">Checking</span>
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
