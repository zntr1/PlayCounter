import { site } from "./site.mjs";

export const gameGuides = [
  {
    slug: "check-playtime-world-of-warcraft",
    category: "Game guides",
    title: "How to see your total WoW playtime across characters",
    description:
      "World of Warcraft’s /played shows one character at a time. Add up all your characters with the calculator, then keep your WoW total in PlayCounter.",
    answer:
      "Type /played on each World of Warcraft character and note its Total time played. Add the characters up with the calculator below. To keep that total, set it in PlayCounter with Adjust total playtime; new sessions are then added automatically.",
    thumb: "adjust-dialog",
    glance: [
      ["/played on each character", "#played"],
      ["Add them up", "#calculator"],
      ["Set it in PlayCounter", "#playcounter"],
    ],
    sections: [
      {
        id: "played",
        title: "Check /played on each character",
        html: '<ol><li>Log in to a character.</li><li>Open chat, type <code>/played</code> and press <kbd>Enter</kbd>.</li><li>Note the line <strong>Total time played</strong>. Repeat for every character you want to include.</li></ol><figure class="chat-mock"><div class="chat-window" role="img" aria-label="Example chat after typing /played: Total time played: 9 days, 14 hours, 20 minutes, 12 seconds. Time played this level: 1 day, 2 hours, 41 minutes, 3 seconds."><p class="chat-input">/played</p><p class="chat-system is-key">Total time played: 9 days, 14 hours, 20 minutes, 12 seconds</p><p class="chat-system">Time played this level: 1 day, 2 hours, 41 minutes, 3 seconds</p></div><figcaption>Example output. The first line is the one you need.</figcaption></figure><p><code>/played</code> counts one character on one realm. It does not add up your other characters, and Retail and Classic characters are counted separately.</p>',
      },
      {
        id: "calculator",
        title: "Add up all your characters",
        html: '<form class="played-calc" data-played-calc aria-labelledby="calc-title"><div class="calc-head"><h3 id="calc-title">/played calculator</h3><p>Enter the <strong>Total time played</strong> of each character. Seconds are left out.</p></div><div class="calc-table" role="group" aria-label="Characters"><div class="calc-row calc-labels" aria-hidden="true"><span>Character</span><span>Days</span><span>Hours</span><span>Minutes</span><span></span></div><div data-calc-rows><div class="calc-row" data-calc-row><label class="calc-field"><span class="calc-caption" aria-hidden="true">Character</span><input type="text" value="Paladin" aria-label="Character 1 name" maxlength="40" /></label><label class="calc-field"><span class="calc-caption" aria-hidden="true">Days</span><input type="number" min="0" inputmode="numeric" value="9" aria-label="Character 1 days" data-unit="d" /></label><label class="calc-field"><span class="calc-caption" aria-hidden="true">Hours</span><input type="number" min="0" inputmode="numeric" value="14" aria-label="Character 1 hours" data-unit="h" /></label><label class="calc-field"><span class="calc-caption" aria-hidden="true">Minutes</span><input type="number" min="0" inputmode="numeric" value="20" aria-label="Character 1 minutes" data-unit="m" /></label><button type="button" class="calc-remove" data-calc-remove aria-label="Remove character 1" hidden>×</button></div><div class="calc-row" data-calc-row><label class="calc-field"><span class="calc-caption" aria-hidden="true">Character</span><input type="text" value="Mage" aria-label="Character 2 name" maxlength="40" /></label><label class="calc-field"><span class="calc-caption" aria-hidden="true">Days</span><input type="number" min="0" inputmode="numeric" value="2" aria-label="Character 2 days" data-unit="d" /></label><label class="calc-field"><span class="calc-caption" aria-hidden="true">Hours</span><input type="number" min="0" inputmode="numeric" value="21" aria-label="Character 2 hours" data-unit="h" /></label><label class="calc-field"><span class="calc-caption" aria-hidden="true">Minutes</span><input type="number" min="0" inputmode="numeric" value="5" aria-label="Character 2 minutes" data-unit="m" /></label><button type="button" class="calc-remove" data-calc-remove aria-label="Remove character 2" hidden>×</button></div><div class="calc-row" data-calc-row><label class="calc-field"><span class="calc-caption" aria-hidden="true">Character</span><input type="text" value="Hunter" aria-label="Character 3 name" maxlength="40" /></label><label class="calc-field"><span class="calc-caption" aria-hidden="true">Days</span><input type="number" min="0" inputmode="numeric" value="0" aria-label="Character 3 days" data-unit="d" /></label><label class="calc-field"><span class="calc-caption" aria-hidden="true">Hours</span><input type="number" min="0" inputmode="numeric" value="17" aria-label="Character 3 hours" data-unit="h" /></label><label class="calc-field"><span class="calc-caption" aria-hidden="true">Minutes</span><input type="number" min="0" inputmode="numeric" value="40" aria-label="Character 3 minutes" data-unit="m" /></label><button type="button" class="calc-remove" data-calc-remove aria-label="Remove character 3" hidden>×</button></div></div></div><button type="button" class="calc-add" data-calc-add hidden>+ Add character</button><output class="calc-total" data-calc-total aria-live="polite"><span class="calc-total-label">Enter in PlayCounter</span><span class="calc-total-value"><strong data-calc-hours>317</strong> hours <strong data-calc-minutes>5</strong> minutes</span><span class="calc-total-days" data-calc-days>= 13 days, 5 hours, 5 minutes</span></output></form><p>The example shows three characters. Change the numbers to yours, or add a row per character.</p>',
      },
      {
        id: "playcounter",
        title: "Keep the total in PlayCounter",
        intro:
          '<p>World of Warcraft needs to be in My Games first: play it once with PlayCounter running, no import needed. <a href="/check-playtime-battle-net/">Importing it from Battle.net</a> works too. Then set the total:</p>',
        steps: [
          {
            title:
              "Right-click the game, then Playtime → Adjust total playtime",
            html: "<p>In <strong>My Games</strong>, right-click World of Warcraft. Open <strong>Playtime</strong> and choose <strong>Adjust total playtime</strong>.</p>",
            image: "adjust-menu",
          },
          {
            title: "Enter the calculator’s result and save",
            html: "<p>Type the hours and minutes into <strong>New total</strong> and select <strong>Save total</strong>. Enter the full number: <code>/played</code> already includes the sessions PlayCounter recorded.</p>",
            image: "adjust-dialog",
          },
          {
            title: "Done: new sessions add up from here",
            html: "<p>The game card shows your new total. Every session from now on is added to it automatically. Your history is not changed.</p>",
            image: "adjust-result",
          },
        ],
      },
      {
        id: "differences",
        title: "Why PlayCounter and /played can drift apart",
        html: "<p><code>/played</code> counts the time a character is logged in. PlayCounter counts the time the game runs, including the login screen, character selection and loading screens. Over months, PlayCounter’s number usually ends up a little higher. To line them up again, repeat the steps with a fresh <code>/played</code> sum.</p>",
      },
      {
        id: "versions",
        title: "Retail, Classic and several accounts",
        html: '<p>Retail World of Warcraft and each Classic version are separate games in PlayCounter. Add up only the characters of the version you are setting. Characters from several WoW accounts on this PC count toward the same game, so include them in the sum.</p><p>Getting ready for World of Warcraft: Forever? <a href="/track-playtime-wow-forever/">Set up tracking before launch day</a>.</p>',
      },
    ],
    sources: [
      {
        label: "Blizzard Support: checking World of Warcraft time played",
        url: "https://us.battle.net/support/en/article/21163",
      },
    ],
    related: ["check-playtime-battle-net", "adjust-total-playtime"],
  },
  {
    slug: "track-playtime-wow-forever",
    category: "Game guides",
    title: "How to track your WoW Forever playtime from day one",
    description:
      "Set up PlayCounter before WoW Forever launches on November 4, 2026, so your sessions are recorded from day one. Free, automatic, no add-on needed.",
    answer:
      "Install PlayCounter now and leave Launch on startup on, so it waits in the tray. When World of Warcraft: Forever launches on November 4, 2026, start it from Battle.net as usual: PlayCounter records each session automatically. On your first launch, check Now Playing once to confirm the title. No PlayCounter account, import or add-on needed.",
    thumb: "battlenet-now",
    glance: [
      ["Set up before launch", "#setup"],
      ["Check your first session", "#first-launch"],
      ["Add earlier /played time", "#played"],
    ],
    sections: [
      {
        id: "why",
        title: "Why set it up before launch day",
        html: "<p>Blizzard’s global launch date for World of Warcraft: Forever is <strong>November 4, 2026</strong>, at 3:00 p.m. PST. The beta runs from September 17 to October 21, 2026. Access is included with a World of Warcraft subscription or game time.</p><p>In the game, <code>/played</code> shows the time of one character. There is no history of your sessions, no playtime per day and no total across all your characters. Those only exist if something records them while you play, so set PlayCounter up before your first Forever session.</p>",
      },
      {
        id: "setup",
        title: "Set up PlayCounter before launch day",
        steps: [
          {
            title: "Install PlayCounter",
            html: "<p>Download the free Windows installer from this page and run it. There is no PlayCounter account to create.</p>",
          },
          {
            title: "Keep Launch on startup on",
            html: "<p>It is on by default. PlayCounter then starts when you sign in to Windows and waits in the tray, so no session is missed because you forgot to open it. The switch is in <strong>Settings → General</strong>.</p>",
          },
          {
            title: "Start Forever from Battle.net as usual",
            html: "<p>You don’t launch the game through PlayCounter and don’t need to import anything first. PlayCounter notices the running game by itself.</p>",
          },
        ],
      },
      {
        id: "first-launch",
        title: "Check your first Forever session once",
        html: '<p>PlayCounter already recognizes the Forever beta as World of Warcraft: Forever. The launch version may start from a different game file, so check once in your first session after launch:</p><ol><li>While Forever is running, open <strong>Now Playing</strong> in PlayCounter.</li><li>If it shows World of Warcraft: Forever with a running timer, you are done. Later sessions are recorded the same way.</li><li>If Now Playing shows nothing, open <strong>Discovered</strong>, choose <strong>Add &amp; Share</strong> on the running WoW file and pick World of Warcraft: Forever. Your match then helps other players too. <a href="/game-not-detected/">How to add a game</a>.</li><li>If it shows a different game, select the flag for <strong>Report wrong match</strong>, choose <strong>It belongs to a different game</strong> and pick the right one.</li></ol><p>PlayCounter only records games it knows, so this one check makes sure your first hours count.</p>',
        screenshot: "battlenet-now",
      },
      {
        id: "played",
        title: "Played before installing PlayCounter?",
        html: '<p>Type <code>/played</code> on each Forever character and add the totals up with the <a href="/check-playtime-world-of-warcraft/#calculator">/played calculator</a>. Then set the sum once in PlayCounter: right-click the game in <strong>My Games</strong>, open <strong>Playtime</strong> and choose <strong>Adjust total playtime</strong>. New sessions are added on top. <a href="/adjust-total-playtime/">Step by step with screenshots</a>.</p>',
      },
      {
        id: "differences",
        title: "What PlayCounter counts",
        html: '<p>PlayCounter measures how long the game runs, including the login screen, character selection and loading screens. It does not split a session by character. <code>/played</code> only counts the time you are logged in to a character, so PlayCounter’s number usually ends up a little higher. <a href="/check-playtime-world-of-warcraft/#differences">Why the two drift apart</a>.</p>',
      },
    ],
    sources: [
      {
        label: "Blizzard: World of Warcraft: Forever launch and beta dates",
        url: "https://news.blizzard.com/en-us/article/24301508/pre-purchase-world-of-warcraft-forever-upgrades-and-begin-your-next-journey-in-azeroth",
      },
      {
        label: "Blizzard Support: checking World of Warcraft time played",
        url: "https://us.battle.net/support/en/article/21163",
      },
    ],
    related: ["check-playtime-world-of-warcraft", "check-playtime-battle-net"],
  },
  {
    slug: "check-playtime-minecraft",
    category: "Game guides",
    title: "How to check and track Minecraft playtime",
    description:
      "Find Minecraft Java world statistics, understand their scope, and track new Minecraft sessions on Windows with PlayCounter, including local Java matches.",
    answer:
      "In Minecraft Java Edition, open a world, press Esc and choose Statistics → General to find Time Played. That statistic belongs to that world or server. PlayCounter can keep a separate local record of your Minecraft sessions on Windows.",
    sections: [
      {
        id: "java",
        title: "Check Minecraft Java statistics",
        html: "<ol><li>Enter the world or server you want to check.</li><li>Press <strong>Esc</strong> and open <strong>Statistics → General</strong>.</li><li>Find <strong>Time Played</strong>. Names can vary with the game language or version.</li></ol><p>Java distinguishes play time from total world time, which can include paused time. A world or server’s statistics do not automatically add up every installation, deleted world or other server you have played.</p>",
      },
      {
        id: "bedrock",
        title: "Minecraft for Windows and Xbox statistics",
        html: '<p>For Minecraft for Windows, check the Xbox statistics available for the title and account you use. Reported account time can cover a different scope than Java’s world statistics.</p><p>PlayCounter’s <a href="/check-playtime-xbox-game-pass/">Xbox importer</a> can bring in available reported playtime. Review the edition when matching it; Minecraft Java and Minecraft for Windows are not interchangeable records.</p>',
      },
      {
        id: "tracking",
        title: "Track your next Minecraft session",
        html: "<ol><li>Open PlayCounter and launch Minecraft as usual.</li><li>Enter the game and check <strong>Now Playing</strong> for the correct title.</li><li>If Java is not recognized, open <strong>Discovered</strong> and review the running game process.</li><li>Close the game when finished. The local session appears in <strong>My History</strong>.</li></ol><p>Minecraft Java often runs as <code>javaw.exe</code> or <code>java.exe</code>, names also used by other applications. Use a local match for your Minecraft installation when needed. Do not assume every Java process is Minecraft.</p>",
      },
      {
        id: "modpacks",
        title: "What about modpacks, worlds and earlier hours?",
        html: '<p>PlayCounter records the matched game process. It does not automatically split that time by world, server or modpack. Different launchers may use different Java installations, so confirm the match when switching setups.</p><p>New local sessions start when PlayCounter is running. It does not read old Java world statistics into a historical import. To include earlier time, <a href="/adjust-total-playtime/">log a session or adjust the total</a>.</p>',
      },
    ],
    sources: [
      {
        label: "Minecraft: Java play_time and total_world_time statistics",
        url: "https://www.minecraft.net/en-us/article/caves---cliffs--part-i-out-today-java",
      },
      {
        label: "Xbox Support: time played for supported games",
        url: "https://support.xbox.com/en-US/help/games-apps/my-games-apps/time-played",
      },
    ],
    related: [
      "how-automatic-game-detection-works",
      "check-playtime-xbox-game-pass",
    ],
  },
  {
    slug: "check-playtime-fortnite",
    category: "Game guides",
    title: "How to check your Fortnite playtime",
    description:
      "Find Fortnite hours in the Epic Games Launcher, understand what the counter covers, and track new Windows sessions with PlayCounter.",
    answer:
      "On PC, open the Epic Games Launcher, go to Library and switch to list view. Find Fortnite and read Time Played. Epic documents this counter; you do not need to estimate hours from match counts.",
    sections: [
      {
        id: "epic",
        title: "Find Fortnite hours in Epic",
        html: "<ol><li>Open the <strong>Epic Games Launcher</strong>.</li><li>Choose <strong>Library</strong> and switch to <strong>list view</strong>.</li><li>Find <strong>Fortnite</strong> and look at <strong>Time Played</strong>.</li></ol><p>This is the PC launcher’s record. Do not assume it is a complete account total across PC, PlayStation, Xbox, Switch and other devices.</p>",
      },
      {
        id: "sessions",
        title: "Record your Fortnite sessions with PlayCounter",
        html: "<ol><li>Start PlayCounter before launching Fortnite.</li><li>Launch Fortnite through Epic normally.</li><li>Check <strong>Now Playing</strong> to confirm the game and automatic timer.</li><li>After closing Fortnite, open <strong>My History</strong> to see the recorded session.</li></ol><p>If a match needs review, choose the game process in <strong>Discovered</strong>. The Epic launcher can remain open independently of Fortnite.</p>",
        screenshot: "history",
      },
      {
        id: "scope",
        title: "Runtime is different from time in matches",
        html: "<p>PlayCounter measures the time the matched Fortnite process is running. That can include the lobby, loading screens and idle time, and it does not split a session by Fortnite mode.</p><p>Match statistics describe matches. Multiplying a match count by an assumed average duration will not recover an exact playtime total.</p>",
      },
      {
        id: "earlier",
        title: "Include earlier time",
        html: '<p>The Epic Games import brings in the Fortnite hours Epic recorded: in <strong>My Games</strong>, select <strong>Epic Games</strong>, then <strong>Import from Epic Games</strong> and sign in. <a href="/check-playtime-epic-games/#import">Epic import step by step</a>.</p><p>The optional Xbox importer can bring in a reported Xbox value where available. It is not a live console tracker, and overlapping totals are not automatically added together.</p>',
      },
    ],
    sources: [
      {
        label: "Epic Games: how to check Fortnite playtime",
        url: "https://www.epicgames.com/help/c-34254770/c-39122868/a12322560?lang=en-US",
      },
    ],
    related: [
      "check-playtime-epic-games",
      "total-playtime-across-all-launchers",
    ],
  },
  {
    slug: "check-playtime-roblox",
    category: "Game guides",
    title: "Check Roblox screen time and track PC sessions",
    description:
      "Find Roblox’s recent screen-time and Top experiences reports, then track Roblox client sessions on Windows with PlayCounter.",
    answer:
      "Roblox offers recent screen-time reports, including Top experiences for eligible accounts. These describe recent use rather than a lifetime total. PlayCounter can separately record how long the Roblox client runs on your Windows PC.",
    sections: [
      {
        id: "roblox",
        title: "Find Roblox’s recent screen-time report",
        html: '<p>Roblox documents screen-time reporting for users aged 13 or older and for parents managing a linked child account.</p><ul><li><strong>Your account (age 13+):</strong> open <strong>Settings → Privacy &amp; content restrictions → Screen time</strong>. Use <strong>Top experiences</strong> to see your top 20 experiences over the past week.</li><li><strong>Linked parent account:</strong> open <strong>Settings → Parental Controls</strong>, select the child, then open <strong>Screen time</strong> and its management view. The report includes recent use and <strong>Top experiences</strong>.</li></ul><p>Available controls depend on account eligibility. Use <a href="https://en.help.roblox.com/hc/en-us/articles/30428328969492-Managing-Screen-Time">Roblox’s current instructions</a> if the menus differ.</p>',
      },
      {
        id: "tracking",
        title: "Record Roblox PC sessions in PlayCounter",
        html: "<ol><li>Leave PlayCounter running and join a Roblox experience.</li><li>Check <strong>Now Playing</strong> for Roblox and its session timer.</li><li>If it is not recognized, review the Roblox game client in <strong>Discovered</strong>.</li><li>Close the Roblox client when finished; the session appears in <strong>My History</strong>.</li></ol><p>Match the game client rather than your browser or the Roblox installer. Roblox Studio is a separate application and should have its own entry if you want to track it.</p>",
      },
      {
        id: "experiences",
        title: "Client time and experience time are different",
        html: "<p>PlayCounter records the Roblox client as one game. It does not automatically identify or separate the experiences you join inside that process. Moving to another experience without closing the client can remain part of the same session.</p><p>Use Roblox’s native recent report for its per-experience breakdown. PlayCounter provides your local PC client history from the point you start recording.</p>",
      },
      {
        id: "lifetime",
        title: "Can I recover all my earlier Roblox hours?",
        html: '<p>PlayCounter does not have a Roblox history importer. A recent weekly report should not be presented as a lifetime total, and account age or badge counts cannot reconstruct an exact one. You can <a href="/adjust-total-playtime/">add earlier known time yourself</a> if you have a record you want to keep.</p>',
      },
    ],
    sources: [
      {
        label: "Roblox Support: screen time and Top experiences",
        url: "https://en.help.roblox.com/hc/en-us/articles/30428328969492-Managing-Screen-Time",
      },
    ],
    related: [
      "how-automatic-game-detection-works",
      "track-playtime-outside-steam",
    ],
  },
  {
    slug: "check-playtime-riot-games",
    category: "Game guides",
    title: "Track League of Legends and VALORANT playtime",
    description:
      "Record League of Legends and VALORANT sessions on Windows, match the game instead of Riot Client, and understand runtime versus match statistics.",
    answer:
      "Keep PlayCounter running and start League of Legends or VALORANT normally. Confirm the actual game in Now Playing. PlayCounter records the matched game process, so its sessions can measure a different period than match-history statistics.",
    sections: [
      {
        id: "match-time",
        title: "Decide which number you are checking",
        html: "<p>A game’s match history describes individual matches. A local process timer measures how long a particular program runs. Depending on the game, that can include menus or stop between matches.</p><p>Use the recorded match duration when you want the length of a specific match. Use PlayCounter’s session history for the runtime it recorded. Multiplying your match count by an average duration will not give an exact lifetime total.</p>",
      },
      {
        id: "league",
        title: "League of Legends: check the game process",
        html: "<ol><li>Open PlayCounter and launch League of Legends.</li><li>Start a game so the game process is running.</li><li>Check <strong>Now Playing</strong>. If a local choice is needed, use <strong>Discovered</strong> to match the game rather than Riot Client or the separate League client.</li><li>After playing, check the sessions in <strong>My History</strong>.</li></ol><p>The League client and the in-game process have different lifetimes. A timer assigned to the client can include champion selection and time between matches, while the game process can close at the end of a match. Confirm the process you are tracking.</p>",
      },
      {
        id: "valorant",
        title: "VALORANT: confirm the running game",
        html: "<p>Launch VALORANT normally with PlayCounter open. A recognized game appears in <strong>Now Playing</strong>. If you need to review it, select the VALORANT game process rather than Riot Client.</p><p>Recorded runtime can include the game’s menus and time between matches. PlayCounter does not need to read Riot account credentials or match results to record that process.</p>",
      },
      {
        id: "history",
        title: "Local history and earlier hours",
        html: '<p>There is no Riot historical importer in PlayCounter. It records new sessions while it is running. For previous time you want to add, use <a href="/adjust-total-playtime/">a missed session or a total adjustment</a>.</p><p>If a generic process name has several possible matches, choose the correct local title. Your choice is not published as a universal match for all Riot-related processes.</p>',
      },
    ],
    sources: [
      {
        label: "PlayCounter: process-based tracking and local matches",
        url: site.repository,
      },
    ],
    related: [
      "how-automatic-game-detection-works",
      "track-playtime-outside-steam",
    ],
  },
];
