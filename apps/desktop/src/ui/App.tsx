import {
  BarChart3,
  Bug,
  Download,
  Gamepad2,
  Globe,
  ListChecks,
  LoaderCircle,
  MessageSquarePlus,
  Moon,
  Play,
  Settings,
  Sun,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { useEffect, useState, type ReactNode } from "react";
import { initializeTracker } from "../tracker";
import { FeedbackDialog } from "./FeedbackDialog";
import { SidebarButton } from "./SidebarButton";
import { Button, IconButton } from "./primitives";
import { useNeedsReviewCount } from "./views/DiscoveredView";
import { DevToolsView } from "./views/DevToolsView";
import { HistoryView } from "./views/HistoryView";
import { MyGamesView } from "./views/MyGamesView";
import { NowPlayingView } from "./views/NowPlayingView";
import { DiscoveredView } from "./views/DiscoveredView";
import { SettingsView } from "./views/SettingsView";
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

const views: Record<
  ViewId,
  { label: string; subtitle: string; icon: typeof Play; component: ReactNode }
> = {
  now: {
    label: "Now Playing",
    subtitle: "What you're playing right now",
    icon: Play,
    component: <NowPlayingView />,
  },
  games: {
    label: "My Games",
    subtitle: "Every game PlayCounter has tracked for you",
    icon: Gamepad2,
    component: <MyGamesView />,
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
  { label: "Library", items: ["now", "games", "history"] },
  { label: "System", items: ["discovered", "settings", "dev"] },
];

const WEBSITE_URL = "https://playcounter.app/";
const DISCORD_URL = "https://discord.gg/t2nG3jaEEY";
const STORAGE_KEY = "playcounter:v1";

let startupPreferenceSynced = false;

export function App() {
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [startupUpdate, setStartupUpdate] = useState<UpdateCheckResult | null>(
    null,
  );
  const [installProgress, setInstallProgress] =
    useState<InstallProgress | null>(null);
  const [installingUpdate, setInstallingUpdate] = useState(false);
  const [devToolsEnabled, setDevToolsEnabled] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const activeView = useAppStore((state) => state.activeView);
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
    (state) => state.activeSessions.length,
  );
  const theme = useAppStore((state) => state.settings.theme);
  const setTheme = useAppStore((state) => state.setTheme);

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

  async function handleInstallStartupUpdate() {
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
      <aside className="flex w-[260px] flex-col border-r border-border bg-surface/50 shadow-sidebar backdrop-blur-xl">
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
        <nav className="flex-1 overflow-auto px-4 pb-4">
          {sidebarSections.map((section) => {
            const items = section.items.filter(
              (item) => item !== "dev" || devToolsEnabled,
            );
            if (items.length === 0) return null;

            return (
              <div key={section.label} className="mb-6">
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
                        label={view.label}
                        active={activeView === item}
                        badge={
                          item === "discovered" ? needsReviewCount : undefined
                        }
                        warn={item === "now" ? hasAmbiguousMatch : undefined}
                        isPlaying={
                          item === "now" && !hasAmbiguousMatch
                            ? activeSessionsCount > 0
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
      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 items-center justify-between border-b border-border bg-surface px-7">
          <div>
            <h1 className="text-xl font-semibold tracking-normal text-text">
              {views[activeView].label}
            </h1>
            <p className="text-sm text-text-muted">
              {views[activeView].subtitle}
            </p>
          </div>
          <div className="flex items-center gap-2">
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
          <div className="absolute inset-0 overflow-auto px-7 py-6">
            {views[activeView].component}
          </div>
          {/* Scroll Fade Overlay */}
          <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-10 bg-gradient-to-t from-bg to-transparent" />
        </div>
      </section>
      {feedbackOpen ? (
        <FeedbackDialog onClose={() => setFeedbackOpen(false)} />
      ) : null}
      <ToastViewport />
    </main>
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
    <div className="pointer-events-none fixed bottom-5 right-5 z-50 grid w-80 gap-2">
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

  const toneClass =
    toast.tone === "success"
      ? "border-success-border"
      : toast.tone === "error"
        ? "border-danger-border"
        : "border-info-border";

  return (
    <div
      className={`pointer-events-auto rounded-lg border bg-surface p-3 shadow-raised ${leaving ? "animate-toast-out" : "animate-toast-in"} ${toneClass}`}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="font-medium text-text break-all">{toast.title}</div>
          {toast.detail ? (
            <div className="mt-1 text-sm text-text-muted break-all">
              {toast.detail}
            </div>
          ) : null}
        </div>
        <button
          type="button"
          aria-label="Dismiss notification"
          onClick={() => setLeaving(true)}
          className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-text-muted transition hover:bg-surface-hover hover:text-text"
        >
          <X size={14} />
        </button>
      </div>
    </div>
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
