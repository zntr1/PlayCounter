// Cross-cutting pages: per-game questions, category terms, comparison, trust,
// and the guides hub that links the whole cluster together.

const asideDefault =
  "PlayCounter is a free, open-source playtime tracker for Windows. It times recognized games automatically, whatever you launch them from.";

const cta =
  "Install PlayCounter once and it keeps a local record of the recognized games you play from here on, across every launcher on the PC.";

export const topicPages = [
  {
    slug: "total-playtime-across-all-launchers",
    title: "See Total Playtime Across All Launchers",
    description:
      "Your hours are split across Steam, Epic, Game Pass, GOG, EA, and standalone games. Here is how to get one combined playtime total on Windows.",
    ogTitle: "How to see your total playtime across every launcher",
    breadcrumb: "Total playtime",
    eyebrow: "Cross-launcher tracking",
    h1: "How to see your total playtime across all launchers",
    deck:
      "No storefront can answer how much you play, because each one only sees its own games. Here is why that is, what the workarounds cost you, and the approach that actually works.",
    sections: [
      {
        heading: "Why no launcher can give you the total",
        body: `            <p>
              Every store counts the games it launches. Steam knows your Steam hours.
              Epic knows your Epic hours. Xbox knows about the titles that report
              statistics to Xbox services. None of them knows about the others, and
              none of them knows about the game you downloaded as a zip file and run
              from a folder.
            </p>
            <p>
              A typical PC library in 2026 is spread across four or five launchers
              plus a handful of games that belong to no launcher at all. The number
              you actually want - "how many hours did I game this month?" - does not
              exist in any one place.
            </p>`,
      },
      {
        heading: "The three usual workarounds, and what breaks",
        body: `            <ol>
              <li>
                <strong>Add everything to Steam as non-Steam shortcuts.</strong>
                This works only if you always remember to launch through Steam,
                produces entries with no cover art or metadata, and still misses
                anything you start any other way.
              </li>
              <li>
                <strong>Use a library manager.</strong> Tools like Playnite unify
                your libraries beautifully and can track sessions they launch. The
                cost is that you have to adopt a new launch routine and let the
                manager become your front door to gaming.
              </li>
              <li>
                <strong>Add the numbers by hand.</strong> Open four launchers, copy
                four figures, ignore that each measures differently, and accept that
                the standalone games are simply absent. It is also a chore you will
                not repeat monthly.
              </li>
            </ol>
            <p>
              All three share the same flaw: they require you to change how you start
              games, or to do manual work, in order to answer a question you only
              wanted to check occasionally.
            </p>`,
      },
      {
        heading: "The process-based approach",
        body: `            <p>
              There is one thing every PC game has in common regardless of where it
              came from: it runs as a Windows process. A tracker that watches
              processes rather than launchers sees all of them equally.
            </p>
            <p>
              PlayCounter runs in the system tray, notices when a recognised game's
              executable starts, and records the session until the process exits. A
              Steam game, a Game Pass title, an old GOG installer, a Riot client, and
              a jam game extracted to your desktop all land in the same list, measured
              by the same rule.
            </p>
            <p>
              You do not launch anything through PlayCounter. You keep using Steam,
              the Xbox app, a desktop shortcut, or whatever you already use, and the
              record builds itself in the background.
            </p>`,
      },
      {
        heading: "What you get and what you give up",
        body: `            <p>
              What you get: one library view with cover art, per-game totals, session
              counts, a session-by-session history, and a live view of what is running
              right now. No account, no launcher logins, no library imports, and the
              data lives in local app storage on your PC.
            </p>
            <p>
              What you give up: the past. PlayCounter starts counting when you install
              it and does not import the hours already recorded by Steam or anyone
              else. If you want a lifetime archive, keep the store counters for
              history and use PlayCounter for the ongoing, unified picture. Older
              sessions can also be entered manually if a particular game matters to
              you.
            </p>
            <p>
              There are also honest technical limits. Emulators typically run one
              process for every ROM, so an emulated session may be recorded against
              the emulator rather than the individual game. Browser and cloud games
              share one client process for the same reason. And a game with a generic
              or renamed executable may need a one-time local identification before it
              tracks automatically.
            </p>`,
      },
      {
        heading: "Setting it up",
        body: `            <ol>
              <li>
                Download PlayCounter for Windows and install it. It is free and
                MIT-licensed, and the installer is hosted on GitHub with published
                checksums.
              </li>
              <li>
                Let it start with Windows so it is running when you are. It sits in
                the system tray and stays out of the way.
              </li>
              <li>
                Play as normal. Recognised games start and stop sessions on their own.
              </li>
              <li>
                Open it whenever you want the numbers - current session, per-game
                totals, session counts, and recent history.
              </li>
            </ol>`,
      },
    ],
    howToTitle: "See your total playtime across every PC launcher",
    howTo: [
      {
        name: "Install a process-based tracker",
        text: "Download and install PlayCounter for Windows. It is free, open source, and requires no account.",
      },
      {
        name: "Let it run in the background",
        text: "Enable start with Windows so the tracker is running whenever you play. It stays in the system tray.",
      },
      {
        name: "Launch games however you normally do",
        text: "Start games from Steam, Epic, the Xbox app, GOG, a shortcut, or the executable itself. Recognised games are timed automatically.",
      },
      {
        name: "Review your combined totals",
        text: "Open the app to see per-game totals, session counts, and recent history across every launcher in one list.",
      },
    ],
    faq: [
      {
        q: "Is there an app that combines Steam and Epic playtime?",
        a: "Not by merging the stores' own numbers, because neither exposes a complete history for that purpose. A process-based tracker on Windows records both from the moment you install it, in one list.",
      },
      {
        q: "Can I import my existing hours from Steam?",
        a: "PlayCounter does not import launcher histories. Its totals grow from sessions it observes, and older time can be added manually per game if you want it included.",
      },
      {
        q: "Do I have to launch games through the tracker?",
        a: "No. That is the point of the process-based approach - you keep your current launch habits and the tracker notices the game on its own.",
      },
      {
        q: "Does it work for games that are not from any store?",
        a: "Yes. DRM-free installs, portable builds, and standalone executables are treated exactly like store games because the tracker watches the process, not the storefront.",
      },
    ],
    related: [
      { href: "/check-playtime-on-steam/", label: "Steam playtime" },
      { href: "/check-playtime-epic-games/", label: "Epic Games playtime" },
      { href: "/check-playtime-xbox-game-pass/", label: "Game Pass playtime" },
      { href: "/playcounter-vs-playnite/", label: "PlayCounter vs Playnite" },
    ],
    asideBody: asideDefault,
    ctaBody: cta,
  },

  {
    slug: "check-playtime-minecraft",
    title: "How to Check Your Minecraft Playtime",
    description:
      "Minecraft has no built-in lifetime hours counter. Here is what the in-game statistics screen shows, what it misses, and how to track real playtime on PC.",
    breadcrumb: "Minecraft playtime",
    eyebrow: "Minecraft",
    h1: "How to check your Minecraft playtime",
    deck:
      "Minecraft tracks time per world, not per player. If you have played across dozens of worlds, servers, and versions, no single number exists anywhere.",
    sections: [
      {
        heading: "What Minecraft actually records",
        body: `            <p>
              In Minecraft: Java Edition, pause the game and open
              <em>Statistics</em>. Under the <em>General</em> tab you will find
              entries including time played and time since last death. That figure
              belongs to the current world save, not to you.
            </p>
            <p>
              Bedrock Edition exposes far less. Some statistics are available through
              the pause menu depending on version and platform, and Xbox profile
              statistics may report time played for the Bedrock title if it reports
              them to Xbox services.
            </p>`,
      },
      {
        heading: "Why per-world statistics do not answer the question",
        body: `            <p>
              A long-time Minecraft player has a dozen single-player worlds, several
              deleted ones, hundreds of hours on servers where the statistics belong
              to the server, and years across different versions and installations.
              To get a lifetime total from the statistics screen you would need every
              world you ever created, still present, and you would still be missing
              all multiplayer time.
            </p>
            <p>
              Realms, modded instances through launchers like CurseForge, Prism, or
              MultiMC, and older installations each fragment the record further.
            </p>`,
      },
      {
        heading: "Modded and multi-instance setups",
        body: `            <p>
              If you run modpacks, you probably have several separate instances, each
              with its own saves folder and its own statistics. That is a good setup
              for playing and a terrible one for knowing how much you play. Third-party
              launchers may show a per-instance figure, but nothing totals across them
              or includes vanilla play.
            </p>`,
      },
      {
        heading: "Track the Minecraft client itself",
        body: `            <p>
              PlayCounter measures how long the game is running on Windows, which is
              the number people actually mean by "my Minecraft hours". Single-player,
              servers, Realms, and modded instances all count, because they are all
              the same client running.
            </p>
            <p>
              A note on how Java Edition launches: the official launcher starts the
              game as a Java process, and modded launchers do the same with their own
              wrappers. Depending on the setup, PlayCounter may need a one-time
              confirmation to tie the running process to Minecraft. Once you have made
              that choice it is remembered locally and tracking is automatic.
            </p>
            <p>
              As with everything else it records, sessions and totals stay in local
              app storage on your PC, no account is required, and Minecraft sits in the
              same list as the rest of your games so you can see where your time really
              goes.
            </p>`,
      },
    ],
    faq: [
      {
        q: "Does Minecraft show total hours played?",
        a: "Not across your account. Java Edition's statistics screen shows time played for the current world only, and Bedrock exposes even less.",
      },
      {
        q: "How do I see Minecraft playtime on a server?",
        a: "Server playtime is tracked by the server, if at all, and is usually only available through a plugin command. Your local statistics screen does not include it.",
      },
      {
        q: "Can I see hours across all my Minecraft worlds?",
        a: "Only by opening each world's statistics individually and adding them up, and only for worlds that still exist. A client-level tracker measures all play in one figure.",
      },
      {
        q: "Does modded Minecraft playtime count?",
        a: "With a process-based tracker, yes - modded instances run the same client, so their time is recorded alongside vanilla play.",
      },
    ],
    related: [
      { href: "/how-automatic-game-detection-works/", label: "How automatic detection works" },
      { href: "/total-playtime-across-all-launchers/", label: "Total playtime across all launchers" },
      { href: "/check-playtime-roblox/", label: "Roblox playtime" },
    ],
    asideBody: asideDefault,
    ctaBody: cta,
  },

  {
    slug: "check-playtime-roblox",
    title: "How to Check Roblox Playtime on PC",
    description:
      "Roblox does not show total hours played. Here is what your profile and individual experiences reveal, and how to record real Roblox playtime on Windows.",
    breadcrumb: "Roblox playtime",
    eyebrow: "Roblox",
    h1: "How to check your Roblox playtime",
    deck:
      "Roblox shows join dates and visit counts, not hours. Individual experiences may keep their own timers, but nothing adds up your time on the platform.",
    sections: [
      {
        heading: "What Roblox shows you",
        body: `            <p>
              Your Roblox profile shows account creation date, place visits, badges,
              and favourites. None of that is playtime. Individual experiences may
              display their own session or progression timers, and some have leaderboards
              based on time in that experience, but those are built by the creators
              rather than by Roblox.
            </p>
            <p>
              There is no platform-level "hours played" figure, either per experience
              or overall.
            </p>`,
      },
      {
        heading: "Why parents and players both want this",
        body: `            <p>
              Two different groups search for this. Players want to know how much time
              a favourite experience has taken. Parents want a factual answer about how
              much time is going into Roblox overall, ideally without relying on the
              child self-reporting.
            </p>
            <p>
              Roblox's own parental controls focus on chat, spending, and content
              settings rather than producing a running total of time played on a PC.
              Windows Family Safety can restrict and report screen time for an account,
              which is a policy tool rather than a playtime log.
            </p>`,
      },
      {
        heading: "Tracking the Roblox client on Windows",
        body: `            <p>
              PlayCounter records how long the Roblox client runs. Whichever
              experiences are played inside it, the session time is captured and
              accumulates into a total with a session count and a dated history, so
              you can see both the overall figure and the pattern across days.
            </p>
            <p>
              The honest limitation is the same one that applies to browsers and cloud
              gaming clients: Roblox runs many different experiences inside one client
              process, so a tracker that watches processes records "Roblox" rather than
              the individual experience within it. If you need per-experience numbers,
              that has to come from the experience itself.
            </p>
            <p>
              For the total-time question - the one most people are actually asking -
              client-level tracking answers it accurately, locally, and without any
              account.
            </p>`,
      },
    ],
    faq: [
      {
        q: "Does Roblox show how many hours I have played?",
        a: "No. Profiles show visits, badges, and join dates rather than time played, and there is no platform-wide hours figure.",
      },
      {
        q: "Can I see time spent in a specific Roblox experience?",
        a: "Only if that experience implements its own timer or leaderboard. Roblox itself does not track per-experience hours for you.",
      },
      {
        q: "How can a parent see how long Roblox is used on a PC?",
        a: "Windows Family Safety can report and limit screen time for a child account. A local playtime tracker gives a plain running total of how long the Roblox client ran, with a dated session history.",
      },
      {
        q: "Why does a tracker show Roblox instead of the game inside it?",
        a: "All Roblox experiences run inside one client process, so process-based tracking sees the client. This is the same limitation that applies to browser games and cloud streaming clients.",
      },
    ],
    related: [
      { href: "/how-much-time-do-i-spend-gaming/", label: "How much time do I spend gaming?" },
      { href: "/supported-games/", label: "Which games are supported?" },
      { href: "/check-playtime-minecraft/", label: "Minecraft playtime" },
    ],
    asideBody: asideDefault,
    ctaBody: cta,
  },

  {
    slug: "check-playtime-fortnite",
    title: "How to Check Your Fortnite Playtime",
    description:
      "Epic can show lifetime Fortnite playtime through its account tools, and season stats show the rest. Here is where to look and how to track it yourself.",
    breadcrumb: "Fortnite playtime",
    eyebrow: "Fortnite",
    h1: "How to check your Fortnite playtime",
    deck:
      "Fortnite hours are not in the Epic library's Time Played column. Epic keeps the figure in its account and support tools, and the in-game stats only cover the current season.",
    sections: [
      {
        heading: "Where Epic keeps the number",
        body: `            <p>
              Fortnite is handled separately from the rest of the Epic library.
              Epic's own support documentation covers where to find time spent playing
              Fortnite, and the route has changed more than once - historically through
              account settings and player-data tools rather than the launcher's library
              view.
            </p>
            <p>
              Because Epic has moved this around, the reliable instruction is: start
              from Epic's Fortnite support pages for the current location rather than
              from a video that may be two UI revisions out of date.
            </p>`,
      },
      {
        heading: "What in-game stats do and do not cover",
        body: `            <p>
              Fortnite's career tab shows statistics for the current season and mode -
              matches played, wins, eliminations, and similar. It resets with each
              season, and it is per mode, so Battle Royale, Zero Build, Creative,
              Save the World, and the newer modes fragment the picture further.
            </p>
            <p>
              For a game that has been running since 2017 across dozens of seasons,
              seasonal stats are close to useless for the lifetime question.
            </p>`,
      },
      {
        heading: "Creative and custom modes complicate it",
        body: `            <p>
              A large share of modern Fortnite play happens in Creative islands and
              user-made modes. Time there does not appear in Battle Royale statistics
              at all, and individual islands keep their own scoreboards if anything.
              A player who mainly plays custom modes could look barely active by the
              career tab.
            </p>`,
      },
      {
        heading: "Measure the client instead",
        body: `            <p>
              PlayCounter times the Fortnite client on Windows. Every mode counts,
              seasons do not reset it, and lobby and queue time is included - which is
              a substantial part of a Fortnite session that no match-based statistic
              captures.
            </p>
            <p>
              It works the same whether you launch from the Epic Games Launcher or a
              shortcut, and it puts Fortnite in one list with the rest of your games so
              you can see the real proportion. Everything stays on your PC, and no
              Epic account access is involved.
            </p>
            <p>
              As with every game it tracks, the record starts from installation. It
              will not recover the seasons you already played.
            </p>`,
      },
    ],
    faq: [
      {
        q: "Where do I find my Fortnite hours?",
        a: "Epic exposes time spent playing Fortnite through its account and support tools rather than the launcher's library Time Played column. Epic has changed the exact location more than once, so check Epic's current Fortnite support page.",
      },
      {
        q: "Do Fortnite stats reset each season?",
        a: "The in-game career statistics are seasonal and per mode, so they do not represent lifetime play.",
      },
      {
        q: "Does Creative playtime count towards my stats?",
        a: "Creative and custom island play generally does not appear in Battle Royale career statistics. Client-level tracking counts all of it.",
      },
      {
        q: "Can I track Fortnite hours myself from now on?",
        a: "Yes. A process-based tracker on Windows records every session the client runs, including lobby and queue time, independent of seasons and modes.",
      },
    ],
    related: [
      { href: "/check-playtime-epic-games/", label: "Epic Games playtime" },
      { href: "/total-playtime-across-all-launchers/", label: "Total playtime across all launchers" },
      { href: "/how-much-time-do-i-spend-gaming/", label: "How much time do I spend gaming?" },
    ],
    asideBody: asideDefault,
    ctaBody: cta,
  },

  {
    slug: "playtime-tracker-for-emulators",
    title: "Playtime Tracking for Emulated Games",
    description:
      "Emulators run one process for every ROM, which breaks most playtime trackers. Here is what actually works for retro game time tracking on Windows.",
    breadcrumb: "Emulator playtime",
    eyebrow: "Emulation",
    h1: "Tracking playtime for emulated games",
    deck:
      "Retro libraries are the hardest thing to track, and most tools quietly get it wrong. Here is the real constraint and the approaches that work around it.",
    sections: [
      {
        heading: "The one-process problem",
        body: `            <p>
              A Windows process tracker identifies games by the executable that is
              running. That works because a PC game is its own program. An emulator
              breaks the assumption: <code>retroarch.exe</code> is the same process
              whether you are playing a 1991 platformer or a 2004 RPG. From the outside
              there is one program running, for six hours.
            </p>
            <p>
              This is not a flaw in any particular tracker. Any tool that watches
              processes without reading emulator internals sees the emulator, not the
              ROM. Tools that do resolve individual titles are reading the emulator's
              own logs, save states, or window titles, which requires per-emulator
              support and breaks when the emulator changes.
            </p>`,
      },
      {
        heading: "What PlayCounter does here",
        body: `            <p>
              PlayCounter records the emulator session honestly rather than guessing at
              the ROM. If you play through RetroArch, the time is recorded against
              RetroArch. That is a real, useful number - "I spent nine hours emulating
              this month" - and it is accurate, which a fabricated per-ROM attribution
              would not be.
            </p>
            <p>
              Standalone emulators that ship as their own program are handled better.
              A dedicated emulator executable is recognised as its own entry, so your
              time is at least separated by system rather than pooled into one
              frontend.
            </p>`,
      },
      {
        heading: "Practical ways to get per-game numbers",
        body: `            <ul>
              <li>
                <strong>Use standalone emulators instead of one frontend.</strong>
                Running separate emulator programs per system gives you per-system
                totals automatically.
              </li>
              <li>
                <strong>Check the emulator's own statistics.</strong> Some emulators
                and frontends keep per-ROM play counts and durations internally. Where
                that exists it is the most accurate source for individual games.
              </li>
              <li>
                <strong>Accept session-level tracking.</strong> For many people the
                question is how much time went into retro gaming overall, not the
                per-title breakdown. Emulator-level tracking answers that fully.
              </li>
            </ul>`,
      },
      {
        heading: "Where this fits with the rest of your library",
        body: `            <p>
              The advantage of tracking emulation with the same tool as everything else
              is proportion. Seeing emulator time next to your Steam, Game Pass, and
              standalone game time in one list gives you the honest picture of how you
              spend your gaming hours, even if the retro slice is not broken down by
              individual title.
            </p>
            <p>
              PlayCounter is free, MIT-licensed, and stores its history locally. It does
              not read your ROMs, inspect your files, or care where they came from - it
              only times the process that runs.
            </p>`,
      },
    ],
    faq: [
      {
        q: "Can PlayCounter track individual ROMs in RetroArch?",
        a: "No. RetroArch runs one process for every ROM, so time is recorded against RetroArch itself rather than the individual game. The app is explicit about this rather than guessing.",
      },
      {
        q: "Do standalone emulators track better?",
        a: "Yes. An emulator that ships as its own executable is recognised as its own entry, so time is separated by system instead of pooled into one frontend.",
      },
      {
        q: "Is there any tracker that resolves individual emulated games?",
        a: "Some tools read emulator logs, window titles, or save data to attribute play per ROM. That requires per-emulator support and tends to break when the emulator changes.",
      },
      {
        q: "Does tracking an emulator require anything unusual?",
        a: "No. The emulator is an ordinary Windows process, so it is timed like any other program once recognised.",
      },
    ],
    related: [
      { href: "/supported-games/", label: "Which games are supported?" },
      { href: "/how-automatic-game-detection-works/", label: "How automatic detection works" },
      { href: "/total-playtime-across-all-launchers/", label: "Total playtime across all launchers" },
    ],
    asideBody: asideDefault,
    ctaBody: cta,
  },

  {
    slug: "best-free-game-playtime-trackers",
    title: "Best Free Game Playtime Trackers for PC (2026)",
    description:
      "A practical comparison of free playtime trackers for Windows - launcher counters, library managers, and process-based tools - and which one fits your library.",
    ogTitle: "Best free game playtime trackers for PC in 2026",
    breadcrumb: "Best trackers",
    eyebrow: "Comparison",
    h1: "The best free game playtime trackers for PC",
    deck:
      "We make one of these, so read this with that in mind. It is still worth laying out honestly, because the right choice genuinely depends on what your library looks like.",
    sections: [
      {
        heading: "Three different kinds of tool",
        body: `            <p>
              Almost every playtime tracker falls into one of three categories, and the
              category matters more than the individual app.
            </p>
            <ol>
              <li>
                <strong>Store counters</strong> - Steam, Epic, GOG Galaxy, Xbox. Free,
                built in, and accurate for their own games only.
              </li>
              <li>
                <strong>Library managers</strong> - Playnite and similar. They unify
                your libraries and track the sessions they launch, at the cost of
                becoming your new front door to gaming.
              </li>
              <li>
                <strong>Process trackers</strong> - tools that watch what is running on
                Windows and time recognised games regardless of origin. They do not
                change your habits, and they depend on recognising executables.
              </li>
            </ol>`,
      },
      {
        heading: "Store counters: free, built in, incomplete",
        body: `            <p>
              If everything you play comes from one store, the store's own counter is
              the right answer and you need nothing else. Steam's is the most complete:
              per-game hours, two-week figures, and a sortable profile list.
            </p>
            <p>
              The moment your library crosses stores, this breaks. Epic, GOG, EA,
              Ubisoft, Battle.net, and the Xbox app each cover a slice, several show
              nothing at all, and none covers the games that belong to no store. See the
              individual guides for
              <a href="/check-playtime-on-steam/">Steam</a>,
              <a href="/check-playtime-epic-games/">Epic</a>,
              <a href="/check-playtime-gog-galaxy/">GOG</a>,
              <a href="/check-playtime-xbox-game-pass/">Game Pass</a>, and
              <a href="/check-playtime-battle-net/">Battle.net</a>.
            </p>`,
      },
      {
        heading: "Playnite: the best choice if you want a library manager",
        body: `            <p>
              Playnite is free, open source, mature, and extremely capable. It imports
              your libraries from many sources, has a large plugin ecosystem, gives you
              a unified and heavily customisable frontend, and records playtime for
              games it launches.
            </p>
            <p>
              If you want one place to browse and start everything you own, Playnite is
              the strongest free option and we would recommend it over our own app for
              that job. The trade-off is that its tracking follows from launching
              through Playnite. If you keep opening games from Steam or a shortcut out
              of habit, the record has holes. We wrote a longer
              <a href="/playcounter-vs-playnite/">PlayCounter vs Playnite comparison</a>
              rather than pretending the choice is obvious.
            </p>`,
      },
      {
        heading: "Community process trackers",
        body: `            <p>
              A handful of smaller Windows tools take the process-watching approach,
              including community projects distributed through GitHub, itch.io, and
              Overwolf, plus older freeware like Gameplay Time Tracker. They vary a lot
              in maintenance status, interface quality, and whether games are recognised
              automatically or must be added by hand.
            </p>
            <p>
              Two things are worth checking before installing any of them: whether the
              project is still actively maintained, and whether the source is available
              for a tool that watches every process on your PC. Both are reasonable
              things to insist on.
            </p>`,
      },
      {
        heading: "PlayCounter, and who it is actually for",
        body: `            <p>
              PlayCounter is our free, MIT-licensed process tracker for Windows. It runs
              in the tray, recognises games automatically by executable, and records
              sessions with cover art, totals, session counts, and history. You do not
              launch games through it and you do not create an account. History stays in
              local app storage.
            </p>
            <p>
              It is a good fit if your games are scattered across launchers, folders, and
              standalone installers and you want a passive record without changing how
              you play.
            </p>
            <p>
              It is the wrong choice if you want a unified launcher (use Playnite), if
              you only play on one store (use its counter), if you need macOS or Linux
              today (Windows only), or if you need your existing hours imported (it
              starts from installation). Games with generic or renamed executables need a
              one-time identification, and emulators are tracked as the emulator rather
              than per ROM.
            </p>`,
      },
      {
        heading: "Quick comparison",
        body: `            <div class="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th></th>
                    <th>Store counters</th>
                    <th>Playnite</th>
                    <th>PlayCounter</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Price</td>
                    <td>Free, built in</td>
                    <td>Free, open source</td>
                    <td>Free, open source</td>
                  </tr>
                  <tr>
                    <td>Covers every launcher</td>
                    <td>No</td>
                    <td>Yes, once imported</td>
                    <td>Yes, when recognised</td>
                  </tr>
                  <tr>
                    <td>Covers non-store games</td>
                    <td>No</td>
                    <td>Yes, added manually</td>
                    <td>Yes, automatically</td>
                  </tr>
                  <tr>
                    <td>Changes how you launch games</td>
                    <td>No</td>
                    <td>Yes</td>
                    <td>No</td>
                  </tr>
                  <tr>
                    <td>Doubles as a launcher</td>
                    <td>Yes</td>
                    <td>Yes</td>
                    <td>No</td>
                  </tr>
                  <tr>
                    <td>Has your historical hours</td>
                    <td>Yes</td>
                    <td>Imported where available</td>
                    <td>No, starts at install</td>
                  </tr>
                </tbody>
              </table>
            </div>`,
      },
    ],
    faq: [
      {
        q: "What is the best free playtime tracker for PC?",
        a: "It depends on your library. One store only: use that store's counter. You want a unified launcher: Playnite. Games scattered across launchers and folders and you do not want to change how you launch them: a process tracker such as PlayCounter.",
      },
      {
        q: "Can I use Playnite and PlayCounter together?",
        a: "Yes. Playnite organises and launches, PlayCounter records what actually runs. They do not conflict, though both will have their own record of the same session.",
      },
      {
        q: "Are playtime trackers safe to install?",
        a: 'A tracker sees which programs run on your PC, so prefer open-source tools you can verify and installers with published checksums. See <a href="/is-playcounter-safe/">is PlayCounter safe</a> for what to check.',
      },
      {
        q: "Do any of these work on macOS or Linux?",
        a: "Playnite is Windows-only. PlayCounter is currently distributed for Windows only. Some community tools target other platforms with varying maturity.",
      },
    ],
    related: [
      { href: "/playcounter-vs-playnite/", label: "PlayCounter vs Playnite" },
      { href: "/total-playtime-across-all-launchers/", label: "Total playtime across all launchers" },
      { href: "/is-playcounter-safe/", label: "Is PlayCounter safe?" },
    ],
    asideTitle: "Try the process tracker",
    asideBody:
      "PlayCounter is free and MIT-licensed. Install it, keep launching games the way you already do, and see the record build itself.",
    ctaBody: cta,
  },

  {
    slug: "game-time-tracker-windows",
    title: "Game Time Tracker for Windows (Free)",
    description:
      "A free game time tracker for Windows that records recognized games automatically, counts hours across every launcher, and keeps the history on your PC.",
    ogTitle: "A free game time tracker for Windows",
    breadcrumb: "Game time tracker",
    eyebrow: "Windows app",
    h1: "A free game time tracker for Windows",
    deck:
      "Game time tracker, playtime counter, hours-played recorder - whatever you call it, the job is the same: know how long you actually played, without babysitting it.",
    sections: [
      {
        heading: "What a game time tracker should do",
        body: `            <p>
              The useful version of this tool has four properties, and most options
              fail at least one of them.
            </p>
            <ul>
              <li>
                <strong>Automatic.</strong> No start button, no stopwatch, no
                remembering. If you have to press anything, you will forget.
              </li>
              <li>
                <strong>Launcher-independent.</strong> It should count a Steam game, a
                Game Pass game, and a folder of extracted files identically.
              </li>
              <li>
                <strong>Local.</strong> A tool that sees every program you run should
                keep that on your machine and be inspectable.
              </li>
              <li>
                <strong>Out of the way.</strong> Tray application, low overhead, no new
                launch routine.
              </li>
            </ul>`,
      },
      {
        heading: "How PlayCounter does it",
        body: `            <p>
              PlayCounter runs in the Windows system tray and watches which applications
              are running. When it recognises a game's executable filename, it opens a
              session; when the process exits, it closes it. That is the whole
              interaction model - there is nothing to press.
            </p>
            <p>
              For matching, the executable filename is sent to PlayCounter's API. On
              Windows the full path is not sent. Sessions, totals, and history are stored
              in local app storage on your PC. There is no account, and cover art is
              fetched from IGDB for recognised titles.
            </p>`,
      },
      {
        heading: "What you see in the app",
        body: `            <ul>
              <li>
                <strong>Now playing</strong> - the running game with its cover, current
                session time, lifetime total, and session count.
              </li>
              <li>
                <strong>Library</strong> - every recognised game you have played, with
                totals and session counts.
              </li>
              <li>
                <strong>History</strong> - session-by-session records you can filter and
                inspect.
              </li>
              <li>
                <strong>Statistics</strong> - how your time distributes across games and
                across days.
              </li>
            </ul>`,
      },
      {
        heading: "Honest limitations",
        body: `            <p>
              It is Windows-only today; macOS and Linux are not distributed. It starts
              counting from installation and does not import existing launcher hours,
              though older sessions can be added manually.
            </p>
            <p>
              Recognition is based on executable filenames, so a new, renamed, or generic
              name may need a one-time local choice. Emulators that share one process
              across ROMs are recorded as the emulator, and browser or cloud-streamed
              games are recorded as the client.
            </p>
            <p>
              None of that changes for the majority of a normal PC library, where games
              have their own executables and are recognised on first launch.
            </p>`,
      },
      {
        heading: "Getting started",
        body: `            <p>
              Download the installer, let PlayCounter start with Windows, and play. The
              first recognised game you launch creates its own entry, and the record
              grows from there. It is free, MIT-licensed, and the installer is published
              on GitHub with release notes and checksums.
            </p>`,
      },
    ],
    faq: [
      {
        q: "Is there a free game time tracker for Windows?",
        a: "Yes. PlayCounter is free and MIT-licensed, with no account and no paid tier. Store counters are also free but only cover their own games.",
      },
      {
        q: "Does it slow down games?",
        a: "It watches running processes from the background and does not hook into or inject anything into games, so it is not an overlay and does not interpose on rendering.",
      },
      {
        q: "Do I need to keep it open while playing?",
        a: "It needs to be running to observe sessions, which is why it can start with Windows and sit in the system tray. The window itself does not need to be open.",
      },
      {
        q: "Can it track applications that are not games?",
        a: "Recognition is aimed at games. Unknown executables can be added as local custom entries, which is how people track other applications they care about.",
      },
    ],
    related: [
      { href: "/total-playtime-across-all-launchers/", label: "Total playtime across all launchers" },
      { href: "/best-free-game-playtime-trackers/", label: "Best free playtime trackers" },
      { href: "/how-automatic-game-detection-works/", label: "How automatic detection works" },
    ],
    asideBody: asideDefault,
    ctaBody: cta,
  },

  {
    slug: "how-much-time-do-i-spend-gaming",
    title: "How Much Time Do I Spend Gaming? Find Out",
    description:
      "A practical way to get a real number for how much you game each week, across every launcher, without guessing or manually logging sessions.",
    ogTitle: "How much time do I actually spend gaming?",
    breadcrumb: "Time spent gaming",
    eyebrow: "Gaming screen time",
    h1: "How much time do I actually spend gaming?",
    deck:
      "Most people are off by a factor of two in both directions. Here is how to get a real number, and what to do with it once you have one.",
    sections: [
      {
        heading: "Why estimates are unreliable",
        body: `            <p>
              People remember sessions, not hours. A long Saturday is memorable; four
              forty-minute weeknight sessions are not, and they add up to more. Play is
              also spread across launchers, so no single number is available to check
              your guess against.
            </p>
            <p>
              Some people overestimate and feel unnecessarily guilty. Others discover
              their casual habit is fifteen hours a week. Both are worth knowing, and
              neither is knowable by memory.
            </p>`,
      },
      {
        heading: "The options for measuring it",
        body: `            <ol>
              <li>
                <strong>Windows screen time.</strong> Windows Family Safety reports
                app usage for a managed account. It is designed for parental controls
                rather than personal review, and it reports applications rather than
                games specifically.
              </li>
              <li>
                <strong>Store counters.</strong> Steam's two-week figure is a decent
                proxy if all your play is on Steam. Otherwise you are adding partial
                numbers from several launchers.
              </li>
              <li>
                <strong>General time-tracking software.</strong> Tools built for
                billable work will log application usage, including games, but present
                it as productivity data rather than a gaming record.
              </li>
              <li>
                <strong>A dedicated game tracker.</strong> Records every recognised game
                automatically, in one place, with the history that makes weekly patterns
                visible.
              </li>
            </ol>`,
      },
      {
        heading: "Getting a real weekly number",
        body: `            <p>
              PlayCounter runs in the background on Windows and records each recognised
              game session as it happens. After a couple of weeks you have something you
              cannot get any other way: an accurate distribution of your gaming time
              across days and across games, from every launcher and every standalone
              game at once.
            </p>
            <p>
              Its statistics view shows how time spreads across your library and across
              recent days, and the history view lists individual sessions with their
              dates. That is enough to answer "is it evenings or weekends?", "is one game
              taking most of it?", and "did this month look different from last month?"
            </p>`,
      },
      {
        heading: "What the number is good for",
        body: `            <p>
              A few uses come up repeatedly. Deciding whether a game was worth the money
              in hours per euro. Noticing that one live-service game absorbed the time
              you meant to spend on your backlog. Setting a personal cap and actually
              knowing whether you kept it. Having a factual answer in a household
              conversation instead of two competing guesses.
            </p>
            <p>
              PlayCounter is a measurement tool, not a wellbeing product. It does not
              block games, enforce limits, or lecture you. It records what happened and
              shows it to you. If you need enforcement rather than measurement, Windows
              Family Safety and similar parental-control tools are the right category.
            </p>
            <p>
              Because the record stays in local app storage and no account is involved,
              the number is yours. Nothing about your play is published anywhere.
            </p>`,
      },
    ],
    faq: [
      {
        q: "How can I see how many hours I game per week?",
        a: "Run a background tracker that records every recognised game automatically, then read the weekly view. Store counters only cover their own games, and manual logging is abandoned within days.",
      },
      {
        q: "Does Windows track how long I play games?",
        a: "Windows Family Safety can report and limit app usage for a managed account. It reports applications generally rather than presenting a gaming-specific history.",
      },
      {
        q: "Can I limit my gaming time with PlayCounter?",
        a: "No. PlayCounter measures and reports; it does not block or restrict. Parental-control tools are the right category for enforcement.",
      },
      {
        q: "Is my playtime data private?",
        a: "Sessions, totals, and history are stored in local app storage on your PC. Automatic matching sends executable filenames without full paths, and no account is required.",
      },
    ],
    related: [
      { href: "/total-playtime-across-all-launchers/", label: "Total playtime across all launchers" },
      { href: "/check-playtime-roblox/", label: "Roblox playtime" },
      { href: "/is-playcounter-safe/", label: "Is PlayCounter safe?" },
    ],
    asideBody: asideDefault,
    ctaBody: cta,
  },

  {
    slug: "steam-replay-alternative",
    title: "A Steam Replay Alternative for Every Game",
    description:
      "Steam Replay only covers Steam games. Here is how to get a year-in-review of your playtime that includes Epic, Game Pass, GOG, and standalone games too.",
    ogTitle: "A year in review for every game, not just Steam",
    breadcrumb: "Steam Replay alternative",
    eyebrow: "Year in review",
    h1: "A Steam Replay alternative that covers every game",
    deck:
      "Steam Replay is a nice end-of-year summary of one storefront. If half your play happens elsewhere, it is a summary of half your year.",
    sections: [
      {
        heading: "What Steam Replay covers",
        body: `            <p>
              Steam Replay summarises your year on Steam: the games you played, roughly
              when you played them, how your time distributed across months, and which
              titles dominated. It is generated from Steam's own records, and it is
              genuinely well done.
            </p>
            <p>
              It also, necessarily, ends at the edge of Steam. Games from the Epic Games
              Store, Game Pass, GOG, EA, Ubisoft, Battle.net, and itch.io are absent, as
              is everything you run from a folder. For a lot of people that is most of
              their year.
            </p>`,
      },
      {
        heading: "Why a complete year in review does not exist",
        body: `            <p>
              No store can build one, because no store sees the others. There is no API
              that exposes a complete, retroactive playtime history across launchers, and
              even where partial data exists the definitions differ. A complete
              retrospective has to be built from your own measurements, which means the
              measuring has to start before the year does.
            </p>`,
      },
      {
        heading: "Build your own, starting now",
        body: `            <p>
              PlayCounter records every recognised game you play on Windows, from every
              source, with dated session history. Leave it running and by the end of the
              year you have the underlying data for a complete retrospective: total time,
              per-game totals, session counts, and the distribution across days and
              months.
            </p>
            <p>
              Unlike a store summary, it includes the free game you got from Epic, the
              Game Pass title you played for a weekend, the twenty-year-old GOG game, and
              the itch.io jam entry. And unlike a store summary, it is built from data on
              your own machine.
            </p>
            <p>
              The catch is the obvious one: it can only summarise what it observed. Install
              it in December and December is what you get. The earlier in the year you
              start, the more complete the picture.
            </p>`,
      },
      {
        heading: "Keep Steam Replay too",
        body: `            <p>
              These are not in competition. Steam Replay remains the better archive of
              your Steam history because Valve has years of it. A local tracker is the way
              to make sure next year's retrospective includes everything else. Use both.
            </p>`,
      },
    ],
    faq: [
      {
        q: "Is there a Steam Replay for other launchers?",
        a: "Not as an official feature. Epic, GOG, and the Xbox app do not produce comparable year-in-review summaries, and none of them can see games outside their own store.",
      },
      {
        q: "Can I get a year in review for all my games?",
        a: "Only by recording your own playtime as it happens. A background tracker on Windows builds the dated history a complete retrospective needs.",
      },
      {
        q: "Does PlayCounter generate a year-in-review page?",
        a: "It records the underlying data - per-game totals, session counts, and dated history - and shows statistics across games and days in the app.",
      },
      {
        q: "Can I include this year retroactively?",
        a: "Not automatically. A tracker can only summarise sessions it observed, though individual older sessions can be added manually.",
      },
    ],
    related: [
      { href: "/check-playtime-on-steam/", label: "Steam playtime" },
      { href: "/total-playtime-across-all-launchers/", label: "Total playtime across all launchers" },
      { href: "/how-much-time-do-i-spend-gaming/", label: "How much time do I spend gaming?" },
    ],
    asideBody: asideDefault,
    ctaBody: cta,
  },

  {
    slug: "is-playcounter-safe",
    title: "Is PlayCounter Safe? What It Does and Sends",
    description:
      "What PlayCounter runs, what data leaves your PC, why Windows may warn about the installer, and how to verify the download for yourself.",
    ogTitle: "Is PlayCounter safe to install?",
    breadcrumb: "Is it safe?",
    eyebrow: "Trust &amp; privacy",
    h1: "Is PlayCounter safe?",
    deck:
      "It is a program that watches which applications run on your PC, so the question is fair. Here is exactly what it does, what it sends, and how to check the claims yourself.",
    sections: [
      {
        heading: "What it actually does",
        body: `            <p>
              PlayCounter runs as a Windows desktop application and periodically looks at
              which processes are running. When it sees an executable filename it
              recognises as a game, it starts a session and stops it when that process
              exits.
            </p>
            <p>
              It does not inject into games, hook rendering, install a driver, or run a
              kernel component. It is not an overlay, and it does not read game memory. It
              is closer to Task Manager than to anti-cheat software.
            </p>`,
      },
      {
        heading: "What leaves your PC",
        body: `            <ul>
              <li>
                <strong>Executable filenames, for matching.</strong> To identify a game,
                the filename such as <code>example.exe</code> is sent to PlayCounter's
                API. On Windows the full path is not sent.
              </li>
              <li>
                <strong>Cover images.</strong> Artwork for recognised games is fetched
                from IGDB.
              </li>
              <li>
                <strong>Update checks.</strong> Version checks and downloads use GitHub.
              </li>
              <li>
                <strong>Anonymous activity, where applicable.</strong> The service
                supports an anonymous live view of what is being played; this is not tied
                to an account because there are no accounts.
              </li>
              <li>
                <strong>Feedback and community match submissions.</strong> These are sent
                only when you choose to send them.
              </li>
            </ul>
            <p>
              What stays local: your session history, per-game totals, settings, and any
              one-time matching choices you make. The
              <a href="/datenschutz.html">privacy notice</a> is the authoritative
              document.
            </p>`,
      },
      {
        heading: "Why Windows may warn you",
        body: `            <p>
              SmartScreen shows a warning for installers it has not seen often enough to
              have built up reputation. This is normal for small independent software and
              is a statement about download volume, not about the contents of the file.
              The warning fades as more people install a given release.
            </p>
            <p>
              Some antivirus engines also flag process-monitoring behaviour heuristically,
              because watching running processes is a behaviour shared with monitoring
              tools generally. If you see a heuristic detection, checking the file on a
              multi-engine scanner usually shows a small number of heuristic hits against
              a majority of clean results.
            </p>`,
      },
      {
        heading: "How to verify it yourself",
        body: `            <ol>
              <li>
                <strong>Read the source.</strong> PlayCounter is MIT-licensed and the
                desktop client and API source are public on
                <a
                  href="https://github.com/zntr1/PlayCounter"
                  target="_blank"
                  rel="noopener noreferrer"
                  >GitHub</a
                >. Everything above can be checked against the code.
              </li>
              <li>
                <strong>Download from the official source only.</strong> Releases are
                published on GitHub with release notes and checksums. Do not install a
                build from anywhere else.
              </li>
              <li>
                <strong>Verify the checksum.</strong> Compare the hash of your downloaded
                installer against the published one before running it.
              </li>
              <li>
                <strong>Watch the traffic.</strong> If you want to confirm what is sent,
                a local network monitor will show you the matching requests directly.
              </li>
            </ol>`,
      },
      {
        heading: "Is it a virus, a miner, or spyware?",
        body: `            <p>
              No, and the way to be confident about that is not our assurance but the
              open source, the published checksums, and the fact that you can inspect both.
              Any tracker of this kind sees which programs you run - that is inherent to
              the job - which is precisely why the reasonable standard is a tool you can
              verify rather than one you have to trust.
            </p>`,
      },
    ],
    faq: [
      {
        q: "Does PlayCounter need administrator rights?",
        a: "Normal operation is reading which processes are running and writing to local app storage. Elevated rights are not part of the tracking model.",
      },
      {
        q: "Will PlayCounter get me banned by anti-cheat?",
        a: "It does not inject into games, hook rendering, or read game memory - it observes which processes exist, similar to Task Manager. It is not an overlay or a game modification.",
      },
      {
        q: "Why does Windows SmartScreen warn about the installer?",
        a: "SmartScreen warns about installers without established download reputation, which is normal for small independent software and is unrelated to the file's contents.",
      },
      {
        q: "Is any of my data sold or shared?",
        a: 'There are no accounts, session history stays on your PC, and matching sends executable filenames without full paths. The <a href="/datenschutz.html">privacy notice</a> is the authoritative statement.',
      },
    ],
    related: [
      { href: "/how-automatic-game-detection-works/", label: "How automatic detection works" },
      { href: "/best-free-game-playtime-trackers/", label: "Best free playtime trackers" },
      { href: "/game-time-tracker-windows/", label: "Game time tracker for Windows" },
    ],
    asideTitle: "Verify, then install",
    asideBody:
      "The desktop client is open source under MIT, and releases ship with published checksums so you can check the installer before running it.",
    ctaBody:
      "Download the current release from GitHub, verify the checksum if you want to, and let PlayCounter build your playtime record locally.",
  },

  {
    slug: "guides",
    title: "PlayCounter Guides: PC Playtime Tracking",
    description:
      "Every guide on checking playtime in PC launchers and games - Steam, Epic, Game Pass, GOG, Battle.net, Riot, Minecraft, Roblox, Fortnite, and emulators.",
    ogTitle: "PlayCounter guides: PC playtime tracking",
    breadcrumb: "All guides",
    eyebrow: "Guide index",
    h1: "PC playtime tracking guides",
    deck:
      "Where every launcher hides its hours, what each number really measures, and how to keep one accurate record across all of them.",
    sections: [
      {
        heading: "Start here",
        body: `            <ul>
              <li>
                <a href="/total-playtime-across-all-launchers/"
                  >How to see your total playtime across all launchers</a
                >
                - why no store can answer this, and what does.
              </li>
              <li>
                <a href="/game-time-tracker-windows/"
                  >A free game time tracker for Windows</a
                >
                - what PlayCounter records and where its limits are.
              </li>
              <li>
                <a href="/how-much-time-do-i-spend-gaming/"
                  >How much time do I actually spend gaming?</a
                >
                - getting a real weekly number.
              </li>
              <li>
                <a href="/best-free-game-playtime-trackers/"
                  >Best free game playtime trackers for PC</a
                >
                - store counters, library managers, and process trackers compared.
              </li>
            </ul>`,
      },
      {
        heading: "Launcher and store guides",
        body: `            <ul>
              <li>
                <a href="/check-playtime-on-steam/">Steam</a> - hours on record, what
                they measure, and what Steam never sees.
              </li>
              <li>
                <a href="/check-playtime-epic-games/">Epic Games Launcher</a> - the
                Time Played column and its gaps.
              </li>
              <li>
                <a href="/check-playtime-xbox-game-pass/">Xbox Game Pass for PC</a> -
                why many PC titles report nothing.
              </li>
              <li>
                <a href="/check-playtime-gog-galaxy/">GOG Galaxy</a> - the DRM-free
                contradiction.
              </li>
              <li>
                <a href="/check-playtime-battle-net/">Battle.net</a> - no launcher
                counter, and where each Blizzard game keeps its own.
              </li>
              <li>
                <a href="/check-playtime-ea-app/">EA app</a> - patchy coverage and the
                Origin migration.
              </li>
              <li>
                <a href="/check-playtime-ubisoft-connect/">Ubisoft Connect</a> - the
                double-launcher problem.
              </li>
              <li>
                <a href="/check-playtime-rockstar-launcher/">Rockstar Games Launcher</a>
                - in-game statistics instead of hours.
              </li>
              <li>
                <a href="/check-playtime-itch-io/">itch.io</a> - indie and jam games
                nothing tracks.
              </li>
            </ul>`,
      },
      {
        heading: "Game-specific guides",
        body: `            <ul>
              <li>
                <a href="/check-playtime-riot-games/">League of Legends and Valorant</a>
                - why third-party hour estimates undercount.
              </li>
              <li>
                <a href="/check-playtime-minecraft/">Minecraft</a> - per-world statistics
                versus real playtime.
              </li>
              <li>
                <a href="/check-playtime-roblox/">Roblox</a> - visits are not hours.
              </li>
              <li>
                <a href="/check-playtime-fortnite/">Fortnite</a> - seasonal stats and
                where lifetime playtime lives.
              </li>
              <li>
                <a href="/playtime-tracker-for-emulators/">Emulated games</a> - the
                one-process problem, explained honestly.
              </li>
            </ul>`,
      },
      {
        heading: "About PlayCounter",
        body: `            <ul>
              <li>
                <a href="/how-automatic-game-detection-works/"
                  >How automatic game detection works</a
                >
                - the matching flow, step by step.
              </li>
              <li>
                <a href="/supported-games/">Which games can PlayCounter track?</a> -
                what is covered and what is not.
              </li>
              <li>
                <a href="/track-playtime-outside-steam/">Tracking outside Steam</a> -
                non-Steam, DRM-free, and portable games.
              </li>
              <li>
                <a href="/playcounter-vs-playnite/">PlayCounter vs Playnite</a> - tracker
                or library manager.
              </li>
              <li>
                <a href="/steam-replay-alternative/">A Steam Replay for every game</a> -
                building a complete year in review.
              </li>
              <li>
                <a href="/is-playcounter-safe/">Is PlayCounter safe?</a> - what it does,
                what it sends, how to verify it.
              </li>
            </ul>`,
      },
    ],
    related: [
      { href: "/total-playtime-across-all-launchers/", label: "Total playtime across all launchers" },
      { href: "/game-time-tracker-windows/", label: "Game time tracker for Windows" },
      { href: "/is-playcounter-safe/", label: "Is PlayCounter safe?" },
    ],
    asideBody: asideDefault,
    ctaBody: cta,
  },
];
