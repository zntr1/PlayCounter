import type { ViewId } from "../../store";

export type TourAdvance =
  | { type: "anchor-present"; selector: string }
  | {
      type: "event";
      name: "mygames.demo-session-logged" | "mygames.demo-launch-attempted";
    };

export type TourEventName = Extract<TourAdvance, { type: "event" }>["name"];

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
    id: "launch-games",
    version: 1,
    kind: "guide",
    title: "Launch games directly",
    description:
      "Turn on direct launching, see how it works, and try the controller flow.",
    duration: "2 min",
    demoGame: true,
    steps: [
      {
        id: "intro",
        view: "settings",
        anchor: a("settings-launcher"),
        scrollIntoView: true,
        title: "PlayCounter can start games too",
        body: "This is optional and off by default. Turn it on and PlayCounter remembers a game's program file, then shows a Play button in My Games.",
      },
      {
        id: "enable",
        view: "settings",
        anchor: a("settings-launcher"),
        interactive: true,
        manualAdvance: true,
        persistentInteraction: true,
        scrollIntoView: true,
        allow: [a("settings-launcher")],
        title: "Choose whether to enable it",
        body: "The switch is real and saves right away. You can also leave it off and keep following this guide.",
      },
      {
        id: "learned",
        view: "games",
        anchor: a("demo-launch-play"),
        title: "PlayCounter learns launch files locally",
        body: "Start a game normally once and after that, you can use PlayCounter to launch that game.",
      },
      {
        id: "set-forget",
        view: "games",
        anchor: a("demo-menu-launch-file"),
        retreatWhenMissing: a("demo-context-menu"),
        backTo: "learned",
        title: "Change or forget a launch file",
        body: "Right-click a game to set a different .exe. If a saved file goes missing, PlayCounter quietly removes the broken Play option until you set a new one.",
      },
      {
        id: "limits",
        view: "settings",
        anchor: a("settings-launcher"),
        scrollIntoView: true,
        title: "Some games still need their usual launcher",
        body: "PlayCounter starts the .exe directly, so games that need Steam, Epic, or extra startup steps may only work from their normal launcher.",
      },
      {
        id: "privacy",
        view: "settings",
        anchor: a("settings-launcher"),
        scrollIntoView: true,
        title: "Paths stay on this PC",
        body: "Saved launch paths never leave your device and aren't included in backups. Turn the feature off anytime, or use Forget all launch files to clear them without touching your games or history.",
      },
      {
        id: "controller",
        view: "settings",
        anchor: a("settings-launcher"),
        scrollIntoView: true,
        title: "Optional controller navigation",
        body: "Turn on Controller navigation to move around PlayCounter with an controller. To bring PlayCounter to the front, hold Select/View + R1/RB a few seconds and then release.",
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
    id: "game-actions",
    version: 1,
    kind: "guide",
    title: "Manage a game in your library",
    description: "Everything in a game's right-click menu.",
    duration: "2 min",
    demoGame: true,
    steps: [
      {
        id: "intro",
        view: "games",
        anchor: a("demo-game-card"),
        title: "More actions for every game",
        body: "Every card in My Games has a right-click menu. It's where you fix playtime, correct a wrong match, or get rid of a game.\n\nWe'll use a sample card, so nothing in your library can change.",
      },
      {
        id: "open-menu",
        view: "games",
        interactive: true,
        anchor: a("demo-game-card"),
        allow: [a("demo-game-card")],
        advanceOn: {
          type: "anchor-present",
          selector: a("demo-menu-show-history"),
        },
        skipTo: "history",
        title: "Right-click the sample card",
        body: "Which items you get depends on where the game came from. This sample is a community match, so you see what a matched game offers. A game you added yourself has a few different items.",
      },
      {
        id: "history",
        view: "games",
        anchor: a("demo-menu-show-history"),
        retreatWhenMissing: a("demo-context-menu"),
        backTo: "open-menu",
        title: "See only this game's sessions",
        body: "Show History jumps to My History with this game already filtered. Nothing is changed - it's just a different view.",
      },
      {
        id: "playtime",
        view: "games",
        anchor: a("demo-menu-log-session"),
        additionalAnchors: [a("demo-menu-adjust-playtime")],
        retreatWhenMissing: a("demo-context-menu"),
        backTo: "open-menu",
        title: "Add playtime that's missing",
        body: "Log missed session adds one session with the date and length you enter. Adjust total playtime changes only the lifetime number - useful when you carry a total over from a launcher.",
      },
      {
        id: "matches",
        view: "games",
        anchor: a("demo-menu-check-matches"),
        retreatWhenMissing: a("demo-context-menu"),
        backTo: "open-menu",
        title: "Look the game up again",
        body: "'Check for Matches' searches IGDB and the Community database for this file name one more time. Worth trying when a game wasn't found before - a match may have been added since, and a custom game can turn into a real one.",
      },
      {
        id: "wrong-match",
        view: "games",
        anchor: a("demo-menu-report-match"),
        additionalAnchors: [a("demo-menu-convert-custom")],
        retreatWhenMissing: a("demo-context-menu"),
        backTo: "open-menu",
        title: "Fix a wrong match",
        body: "Report Wrong Match asks what the app really is - a different game, or no game at all - and sends that in for review. Convert to Custom Game keeps it here under a name you pick yourself.",
      },
      {
        id: "copy",
        view: "games",
        anchor: a("demo-menu-copy-name"),
        additionalAnchors: [a("demo-menu-copy-exe")],
        retreatWhenMissing: a("demo-context-menu"),
        backTo: "open-menu",
        title: "Copy a name",
        body: "Copy Game Name and Copy File Name put the name on your clipboard - useful when you report a problem to us.",
      },
      {
        id: "remove",
        view: "games",
        anchor: a("demo-menu-remove"),
        retreatWhenMissing: a("demo-context-menu"),
        backTo: "open-menu",
        title: "Remove is not the same as ignore",
        body: "Remove from Library takes the game out of My Games and asks whether to keep its sessions. It comes back the next time you play it.\n\nIgnore Game does the same, and blocks the file on top - so PlayCounter never picks it up again.",
      },
    ],
  },
  {
    id: "fix-detection",
    version: 1,
    kind: "guide",
    title: "Fix an unrecognized game",
    description: "Review and match an app PlayCounter found.",
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
        body: "Pick this when it's a real game. Everything listed in Discovered is a file PlayCounter doesn't know yet. Click the button, find the right game in the database and send it in. Once it's approved, everyone's PlayCounter recognizes this file automatically.",
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
        title: "When one name fits several games",
        body: "When a file name could belong to several games, Now Playing asks which one you started. That happens when different games ship a program file with the same name.",
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
    version: 2,
    kind: "guide",
    title: "Track emulator games",
    description:
      "Learn how PlayCounter detects games running inside emulators.",
    duration: "2 min",
    steps: [
      {
        id: "intro",
        view: "settings",
        title: "Games inside emulators",
        body: "PlayCounter can tell which game is running inside a supported emulator, instead of just logging the emulator itself.\n\nSupported right now:\n\n- Dolphin\n- DOSBox\n\nMissing one? Ask for it via the Feedback button or on Discord.\n\nThis guide uses a sample Dolphin setup. Nothing here is real: no sample can be changed, shared, or deleted, and every button on it is switched off.",
      },
      {
        id: "settings",
        view: "settings",
        anchor: a("settings-emulators"),
        scrollIntoView: true,
        title: "Enable emulator detection",
        body: "Turn emulator detection on here. PlayCounter reads the emulator's window title and start-up options on your PC to work out which game is loaded. Only the recognized game name or disc ID is sent to the database - never the full path or the window title.\n\nEvery emulator PlayCounter has already seen is listed below the switches. That's also where you can ignore one again.",
      },
      {
        id: "menu",
        view: "keep",
        anchor: a("nav-emulators"),
        title: "Two kinds of entry in this section",
        body: "Dolphin, DOSBox, and any other emulator page is added the first time PlayCounter sees that emulator running on your PC - and then it stays, whether or not anything is running. On a fresh install you won't find one here yet.\n\nNow Emulating works differently: it appears while an emulator is actually running. If the emulator stops while you are on that view, it stays in the menu until you leave it.\n\nThe whole section is hidden while emulator detection is off, or while every emulator you've seen is ignored. For this guide we're showing a Dolphin example, even if you have never started it.",
      },
      {
        id: "now-emulating",
        view: "emulating",
        anchor: a("demo-emulator-now"),
        additionalAnchors: [a("nav-emulating")],
        cardPlacement: "below",
        title: "Now Emulating: what's running right now",
        body: "This is a sample session, not a real one.\n\nNow Emulating is the live view. It shows the game currently loaded in your emulator, with a running timer and a badge for the emulator and the file it came from.\n\nIt normally only appears while something is running. If PlayCounter can't tell which game is loaded, it asks you right here and you pick the game once.",
      },
      {
        id: "emulator-page",
        view: "dolphin",
        anchor: a("nav-dolphin"),
        title: "The Dolphin page stays",
        body: "PlayCounter added this page the first time it saw Dolphin running, and it stays in the menu from then on - nothing has to be running to open it.\n\nThis is where that emulator's playtime, its sessions, and all of its game matches live.",
      },
      {
        id: "linked-games",
        view: "dolphin",
        anchor: a("demo-emulator-linked"),
        cardPlacement: "below",
        title: "Your linked games",
        body: "One row per game PlayCounter connected to a file or disc ID inside Dolphin. This row is a sample. Once a game is linked, PlayCounter recognizes it automatically every time you start it - you are never asked twice.",
      },
      {
        id: "confirm",
        view: "dolphin",
        anchor: a("demo-emulator-confirm"),
        additionalAnchors: [a("demo-emulator-check-badge")],
        title: "Check this once",
        body: "When PlayCounter matches a game automatically, check whether the game name it found is the game you just started. If it is, press Looks right and the note disappears.\n\nOn the sample the button is switched off - try it on your own games later.",
      },
      {
        id: "fix-match",
        view: "dolphin",
        anchor: a("demo-emulator-actions"),
        title: "Correct, drop, or share a match",
        body: "Change game replaces a wrong match - search once and it sticks. Forget game makes PlayCounter ask again the next time that game shows up; recorded playtime stays in History. Share match sends the file-to-game link to the Community database, so other people's PlayCounter recognizes it too.\n\nAll three are switched off on this sample row, so nothing can be changed, shared, or deleted while you're here.",
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
    description: "Learn how PlayCounter recognized each of your games.",
    duration: "1 min",
    demoGame: true,
    steps: [
      {
        id: "intro",
        view: "games",
        title: "How was this game recognized?",
        body: "A badge tells you how PlayCounter connected the file you started to a game. There are three ways, and we'll show all of them on this sample card - nothing is added to your library.",
      },
      {
        id: "community",
        view: "games",
        anchor: a("demo-source-community"),
        title: "Community",
        body: "The PlayCounter community database links file names to the right games. You can share a match that's missing - once it's reviewed and approved, everyone's PlayCounter recognizes that file automatically.",
      },
      {
        id: "igdb",
        view: "games",
        anchor: a("demo-source-igdb"),
        title: "IGDB",
        body: "IGDB is a large public game database. Some of its entries record the name of the game's .exe file - bg3.exe for Baldur's Gate 3, for example. When it's there, PlayCounter finds the game right away.\n\nPlenty of entries don't have it, though. That's the gap the Community database fills.",
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
