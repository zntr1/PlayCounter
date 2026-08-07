// "Where do I see my hours in X" guides. Each page answers the platform
// question honestly first, then explains the gap PlayCounter fills.

const asideDefault =
  "PlayCounter is a free, open-source playtime tracker for Windows. It times recognized games automatically, whatever you launch them from.";

const cta =
  "Install PlayCounter once and it keeps a local record of the recognized games you play from here on, across every launcher on the PC.";

export const launcherPages = [
  {
    slug: "check-playtime-on-steam",
    title: "How to Check Playtime on Steam (2026 Guide)",
    description:
      "See your hours on record in the Steam client, on your profile, and per game - plus what Steam's playtime counter actually measures and where it misses time.",
    breadcrumb: "Steam playtime",
    eyebrow: "Steam",
    h1: "How to check playtime on Steam",
    deck:
      "Steam records hours for games launched through the Steam client. Here is where to find that number, what it really counts, and what to do about the games Steam never sees.",
    sections: [
      {
        heading: "The quick answer",
        body: `            <p>
              Steam shows playtime in three places:
            </p>
            <ol>
              <li>
                <strong>In your library.</strong> Open the Steam client, select a
                game in the left-hand list, and look under the play button. Steam
                displays the total hours on record and, separately, the hours from
                the past two weeks.
              </li>
              <li>
                <strong>On your Steam profile.</strong> Click your name, then
                <em>Games</em>. The list can be sorted by hours played, which is
                the fastest way to see your all-time top titles.
              </li>
              <li>
                <strong>On the game's own page.</strong> A game you own shows your
                personal hours in the top-right sidebar of its store page.
              </li>
            </ol>
            <p>
              If your profile is set to private, the games list is only visible to
              you while you are signed in. Playtime totals sync to Steam's servers,
              so the same numbers appear on any PC where you log in.
            </p>`,
      },
      {
        heading: "What Steam's number actually measures",
        body: `            <p>
              Steam counts the time between the game process starting and stopping
              while the Steam client is watching it. That is a good approximation
              of play, but it is not a measure of active play. The counter keeps
              running when a game sits paused at a menu, when it is minimised in
              the background, and when you walk away from the PC for an hour with
              the game still open.
            </p>
            <p>
              It also stops counting in situations that surprise people. Time spent
              in a game's separate launcher or configuration tool usually does not
              register. Sessions played in offline mode are held locally and pushed
              on the next sign-in, and a client crash before that sync can drop
              them. Games played through Family Sharing accrue against the account
              that is actually playing.
            </p>`,
      },
      {
        heading: "The games Steam will never count",
        body: `            <p>
              Steam only counts what Steam launches. That leaves a real gap for
              most PC libraries in 2026:
            </p>
            <ul>
              <li>
                Games bought from Epic Games, GOG, Xbox / Game Pass, EA, Ubisoft,
                Battle.net, itch.io, or a developer's own site.
              </li>
              <li>
                DRM-free installers, portable builds, and games copied from an
                external drive or an old disc.
              </li>
              <li>
                Anything you launch straight from its <code>.exe</code> or a desktop
                shortcut, even if you also own it on Steam.
              </li>
              <li>
                Emulated and fan-made games, mod loaders, and standalone tools.
              </li>
            </ul>
            <p>
              Adding a non-Steam shortcut to your library is the usual workaround,
              but it only counts time when you remember to start the game from
              inside Steam, and the entry carries no store metadata or cover art.
            </p>`,
      },
      {
        heading: "Track every game the same way instead",
        body: `            <p>
              PlayCounter takes the opposite approach to a store counter. It runs
              quietly on Windows, watches which applications are actually running,
              and starts a session when it recognises a game's executable. Steam
              games, Epic games, a portable build on a USB stick, and a shortcut on
              the desktop all get timed identically, because the tracker cares about
              the process, not the storefront.
            </p>
            <p>
              You keep launching games exactly as you do now. There is no launcher
              login, no library import, and no account to create. Sessions, totals,
              and history live in local app storage on your PC.
            </p>
            <p>
              One honest limitation: PlayCounter's record starts when you install
              it. It does not import the hundreds of hours already sitting in your
              Steam profile. Those stay in Steam; PlayCounter builds one unified
              timeline going forward, and older sessions can be added by hand.
            </p>`,
      },
      {
        heading: "Steam playtime vs. a launcher-independent tracker",
        body: `            <div class="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Question</th>
                    <th>Steam</th>
                    <th>PlayCounter</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Counts Steam games</td>
                    <td>Yes</td>
                    <td>Yes, when recognised</td>
                  </tr>
                  <tr>
                    <td>Counts Epic, GOG, Game Pass, EA, Ubisoft</td>
                    <td>No</td>
                    <td>Yes, when recognised</td>
                  </tr>
                  <tr>
                    <td>Counts a bare <code>.exe</code> or shortcut</td>
                    <td>Only via a manual shortcut entry</td>
                    <td>Yes, automatically</td>
                  </tr>
                  <tr>
                    <td>Needs an account</td>
                    <td>Yes</td>
                    <td>No</td>
                  </tr>
                  <tr>
                    <td>Where history is stored</td>
                    <td>Valve's servers</td>
                    <td>Locally on your PC</td>
                  </tr>
                  <tr>
                    <td>Has your pre-existing hours</td>
                    <td>Yes</td>
                    <td>No, it starts from install</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p>
              The two are complements rather than replacements. Steam keeps the
              historical archive for one store; PlayCounter answers "how much have I
              played lately, across everything?"
            </p>`,
      },
    ],
    faq: [
      {
        q: "Why is my Steam playtime wrong or missing hours?",
        a: "The usual causes are offline sessions that never synced, a game launched outside the Steam client, or a title that runs through a second launcher process which Steam stops watching. Steam also cannot retroactively add time it did not observe.",
      },
      {
        q: "Does Steam count idle or AFK time?",
        a: "Yes. Steam measures how long the game process runs, not how long you are at the keyboard, so paused menus and minimised windows still accumulate hours.",
      },
      {
        q: "Can I see my total hours across all Steam games?",
        a: 'Steam does not show a single lifetime total in the client. Your profile\'s <em>Games</em> tab lists per-game hours and can be sorted, and third-party sites can sum them if your profile is public. For a total across every launcher, see the <a href="/total-playtime-across-all-launchers/">cross-launcher playtime guide</a>.',
      },
      {
        q: "Can Steam track non-Steam games?",
        a: 'Only if you add the game as a non-Steam shortcut and always start it through Steam. A process-based tracker avoids that requirement entirely - see <a href="/track-playtime-outside-steam/">tracking playtime outside Steam</a>.',
      },
    ],
    related: [
      { href: "/track-playtime-outside-steam/", label: "Track playtime outside Steam" },
      { href: "/total-playtime-across-all-launchers/", label: "Total playtime across all launchers" },
      { href: "/steam-replay-alternative/", label: "A Steam Replay for every game" },
    ],
    asideBody: asideDefault,
    ctaBody: cta,
  },

  {
    slug: "check-playtime-epic-games",
    title: "How to Check Playtime on Epic Games Launcher",
    description:
      "Find your hours played in the Epic Games Launcher library and profile, understand what Epic does and does not count, and track every other game the same way.",
    breadcrumb: "Epic Games playtime",
    eyebrow: "Epic Games",
    h1: "How to check playtime in the Epic Games Launcher",
    deck:
      "Epic added playtime later than Steam did, and it is tucked away in two places most people never open. Here is where to look, and what the number leaves out.",
    sections: [
      {
        heading: "Where Epic hides your hours",
        body: `            <p>
              There are three routes to the same number in the Epic Games Launcher:
            </p>
            <ol>
              <li>
                <strong>The three-dot menu.</strong> In your Library, hover a game,
                click the three dots next to its title, and read the
                <em>You've played</em> line.
              </li>
              <li>
                <strong>List view.</strong> Switch your Library from grid to list
                using the bulleted-list icon near the top of the view. A
                <em>Time Played</em> column appears next to each title, which makes
                it easy to scan the whole library at once.
              </li>
              <li>
                <strong>Your profile.</strong> Open your profile and go to the
                <em>Games</em> tab, where hours played sit beside each title.
              </li>
            </ol>
            <p>
              Games you have never launched through Epic show no value at all rather
              than zero.
            </p>`,
      },
      {
        heading: "What Epic counts and what it quietly skips",
        body: `            <p>
              Epic's counter, like Steam's, measures how long the game process ran
              while the launcher was supervising it. Two consequences matter in
              practice.
            </p>
            <p>
              First, a game started directly from its installation folder, from a
              desktop shortcut created by something other than Epic, or through a
              third-party frontend may never be seen by the launcher. Second,
              Epic's tracking began partway through the store's life, so time
              played in the early years of a free-giveaway title is often simply
              absent. Many people find a game they clearly sank a weekend into
              reporting a couple of hours, or nothing.
            </p>
            <p>
              There is no way to correct that inside Epic. The launcher offers no
              manual editing of playtime and no import from another source.
            </p>`,
      },
      {
        heading: "The bigger problem: your library is not one library",
        body: `            <p>
              Epic playtime answers one narrow question - how long you spent in
              games Epic launched. If you claimed dozens of free games there but
              actually play across Steam, Game Pass, GOG, and a folder of
              standalone installers, no single launcher can tell you where your
              gaming time went this month.
            </p>
            <p>
              Checking four launchers and adding the numbers up by hand does not
              work either, because each store defines and truncates the value
              differently, and none of them counts the games that belong to no
              store.
            </p>`,
      },
      {
        heading: "Track Epic and everything else in one place",
        body: `            <p>
              PlayCounter sits in the Windows system tray and watches which
              applications are running. When it recognises a game's executable, it
              starts timing; when the process exits, it closes the session. Epic
              titles are timed whether you start them from the Epic launcher, from
              a shortcut, or from the game folder, because none of that changes the
              process that runs.
            </p>
            <p>
              The same mechanism covers your Steam, GOG, Game Pass, EA, Ubisoft,
              Battle.net, itch.io, and unaffiliated games, giving you one list
              sorted by the time you actually spent. No account, no library import,
              and history stays on your PC.
            </p>
            <p>
              To be clear about the trade-off: PlayCounter will not backfill the
              hours Epic already recorded, and a game with an unusual or renamed
              executable may need you to identify it once. After that, it is
              automatic.
            </p>`,
      },
    ],
    faq: [
      {
        q: "Why does the Epic Games Launcher show no playtime for a game?",
        a: "Either the game was never launched through Epic, or it was played before Epic began recording playtime for that title. The launcher has no way to recover time it did not observe.",
      },
      {
        q: "Does Epic track playtime for games launched outside the launcher?",
        a: "Generally no. Epic needs to start the game to supervise the process. Starting it from the install folder or a non-Epic shortcut usually produces no recorded time.",
      },
      {
        q: "Can I see Fortnite hours in the Epic Games Launcher?",
        a: 'Fortnite playtime is handled separately from the library counter. See the <a href="/check-playtime-fortnite/">Fortnite playtime guide</a> for the options that exist.',
      },
      {
        q: "Is there a way to edit or correct Epic playtime?",
        a: "The launcher provides no manual editing. A separate local tracker is the only practical way to keep an accurate ongoing record you control.",
      },
    ],
    related: [
      { href: "/check-playtime-fortnite/", label: "Fortnite playtime" },
      { href: "/total-playtime-across-all-launchers/", label: "Total playtime across all launchers" },
      { href: "/supported-games/", label: "Which games are supported?" },
    ],
    asideBody: asideDefault,
    ctaBody: cta,
  },

  {
    slug: "check-playtime-xbox-game-pass",
    title: "Check Playtime on Xbox Game Pass for PC",
    description:
      "How to see time played for Xbox app and Game Pass games on Windows, why many PC titles report nothing, and how to track the whole library automatically.",
    breadcrumb: "Game Pass playtime",
    eyebrow: "Xbox &amp; Game Pass",
    h1: "How to check playtime on Xbox Game Pass for PC",
    deck:
      "The Xbox app on Windows has no playtime column. The number exists, but it lives in your Xbox profile stats, and only for games that report it.",
    sections: [
      {
        heading: "Where the number lives",
        body: `            <p>
              Microsoft ties time played to your Xbox profile rather than to the PC
              app's library, so you check it the same way whether you played on a
              console or on Windows:
            </p>
            <ol>
              <li>
                <strong>In the Xbox app or on the console.</strong> Open your
                profile, go to <em>Achievements</em>, pick a game, and open its
                stats. Time played appears among the recorded statistics.
              </li>
              <li>
                <strong>On the web.</strong> Sign in at
                <code>account.xbox.com</code>, open your Xbox profile, then
                <em>Achievements</em>, and select a game to see its stats.
              </li>
            </ol>
            <p>
              There is no single screen that totals your library, and no way to sort
              games by hours played. You look up one title at a time.
            </p>`,
      },
      {
        heading: "Why so many PC games show nothing",
        body: `            <p>
              Time played is reported by the game through Xbox services, not
              measured by the launcher. A PC title that ships without full Xbox
              integration - and a large share of Game Pass PC titles fall into this
              group - simply never reports the statistic. You get achievements but
              no hours, or no stats page at all.
            </p>
            <p>
              This is the single biggest complaint about Game Pass on PC for anyone
              who likes tracking their library. Because Game Pass encourages trying
              a lot of games briefly, it is exactly the service where you would most
              want a reliable record of what you actually played and for how long.
            </p>`,
      },
      {
        heading: "The rotation problem",
        body: `            <p>
              Game Pass titles leave the catalogue. When a game rotates out and you
              uninstall it, whatever partial record existed becomes even harder to
              find, and the game disappears from your installed library entirely.
              A month later it is genuinely difficult to answer "did I play that,
              and was it worth buying?"
            </p>
            <p>
              A local tracker keeps its own entry regardless of whether the game is
              still installed or still in the catalogue, which turns Game Pass into
              something you can review at the end of a subscription month.
            </p>`,
      },
      {
        heading: "Tracking Game Pass PC games automatically",
        body: `            <p>
              Game Pass games on Windows are still ordinary Windows processes.
              PlayCounter runs in the background, recognises the executable, and
              times the session - whether the game was started from the Xbox app,
              from a pinned Start menu tile, or from a desktop shortcut.
            </p>
            <p>
              The result is one library view with cover art, per-game totals,
              session counts, and recent history that includes your Game Pass
              titles next to your Steam, Epic, and standalone games. Nothing is
              tied to a Microsoft account, and the record stays on the PC.
            </p>
            <p>
              Two caveats worth stating plainly. Some Microsoft Store and Game Pass
              titles install into protected folders with unusual executable names,
              so an occasional game needs a one-time local identification. And
              PlayCounter starts counting from install; it cannot recover the hours
              Xbox never recorded in the first place.
            </p>`,
      },
    ],
    faq: [
      {
        q: "Why does the Xbox app not show time played for my PC game?",
        a: "Time played is a statistic the game reports through Xbox services. Many Game Pass PC titles do not implement it, so no value is ever recorded.",
      },
      {
        q: "Can I see total hours across my whole Game Pass library?",
        a: "Not through Microsoft. Stats are per game and must be opened individually, with no library-wide total or sorting.",
      },
      {
        q: "Does Game Pass playtime carry over between PC and console?",
        a: "For titles that report the statistic, time played is attached to your Xbox profile and combines play across devices. Titles that do not report it show nothing on either platform.",
      },
      {
        q: "What happens to my record when a game leaves Game Pass?",
        a: "Microsoft's stats remain tied to the game entry, but the title disappears from your installed library. A local tracker keeps its own history whether or not the game is still in the catalogue.",
      },
    ],
    related: [
      { href: "/total-playtime-across-all-launchers/", label: "Total playtime across all launchers" },
      { href: "/how-automatic-game-detection-works/", label: "How automatic detection works" },
      { href: "/supported-games/", label: "Which games are supported?" },
    ],
    asideBody: asideDefault,
    ctaBody: cta,
  },

  {
    slug: "check-playtime-gog-galaxy",
    title: "How to Check Playtime in GOG Galaxy",
    description:
      "See hours played in GOG Galaxy, understand why offline and DRM-free launches go uncounted, and keep an accurate record of every GOG game you play.",
    breadcrumb: "GOG Galaxy playtime",
    eyebrow: "GOG",
    h1: "How to check playtime in GOG Galaxy",
    deck:
      "GOG Galaxy tracks hours for games it launches, which is awkward for a store whose whole appeal is DRM-free games you can run without the client.",
    sections: [
      {
        heading: "Finding hours played in Galaxy",
        body: `            <p>
              Open GOG Galaxy, select a game in your library, and its details panel
              shows time played alongside the last-played date. Galaxy's integration
              plugins can also pull playtime from connected accounts such as Steam,
              so a game you own in several places may show a combined figure.
            </p>
            <p>
              What Galaxy has never offered is a first-class way to sort or total the
              whole library by hours. It is a long-standing community request. You
              can build custom library views with filters and tags, but ranking every
              game by time played is not among the built-in sorts.
            </p>`,
      },
      {
        heading: "The DRM-free contradiction",
        body: `            <p>
              GOG's defining feature is that you can download an offline installer,
              install the game, and run it forever without a client. That is also
              exactly the situation in which Galaxy records nothing. Double-click the
              game's executable and no time is logged, because the client was not
              involved.
            </p>
            <p>
              Plenty of GOG customers keep Galaxy uninstalled on principle, or use it
              only to download. For them the store's own playtime figure is
              permanently near zero regardless of how much they play.
            </p>`,
      },
      {
        heading: "Over-counting is a real complaint too",
        body: `            <p>
              The opposite failure also shows up: sessions that keep accruing after
              you stop playing. When Galaxy hands off to another launcher, or when a
              game exits to a separate configuration process, the client can keep a
              session open longer than the game actually ran. Users have reported
              both missing hours and inflated ones, which makes the number hard to
              trust for anything precise.
            </p>`,
      },
      {
        heading: "A tracker that does not care how you launched it",
        body: `            <p>
              PlayCounter watches Windows processes rather than launcher events. A
              GOG game gets timed identically whether you started it from Galaxy,
              from an offline installer's desktop shortcut, from the game folder, or
              from a portable copy on an external drive. The session begins when the
              recognised executable appears and ends when it exits.
            </p>
            <p>
              That makes it a natural fit for a DRM-free library: you keep the
              freedom that made you buy from GOG in the first place, and still get a
              playtime record. Everything stays local, no account is required, and
              the app is MIT-licensed and open source, which you can verify yourself.
            </p>`,
      },
    ],
    faq: [
      {
        q: "Does GOG Galaxy track games launched outside the client?",
        a: "No. Galaxy records time for sessions it starts. Running a DRM-free installation directly produces no recorded playtime.",
      },
      {
        q: "Can I sort my GOG library by hours played?",
        a: "Galaxy shows time played per game but has never offered a built-in sort or total by hours across the library. It remains a frequently requested feature.",
      },
      {
        q: "Why is my GOG playtime higher than expected?",
        a: "Galaxy can keep a session open when a game hands off to another process or launcher, so time continues accruing after you have actually stopped playing.",
      },
      {
        q: "Do I need to keep Galaxy installed to track playtime?",
        a: 'Not if you use a process-based tracker. PlayCounter records recognised games with no client running - see <a href="/how-automatic-game-detection-works/">how detection works</a>.',
      },
    ],
    related: [
      { href: "/track-playtime-outside-steam/", label: "Track playtime outside Steam" },
      { href: "/how-automatic-game-detection-works/", label: "How automatic detection works" },
      { href: "/total-playtime-across-all-launchers/", label: "Total playtime across all launchers" },
    ],
    asideBody: asideDefault,
    ctaBody: cta,
  },

  {
    slug: "check-playtime-battle-net",
    title: "How to Check Playtime on Battle.net Games",
    description:
      "The Battle.net launcher has no hours-played column. Here is where each Blizzard game hides its own playtime, and how to track them all in one place.",
    breadcrumb: "Battle.net playtime",
    eyebrow: "Battle.net",
    h1: "How to check playtime on Battle.net",
    deck:
      "There is no playtime column in the Battle.net app. Each Blizzard game keeps its own version of the number, in its own place, in its own format.",
    sections: [
      {
        heading: "The launcher itself shows nothing",
        body: `            <p>
              This surprises people coming from Steam, but the Battle.net desktop app
              is a downloader and patcher. It lists your games, it does not report
              how long you have played them. There is no hours column, no per-game
              total, and no profile page that sums your time across Blizzard titles.
            </p>
            <p>
              Everything below is per game, and each one works differently.
            </p>`,
      },
      {
        heading: "Where each Blizzard game keeps the number",
        body: `            <ul>
              <li>
                <strong>World of Warcraft.</strong> Type <code>/played</code> in
                chat. It reports total time on the current character and time at the
                current level. There is no account-wide total in the client; you
                check character by character.
              </li>
              <li>
                <strong>Overwatch.</strong> Career profile statistics include time
                played, broken down by hero and by mode. The presentation has changed
                across versions and seasons, and historical data has been reset in
                the past.
              </li>
              <li>
                <strong>Diablo IV.</strong> Character screens show time played per
                character rather than an account total.
              </li>
              <li>
                <strong>Hearthstone, StarCraft II, Heroes of the Storm.</strong> No
                reliable in-client playtime figure. Games played and ranked records
                exist, hours generally do not.
              </li>
            </ul>
            <p>
              If a game you play is not in that list, assume the number is not
              exposed. Blizzard has never treated total playtime as a headline
              statistic the way Valve does.
            </p>`,
      },
      {
        heading: "Why per-character totals are not what you wanted",
        body: `            <p>
              A <code>/played</code> figure answers "how long has this character
              existed in play", which is a different question from "how much of my
              life went into this game". Anyone with several characters, or with
              years across an account, has to add numbers up manually and still
              misses time on deleted characters and other Blizzard titles entirely.
            </p>`,
      },
      {
        heading: "One consistent number for every Blizzard game",
        body: `            <p>
              PlayCounter times the Windows process. Launch World of Warcraft,
              Overwatch, or Diablo IV however you normally do, and each gets a
              session recorded at the game level, with a running total and a session
              count. It works the same way for the non-Blizzard games on the PC, so
              you can compare them directly.
            </p>
            <p>
              It measures real elapsed time with the game running, so it counts
              queueing, menu time, and idling in a capital city - the same behaviour
              as every store counter. And because it identifies games by executable,
              it keeps working when Blizzard reorganises a client or resets its own
              statistics.
            </p>`,
      },
    ],
    faq: [
      {
        q: "Does the Battle.net launcher show hours played?",
        a: "No. The Battle.net desktop app lists and updates your games but does not record or display playtime for them.",
      },
      {
        q: "How do I see total played time in WoW?",
        a: "The <code>/played</code> command reports total time for the current character and time at the current level. There is no built-in account-wide total, so multiple characters must be added manually.",
      },
      {
        q: "Can I see Overwatch hours played?",
        a: "Career profile statistics include time played per hero and mode, though the layout has changed between versions and some historical data has been reset.",
      },
      {
        q: "Is there a way to track all Blizzard games together?",
        a: "Not through Blizzard. A process-based tracker on Windows records each game the same way and puts them in one list with everything else you play.",
      },
    ],
    related: [
      { href: "/total-playtime-across-all-launchers/", label: "Total playtime across all launchers" },
      { href: "/supported-games/", label: "Which games are supported?" },
      { href: "/how-automatic-game-detection-works/", label: "How automatic detection works" },
    ],
    asideBody: asideDefault,
    ctaBody: cta,
  },

  {
    slug: "check-playtime-ea-app",
    title: "How to Check Playtime in the EA App",
    description:
      "Where the EA app shows hours played, why the figure is inconsistent between titles, and how to keep a reliable record of EA games on Windows.",
    breadcrumb: "EA app playtime",
    eyebrow: "EA app",
    h1: "How to check playtime in the EA app",
    deck:
      "The EA app can show hours for some titles on the game's details page. Coverage is patchy, and the migration from Origin left gaps that were never filled.",
    sections: [
      {
        heading: "Where to look",
        body: `            <p>
              Open the EA app, go to <em>My Collection</em>, and select a game. Where
              the statistic is available, total time played appears on the game's
              details page alongside the last-played date.
            </p>
            <p>
              Treat this as "check whether it is there" rather than a guaranteed
              feature. Some titles show a total, some show only a last-played date,
              and some show neither. There is no library-wide total and no sort by
              hours.
            </p>`,
      },
      {
        heading: "Why the numbers are unreliable",
        body: `            <p>
              Three things work against EA's counter. The move from Origin to the EA
              app reorganised how library data was stored, and plenty of users
              reported playtime that changed or vanished in the transition. EA titles
              also frequently launch a second process or an in-game overlay, which
              can end the session the launcher was watching while you are still
              playing. And several EA games are also sold on Steam, where a separate
              counter records the same play.
            </p>
            <p>
              For a game like The Sims 4 or Apex Legends, where you may have owned it
              through Origin, the EA app, and Steam over the years, no single number
              anywhere reflects the whole history.
            </p>`,
      },
      {
        heading: "In-game statistics are a partial workaround",
        body: `            <p>
              Some EA titles surface their own figures. Apex Legends shows per-legend
              statistics in the legend menu, and various sports titles keep season
              records. These are game-specific, are reset by seasons or new editions,
              and never combine into a total. They answer a different question from
              "how many hours have I put into this".
            </p>`,
      },
      {
        heading: "Keep your own record instead",
        body: `            <p>
              PlayCounter does not ask EA anything. It watches Windows processes,
              recognises the game, and times it from launch to exit. That produces a
              consistent number for every EA title you play, using the same rules
              applied to your Steam, Epic, and Game Pass games.
            </p>
            <p>
              Because it identifies games by their executable, it is unaffected by
              account migrations, launcher rewrites, and store reshuffles. The record
              is stored locally, requires no account, and the source is public if you
              want to check what it does.
            </p>
            <p>
              Where EA games run through a wrapper or a shared launcher process,
              PlayCounter may need you to confirm the match once. After that
              confirmation is stored locally, tracking is automatic.
            </p>`,
      },
    ],
    faq: [
      {
        q: "Does the EA app show hours played for every game?",
        a: "No. Availability varies by title. Some games show a total on the details page, others show only a last-played date, and some show nothing.",
      },
      {
        q: "Did my playtime disappear when Origin became the EA app?",
        a: "Playtime inconsistencies after the migration are a common report. EA provides no way to restore or manually correct the figure.",
      },
      {
        q: "How do I check Apex Legends hours?",
        a: "Apex exposes per-legend statistics in-game rather than a single lifetime total. A process-based tracker on Windows gives you one continuous total instead.",
      },
      {
        q: "Does the EA app count time if I launch from Steam?",
        a: "An EA title bought on Steam is generally counted by Steam, and may or may not also register in the EA app depending on how it launches. Separate counters for the same game are common.",
      },
    ],
    related: [
      { href: "/check-playtime-on-steam/", label: "Steam playtime" },
      { href: "/total-playtime-across-all-launchers/", label: "Total playtime across all launchers" },
      { href: "/supported-games/", label: "Which games are supported?" },
    ],
    asideBody: asideDefault,
    ctaBody: cta,
  },

  {
    slug: "check-playtime-ubisoft-connect",
    title: "Check Playtime on Ubisoft Connect",
    description:
      "Where Ubisoft Connect shows time played, why the figure differs from Steam and Epic for the same game, and how to keep one accurate total on Windows.",
    breadcrumb: "Ubisoft Connect playtime",
    eyebrow: "Ubisoft Connect",
    h1: "How to check playtime on Ubisoft Connect",
    deck:
      "Ubisoft Connect surfaces time played on a game's page for titles with statistics integration - which is not all of them, and rarely matches what other stores report.",
    sections: [
      {
        heading: "Finding the figure",
        body: `            <p>
              In the Ubisoft Connect desktop client, open <em>Games</em>, select a
              title, and look at its overview and statistics. For supported games,
              time played appears with the other tracked stats such as challenges and
              units. Your Ubisoft profile on the web shows a similar view for games
              tied to the account.
            </p>
            <p>
              As with the other publisher launchers, there is no library-wide total
              and no way to rank your games by hours.
            </p>`,
      },
      {
        heading: "The double-launcher problem",
        body: `            <p>
              Ubisoft games are unusual in how often they run through two launchers
              at once. Buy Assassin's Creed or Far Cry on Steam or Epic and the game
              still starts Ubisoft Connect, which starts the game. Each layer has its
              own idea of when the session began and ended.
            </p>
            <p>
              The practical result is three different numbers for one game: what
              Steam recorded, what Ubisoft Connect recorded, and what you actually
              played. Time spent sitting in the Connect launcher, waiting for an
              update or a sign-in, is counted by some layers and not others.
            </p>`,
      },
      {
        heading: "Ubisoft+ makes it worse",
        body: `            <p>
              Subscription access means installing a game, playing it for a while,
              and removing it. Nothing keeps a durable record across those cycles,
              and a title you cancelled six months ago is hard to look up at all. If
              you subscribe periodically, a local record is the only way to know what
              a subscription month actually gave you.
            </p>`,
      },
      {
        heading: "One number, measured the same way every time",
        body: `            <p>
              PlayCounter ignores the launcher chain and times the game's own
              process. When Assassin's Creed's executable is running, the session is
              running; when it exits, the session closes. That gives you a figure
              measured the same way for Ubisoft, Steam, Epic, Game Pass, and
              standalone games, so comparisons across your library actually mean
              something.
            </p>
            <p>
              Because launchers themselves are processes too, PlayCounter is designed
              to track recognised games rather than the launcher shells around them.
              Where an unusual wrapper makes a title ambiguous, you confirm the match
              once and the choice is remembered locally.
            </p>`,
      },
    ],
    faq: [
      {
        q: "Why does Ubisoft Connect show different hours than Steam?",
        a: "Both are watching, but each starts and stops its session at different moments in the launcher chain, and time spent in the Connect client itself is treated differently by each.",
      },
      {
        q: "Does Ubisoft Connect track playtime for every game?",
        a: "Only for titles with statistics integration. Older and smaller releases often show no time-played figure at all.",
      },
      {
        q: "Can I see total hours across all my Ubisoft games?",
        a: "There is no library-wide total in the client or on the web profile. You check games individually.",
      },
      {
        q: "What happens to my record when a Ubisoft+ subscription ends?",
        a: "Access to the games ends and their entries become hard to review. A local tracker keeps its own history regardless of subscription status.",
      },
    ],
    related: [
      { href: "/total-playtime-across-all-launchers/", label: "Total playtime across all launchers" },
      { href: "/check-playtime-on-steam/", label: "Steam playtime" },
      { href: "/how-automatic-game-detection-works/", label: "How automatic detection works" },
    ],
    asideBody: asideDefault,
    ctaBody: cta,
  },

  {
    slug: "check-playtime-riot-games",
    title: "How to Check Playtime on Riot Games (LoL, Valorant)",
    description:
      "Riot does not show total hours for League of Legends or Valorant. Here are the workarounds that exist, their limits, and how to record your real playtime.",
    breadcrumb: "Riot playtime",
    eyebrow: "Riot Games",
    h1: "How to check playtime in League of Legends and Valorant",
    deck:
      "Riot has never shipped a total-hours figure. The Riot Client shows none, the games show none, and the third-party estimates people rely on are estimates.",
    sections: [
      {
        heading: "The honest answer: Riot does not tell you",
        body: `            <p>
              There is no playtime counter in the Riot Client. League of Legends does
              not show lifetime hours. Valorant does not show lifetime hours. Teamfight
              Tactics and Legends of Runeterra do not either. This is not a hidden
              menu - the number is simply not exposed.
            </p>
            <p>
              What Riot does expose is match history, and only a recent window of it.
              That is the raw material behind every workaround below.
            </p>`,
      },
      {
        heading: "What the third-party sites are really doing",
        body: `            <p>
              Tracker sites estimate your hours by counting matches and multiplying by
              an average match length, sometimes refined by queue type. It is a
              reasonable approximation of time in games, and it systematically
              undercounts your actual time in the client.
            </p>
            <p>
              Everything outside a match is invisible to that method: champion select,
              queueing, dodges, post-game screens, browsing the shop, watching
              cosmetics, sitting in the lobby with friends. For a game where you can
              easily spend fifteen minutes per match outside the match, the gap is
              substantial. These sites also depend on account lookups, region support,
              and API access that changes over time.
            </p>`,
      },
      {
        heading: "Old League accounts have another problem",
        body: `            <p>
              Match history retention is limited. If you started playing League in
              2014, no service can reconstruct those years from data Riot no longer
              serves. Any "total hours" figure for a long-lived account is a partial
              estimate of a partial record.
            </p>`,
      },
      {
        heading: "Measure the client directly instead",
        body: `            <p>
              A process-based tracker sidesteps the whole problem. PlayCounter records
              the time the game client is actually running on your PC. That includes
              queue time, champion select, and everything else the match-count method
              cannot see, and it does not depend on Riot's API, your region, or your
              account being public.
            </p>
            <p>
              Two things to know. Riot games run through the Riot Client, which starts
              the game as a separate process, so an initial one-time confirmation may
              be needed to tie the right executable to the right game. And this only
              measures forward from installation - it cannot recover the years already
              played.
            </p>
            <p>
              What you get in exchange is a real, continuously growing number for
              League or Valorant next to the same number for every other game on the
              PC, held locally and tied to no account.
            </p>`,
      },
    ],
    faq: [
      {
        q: "Does League of Legends show total hours played?",
        a: "No. Neither the Riot Client nor the game exposes a lifetime hours figure. Only recent match history is available.",
      },
      {
        q: "Are third-party League hour counters accurate?",
        a: "They estimate from match counts and average durations. That misses champion select, queue time, and lobby time entirely, and it cannot see matches older than Riot's retention window.",
      },
      {
        q: "Can I see how many hours I have in Valorant?",
        a: "Riot does not provide the figure. Third-party sites estimate it from matches. A local process tracker measures the client's actual running time from the day you install it.",
      },
      {
        q: "Does a local tracker count time in champion select and queue?",
        a: "Yes. It measures how long the game client runs, which includes queueing, champion select, and post-game screens as well as matches.",
      },
    ],
    related: [
      { href: "/how-automatic-game-detection-works/", label: "How automatic detection works" },
      { href: "/total-playtime-across-all-launchers/", label: "Total playtime across all launchers" },
      { href: "/supported-games/", label: "Which games are supported?" },
    ],
    asideBody: asideDefault,
    ctaBody: cta,
  },

  {
    slug: "check-playtime-rockstar-launcher",
    title: "Check Playtime on the Rockstar Games Launcher",
    description:
      "The Rockstar Games Launcher has no hours column. Here is what GTA and Red Dead expose in-game, and how to track your real time on Windows.",
    breadcrumb: "Rockstar playtime",
    eyebrow: "Rockstar Games",
    h1: "How to check playtime on the Rockstar Games Launcher",
    deck:
      "Rockstar's launcher lists and updates your games. It does not tell you how long you have played them, and the in-game statistics only cover part of the story.",
    sections: [
      {
        heading: "The launcher has no playtime figure",
        body: `            <p>
              The Rockstar Games Launcher is built around downloads, updates, and
              Social Club sign-in. There is no hours-played column, no per-game total,
              and no way to sort a library by time. If you bought GTA V or Red Dead
              Redemption 2 through Rockstar directly, the launcher will not answer the
              question.
            </p>`,
      },
      {
        heading: "What the games themselves track",
        body: `            <p>
              Rockstar titles keep detailed in-game statistics, but they are gameplay
              statistics rather than a session log.
            </p>
            <ul>
              <li>
                <strong>GTA Online</strong> tracks a large set of career stats through
                the pause menu and Social Club. Time-related entries exist but are
                specific to activities rather than a clean total.
              </li>
              <li>
                <strong>Red Dead Redemption 2</strong> exposes completion percentage
                and extensive progress statistics, which correlate with time played
                without measuring it.
              </li>
              <li>
                <strong>GTA V story mode</strong> reports completion rather than
                hours.
              </li>
            </ul>
            <p>
              None of these tells you that you spent 240 hours in the game, and none
              of them combine story mode and online play into a single figure.
            </p>`,
      },
      {
        heading: "Same game, three storefronts",
        body: `            <p>
              GTA V has been sold through Steam, the Epic Games Store, and Rockstar
              directly, and has been given away free. Many players own it in more than
              one place and have moved between copies over the years. Each copy has
              its own counter, or none at all, and nothing merges them.
            </p>`,
      },
      {
        heading: "Track it like any other game",
        body: `            <p>
              PlayCounter records the time the game's process runs on Windows. It does
              not matter whether the copy came from Rockstar, Steam, or Epic, or which
              launcher chain started it - the executable is what gets timed.
            </p>
            <p>
              You get a straightforward total and session count for GTA V, Red Dead
              Redemption 2, or any other Rockstar title, in the same list as the rest
              of your library. Nothing is sent to Rockstar, no account is involved,
              and the history stays on your PC.
            </p>`,
      },
    ],
    faq: [
      {
        q: "Does the Rockstar Games Launcher show hours played?",
        a: "No. The launcher handles installation, updates, and sign-in, and does not record or display playtime.",
      },
      {
        q: "How do I see my GTA Online hours?",
        a: "GTA Online exposes career statistics through the pause menu and Social Club, but these are activity statistics rather than a single total-hours figure.",
      },
      {
        q: "Does Social Club track time played?",
        a: "Social Club shows game statistics and progress rather than a clean per-game hours total, and it does not combine story and online play into one number.",
      },
      {
        q: "I own GTA V on Steam and Rockstar - can the hours be merged?",
        a: "Not by either service. A local tracker records the game itself, so all your sessions land in one entry regardless of which copy you launched.",
      },
    ],
    related: [
      { href: "/check-playtime-on-steam/", label: "Steam playtime" },
      { href: "/total-playtime-across-all-launchers/", label: "Total playtime across all launchers" },
      { href: "/track-playtime-outside-steam/", label: "Track playtime outside Steam" },
    ],
    asideBody: asideDefault,
    ctaBody: cta,
  },

  {
    slug: "check-playtime-itch-io",
    title: "How to Track Playtime for itch.io Games",
    description:
      "itch.io does not track hours played. Here is why indie and jam games fall through every launcher's cracks, and how to record them automatically on Windows.",
    breadcrumb: "itch.io playtime",
    eyebrow: "itch.io",
    h1: "How to track playtime for itch.io games",
    deck:
      "itch.io is a storefront and a downloader, not a playtime service. If you play a lot of indie and jam games, nothing anywhere is keeping score.",
    sections: [
      {
        heading: "There is no playtime feature",
        body: `            <p>
              The itch.io desktop app installs, updates, and launches games. It does
              not record how long you played them, and the website shows purchases and
              downloads rather than sessions. This is not an oversight so much as a
              design choice - itch.io is deliberately lightweight and
              developer-friendly rather than a platform that instruments your play.
            </p>`,
      },
      {
        heading: "Why indie libraries are the worst-tracked libraries",
        body: `            <p>
              An itch.io collection tends to be large, cheap, and varied: bundle
              purchases with hundreds of titles, game jam entries, demos, prototypes,
              and small experimental releases. Many are downloaded as a plain zip and
              run from wherever you extracted them, with no installer and no shortcut.
            </p>
            <p>
              That is the exact profile of games that every launcher-based tracker
              ignores. If a meaningful share of your play happens in small indie games,
              your Steam profile is a misleading picture of what you actually play.
            </p>`,
      },
      {
        heading: "The bundle problem",
        body: `            <p>
              Charity bundles put thousands of games into people's accounts at once.
              Nobody plays all of them, and nobody remembers which ones they tried. A
              passive tracker turns that pile into a usable record: which of them you
              opened, for how long, and how often you came back. That is genuinely
              useful for deciding what to revisit, and it is also the kind of feedback
              small developers rarely get to see reflected back to players.
            </p>`,
      },
      {
        heading: "Tracking downloaded and portable games",
        body: `            <p>
              PlayCounter watches running Windows processes, so a game extracted to a
              folder and started by double-clicking its executable is tracked the same
              way a Steam game is. There is no need to add it to a library, create a
              shortcut, or launch it through anything in particular.
            </p>
            <p>
              Small indie releases are the most likely to have executable names that
              PlayCounter does not yet recognise - <code>game.exe</code>,
              <code>build.exe</code>, or an engine default are common. For those you
              add the game as a local custom entry once, or submit the match for
              review so future players get it automatically. Recognition improves as
              more people play the same titles.
            </p>
            <p>
              Games built with common engines sometimes share a generic executable
              name across many titles. In that case PlayCounter asks you to choose
              once instead of guessing, and remembers your answer on that PC.
            </p>`,
      },
    ],
    faq: [
      {
        q: "Does itch.io track hours played?",
        a: "No. The itch.io app and website handle purchases, downloads, updates, and launching, but do not record playtime.",
      },
      {
        q: "Can I track a game I extracted from a zip file?",
        a: "Yes. A process-based tracker times the executable wherever it lives, including portable folders and external drives, with no installation or shortcut required.",
      },
      {
        q: "What about games with generic executable names?",
        a: 'Names like <code>game.exe</code> belong to many titles, so PlayCounter asks for a one-time local choice rather than guessing. See <a href="/how-automatic-game-detection-works/">how detection works</a>.',
      },
      {
        q: "Will small indie games be recognised automatically?",
        a: "Widely played ones usually are. For the rest you can add a local custom game in a few seconds, or submit the match so it works automatically for other players after review.",
      },
    ],
    related: [
      { href: "/how-automatic-game-detection-works/", label: "How automatic detection works" },
      { href: "/supported-games/", label: "Which games are supported?" },
      { href: "/track-playtime-outside-steam/", label: "Track playtime outside Steam" },
    ],
    asideBody: asideDefault,
    ctaBody: cta,
  },
];
