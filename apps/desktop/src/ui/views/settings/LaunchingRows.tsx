import { Gamepad2, Trash2 } from "lucide-react";
import { useState } from "react";
import { getT } from "../../../i18n";
import { useAppStore } from "../../../store";
import { ProviderBadge } from "../../components";
import { Button, Modal, Switch } from "../../primitives";
import { SettingsRow, type SettingsRowProps } from "./SettingsKit";

const t = getT("settings");

type LaunchFileForgetScope = "executables" | "emulators" | "all";

function useExecutableLaunchTargetCount() {
  return useAppStore(
    (state) => state.launchTargets.size + state.manualLaunchTargets.size,
  );
}

function useEmulatorLaunchTargetCount() {
  return useAppStore(
    (state) =>
      state.emulatorAutoBinaries.size +
      state.emulatorManualBinaries.size +
      state.emulatorAutoLaunchTargets.size +
      state.emulatorManualLaunchTargets.size +
      state.emulatorLaunchCandidates.size,
  );
}

/** Asks before saved paths go, and forgets them on confirm. */
function ForgetLaunchFiles({
  scope,
  onClose,
}: {
  scope: LaunchFileForgetScope;
  onClose: () => void;
}) {
  const executables = useExecutableLaunchTargetCount();
  const emulators = useEmulatorLaunchTargetCount();
  const setLauncherSetting = useAppStore((state) => state.setLauncherSetting);
  const forgetExecutableLaunchTargets = useAppStore(
    (state) => state.forgetExecutableLaunchTargets,
  );
  const forgetEmulatorLaunchTargets = useAppStore(
    (state) => state.forgetEmulatorLaunchTargets,
  );
  const addToast = useAppStore((state) => state.addToast);
  const count =
    scope === "executables"
      ? executables
      : scope === "emulators"
        ? emulators
        : executables + emulators;
  const emulatorFiles = scope === "emulators";
  const disablingStorage = scope === "all";

  function confirm() {
    if (disablingStorage) {
      setLauncherSetting("rememberLaunchPaths", false);
      addToast({
        tone: "success",
        title: t("Launch paths are no longer stored"),
        detail: t(
          "Saved game and emulator paths were forgotten. Starting games from PlayCounter and controller navigation were turned off.",
        ),
      });
    } else if (scope === "executables") {
      forgetExecutableLaunchTargets();
      addToast({
        tone: "success",
        title: t("Saved game files forgotten"),
        detail: t("Emulator programs and game files were left untouched."),
      });
    } else {
      forgetEmulatorLaunchTargets();
      addToast({
        tone: "success",
        title: t("Emulator launch files forgotten"),
        detail: t("Saved paths for regular games were left untouched."),
      });
    }
    onClose();
  }

  return (
    <Modal
      size="sm"
      labelId="forget-launch-files-dialog-title"
      eyebrow={t("Direct game launching")}
      title={
        disablingStorage
          ? t("Stop remembering launch paths?")
          : emulatorFiles
            ? t("Forget emulator launch files?")
            : t("Forget saved game files?")
      }
      icon={Gamepad2}
      onClose={onClose}
      footer={
        <div className="grid gap-2 sm:grid-cols-2">
          <Button variant="secondary" onClick={onClose}>
            {t("Cancel")}
          </Button>
          <Button variant="danger" icon={Trash2} onClick={confirm}>
            {disablingStorage
              ? t("Stop remembering")
              : count
                ? t("Forget {{count}}", { count })
                : t("Forget all")}
          </Button>
        </div>
      }
    >
      <p className="text-sm leading-6 text-text-muted">
        {[
          disablingStorage
            ? count === 0
              ? t(
                  "This removes any saved game and emulator paths, stops PlayCounter from learning new ones, and turns off starting games from PlayCounter and controller navigation.",
                )
              : t(
                  "This removes all {{count}} saved game and emulator paths, stops PlayCounter from learning new ones, and turns off starting games from PlayCounter and controller navigation.",
                  { count },
                )
            : emulatorFiles
              ? t(
                  "This removes {{count}} saved emulator program and game paths, including files such as ISO, RVZ, and DOSBox programs. Paths for regular games stay intact.",
                  { count },
                )
              : t(
                  "This removes {{count}} saved paths for regular games. Emulator programs and game files stay intact.",
                  { count },
                ),
          t("Play history and game matches are not changed."),
          disablingStorage
            ? t("You can turn path storage back on at any time.")
            : t(
                "PlayCounter can learn the paths again the next time it sees the game running.",
              ),
        ].join(" ")}
      </p>
    </Modal>
  );
}

export function RememberLaunchPathsRow({ level, disabled }: SettingsRowProps) {
  const remember = useAppStore(
    (state) => state.settings.rememberLaunchPaths !== false,
  );
  const setLauncherSetting = useAppStore((state) => state.setLauncherSetting);
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <SettingsRow
        id="rememberLaunchPaths"
        level={level}
        disabled={disabled}
        title={t("Remember launch paths")}
        description={t(
          "Keep the file paths of the games and emulators PlayCounter recognized on this PC. Turning this off deletes the saved paths and stops PlayCounter from learning new ones.",
        )}
        control={
          <Switch
            aria-label={t("Remember launch paths")}
            checked={remember}
            disabled={disabled}
            onChange={(event) => {
              if (event.target.checked)
                setLauncherSetting("rememberLaunchPaths", true);
              else setConfirming(true);
            }}
          />
        }
      />
      {confirming ? (
        <ForgetLaunchFiles scope="all" onClose={() => setConfirming(false)} />
      ) : null}
    </>
  );
}

export function LaunchDirectlyRow({ level, disabled }: SettingsRowProps) {
  const checked = useAppStore(
    (state) => state.settings.gameLaunchingEnabled === true,
  );
  const setLauncherSetting = useAppStore((state) => state.setLauncherSetting);
  return (
    <SettingsRow
      id="gameLaunching"
      level={level}
      disabled={disabled}
      title={t("Launch games directly")}
      description={t(
        "Show Play buttons in My Games and let PlayCounter start games for you.",
      )}
      control={
        <Switch
          data-tour="settings-launch-direct"
          aria-label={t("Launch games directly")}
          checked={checked}
          disabled={disabled}
          onChange={(event) =>
            setLauncherSetting("gameLaunchingEnabled", event.target.checked)
          }
        />
      }
    />
  );
}

export function HideToTrayRow({ level, disabled }: SettingsRowProps) {
  const checked = useAppStore(
    (state) => state.settings.hideToTrayOnGameStart === true,
  );
  const setLauncherSetting = useAppStore((state) => state.setLauncherSetting);
  return (
    <SettingsRow
      id="hideToTray"
      level={level}
      disabled={disabled}
      title={t("Hide to tray when a game starts")}
      description={t(
        "Once a game you started from PlayCounter is running, PlayCounter moves to the tray to save resources.",
      )}
      control={
        <Switch
          aria-label={t("Hide to tray when a game starts")}
          checked={checked}
          disabled={disabled}
          onChange={(event) =>
            setLauncherSetting("hideToTrayOnGameStart", event.target.checked)
          }
        />
      }
    />
  );
}

export function InstallInSteamRow({ level, disabled }: SettingsRowProps) {
  const checked = useAppStore(
    (state) => state.settings.showInstallInSteam === true,
  );
  const setShowInstallInSteam = useAppStore(
    (state) => state.setShowInstallInSteam,
  );
  return (
    <SettingsRow
      id="installInSteam"
      dataTour="settings-install-in-steam"
      level={level}
      disabled={disabled}
      icon={<ProviderBadge provider="steam" variant="mark" />}
      title={t("Show Install in Steam")}
      description={t(
        "For imported Steam games that are no longer installed, show a button that opens Steam's installer where Play would be.",
      )}
      control={
        <Switch
          aria-label={t("Show Install in Steam")}
          checked={checked}
          disabled={disabled}
          onChange={(event) => setShowInstallInSteam(event.target.checked)}
        />
      }
    />
  );
}

export function ControllerNavigationRow({ level, disabled }: SettingsRowProps) {
  const checked = useAppStore(
    (state) => state.settings.controllerNavigationEnabled === true,
  );
  const setLauncherSetting = useAppStore((state) => state.setLauncherSetting);
  return (
    <SettingsRow
      id="controllerNavigation"
      level={level}
      disabled={disabled}
      icon={
        <Gamepad2 size={17} aria-hidden="true" className="text-accent-ink" />
      }
      title={t("Controller navigation")}
      description={t("Move through PlayCounter with a controller.")}
      control={
        <Switch
          data-tour="settings-controller-navigation"
          aria-label={t("Controller navigation")}
          checked={checked}
          disabled={disabled}
          onChange={(event) =>
            setLauncherSetting(
              "controllerNavigationEnabled",
              event.target.checked,
            )
          }
        />
      }
    />
  );
}

export function SavedGameFilesRow({ level, disabled }: SettingsRowProps) {
  const count = useExecutableLaunchTargetCount();
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <SettingsRow
        id="savedGameFiles"
        level={level}
        disabled={disabled}
        title={t("Saved game files")}
        description={t("{{count}} saved game file paths", { count })}
        control={
          <Button
            icon={Trash2}
            disabled={disabled || count === 0}
            onClick={() => setConfirming(true)}
          >
            {t("Forget game files")}
          </Button>
        }
      />
      {confirming ? (
        <ForgetLaunchFiles
          scope="executables"
          onClose={() => setConfirming(false)}
        />
      ) : null}
    </>
  );
}

export function SavedEmulatorFilesRow({ level, disabled }: SettingsRowProps) {
  const count = useEmulatorLaunchTargetCount();
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <SettingsRow
        id="savedEmulatorFiles"
        level={level}
        disabled={disabled}
        title={t("Emulator launch files")}
        description={t("{{count}} saved emulator or content paths", { count })}
        control={
          <Button
            icon={Trash2}
            disabled={disabled || count === 0}
            onClick={() => setConfirming(true)}
          >
            {t("Forget emulator files")}
          </Button>
        }
      />
      {confirming ? (
        <ForgetLaunchFiles
          scope="emulators"
          onClose={() => setConfirming(false)}
        />
      ) : null}
    </>
  );
}
