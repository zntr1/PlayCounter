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
        body: "PlayCounter runs in the background, notices when a game starts, and records how long you played - launcher, disc, emulator, or a random .exe.",
      },
      {
        id: "now",
        view: "now",
        anchor: a("now-playing-demo"),
        additionalAnchors: [a("nav-now")],
        cardPlacement: "below",
        title: "Now Playing",
        body: "This simulated World of Warcraft session shows what a real tracked game looks like. The green status and live timer show that PlayCounter is tracking it; total playtime and the session count update along with it.",
      },
      {
        id: "games",
        view: "games",
        anchor: a("core-library-demo"),
        additionalAnchors: [a("nav-games")],
        cardPlacement: "below",
        title: "My Games",
        body: "Your library collects every tracked game with its cover, total playtime and session count. These two cards are examples only; right-click a real card for advanced actions.",
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
        body: "Fix anything PlayCounter couldn't identify: match it, create a custom game, or ignore it. The badge counts what needs review.",
      },
      {
        id: "settings",
        view: "settings",
        anchor: a("nav-settings"),
        title: "Settings",
        body: "Tune startup, overlays, colors, emulators, backups, and updates.",
      },
      {
        id: "help",
        view: "return",
        anchor: a("help"),
        title: "What would you like to do next?",
        body: "You're ready to use PlayCounter. We recommend continuing with Personalize PlayCounter so startup, notifications, appearance, and sharing match your preferences. You can also browse the other task guides or finish here.",
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
        body: "We'll practise on a temporary World of Warcraft card. Nothing is saved, and your real games are locked while the guide runs.",
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
        body: "Even a real game can occasionally need your help when an executable is unknown or ambiguous. We'll reuse a temporary Wow.exe so you can see the complete review flow without changing your data.",
      },
      {
        id: "filters",
        view: "discovered",
        anchor: a("discovered-filters"),
        title: "Start with Needs review",
        body: "This filter lists executables PlayCounter saw but could not identify. Tracked and Ignored show the rest.",
      },
      {
        id: "wizard",
        view: "discovered",
        anchor: a("discovered-wizard"),
        title: "Discovery Wizard",
        body: "The Discovery Wizard walks through open processes that PlayCounter could not identify. It shows the executable name - here Wow.exe - whether it is running, its file path when available, and where you are in the review queue. Use this information to decide what the process represents before choosing an action.",
      },
      {
        id: "add-share",
        view: "discovered",
        anchor: a("discovered-add-share"),
        title: "Add & Share",
        body: "Choose this when the process is a real game that PlayCounter does not know yet. Find the correct database entry and submit it for review. Once approved, this executable can be recognized automatically for other PlayCounter users too - each good suggestion makes detection better for everyone.",
      },
      {
        id: "add-custom",
        view: "discovered",
        anchor: a("discovered-add-custom"),
        title: "Add as Custom",
        body: "Keep the entry only on this PC. This is best for private builds, mods, prototypes, local tools, or unusual exceptions that should not become a community-wide game match.",
      },
      {
        id: "ignore",
        view: "discovered",
        anchor: a("discovered-ignore"),
        title: "Ignore",
        body: "Use this for launchers, updaters, utilities, and anything else that is not a game. PlayCounter stops asking about the process and will not track it as a game.",
      },
      {
        id: "skip",
        view: "discovered",
        anchor: a("discovered-skip"),
        title: "Skip for now",
        body: "Not sure yet? Leave the process undecided. It stays in Needs review so you can make the choice later.",
      },
      {
        id: "ambiguous",
        view: "now",
        anchor: a("nav-now"),
        title: "Ambiguous names",
        body: "When one executable could be several games, Now Playing asks which one you launched.",
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
        body: "Keep Launch on startup enabled - this is strongly recommended. PlayCounter can only notice and track games while it is running, so disabling startup may cause sessions to be missed unless you open the app manually first. You can also choose whether long playtimes are displayed as days and hours.",
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
        title: "Desktop overlays",
        body: "Choose whether PlayCounter may show lightweight overlays and which events deserve one. Enable the main switch first, then select detections, starts, summaries, milestones, or new discoveries to your liking.",
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
        body: "When enabled, ignoring an unrecognized process also shares its executable name, platform, and anonymous install ID for review. Playtime and game history are not included.",
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
        body: "This section handles portable JSON backups. A backup contains your play history, game and executable cache, settings, and other local PlayCounter state.",
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
        body: "PlayCounter can identify the game running inside a supported emulator instead of counting only the emulator itself. Start this guide again after PlayCounter has detected an emulator to see every available page. \n\nCurrently supported emulators are: \n\n- Dolphin\n- DosBox\n\nYou can request more emulators to be supported by using the Feedback button or by Discord.",
      },
      {
        id: "settings",
        view: "settings",
        anchor: a("settings-emulators"),
        title: "Enable emulator detection",
        body: "Emulator detection is enabled here. PlayCounter reads bounded process arguments and window titles locally, then uses recognized content identifiers to find the game. Raw paths and titles are not sent to the API.",
      },
      {
        id: "now-emulating",
        view: "keep",
        anchor: a("nav-emulating"),
        optional: true,
        title: "Now Emulating",
        body: "While a supported emulator is running, Now Emulating shows the game PlayCounter found and any match that still needs your confirmation. This navigation item appears only when it is relevant.",
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
        body: "The PlayCounter community database links executable files to the correct games. Users submit missing matches, they can be reviewed, and approved mappings help future users recognize the same game automatically. This PlayCounter-specific knowledge fills gaps and makes detection better over time.",
      },
      {
        id: "igdb",
        view: "games",
        anchor: a("demo-source-igdb"),
        title: "IGDB",
        body: "IGDB means Internet Game Database. It provides broad game metadata such as names and covers, but it is not complete and does not always know every executable or unusual release. Missing or incorrect information can therefore still happen; Community mappings fill those PlayCounter-specific gaps.",
      },
      {
        id: "custom",
        view: "games",
        anchor: a("demo-source-custom"),
        title: "Custom",
        body: "A Custom game was added locally by you. Its name and executable mapping stay on this PC and are not shared with other PlayCounter users unless you later submit it to the Community database.",
      },
    ],
  },
];

export const CORE_TOUR_ID = "core";
export const findTour = (id: string) => TOURS.find((tour) => tour.id === id);
export const guideTours = () => TOURS.filter((tour) => tour.kind === "guide");
