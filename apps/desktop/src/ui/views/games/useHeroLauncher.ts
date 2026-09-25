import { useEffect, useMemo, useState } from "react";
import {
  emulatorLaunchErrorMessage,
  resolveEmulatorLaunchTarget,
} from "../../../emulatorLaunch";
import { adapterFor } from "../../../emulators/registry";
import {
  findManualLaunchTarget,
  launchErrorDetail,
  launchErrorMessage,
  launchTargetsForGame,
} from "../../../gameLaunch";
import { forgetUninstalledLibraryInstalls } from "../../../library/installRecheck";
import {
  libraryLaunchErrorMessage,
  shouldForgetLibraryInstallOnLaunchError,
} from "../../../library/launchErrors";
import { currentPlatform } from "../../../platform";
import { useAppStore } from "../../../store";
import {
  launchEmulatorGame,
  launchGame,
  scanProcessesNow,
} from "../../../tracker";
import type { GameSummary } from "../MyGamesView";

/* The library banner's Play button. It follows the same priority as a game
   card's Play (manual launch file, Xbox, saved .exe, single emulator mapping,
   Steam) and shares the view-wide launch lock, so the banner and a card can
   never start two games at once. The card keeps its wider menu (open in
   launcher, forget launch file, …); the banner only plays. */

type LaunchLock = {
  launchKey: string;
  launchBlocked: boolean;
  onAcquireLaunch: (key: string) => boolean;
  onReleaseLaunch: (key: string) => void;
};

export function useHeroLauncher(game: GameSummary, lock: LaunchLock) {
  const { launchKey, launchBlocked, onAcquireLaunch, onReleaseLaunch } = lock;
  const [launching, setLaunching] = useState(false);
  const addToast = useAppStore((state) => state.addToast);
  const removeLibraryInstall = useAppStore(
    (state) => state.removeLibraryInstall,
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
  const exeCache = useAppStore((state) => state.exeCache);
  const launcherEnabled = useAppStore(
    (state) => state.settings.gameLaunchingEnabled === true,
  );
  const installInSteamEnabled = useAppStore(
    (state) => state.settings.showInstallInSteam === true,
  );
  const hasActiveSession = useAppStore((state) =>
    state.activeSessions.some((session) =>
      game.aliases.some(
        (alias) =>
          session.gameId === alias.gameId &&
          (session.source ?? null) === alias.source,
      ),
    ),
  );
  const canLaunchExecutables =
    currentPlatform() === "windows" && launcherEnabled;

  const manualTarget = useMemo(
    () => findManualLaunchTarget(game.aliases, manualLaunchTargets),
    [game.aliases, manualLaunchTargets],
  );
  const ownedLaunchTargets = useMemo(() => {
    const auto = launchTargetsForGame({
      exeNames: game.exeNames,
      aliases: game.aliases,
      launchTargets,
      exeCache,
    });
    if (!manualTarget) return auto;
    const manualKey = manualTarget.exeName.toLowerCase();
    return [
      manualTarget,
      ...auto.filter((target) => target.exeName.toLowerCase() !== manualKey),
    ];
  }, [exeCache, game.aliases, game.exeNames, launchTargets, manualTarget]);
  const primaryLaunchTarget = ownedLaunchTargets[0];
  const steamImportEntry = game.libraryImports.find(
    (entry) => entry.provider === "steam",
  );
  const steamLaunchEntry = game.libraryImports.find(
    (entry) => entry.provider === "steam" && entry.installed,
  );
  const xboxLaunchEntry = game.libraryImports.find(
    (entry) => entry.provider === "xbox" && entry.installed,
  );
  const emulatorMapping = useMemo(() => {
    const mappings = game.emulatorContentKeys.flatMap((contentKey) => {
      const mapping = emulatorMappings.get(contentKey);
      return mapping?.decision === "game" &&
        adapterFor(mapping.emulatorId)?.launch
        ? [mapping]
        : [];
    });
    return mappings.length === 1 ? mappings[0] : undefined;
  }, [emulatorMappings, game.emulatorContentKeys]);
  const emulatorTarget = emulatorMapping
    ? resolveEmulatorLaunchTarget(
        emulatorMapping.contentKey,
        emulatorAutoLaunchTargets,
        emulatorManualLaunchTargets,
      )
    : undefined;

  const canLaunch =
    canLaunchExecutables &&
    Boolean(
      primaryLaunchTarget ||
      emulatorTarget ||
      steamLaunchEntry ||
      xboxLaunchEntry,
    );
  // An imported Steam game that is no longer installed offers Steam's
  // installer instead of a Play that would only open it.
  const canInstall =
    installInSteamEnabled &&
    canLaunchExecutables &&
    !canLaunch &&
    Boolean(steamImportEntry) &&
    !steamLaunchEntry;
  const launchLabel =
    xboxLaunchEntry && !manualTarget
      ? "Play on Xbox"
      : steamLaunchEntry && !primaryLaunchTarget && !emulatorTarget
        ? "Play in Steam"
        : "Play";

  // Same feedback windows as the card: a launch that never shows up as a
  // session releases the lock after 8s, one that did lets the overlay linger.
  useEffect(() => {
    if (!launching) return;
    const timeout = window.setTimeout(
      () => {
        setLaunching(false);
        onReleaseLaunch(launchKey);
        if (!hasActiveSession) {
          addToast({
            tone: "info",
            title: "Launch request sent",
            detail: `${game.name} has not appeared in PlayCounter yet. It may still be starting or waiting on its own launcher.`,
          });
        }
      },
      hasActiveSession ? 10_000 : 8_000,
    );
    return () => window.clearTimeout(timeout);
  }, [
    addToast,
    game.name,
    hasActiveSession,
    launchKey,
    launching,
    onReleaseLaunch,
  ]);
  useEffect(
    () => () => onReleaseLaunch(launchKey),
    [launchKey, onReleaseLaunch],
  );

  async function launch() {
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
      if (manualTarget || (!xboxLaunchEntry && primaryLaunchTarget)) {
        const outcome = await launchGame(manualTarget ?? primaryLaunchTarget!);
        if (outcome === "busy") {
          addToast({
            tone: "info",
            title: `${game.name} is starting`,
            detail: "PlayCounter already sent the launch request.",
          });
          return;
        }
      } else if (xboxLaunchEntry || steamLaunchEntry) {
        const provider = xboxLaunchEntry ? "xbox" : "steam";
        const entry = (xboxLaunchEntry ?? steamLaunchEntry)!;
        try {
          const module = await import("../../../library/providers");
          const library = await module.loadLibraryProvider(provider);
          await library.launch(entry.externalId);
        } catch (error) {
          if (shouldForgetLibraryInstallOnLaunchError(error)) {
            removeLibraryInstall(provider, entry.externalId);
          }
          addToast({
            tone: "error",
            ...libraryLaunchErrorMessage(
              error,
              game.name,
              provider === "xbox" ? "Xbox" : "Steam",
            ),
          });
          return;
        }
      } else if (emulatorMapping && emulatorTarget) {
        try {
          const outcome = await launchEmulatorGame(emulatorMapping);
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
              title: `${emulatorMapping.label} is still busy`,
              detail: `Stop the current emulated game first. PlayCounter only replaces ${emulatorMapping.label} automatically when it is safely idle.`,
            });
            return;
          }
        } catch (error) {
          addToast({
            tone: "error",
            ...emulatorLaunchErrorMessage(error, game.name),
          });
          return;
        }
      } else {
        return;
      }
      keepLaunchFeedback = true;
      void scanProcessesNow().catch((error) =>
        console.warn("post-launch process scan failed", error),
      );
    } catch (error) {
      addToast({ tone: "error", ...launchErrorMessage(error, game.name) });
      void forgetUninstalledLibraryInstalls(error, game.libraryImports);
    } finally {
      if (!keepLaunchFeedback) {
        setLaunching(false);
        onReleaseLaunch(launchKey);
      }
    }
  }

  async function install() {
    if (!steamImportEntry) return;
    try {
      const module = await import("../../../library/providers");
      const library = await module.loadLibraryProvider("steam");
      await library.launch(steamImportEntry.externalId, "install");
    } catch (error) {
      addToast({
        tone: "error",
        title: `Could not open ${game.name} in Steam`,
        detail: launchErrorDetail(error),
      });
    }
  }

  return {
    launching,
    hasActiveSession,
    canLaunch,
    canInstall,
    install,
    launchLabel,
    launchTargets: ownedLaunchTargets,
    launch,
  };
}
