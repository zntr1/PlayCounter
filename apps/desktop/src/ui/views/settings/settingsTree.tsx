import type { Settings } from "@playcounter/shared";
import {
  Bell,
  Cpu,
  DatabaseBackup,
  Info,
  Keyboard,
  LibraryBig,
  Palette,
  Radar,
  Rocket,
  Settings as SettingsIcon,
  Timer,
  type LucideIcon,
} from "lucide-react";
import type { ComponentType } from "react";
import type { HotkeySetting } from "../../../hotkeys";
import { emulatorLabelList } from "../../../emulators/registry";
import { getT } from "../../../i18n";
import { currentPlatform } from "../../../platform";
import { AutomaticBackupSettings } from "../../AutomaticBackupSettings";
import { WatchFoldersSettings } from "../../WatchFoldersSettings";
import { AppUpdatesRow, HelpRow, UserUuidRow } from "./AboutRows";
import {
  ExportDataRow,
  ImportDataRow,
  ResetAllRow,
  ResetSettingsRow,
} from "./DataRows";
import {
  ContentLookupRow,
  DetectedEmulatorsRow,
  EmulatorDetectionRow,
  IgnoredAppsRow,
  ShareIgnoredAppsRow,
  TrackSoftwareRow,
} from "./DetectionRows";
import {
  AccentColorRow,
  AdultArtRow,
  ClockFormatRow,
  ContentSizeRow,
  FormatRegionRow,
  LanguageRow,
  LaunchOnStartupRow,
  MenuSizeRow,
  ShowDaysRow,
  StartPageRow,
  ThemeRow,
} from "./GeneralRows";
import { HotkeyRow } from "./HotkeyRow";
import {
  ControllerNavigationRow,
  HideToTrayRow,
  InstallInSteamRow,
  LaunchDirectlyRow,
  RememberLaunchPathsRow,
  SavedEmulatorFilesRow,
  SavedGameFilesRow,
} from "./LaunchingRows";
import {
  AutoAddGamesRow,
  ForgetImportsRow,
  LauncherAccountsRow,
} from "./LibraryRows";
import {
  ActionRequiredRow,
  ControllerCountingRow,
  DesktopPopupsRow,
  DiscoveriesRow,
  FirstDetectionsRow,
  GameNotesRow,
  LiveTimerRow,
  MilestonesRow,
  PlaythroughNamesRow,
  PlaytimeReminderRow,
  PopupMonitorRow,
  ScreenshotFolderRow,
  SessionClockRow,
  SessionNotesRow,
  SessionStartsRow,
  SessionSummariesRow,
  TimerCornerRow,
} from "./PlayRows";
import type { SettingsRowProps } from "./SettingsKit";
import type { SettingsGroupId } from "./settingsGroups";

const t = getT("settings");

/** One setting: its row, and the words search looks at. Texts are
 *  functions, so they follow the current language. */
export type SettingsNode = {
  id: string;
  title: () => string;
  description?: () => string;
  /** Labels inside the row that search should find too. */
  keywords?: () => string[];
  /** Hidden on this computer. */
  available?: () => boolean;
  Row: ComponentType<SettingsRowProps>;
  /** Rows that need this switch, and whether it is on. */
  children?: SettingsNode[];
  isOn?: (settings: Settings) => boolean;
};

export type SettingsSectionDef = {
  id: string;
  title?: () => string;
  description?: () => string;
  danger?: boolean;
  /** A switch the whole section needs. */
  needs?: { title: () => string; isOn: (settings: Settings) => boolean };
  nodes: SettingsNode[];
};

export type SettingsGroupDef = {
  id: SettingsGroupId;
  icon: LucideIcon;
  title: () => string;
  description: () => string;
  dataTour?: string;
  /** The guide the page's "Show me how" link starts. */
  guide?: string;
  foot?: () => string;
  /** Search reads the group's description too (the hotkeys say "hotkey"
   *  only there). */
  searchDescription?: boolean;
  sections: SettingsSectionDef[];
};

const onWindows = () => currentPlatform() === "windows";
const popupsUnsupported = () => t("Desktop popups are not supported on macOS.");
const screenshotsUnsupported = () =>
  t("Screenshots are not supported on macOS yet.");

function hotkey(
  setting: HotkeySetting,
  title: () => string,
  description: () => string,
  macText?: () => string,
): SettingsNode {
  // A stable component per hotkey, so its recording state survives renders.
  const Row = (props: SettingsRowProps) => (
    <HotkeyRow
      {...props}
      setting={setting}
      title={title()}
      description={description()}
      macText={macText?.()}
    />
  );
  return { id: setting, title, description, Row };
}

const desktopPopupsOn = (settings: Settings) =>
  settings.desktopOverlaysEnabled === true;

const GROUPS: SettingsGroupDef[] = [
  {
    id: "general",
    icon: SettingsIcon,
    title: () => t("General"),
    description: () =>
      t("Control background behavior and how playtimes are shown."),
    dataTour: "settings-general",
    sections: [
      {
        id: "general",
        nodes: [
          {
            id: "launchOnStartup",
            title: () => t("Launch on startup"),
            description: () =>
              t(
                "Strongly recommended. PlayCounter starts when you sign in, so no game session is missed. If this is off, tracking only works after you open the app yourself.",
              ),
            Row: LaunchOnStartupRow,
          },
          {
            id: "startView",
            title: () => t("Start page"),
            description: () => t("The page PlayCounter shows when it opens."),
            keywords: () => [t("Now Playing"), t("My Games")],
            Row: StartPageRow,
          },
          {
            id: "language",
            title: () => t("Language"),
            description: () =>
              t(
                "System uses your computer's language when PlayCounter has it, otherwise English.",
              ),
            Row: LanguageRow,
          },
          {
            id: "formatRegion",
            title: () => t("Format region"),
            description: () =>
              t(
                "Dates, times and numbers the way this country writes them, in the app's language. Automatic follows your language and computer.",
              ),
            Row: FormatRegionRow,
          },
          {
            id: "clockFormat",
            title: () => t("Clock"),
            description: () =>
              t(
                "Show times with 24 hours or with AM and PM. Automatic follows the format region.",
              ),
            keywords: () => [t("24-hour"), t("12-hour")],
            Row: ClockFormatRow,
          },
          {
            id: "showDurationDays",
            title: () => t("Show days in playtime"),
            description: () =>
              t(
                "Shows long playtimes as days and hours instead of total hours.",
              ),
            Row: ShowDaysRow,
          },
        ],
      },
    ],
  },
  {
    id: "appearance",
    icon: Palette,
    title: () => t("Appearance"),
    description: () =>
      t("Personalize PlayCounter's theme, colors, and interface size."),
    dataTour: "settings-appearance",
    sections: [
      {
        id: "appearance",
        nodes: [
          {
            id: "theme",
            title: () => t("Theme"),
            description: () => t("Choose a light or dark theme."),
            keywords: () => [t("Dark"), t("Light")],
            Row: ThemeRow,
          },
          {
            id: "accentColor",
            title: () => t("Accent color"),
            description: () =>
              t(
                "Choose an accent color. PlayCounter adjusts it automatically for readable contrast in both themes.",
              ),
            Row: AccentColorRow,
          },
          {
            id: "contentScale",
            title: () => t("Content size"),
            description: () =>
              t(
                "Text, icons, covers and spacing in the main area scale together. Menus and dialogs keep their size.",
              ),
            Row: ContentSizeRow,
          },
          {
            id: "menuScale",
            title: () => t("Menu size"),
            description: () =>
              t("The sidebar and the title bar with the search field."),
            Row: MenuSizeRow,
          },
          {
            id: "showAdultArt",
            title: () => t("Show 18+ art"),
            description: () =>
              t(
                "Include SteamGridDB artwork marked 18+ when you pick covers and banners. Art you share with the community always stays safe for work.",
              ),
            Row: AdultArtRow,
          },
        ],
      },
    ],
  },
  {
    id: "shortcuts",
    icon: Keyboard,
    title: () => t("Keyboard shortcuts"),
    description: () =>
      t(
        "Global hotkeys work while PlayCounter is running, including in the system tray.",
      ),
    dataTour: "settings-shortcuts",
    guide: "while-you-play",
    searchDescription: true,
    foot: () =>
      t(
        "In exclusive fullscreen games, the game may minimize while a box is open, and a screenshot may come out black.",
      ),
    sections: [
      {
        id: "app",
        title: () => "PlayCounter",
        nodes: [
          hotkey(
            "showWindowHotkey",
            () => t("Bring PlayCounter to front"),
            () => t("Show and focus PlayCounter from any app."),
          ),
          hotkey(
            "quickAddHotkey",
            () => t("Quick add game"),
            () =>
              t(
                "Open a small search box from anywhere and add a game to My Games, for the ones you want to remember. Enter searches, Enter again adds it and takes you back.",
              ),
            popupsUnsupported,
          ),
        ],
      },
      {
        id: "playing",
        title: () => t("While you play"),
        nodes: [
          hotkey(
            "currentSessionHotkey",
            () => t("Show current session time"),
            () =>
              t(
                "Show a brief popup without leaving your game, even when automatic popups are off. Press again to cycle through active games.",
              ),
            popupsUnsupported,
          ),
          hotkey(
            "quickNoteHotkey",
            () => t("Quick session note"),
            () =>
              t(
                "Open a small note box over your game and write down what happened in this session. Enter saves and takes you back to the game.",
              ),
            popupsUnsupported,
          ),
          hotkey(
            "liveTimerHotkey",
            () => t("Show or hide live timer"),
            () =>
              t(
                "Each press moves the live timer to the next corner: top left, top right, bottom right, bottom left, then off. The last choice stays for your next games.",
              ),
            popupsUnsupported,
          ),
          hotkey(
            "pauseTimerHotkey",
            () => t("Pause or resume timer"),
            () =>
              t(
                "Stops counting the game you're playing while you're away, and counts on when you press it again. The game stays open.",
              ),
            popupsUnsupported,
          ),
        ],
      },
      {
        id: "counters",
        title: () => t("Counters"),
        nodes: [
          hotkey(
            "counterBoxHotkey",
            () => t("Open counter box"),
            () =>
              t(
                "Opens a small box over your game with all its counters. Add counters there, count any of them and give one its own key.",
              ),
            popupsUnsupported,
          ),
          hotkey(
            "counterUndoHotkey",
            () => t("Take one back"),
            () =>
              t(
                "Takes one off the counter you counted last, if you pressed its key by mistake. Each counter gets its own key in the counter box or in Game Details.",
              ),
            popupsUnsupported,
          ),
        ],
      },
      {
        id: "screenshots",
        title: () => t("Screenshots"),
        nodes: [
          hotkey(
            "screenshotHotkey",
            () => t("Take a screenshot"),
            () =>
              t(
                "Saves a picture of the game you're playing and adds it to the session. Works in windowed and borderless games.",
              ),
            screenshotsUnsupported,
          ),
          hotkey(
            "screenshotCaptionHotkey",
            () => t("Screenshot with caption"),
            () =>
              t(
                "Takes the picture at once, then opens a small box over your game for a caption. Enter saves and takes you back to the game. Esc keeps the picture without one.",
              ),
            screenshotsUnsupported,
          ),
        ],
      },
    ],
  },
  {
    id: "play",
    icon: Timer,
    title: () => t("While you play"),
    description: () =>
      t(
        "Keep an eye on your time without leaving the game. Both work even when desktop popups are off.",
      ),
    guide: "while-you-play",
    sections: [
      {
        id: "play",
        nodes: [
          {
            id: "liveTimer",
            title: () => t("Live timer"),
            description: () =>
              t(
                "A small timer in a corner of your game's window that counts up while you play. It hides while another app is in front, and clicks pass through it.",
              ),
            Row: LiveTimerRow,
            isOn: (settings) => settings.liveTimerEnabled === true,
            children: [
              {
                id: "liveTimerCorner",
                title: () => t("Timer position"),
                description: () =>
                  t("Pick a corner your game's HUD leaves free."),
                Row: TimerCornerRow,
              },
            ],
          },
          {
            id: "playtimeReminder",
            title: () => t("Playtime reminder"),
            description: () =>
              t(
                "A popup every time today's playtime grows by this much. All games count together.",
              ),
            Row: PlaytimeReminderRow,
          },
          {
            id: "controllerCounting",
            title: () => t("Count with controller"),
            description: () =>
              t(
                "Works on the counter with the controller icon. On PlayStation, hold Create instead of View. The game gets these buttons too, so press them on the death screen.",
              ),
            available: onWindows,
            Row: ControllerCountingRow,
          },
          {
            id: "screenshotFolder",
            title: () => t("Screenshots"),
            description: () =>
              t(
                "Pictures from the screenshot key go to your Pictures folder, one folder per game.",
              ),
            Row: ScreenshotFolderRow,
          },
        ],
      },
    ],
  },
  {
    id: "popups",
    icon: Bell,
    title: () => t("Desktop popups"),
    description: () =>
      t(
        "Short popups on your desktop while you play. They disappear on their own.",
      ),
    dataTour: "settings-notifications",
    sections: [
      {
        id: "popups",
        nodes: [
          {
            id: "desktopOverlays",
            title: () => t("Show desktop popups"),
            description: () =>
              t(
                "Show popups even while PlayCounter is open and focused, or running in the tray.",
              ),
            Row: DesktopPopupsRow,
          },
          {
            id: "overlayMonitor",
            title: () => t("Popup monitor"),
            description: () =>
              t(
                "Popups appear at the top right of this display. Hotkey popups, boxes and timers you start by hand use it too. If it is disconnected, PlayCounter uses your primary monitor.",
              ),
            Row: PopupMonitorRow,
          },
        ],
      },
      {
        id: "kinds",
        title: () => t("Show a popup for"),
        needs: { title: () => t("Show desktop popups"), isOn: desktopPopupsOn },
        nodes: [
          {
            id: "overlayActionRequired",
            title: () => t("Choices that need review"),
            description: () =>
              t(
                "Popup when PlayCounter needs you to pick between possible games. Click it to open Now Playing.",
              ),
            Row: ActionRequiredRow,
          },
          {
            id: "overlayFirstDetections",
            title: () => t("First-time detections"),
            description: () =>
              t("Popup when PlayCounter recognizes a game for the first time."),
            Row: FirstDetectionsRow,
          },
          {
            id: "overlaySessionStarts",
            title: () => t("Every game start"),
            description: () => t("Popup each time tracking starts."),
            Row: SessionStartsRow,
          },
          {
            id: "overlaySessionSummaries",
            title: () => t("Session summaries"),
            description: () => t("Popup after sessions of 10 minutes or more."),
            Row: SessionSummariesRow,
          },
          {
            id: "overlayMilestones",
            title: () => t("Milestones"),
            description: () =>
              t("Popup when you unlock a new playtime milestone."),
            Row: MilestonesRow,
          },
          {
            id: "overlayDiscoveries",
            title: () => t("New discoveries"),
            description: () =>
              t(
                "Popup when PlayCounter finds an app it does not know. Click it to open Discovered. Only apps found while this is on are included.",
              ),
            Row: DiscoveriesRow,
          },
        ],
      },
      {
        id: "contents",
        title: () => t("In the popups"),
        needs: { title: () => t("Show desktop popups"), isOn: desktopPopupsOn },
        nodes: [
          {
            id: "overlayPlaythroughNames",
            title: () => t("Playthrough names in popups"),
            description: () =>
              t(
                "Show the playthrough name in game-start and saved-session popups.",
              ),
            Row: PlaythroughNamesRow,
          },
          {
            id: "overlayGameNotes",
            title: () => t("Notes in game-start popups"),
            description: () =>
              t(
                "Show the note of the game's active playthrough in the popup when a game starts.",
              ),
            Row: GameNotesRow,
          },
          {
            id: "overlayUpdateNote",
            title: () => t("Session notes in popups"),
            description: () =>
              t(
                'Show an "Add session note" button in saved-session popups. It opens a small box where you write what happened in that session.',
              ),
            Row: SessionNotesRow,
          },
        ],
      },
      {
        id: "sessionPopup",
        title: () => t("Session time popup"),
        description: () =>
          t(
            "The popup of the Show current session time hotkey. It works even when desktop popups are off.",
          ),
        nodes: [
          {
            id: "overlayShowClock",
            title: () => t("Show clock in session popup"),
            description: () =>
              t(
                "Add the time of day to the current session popup, handy in fullscreen games.",
              ),
            Row: SessionClockRow,
          },
        ],
      },
    ],
  },
  {
    id: "launching",
    icon: Rocket,
    title: () => t("Game launching"),
    description: () =>
      t(
        "Decide whether PlayCounter may remember game files on this PC, start games for you, and be steered with a controller.",
      ),
    dataTour: "settings-launcher",
    foot: () =>
      t(
        "PlayCounter starts the game file you picked directly, or hands a saved game file to a supported emulator. Games managed by a launcher, and games that ask for administrator rights, may still need their normal shortcut. Remembered paths stay on this device and are left out of backups.",
      ),
    sections: [
      {
        id: "launching",
        nodes: [
          {
            id: "rememberLaunchPaths",
            title: () => t("Remember launch paths"),
            description: () =>
              t(
                "Keep the file paths of the games and emulators PlayCounter recognized on this PC. Turning this off deletes the saved paths and stops PlayCounter from learning new ones.",
              ),
            Row: RememberLaunchPathsRow,
            isOn: (settings) => settings.rememberLaunchPaths !== false,
            children: [
              {
                id: "gameLaunching",
                title: () => t("Launch games directly"),
                description: () =>
                  t(
                    "Show Play buttons in My Games and let PlayCounter start games for you.",
                  ),
                Row: LaunchDirectlyRow,
                isOn: (settings) => settings.gameLaunchingEnabled === true,
                children: [
                  {
                    id: "hideToTray",
                    title: () => t("Hide to tray when a game starts"),
                    description: () =>
                      t(
                        "Once a game you started from PlayCounter is running, PlayCounter moves to the tray to save resources.",
                      ),
                    Row: HideToTrayRow,
                  },
                  {
                    id: "installInSteam",
                    title: () => t("Show Install in Steam"),
                    description: () =>
                      t(
                        "For imported Steam games that are no longer installed, show a button that opens Steam's installer where Play would be.",
                      ),
                    Row: InstallInSteamRow,
                  },
                  {
                    id: "controllerNavigation",
                    title: () => t("Controller navigation"),
                    description: () =>
                      t("Move through PlayCounter with a controller."),
                    Row: ControllerNavigationRow,
                  },
                ],
              },
              {
                id: "savedGameFiles",
                title: () => t("Saved game files"),
                keywords: () => [t("Forget game files")],
                Row: SavedGameFilesRow,
              },
              {
                id: "savedEmulatorFiles",
                title: () => t("Emulator launch files"),
                keywords: () => [t("Forget emulator files")],
                Row: SavedEmulatorFilesRow,
              },
            ],
          },
        ],
      },
    ],
  },
  {
    id: "library",
    icon: LibraryBig,
    title: () => t("Library import"),
    description: () =>
      t(
        "Keep your launcher games up to date, or remove data imported from Steam, Xbox, Battle.net, Epic Games, GOG or PlayStation. Install paths and the game files linked to them always stay on this PC.",
      ),
    dataTour: "settings-library-import",
    sections: [
      {
        id: "new-games",
        nodes: [
          {
            id: "autoAddInstalledGames",
            title: () => t("Add new games automatically"),
            description: () =>
              t(
                "After your first import from Steam, Battle.net, Epic Games or GOG, games you install there show up in My Games on their own, and so do new games you play on PlayStation. Games you remove from PlayCounter are not added again. Xbox games still need an Xbox import, because Xbox does not tell PlayCounter which game an installation is.",
              ),
            available: onWindows,
            Row: AutoAddGamesRow,
          },
          {
            id: "watchFolders",
            title: () => t("Watched folders"),
            description: () =>
              t(
                "Each folder inside a watched folder counts as one game. Games PlayCounter recognizes show up in My Games, ready to play; the rest wait in Discovered. To recognize them, PlayCounter sends the names of the game files it finds to its game database.",
              ),
            keywords: () => [t("Add folder"), t("Dismissed game folders")],
            available: onWindows,
            Row: WatchFoldersSettings,
          },
        ],
      },
      {
        id: "imports",
        nodes: [
          {
            id: "launcherAccounts",
            title: () => getT("accounts")("Launcher accounts"),
            description: () =>
              getT("accounts")(
                "Manage your launcher connections in one place.",
              ),
            Row: LauncherAccountsRow,
          },
          {
            id: "forgetImports",
            title: () => t("Forget imported data"),
            description: () =>
              t(
                "Forget removes what one import added. Sessions PlayCounter recorded itself are always kept.",
              ),
            keywords: () => [
              "Steam",
              "Xbox",
              "Battle.net",
              "Epic Games",
              "GOG",
              "PlayStation",
            ],
            Row: ForgetImportsRow,
          },
        ],
      },
    ],
  },
  {
    id: "emulators",
    icon: Cpu,
    title: () => t("Emulators"),
    description: () =>
      t("Detect the game running inside {{emulators}}.", {
        emulators: emulatorLabelList("or"),
      }),
    dataTour: "settings-emulators",
    sections: [
      {
        id: "detection",
        nodes: [
          {
            id: "emulatorDetection",
            title: () => t("Detect emulator games"),
            description: () =>
              t(
                "Reads the loaded game file, the window title, and the start-up options of the emulator on this PC to work out which game is running. Full paths and window titles never leave your PC.",
              ),
            Row: EmulatorDetectionRow,
            isOn: (settings) => settings.emulatorDetection ?? true,
            children: [
              {
                id: "emulatorContentLookup",
                title: () => t("Look up recognized content"),
                description: () =>
                  t(
                    "Sends the recognized game file name or disc ID to look it up in the database. Folder paths and unclear window titles stay on this PC.",
                  ),
                Row: ContentLookupRow,
              },
            ],
          },
        ],
      },
      {
        id: "detected",
        nodes: [
          {
            id: "detectedEmulators",
            title: () => t("Detected emulators"),
            description: () =>
              t(
                "Ignored emulators are hidden and no games inside them are tracked. Existing games, mappings, and history are preserved.",
              ),
            keywords: () => [
              t("Change program"),
              t("Set program"),
              t("Ignore"),
            ],
            Row: DetectedEmulatorsRow,
          },
        ],
      },
    ],
  },
  {
    id: "discovery",
    icon: Radar,
    title: () => t("Discovery"),
    description: () =>
      t("Tune how PlayCounter finds apps and retries unknown ones."),
    sections: [
      {
        id: "discovery",
        nodes: [
          {
            id: "trackTools",
            title: () => t("Track software"),
            description: () =>
              t(
                "Count how long apps like Discord, Spotify and launchers run, on their own Software page. They never appear in Now Playing and never count toward your game stats.",
              ),
            Row: TrackSoftwareRow,
          },
          {
            id: "shareIgnoredApps",
            title: () => t("Share apps you ignore"),
            description: () =>
              t(
                "When you ignore an app PlayCounter does not recognize, it sends the file name, your platform, and an anonymous install ID. Playtime and game history are never sent.",
              ),
            Row: ShareIgnoredAppsRow,
          },
          {
            id: "ignoredApps",
            title: () => t("Ignored apps"),
            description: () =>
              t(
                "Apps in this list are never treated as games. It contains PlayCounter's built-in list of system apps plus the apps you ignored yourself.",
              ),
            Row: IgnoredAppsRow,
          },
        ],
      },
    ],
  },
  {
    id: "backup",
    icon: DatabaseBackup,
    title: () => t("Backup & transfer"),
    description: () =>
      t(
        "Protect your play history, notes, playthroughs, and shelves, or move them to another PC. Backups are plain JSON files.",
      ),
    dataTour: "settings-backup",
    sections: [
      {
        id: "automatic",
        nodes: [
          {
            id: "automaticBackups",
            title: () => t("Automatic backups"),
            description: () =>
              t(
                "Save a backup on a schedule while PlayCounter is running, even when it is only in the tray. A missed backup is saved the next time you open the app.",
              ),
            keywords: () => [
              t("Schedule"),
              t("Daily"),
              t("Weekly"),
              t("Keep"),
              t("Backup folder"),
              t("Choose folder"),
              t("Back up now"),
            ],
            Row: AutomaticBackupSettings,
          },
        ],
      },
      {
        id: "transfer",
        title: () => t("Move to another PC"),
        nodes: [
          {
            id: "exportData",
            title: () => t("Export data"),
            description: () =>
              t(
                "Save your history, notes, playthroughs, shelves, game cache, and settings to a JSON file you can copy to another PC.",
              ),
            Row: ExportDataRow,
          },
          {
            id: "importData",
            title: () => t("Import data"),
            description: () =>
              t(
                "Replace all local data with a backup file. Your current data is backed up automatically first.",
              ),
            Row: ImportDataRow,
          },
        ],
      },
      {
        id: "reset",
        title: () => t("Reset"),
        description: () =>
          t(
            "Restore default settings or start fresh. Existing backups are kept.",
          ),
        danger: true,
        nodes: [
          {
            id: "resetSettings",
            title: () => t("Restore default settings"),
            description: () =>
              t(
                "Reset app preferences while keeping your games, play history, and backup preferences.",
              ),
            Row: ResetSettingsRow,
          },
          {
            id: "resetAll",
            title: () => t("Start over"),
            description: () =>
              t(
                "Clear your library, history, and app settings, then restart PlayCounter. Your backup files are preserved.",
              ),
            Row: ResetAllRow,
          },
        ],
      },
    ],
  },
  {
    id: "about",
    icon: Info,
    title: () => t("About"),
    description: () => t("Your version, updates, help and install ID."),
    sections: [
      {
        id: "version",
        nodes: [
          {
            id: "appUpdates",
            title: () => t("App updates"),
            description: () =>
              t("Check for a new PlayCounter version immediately."),
            keywords: () => [t("Release notes"), t("Check")],
            Row: AppUpdatesRow,
          },
        ],
      },
      {
        id: "help",
        nodes: [
          {
            id: "help",
            title: () => t("Help & tutorials"),
            description: () =>
              t(
                "Tutorials and task guides are available from the Help menu in the top-right corner.",
              ),
            Row: HelpRow,
          },
          {
            id: "userUuid",
            title: () => t("User UUID"),
            description: () =>
              t(
                "A random ID that recognizes your installation without an account. Used to count active installations and link your community suggestions and reports.",
              ),
            Row: UserUuidRow,
          },
        ],
      },
    ],
  },
];

/** The groups this computer shows, in menu order. */
export function settingsGroups(
  available: (group: SettingsGroupId) => boolean,
): SettingsGroupDef[] {
  return GROUPS.filter((group) => available(group.id));
}

export const nodeAvailable = (node: SettingsNode) =>
  node.available ? node.available() : true;
