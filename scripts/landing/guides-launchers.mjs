import { site } from "./site.mjs";

export const launcherGuides = [
  {
    slug: "check-playtime-on-steam",
    category: "Launcher guides",
    title: "Check and import your Steam playtime",
    description:
      "Find your Steam game hours and import available playtime into PlayCounter from a local Steam account, without another sign-in.",
    answer:
      "In Steam, open your Library and select a game to see its playtime. To bring available Steam hours into PlayCounter, open My Games, choose Steam and select Import from Steam.",
    sections: [
      {
        id: "steam",
        title: "Find hours in Steam",
        html: "<p>Select a game in the Steam desktop Library and look for its playtime near the play controls. Your Steam profile also has a games list with playtime information; visibility to other people depends on your privacy settings.</p><p>A private profile does not need to be made public for PlayCounter’s local Steam importer. It reads Steam data already available on your PC.</p>",
      },
      {
        id: "import",
        title: "Import into PlayCounter",
        intro:
          "<p>Worth doing once: the import brings in the playtime Steam recorded, so your totals start with your real hours instead of zero. New Steam sessions are tracked either way, with or without an import.</p>",
        steps: [
          {
            title: "Open Steam in My Games",
            html: "<p>In the sidebar under <strong>My Games</strong>, select <strong>Steam</strong>, then <strong>Import from Steam</strong>. After your first import, the button says <strong>Import more from Steam</strong>.</p>",
          },
          {
            title: "Pick your Steam account, then Find games",
            html: "<p>PlayCounter lists the Steam accounts that signed in on this PC. It reads Steam data already on your PC, so there is no password and no extra sign-in.</p>",
            image: "steam-import",
          },
          {
            title: "Review and import",
            html: "<p>Confirm any uncertain matches, keep the games you want and import them. They arrive with the playtime Steam reports.</p>",
          },
        ],
      },
      {
        id: "missing-time",
        title: "If a game or its hours are missing",
        html: '<p>Check that you selected the right local Steam account. Open Steam online and let it refresh, then run the import again. The importer can only use data Steam has made available locally; an absent value is not proof that you never played the game.</p><p>Imported hours do not create old sessions in <strong>My History</strong>. For a matched game, PlayCounter compares the imported launcher hours with the time it tracked itself and shows the higher number, so overlapping hours are not counted twice. <a href="/total-playtime-across-all-launchers/#totals">See an example</a>.</p>',
      },
      {
        id: "new-sessions",
        title: "Record new Steam sessions automatically",
        html: "<p>Keep PlayCounter running and launch games through Steam normally. Recognized game processes get a local session timer and history. Import is optional for this tracking; repeat an import when you want to refresh the available Steam totals.</p>",
      },
    ],
    sources: [
      {
        label: "Valve: Steam game privacy and playtime visibility",
        url: "https://help.steampowered.com/en/faqs/view/1150-C06F-4D62-4966",
      },
      {
        label: "PlayCounter: local Steam importer",
        url: `${site.repository}/blob/v${site.version}/apps/desktop/src/library/providers/steam.ts`,
      },
    ],
    thumb: "steam-import",
    related: [
      "total-playtime-across-all-launchers",
      "check-playtime-xbox-game-pass",
    ],
  },
  {
    slug: "check-playtime-xbox-game-pass",
    category: "Launcher guides",
    title: "Check Xbox and PC Game Pass playtime",
    description:
      "Find Xbox time-played statistics, import available Xbox and Game Pass hours into PlayCounter, and record new PC sessions automatically.",
    answer:
      "Xbox exposes time-played statistics for games that report them. PlayCounter can import available Xbox account playtime through a Microsoft sign-in, and automatically track recognized Game Pass games running on your Windows PC.",
    sections: [
      {
        id: "xbox",
        title: "Check the game’s Xbox statistics",
        html: '<p>Open the game’s achievements and statistics on Xbox and look for <strong>Time played</strong>. The <a href="https://support.xbox.com/en-US/help/games-apps/my-games-apps/time-played">Xbox time-played help page</a> gives the current navigation for supported devices.</p><p>Availability depends on the game and what it reports. A missing time value does not necessarily mean zero playtime. Account totals can include play on other Xbox-connected devices.</p>',
      },
      {
        id: "import",
        title: "Import Xbox hours into PlayCounter",
        intro:
          "<p>Worth doing if Xbox has hours you want to keep: the import brings in the playtime Xbox reports for your games. New PC Game Pass sessions are tracked either way, with or without an import.</p>",
        steps: [
          {
            title: "Open Xbox in My Games",
            html: "<p>In the sidebar under <strong>My Games</strong>, select <strong>Xbox</strong>, then <strong>Import from Xbox</strong>.</p>",
          },
          {
            title: "Select Sign in and find games",
            html: "<p>The Microsoft sign-in opens in your browser. Use the account that belongs to your Xbox gamertag. If you are not sure which one it is, copy the sign-in link and open it in a private browser window.</p>",
            image: "xbox-import",
          },
          {
            title: "Confirm the games and import",
            html: "<p>Back in PlayCounter, review the detected games and confirm the correct game where a match is needed. Import your selection; available Xbox playtime is included in the game totals.</p>",
          },
        ],
        html: '<p>PlayCounter does not see your Microsoft password. The API temporarily handles authorization and Xbox game data for the import; the sign-in is discarded afterward. <a href="/datenschutz#en">Import privacy details</a>.</p>',
      },
      {
        id: "tracking",
        title: "Track new PC Game Pass sessions",
        html: '<p>Leave PlayCounter running and launch your installed game from the Xbox app or a shortcut. A recognized process is tracked automatically, even without an Xbox import.</p><p>Imported account hours and local PC sessions are different records. PlayCounter does not monitor a console or identify the individual game inside a cloud-streaming client. <a href="/total-playtime-across-all-launchers/#totals">How imported and local totals combine</a>.</p>',
      },
      {
        id: "review",
        title: "If a match needs your attention",
        html: "<p>Review the game title before accepting an import match. Different Xbox releases can share similar names, and some Windows games use generic executable names. A local match choice helps identify your installation without turning that ambiguous filename into a match for everyone.</p>",
      },
    ],
    sources: [
      {
        label: "Xbox Support: time played",
        url: "https://support.xbox.com/en-US/help/games-apps/my-games-apps/time-played",
      },
      {
        label: "PlayCounter: Xbox importer",
        url: `${site.repository}/blob/v${site.version}/apps/desktop/src/library/providers/xbox.ts`,
      },
    ],
    thumb: "xbox-import",
    related: ["check-playtime-on-steam", "total-playtime-across-all-launchers"],
  },
  {
    slug: "check-playtime-epic-games",
    category: "Launcher guides",
    title: "How to check playtime in Epic Games",
    description:
      "Find hours played in the Epic Games Launcher and record new Epic game sessions alongside your other PC games with PlayCounter.",
    answer:
      "Open the Epic Games Launcher Library, use a game’s three-dot menu and look for You’ve Played. You can also switch the library to list view to see Time Played.",
    sections: [
      {
        id: "epic",
        title: "Find your Epic game hours",
        html: '<ol><li>Open the <strong>Epic Games Launcher</strong> and choose <strong>Library</strong>.</li><li>Find the game and open its <strong>three-dot menu</strong>.</li><li>Look for <strong>You’ve Played</strong>. For a list of games, switch the library to <strong>list view</strong> and check <strong>Time Played</strong>.</li></ol><p>These are the hours recorded by Epic. For Fortnite, use the same library view; <a href="/check-playtime-fortnite/">see the Fortnite guide</a> for PC and account scope.</p>',
      },
      {
        id: "sessions",
        title: "Keep a local session history with PlayCounter",
        html: '<ol><li>Open PlayCounter before starting your Epic game.</li><li>Launch the game from Epic as usual.</li><li>Check <strong>Now Playing</strong> to confirm the matched title.</li><li>After closing the game, open <strong>My History</strong> for the recorded session and <strong>My Games</strong> for its total.</li></ol><p>If the game is unknown or the title is wrong, review its process in <strong>Discovered</strong>. You can choose a local match. <a href="/game-not-detected/">How to add a game</a>.</p>',
      },
      {
        id: "previous",
        title: "What happens to earlier Epic hours?",
        html: '<p>There is currently no Epic importer in PlayCounter. New tracking works without one. To include your Epic hours from before, copy the Time Played value into <a href="/adjust-total-playtime/">Adjust total playtime</a>; it does not recreate earlier session dates.</p><p>Steam and Xbox imports bring in playtime. The Battle.net import only adds a game list. All three are optional additions to automatic tracking across launchers.</p>',
      },
    ],
    sources: [
      {
        label: "Epic Games: how to check time played",
        url: "https://www.epicgames.com/help/c-32735058/c-Trending_0/a14280729?lang=en-US",
      },
      {
        label: "Epic Games: Fortnite playtime in library list view",
        url: "https://www.epicgames.com/help/c-34254770/c-39122868/a12322560?lang=en-US",
      },
    ],
    related: ["check-playtime-fortnite", "track-playtime-outside-steam"],
  },
  {
    slug: "check-playtime-gog-galaxy",
    category: "Launcher guides",
    title: "Check GOG playtime and track standalone games",
    description:
      "Find game hours in GOG GALAXY and track sessions from GALAXY or standalone GOG installations with PlayCounter on Windows.",
    answer:
      "GOG GALAXY includes hours played and game statistics in its library. PlayCounter can separately record recognized GOG games running on your PC, including games started directly from their executable.",
    sections: [
      {
        id: "galaxy",
        title: "Use the GOG GALAXY library",
        html: "<p>Open GOG GALAXY, select your game and check its playtime and statistics. GALAXY also supports library organization and connected-platform statistics; what is available depends on the game and integration.</p>",
      },
      {
        id: "standalone",
        title: "Track a GOG game with or without GALAXY",
        html: "<ol><li>Leave PlayCounter running.</li><li>Start your GOG game from GALAXY, a desktop shortcut or the installed executable.</li><li>Confirm the game in <strong>Now Playing</strong>.</li><li>Close it when finished and find the session in <strong>My History</strong>.</li></ol><p>For an unrecognized older game, use <strong>Discovered</strong> to assign the process a local game entry. Match the game rather than a setup program or launcher.</p>",
      },
      {
        id: "dos",
        title: "GOG games packaged with DOSBox",
        html: '<p>Some DOS releases run through a bundled DOSBox copy. PlayCounter has dedicated DOSBox game detection, so a recognizable title can get its own sessions instead of sharing one generic emulator total. Check the <a href="/playtime-tracker-for-emulators/">emulator guide</a> if a game needs review.</p>',
      },
      {
        id: "history",
        title: "Earlier hours remain a separate source",
        html: '<p>PlayCounter currently has no GOG importer. It records new sessions while running. To include older time, <a href="/adjust-total-playtime/">set the game’s total yourself</a>. GALAXY’s existing statistics remain available in GALAXY.</p>',
      },
    ],
    sources: [
      {
        label: "GOG: GALAXY library and statistics features",
        url: "https://www.gog.com/galaxy",
      },
    ],
    related: ["playtime-tracker-for-emulators", "track-playtime-outside-steam"],
  },
  {
    slug: "check-playtime-ea-app",
    category: "Launcher guides",
    title: "Check EA app playtime and record PC sessions",
    description:
      "Find My Playtime in EA app settings and use PlayCounter to record recognized EA game sessions in your local Windows library.",
    answer:
      "In the EA app, open the top-left menu, choose Settings and open My Playtime. To keep local sessions for recognized EA games, leave PlayCounter running and launch the games normally.",
    sections: [
      {
        id: "ea",
        title: "Open My Playtime in the EA app",
        html: '<ol><li>Open the <strong>EA app</strong> on your PC.</li><li>Select the menu in the top-left corner, then <strong>Settings</strong>.</li><li>Open <strong>My Playtime</strong> to see the playtime information available for your account.</li></ol><p>EA documents this in its <a href="https://help.ea.com/en/articles/platforms/how-to-use-ea-app/">EA app guide</a>. Games may also have their own in-game statistics, which can measure a different period or activity.</p>',
      },
      {
        id: "tracking",
        title: "Track the game in PlayCounter",
        html: "<ol><li>Start PlayCounter before your game.</li><li>Launch the EA game normally, including through Steam if that is where you own it.</li><li>Open <strong>Now Playing</strong> to confirm the actual game is matched.</li><li>After the game closes, view its session in <strong>My History</strong>.</li></ol><p>The EA app can remain open between games. Assign the game process, rather than the EA launcher, if you need to make a local match in <strong>Discovered</strong>.</p>",
      },
      {
        id: "imports",
        title: "Can EA hours be imported?",
        html: '<p>PlayCounter does not currently import historical hours directly from EA. Automatic tracking starts recording new local sessions while the app is running. To include your earlier EA hours, enter the My Playtime value with <a href="/adjust-total-playtime/">Adjust total playtime</a>.</p><p>If the same game has a reported Steam or Xbox total, those importers can bring in the available value. Confirm the correct title and edition during review. <a href="/total-playtime-across-all-launchers/#totals">How imported totals combine</a>.</p>',
      },
    ],
    sources: [
      {
        label: "EA Help: how to use the EA app, including My Playtime",
        url: "https://help.ea.com/en/articles/platforms/how-to-use-ea-app/",
      },
    ],
    related: ["check-playtime-on-steam", "total-playtime-across-all-launchers"],
  },
  {
    slug: "check-playtime-ubisoft-connect",
    category: "Launcher guides",
    title: "Check and track Ubisoft game playtime on PC",
    description:
      "Use Ubisoft Connect game statistics and record local sessions for recognized Ubisoft PC games with PlayCounter, regardless of launch method.",
    answer:
      "Ubisoft Connect provides game statistics for supported titles. Check the statistics available for your game and account. For a local session history on Windows, PlayCounter can track recognized Ubisoft games as they run.",
    sections: [
      {
        id: "statistics",
        title: "Start with the game’s Ubisoft statistics",
        html: '<p>Open Ubisoft Connect and select the game to look for its statistics. The information offered depends on the title, so use its available playtime or progression fields rather than assuming every game has the same lifetime counter.</p><p>If the game was launched through Steam, you can also check <a href="/check-playtime-on-steam/">its Steam playtime</a>. These records may cover different sessions or platforms.</p>',
      },
      {
        id: "tracking",
        title: "Record your PC sessions in PlayCounter",
        html: "<ol><li>Open PlayCounter and start the Ubisoft game from your usual launcher.</li><li>Check <strong>Now Playing</strong> for the matched game and session timer.</li><li>Keep PlayCounter running while you play.</li><li>Close the game and use <strong>My History</strong> to see the session.</li></ol><p>If both a launcher and game process appear in <strong>Discovered</strong>, match the actual game. Tracking the launcher would include the time it stays open after you finish.</p>",
      },
      {
        id: "scope",
        title: "Earlier hours and different editions",
        html: '<p>PlayCounter does not currently have a Ubisoft importer. Its local history starts with sessions it records. To include earlier hours you have verified, <a href="/adjust-total-playtime/">adjust the game’s total</a>.</p><p>When selecting a local match, check the title and edition, especially for games with separate test clients or multiple releases. A local PC session is runtime and can include menus or idle time; it is not a match-only statistic.</p>',
      },
    ],
    sources: [
      {
        label: "Ubisoft: Connect statistics and progression features",
        url: "https://news.ubisoft.com/en-us/article/49k4tJWat7Fynslc5BkRdi/null",
      },
    ],
    related: ["check-playtime-on-steam", "how-automatic-game-detection-works"],
  },
  {
    slug: "check-playtime-battle-net",
    category: "Launcher guides",
    title: "Track Battle.net playtime, including WoW",
    description:
      "Battle.net games are tracked without any import. Start your game as usual, set your earlier hours once, and import your game list only if you want it.",
    answer:
      "You don’t need to import or connect anything. Keep PlayCounter running and start your game from Battle.net as usual: it shows up in Now Playing and is tracked automatically. Battle.net shares no playtime, so to include your earlier hours, set the game’s total once with Adjust total playtime. The Battle.net import is optional and only adds your game list.",
    thumb: "battlenet-now",
    glance: [
      ["Just play", "#tracking"],
      ["Add earlier hours", "#earlier-hours"],
      ["Import is optional", "#import"],
    ],
    sections: [
      {
        id: "tracking",
        title: "Just play: no import needed",
        html: '<p>PlayCounter recognizes Battle.net games by the running game, the same way it tracks games from any other launcher. You don’t need to import them or connect your Battle.net account.</p><ol><li>Keep PlayCounter running, even in the tray.</li><li>Start your game from Battle.net as usual. It appears in <strong>Now Playing</strong> with a running timer.</li><li>Close the game when you are done. The session appears in <strong>My History</strong> and counts toward the game’s total in <strong>My Games</strong>.</li></ol><p>PlayCounter tracks the game itself, such as <code>Wow.exe</code>, not the Battle.net launcher, and it does not split a WoW session by character. In the screenshot, nothing was imported: the Battle.net source shows 0 games, and World of Warcraft is tracked anyway. If a game doesn’t show up, <a href="/game-not-detected/">add it in Discovered</a>.</p>',
        screenshot: "battlenet-now",
      },
      {
        id: "earlier-hours",
        title: "Add the hours you played before",
        intro:
          "<p>Battle.net doesn’t share playtime, with or without an import. Set each game’s earlier total once, and PlayCounter adds your new sessions on top.</p>",
        steps: [
          {
            title: "Find your earlier total",
            html: '<p>In World of Warcraft, type <code>/played</code> on each character and add the totals up. The <a href="/check-playtime-world-of-warcraft/">WoW playtime guide</a> has a calculator for that. For other Blizzard games, check the game’s own profile or statistics screen and note what it counts.</p>',
          },
          {
            title:
              "Right-click the game, then Playtime → Adjust total playtime",
            html: "<p>In <strong>My Games</strong>, right-click the game. Open <strong>Playtime</strong> and choose <strong>Adjust total playtime</strong>.</p>",
            image: "adjust-menu",
          },
          {
            title: "Enter the full total and save",
            html: "<p>Type the complete hours and minutes, not only the missing part, then select <strong>Save total</strong>. Your history stays unchanged.</p>",
            image: "adjust-dialog",
          },
        ],
      },
      {
        id: "import",
        title: "Optional: import your Battle.net games",
        intro:
          "<p>The import brings no playtime and doesn’t change tracking. It is only useful if you want your Battle.net games in My Games before you play them, including games that are not installed, with covers and launch options.</p>",
        steps: [
          {
            title: "Open Battle.net in My Games",
            html: "<p>In the sidebar under <strong>My Games</strong>, select <strong>Battle.net</strong>. Then select <strong>Import from Battle.net</strong>.</p>",
            image: "battlenet-library",
          },
          {
            title: "Choose how to find your games",
            html: "<p><strong>Find installed games</strong> only scans this PC and needs no sign-in. <strong>Sign in and find games</strong> also includes games from your Battle.net account that are not installed.</p>",
            image: "battlenet-import",
          },
          {
            title: "Read the playtime note, then select OK",
            html: "<p>PlayCounter reminds you that Battle.net has no past playtime to import. If you chose to sign in, complete the Battle.net sign-in in the window that opens.</p>",
            image: "battlenet-notice",
          },
          {
            title: "Review and import",
            html: "<p>Recognized games wait in <strong>Ready to import</strong>. Uncheck anything you don’t want and select <strong>Import</strong>. Games under <strong>Needs attention</strong> ask you to confirm the right game first.</p>",
            image: "battlenet-review",
          },
        ],
        html: '<p>The sign-in window is temporary and is discarded when the scan finishes. Only the list of games leaves it: your password, account details and CD keys are not passed to PlayCounter. <a href="/datenschutz#en">Import privacy details</a>.</p>',
      },
      {
        id: "versions",
        title: "WoW Retail and Classic are separate games",
        html: "<p>World of Warcraft and each Classic version have their own entry, playtime and sessions in PlayCounter. When you set a total, add up only the characters of that version. Check the selected title when a match asks for your review.</p>",
      },
    ],
    sources: [
      {
        label: "Blizzard Support: checking World of Warcraft time played",
        url: "https://us.battle.net/support/en/article/21163",
      },
      {
        label: "PlayCounter: Battle.net importer",
        url: `${site.repository}/blob/v${site.version}/apps/desktop/src/library/providers/battlenet.ts`,
      },
    ],
    related: ["check-playtime-world-of-warcraft", "adjust-total-playtime"],
  },
  {
    slug: "check-playtime-rockstar-launcher",
    category: "Launcher guides",
    title: "Track GTA and Red Dead playtime on PC",
    description:
      "Record GTA and Red Dead sessions with PlayCounter when launching through Rockstar or Steam, and keep game runtime separate from save statistics.",
    answer:
      "Leave PlayCounter running and launch your GTA or Red Dead game normally. Once the game process is recognized, PlayCounter records a local session, whether Rockstar or another launcher started it.",
    sections: [
      {
        id: "existing",
        title: "Check the playtime you already have",
        html: '<p>For a Steam copy, select the game in your <a href="/check-playtime-on-steam/">Steam Library</a> to see its reported hours. You can also inspect statistics inside the game or its save data where available.</p><p>Pay attention to the scope of each number. Story progress, a particular save, an online character and application runtime can describe different things. Do not add them together as if they were separate sessions.</p>',
      },
      {
        id: "tracking",
        title: "Record sessions from Rockstar or Steam",
        html: "<ol><li>Start PlayCounter.</li><li>Launch your installed game through Rockstar, Steam or its usual shortcut.</li><li>Check <strong>Now Playing</strong> for the actual game and its timer.</li><li>Close the game when finished. Its session appears in <strong>My History</strong>.</li></ol><p>Rockstar supports launching linked Steam installations through its launcher. PlayCounter’s matching follows the running game process, so that launch chain does not need a separate tracking setup.</p>",
      },
      {
        id: "editions",
        title: "Choose the correct game and edition",
        html: "<p>Separate editions or test executables may appear as different processes. Review the title if PlayCounter asks for a match, and choose the game you are actually running.</p><p>A process-based tracker does not necessarily distinguish story and online modes when they use the same game executable. It also counts time spent in menus while that process remains open.</p>",
      },
      {
        id: "earlier",
        title: "Bring in earlier time where available",
        html: '<p>PlayCounter has no direct Rockstar importer. A Steam import can bring in the available Steam total for your copy. For other earlier hours, <a href="/adjust-total-playtime/">log a missed session or adjust the total</a>.</p>',
      },
    ],
    sources: [
      {
        label:
          "Rockstar Support: Steam and non-Steam installations in the launcher",
        url: "https://support.rockstargames.com/articles/3Q7s5Wsyo4ZAkzv7z5p9s9/adding-steam-and-non-steam-installations-to-the-rockstar-games-launcher",
      },
    ],
    related: ["check-playtime-on-steam", "track-playtime-outside-steam"],
  },
  {
    slug: "check-playtime-itch-io",
    category: "Launcher guides",
    title: "Track itch.io game playtime on Windows",
    description:
      "Track downloaded itch.io games with PlayCounter, assign local matches for small or unreleased games, and keep a local play-session history.",
    answer:
      "PlayCounter can record recognized Windows games downloaded from itch.io, whether you launch them through the itch app or directly. For a game it does not know yet, create a local entry from Discovered.",
    sections: [
      {
        id: "downloaded-games",
        title: "Track a downloaded itch.io game",
        html: "<ol><li>Install or extract the Windows game and start PlayCounter.</li><li>Open the game from the itch app or its executable.</li><li>Look in <strong>Now Playing</strong> for its title and running timer.</li><li>If it is missing, open <strong>Discovered</strong> while the game is still running and review its process.</li></ol><p>The itch app can install and launch games, but PlayCounter does not require it. The game only needs to run as a local process PlayCounter can track.</p>",
      },
      {
        id: "local-games",
        title: "Add a small, new or unreleased game",
        html: '<p>Game-jam entries and early builds may not have a metadata match. <a href="/game-not-detected/">Add the game in Discovered</a> with a local title so you can track it without waiting for a catalog entry. You can also submit a game match for community review when appropriate.</p><p>Generic names such as <code>game.exe</code> are shared by unrelated projects. Confirm the correct local game instead of assuming the filename uniquely identifies it. Review the entry again if a new build changes its executable.</p>',
      },
      {
        id: "browser",
        title: "Downloaded games and browser games differ",
        html: "<p>A browser game runs inside the browser process. PlayCounter does not automatically identify individual itch.io browser games from their tabs. Assigning your browser a game name would also count unrelated browsing, so use manual sessions when you want a record of a specific browser game.</p>",
      },
      {
        id: "history",
        title: "Keep your new sessions together",
        html: '<p>Recorded sessions appear in <strong>My History</strong>, and the game total appears in <strong>My Games</strong>. There is no itch.io importer; tracking begins with sessions recorded while PlayCounter is running. You can <a href="/adjust-total-playtime/">add earlier hours yourself</a>.</p>',
      },
    ],
    sources: [
      {
        label: "itch.io: the desktop app and downloaded games",
        url: "https://itch.io/app",
      },
      {
        label: "PlayCounter: local tracking and game matches",
        url: site.repository,
      },
    ],
    related: [
      "track-playtime-outside-steam",
      "how-automatic-game-detection-works",
    ],
  },
];
