import type { ViewId } from "../../store";

export type TourAdvance =
  | { type: "anchor-present"; selector: string }
  | { type: "event"; name: "mygames.demo-session-logged" };

export type TourStep = {
  id: string;
  title: string;
  body: string;
  view: ViewId | "keep" | "return";
  anchor?: string;
  additionalAnchors?: string[];
  cardPlacement?: "below";
  optional?: boolean;
  interactive?: boolean;
  manualAdvance?: boolean;
  persistentInteraction?: boolean;
  scrollIntoView?: boolean;
  allow?: string[];
  advanceOn?: TourAdvance;
  retreatWhenMissing?: string;
  backTo?: string;
  skipTo?: string;
  keyboardHint?: string;
};

export type TourDefinition = {
  id: string;
  version: number;
  kind: "core" | "guide";
  title: string;
  description: string;
  duration: string;
  demoGame?: boolean;
  steps: TourStep[];
};

const a = (name: string) => `[data-tour="${name}"]`;

export const TOURS: TourDefinition[] = [
  {
    id: "core",
    version: 1,
    kind: "core",
    title: "Quick tour",
    description: "The essentials of PlayCounter in about a minute.",
    duration: "1 min",
    steps: [
      {
        id: "intro",
        view: "keep",
        title: "PlayCounter in 60 seconds",
        body: "PlayCounter runs in the background and records how long you play. It doesn't matter where the game came from: a launcher, a disc, an emulator, or a single .exe file on your desktop.",
      },
      {
        id: "now",
        view: "now",
        anchor: a("now-playing-demo"),
        additionalAnchors: [a("nav-now")],
        cardPlacement: "below",
        title: "Now Playing",
        body: "This is a sample session, not a real one.\n\nThe green Now playing badge and the running timer mean PlayCounter is tracking right now. Total playtime and session count go up while you play.",
      },
      {
        id: "games",
        view: "games",
        anchor: a("core-library-demo"),
        additionalAnchors: [a("nav-games")],
        cardPlacement: "below",
        title: "My Games",
        body: "Every game you play shows up here with cover, total playtime, and session count. These two cards are only samples. Right-click any real card to edit it.",
      },
      {
        id: "history",
        view: "history",
        anchor: a("nav-history"),
        title: "My History",
        body: "Search every past session and explore charts of when and how much you play.",
      },
      {
        id: "achievements",
        view: "achievements",
        anchor: a("nav-achievements"),
        title: "Achievements",
        body: "Local milestones unlock as your hours add up - purely for fun.",
      },
      {
        id: "discovered",
        view: "discovered",
        anchor: a("nav-discovered"),
        title: "Discovered",
        body: "Sort out any app PlayCounter couldn't identify: match it to a game, add it yourself, or ignore it. The badge counts what still needs review.",
      },
      {
        id: "settings",
        view: "settings",
        anchor: a("nav-settings"),
        title: "Settings",
        body: "Tune startup, desktop popups, colors, emulators, backups, and updates.",
      },
      {
        id: "help",
        view: "return",
        anchor: a("help"),
        title: "You're set up",
        body: "One thing left worth doing: startup, popups, and appearance are worth a look before you start playing.",
      },
    ],
  },
  {
    id: "log-playtime",
    version: 1,
    kind: "guide",
    title: "Log missed playtime",
    description: "Practice adding a session from a game's right-click menu.",
    duration: "2 min",
    demoGame: true,
    steps: [
      {
        id: "intro",
        view: "games",
        title: "Log playtime by hand",
        body: "We'll use a sample World of Warcraft card. Nothing you do here is saved, and your real games can't be changed while the guide runs.",
      },
      {
        id: "open-menu",
        view: "games",
        interactive: true,
        anchor: a("demo-game-card"),
        allow: [a("demo-game-card")],
        advanceOn: {
          type: "anchor-present",
          selector: a("demo-menu-log-session"),
        },
        skipTo: "alternative",
        title: "Right-click the sample card",
        body: "Every game card has a right-click menu with advanced actions.",
        keyboardHint:
          "Keyboard: focus the card and press Shift+F10 or the Menu key.",
      },
      {
        id: "pick-item",
        view: "games",
        interactive: true,
        anchor: a("demo-menu-log-session"),
        allow: [a("demo-context-menu")],
        advanceOn: {
          type: "anchor-present",
          selector: a("demo-log-session-dialog"),
        },
        retreatWhenMissing: a("demo-context-menu"),
        backTo: "open-menu",
        skipTo: "alternative",
        title: "Choose “Log missed session”",
        body: "For a real game, this adds a session to History and updates charts and achievements.",
      },
      {
        id: "fill-dialog",
        view: "games",
        interactive: true,
        anchor: a("demo-log-session-dialog"),
        allow: [a("demo-log-session-backdrop")],
        advanceOn: { type: "event", name: "mygames.demo-session-logged" },
        retreatWhenMissing: a("demo-log-session-dialog"),
        backTo: "open-menu",
        skipTo: "alternative",
        title: "Enter length and end time",
        body: "Choose how long you played and when the session ended, then press Log session.",
      },
      {
        id: "result",
        view: "games",
        anchor: a("demo-playtime-result"),
        backTo: "open-menu",
        title: "Playtime and session updated",
        body: "The duration you entered was added to the game's total playtime, and one new session was created. For a real game, that session also appears in History and contributes to charts and achievements.",
      },
      {
        id: "alternative",
        view: "games",
        anchor: a("demo-menu-adjust-playtime"),
        backTo: "open-menu",
        title: "Only know a total?",
        body: "Use Adjust total playtime instead when you only know a lifetime total. It corrects the number without inventing history entries. You're now ready to try either option on one of your own games.",
      },
    ],
  },
  {
    id: "fix-detection",
    version: 1,
    kind: "guide",
    title: "Fix an unrecognized game",
    description: "Review and match an executable PlayCounter found.",
    duration: "1 min",
    steps: [
      {
        id: "intro",
        view: "discovered",
        title: "When a game isn't recognized",
        body: "Sometimes PlayCounter needs your help: a file name it has never seen, or one that several games share. We'll use a sample Wow.exe so you can walk through the whole flow without changing your data.",
      },
      {
        id: "filters",
        view: "discovered",
        anchor: a("discovered-filters"),
        title: "Start with Needs review",
        body: "This filter lists apps PlayCounter saw but could not identify. Tracked and Ignored show the rest.",
      },
      {
        id: "wizard",
        view: "discovered",
        anchor: a("discovered-wizard"),
        title: "Discovery Wizard",
        body: "The wizard goes through everything PlayCounter found but couldn't identify - one app at a time.\n\nYou get the file name (here Wow.exe) and whether it's running right now. That's usually enough to answer one question: is this a game?",
      },
      {
        id: "add-share",
        view: "discovered",
        anchor: a("discovered-add-share"),
        title: "Add & Share",
        body: "Pick this when it's a real game. When your game shows up here in Discovered, it means that PlayCounter does not know about the Game yet. By using 'Add & Share', you can improve the PlayCounter database. Click the button, find the right entry in the database and send it in. Once it's approved, everyone's PlayCounter recognizes this file automatically.",
      },
      {
        id: "add-custom",
        view: "discovered",
        anchor: a("discovered-add-custom"),
        title: "Add as Custom",
        body: "Keep the game on this PC only. Best for private builds, mods, prototypes, and anything else that shouldn't become a match for everyone.",
      },
      {
        id: "ignore",
        view: "discovered",
        anchor: a("discovered-ignore"),
        title: "Ignore",
        body: "Use this for launchers, updaters, tools, and anything else that isn't a game. PlayCounter stops asking about it and never tracks it.",
      },
      {
        id: "skip",
        view: "discovered",
        anchor: a("discovered-skip"),
        title: "Skip for now",
        body: "Not sure yet? Leave it open. It stays in Needs review so you can decide later.",
      },
      {
        id: "ambiguous",
        view: "now",
        anchor: a("nav-now"),
        title: "Ambiguous names",
        body: "When one file name could be several games, Now Playing asks which one you started. This happens, when multiple different games use the same name for its executable file.",
      },
    ],
  },
  {
    id: "stats",
    version: 1,
    kind: "guide",
    title: "Read your stats",
    description: "Explore sessions, charts, and milestones.",
    duration: "1 min",
    steps: [
      {
        id: "intro",
        view: "history",
        title: "Your play history",
        body: "Every completed session becomes part of a searchable timeline.",
      },
      {
        id: "sessions",
        view: "history",
        anchor: a("history-toolbar"),
        title: "Find a session",
        body: "Use search and filters to narrow the timeline, then open a game or session for details.",
      },
      {
        id: "charts",
        view: "history",
        anchor: a("history-playtime-chart"),
        title: "See your patterns",
        body: "Playtime over time is your first overview. More charts below reveal your top games, busiest days, and how your habits change.",
      },
      {
        id: "milestones",
        view: "achievements",
        anchor: a("nav-achievements"),
        title: "Track milestones",
        body: "Achievements show what you've unlocked and progress toward what comes next.",
      },
    ],
  },
  {
    id: "settings",
    version: 1,
    kind: "guide",
    title: "Personalize PlayCounter",
    description: "Walk through key settings and adjust them as you go.",
    duration: "2 min",
    steps: [
      {
        id: "intro",
        view: "settings",
        title: "Settings, your way",
        body: "This guide walks through the most useful preferences. Controls inside each highlighted panel stay active, and any changes you make are real and saved immediately.",
      },
      {
        id: "general",
        view: "settings",
        anchor: a("settings-general"),
        interactive: true,
        manualAdvance: true,
        persistentInteraction: true,
        scrollIntoView: true,
        allow: [a("settings-general")],
        title: "General behavior",
        body: "Leave Launch on startup on. PlayCounter can only track while it's running - if it doesn't start with your PC, you lose the playtime of every game you start before opening it.\n\nBelow that you can switch long playtimes to days and hours.",
      },
      {
        id: "appearance",
        view: "settings",
        anchor: a("settings-appearance"),
        interactive: true,
        manualAdvance: true,
        persistentInteraction: true,
        scrollIntoView: true,
        allow: [a("settings-appearance")],
        title: "Choose your accent",
        body: "Pick the accent color used for buttons, highlights, and focus states. Try a color now, or use Reset to return to the PlayCounter default.",
      },
      {
        id: "notifications",
        view: "settings",
        anchor: a("settings-notifications"),
        optional: true,
        interactive: true,
        manualAdvance: true,
        persistentInteraction: true,
        scrollIntoView: true,
        allow: [a("settings-notifications")],
        title: "Desktop popups",
        body: "Short popups on your desktop while you play. Turn the main switch on first, then pick which events are worth a popup: first-time detections, every game start, session summaries, milestones, or new discoveries.",
      },
      {
        id: "sharing",
        view: "settings",
        anchor: a("settings-sharing"),
        interactive: true,
        manualAdvance: true,
        persistentInteraction: true,
        scrollIntoView: true,
        allow: [a("settings-sharing")],
        title: "Help improve detection",
        body: "When you ignore an app PlayCounter doesn't recognize, it sends the file name, your platform, and an anonymous install ID to improve PlayCounter. Playtime and game history are never shared.",
      },
      {
        id: "maintenance",
        view: "settings",
        anchor: a("settings-maintenance"),
        scrollIntoView: true,
        title: "Recovery tools",
        body: "Reset local cache is for stale matches or tracking errors. It clears cached detection data, not your play history. This action stays locked during the guide to prevent an accidental reset.",
      },
      {
        id: "updates",
        view: "settings",
        anchor: a("settings-updates"),
        scrollIntoView: true,
        title: "Keep PlayCounter current",
        body: "Check for updates here whenever you want. Automatic release information and the current installation status are shown in this panel.",
      },
    ],
  },
  {
    id: "backup-data",
    version: 1,
    kind: "guide",
    title: "Back up or move your data",
    description: "Export your PlayCounter data or restore it from a backup.",
    duration: "1 min",
    steps: [
      {
        id: "intro",
        view: "settings",
        title: "Your data stays portable",
        body: "Open Settings and find Backup & transfer whenever you want to protect your local data or move PlayCounter to another PC. This guide explains both actions without opening a file dialog or changing your data.",
      },
      {
        id: "overview",
        view: "settings",
        anchor: a("settings-backup"),
        scrollIntoView: true,
        title: "Backup & transfer",
        body: "This section handles portable JSON backups. A backup contains your play history, the games and matches PlayCounter has cached, your settings, and everything else it keeps on this PC.",
      },
      {
        id: "export",
        view: "settings",
        anchor: a("settings-backup-export"),
        scrollIntoView: true,
        title: "Export your data",
        body: "Choose Export to save the current local data as a JSON file. Keep that file somewhere safe or copy it to the PC where you want to continue using PlayCounter.",
      },
      {
        id: "import",
        view: "settings",
        anchor: a("settings-backup-import"),
        scrollIntoView: true,
        title: "Import a backup",
        body: "Choose Import and select a PlayCounter backup file. Import replaces the current local data; PlayCounter automatically creates a safety backup of the current state first. The button stays locked during this guide to avoid an accidental import.",
      },
    ],
  },
  {
    id: "emulators",
    version: 1,
    kind: "guide",
    title: "Track emulator games",
    description:
      "Learn how PlayCounter detects games running inside emulators.",
    duration: "1 min",
    steps: [
      {
        id: "intro",
        view: "settings",
        title: "Games inside emulators",
        body: "PlayCounter can tell which game is running inside a supported emulator, instead of just logging the emulator itself.\n\nSupported right now:\n\n- Dolphin\n- DOSBox\n\nMissing one? Ask for it via the Feedback button or on Discord.\n\nStart this guide again once PlayCounter has seen an emulator - then it can show you every page.",
      },
      {
        id: "settings",
        view: "settings",
        anchor: a("settings-emulators"),
        title: "Enable emulator detection",
        body: "Turn emulator detection on here. PlayCounter reads the emulator's window title and start-up options on your PC to work out which game is loaded. Only the recognized game name or disc ID is sent to the database - never the full path or the window title.",
      },
      {
        id: "now-emulating",
        view: "keep",
        anchor: a("nav-emulating"),
        optional: true,
        title: "Now Emulating",
        body: "While a supported emulator is running, Now Emulating shows the game PlayCounter found and anything that still needs your confirmation. This entry only appears when there's something to see.",
      },
      {
        id: "library",
        view: "games",
        anchor: a("nav-games"),
        title: "One shared library",
        body: "Completed emulator sessions appear in My Games and History alongside native PC games, with an emulator badge showing where they came from.",
      },
    ],
  },
  {
    id: "source-badges",
    version: 1,
    kind: "guide",
    title: "Understand game badges",
    description:
      "Learn where Community, IGDB, and Custom game data comes from.",
    duration: "1 min",
    demoGame: true,
    steps: [
      {
        id: "intro",
        view: "games",
        title: "Where does game information come from?",
        body: "Badges tell you which source PlayCounter used for a game. We'll show all three on the temporary World of Warcraft card - nothing is added to your library.",
      },
      {
        id: "community",
        view: "games",
        anchor: a("demo-source-community"),
        title: "Community",
        body: "The PlayCounter community database links file names to the right games. Players send in matches that are missing, those get reviewed, and once approved everyone's PlayCounter recognizes the file automatically.",
      },
      {
        id: "igdb",
        view: "games",
        anchor: a("demo-source-igdb"),
        title: "IGDB",
        body: "IGDB is a large public game database. It's where most names and covers come from.\n\nIt doesn't know every release, though - especially older, regional, or unusual ones. When IGDB is wrong or missing something, Community entries fill the gap.",
      },
      {
        id: "custom",
        view: "games",
        anchor: a("demo-source-custom"),
        title: "Custom",
        body: "You added this game yourself. The name and the file it points to stay on this PC, unless you send it to the Community database later.",
      },
    ],
  },
];

export const CORE_TOUR_ID = "core";
export const findTour = (id: string) => TOURS.find((tour) => tour.id === id);
export const guideTours = () => TOURS.filter((tour) => tour.kind === "guide");
