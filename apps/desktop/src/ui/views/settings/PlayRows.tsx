import { FolderOpen, Timer } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import type { LiveTimerCorner } from "@playcounter/shared";
import { getT } from "../../../i18n";
import { PLAYTIME_REMINDER_MINUTES } from "../../../playtimeReminder";
import { openScreenshotsFolder, screenshotsFolder } from "../../../screenshots";
import { useAppStore, type DesktopOverlaySettingKey } from "../../../store";
import { cn } from "../../cn";
import { ControllerButtonGlyph } from "../../ControllerButtonGlyph";
import { DesktopOverlayMonitorSelect } from "../../DesktopOverlayMonitorSelect";
import { Button, Select, Switch } from "../../primitives";
import {
  PreviewButton,
  SettingsRow,
  type SettingsRowProps,
} from "./SettingsKit";
import type { DesktopOverlayKind } from "../../../desktopOverlays";

const t = getT("settings");

/** A switch for one of the desktop-popup settings. */
function OverlaySwitchRow({
  setting,
  id = setting,
  title,
  description,
  preview,
  below,
  level,
  disabled,
}: SettingsRowProps & {
  setting: DesktopOverlaySettingKey;
  id?: string;
  title: string;
  description: string;
  preview?: readonly [DesktopOverlayKind, string];
  below?: ReactNode;
}) {
  const settings = useAppStore((state) => state.settings);
  const setDesktopOverlaySetting = useAppStore(
    (state) => state.setDesktopOverlaySetting,
  );
  // Some kinds are on until turned off; these start off.
  const startsOff =
    setting === "desktopOverlaysEnabled" ||
    setting === "overlaySessionStarts" ||
    setting === "overlayPlaythroughNames" ||
    setting === "overlayGameNotes" ||
    setting === "overlayUpdateNote" ||
    setting === "overlayDiscoveries" ||
    setting === "overlayShowClock" ||
    setting === "liveTimerEnabled" ||
    setting === "controllerCountingEnabled";
  const checked = startsOff
    ? settings[setting] === true
    : settings[setting] !== false;
  return (
    <SettingsRow
      id={id}
      level={level}
      disabled={disabled}
      title={title}
      description={description}
      below={below}
      control={
        <>
          {preview ? (
            <PreviewButton kind={preview[0]} name={preview[1]} />
          ) : null}
          <Switch
            aria-label={title}
            checked={checked}
            disabled={disabled}
            onChange={(event) =>
              setDesktopOverlaySetting(setting, event.target.checked)
            }
          />
        </>
      }
    />
  );
}

/* ── While you play ──────────────────────────────────────── */

export function LiveTimerRow(props: SettingsRowProps) {
  return (
    <OverlaySwitchRow
      {...props}
      setting="liveTimerEnabled"
      title={t("Live timer")}
      description={t(
        "A small timer in a corner of your game's window that counts up while you play. It hides while another app is in front, and clicks pass through it.",
      )}
    />
  );
}

function corners(): ReadonlyArray<readonly [LiveTimerCorner, string]> {
  return [
    ["top-left", t("Top left")],
    ["top-right", t("Top right")],
    ["bottom-left", t("Bottom left")],
    ["bottom-right", t("Bottom right")],
  ];
}

const cornerPlace: Record<LiveTimerCorner, string> = {
  "top-left": "left-0 top-0",
  "top-right": "right-0 top-0",
  "bottom-left": "bottom-0 left-0",
  "bottom-right": "bottom-0 right-0",
};
const pillPlace: Record<LiveTimerCorner, string> = {
  "top-left": "left-1.5 top-1.5",
  "top-right": "right-1.5 top-1.5",
  "bottom-left": "bottom-1.5 left-1.5",
  "bottom-right": "bottom-1.5 right-1.5",
};

export function TimerCornerRow({ level, disabled }: SettingsRowProps) {
  const corner = useAppStore(
    (state) => state.settings.liveTimerCorner ?? "top-left",
  );
  const setLiveTimerCorner = useAppStore((state) => state.setLiveTimerCorner);
  const options = corners();
  const label = options.find(([value]) => value === corner)?.[1];
  return (
    <SettingsRow
      id="liveTimerCorner"
      level={level}
      disabled={disabled}
      title={t("Timer position")}
      description={t("Pick a corner your game's HUD leaves free.")}
      control={
        <div
          role="group"
          aria-label={t("Timer position")}
          className={cn(
            "grid justify-items-center gap-1",
            disabled && "opacity-50",
          )}
        >
          {/* A small game screen: click the corner the timer goes to. */}
          <div className="relative h-[90px] w-40 overflow-hidden rounded-lg bg-[radial-gradient(120%_90%_at_70%_20%,#3b4a63_0%,#1b2230_55%,#120f0d_100%)] shadow-raised ring-1 ring-inset ring-white/10">
            <span
              aria-hidden="true"
              className="absolute bottom-3 left-1/2 h-1.5 w-16 -translate-x-1/2 rounded-full bg-white/15"
            />
            {options.map(([value, name]) => {
              const on = value === corner;
              return (
                <button
                  key={value}
                  type="button"
                  aria-label={name}
                  title={name}
                  aria-pressed={on}
                  disabled={disabled}
                  onClick={() => setLiveTimerCorner(value)}
                  className={cn(
                    "group absolute h-1/2 w-1/2 disabled:cursor-not-allowed",
                    cornerPlace[value],
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "absolute inline-flex items-center gap-[3px] rounded-full px-1.5 font-mono text-[10px] font-semibold leading-[14px]",
                      pillPlace[value],
                      on
                        ? "bg-black/80 text-white ring-1 ring-accent"
                        : "h-4 w-[52px] border border-dashed border-white/60 opacity-0 group-hover:opacity-100 group-disabled:opacity-0",
                    )}
                  >
                    {on ? (
                      <>
                        <Timer size={10} strokeWidth={2.5} />
                        1:42:07
                      </>
                    ) : null}
                  </span>
                </button>
              );
            })}
          </div>
          <span className="text-xs text-text-muted">{label}</span>
        </div>
      }
    />
  );
}

function playtimeReminderLabel(minutes: number) {
  return minutes % 60 === 0
    ? t("Every {{count, number}} hours", { count: minutes / 60 })
    : t("Every {{count, number}} minutes", { count: minutes });
}

export function PlaytimeReminderRow({ level, disabled }: SettingsRowProps) {
  const minutes = useAppStore(
    (state) => state.settings.playtimeReminderMinutes ?? null,
  );
  const setPlaytimeReminderMinutes = useAppStore(
    (state) => state.setPlaytimeReminderMinutes,
  );
  return (
    <SettingsRow
      id="playtimeReminder"
      level={level}
      disabled={disabled}
      title={t("Playtime reminder")}
      description={t(
        "A popup every time today's playtime grows by this much. All games count together.",
      )}
      control={
        <>
          <PreviewButton
            kind="playtime-reminder"
            name={t("Playtime reminder")}
          />
          <Select
            aria-label={t("Playtime reminder")}
            value={String(minutes ?? "off")}
            disabled={disabled}
            onChange={(event) =>
              setPlaytimeReminderMinutes(
                event.target.value === "off"
                  ? null
                  : Number(event.target.value),
              )
            }
          >
            <option value="off">{t("Off")}</option>
            {PLAYTIME_REMINDER_MINUTES.map((value) => (
              <option key={value} value={String(value)}>
                {playtimeReminderLabel(value)}
              </option>
            ))}
          </Select>
        </>
      }
    />
  );
}

export function ControllerCountingRow(props: SettingsRowProps) {
  const chip = (direction: "up" | "down") => (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-bg/50 py-0.5 pl-1 pr-2.5 text-[12.5px] text-text-muted">
      <ControllerButtonGlyph button="VIEW" size="small" />
      <span aria-hidden="true" className="text-[11px] text-text-faint">
        +
      </span>
      <ControllerButtonGlyph button="DPAD" size="small" />
      <b aria-hidden="true" className="font-bold text-text">
        {direction === "up" ? "↑" : "↓"}
      </b>
      {direction === "up"
        ? t("Hold for 1 second: add one")
        : t("Hold for 1 second: take one back")}
    </span>
  );
  return (
    <OverlaySwitchRow
      {...props}
      setting="controllerCountingEnabled"
      id="controllerCounting"
      title={t("Count with controller")}
      description={t(
        "Works on the counter with the controller icon. On PlayStation, hold Create instead of View. The game gets these buttons too, so press them on the death screen.",
      )}
      below={
        <div className="flex flex-wrap gap-2">
          {chip("up")}
          {chip("down")}
        </div>
      }
    />
  );
}

/** Where the screenshot key's pictures go, with a button to open it. */
export function ScreenshotFolderRow({ level, disabled }: SettingsRowProps) {
  const [folder, setFolder] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let current = true;
    void screenshotsFolder()
      .then((path) => {
        if (current) setFolder(path);
      })
      .catch((error) => console.error("screenshot folder failed", error));
    return () => {
      current = false;
    };
  }, []);
  return (
    <SettingsRow
      id="screenshotFolder"
      level={level}
      disabled={disabled}
      title={t("Screenshots")}
      description={
        failed
          ? t("The folder could not be opened.")
          : folder
            ? t(
                "Pictures from the screenshot key go to {{folder}}, one folder per game. They stay there if you uninstall PlayCounter.",
                { folder },
              )
            : t(
                "Pictures from the screenshot key go to your Pictures folder, one folder per game.",
              )
      }
      control={
        <Button
          icon={FolderOpen}
          disabled={disabled}
          onClick={() => {
            setFailed(false);
            void openScreenshotsFolder().catch((error) => {
              console.error("screenshot folder failed", error);
              setFailed(true);
            });
          }}
        >
          {t("Open folder")}
        </Button>
      }
    />
  );
}

/* ── Desktop popups ──────────────────────────────────────── */

export function DesktopPopupsRow(props: SettingsRowProps) {
  return (
    <OverlaySwitchRow
      {...props}
      setting="desktopOverlaysEnabled"
      title={t("Show desktop popups")}
      description={t(
        "Show popups even while PlayCounter is open and focused, or running in the tray.",
      )}
    />
  );
}

export function PopupMonitorRow({ level, disabled }: SettingsRowProps) {
  return (
    <SettingsRow
      id="overlayMonitor"
      level={level}
      disabled={disabled}
      title={t("Popup monitor")}
      description={t(
        "Popups appear at the top right of this display. Hotkey popups, boxes and timers you start by hand use it too. If it is disconnected, PlayCounter uses your primary monitor.",
      )}
      control={<DesktopOverlayMonitorSelect />}
    />
  );
}

export function ActionRequiredRow(props: SettingsRowProps) {
  return (
    <OverlaySwitchRow
      {...props}
      setting="overlayActionRequired"
      title={t("Choices that need review")}
      description={t(
        "Popup when PlayCounter needs you to pick between possible games. Click it to open Now Playing.",
      )}
      preview={["action-required", t("Choice required")]}
    />
  );
}

export function FirstDetectionsRow(props: SettingsRowProps) {
  return (
    <OverlaySwitchRow
      {...props}
      setting="overlayFirstDetections"
      title={t("First-time detections")}
      description={t(
        "Popup when PlayCounter recognizes a game for the first time.",
      )}
      preview={["first-detection", t("First detection")]}
    />
  );
}

export function SessionStartsRow(props: SettingsRowProps) {
  return (
    <OverlaySwitchRow
      {...props}
      setting="overlaySessionStarts"
      title={t("Every game start")}
      description={t("Popup each time tracking starts.")}
      preview={["session-start", t("Game start")]}
    />
  );
}

export function SessionSummariesRow(props: SettingsRowProps) {
  return (
    <OverlaySwitchRow
      {...props}
      setting="overlaySessionSummaries"
      title={t("Session summaries")}
      description={t("Popup after sessions of 10 minutes or more.")}
      preview={["session-summary", t("Session summary")]}
    />
  );
}

export function MilestonesRow(props: SettingsRowProps) {
  return (
    <OverlaySwitchRow
      {...props}
      setting="overlayMilestones"
      title={t("Milestones")}
      description={t("Popup when you unlock a new playtime milestone.")}
      preview={["milestone", t("Milestone")]}
    />
  );
}

export function DiscoveriesRow(props: SettingsRowProps) {
  return (
    <OverlaySwitchRow
      {...props}
      setting="overlayDiscoveries"
      title={t("New discoveries")}
      description={t(
        "Popup when PlayCounter finds an app it does not know. Click it to open Discovered. Only apps found while this is on are included.",
      )}
      preview={["discovery", t("Discovery")]}
    />
  );
}

export function PlaythroughNamesRow(props: SettingsRowProps) {
  return (
    <OverlaySwitchRow
      {...props}
      setting="overlayPlaythroughNames"
      title={t("Playthrough names in popups")}
      description={t(
        "Show the playthrough name in game-start and saved-session popups.",
      )}
    />
  );
}

export function GameNotesRow(props: SettingsRowProps) {
  return (
    <OverlaySwitchRow
      {...props}
      setting="overlayGameNotes"
      title={t("Notes in game-start popups")}
      description={t(
        "Show the note of the game's active playthrough in the popup when a game starts.",
      )}
    />
  );
}

export function SessionNotesRow(props: SettingsRowProps) {
  return (
    <OverlaySwitchRow
      {...props}
      setting="overlayUpdateNote"
      title={t("Session notes in popups")}
      description={t(
        'Show an "Add session note" button in saved-session popups. It opens a small box where you write what happened in that session.',
      )}
    />
  );
}

export function SessionClockRow(props: SettingsRowProps) {
  return (
    <OverlaySwitchRow
      {...props}
      setting="overlayShowClock"
      title={t("Show clock in session popup")}
      description={t(
        "Add the time of day to the current session popup, handy in fullscreen games.",
      )}
      preview={["current-session", t("Current session")]}
    />
  );
}
