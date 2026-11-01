//! Optional account-site session. These are website endpoints, not
//! Blizzard's public OAuth API. Remote pages receive no Tauri capabilities.
//!
//! Battle.net authenticates with cookies, including browser-session cookies
//! WebView2 discards on close. Keep their native snapshot in the encrypted
//! login store and restore it into the dedicated profile before navigation.
use super::battlenet_cookies;
use super::kept_logins::{KeptLogin, Service, Store};
use super::login_status::LoginStatus;
use serde::{Deserialize, Serialize};
use std::{
    collections::VecDeque,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tauri::{
    webview::{NewWindowResponse, PageLoadEvent},
    AppHandle, Manager, State, WebviewUrl, WebviewWindow,
};
use tokio::sync::oneshot;

const ACCOUNT_URL: &str = "https://account.battle.net/oauth2/authorization/account-settings";
const READ_LIBRARY: &str = include_str!("battlenet_account.js");
const READ_AUTH: &str = include_str!("battlenet_auth.js");
pub(super) const CANCELLED: &str = "Battle.net sign-in was cancelled.";
const EXPIRED: &str = "Battle.net sign-in expired or could not be verified. Please sign in again.";
// Internal signal, never returned to the UI. A denied library request is
// not proof that the long-lived login cookies are no longer usable.
const RENEW: &str = "battlenet:renew";
const UNAVAILABLE: &str =
    "Battle.net could not provide your game list. Try again, or scan installed games.";
/// A kept sign-in goes straight to the account page; the window shows when
/// Battle.net asks for a sign-in, or after this long.
const SHOW_WINDOW_AFTER: Duration = Duration::from_secs(8);

/// The webview profile a sign-in window must use before anything loads.
#[derive(Clone)]
pub(super) enum ExpectedProfile {
    /// InPrivate: nothing is written to disk.
    Private,
    /// Battle.net's own lasting profile in this folder.
    Dedicated(PathBuf),
}

fn profile_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_local_data_dir()
        .map_err(|error| error.to_string())?
        .join("battlenet-profile"))
}

/// Sign out: the marker is gone already; the profile follows. While its
/// browser processes still hold files, the next start deletes it, and an
/// import clears it first anyway.
pub(super) fn forget_profile(app: &AppHandle) {
    if let Ok(dir) = profile_dir(app) {
        let _ = std::fs::remove_dir_all(dir);
    }
}

/// At start, before any Battle.net window: a profile without a kept sign-in
/// is left over from a sign-out or a failed import.
pub(crate) fn clean_up_profile(app: &AppHandle) {
    // A temporarily unreadable marker is not a sign-out. Keep its cookies.
    if matches!(
        Store::of(app).and_then(|store| store.try_load(Service::BattleNet)),
        Ok(None)
    ) {
        forget_profile(app);
    }
}

/// WebView2 reports `<profile folder>\EBWebView\Default`. Compared without
/// case, as Windows does.
fn inside_profile(reported: &str, dir: &Path) -> bool {
    let normalize = |value: &str| {
        let value = value.replace('/', "\\");
        value
            .strip_prefix(r"\\?\")
            .unwrap_or(&value)
            .trim_end_matches('\\')
            .to_lowercase()
    };
    let dir = normalize(&dir.to_string_lossy());
    !dir.is_empty() && normalize(reported).starts_with(&format!("{dir}\\"))
}

#[derive(Default)]
pub struct AccountState(Mutex<Sessions>);

pub(super) fn cancel_active(app: &AppHandle) {
    if let Some(state) = app.try_state::<AccountState>() {
        if let Ok(mut sessions) = state.0.lock() {
            sessions.cancel_active();
        }
    }
}

/// One sign-in window at a time. Also used by the Epic Games account import.
#[derive(Default)]
pub(super) struct Sessions {
    active: Option<(String, Option<oneshot::Sender<()>>)>,
    background: bool,
    // Cancellation can arrive while the start command is still queued.
    cancelled: VecDeque<String>,
}

impl Sessions {
    pub(super) fn is_active(&self) -> bool {
        self.active.is_some()
    }

    fn start_background(&mut self, id: &str) -> Result<oneshot::Receiver<()>, String> {
        let receiver = self.start(id)?;
        self.background = true;
        Ok(receiver)
    }

    fn preempt_background(&mut self) -> bool {
        if self.background && self.active.is_some() {
            self.cancel_active();
            true
        } else {
            false
        }
    }

    pub(super) fn cancel_active(&mut self) {
        if let Some(sender) = self.active.as_mut().and_then(|(_, sender)| sender.take()) {
            let _ = sender.send(());
        }
    }

    /// Fails with exactly `CANCELLED` when this attempt was cancelled first.
    pub(super) fn start(&mut self, id: &str) -> Result<oneshot::Receiver<()>, String> {
        if let Some(index) = self.cancelled.iter().position(|item| item == id) {
            self.cancelled.remove(index);
            return Err(CANCELLED.into());
        }
        if self.active.is_some() {
            return Err("A Battle.net sign-in is already open. Finish or cancel it first.".into());
        }
        let (sender, receiver) = oneshot::channel();
        self.active = Some((id.into(), Some(sender)));
        self.background = false;
        Ok(receiver)
    }

    pub(super) fn cancel(&mut self, id: &str) {
        if self.active.as_ref().is_some_and(|(active, _)| active == id) {
            // Keep the slot until private browsing data has been cleared and
            // the window destroyed. Cancellation alone must not allow overlap.
            if let Some(sender) = self.active.as_mut().and_then(|(_, sender)| sender.take()) {
                let _ = sender.send(());
            }
        } else if !self.cancelled.iter().any(|item| item == id) {
            self.cancelled.push_back(id.into());
            while self.cancelled.len() > 16 {
                self.cancelled.pop_front();
            }
        }
    }

    pub(super) fn finish(&mut self, id: &str) {
        if self.active.as_ref().is_some_and(|(active, _)| active == id) {
            self.active = None;
            self.background = false;
        }
    }
}

async fn start_foreground(state: &AccountState, id: &str) -> Result<oneshot::Receiver<()>, String> {
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        {
            let mut sessions = state
                .0
                .lock()
                .map_err(|_| "Could not start Battle.net sign-in.")?;
            // An explicit account action takes priority over a silent probe.
            // The old webview must finish cleanup before its profile is reused.
            if sessions.cancelled.iter().any(|cancelled| cancelled == id)
                || !sessions.preempt_background()
                || Instant::now() >= deadline
            {
                return sessions.start(id);
            }
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AccountGame {
    title_id: Option<u32>,
    name: String,
    franchise: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountLibrary {
    games: Vec<AccountGame>,
    incomplete: bool,
}

#[derive(Deserialize)]
#[serde(tag = "status", rename_all = "lowercase", deny_unknown_fields)]
enum ReadResult {
    Pending,
    Complete {
        games: Vec<AccountGame>,
        incomplete: bool,
    },
    Error {
        error: String,
    },
}

fn account_page(url: &tauri::Url) -> bool {
    url.scheme() == "https"
        && url.host_str() == Some("account.battle.net")
        && url.port_or_known_default() == Some(443)
        && url.username().is_empty()
        && url.password().is_none()
        && matches!(
            url.path().trim_end_matches('/'),
            "" | "/overview" | "/games-and-subs"
        )
}

fn login_navigation(url: &tauri::Url) -> bool {
    // Only login hosts, not entire provider domains (which can host arbitrary
    // user content). Add federated hosts only after verifying their purpose.
    const HOSTS: &[&str] = &[
        "account.battle.net",
        // The account portal redirects through oauth.battle.net to these
        // regional account login hosts, not only the older region.battle.net.
        "eu.account.battle.net",
        "us.account.battle.net",
        "kr.account.battle.net",
        "oauth.battle.net",
        "battle.net",
        "us.battle.net",
        "eu.battle.net",
        "kr.battle.net",
        "tw.battle.net",
        "accounts.google.com",
        "appleid.apple.com",
        "account.apple.com",
        "login.live.com",
        "account.live.com",
        "login.microsoftonline.com",
        "login.microsoft.com",
        "my.account.sony.com",
        "ca.account.sony.com",
        "id.sonyentertainmentnetwork.com",
        "store.steampowered.com",
        "login.steampowered.com",
        "steamcommunity.com",
    ];
    url.scheme() == "https"
        && url.port_or_known_default() == Some(443)
        && url.username().is_empty()
        && url.password().is_none()
        && url.host_str().is_some_and(|host| HOSTS.contains(&host))
}

pub(super) fn interactive_login_page(url: &tauri::Url) -> bool {
    login_navigation(url)
        && url.path().split('/').any(|segment| {
            matches!(
                segment,
                "login" | "signin" | "challenge" | "authenticator" | "verify"
            )
        })
}

fn should_show_window(url: &tauri::Url, elapsed: Duration) -> bool {
    login_navigation(url)
        && !account_page(url)
        && (interactive_login_page(url) || elapsed >= SHOW_WINDOW_AFTER)
}

/// A renewal gets one new document to verify. Polling the old document while
/// navigation is queued must neither consume the retry nor reuse its result.
#[derive(Default)]
struct AccountReadAttempt {
    after_page: u64,
    renewed: bool,
}

impl AccountReadAttempt {
    fn page_ready(&self, completed_page: u64) -> bool {
        completed_page > self.after_page
    }

    fn renew(&mut self, completed_page: u64, error: &str) -> bool {
        if self.renewed || !matches!(error, EXPIRED | RENEW) {
            return false;
        }
        self.renewed = true;
        self.after_page = completed_page;
        true
    }
}

fn retain_existing_session(kept: bool, current: bool) -> bool {
    // Even a refused short-lived session can have valid long-lived SSO
    // cookies. Only explicit sign-out/reset invalidates a saved profile.
    kept && current
}

const PRIVATE_SESSION_ERROR: &str = "Could not create a secure private Battle.net session. Update Microsoft Edge WebView2 and try again, or scan installed games.";
const CLEANUP_ERROR: &str =
    "Could not clear the Battle.net sign-in session. Close PlayCounter before signing in again.";

/// Whether the webview runs on the expected profile, never on the main
/// application's.
#[cfg(windows)]
unsafe fn uses_profile(
    profile: &webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Profile,
    expected: &ExpectedProfile,
) -> windows_core::Result<bool> {
    let mut private = Default::default();
    profile.IsInPrivateModeEnabled(&mut private)?;
    Ok(match expected {
        ExpectedProfile::Private => private.as_bool(),
        ExpectedProfile::Dedicated(dir) => {
            let mut path = windows_core::PWSTR::null();
            profile.ProfilePath(&mut path)?;
            !private.as_bool() && inside_profile(&webview2_com::take_pwstr(path), dir)
        }
    })
}

// Start at about:blank. Some old WebView2 runtimes silently ignore Wry's
// incognito flag or data folder; no remote content may load until we verify
// the actual profile. `clear` empties it first.
#[cfg(windows)]
pub(super) async fn secure_window(
    window: &WebviewWindow,
    expected: ExpectedProfile,
    clear: bool,
) -> Result<(), String> {
    use webview2_com::{Microsoft::Web::WebView2::Win32::*, PermissionRequestedEventHandler};
    use windows_core::Interface;

    let (sender, receiver) = oneshot::channel();
    let check = expected.clone();
    window
        .with_webview(move |platform| {
            let configure = || -> windows_core::Result<bool> {
                unsafe {
                    let webview = platform.controller().CoreWebView2()?;
                    let profile = webview.cast::<ICoreWebView2_13>()?.Profile()?;
                    if !uses_profile(&profile, &check)? {
                        return Ok(false);
                    }
                    let settings = webview.Settings()?;
                    // The game reader uses ExecuteScript's native callback, so the
                    // website needs no JS-to-native bridge, even in subframes.
                    settings.SetIsWebMessageEnabled(false)?;
                    settings.SetAreHostObjectsAllowed(false)?;
                    settings.SetAreDevToolsEnabled(false)?;
                    settings.SetAreDefaultScriptDialogsEnabled(false)?;
                    settings.SetIsStatusBarEnabled(true)?;
                    let settings4 = settings.cast::<ICoreWebView2Settings4>()?;
                    settings4.SetIsPasswordAutosaveEnabled(false)?;
                    settings4.SetIsGeneralAutofillEnabled(false)?;
                    let mut token = 0;
                    webview.add_PermissionRequested(
                        &PermissionRequestedEventHandler::create(Box::new(|_, args| {
                            if let Some(args) = args {
                                args.SetState(COREWEBVIEW2_PERMISSION_STATE_DENY)?;
                            }
                            Ok(())
                        })),
                        &mut token,
                    )?;
                    Ok(true)
                }
            };
            let _ = sender.send(matches!(configure(), Ok(true)));
        })
        .map_err(|_| PRIVATE_SESSION_ERROR)?;
    match tokio::time::timeout(Duration::from_secs(10), receiver).await {
        Ok(Ok(true)) if clear => clear_profile_data(window, expected).await,
        Ok(Ok(true)) => Ok(()),
        _ => Err(PRIVATE_SESSION_ERROR.into()),
    }
}

#[cfg(windows)]
pub(super) async fn clear_profile_data(
    window: &WebviewWindow,
    expected: ExpectedProfile,
) -> Result<(), String> {
    use webview2_com::{ClearBrowsingDataCompletedHandler, Microsoft::Web::WebView2::Win32::*};
    use windows_core::Interface;

    let (sender, receiver) = oneshot::channel();
    window
        .with_webview(move |platform| {
            // Keep the sender available for immediate errors and the async callback.
            let sender = std::sync::Arc::new(Mutex::new(Some(sender)));
            let completed = sender.clone();
            let clear = || -> windows_core::Result<()> {
                unsafe {
                    let webview = platform.controller().CoreWebView2()?;
                    let profile = webview.cast::<ICoreWebView2_13>()?.Profile()?;
                    // Never clear the main application's persistent profile.
                    if !uses_profile(&profile, &expected)? {
                        return Err(windows_core::Error::from_hresult(windows_core::HRESULT(
                            0x80004005u32 as i32,
                        )));
                    }
                    webview
                        .cast::<ICoreWebView2_2>()?
                        .CookieManager()?
                        .DeleteAllCookies()?;
                    profile
                        .cast::<ICoreWebView2Profile2>()?
                        .ClearBrowsingDataAll(&ClearBrowsingDataCompletedHandler::create(Box::new(
                            move |result| {
                                if let Some(sender) =
                                    completed.lock().ok().and_then(|mut value| value.take())
                                {
                                    let _ = sender.send(result.is_ok());
                                }
                                Ok(())
                            },
                        )))
                }
            };
            if clear().is_err() {
                if let Some(sender) = sender.lock().ok().and_then(|mut value| value.take()) {
                    let _ = sender.send(false);
                }
            }
        })
        .map_err(|_| CLEANUP_ERROR)?;
    match tokio::time::timeout(Duration::from_secs(10), receiver).await {
        Ok(Ok(true)) => Ok(()),
        _ => Err(CLEANUP_ERROR.into()),
    }
}

#[cfg(not(windows))]
pub(super) async fn secure_window(
    _: &WebviewWindow,
    _: ExpectedProfile,
    _: bool,
) -> Result<(), String> {
    Err(PRIVATE_SESSION_ERROR.into())
}

#[cfg(not(windows))]
pub(super) async fn clear_profile_data(
    _: &WebviewWindow,
    _: ExpectedProfile,
) -> Result<(), String> {
    Err(CLEANUP_ERROR.into())
}

fn decode_result(value: &str) -> Result<Option<AccountLibrary>, String> {
    if value.len() > 2_000_000 {
        return Err("Battle.net returned an unexpectedly large game list.".into());
    }
    let result: Option<ReadResult> = serde_json::from_str(value)
        .map_err(|_| "Could not read the Battle.net game list. Please sign in again.")?;
    match result {
        None | Some(ReadResult::Pending) => Ok(None),
        Some(ReadResult::Error { error }) => Err(match error.as_str() {
            "expired" => EXPIRED,
            "renew" => RENEW,
            _ => UNAVAILABLE,
        }
        .into()),
        Some(ReadResult::Complete { games, incomplete }) => {
            if games.len() > 2_000
                || games.iter().any(|game| {
                    game.title_id == Some(0)
                        || game.name.is_empty()
                        || game.name.chars().count() > 256
                        || game
                            .franchise
                            .as_ref()
                            .is_some_and(|value| value.chars().count() > 256)
                })
            {
                return Err("Battle.net returned an invalid game list. Please try again.".into());
            }
            Ok(Some(AccountLibrary { games, incomplete }))
        }
    }
}

#[cfg(test)]
#[allow(dead_code)] // Also used by the separate native renewal test executable.
pub(super) async fn read_library(
    window: &WebviewWindow,
    completed_pages: &AtomicU64,
) -> Result<AccountLibrary, String> {
    read_account_page(
        window,
        completed_pages,
        READ_LIBRARY,
        &mut AccountReadAttempt::default(),
    )
    .await
}

async fn evaluate_account_page(
    window: &WebviewWindow,
    completed_pages: &AtomicU64,
    page: u64,
    script: &str,
) -> Result<Option<AccountLibrary>, String> {
    let (sender, receiver) = oneshot::channel();
    let sender = Mutex::new(Some(sender));
    window
        .eval_with_callback(script, move |value| {
            if let Ok(mut sender) = sender.lock() {
                if let Some(sender) = sender.take() {
                    let _ = sender.send(value);
                }
            }
        })
        .map_err(|_| "Could not read the Battle.net sign-in window.")?;
    let value = tokio::time::timeout(Duration::from_secs(5), receiver)
        .await
        .map_err(|_| "The Battle.net sign-in window stopped responding. Please try again.")?
        .map_err(|_| CANCELLED)?;
    if !account_page(&window.url().map_err(|_| CANCELLED)?)
        || page != completed_pages.load(Ordering::SeqCst)
    {
        return Ok(None);
    }
    decode_result(&value)
}

async fn read_account_page(
    window: &WebviewWindow,
    completed_pages: &AtomicU64,
    script: &str,
    attempt: &mut AccountReadAttempt,
) -> Result<AccountLibrary, String> {
    let mut interval = tokio::time::interval(Duration::from_millis(750));
    let mut started = Instant::now();
    loop {
        interval.tick().await;
        let url = window.url().map_err(|_| CANCELLED)?;
        if should_show_window(&url, started.elapsed()) && !window.is_visible().unwrap_or(true) {
            let _ = window.show();
            let _ = window.set_focus();
        }
        let page = completed_pages.load(Ordering::SeqCst);
        if !account_page(&url) || !attempt.page_ready(page) {
            continue;
        }
        match evaluate_account_page(window, completed_pages, page, script).await {
            Ok(Some(library)) => return Ok(library),
            Ok(None) => {}
            Err(error) if attempt.renew(page, &error) => {
                window
                    .navigate(ACCOUNT_URL.parse().expect("fixed Battle.net URL"))
                    .map_err(|_| PRIVATE_SESSION_ERROR)?;
                started = Instant::now();
            }
            Err(error) => {
                return Err(if error == RENEW {
                    UNAVAILABLE.into()
                } else {
                    error
                })
            }
        }
    }
}

// Navigation away can race the first native poll after the login succeeds.
// Finish only the authentication check on the current account document, with
// a short deadline; cancellation must never navigate or reopen a window.
async fn save_completed_authentication(
    window: &WebviewWindow,
    store: &Store,
    completed_pages: &AtomicU64,
) -> bool {
    let verified = tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            let page = completed_pages.load(Ordering::SeqCst);
            if !store.is_current(Service::BattleNet) {
                return false;
            }
            if page == 0 || !window.url().ok().as_ref().is_some_and(account_page) {
                tokio::time::sleep(Duration::from_millis(50)).await;
                continue;
            }
            match evaluate_account_page(window, completed_pages, page, READ_AUTH).await {
                Ok(Some(_)) => return true,
                Ok(None) => tokio::time::sleep(Duration::from_millis(50)).await,
                Err(_) => return false,
            }
        }
    })
    .await
    .unwrap_or(false);
    // Cookie capture is asynchronous. Once verified, finish the secure save
    // outside the cancellation/deadline race before destroying its webview.
    verified && save_authenticated_session(window, store).await.is_ok()
}

async fn save_authenticated_session(window: &WebviewWindow, store: &Store) -> Result<(), String> {
    if !store.is_current(Service::BattleNet) {
        return Err(CANCELLED.into());
    }
    let cookies = battlenet_cookies::capture(window).await?;
    // Store::save atomically checks the original sign-out generation. A late
    // capture can therefore never recreate credentials after explicit logout.
    store.save(Service::BattleNet, &KeptLogin::new(cookies, None))
}

// Stop the old document's requests and scripts before the final cookie read.
// Otherwise a late Set-Cookie could rotate the session after its snapshot.
#[cfg(windows)]
async fn unload_account_page(window: &WebviewWindow) -> Result<(), String> {
    use webview2_com::NavigationCompletedEventHandler;
    use windows_core::w;

    let (sender, receiver) = oneshot::channel();
    window
        .with_webview(move |platform| {
            let sender = Arc::new(Mutex::new(Some(sender)));
            let completed = sender.clone();
            let unload = || -> windows_core::Result<()> {
                unsafe {
                    let view = platform.controller().CoreWebView2()?;
                    view.Stop()?;
                    let mut token = 0;
                    view.add_NavigationCompleted(
                        &NavigationCompletedEventHandler::create(Box::new(move |view, _| {
                            if let Some(view) = view {
                                let mut source = windows_core::PWSTR::null();
                                view.Source(&mut source)?;
                                if webview2_com::take_pwstr(source) == "about:blank" {
                                    // Stop any fetch the previous document queued
                                    // while its navigation was being cancelled.
                                    let stopped = view.Stop().is_ok();
                                    if let Some(sender) =
                                        completed.lock().ok().and_then(|mut sender| sender.take())
                                    {
                                        let _ = sender.send(stopped);
                                    }
                                }
                            }
                            Ok(())
                        })),
                        &mut token,
                    )?;
                    view.Navigate(w!("about:blank"))?;
                    Ok(())
                }
            };
            if unload().is_err() {
                if let Some(sender) = sender.lock().ok().and_then(|mut sender| sender.take()) {
                    let _ = sender.send(false);
                }
            }
        })
        .map_err(|_| "Could not save the sign-in.")?;
    match tokio::time::timeout(Duration::from_secs(5), receiver).await {
        Ok(Ok(true)) => Ok(()),
        _ => Err("Could not save the sign-in.".into()),
    }
}

#[cfg(not(windows))]
async fn unload_account_page(_: &WebviewWindow) -> Result<(), String> {
    Err(PRIVATE_SESSION_ERROR.into())
}

/// Completion state for a hidden authentication probe. None of these callbacks
/// reveal or focus its window, including when Blizzard redirects to a login.
#[derive(Default)]
pub(super) struct SilentPages {
    account_pages: AtomicU64,
    navigation: AtomicU64,
    login_loaded: AtomicBool,
    challenge_loaded: AtomicBool,
}

impl SilentPages {
    fn loaded(&self, url: &tauri::Url, event: PageLoadEvent) {
        self.login_loaded.store(false, Ordering::SeqCst);
        self.challenge_loaded.store(false, Ordering::SeqCst);
        if event != PageLoadEvent::Finished {
            self.navigation.fetch_add(1, Ordering::SeqCst);
            return;
        }
        if account_page(url) {
            self.account_pages.fetch_add(1, Ordering::SeqCst);
        }
        let login = login_form_page(url);
        self.login_loaded.store(login, Ordering::SeqCst);
        self.challenge_loaded
            .store(!login && interactive_login_page(url), Ordering::SeqCst);
    }
}

fn login_form_page(url: &tauri::Url) -> bool {
    login_navigation(url)
        && url
            .path()
            .split('/')
            .any(|part| matches!(part, "login" | "signin"))
}

async fn has_login_controls(window: &WebviewWindow) -> bool {
    // A login URL can also serve a maintenance/error page. Read only whether
    // a rendered login control exists, never its value or the document text.
    // Password is a standard HTML control; accountName is Blizzard's username
    // field and covers its username-first form without matching arbitrary email
    // inputs on a maintenance or challenge page.
    const SCRIPT: &str = r#"(() => {
      const fields = document.querySelectorAll('input[type="password"], input[name="accountName"]');
      return Array.from(fields).some((field) => !field.disabled
        && field.getClientRects().length > 0
        && getComputedStyle(field).visibility === 'visible');
    })()"#;
    let (sender, receiver) = oneshot::channel();
    let sender = Mutex::new(Some(sender));
    if window
        .eval_with_callback(SCRIPT, move |value| {
            if let Some(sender) = sender.lock().ok().and_then(|mut sender| sender.take()) {
                let _ = sender.send(value);
            }
        })
        .is_err()
    {
        return false;
    }
    matches!(
        tokio::time::timeout(Duration::from_secs(2), receiver).await,
        Ok(Ok(value)) if value == "true"
    )
}

pub(super) fn build_silent_window(
    app: &AppHandle,
    id: &str,
    profile: PathBuf,
) -> Result<(WebviewWindow, Arc<SilentPages>, oneshot::Receiver<()>), String> {
    let pages = Arc::new(SilentPages::default());
    let loaded = pages.clone();
    let (sender, rejected) = oneshot::channel();
    let sender = Mutex::new(Some(sender));
    let window = tauri::WebviewWindowBuilder::new(
        app,
        format!("battlenet-status-{id}"),
        WebviewUrl::External("about:blank".parse().unwrap()),
    )
    .title("PlayCounter")
    .additional_browser_args(crate::webview_args::WEBVIEW_BROWSER_ARGS)
    .visible(false)
    .focused(false)
    .skip_taskbar(true)
    .data_directory(profile)
    .devtools(false)
    .browser_extensions_enabled(false)
    .general_autofill_enabled(false)
    .on_navigation(move |url| {
        let allowed = url.as_str() == "about:blank" || login_navigation(url);
        if !allowed {
            if let Some(sender) = sender.lock().ok().and_then(|mut sender| sender.take()) {
                let _ = sender.send(());
            }
        }
        allowed
    })
    .on_page_load(move |_, payload| loaded.loaded(payload.url(), payload.event()))
    .on_new_window(|_, _| NewWindowResponse::Deny)
    .on_download(|_, _| false)
    .build()
    .map_err(|_| PRIVATE_SESSION_ERROR.to_owned())?;
    Ok((window, pages, rejected))
}

async fn read_silent_status(window: &WebviewWindow, pages: &SilentPages) -> LoginStatus {
    let mut poll = tokio::time::interval(Duration::from_millis(100));
    let mut attempt = AccountReadAttempt::default();
    let mut login_since: Option<Instant> = None;
    loop {
        poll.tick().await;
        let Ok(url) = window.url() else {
            return LoginStatus::Unavailable;
        };
        if pages.login_loaded.load(Ordering::SeqCst) && login_form_page(&url) {
            // A cached SSO page can immediately redirect again. Require the
            // completed login document to settle before requesting user action.
            if login_since.get_or_insert_with(Instant::now).elapsed() >= Duration::from_secs(1) {
                let navigation = pages.navigation.load(Ordering::SeqCst);
                let has_controls = has_login_controls(window).await;
                if navigation != pages.navigation.load(Ordering::SeqCst)
                    || !pages.login_loaded.load(Ordering::SeqCst)
                    || window.url().ok().as_ref() != Some(&url)
                {
                    login_since = None;
                    continue;
                }
                return if has_controls {
                    LoginStatus::NeedsSignIn
                } else {
                    LoginStatus::Unavailable
                };
            }
            continue;
        }
        login_since = None;
        if pages.challenge_loaded.load(Ordering::SeqCst) && interactive_login_page(&url) {
            // A CAPTCHA or network challenge does not prove token expiry.
            return LoginStatus::Unavailable;
        }
        let page = pages.account_pages.load(Ordering::SeqCst);
        if !account_page(&url) || !attempt.page_ready(page) {
            continue;
        }
        match evaluate_account_page(window, &pages.account_pages, page, READ_AUTH).await {
            Ok(Some(_)) => return LoginStatus::Valid,
            Ok(None) => {}
            Err(error) if attempt.renew(page, &error) => {
                if window
                    .navigate(ACCOUNT_URL.parse().expect("fixed Battle.net URL"))
                    .is_err()
                {
                    return LoginStatus::Unavailable;
                }
            }
            Err(error) if error == EXPIRED => return LoginStatus::NeedsSignIn,
            Err(_) => return LoginStatus::Unavailable,
        }
    }
}

/// Silent probes never call the foreground reader or its reveal/focus paths.
/// Store and browser cleanup use the same generation checks as explicit login.
pub(super) async fn run_silent_session(
    window: &WebviewWindow,
    store: &Store,
    expected: ExpectedProfile,
    pages: &SilentPages,
    mut cancelled: oneshot::Receiver<()>,
    rejected: oneshot::Receiver<()>,
) -> Result<LoginStatus, String> {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(30);
    let setup = secure_window(window, expected.clone(), false).await;
    let session_ready = setup.is_ok();
    // Cookie restoration must settle before cancellation can destroy its
    // controller; a late native callback must not repopulate a cleared profile.
    let setup = match setup {
        Ok(()) => match store.try_load(Service::BattleNet) {
            Ok(Some(login)) => battlenet_cookies::restore(window, &login.secret).await,
            Ok(None) => Err(CANCELLED.into()),
            Err(error) => Err(error),
        },
        Err(error) => Err(error),
    };
    let mut status = tokio::select! {
        biased;
        _ = &mut cancelled => LoginStatus::Busy,
        _ = rejected => LoginStatus::Unavailable,
        checked = tokio::time::timeout_at(deadline, async {
            if setup.is_err() {
                return LoginStatus::Unavailable;
            }
            if !store.is_current(Service::BattleNet) {
                return LoginStatus::SignedOut;
            }
            if window.navigate(ACCOUNT_URL.parse().expect("fixed Battle.net URL")).is_err() {
                return LoginStatus::Unavailable;
            }
            read_silent_status(window, pages).await
        }) => checked.unwrap_or(LoginStatus::Unavailable),
    };
    let unloaded = unload_account_page(window).await;
    if status == LoginStatus::Valid && store.is_current(Service::BattleNet) {
        if unloaded.is_err() || save_authenticated_session(window, store).await.is_err() {
            status = LoginStatus::Unavailable;
        }
    }
    let cleared = if session_ready && !store.is_current(Service::BattleNet) {
        status = LoginStatus::SignedOut;
        clear_profile_data(window, expected).await
    } else {
        Ok(())
    };
    let destroyed = window.destroy();
    if cleared.is_err() || destroyed.is_err() {
        return Err(CLEANUP_ERROR.into());
    }
    Ok(status)
}

/// Check only an existing saved connection. This function never opens an
/// interactive window and leaves a foreground connection/import undisturbed.
pub(super) async fn check_saved_login(app: &AppHandle) -> LoginStatus {
    if !cfg!(windows) {
        return LoginStatus::SignedOut;
    }
    let Some(state) = app.try_state::<AccountState>() else {
        return LoginStatus::Unavailable;
    };
    let id = uuid::Uuid::new_v4().to_string();
    let cancelled = match state.0.lock() {
        Ok(mut sessions) => match sessions.start_background(&id) {
            Ok(cancelled) => cancelled,
            Err(_) => return LoginStatus::Busy,
        },
        Err(_) => return LoginStatus::Unavailable,
    };
    let result: Result<LoginStatus, String> = async {
        let store = Store::of(app)?;
        if store.try_load(Service::BattleNet)?.is_none() {
            return Ok(LoginStatus::SignedOut);
        }
        let profile = profile_dir(app)?;
        let expected = ExpectedProfile::Dedicated(profile.clone());
        let (window, pages, rejected) = build_silent_window(app, &id, profile)?;
        run_silent_session(&window, &store, expected, &pages, cancelled, rejected).await
    }
    .await;
    if result.as_ref().is_err_and(|error| error == CLEANUP_ERROR) {
        // An uncleared window must not share its profile with a later attempt.
        return LoginStatus::Unavailable;
    }
    if let Ok(mut sessions) = state.0.lock() {
        sessions.finish(&id);
    }
    result.unwrap_or(LoginStatus::Unavailable)
}

/// The native lifecycle shared by account connection and library import.
/// Authentication is durable before slow library reads or cancellation.
pub(super) async fn run_account_session(
    window: &WebviewWindow,
    store: &Store,
    expected: ExpectedProfile,
    kept: bool,
    completed_pages: &AtomicU64,
    mut cancelled: oneshot::Receiver<()>,
    mut rejected_navigation: oneshot::Receiver<()>,
    authentication_only: bool,
    allow_reveal: &AtomicBool,
) -> Result<AccountLibrary, String> {
    // Native preparation must finish before cancellation can clean up.
    let setup = secure_window(window, expected.clone(), !kept).await;
    let session_ready = setup.is_ok();
    // Finish native preparation before cancellation can destroy the window.
    // Existing profile cookies win; the encrypted snapshot restores those
    // lost when WebView2 closed the previous browser session.
    let setup = match setup {
        Ok(()) => match store.try_load(Service::BattleNet) {
            Ok(Some(login)) => battlenet_cookies::restore(window, &login.secret).await,
            Ok(None) => Ok(()),
            Err(_) => Err(UNAVAILABLE.into()),
        },
        Err(error) => Err(error),
    };
    let mut authenticated = false;
    let deadline = tokio::time::Instant::now() + Duration::from_secs(600);
    let mut attempt = AccountReadAttempt::default();
    let verification = tokio::select! {
        biased;
        _ = &mut cancelled => Err(CANCELLED.into()),
        _ = &mut rejected_navigation => Err("Battle.net tried to open an unsupported sign-in page. Update PlayCounter or use Find installed games.".into()),
        result = tokio::time::timeout_at(deadline, async {
            setup?;
            if !store.is_current(Service::BattleNet) {
                return Err(CANCELLED.into());
            }
            window.navigate(ACCOUNT_URL.parse().expect("fixed Battle.net URL"))
                .map_err(|_| PRIVATE_SESSION_ERROR)?;
            read_account_page(window, completed_pages, READ_AUTH, &mut attempt).await
        }) => result.unwrap_or_else(|_| Err("Battle.net sign-in timed out. Please try again.".into())),
    };
    let mut result = match verification {
        Err(error) => Err(error),
        Ok(verified) => {
            authenticated = true;
            let _ = window.hide();
            // View changes can cancel the optional game read, but cannot drop
            // capture of session-only cookies once authentication succeeded.
            match save_authenticated_session(window, store).await {
                Err(error) => Err(error),
                Ok(()) if authentication_only => Ok(verified),
                Ok(()) => tokio::select! {
                    biased;
                    _ = &mut cancelled => Err(CANCELLED.into()),
                    _ = &mut rejected_navigation => Err("Battle.net tried to open an unsupported sign-in page. Update PlayCounter or use Find installed games.".into()),
                    result = tokio::time::timeout_at(deadline,
                        read_account_page(window, completed_pages, READ_LIBRARY, &mut attempt)
                    ) => result.unwrap_or_else(|_| Err("Battle.net sign-in timed out. Please try again.".into())),
                },
            }
        }
    };
    allow_reveal.store(false, Ordering::SeqCst);
    let _ = window.hide();
    if session_ready && !authenticated && result.as_ref().is_err_and(|error| error == CANCELLED) {
        authenticated = save_completed_authentication(window, store, completed_pages).await;
    }
    let unloaded = unload_account_page(window).await;
    if authenticated && store.is_current(Service::BattleNet) {
        // Game requests may update session cookies too. Capture their final
        // state before closing the browser that owns the HttpOnly cookies.
        let saved = match unloaded {
            Ok(()) => save_authenticated_session(window, store).await,
            Err(error) => Err(error),
        };
        if let Err(error) = saved {
            if result.is_ok() {
                result = Err(error);
            }
        }
    }
    let keep_session =
        retain_existing_session(kept || authenticated, store.is_current(Service::BattleNet));
    let cleared = if session_ready && !keep_session {
        let _ = store.delete(Service::BattleNet);
        clear_profile_data(window, expected).await
    } else {
        Ok(())
    };
    let destroyed = window.destroy();
    if cleared.is_err() || destroyed.is_err() {
        // Keep the session slot locked until restart if cleanup did not finish.
        return Err(CLEANUP_ERROR.into());
    }
    result
}

#[tauri::command]
pub async fn library_battlenet_account_games(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, AccountState>,
    request_id: String,
    // "Battle.net sign-in" in the main window's language, for the window title.
    title: String,
) -> Result<AccountLibrary, String> {
    run_account(app, window, state, request_id, title, false).await
}

#[tauri::command]
pub async fn library_battlenet_sign_in(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, AccountState>,
    request_id: String,
    title: String,
) -> Result<(), String> {
    run_account(app, window, state, request_id, title, true)
        .await
        .map(|_| ())
}

async fn run_account(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, AccountState>,
    request_id: String,
    title: String,
    authentication_only: bool,
) -> Result<AccountLibrary, String> {
    if window.label() != "main" || !cfg!(windows) {
        return Err("Battle.net sign-in is available in the Windows desktop app.".into());
    }
    let id = uuid::Uuid::parse_str(&request_id)
        .map_err(|_| "Invalid Battle.net sign-in request.")?
        .to_string();
    let cancelled = start_foreground(&state, &id).await?;
    let (store, profile) = match (Store::of(&app), profile_dir(&app)) {
        (Ok(store), Ok(profile)) => (store, profile),
        _ => {
            if let Ok(mut sessions) = state.0.lock() {
                sessions.finish(&id);
            }
            return Err(PRIVATE_SESSION_ERROR.into());
        }
    };
    let kept = match store.try_load(Service::BattleNet) {
        Ok(login) => login.is_some(),
        Err(_) => {
            if let Ok(mut sessions) = state.0.lock() {
                sessions.finish(&id);
            }
            return Err(UNAVAILABLE.into());
        }
    };
    let expected = ExpectedProfile::Dedicated(profile.clone());
    let (navigation_rejected, rejected_navigation) = oneshot::channel();
    let navigation_rejected = Mutex::new(Some(navigation_rejected));
    let completed_pages = Arc::new(AtomicU64::new(0));
    let loaded_pages = Arc::clone(&completed_pages);
    let allow_reveal = Arc::new(AtomicBool::new(true));
    let reveal_on_load = Arc::clone(&allow_reveal);
    let sign_in = tauri::WebviewWindowBuilder::new(
        &app,
        format!("battlenet-sign-in-{id}"),
        WebviewUrl::External("about:blank".parse().unwrap()),
    )
    .title(format!("{title} — PlayCounter"))
    .additional_browser_args(crate::webview_args::WEBVIEW_BROWSER_ARGS)
    .inner_size(1000.0, 760.0)
    .min_inner_size(640.0, 560.0)
    .visible(false)
    .data_directory(profile)
    .devtools(false)
    .browser_extensions_enabled(false)
    .general_autofill_enabled(false)
    .on_navigation(move |url| {
        let allowed = url.as_str() == "about:blank" || login_navigation(url);
        if !allowed {
            if let Some(sender) = navigation_rejected
                .lock()
                .ok()
                .and_then(|mut value| value.take())
            {
                let _ = sender.send(());
            }
        }
        allowed
    })
    .on_page_load(move |window, payload| {
        if let Some(host) = payload.url().host_str() {
            let _ = window.set_title(&format!("{title} — {host}"));
        }
        if payload.event() == PageLoadEvent::Finished {
            if account_page(payload.url()) {
                loaded_pages.fetch_add(1, Ordering::SeqCst);
            }
            // Ordinary OAuth hops are not a request for user interaction.
            if reveal_on_load.load(Ordering::SeqCst) && interactive_login_page(payload.url()) {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }
    })
    .on_new_window(|_, _| NewWindowResponse::Deny)
    .on_download(|_, _| false)
    .build();
    let result = match sign_in {
        Err(_) => Err("Could not open Battle.net sign-in. Please try again.".into()),
        Ok(sign_in) => {
            let close_app = app.clone();
            let close_id = id.clone();
            sign_in.on_window_event(move |event| {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    // Keep the webview alive until the native cleanup completes.
                    api.prevent_close();
                }
                if matches!(
                    event,
                    tauri::WindowEvent::CloseRequested { .. } | tauri::WindowEvent::Destroyed
                ) {
                    if let Ok(mut sessions) = close_app.state::<AccountState>().0.lock() {
                        sessions.cancel(&close_id);
                    }
                }
            });
            run_account_session(
                &sign_in,
                &store,
                expected,
                kept,
                &completed_pages,
                cancelled,
                rejected_navigation,
                authentication_only,
                &allow_reveal,
            )
            .await
        }
    };
    if result.as_ref().is_err_and(|error| error == CLEANUP_ERROR) {
        return result;
    }
    if let Ok(mut sessions) = state.0.lock() {
        sessions.finish(&id);
    }
    result
}

#[tauri::command]
pub fn library_cancel_battlenet_account(
    window: WebviewWindow,
    state: State<'_, AccountState>,
    request_id: String,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Battle.net sign-in must be cancelled from PlayCounter.".into());
    }
    let id = uuid::Uuid::parse_str(&request_id)
        .map_err(|_| "Invalid Battle.net sign-in request.")?
        .to_string();
    state
        .0
        .lock()
        .map_err(|_| "Could not cancel Battle.net sign-in.")?
        .cancel(&id);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renewal_waits_for_a_new_page_and_only_retries_authentication_once() {
        for failure in [EXPIRED, RENEW] {
            let mut attempt = AccountReadAttempt::default();
            assert!(!attempt.page_ready(0));
            assert!(attempt.page_ready(1));
            assert!(!attempt.renew(1, UNAVAILABLE));
            assert!(attempt.renew(1, failure));
            assert!(!attempt.page_ready(1));
            assert!(attempt.page_ready(2));
            assert!(!attempt.renew(2, failure));
        }
    }

    #[test]
    fn redirects_stay_hidden_but_login_and_delayed_interaction_are_visible() {
        for value in [
            ACCOUNT_URL,
            "https://oauth.battle.net/authorize",
            "https://eu.account.battle.net/oauth2/authorize",
        ] {
            let url = value.parse().unwrap();
            assert!(!should_show_window(&url, Duration::ZERO));
            assert!(should_show_window(&url, SHOW_WINDOW_AFTER));
        }
        for value in [
            "https://eu.account.battle.net/login/en/",
            "https://us.account.battle.net/challenge",
            "https://accounts.google.com/signin",
        ] {
            assert!(should_show_window(&value.parse().unwrap(), Duration::ZERO));
        }
        for value in [
            "about:blank",
            "https://account.battle.net/overview",
            "https://account.battle.net/games-and-subs",
            "https://evil.test/login",
        ] {
            assert!(!should_show_window(
                &value.parse().unwrap(),
                Duration::from_secs(60)
            ));
        }
    }

    #[test]
    fn failed_verification_preserves_saved_cookies_but_sign_out_overrides_it() {
        assert!(retain_existing_session(true, true));
        assert!(!retain_existing_session(false, true));
        assert!(!retain_existing_session(true, false));
        assert!(!retain_existing_session(false, false));
    }

    #[test]
    fn account_reads_require_the_exact_origin_and_account_page() {
        for value in [
            "https://account.battle.net/overview",
            "https://account.battle.net:443/",
            "https://account.battle.net/games-and-subs/",
        ] {
            assert!(account_page(&value.parse().unwrap()));
        }
        for value in [
            "http://account.battle.net/",
            "https://account.battle.net.evil.test/",
            "https://account.battle.net:444/",
            "https://user@account.battle.net/",
            "https://account.battle.net/login/",
            "https://oauth.battle.net/",
            "https://eu.account.battle.net/overview",
            "https://us.account.battle.net/games-and-subs",
        ] {
            assert!(!account_page(&value.parse().unwrap()));
        }
        for value in [
            "tauri://localhost/",
            "http://localhost:1420/",
            "https://tauri.localhost/",
            "https://127.0.0.1/",
            "https://battle.net.evil.test/",
            "file:///C:/private.txt",
            "https://sites.google.com/credential-form",
            "https://usercontent.blizzard.com/",
            "https://login.live.com.evil.test/",
            "https://account.battle.net@evil.test/",
            "https://account.battle.net:444/",
            "http://account.battle.net/",
            "https://eu.account.battle.net.evil.test/login/en/",
            "https://eu.account.battle.net@evil.test/login/en/",
            "http://eu.account.battle.net/login/en/",
            "https://eu.account.battle.net:444/login/en/",
        ] {
            assert!(!login_navigation(&value.parse().unwrap()));
        }
        for value in [
            ACCOUNT_URL,
            "https://oauth.battle.net/authorize",
            "https://eu.account.battle.net/login/en/",
            "https://us.account.battle.net/login/en/",
            "https://kr.account.battle.net/login/ko/",
            "https://accounts.google.com/signin",
            "https://login.live.com/oauth20_authorize.srf",
        ] {
            assert!(login_navigation(&value.parse().unwrap()));
        }
    }

    #[test]
    fn only_projected_game_metadata_leaves_the_webview() {
        let library = decode_result(r#"{"status":"complete","games":[{"titleId":5730135,"name":"World of Warcraft","franchise":null}],"incomplete":false}"#).unwrap().unwrap();
        assert_eq!(library.games[0].title_id, Some(5730135));
        assert!(decode_result(r#"{"status":"complete","games":[{"titleId":null,"name":"Diablo II","franchise":null,"cdKeys":["private"]}],"incomplete":false}"#).is_err());
        assert!(decode_result(r#"{"status":"complete","games":[{"titleId":0,"name":"Bad","franchise":null}],"incomplete":false}"#).is_err());
        assert!(decode_result(r#"{"status":"error","error":"expired"}"#)
            .unwrap_err()
            .contains("expired"));
        assert!(decode_result("null").unwrap().is_none());
    }

    #[test]
    fn only_battle_nets_own_folder_counts_as_its_profile() {
        let dir =
            Path::new(r"C:\Users\Player\AppData\Local\app.playcounter.desktop\battlenet-profile");
        assert!(inside_profile(
            r"C:\Users\Player\AppData\Local\app.playcounter.desktop\battlenet-profile\EBWebView\Default",
            dir
        ));
        assert!(inside_profile(
            r"c:/users/player/appdata/local/app.playcounter.desktop/battlenet-profile/EBWebView/Default",
            dir
        ));
        assert!(inside_profile(
            r"\\?\C:\Users\Player\AppData\Local\app.playcounter.desktop\battlenet-profile\EBWebView\Default",
            dir
        ));
        for reported in [
            r"C:\Users\Player\AppData\Local\app.playcounter.desktop\EBWebView\Default",
            r"C:\Users\Player\AppData\Local\app.playcounter.desktop\battlenet-profile-evil\EBWebView\Default",
            r"C:\Users\Player\AppData\Local\app.playcounter.desktop\battlenet-profile",
            "",
        ] {
            assert!(!inside_profile(reported, dir), "{reported}");
        }
        assert!(!inside_profile(r"C:\anything", Path::new("")));
    }

    #[test]
    fn cancellation_before_start_and_late_cleanup_cannot_affect_a_new_attempt() {
        let mut sessions = Sessions::default();
        sessions.cancel("first");
        assert_eq!(sessions.start("first").unwrap_err(), CANCELLED);
        let mut second = sessions.start("second").unwrap();
        assert!(sessions.start("overlap").is_err());
        sessions.cancel("second");
        assert!(second.try_recv().is_ok());
        assert!(sessions.start("third").is_err());
        sessions.finish("second");
        let mut third = sessions.start("third").unwrap();
        sessions.finish("second");
        sessions.cancel("second");
        assert!(third.try_recv().is_err());
        assert_eq!(sessions.active.as_ref().unwrap().0, "third");
    }

    #[test]
    fn sign_out_cancels_the_active_window_and_waits_for_its_cleanup() {
        let mut sessions = Sessions::default();
        let mut cancelled = sessions.start("sign-in").unwrap();
        sessions.cancel_active();
        assert!(cancelled.try_recv().is_ok());
        assert!(sessions.start("new-account").is_err());
        sessions.finish("sign-in");
        assert!(sessions.start("new-account").is_ok());
    }

    #[tokio::test]
    async fn foreground_preempts_a_probe_but_waits_for_its_profile_cleanup() {
        let state = Arc::new(AccountState::default());
        let cancelled = state.0.lock().unwrap().start_background("probe").unwrap();
        let foreground_state = state.clone();
        let foreground =
            tokio::spawn(async move { start_foreground(&foreground_state, "interactive").await });
        tokio::time::timeout(Duration::from_secs(1), cancelled)
            .await
            .unwrap()
            .unwrap();
        assert!(!foreground.is_finished());
        assert!(state.0.lock().unwrap().is_active());
        state.0.lock().unwrap().finish("probe");
        let _cancelled = tokio::time::timeout(Duration::from_secs(1), foreground)
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        let sessions = state.0.lock().unwrap();
        assert_eq!(sessions.active.as_ref().unwrap().0, "interactive");
        assert!(!sessions.background);
    }

    #[test]
    fn a_background_probe_never_preempts_a_foreground_connection() {
        let mut sessions = Sessions::default();
        let mut cancelled = sessions.start("interactive").unwrap();
        assert!(sessions.start_background("probe").is_err());
        assert!(!sessions.preempt_background());
        assert!(cancelled.try_recv().is_err());
    }

    #[test]
    fn a_login_form_is_distinct_from_a_temporary_challenge() {
        assert!(login_form_page(
            &"https://eu.account.battle.net/login/en-us/"
                .parse()
                .unwrap()
        ));
        for url in [
            "https://account.battle.net/overview",
            "https://eu.account.battle.net/challenge",
            "https://eu.account.battle.net.evil.test/login/",
        ] {
            assert!(!login_form_page(&url.parse().unwrap()));
        }
    }
}
