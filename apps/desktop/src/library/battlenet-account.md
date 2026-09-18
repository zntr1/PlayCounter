# Battle.net account import

The importer offers an optional account scan alongside the existing local scan.
Both scan buttons first show a playtime notice explaining manual totals and the
WoW `/played` example. Only **OK** starts the selected scan; dismissing the notice
does nothing. Acknowledgment is required for each scan. Only an explicit
**Sign in and find games** action followed by **OK** opens authentication.
Background executable checks continue to use local discovery alone.

The native command opens the Battle.net account website in an InPrivate webview,
then reads `/api/games-and-subs` and `/api/classic-games` on the authenticated
account page. These are website endpoints, so changes to Blizzard's account site
can require adapting this importer. This is separate from Blizzard's public
developer OAuth API. Endpoint and title-ID references:
[Playnite account client](https://github.com/JosefNemec/PlayniteExtensions/blob/master/source/Libraries/BattleNetLibrary/Services/BattleNetAccountClient.cs)
and [product catalog](https://github.com/JosefNemec/PlayniteExtensions/blob/master/source/Libraries/BattleNetLibrary/BattleNetGames.cs).

The remote window has no Tauri capabilities. Only projected game metadata leaves
it: title ID, localized game name, and classic-game franchise icon identifier.
Account identifiers, credentials, subscription details and CD keys are neither
returned to the frontend nor sent to the PlayCounter API. Cancellation, closing
the window, failure, success and the ten-minute timeout all destroy the window.

Before loading any remote page, native code verifies that WebView2 actually
created an InPrivate profile. Unsupported runtimes fail closed. Native web
messaging, host objects, developer tools, password saving, autofill, extensions,
permission prompts, popups and downloads are disabled in this window. Navigation
allows exact HTTPS login hosts; the native title shows the current host. The game
reader checks the account origin in both Rust and JavaScript, refuses redirects,
and checks the returned endpoint before projecting metadata.

Private cookies and browsing data are cleared before sign-in and explicitly
cleared again before destroying the window. A retry stays blocked until cleanup
finishes. Cleanup failure blocks further sign-ins until the app restarts. The
main application's persistent profile is never cleared by this operation.

The ignored Windows native regression test
`private_profile_enforces_security_settings_and_clears_only_its_own_cookies`
uses an isolated profile, `about:blank`, and synthetic cookies. Run it with
`cargo test --test battlenet_account_security -- --ignored`.
It verifies private-mode enforcement, disabled native/password interfaces,
working native script callbacks, cookie removal and preservation of the
persistent profile. It never connects to Battle.net.

Account membership does not prove that a game was played. Account imports retain
unknown historical duration and no play evidence unless a local scan has a
last-played date. Multiple regional accounts are deduplicated. A WoW account does
not manufacture entries for every Classic variant; installed variants remain
separate. Unrecognized titles and classic editions require manual game review.
Classic entries have no numeric ID, so their stable key uses the supplied name
and franchise; changing the account site's language may change those keys.

Games can be imported before installation, without executable mappings. A later
local scan can attach installation-scoped links. Incomplete local scans preserve
saved installation information instead of declaring missing titles uninstalled.

For a live check, sign in with an account containing an uninstalled game, verify
the review list, cancel and retry, then try another account. Verify MFA, expired
sessions and any external identity provider used by that account. Unit tests
cover response projection, expiry, partial results, cancellation, ID mapping and
uninstalled imports, but cannot substitute for Blizzard's live login flow.
