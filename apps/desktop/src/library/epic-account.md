# Epic Games import

The importer has two scans, like Battle.net.

**Find installed games** reads the Epic Games Launcher's install manifests
(`%ProgramData%\Epic\EpicGamesLauncher\Data\Manifests\*.item`). No sign-in.
DLC, engines, plugins and unfinished downloads are skipped. Past playtime stays
unknown (`providerSeconds: null`, no play evidence).

**Sign in and find games** adds the account library and the playtime Epic
recorded. Every owned game can be imported. Games with no playtime that are
not installed start unchecked in "Ready", because Epic accounts collect many
free games, and they skip the automatic IGDB suggestion search (manual search
stays in their row).

## Identity

`externalId` is Epic's `AppName` (for example `Fortnite`, `Sugar`, or a hex id).
The launch URL and the playtime service use the same name.

IGDB does not index app names. Its Epic entries (`external_game_source` 26,
"Epic Games Store") use offer ids, which neither the manifests nor the library
service provide. So `/api/library/resolve` matches the exact store title
(trademark signs removed) among IGDB's Epic entries. A title that matches no
game or two games stays `unknown` and goes to the normal game picker.

## Sign-in

Epic has no public API for a user's library or playtime. Like Playnite and
Legendary, the import signs in as the Epic Games Launcher client and reads the
launcher's own services. They can change without notice:

- login page → `www.epicgames.com/id/api/redirect` shows a one-time
  authorization code
- `account-public-service-prod03…/oauth/token` (authorization code → token)
- `library-service…/library/api/public/items` (paged with `cursor`)
- `library-service…/library/api/public/playtime/account/{id}/all`
  (`totalTime` per `artifactId`, taken as seconds)
- `catalog-public-service-prod06…/namespace/{ns}/bulk/items` (title, category,
  DLC check)
- `…/oauth/sessions/kill/{token}` once the import is done

The sign-in window reuses the Battle.net import's hardened InPrivate webview
(`secure_window`, `clear_private_data`, one sign-in at a time). Only the
authorization code leaves the page. The window is cleared and destroyed before
the library is read. The token stays in the native command, is revoked
afterwards, and is never stored. Only app names, titles and playtime reach the
frontend; nothing from the account goes to the PlayCounter API except app
names and titles for the lookup.

## Launching

Play uses `com.epicgames.launcher://apps/{namespace}%3A{itemId}%3A{appName}?action=launch&silent=true`,
with namespace and item id read from the install manifest. Open Epic Games uses
`com.epicgames.launcher://store/library`.

## Known sign-in failures

- `errors.com.epicgames.oauth.corrective_action_required` (seen with
  `PRIVACY_POLICY_ACCEPTANCE`): the account has to accept something on Epic's
  side first. PlayCounter says so and stops. The user signs in at
  epicgames.com or in the launcher, accepts it, and tries again.
- The code page can answer without a code right after login; PlayCounter
  reloads it up to three times.

## Not verified yet

Written without an Epic installation or account on the development PC. Checked
against fixtures and Playnite's source, not live:

- the manifest fields and categories on a real install
- the login page hosts in the navigation allowlist (social sign-in, captcha, 2FA)
- the redirect page and the service response shapes
- `totalTime` being seconds
- the Unreal `*-Win64-Shipping.exe` preference over the launch bootstrap
