// Published website facts. Update only for a verified public release.
// Desktop development can be ahead of the installer advertised here.
export const site = {
  origin: "https://playcounter.app",
  name: "PlayCounter",
  version: "1.2.0",
  reviewed: "2026-09-24",
  // Set both after the 1.2.0 installer is published: the release date and the
  // byte size of PlayCounter-Setup.exe from the GitHub release. Until then the
  // download line omits the size and the structured data omits the date.
  releaseDate: null,
  installerBytes: null,
  download:
    "https://github.com/zntr1/PlayCounter/releases/latest/download/PlayCounter-Setup.exe",
  releases: "https://github.com/zntr1/PlayCounter/releases/latest",
  repository: "https://github.com/zntr1/PlayCounter",
  discord: "https://discord.gg/t2nG3jaEEY",
  description:
    "Free Windows app that tracks how long you play your PC games, from any launcher, disc or emulator. Import Steam and Xbox hours and your Battle.net games.",
  milestone: "Around 200 users since our launch in June.",
  // The milestone is the owner's approximate cumulative user estimate, September 2026.
  // It is not the presence endpoint's online installation count or a download count.
  steamStatus: "Coming soon to Steam",
  // App views and guide steps, captured from the 1.2.0 UI with an example
  // library. "window" images are full app windows with a 1000px variant;
  // "crop" images are 2x captures and width/height are their display size.
  screenshots: {
    library: {
      kind: "window",
      file: "playcounter-library-v1-2-0.webp",
      small: "playcounter-library-v1-2-0-1000.webp",
      width: 2000,
      height: 1250,
      alt: "PlayCounter My Games in the dark theme: Elden Ring pinned as a banner above game covers with playtime totals, shelves and the Steam, Xbox and Battle.net sources",
    },
    now: {
      kind: "window",
      file: "playcounter-now-playing-v1-2-0.webp",
      small: "playcounter-now-playing-v1-2-0-1000.webp",
      width: 2000,
      height: 1250,
      alt: "PlayCounter Now Playing with a live session timer, total playtime and session count for Cyberpunk 2077",
    },
    history: {
      kind: "window",
      file: "playcounter-history-v1-2-0.webp",
      small: "playcounter-history-v1-2-0-1000.webp",
      width: 2000,
      height: 1250,
      alt: "PlayCounter My History with the playtime of the last 30 days, highlights such as the longest session and best streak, and recorded sessions by day",
    },
    achievements: {
      kind: "window",
      file: "playcounter-achievements-v1-2-0.webp",
      small: "playcounter-achievements-v1-2-0-1000.webp",
      width: 2000,
      height: 1250,
      alt: "PlayCounter Achievements with milestone progress, the next unlocks and lifetime playtime trophies",
    },
    journal: {
      kind: "window",
      file: "playcounter-journal-v1-2-0.webp",
      small: "playcounter-journal-v1-2-0-1000.webp",
      width: 2000,
      height: 1250,
      alt: "PlayCounter game journal for Cyberpunk 2077 with playthroughs, a game note and recorded sessions",
    },
    grid: {
      kind: "window",
      file: "playcounter-library-grid-v1-2-0.webp",
      small: "playcounter-library-grid-v1-2-0-1000.webp",
      width: 2000,
      height: 1334,
      alt: "PlayCounter My Games grid with shelves, Sort: Most played, status badges and games from Steam, Xbox and Battle.net with their total hours",
    },
    dosbox: {
      kind: "window",
      file: "playcounter-dosbox-v1-2-0.webp",
      small: "playcounter-dosbox-v1-2-0-1000.webp",
      width: 2000,
      height: 1250,
      alt: "PlayCounter DOSBox page with playtime across five linked DOS games, including The Ultimate DOOM and Wolfenstein 3D",
    },
    discovered: {
      kind: "window",
      file: "playcounter-discovered-v1-2-0.webp",
      small: "playcounter-discovered-v1-2-0-1000.webp",
      width: 2000,
      height: 1250,
      alt: "PlayCounter Discovered with an unrecognized game file, LanternKeeper.exe, and the actions Add & Share, Add as Custom, Ignore and Skip for now",
    },
    social: {
      file: "playcounter-social-v1-2-0.png",
      width: 1200,
      height: 630,
      alt: "The PlayCounter logo and the line: Every session counts.",
    },
    "battlenet-now": {
      kind: "window",
      file: "guide-battlenet-now-playing-v1-2-0.webp",
      small: "guide-battlenet-now-playing-v1-2-0-1000.webp",
      width: 2000,
      height: 1250,
      alt: "World of Warcraft tracked in Now Playing with a running session timer, while the Battle.net source in the sidebar shows 0 imported games",
    },
    "battlenet-library": {
      kind: "window",
      file: "guide-battlenet-library-v1-2-0.webp",
      small: "guide-battlenet-library-v1-2-0-1000.webp",
      width: 2000,
      height: 1388,
      alt: "My Games with Battle.net selected in the sidebar and the Import from Battle.net button highlighted",
    },
    "battlenet-import": {
      kind: "crop",
      file: "guide-battlenet-import-v1-2-0.webp",
      width: 1170,
      height: 266,
      alt: "The Battle.net importer with the buttons Find installed games and Sign in and find games",
    },
    "battlenet-notice": {
      kind: "crop",
      file: "guide-battlenet-notice-v1-2-0.webp",
      width: 552,
      height: 515,
      alt: "Notice: Battle.net does not provide historical playtime. After importing, right-click a game in My Games and choose Adjust total playtime.",
    },
    "battlenet-review": {
      kind: "crop",
      file: "guide-battlenet-review-v1-2-0.webp",
      width: 1162,
      height: 536,
      alt: "Battle.net games ready to import, with Diablo IV and Overwatch 2 selected and the Import button highlighted",
    },
    "adjust-menu": {
      kind: "crop",
      file: "guide-adjust-menu-v1-2-0.webp",
      width: 630,
      height: 517,
      alt: "Right-click menu of a game in My Games with Playtime open and Adjust total playtime highlighted",
    },
    "adjust-dialog": {
      kind: "crop",
      file: "guide-adjust-dialog-v1-2-0.webp",
      width: 488,
      height: 701,
      alt: "Adjust total playtime for World of Warcraft: Midnight, with 317 hours and 5 minutes entered as the new total",
    },
    "adjust-result": {
      kind: "crop",
      file: "guide-adjust-result-v1-2-0.webp",
      width: 305,
      height: 481,
      alt: "The World of Warcraft: Midnight card in My Games now showing 317h 5m in 18 sessions",
    },
    "log-session": {
      kind: "crop",
      file: "guide-log-session-v1-2-0.webp",
      width: 488,
      height: 799,
      alt: "Log a missed session with a session length of 2 hours 30 minutes and the date and time it ended",
    },
    "discovered-queue": {
      kind: "crop",
      file: "guide-discovered-queue-v1-2-0.webp",
      width: 771,
      height: 472,
      alt: "Discovered review card for LanternKeeper.exe, running right now, with Add & Share highlighted",
    },
    "discovered-share": {
      kind: "crop",
      file: "guide-discovered-share-v1-2-0.webp",
      width: 936,
      height: 717,
      alt: "Suggest community game with the search result Tiny Lantern Keeper selected and Add and share highlighted",
    },
    "discovered-custom": {
      kind: "crop",
      file: "guide-discovered-custom-v1-2-0.webp",
      width: 771,
      height: 571,
      alt: "Add as Custom with the name Tiny Lantern Keeper entered and Save highlighted",
    },
    "steam-import": {
      kind: "crop",
      file: "guide-steam-import-v1-2-0.webp",
      width: 1170,
      height: 236,
      alt: "Steam importer with a local Steam account selected and Find games highlighted",
    },
    "xbox-import": {
      kind: "crop",
      file: "guide-xbox-import-v1-2-0.webp",
      width: 1170,
      height: 267,
      alt: "Xbox importer with Sign in and find games highlighted",
    },
  },
  importers: [
    {
      id: "steam",
      name: "Steam",
      logo: "/brands/steam.svg",
      method: "From Steam on this PC",
      brings: "Games + your Steam hours",
      detail:
        "Choose a local Steam account, review its games and import them with the playtime Steam recorded. No extra sign-in.",
      guide: "/check-playtime-on-steam/",
      guideLabel: "Import Steam playtime",
    },
    {
      id: "xbox",
      name: "Xbox & PC Game Pass",
      logo: "/brands/xbox.svg",
      method: "With Microsoft sign-in",
      brings: "Games + your Xbox hours",
      detail:
        "Review games from your Xbox account and import the playtime Xbox reports for them. You choose what to keep.",
      guide: "/check-playtime-xbox-game-pass/",
      guideLabel: "Import Xbox playtime",
    },
    {
      id: "battlenet",
      name: "Battle.net",
      logo: "/brands/battlenet.svg",
      method: "Optional · tracking works without it",
      brings: "Game list only · no playtime",
      isNew: true,
      detail:
        "Battle.net shares no playtime, so there is nothing to bring over but your game list. You can skip it: start your games from Battle.net and PlayCounter tracks them anyway. Set earlier hours yourself, for example from WoW’s /played.",
      guide: "/check-playtime-battle-net/",
      guideLabel: "Track Battle.net games",
    },
  ],
  emulators: [
    {
      id: "dosbox",
      name: "DOSBox",
      logo: "/brands/dosbox.png",
      systems: "DOS games",
      detail:
        "Recognize games running in supported DOSBox variants, including DOSBox-X and DOSBox Staging.",
    },
    {
      id: "dolphin",
      name: "Dolphin",
      logo: "/brands/dolphin.svg",
      systems: "GameCube & Wii",
      detail:
        "Track individual games when Dolphin provides a recognizable game identifier or window title.",
    },
    {
      id: "pcsx2",
      name: "PCSX2",
      logo: "/brands/pcsx2.png",
      systems: "PlayStation 2",
      detail:
        "Track individual PS2 games from the disc image PCSX2 has open or the file it was started with.",
    },
  ],
};

export const mergedPages = {
  "game-time-tracker-windows": "/",
  "how-much-time-do-i-spend-gaming":
    "/total-playtime-across-all-launchers/#totals",
};
export const retiredPages = [
  "playcounter-vs-playnite",
  "best-free-game-playtime-trackers",
  "steam-replay-alternative",
];

export const faq = [
  [
    "Is PlayCounter free?",
    "Yes. The Windows app is free, and the desktop source is available under the MIT license. There is no subscription or PlayCounter account to create.",
  ],
  [
    "Do I need to launch my games through PlayCounter?",
    'No. Keep PlayCounter running, including in the system tray, and launch games as usual. It records recognized games automatically, regardless of launcher. If a game is not recognized, add it in Discovered. <a href="/game-not-detected/">How to add a game</a>.',
  ],
  [
    "Can I bring in hours from before I installed it?",
    'Yes. Steam and Xbox imports bring in the playtime those services report. For Battle.net and every other launcher, set a game’s earlier total yourself with Adjust total playtime. Neither creates past sessions in your history. <a href="/adjust-total-playtime/">How to set a total</a>.',
  ],
  [
    "Which emulators are supported?",
    'Dedicated per-game detection supports DOSBox, Dolphin and PCSX2. Recognition depends on the game information the emulator exposes; uncertain matches can be reviewed. <a href="/playtime-tracker-for-emulators/">Emulator setup and limits</a>.',
  ],
  [
    "What stays on my PC, and what goes online?",
    'Your recorded sessions and history stay on your PC. Game matching uses online identifier lookups, and the app sends a pseudonymous installation heartbeat. Imports look up game IDs; the optional Xbox and Battle.net sign-ins have their own data flows. Emulator matching can send game identifiers or titles. <a href="/datenschutz#en">Read the privacy policy</a>.',
  ],
  [
    "Is PlayCounter coming to Steam?",
    "Yes, PlayCounter is coming to Steam soon. Until then, download the Windows installer here.",
  ],
  [
    "Does it work on macOS, Linux or consoles?",
    "The public installer is for Windows. PlayCounter records games running on that PC. Xbox import can include account playtime reported for other devices; it does not add live console tracking.",
  ],
];
