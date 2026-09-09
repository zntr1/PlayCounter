// Published website facts. Update only for a verified public release.
// Desktop development can be ahead of the installer advertised here.
export const site = {
  origin: "https://playcounter.app",
  name: "PlayCounter",
  version: "1.1.16",
  reviewed: "2026-09-08",
  releaseDate: "2026-09-08",
  installerBytes: 4134128,
  download:
    "https://github.com/zntr1/PlayCounter/releases/latest/download/PlayCounter-Setup.exe",
  releases: "https://github.com/zntr1/PlayCounter/releases/latest",
  repository: "https://github.com/zntr1/PlayCounter",
  discord: "https://discord.gg/t2nG3jaEEY",
  description:
    "Free automatic playtime tracking for Windows, across launchers and standalone games. Import available Steam and Xbox hours and track supported emulated games.",
  milestone: "Around 200 users since our launch in June.",
  // The milestone is the owner's approximate cumulative user estimate, September 2026.
  // It is not the presence endpoint's online installation count or a download count.
  screenshots: {
    library: {
      file: "playcounter-library-v1-1-16.jpg",
      width: 1440,
      height: 900,
      alt: "PlayCounter My Games with game covers, playtime totals and Steam and Xbox tabs",
    },
    now: {
      file: "playcounter-now-playing-v1-1-16.jpg",
      width: 1440,
      height: 760,
      alt: "PlayCounter Now Playing with an automatic session timer and total hours for Cyberpunk 2077",
    },
    history: {
      file: "playcounter-history-v1-1-16.jpg",
      width: 1440,
      height: 820,
      alt: "PlayCounter My History showing recorded game sessions with their start times and durations",
    },
    steam: {
      file: "playcounter-steam-import-v1-1-16.jpg",
      width: 1440,
      height: 900,
      alt: "PlayCounter Steam import with a local account selector and Find games button",
    },
    social: {
      file: "playcounter-social-v1-1-16.jpg",
      width: 1200,
      height: 630,
      alt: "The PlayCounter desktop app showing a running game and its playtime",
    },
  },
  importers: [
    {
      id: "steam",
      name: "Steam",
      logo: "/brands/steam.svg",
      method: "From Steam on this PC",
      detail:
        "Choose a local Steam account, review its games and import the available playtime. No extra sign-in.",
      guide: "/check-playtime-on-steam/",
    },
    {
      id: "xbox",
      name: "Xbox & PC Game Pass",
      logo: "/brands/xbox.svg",
      method: "With Microsoft sign-in",
      detail:
        "Review games from your Xbox account and import playtime where the game reports it. You choose what to keep.",
      guide: "/check-playtime-xbox-game-pass/",
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
    "No. Keep PlayCounter running, including in the system tray, and launch games as usual. It records recognized games automatically, regardless of launcher. You can review unknown games in Discovered.",
  ],
  [
    "Can I bring in hours from before I installed it?",
    'Yes. Steam and Xbox imports bring in available previous playtime. Imported totals do not recreate past sessions. New local sessions are recorded while PlayCounter is running. <a href="/total-playtime-across-all-launchers/#totals">How totals work</a>.',
  ],
  [
    "Which emulators are supported?",
    'Dedicated per-game detection currently supports DOSBox and Dolphin. Recognition depends on the game information the emulator exposes; uncertain matches can be reviewed. <a href="/playtime-tracker-for-emulators/">Emulator setup and limits</a>.',
  ],
  [
    "What stays on my PC, and what goes online?",
    'Your recorded sessions and history stay on your PC. Game matching uses online identifier lookups; the app also sends a pseudonymous installation heartbeat. Steam import looks up game IDs, and optional Xbox import temporarily processes account data through the API. Emulator matching can send game identifiers or titles. <a href="/datenschutz#en">Read the privacy policy</a>.',
  ],
  [
    "Does it work on macOS, Linux or consoles?",
    "The public installer is for Windows. PlayCounter records games running on that PC. Xbox import can include account playtime reported for other devices; it does not add live console tracking.",
  ],
];
