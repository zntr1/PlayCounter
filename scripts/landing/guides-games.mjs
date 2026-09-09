import { site } from "./site.mjs";

export const gameGuides = [
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
        html: "<p>PlayCounter records the matched game process. It does not automatically split that time by world, server or modpack. Different launchers may use different Java installations, so confirm the match when switching setups.</p><p>New local sessions start when PlayCounter is running. It does not read old Java world statistics into a historical import. You can manually add a session or adjust a total if you want to include earlier time.</p>",
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
        html: "<p>PlayCounter currently has no Epic history importer. The Epic counter remains the place to check earlier PC hours; you can use a manual adjustment if you want to include a known total locally.</p><p>The optional Xbox importer can bring in a reported Xbox value where available. It is not a live console tracker, and overlapping totals are not automatically added together.</p>",
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
        html: "<p>PlayCounter does not have a Roblox history importer. A recent weekly report should not be presented as a lifetime total, and account age or badge counts cannot reconstruct an exact one. You can add earlier known time manually if you have a record you want to keep.</p>",
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
        html: "<p>There is no Riot historical importer in PlayCounter. It records new sessions while it is running, and manual entries or total adjustments are available for previous time you want to add.</p><p>If a generic process name has several possible matches, choose the correct local title. Your choice is not published as a universal match for all Riot-related processes.</p>",
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
