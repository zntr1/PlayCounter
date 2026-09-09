import { site } from "./site.mjs";

export const productGuides = [
  {
    slug: "total-playtime-across-all-launchers",
    category: "Using PlayCounter",
    title: "See your game playtime across launchers",
    description:
      "Build one PC game library with automatic tracking, Steam and Xbox imports, clear playtime totals and local session history in PlayCounter.",
    answer:
      "PlayCounter brings your tracked PC games and available Steam and Xbox playtime into My Games. Keep it running while you play, then use the library and history views to see your hours.",
    sections: [
      {
        id: "library",
        title: "Start with one library",
        html: "<ol><li>Install PlayCounter and leave it running. Launch your games from their usual launcher or shortcut.</li><li>Open <strong>My Games</strong> to see recognized games with their covers and recorded hours.</li><li>Use the <strong>Steam</strong> and <strong>Xbox</strong> tabs to import the games and previous playtime you want to include.</li><li>Review uncertain matches before importing. The <strong>All games</strong> tab brings the results together.</li></ol>",
        screenshot: "library",
      },
      {
        id: "imports",
        title: "Bring in earlier hours",
        html: "<p>Steam import reads the available library and playtime from a Steam account on this PC. Xbox import uses a Microsoft sign-in and the playtime that individual games report to Xbox. These are optional imports; automatic PC tracking does not depend on them.</p><p>PlayCounter does not currently import historical hours from Epic, GOG, EA, Ubisoft, Battle.net or other launchers. Their recognized PC games can still be tracked as you play. An imported total is a starting reference, not a reconstruction of past sessions.</p>",
      },
      {
        id: "totals",
        title: "How playtime totals work",
        html: "<p>For a matched game, PlayCounter shows the higher of your local total (including any manual adjustment) and the largest imported provider total. It does not add overlapping launcher totals together.</p><p>For example, a game with 100 hours reported by Steam, 70 by Xbox and 20 recorded locally shows <strong>100 hours</strong>, not 190. New local sessions still appear in history, but the displayed total stays at 100 until the local total or an updated import exceeds it.</p><p>Run an import again to refresh the available provider totals. Games matched to the same game identity share a total; review unmatched or ambiguous entries so the correct titles are linked.</p>",
      },
      {
        id: "history",
        title: "Browse your sessions and statistics",
        html: "<p><strong>My Games</strong> offers search, sorting, provider tabs and different library layouts. <strong>My History</strong> shows the sessions PlayCounter recorded, with playtime statistics. Imported historical hours belong in game totals; they are not invented session entries.</p><p>You can add a session or adjust a game total manually when you have earlier time to include. Export a backup in Settings before moving to another PC.</p>",
        screenshot: "history",
      },
    ],
    sources: [
      {
        label: "PlayCounter: playtime calculation",
        url: `${site.repository}/blob/v${site.version}/apps/desktop/src/playtimeAdjustments.ts`,
      },
      {
        label: "PlayCounter: imported playtime totals",
        url: `${site.repository}/blob/v${site.version}/apps/desktop/src/library/playtimeFloor.ts`,
      },
    ],
    related: ["check-playtime-on-steam", "check-playtime-xbox-game-pass"],
  },
  {
    slug: "track-playtime-outside-steam",
    category: "Using PlayCounter",
    title: "Track PC game playtime outside Steam",
    description:
      "Track games from Epic, GOG, itch.io and standalone Windows executables. Learn how automatic detection, local matches and session history work.",
    answer:
      "PlayCounter tracks recognized running games without needing Steam or a particular launcher. Leave it running and open a game normally, whether from another store, a desktop shortcut or its executable.",
    sections: [
      {
        id: "setup",
        title: "Record your next session",
        html: "<ol><li>Open PlayCounter and start your game as usual.</li><li>Check <strong>Now Playing</strong>. A recognized game appears with a running session timer.</li><li>Finish playing and close the game. The recorded session appears in <strong>My History</strong>, and the game stays in <strong>My Games</strong>.</li></ol><p>PlayCounter can stay in the tray while you play. You do not need to move your library or replace your launcher.</p>",
        screenshot: "now",
      },
      {
        id: "unknown",
        title: "If the game is not recognized",
        html: "<p>Open <strong>Discovered</strong> while the game is running. Review the process and choose the correct game, or add a local entry. Select the game process itself rather than a launcher that remains open between sessions.</p><p>Some games share an executable name with other software. PlayCounter may ask you to pick a match. That choice is saved locally; it does not become an automatic match for everyone else.</p>",
      },
      {
        id: "previous-time",
        title: "Include previous playtime",
        html: "<p>Steam and Xbox have dedicated importers for available earlier hours. For other sources, PlayCounter records sessions from when you start using it, with manual session entries and playtime adjustments available for older time you want to add.</p><p>A local session measures how long the game process runs. Menus and idle time can be included; it is not a count of active inputs or completed matches.</p>",
      },
    ],
    sources: [
      { label: "PlayCounter desktop source and setup", url: site.repository },
    ],
    related: ["check-playtime-itch-io", "how-automatic-game-detection-works"],
  },
  {
    slug: "playtime-tracker-for-emulators",
    category: "Using PlayCounter",
    title: "Track emulator game playtime with PlayCounter",
    description:
      "Track individual DOSBox and Dolphin games on Windows. See supported emulators, setup steps and how to review uncertain game matches.",
    answer:
      "PlayCounter has dedicated per-game detection for DOSBox and Dolphin on Windows. When the emulator exposes recognizable game information, PlayCounter can record the game itself with its own cover, total and sessions.",
    sections: [
      {
        id: "supported",
        title: "Supported emulators",
        html: '<div class="table-wrap"><table><thead><tr><th>Emulator</th><th>Games</th><th>Detection</th></tr></thead><tbody><tr><td>DOSBox</td><td>DOS</td><td>Supported DOSBox variants, including DOSBox-X and DOSBox Staging; game information comes from the running emulator.</td></tr><tr><td>Dolphin</td><td>GameCube and Wii</td><td>Game identifiers or recognizable window titles exposed by Dolphin.</td></tr></tbody></table></div><p>This is the current dedicated per-game support list. Other emulator processes can be assigned a local entry, but that alone does not identify each game inside them.</p>',
      },
      {
        id: "setup",
        title: "Start tracking an emulated game",
        html: "<ol><li>Open PlayCounter and keep emulator detection enabled in <strong>Settings</strong>.</li><li>Launch a game in DOSBox or Dolphin normally.</li><li>Check the emulator view that appears in PlayCounter. Recognized content can be matched to its game; review any choice the app asks you to confirm.</li><li>Play and close the game as usual. Its recorded time is available in your library and history.</li></ol><p>For DOS games bundled with their own DOSBox copy, launch the game through its normal shortcut. The emulator does not need to have been installed separately.</p>",
      },
      {
        id: "matches",
        title: "Review uncertain matches",
        html: "<p>Detection depends on what the emulator exposes. An empty window title, generic executable or missing game identifier may require a local choice. Use the detected content in the emulator view to pick the correct game instead of assigning every game to the emulator executable.</p><p>DOSBox and Dolphin support does not imply support for every emulator or every game configuration. Check <strong>Now Playing</strong> on your first session to confirm the title being recorded.</p>",
      },
      {
        id: "data",
        title: "What gets recorded",
        html: '<p>PlayCounter records new local sessions while it is running. It does not import old hours from emulator save files or infer time from save states.</p><p>Emulator detection reads local process details such as command lines and window titles. Matching may send extracted game identifiers, filenames or titles to the API. Recorded sessions stay on the PC. <a href="/datenschutz#en">Privacy details</a>.</p>',
      },
    ],
    sources: [
      {
        label: "PlayCounter: supported emulator adapters",
        url: `${site.repository}/blob/v${site.version}/apps/desktop/src/emulators/registry.ts`,
      },
      {
        label: "PlayCounter: emulator process detection",
        url: `${site.repository}/blob/v${site.version}/apps/desktop/src-tauri/src/process/emulator.rs`,
      },
    ],
    related: [
      "how-automatic-game-detection-works",
      "total-playtime-across-all-launchers",
    ],
  },
  {
    slug: "how-automatic-game-detection-works",
    category: "Using PlayCounter",
    title: "How PlayCounter detects games automatically",
    description:
      "See how PlayCounter matches running Windows games, records sessions, handles unknown executables and keeps game choices under your control.",
    answer:
      "PlayCounter periodically checks running processes and matches recognized game identifiers. When a game starts, its timer begins; when it closes, the session is saved locally. The launcher you used does not decide whether it can be tracked.",
    sections: [
      {
        id: "matching",
        title: "From a running process to a game",
        html: "<p>On Windows, normal game matching uses the executable filename, such as <code>Hades2.exe</code>. PlayCounter uses cached matches and online lookups to find the game name and artwork. It does not upload the full Windows executable path for that lookup.</p><p>Recognition covers games launched through stores, launchers and direct shortcuts. Dedicated DOSBox and Dolphin adapters also look for the game running inside the emulator.</p>",
      },
      {
        id: "review",
        title: "You choose when a match is unclear",
        html: "<p>A filename is not always unique. If several games are plausible, PlayCounter presents a choice. Review it and select the correct title; ambiguous selections stay local.</p><p>For an unknown process, open <strong>Discovered</strong> to create a local entry or submit a suggested match for community review. You can also exclude a process from tracking.</p>",
      },
      {
        id: "sessions",
        title: "What a session measures",
        html: "<p>A session records the time a matched game process is running. Menus, background windows and idle time can count. PlayCounter does not inspect your inputs to decide whether you are actively playing.</p><p>Leave the app running, including in the tray, to record sessions. Previously recognized games can use local matches when the matching service is unavailable; new lookups need a connection.</p>",
        screenshot: "now",
      },
      {
        id: "privacy",
        title: "Local history, online matching",
        html: '<p>Your recorded sessions, history and settings are stored on your PC. Online features include game matching, metadata, updates and a pseudonymous installation heartbeat. Optional imports and submissions have their own data flows.</p><p>Saved launch paths are a separate local convenience controlled in Settings. See the <a href="/datenschutz#en">privacy policy</a> for matching, emulator and importer details.</p>',
      },
    ],
    sources: [{ label: "PlayCounter desktop source", url: site.repository }],
    related: ["supported-games", "playtime-tracker-for-emulators"],
  },
  {
    slug: "supported-games",
    category: "Using PlayCounter",
    title: "Which games does PlayCounter support?",
    description:
      "Understand PlayCounter game detection across Windows launchers, Steam and Xbox imports, DOSBox and Dolphin, and local matches for unknown games.",
    answer:
      "PlayCounter detects games from their running processes on Windows. There is no required launcher: recognized games from Steam, Epic, Xbox, GOG, EA, Ubisoft, Battle.net and standalone installations can all appear in one library.",
    sections: [
      {
        id: "pc-games",
        title: "PC games across your launchers",
        html: "<p>Launch a game the way you normally do and check <strong>Now Playing</strong>. When PlayCounter recognizes it, tracking starts automatically. Recognition depends on the game executable and the available match, rather than store ownership.</p><p>This is not a promise that every executable already has a match. Unknown games can be added locally, and ambiguous filenames may need your confirmation. Games streamed to a browser or remote client are not individually identified from the remote game process.</p>",
      },
      {
        id: "importers",
        title: "Historical imports: Steam and Xbox",
        html: "<p>Dedicated importers currently support <strong>Steam</strong> and <strong>Xbox, including available Game Pass history</strong>. Steam reads local account data; Xbox uses a Microsoft sign-in. Each lets you review the games before importing.</p><p>Other launchers do not need an importer for new automatic tracking. Importing brings in available earlier totals and does not recreate past sessions.</p>",
      },
      {
        id: "emulators",
        title: "Emulated games: DOSBox and Dolphin",
        html: '<p>DOSBox and Dolphin have dedicated adapters for identifying the game inside the emulator. A recognizable identifier or title is needed, and some matches require your review. <a href="/playtime-tracker-for-emulators/">See the emulator guide</a>.</p>',
      },
      {
        id: "guides",
        title: "Setup for a particular game",
        html: '<p>Some games benefit from a more specific setup: <a href="/check-playtime-minecraft/">Minecraft and shared Java processes</a>, <a href="/check-playtime-roblox/">Roblox client time</a>, and <a href="/check-playtime-riot-games/">Riot game and launcher processes</a>. The <a href="/guides/">guide library</a> includes native playtime instructions and PlayCounter setup for individual launchers.</p>',
      },
    ],
    sources: [
      {
        label: "PlayCounter desktop source and matching behavior",
        url: site.repository,
      },
    ],
    related: [
      "how-automatic-game-detection-works",
      "track-playtime-outside-steam",
    ],
  },
  {
    slug: "is-playcounter-safe",
    category: "Using PlayCounter",
    title: "PlayCounter downloads, source code and privacy",
    description:
      "Find the official PlayCounter download, inspect the desktop source and understand Windows security warnings, local history and online data use.",
    answer:
      "Download PlayCounter from the official zntr1/PlayCounter GitHub releases. The desktop client is open source under the MIT license, and recorded sessions stay on your PC. The app also uses online services for matching, updates and installation presence.",
    sections: [
      {
        id: "download",
        title: "Check your download",
        html: `<p>Use the <a href="${site.releases}">official release page</a> for the Windows installer, release notes and the verification information attached to that release. Avoid repackaged installers from unrelated download sites.</p><p>A checksum can confirm that a downloaded file matches the published file. A signature identifies the publisher; it does not guarantee that software is harmless. Security scan results are additional evidence at a particular point in time.</p>`,
      },
      {
        id: "windows",
        title: "If Windows shows a warning",
        html: "<p>Microsoft Defender SmartScreen considers download and publisher reputation as well as security signals. An unfamiliar app may trigger a warning, but a warning should not automatically be dismissed as a popularity issue.</p><p>Check the download source and file details, read the warning, and inspect the release verification information. If Windows or another security product reports a specific threat, stop and investigate before running it. This page is not an instruction to disable protection.</p>",
      },
      {
        id: "source",
        title: "What is open source?",
        html: `<p>The <a href="${site.repository}">public desktop repository</a> includes the app, process scanner and shared data contracts. The current production API, database migrations and deployment code are maintained privately. The <a href="${site.repository}/blob/v${site.version}/BACKEND.md">repository boundary</a> explains that split.</p><p>Open source gives you code to inspect. It is not a substitute for checking the installer you download.</p>`,
      },
      {
        id: "data",
        title: "What the app sends online",
        html: '<p>PlayCounter keeps recorded sessions and history locally. Normal Windows matching sends executable filenames rather than full paths. Emulator matching can send extracted content identifiers or titles. The app automatically sends a pseudonymous installation ID at startup and roughly hourly, including while in the tray; these presence reports do not contain game names or history.</p><p>Steam import reads local files and resolves game IDs online. Optional Xbox import temporarily processes Microsoft authorization and Xbox account game data through the API. Feedback and match submissions are sent when you choose those actions. The <a href="/datenschutz#en">privacy policy</a> covers these flows and retention.</p>',
      },
    ],
    sources: [
      {
        label: "Microsoft: SmartScreen reputation and app distribution",
        url: "https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation",
      },
      {
        label: "Microsoft: Defender SmartScreen security checks",
        url: "https://learn.microsoft.com/en-us/deployedge/microsoft-edge-security-smartscreen",
      },
    ],
    related: [
      "how-automatic-game-detection-works",
      "total-playtime-across-all-launchers",
    ],
  },
];
