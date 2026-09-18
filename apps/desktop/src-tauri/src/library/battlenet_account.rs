//! Optional, temporary account-site session. These are website endpoints, not
//! Blizzard's public OAuth API. Remote pages receive no Tauri capabilities.
use serde::{Deserialize, Serialize};
use std::{collections::VecDeque, sync::Mutex, time::Duration};
use tauri::{webview::NewWindowResponse, AppHandle, Manager, State, WebviewUrl, WebviewWindow};
use tokio::sync::oneshot;

const ACCOUNT_URL: &str = "https://account.battle.net/oauth2/authorization/account-settings";
const READ_LIBRARY: &str = include_str!("battlenet_account.js");
const CANCELLED: &str = "Battle.net sign-in was cancelled.";

#[derive(Default)]
pub struct AccountState(Mutex<Sessions>);

#[derive(Default)]
struct Sessions {
    active: Option<(String, oneshot::Sender<()>)>,
    // Cancellation can arrive while the start command is still queued.
    cancelled: VecDeque<String>,
}

impl Sessions {
    fn start(&mut self, id: &str) -> Result<oneshot::Receiver<()>, String> {
        if let Some(index) = self.cancelled.iter().position(|item| item == id) {
            self.cancelled.remove(index);
            return Err(CANCELLED.into());
        }
        if self.active.is_some() {
            return Err("A Battle.net sign-in is already open. Finish or cancel it first.".into());
        }
        let (sender, receiver) = oneshot::channel();
        self.active = Some((id.into(), sender));
        Ok(receiver)
    }

    fn cancel(&mut self, id: &str) {
        if self.active.as_ref().is_some_and(|(active, _)| active == id) {
            if let Some((_, sender)) = self.active.take() {
                let _ = sender.send(());
            }
        } else if !self.cancelled.iter().any(|item| item == id) {
            self.cancelled.push_back(id.into());
            while self.cancelled.len() > 16 {
                self.cancelled.pop_front();
            }
        }
    }

    fn finish(&mut self, id: &str) {
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
    // Battle.net also offers external identity providers. They stay inside this
    // unprivileged webview; local pages, protocols and downloads are blocked.
    const DOMAINS: &[&str] = &[
        "battle.net",
        "blizzard.com",
        "google.com",
        "apple.com",
        "live.com",
        "microsoft.com",
        "microsoftonline.com",
        "xbox.com",
        "playstation.com",
        "sonyentertainmentnetwork.com",
        "steampowered.com",
        "steamcommunity.com",
    ];
    url.scheme() == "https"
        && url.port_or_known_default() == Some(443)
        && url.username().is_empty()
        && url.password().is_none()
        && url.host_str().is_some_and(|host| {
            DOMAINS.iter().any(|domain| {
                host == *domain
                    || host
                        .strip_suffix(domain)
                        .is_some_and(|prefix| prefix.ends_with('.'))
            })
        })
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
    let sign_in = tauri::WebviewWindowBuilder::new(
        &app,
        format!("battlenet-sign-in-{id}"),
        WebviewUrl::External(ACCOUNT_URL.parse().expect("fixed Battle.net URL")),
    )
    .title("Battle.net sign-in — PlayCounter")
    .inner_size(1000.0, 760.0)
    .min_inner_size(640.0, 560.0)
    .incognito(true)
    .on_navigation(login_navigation)
    .on_new_window(|_, _| NewWindowResponse::Deny)
    .on_download(|_, _| false)
    .build();
    let result = match sign_in {
        Err(_) => Err("Could not open Battle.net sign-in. Please try again.".into()),
        Ok(sign_in) => {
            let close_app = app.clone();
            let close_id = id.clone();
            sign_in.on_window_event(move |event| {
                if matches!(
                    event,
                    tauri::WindowEvent::CloseRequested { .. } | tauri::WindowEvent::Destroyed
                ) {
                    if let Ok(mut sessions) = close_app.state::<AccountState>().0.lock() {
                        sessions.cancel(&close_id);
                    }
                }
            });
            let result = tokio::select! {
                biased;
                _ = cancelled => Err(CANCELLED.into()),
                result = tokio::time::timeout(Duration::from_secs(600), read_library(&sign_in)) => {
                    result.unwrap_or_else(|_| Err("Battle.net sign-in timed out. Please try again.".into()))
                }
            };
            // Incognito cookies are discarded with the window, including on
            // cancellation, timeout and failed account reads.
            let _ = sign_in.destroy();
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
        ] {
            assert!(!login_navigation(&value.parse().unwrap()));
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
        let mut third = sessions.start("third").unwrap();
        sessions.finish("second");
        sessions.cancel("second");
        assert!(third.try_recv().is_err());
        assert_eq!(sessions.active.as_ref().unwrap().0, "third");
    }
}
