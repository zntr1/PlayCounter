import { MessageSquareHeart } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Trans } from "react-i18next";
import { PlayCounterAnimatedIcon } from "../../brand/PlayCounterAnimatedIcon";
import { useWindowDragRegion } from "../../fullscreen";
import { getT } from "../../i18n";
import { currentPlatform } from "../../platform";
import { useAppStore } from "../../store";
import { Button, Switch } from "../primitives";
import { CORE_TOUR_ID } from "./tourDefinitions";
import { shouldShowWelcome } from "./tourState";

const t = getT("tour");

export function WelcomePrompt() {
  const [ready, setReady] = useState(false);
  const progress = useAppStore((state) => state.tourProgress);
  const [enableLauncher, setEnableLauncher] = useState(true);
  const [enableSoftware, setEnableSoftware] = useState(true);
  const setTrackTools = useAppStore((state) => state.setTrackTools);
  const markSeen = useAppStore((state) => state.markTourWelcomeSeen);
  const startTour = useAppStore((state) => state.startTour);
  const setLauncherSetting = useAppStore((state) => state.setLauncherSetting);
  const launcherAvailable = currentPlatform() === "windows";

  useEffect(() => {
    const timer = window.setTimeout(() => setReady(true), 1200);
    return () => window.clearTimeout(timer);
  }, []);
  const visible = ready && shouldShowWelcome(progress);

  useEffect(() => {
    if (!visible) return;
    setEnableLauncher(true);
    // Both switches start on; the choice is saved when the welcome closes.
    setEnableSoftware(true);
  }, [visible]);

  if (!visible) return null;

  const close = () => {
    if (launcherAvailable) {
      setLauncherSetting("gameLaunchingEnabled", enableLauncher);
    }
    setTrackTools(enableSoftware);
    markSeen();
  };
  return createPortal(
    <ModalFrame onEscape={close}>
      <div className="flex max-h-[calc(100vh-2rem)] w-[440px] max-w-[calc(100vw-32px)] select-text flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-raised">
        <div className="shrink-0 px-6 pt-6">
          <div className="flex flex-col items-center text-center">
            <PlayCounterAnimatedIcon
              size={72}
              playback="once"
              className="mb-4"
            />
            <h2 className="text-xl font-semibold text-text">
              {t("Welcome to PlayCounter")}
            </h2>
            <p className="mt-2 leading-6 text-text-muted">
              {t(
                "PlayCounter watches for games you launch and tracks how long you play, no matter where they came from. A quick tour shows you around.",
              )}
            </p>
          </div>
          <div className="mt-4 flex items-start gap-3 rounded-xl bg-bg p-3">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent-tint text-accent-ink">
              <MessageSquareHeart size={16} />
            </span>
            <p className="text-xs leading-5 text-text-muted">
              <Trans
                t={t}
                i18nKey="<strong>Built by one developer.</strong> PlayCounter is new, so expect a few rough edges. Spot one? Use <strong>Help & Feedback</strong> or join our Discord. I read every message and reply."
                components={{
                  strong: <span className="font-medium text-text" />,
                }}
              />
            </p>
          </div>
        </div>
        <div className="grid min-h-0 flex-1 gap-3 overflow-y-auto px-6 py-4">
          {launcherAvailable ? (
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-bg p-4 transition hover:border-accent/40">
              <Switch
                checked={enableLauncher}
                onChange={(event) => setEnableLauncher(event.target.checked)}
                className="mt-1"
              />
              <span>
                <span className="block font-semibold text-text">
                  {t("Use PlayCounter as a launcher")}
                </span>
                <span className="mt-1 block text-sm leading-5 text-text-muted">
                  {t(
                    "Show Play buttons for games PlayCounter can start directly. This is optional, and you can turn it off anytime in Settings if you don't need it or find it annoying.",
                  )}
                </span>
              </span>
            </label>
          ) : null}
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-bg p-4 transition hover:border-accent/40">
            <Switch
              checked={enableSoftware}
              onChange={(event) => setEnableSoftware(event.target.checked)}
              className="mt-1"
            />
            <span>
              <span className="block font-semibold text-text">
                {t("Track software")}
              </span>
              <span className="mt-1 block text-sm leading-5 text-text-muted">
                {t(
                  "Also count how long apps like Discord, Spotify and launchers run, on their own Software page. They never show up in Now Playing or your game stats. You can change this anytime in Settings.",
                )}
              </span>
            </span>
          </label>
        </div>
        <div className="shrink-0 px-6 pb-6 pt-2">
          <div className="grid gap-1">
            <Button
              variant="primary"
              className="w-full py-2.5"
              onClick={() => {
                close();
                startTour(CORE_TOUR_ID);
              }}
            >
              {t("Take the tour")}
            </Button>
            <Button
              variant="ghost"
              className="mx-auto px-2 py-1 text-xs text-text-faint"
              onClick={close}
            >
              {t("Maybe later")}
            </Button>
          </div>
        </div>
      </div>
    </ModalFrame>,
    document.body,
  );
}

function ModalFrame({
  children,
  onEscape,
}: {
  children: ReactNode;
  onEscape: () => void;
}) {
  const dragRegion = useWindowDragRegion();
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") onEscape();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onEscape]);
  return (
    <div
      // The backdrop covers the title bar, so it must also allow window dragging.
      data-tauri-drag-region={dragRegion}
      className="fixed inset-0 z-[70] grid place-items-center bg-black/65 p-4"
      role="dialog"
      aria-modal="true"
    >
      {children}
    </div>
  );
}
