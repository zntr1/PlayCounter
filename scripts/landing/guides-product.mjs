import { site } from "./site.mjs";

export const productGuides = [
  {
    slug: "total-playtime-across-all-launchers",
    category: "Using PlayCounter",
    title: "See your game playtime across launchers",
    description:
      "Build one PC game library with automatic tracking, Steam, Xbox and Epic imports, clear playtime totals and local session history in PlayCounter.",
    answer:
      "PlayCounter brings your tracked PC games, your Steam, Xbox and Epic playtime and your Battle.net games into My Games. Keep it running while you play, then use the library and history views to see your hours.",
    thumb: "library",
    sections: [
      {
        id: "library",
        title: "Start with one library",
        html: "<ol><li>Install PlayCounter and leave it running. Launch your games from their usual launcher or shortcut.</li><li>Open <strong>My Games</strong> to see recognized games with their covers and recorded hours.</li><li>Use the <strong>Steam</strong>, <strong>Xbox</strong>, <strong>Epic Games</strong> and <strong>Battle.net</strong> sources in the sidebar to import the games and previous playtime you want to include.</li><li>Review uncertain matches before importing. The <strong>All games</strong> tab brings the results together.</li></ol>",
        screenshot: "library",
      },
      {
        id: "imports",
        title: "Bring in earlier hours",
        html: '<p>Steam import reads the available library and playtime from a Steam account on this PC. Xbox import uses a Microsoft sign-in and the playtime that individual games report to Xbox. Epic import uses an Epic sign-in and the playtime Epic recorded. Battle.net import only adds your Battle.net games, without playtime, so you can skip it. These are optional imports; automatic PC tracking does not depend on them.</p><p>PlayCounter does not import historical hours from Battle.net, GOG, EA, Ubisoft or other launchers. Their recognized PC games are still tracked as you play, and you can <a href="/adjust-total-playtime/">set a game’s earlier total yourself</a>. An imported or adjusted total is a starting reference, not a reconstruction of past sessions.</p>',
      },
      {
        id: "totals",
        title: "How playtime totals work",
        html: '<p>Each launcher’s total counts once, and different launchers are added together: hours on Steam and hours on Xbox are separate play. PlayCounter compares that sum with its own total, meaning the sessions it recorded plus any adjustment you made, and shows the higher number.</p><div class="total-example" role="img" aria-label="Example: Steam 100 hours plus Xbox 70 hours makes 170 hours of launcher time. PlayCounter tracked 20 hours. The game shows 170 hours."><div><span>Steam</span><strong>100 h</strong></div><div class="op">+</div><div><span>Xbox</span><strong>70 h</strong></div><div class="op">=</div><div><span>Launchers</span><strong>170 h</strong></div><div class="op">vs</div><div><span>PlayCounter</span><strong>20 h</strong></div><div class="op">→</div><div class="result"><span>Shown</span><strong>170 h</strong></div></div><p>For example, a game with 100 hours reported by Steam, 70 by Xbox and 20 recorded by PlayCounter shows <strong>170 hours</strong>. New sessions still appear in history, but the displayed total stays at 170 until PlayCounter’s own total or an updated import exceeds it.</p><p>Run an import again to refresh the launcher totals. Games matched to the same game identity share a total; review unmatched or ambiguous entries so the correct titles are linked.</p>',
      },
      {
        id: "history",
        title: "Browse your sessions and statistics",
        html: '<p><strong>My Games</strong> offers search, sorting, provider tabs and different library layouts. <strong>My History</strong> shows the sessions PlayCounter recorded, with playtime statistics. Imported historical hours belong in game totals; they are not invented session entries.</p><p>You can <a href="/adjust-total-playtime/">log a missed session or adjust a game’s total</a> when you have earlier time to include. Backups run automatically; export one in Settings before moving to another PC.</p>',
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
    slug: "adjust-total-playtime",
    category: "Using PlayCounter",
    title: "Add hours you played before PlayCounter",
    description:
      "Set a game’s total playtime in PlayCounter when a launcher can’t import it, log a missed session, and undo a change. Step by step with screenshots.",
    answer:
      "Right-click the game in My Games, open Playtime and choose Adjust total playtime. Enter the game’s full total and select Save total. Your history stays unchanged, and new sessions are added on top.",
    thumb: "adjust-menu",
    glance: [
      ["Find the old total", "#find"],
      ["Set it in PlayCounter", "#adjust"],
      ["Or log one session", "#missed"],
    ],
    sections: [
      {
        id: "when",
        title: "When you need this",
        html: "<p>Steam, Xbox and Epic imports bring in playtime automatically. Most other launchers don’t share it, so PlayCounter starts from the sessions it records itself. Set the total yourself when:</p><ul><li>You played a game from Battle.net, GOG, EA, Ubisoft, Riot or itch.io before installing PlayCounter.</li><li>You know a total from somewhere else, like a game’s statistics screen or WoW’s <code>/played</code>.</li><li>A total is wrong and you want to correct it.</li></ul>",
      },
      {
        id: "find",
        title: "Find the total you want to enter",
        html: '<div class="table-wrap"><table><thead><tr><th>Where you played</th><th>Where the number is</th></tr></thead><tbody><tr><td><a href="/check-playtime-battle-net/">Battle.net</a></td><td>No launcher total. Use the game’s own statistics, such as <a href="/check-playtime-world-of-warcraft/">/played in WoW</a>.</td></tr><tr><td><a href="/check-playtime-gog-galaxy/">GOG GALAXY</a></td><td>The game’s page in your GALAXY library.</td></tr><tr><td><a href="/check-playtime-ea-app/">EA app</a></td><td>Menu, then Settings, then My Playtime.</td></tr><tr><td><a href="/check-playtime-ubisoft-connect/">Ubisoft Connect</a></td><td>The game’s statistics, where available.</td></tr><tr><td><a href="/check-playtime-minecraft/">Minecraft Java</a></td><td>Esc, then Statistics, then Time Played, per world.</td></tr><tr><td>Steam, Xbox and Epic Games</td><td>Nothing to do: <a href="/check-playtime-on-steam/">the imports</a> bring the hours in. For Epic, <a href="/check-playtime-epic-games/#import">sign in during the import</a>.</td></tr></tbody></table></div>',
      },
      {
        id: "adjust",
        title: "Set the total",
        steps: [
          {
            title:
              "Right-click the game, then Playtime → Adjust total playtime",
            html: "<p>In <strong>My Games</strong>, right-click the game’s cover. Open <strong>Playtime</strong> and choose <strong>Adjust total playtime</strong>.</p>",
            image: "adjust-menu",
          },
          {
            title: "Enter the full total, then Save total",
            html: "<p>Type the hours and minutes of the <em>complete</em> total, including time PlayCounter already recorded. The dialog shows the time from your sessions for reference.</p>",
            image: "adjust-dialog",
          },
          {
            title: "Check the new total",
            html: "<p>The game card shows the new total right away. Every session you play from now on is added to it.</p>",
            image: "adjust-result",
          },
        ],
        html: "<p>To undo, open the dialog again and choose <strong>Reset to recorded time</strong>. While the game is running, close it first: a total can’t be changed during an active session.</p>",
      },
      {
        id: "missed",
        title: "Or log one missed session",
        intro:
          "<p>If you know when you played, for example on another PC yesterday evening, log it as a session instead. Unlike a total adjustment, it appears in My History and counts for streaks and stats.</p>",
        steps: [
          {
            title: "Right-click the game, then Playtime → Log missed session",
            html: "<p>It sits right above <strong>Adjust total playtime</strong> in the same menu.</p>",
          },
          {
            title: "Enter the length and when it ended, then Log session",
            html: "<p>Choose a playthrough if you use them, then enter hours, minutes and the date and time the session ended.</p>",
            image: "log-session",
          },
        ],
      },
      {
        id: "imports",
        title: "How this works with Steam, Xbox and Epic hours",
        html: '<p>Imported Steam, Xbox and Epic hours are kept per launcher and added together. PlayCounter shows the higher of that sum and its own total, which includes your adjustment. For an imported game, an adjusted total therefore only changes the number when it is higher than the imported hours. <a href="/total-playtime-across-all-launchers/#totals">Totals explained with an example</a>.</p>',
      },
    ],
    sources: [
      {
        label: "PlayCounter: playtime adjustments",
        url: `${site.repository}/blob/v${site.version}/apps/desktop/src/playtimeAdjustments.ts`,
      },
      {
        label: "PlayCounter: imported playtime totals",
        url: `${site.repository}/blob/v${site.version}/apps/desktop/src/library/playtimeFloor.ts`,
      },
    ],
    related: [
      "check-playtime-world-of-warcraft",
      "total-playtime-across-all-launchers",
    ],
  },
  {
    slug: "game-not-detected",
    category: "Using PlayCounter",
    title: "Game not detected? Add it in Discovered",
    description:
      "What to do when PlayCounter doesn’t recognize a game: find it in Discovered, match it with the game database or add it as a custom game.",
    answer:
      "Keep the game running and open Discovered in PlayCounter. Choose Add & Share to match the file with the right game, or Add as Custom to name it yourself. PlayCounter tracks it from then on.",
    thumb: "discovered-queue",
    glance: [
      ["Open Discovered", "#discovered"],
      ["Add & Share", "#share"],
      ["Or add as custom", "#custom"],
    ],
    sections: [
      {
        id: "discovered",
        title: "Find the game in Discovered",
        steps: [
          {
            title: "Start the game, then open Discovered",
            html: "<p>Keep the game running. In PlayCounter, open <strong>Discovered</strong> in the sidebar. Files PlayCounter could not match wait under <strong>Needs review</strong>; a green dot means the file is running right now.</p>",
            image: "discovered",
          },
        ],
      },
      {
        id: "share",
        title: "Match it and share the match",
        steps: [
          {
            title: "Select Add & Share",
            html: "<p>Choose this when the game exists in the game database, even if it is small or new.</p>",
            image: "discovered-queue",
          },
          {
            title: "Search, pick the game, then Add and share",
            html: '<p>Search for the exact title, select the right result and choose <strong>Add and share</strong>. The game is added to My Games right away, and your match goes to the community for review so it can help other players too. <a href="/datenschutz#en">What is shared</a>.</p>',
            image: "discovered-share",
          },
        ],
      },
      {
        id: "custom",
        title: "Or add it as a custom game",
        steps: [
          {
            title: "Select Add as Custom, type a name and Save",
            html: "<p>Use this for mods, private builds or anything you don’t want to share. The game joins My Games under the name you choose and stays on this PC.</p>",
            image: "discovered-custom",
          },
        ],
      },
      {
        id: "tips",
        title: "If the game still doesn’t show up",
        html: "<ul><li>Pick the game’s own file, not a launcher or updater that stays open.</li><li>Generic names like <code>game.exe</code> can belong to many games. PlayCounter may ask you to choose; that choice stays on your PC.</li><li>Just started the game? Select <strong>Scan</strong> at the top of Discovered.</li><li>Browser and cloud-streamed games run inside another app and can’t be told apart automatically. Log those sessions yourself.</li><li>Not a game at all? Choose <strong>Ignore</strong> and it won’t be asked about again.</li></ul>",
      },
    ],
    sources: [
      {
        label: "PlayCounter desktop source and matching behavior",
        url: site.repository,
      },
    ],
    related: ["how-automatic-game-detection-works", "supported-games"],
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
        html: '<p>Open <strong>Discovered</strong> while the game is running. Review the process and choose the correct game, or add a local entry. Select the game process itself rather than a launcher that remains open between sessions. <a href="/game-not-detected/">Step-by-step guide</a>.</p><p>Some games share an executable name with other software. PlayCounter may ask you to pick a match. That choice is saved locally; it does not become an automatic match for everyone else.</p>',
      },
      {
        id: "previous-time",
        title: "Include previous playtime",
        html: '<p>Steam, Xbox and Epic Games have dedicated importers for available earlier hours, and Battle.net games can be imported without hours. For other sources, PlayCounter records sessions from when you start using it. <a href="/adjust-total-playtime/">Add older time yourself</a> with a missed session or a total adjustment.</p><p>A local session measures how long the game process runs. Menus and idle time can be included; it is not a count of active inputs or completed matches.</p>',
      },
    ],
    sources: [
      { label: "PlayCounter desktop source and setup", url: site.repository },
    ],
    thumb: "now",
    related: ["check-playtime-itch-io", "game-not-detected"],
  },
  {
    slug: "playtime-tracker-for-emulators",
    category: "Using PlayCounter",
    title: "Track emulator game playtime with PlayCounter",
    description:
      "Track individual DOSBox, Dolphin and PCSX2 games on Windows. See supported emulators, setup steps and how to review uncertain game matches.",
    answer:
      "PlayCounter has dedicated per-game detection for DOSBox, Dolphin and PCSX2 on Windows. When the emulator exposes recognizable game information, PlayCounter records the game itself with its own cover, total and sessions.",
    thumb: "dosbox",
    sections: [
      {
        id: "supported",
        title: "Supported emulators",
        html: '<div class="table-wrap"><table><thead><tr><th>Emulator</th><th>Games</th><th>Detection</th></tr></thead><tbody><tr><td>DOSBox</td><td>DOS</td><td>Supported DOSBox variants, including DOSBox-X and DOSBox Staging; game information comes from the running emulator.</td></tr><tr><td>Dolphin</td><td>GameCube and Wii</td><td>Game identifiers or recognizable window titles exposed by Dolphin.</td></tr><tr><td>PCSX2</td><td>PlayStation 2</td><td>The disc image PCSX2 has open or was started with, including the game serial in its file name.</td></tr></tbody></table></div><p>This is the current dedicated per-game support list. Other emulator processes can be assigned a local entry, but that alone does not identify each game inside them.</p>',
      },
      {
        id: "setup",
        title: "Start tracking an emulated game",
        html: "<ol><li>Open PlayCounter and keep emulator detection enabled in <strong>Settings</strong>.</li><li>Launch a game in DOSBox, Dolphin or PCSX2 normally.</li><li>Check the emulator’s page, which appears in the PlayCounter sidebar under <strong>Tools</strong>. Recognized content is matched to its game; review any choice the app asks you to confirm.</li><li>Play and close the game as usual. Its recorded time is available in your library and history.</li></ol><p>For DOS games bundled with their own DOSBox copy, launch the game through its normal shortcut. The emulator does not need to have been installed separately.</p>",
      },
      {
        id: "matches",
        title: "Review uncertain matches",
        html: "<p>Detection depends on what the emulator exposes. An empty window title, generic executable or missing game identifier may require a local choice. Use the detected content on the emulator’s page to pick the correct game instead of assigning every game to the emulator executable.</p><p>DOSBox, Dolphin and PCSX2 support does not imply support for every emulator or every game configuration. Check <strong>Now Playing</strong> on your first session to confirm the title being recorded.</p>",
        screenshot: "dosbox",
      },
      {
        id: "data",
        title: "What gets recorded",
        html: '<p>PlayCounter records new local sessions while it is running. It does not import old hours from emulator save files or infer time from save states.</p><p>Emulator detection reads local process details such as command lines, window titles and the game file the emulator has open. Matching may send extracted game identifiers, filenames or titles to the API. Recorded sessions stay on the PC. <a href="/datenschutz#en">Privacy details</a>.</p>',
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
        html: "<p>On Windows, normal game matching uses the executable filename, such as <code>Hades2.exe</code>. PlayCounter uses cached matches and online lookups to find the game name and artwork. It does not upload the full Windows executable path for that lookup.</p><p>Recognition covers games launched through stores, launchers and direct shortcuts. Dedicated DOSBox, Dolphin and PCSX2 adapters also look for the game running inside the emulator.</p>",
      },
      {
        id: "review",
        title: "You choose when a match is unclear",
        html: '<p>A filename is not always unique. If several games are plausible, PlayCounter presents a choice. Review it and select the correct title; ambiguous selections stay local.</p><p>For an unknown process, open <strong>Discovered</strong> to create a local entry or submit a suggested match for community review. You can also exclude a process from tracking. <a href="/game-not-detected/">How to add a game</a>.</p>',
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
      "Understand PlayCounter game detection across Windows launchers, Steam, Xbox, Epic and Battle.net imports, DOSBox, Dolphin and PCSX2, and local matches for unknown games.",
    answer:
      "PlayCounter detects games from their running processes on Windows. There is no required launcher: recognized games from Steam, Epic, Xbox, GOG, EA, Ubisoft, Battle.net and standalone installations can all appear in one library.",
    sections: [
      {
        id: "pc-games",
        title: "PC games across your launchers",
        html: '<p>Launch a game the way you normally do and check <strong>Now Playing</strong>. When PlayCounter recognizes it, tracking starts automatically. Recognition depends on the game executable and the available match, rather than store ownership.</p><p>This is not a promise that every executable already has a match. <a href="/game-not-detected/">Unknown games can be added in Discovered</a>, and ambiguous filenames may need your confirmation. Games streamed to a browser or remote client are not individually identified from the remote game process.</p>',
      },
      {
        id: "importers",
        title: "Imports: Steam, Xbox, Epic and Battle.net",
        html: '<p>Dedicated importers support <strong>Steam</strong>, <strong>Xbox, including available Game Pass history</strong>, and <strong>Epic Games</strong> with playtime, and <strong>Battle.net</strong> for your game list without playtime. The Battle.net import is optional, since its games are tracked without it. Steam reads local account data; Xbox uses a Microsoft sign-in; Epic uses an Epic sign-in for playtime or scans installed games without one; Battle.net scans this PC or uses an optional sign-in. Each lets you review the games before importing.</p><p>Other launchers do not need an importer for new automatic tracking. Importing brings in available earlier totals and does not recreate past sessions. <a href="/adjust-total-playtime/">Set earlier hours yourself</a> where no playtime import exists.</p>',
      },
      {
        id: "emulators",
        title: "Emulated games: DOSBox, Dolphin and PCSX2",
        html: '<p>DOSBox, Dolphin and PCSX2 have dedicated adapters for identifying the game inside the emulator. A recognizable identifier, file or title is needed, and some matches require your review. <a href="/playtime-tracker-for-emulators/">See the emulator guide</a>.</p>',
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
        html: '<p>PlayCounter keeps recorded sessions and history locally. Normal Windows matching sends executable filenames rather than full paths. Emulator matching can send extracted content identifiers or titles. The app automatically sends a pseudonymous installation ID at startup and roughly hourly, including while in the tray; these presence reports do not contain game names or history.</p><p>Steam import reads local files and resolves game IDs online. Optional Xbox import temporarily processes Microsoft authorization and Xbox account game data through the API. Epic import reads installed games on this PC; its optional sign-in runs in a temporary private window, reads your Epic library and playtime, and is ended after the import. Battle.net import reads installed games on this PC; its optional sign-in runs in a temporary private window, and only the game list leaves it. Feedback and match submissions are sent when you choose those actions. The <a href="/datenschutz#en">privacy policy</a> covers these flows and retention.</p>',
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
