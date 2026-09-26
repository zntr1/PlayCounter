//! Optional, temporary account-site session. These are website endpoints, not
//! Blizzard's public OAuth API. Remote pages receive no Tauri capabilities.
use serde::{Deserialize, Serialize};
use std::{collections::VecDeque, sync::Mutex, time::Duration};
use tauri::{webview::NewWindowResponse, AppHandle, Manager, State, WebviewUrl, WebviewWindow};
use tokio::sync::oneshot;

const ACCOUNT_URL: &str = "https://account.battle.net/oauth2/authorization/account-settings";
const READ_LIBRARY: &str = include_str!("battlenet_account.js");
pub(super) const CANCELLED: &str = "Battle.net sign-in was cancelled.";

#[derive(Default)]
pub struct AccountState(Mutex<Sessions>);

/// One sign-in window at a time. Also used by the Epic Games account import.
#[derive(Default)]
pub(super) struct Sessions {
    active: Option<(String, Option<oneshot::Sender<()>>)>,
    // Cancellation can arrive while the start command is still queued.
    cancelled: VecDeque<String>,
}

impl Sessions {
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
        }
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

const PRIVATE_SESSION_ERROR: &str = "Could not create a secure private Battle.net session. Update Microsoft Edge WebView2 and try again, or scan installed games.";
const CLEANUP_ERROR: &str =
    "Could not clear the Battle.net sign-in session. Close PlayCounter before signing in again.";

// Start at about:blank. Some old WebView2 runtimes silently ignore Wry's
// incognito flag; no remote content may load until we verify the actual profile.
#[cfg(windows)]
pub(super) async fn secure_window(window: &WebviewWindow) -> Result<(), String> {
    use webview2_com::{Microsoft::Web::WebView2::Win32::*, PermissionRequestedEventHandler};
    use windows_core::Interface;

    let (sender, receiver) = oneshot::channel();
    window
        .with_webview(move |platform| {
            let configure = || -> windows_core::Result<bool> {
                unsafe {
                    let webview = platform.controller().CoreWebView2()?;
                    let profile = webview.cast::<ICoreWebView2_13>()?.Profile()?;
                    let mut private = Default::default();
                    profile.IsInPrivateModeEnabled(&mut private)?;
                    if !private.as_bool() {
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
        Ok(Ok(true)) => clear_private_data(window).await,
        _ => Err(PRIVATE_SESSION_ERROR.into()),
    }
}

#[cfg(windows)]
pub(super) async fn clear_private_data(window: &WebviewWindow) -> Result<(), String> {
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
                    let mut private = Default::default();
                    profile.IsInPrivateModeEnabled(&mut private)?;
                    // Never clear the main application's persistent profile.
                    if !private.as_bool() {
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
async fn secure_window(_: &WebviewWindow) -> Result<(), String> {
    Err(PRIVATE_SESSION_ERROR.into())
}

#[cfg(not(windows))]
async fn clear_private_data(_: &WebviewWindow) -> Result<(), String> {
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
        Some(ReadResult::Error { error }) => Err(if error == "expired" {
            "Battle.net sign-in expired or could not be verified. Please sign in again."
        } else {
            "Battle.net could not provide your game list. Try again, or scan installed games."
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

async fn read_library(window: &WebviewWindow) -> Result<AccountLibrary, String> {
    let mut interval = tokio::time::interval(Duration::from_millis(750));
    loop {
        interval.tick().await;
        if !account_page(&window.url().map_err(|_| CANCELLED)?) {
            continue;
        }
        let (sender, receiver) = oneshot::channel();
        let sender = Mutex::new(Some(sender));
        window
            .eval_with_callback(READ_LIBRARY, move |value| {
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
        if !account_page(&window.url().map_err(|_| CANCELLED)?) {
            continue;
        }
        if let Some(library) = decode_result(&value)? {
            return Ok(library);
        }
    }
}

#[tauri::command]
pub async fn library_battlenet_account_games(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, AccountState>,
    request_id: String,
) -> Result<AccountLibrary, String> {
    if window.label() != "main" || !cfg!(windows) {
        return Err("Battle.net sign-in is available in the Windows desktop app.".into());
    }
    let id = uuid::Uuid::parse_str(&request_id)
        .map_err(|_| "Invalid Battle.net sign-in request.")?
        .to_string();
    let cancelled = state
        .0
        .lock()
        .map_err(|_| "Could not start Battle.net sign-in.")?
        .start(&id)?;
    let (navigation_rejected, rejected_navigation) = oneshot::channel();
    let navigation_rejected = Mutex::new(Some(navigation_rejected));
    let sign_in = tauri::WebviewWindowBuilder::new(
        &app,
        format!("battlenet-sign-in-{id}"),
        WebviewUrl::External("about:blank".parse().unwrap()),
    )
    .title("Battle.net sign-in — PlayCounter")
    .additional_browser_args(crate::webview_args::WEBVIEW_BROWSER_ARGS)
    .inner_size(1000.0, 760.0)
    .min_inner_size(640.0, 560.0)
    .visible(false)
    .incognito(true)
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
    .on_page_load(|window, payload| {
        if let Some(host) = payload.url().host_str() {
            let _ = window.set_title(&format!("Battle.net sign-in — {host}"));
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
            // Do not cancel native preparation halfway through: its queued
            // profile clearing must finish before another attempt can start.
            let setup = secure_window(&sign_in).await;
            let session_ready = setup.is_ok();
            let result = tokio::select! {
                biased;
                _ = cancelled => Err(CANCELLED.into()),
                _ = rejected_navigation => Err("Battle.net tried to open an unsupported sign-in page. Update PlayCounter or use Find installed games.".into()),
                result = tokio::time::timeout(Duration::from_secs(600), async {
                    setup?;
                    sign_in.navigate(ACCOUNT_URL.parse().expect("fixed Battle.net URL"))
                        .map_err(|_| PRIVATE_SESSION_ERROR)?;
                    sign_in.show().map_err(|_| PRIVATE_SESSION_ERROR)?;
                    let _ = sign_in.set_focus();
                    read_library(&sign_in).await
                }) => {
                    result.unwrap_or_else(|_| Err("Battle.net sign-in timed out. Please try again.".into()))
                }
            };
            // Await clearing, not just its scheduling. A retry cannot start
            // while the prior private profile is still authenticated.
            let _ = sign_in.hide();
            let _ = sign_in.navigate("about:blank".parse().unwrap());
            let cleared = if session_ready {
                clear_private_data(&sign_in).await
            } else {
                Ok(())
            };
            let destroyed = sign_in.destroy();
            if cleared.is_err() || destroyed.is_err() {
                // Leave the slot locked; restarting the app destroys its
                // private profile. Never silently reuse an uncleared session.
                return Err(CLEANUP_ERROR.into());
            }
            result
        }
    };
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
}
