//! Optional GOG sign-in for the account's games and the playtime GOG recorded.
//! GOG has no public API for this. Like Heroic, Minigalaxy and Lutris, the
//! import signs in as GOG GALAXY and reads GOG's own services, which can
//! change without notice.
//!
//! The sign-in page runs in a hardened InPrivate webview. When the player is
//! done, GOG opens an address that carries a one-time code; that navigation is
//! stopped and only the code leaves the window. The refresh token is kept
//! encrypted on this PC (see `kept_logins`), so the next import needs no
//! window. Only product ids, titles and playtime reach the frontend, and the
//! GOG user name for "Signed in as".
use super::battlenet_account::{
    clear_profile_data, secure_window, ExpectedProfile, Sessions, CANCELLED as SESSION_CANCELLED,
};
use super::kept_logins::{KeptLogin, Service, Store};
use super::login_status::LoginStatus;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::{BTreeMap, BTreeSet, HashMap},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tauri::{webview::NewWindowResponse, AppHandle, Manager, State, WebviewUrl, WebviewWindow};
use tokio::sync::{oneshot, Semaphore};

// GOG GALAXY's own app, as used by Heroic, Minigalaxy and Lutris.
const CLIENT_ID: &str = "46899977096215655";
const CLIENT_SECRET: &str = "9d85c43b1482497dbbce61f6e4aa173a433796eeae2ca8c5f6129f2dc4de46d9";
const REDIRECT_URI: &str = "https://embed.gog.com/on_login_success?origin=client";
const LOGIN_URL: &str = "https://auth.gog.com/auth?client_id=46899977096215655&redirect_uri=https%3A%2F%2Fembed.gog.com%2Fon_login_success%3Forigin%3Dclient&response_type=code&layout=client2";
const TOKEN_URL: &str = "https://auth.gog.com/token";
const USER_URL: &str = "https://embed.gog.com/userData.json";
const LIBRARY_URL: &str = "https://embed.gog.com/account/getFilteredProducts";
const PLAYTIME_URL: &str = "https://gameplay.gog.com/games";
const CANCELLED: &str = "GOG sign-in was cancelled.";
const UNAVAILABLE: &str =
    "GOG could not provide your game list. Try again, or scan installed games.";
const MAX_LIBRARY_PAGES: u32 = 100;
const MAX_GAMES: usize = 5_000;
const PLAYTIME_REQUESTS_IN_FLIGHT: usize = 6;
// The refresh token changes on every use. Background checks, imports and
// sign-ins must never redeem the same saved token at the same time.
pub(super) static AUTHENTICATING: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

#[derive(Default)]
pub struct GogAccountState(Mutex<Sessions>);

pub(super) fn cancel_active(app: &AppHandle) {
    if let Some(state) = app.try_state::<GogAccountState>() {
        if let Ok(mut sessions) = state.0.lock() {
            sessions.cancel_active();
        }
    }
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AccountGame {
    product_id: String,
    title: String,
    /// `None` when GOG's playtime service could not be read for this game.
    playtime_seconds: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountLibrary {
    games: Vec<AccountGame>,
    incomplete: bool,
}

#[derive(Debug, Deserialize)]
pub(super) struct Token {
    pub(super) access_token: String,
    #[serde(default)]
    refresh_token: Option<String>,
    #[serde(default)]
    user_id: Value,
}

impl Token {
    /// GOG's numeric user id, which the playtime service is addressed by.
    pub(super) fn user(&self) -> Option<String> {
        let id = match &self.user_id {
            Value::String(text) => text.trim().to_owned(),
            Value::Number(number) => number.to_string(),
            _ => return None,
        };
        (!id.is_empty() && id.len() <= 32 && id.bytes().all(|byte| byte.is_ascii_digit()))
            .then_some(id)
    }
}

/// Why GOG gave no token.
#[derive(Debug, PartialEq)]
pub(super) enum TokenFailure {
    /// GOG confirmed that this sign-in expired or was revoked.
    Refused(String),
    /// GOG did not answer properly. A kept sign-in stays.
    Unavailable,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProductsPage {
    #[serde(default)]
    total_pages: u32,
    #[serde(default)]
    products: Vec<Product>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Product {
    #[serde(default)]
    id: Value,
    #[serde(default)]
    title: String,
    #[serde(default)]
    is_game: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct PlaytimeAnswer {
    /// Minutes, as Heroic and Comet read it.
    time_sum: u64,
}

#[derive(Debug, Deserialize)]
struct UserData {
    #[serde(default)]
    username: Option<String>,
}

pub(super) fn secure_https(url: &tauri::Url) -> bool {
    url.scheme() == "https"
        && url.port_or_known_default() == Some(443)
        && url.username().is_empty()
        && url.password().is_none()
}

/// GOG's login pages and the five partners it offers for signing in.
fn login_navigation(url: &tauri::Url) -> bool {
    // Exact hosts only. A partner sign-in leaves GOG and comes back to it.
    const HOSTS: &[&str] = &[
        "auth.gog.com",
        "login.gog.com",
        "external-accounts.gog.com",
        "gog.com",
        "www.gog.com",
        "accounts.google.com",
        "steamcommunity.com",
        "discord.com",
        "login.live.com",
        "account.live.com",
        "login.microsoftonline.com",
        "login.microsoft.com",
        "appleid.apple.com",
        "account.apple.com",
    ];
    secure_https(url) && url.host_str().is_some_and(|host| HOSTS.contains(&host))
}

/// GOG's "done" address carries the one-time code. `None`: another page.
fn redirect_code(url: &tauri::Url) -> Option<Result<String, ()>> {
    if !secure_https(url)
        || url.host_str() != Some("embed.gog.com")
        || url.path() != "/on_login_success"
    {
        return None;
    }
    let code = url
        .query_pairs()
        .find(|(key, _)| key == "code")
        .map(|(_, value)| value.into_owned());
    Some(
        code.filter(|code| {
            !code.is_empty()
                && code.len() <= 4096
                && code.bytes().all(|byte| {
                    byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~')
                })
        })
        .ok_or(()),
    )
}

/// Only GOG's explicit refusal ends a kept sign-in. Proxy errors, outages and
/// changed endpoints must not sign the player out.
fn token_failure(status: u16, body: &str) -> TokenFailure {
    let error = serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|value| value["error"].as_str().map(str::to_owned));
    if status == 400 && error.as_deref() == Some("invalid_grant") {
        TokenFailure::Refused(
            "GOG sign-in expired or could not be verified. Please sign in again.".into(),
        )
    } else {
        TokenFailure::Unavailable
    }
}

fn product_id(product: &Product) -> Option<String> {
    if product.is_game == Some(false) {
        return None;
    }
    let id = match &product.id {
        Value::String(text) => text.trim().to_owned(),
        Value::Number(number) => number.to_string(),
        _ => return None,
    };
    super::gog::valid_id(&id).then_some(id)
}

fn build_library(
    products: &[Product],
    minutes: &HashMap<String, u64>,
    truncated: bool,
) -> AccountLibrary {
    let mut games = BTreeMap::new();
    for product in products {
        let Some(id) = product_id(product) else {
            continue;
        };
        let title: String = product.title.trim().chars().take(256).collect();
        if title.is_empty() || games.contains_key(&id) {
            continue;
        }
        games.insert(
            id.clone(),
            AccountGame {
                playtime_seconds: minutes.get(&id).map(|value| value.saturating_mul(60)),
                product_id: id,
                title,
            },
        );
    }
    let incomplete = truncated
        || games.len() > MAX_GAMES
        || games.values().any(|game| game.playtime_seconds.is_none());
    AccountLibrary {
        games: games.into_values().take(MAX_GAMES).collect(),
        incomplete,
    }
}

/// Persist before returning authentication success or reading any games.
/// A renewal may leave out an unchanged refresh token.
fn keep(
    store: &Store,
    token: &Token,
    name: Option<String>,
    previous: Option<&KeptLogin>,
) -> Result<(), String> {
    let secret = token
        .refresh_token
        .as_deref()
        .or_else(|| previous.map(|login| login.secret.as_str()))
        .filter(|secret| !secret.is_empty() && secret.len() <= 8192)
        .ok_or("GOG did not provide a reusable sign-in. Please try again.")?;
    let name = name.or_else(|| previous.and_then(|login| login.name.clone()));
    store
        .save(Service::Gog, &KeptLogin::new(secret.to_owned(), name))
        .map_err(|_| "Could not securely save the GOG sign-in. Please try again.".into())
}

/// Debug builds only: how a GOG service answered. Never a token, id or name.
pub(super) fn debug_answer(step: &str, detail: impl std::fmt::Display) {
    #[cfg(debug_assertions)]
    eprintln!("[gog] {step}: {detail}");
    #[cfg(not(debug_assertions))]
    let _ = (step, detail.to_string());
}

pub(super) fn http_client() -> Result<reqwest::Client, String> {
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
    reqwest::Client::builder()
        .user_agent("PlayCounter")
        .timeout(Duration::from_secs(30))
        // GOG answers "not signed in" with a redirect; a token never follows one.
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "Could not connect to GOG.".into())
}

fn with_query(base: &str, pairs: &[(&str, &str)]) -> Result<tauri::Url, String> {
    let mut url = tauri::Url::parse(base).map_err(|_| UNAVAILABLE)?;
    if !pairs.is_empty() {
        url.query_pairs_mut().extend_pairs(pairs);
    }
    Ok(url)
}

/// Which step failed and how, for the message and for support.
fn unavailable(step: &str, detail: &str) -> String {
    format!("GOG could not provide your game list ({step}: {detail}). Try again, or scan installed games.")
}

async fn request_token(
    client: &reqwest::Client,
    pairs: &[(&str, &str)],
) -> Result<Token, TokenFailure> {
    let mut query = vec![("client_id", CLIENT_ID), ("client_secret", CLIENT_SECRET)];
    query.extend_from_slice(pairs);
    let url = with_query(TOKEN_URL, &query).map_err(|_| TokenFailure::Unavailable)?;
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|_| TokenFailure::Unavailable)?;
    let status = response.status();
    if !status.is_success() {
        debug_answer("token", status);
        let body = response.text().await.unwrap_or_default();
        return Err(token_failure(status.as_u16(), &body));
    }
    let token: Token = response
        .json()
        .await
        .map_err(|_| TokenFailure::Unavailable)?;
    if token.access_token.is_empty() || token.user().is_none() {
        debug_answer("token", "answer without a token or user");
        return Err(TokenFailure::Unavailable);
    }
    Ok(token)
}

async fn exchange_code(client: &reqwest::Client, code: &str) -> Result<Token, TokenFailure> {
    request_token(
        client,
        &[
            ("grant_type", "authorization_code"),
            ("code", code),
            ("redirect_uri", REDIRECT_URI),
        ],
    )
    .await
}

pub(super) async fn renew(
    client: &reqwest::Client,
    refresh_token: &str,
) -> Result<Token, TokenFailure> {
    request_token(
        client,
        &[
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh_token),
        ],
    )
    .await
}

/// The GOG user name for "Signed in as". Its account details also hold the
/// e-mail address, which is never read.
async fn read_user_name(client: &reqwest::Client, token: &Token) -> Option<String> {
    let response = client
        .get(USER_URL)
        .bearer_auth(&token.access_token)
        .send()
        .await
        .ok()?;
    if !response.status().is_success() {
        debug_answer("user", response.status());
        return None;
    }
    let data: UserData = response.json().await.ok()?;
    data.username
        .map(|name| name.trim().to_owned())
        .filter(|name| !name.is_empty())
}

/// Once a code exchange or renewal has started, finish it and save the token
/// even if the caller leaves the view: GOG has already replaced the old one.
pub(super) async fn finish_authentication(
    store: &Store,
    client: &reqwest::Client,
    previous: Option<&KeptLogin>,
    request: impl std::future::Future<Output = Result<Token, TokenFailure>>,
) -> Result<Option<Token>, String> {
    let token = match request.await {
        Ok(token) => token,
        Err(TokenFailure::Refused(_)) if previous.is_some() => {
            store.delete(Service::Gog)?;
            return Ok(None);
        }
        Err(TokenFailure::Refused(message)) => return Err(message),
        Err(TokenFailure::Unavailable) => return Err(UNAVAILABLE.into()),
    };
    keep(store, &token, None, previous)?;
    if previous.and_then(|login| login.name.as_ref()).is_none() {
        // A missing name never undoes the saved sign-in.
        if let Some(name) = read_user_name(client, &token).await {
            let _ = keep(store, &token, Some(name), previous);
        }
    }
    Ok(Some(token))
}

/// Check only the saved sign-in. No window, game list or account details.
pub(super) async fn check_saved_login(app: &AppHandle) -> LoginStatus {
    if !cfg!(windows) {
        return LoginStatus::SignedOut;
    }
    let Ok(_guard) = AUTHENTICATING.try_lock() else {
        return LoginStatus::Busy;
    };
    if app.try_state::<GogAccountState>().is_some_and(|state| {
        state
            .0
            .lock()
            .map(|sessions| sessions.is_active())
            .unwrap_or(true)
    }) {
        return LoginStatus::Busy;
    }
    let Ok(store) = Store::of(app) else {
        return LoginStatus::Unavailable;
    };
    let previous = match store.try_load(Service::Gog) {
        Ok(Some(previous)) => previous,
        Ok(None) => return LoginStatus::SignedOut,
        Err(_) => return LoginStatus::Unavailable,
    };
    let Ok(client) = http_client() else {
        return LoginStatus::Unavailable;
    };
    let response = renew(&client, &previous.secret).await;
    finish_saved_check(&store, &previous, response)
}

fn finish_saved_check(
    store: &Store,
    previous: &KeptLogin,
    response: Result<Token, TokenFailure>,
) -> LoginStatus {
    if !store.is_current(Service::Gog) {
        return LoginStatus::SignedOut;
    }
    match response {
        Ok(token) => {
            if keep(store, &token, None, Some(previous)).is_ok() {
                LoginStatus::Valid
            } else {
                LoginStatus::Unavailable
            }
        }
        // The record stays until the player signs in again or signs out.
        Err(TokenFailure::Refused(_)) => LoginStatus::NeedsSignIn,
        Err(TokenFailure::Unavailable) => LoginStatus::Unavailable,
    }
}

async fn get_json<T: DeserializeOwned>(
    client: &reqwest::Client,
    token: &Token,
    url: tauri::Url,
    step: &str,
) -> Result<T, String> {
    let response = client
        .get(url)
        .bearer_auth(&token.access_token)
        .send()
        .await
        .map_err(|_| unavailable(step, "no answer"))?;
    let status = response.status();
    if !status.is_success() {
        debug_answer(step, status);
        return Err(unavailable(step, &status.as_u16().to_string()));
    }
    response
        .json()
        .await
        .map_err(|_| unavailable(step, "unreadable answer"))
}

/// The account's games, page by page. `true` when the list was cut short.
async fn read_products(
    client: &reqwest::Client,
    token: &Token,
) -> Result<(Vec<Product>, bool), String> {
    let mut products = Vec::new();
    let mut page = 1u32;
    loop {
        let url = with_query(
            LIBRARY_URL,
            &[("mediaType", "1"), ("page", &page.to_string())],
        )?;
        let answer: ProductsPage = get_json(client, token, url, "games").await?;
        if page == 1 {
            debug_answer("games", format!("{} pages", answer.total_pages));
        }
        products.extend(answer.products);
        if page >= answer.total_pages {
            return Ok((products, false));
        }
        if page >= MAX_LIBRARY_PAGES {
            return Ok((products, true));
        }
        page += 1;
    }
}

/// GOG's minutes per game. A game whose answer could not be read is missing.
async fn read_playtime(
    client: &reqwest::Client,
    token: &Token,
    user: &str,
    ids: Vec<String>,
) -> HashMap<String, u64> {
    let limit = Arc::new(Semaphore::new(PLAYTIME_REQUESTS_IN_FLIGHT));
    let mut tasks = tokio::task::JoinSet::new();
    for id in ids {
        let client = client.clone();
        let access_token = token.access_token.clone();
        let url = format!("{PLAYTIME_URL}/{id}/users/{user}/sessions");
        let limit = limit.clone();
        tasks.spawn(async move {
            let _permit = limit.acquire_owned().await.ok()?;
            let response = client
                .get(url)
                .bearer_auth(access_token)
                .send()
                .await
                .ok()?;
            if !response.status().is_success() {
                debug_answer("playtime", response.status());
                return None;
            }
            let answer: PlaytimeAnswer = response.json().await.ok()?;
            Some((id, answer.time_sum))
        });
    }
    let mut minutes = HashMap::new();
    while let Some(result) = tasks.join_next().await {
        if let Ok(Some((id, value))) = result {
            minutes.insert(id, value);
        }
    }
    minutes
}

async fn read_account(client: &reqwest::Client, token: &Token) -> Result<AccountLibrary, String> {
    let user = token.user().ok_or_else(|| UNAVAILABLE.to_string())?;
    let (products, truncated) = read_products(client, token).await?;
    let ids: BTreeSet<String> = products.iter().filter_map(product_id).collect();
    let minutes = read_playtime(client, token, &user, ids.into_iter().collect()).await;
    Ok(build_library(&products, &minutes, truncated))
}

/// The sign-in is already saved. Only the game read can be cancelled, and
/// neither cancelling nor a failed read removes the sign-in.
async fn finish_account(
    client: &reqwest::Client,
    token: &Token,
    cancelled: &mut oneshot::Receiver<()>,
    was_cancelled: bool,
    read_games: bool,
) -> Result<Option<AccountLibrary>, String> {
    if was_cancelled {
        return Err(CANCELLED.into());
    }
    tokio::select! {
        biased;
        _ = cancelled => Err(CANCELLED.into()),
        result = async {
            if !read_games {
                return Ok(None);
            }
            tokio::time::timeout(Duration::from_secs(300), read_account(client, token))
                .await
                .unwrap_or_else(|_| Err("GOG took too long to answer. Please try again.".into()))
                .map(Some)
        } => result,
    }
}

#[tauri::command]
pub async fn library_gog_account_games(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, GogAccountState>,
    request_id: String,
    // "GOG sign-in" in the main window's language, for the window title.
    title: String,
) -> Result<AccountLibrary, String> {
    run_account_session(app, window, state, request_id, title, true)
        .await?
        .ok_or_else(|| UNAVAILABLE.into())
}

/// Account management connects at once, without reading the games.
#[tauri::command]
pub async fn library_gog_sign_in(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, GogAccountState>,
    request_id: String,
    title: String,
) -> Result<(), String> {
    run_account_session(app, window, state, request_id, title, false)
        .await
        .map(|_| ())
}

async fn run_account_session(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, GogAccountState>,
    request_id: String,
    title: String,
    read_games: bool,
) -> Result<Option<AccountLibrary>, String> {
    if window.label() != "main" || !cfg!(windows) {
        return Err("GOG sign-in is available in the Windows desktop app.".into());
    }
    let id = uuid::Uuid::parse_str(&request_id)
        .map_err(|_| "Invalid GOG sign-in request.")?
        .to_string();
    let mut cancelled = state
        .0
        .lock()
        .map_err(|_| "Could not start GOG sign-in.")?
        .start(&id)
        .map_err(|error| {
            if error == SESSION_CANCELLED {
                CANCELLED.to_string()
            } else {
                "A GOG sign-in is already open. Finish or cancel it first.".to_string()
            }
        })?;
    let (store, client) = match Store::of(&app).and_then(|store| Ok((store, http_client()?))) {
        Ok(ready) => ready,
        Err(error) => {
            if let Ok(mut sessions) = state.0.lock() {
                sessions.finish(&id);
            }
            return Err(error);
        }
    };
    // Renew and save without racing cancellation. The HTTP client bounds this
    // to 30 seconds, and signing out still invalidates the store.
    let authenticating = AUTHENTICATING.lock().await;
    let previous = match store.try_load(Service::Gog) {
        Ok(previous) => previous,
        Err(_) => {
            if let Ok(mut sessions) = state.0.lock() {
                sessions.finish(&id);
            }
            return Err(UNAVAILABLE.into());
        }
    };
    if let Some(login) = previous {
        let kept =
            finish_authentication(&store, &client, Some(&login), renew(&client, &login.secret))
                .await;
        drop(authenticating);
        if !matches!(kept, Ok(None)) {
            let result = match kept {
                Ok(Some(token)) => {
                    finish_account(&client, &token, &mut cancelled, false, read_games).await
                }
                Err(error) => Err(error),
                Ok(None) => unreachable!(),
            };
            if let Ok(mut sessions) = state.0.lock() {
                sessions.finish(&id);
            }
            return result;
        }
    } else {
        drop(authenticating);
    }
    if !matches!(
        cancelled.try_recv(),
        Err(oneshot::error::TryRecvError::Empty)
    ) {
        if let Ok(mut sessions) = state.0.lock() {
            sessions.finish(&id);
        }
        return Err(CANCELLED.into());
    }
    let (navigation_rejected, rejected_navigation) = oneshot::channel();
    let navigation_rejected = Mutex::new(Some(navigation_rejected));
    let (code_sent, mut code_received) = oneshot::channel::<Result<String, ()>>();
    let code_sent = Mutex::new(Some(code_sent));
    let sign_in = tauri::WebviewWindowBuilder::new(
        &app,
        format!("gog-sign-in-{id}"),
        WebviewUrl::External("about:blank".parse().unwrap()),
    )
    .title(format!("{title} — PlayCounter"))
    .additional_browser_args(crate::webview_args::WEBVIEW_BROWSER_ARGS)
    .inner_size(1000.0, 760.0)
    .min_inner_size(640.0, 560.0)
    .visible(false)
    .incognito(true)
    .devtools(false)
    .browser_extensions_enabled(false)
    .general_autofill_enabled(false)
    .on_navigation(move |url| {
        if let Some(code) = redirect_code(url) {
            if let Some(sender) = code_sent.lock().ok().and_then(|mut value| value.take()) {
                let _ = sender.send(code);
            }
            // The page behind the code never loads.
            return false;
        }
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
    })
    .on_new_window(|_, _| NewWindowResponse::Deny)
    .on_download(|_, _| false)
    .build();
    let mut was_cancelled = false;
    let authentication = match sign_in {
        Err(_) => Err("Could not open GOG sign-in. Please try again.".into()),
        Ok(sign_in) => {
            let close_app = app.clone();
            let close_id = id.clone();
            // Closing the window ourselves must not cancel the game read
            // that follows it.
            let closing = Arc::new(AtomicBool::new(false));
            let closing_event = closing.clone();
            sign_in.on_window_event(move |event| {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    // Keep the webview alive until the cleanup below is done.
                    api.prevent_close();
                }
                if !closing_event.load(Ordering::SeqCst)
                    && matches!(
                        event,
                        tauri::WindowEvent::CloseRequested { .. } | tauri::WindowEvent::Destroyed
                    )
                {
                    if let Ok(mut sessions) = close_app.state::<GogAccountState>().0.lock() {
                        sessions.cancel(&close_id);
                    }
                }
            });
            let setup = secure_window(&sign_in, ExpectedProfile::Private, true).await;
            let session_ready = setup.is_ok();
            let code: Result<String, String> = tokio::select! {
                biased;
                _ = &mut cancelled => {
                    was_cancelled = true;
                    Err(CANCELLED.into())
                },
                _ = rejected_navigation => Err("GOG tried to open an unsupported sign-in page. Update PlayCounter or use Find installed games.".into()),
                result = tokio::time::timeout(Duration::from_secs(600), async {
                    setup?;
                    sign_in.navigate(LOGIN_URL.parse().expect("fixed GOG URL"))
                        .map_err(|_| "Could not open GOG sign-in. Please try again.")?;
                    sign_in.show().map_err(|_| "Could not open GOG sign-in. Please try again.")?;
                    let _ = sign_in.set_focus();
                    match (&mut code_received).await {
                        Ok(Ok(code)) => Ok(code),
                        Ok(Err(())) => Err("GOG returned an invalid sign-in code. Please sign in again.".to_string()),
                        Err(_) => Err(CANCELLED.to_string()),
                    }
                }) => {
                    result.unwrap_or_else(|_| Err("GOG sign-in timed out. Please try again.".into()))
                }
            };
            // A code that arrived as the player left the view still counts.
            let code = match code {
                Err(_) if was_cancelled => match code_received.try_recv() {
                    Ok(Ok(code)) => Ok(code),
                    _ => Err(CANCELLED.to_string()),
                },
                other => other,
            };
            // Save the sign-in before cleaning up or reading any games.
            closing.store(true, Ordering::SeqCst);
            let _ = sign_in.hide();
            let authentication = match code {
                Ok(code) if store.is_current(Service::Gog) => {
                    let _guard = AUTHENTICATING.lock().await;
                    finish_authentication(&store, &client, None, exchange_code(&client, &code))
                        .await
                }
                Ok(_) => Err(CANCELLED.into()),
                Err(error) => Err(error),
            };
            let _ = sign_in.navigate("about:blank".parse().unwrap());
            let cleared = if session_ready {
                clear_profile_data(&sign_in, ExpectedProfile::Private).await
            } else {
                Ok(())
            };
            let destroyed = sign_in.destroy();
            if cleared.is_err() || destroyed.is_err() {
                // Leave the slot locked; restarting the app destroys its
                // private profile. Never reuse an uncleared session.
                return Err(
                    "Could not clear the GOG sign-in session. Close PlayCounter before signing in again."
                        .into(),
                );
            }
            authentication
        }
    };
    let result = match authentication {
        Err(error) => Err(error),
        Ok(Some(token)) => {
            finish_account(&client, &token, &mut cancelled, was_cancelled, read_games).await
        }
        Ok(None) => Err(UNAVAILABLE.into()),
    };
    if let Ok(mut sessions) = state.0.lock() {
        sessions.finish(&id);
    }
    result
}

#[tauri::command]
pub fn library_cancel_gog_account(
    window: WebviewWindow,
    state: State<'_, GogAccountState>,
    request_id: String,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("GOG sign-in must be cancelled from PlayCounter.".into());
    }
    let id = uuid::Uuid::parse_str(&request_id)
        .map_err(|_| "Invalid GOG sign-in request.")?
        .to_string();
    state
        .0
        .lock()
        .map_err(|_| "Could not cancel GOG sign-in.")?
        .cancel(&id);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(value: &str) -> tauri::Url {
        value.parse().unwrap()
    }

    #[test]
    fn only_gog_login_pages_and_its_sign_in_partners_are_trusted() {
        for value in [
            LOGIN_URL,
            "https://login.gog.com/auth?client_id=46899977096215655&layout=client2",
            "https://external-accounts.gog.com/login/providers/google/init",
            "https://accounts.google.com/o/oauth2/v2/auth",
            "https://steamcommunity.com/openid/login",
            "https://discord.com/oauth2/authorize",
            "https://login.live.com/oauth20_authorize.srf",
            "https://appleid.apple.com/auth/authorize",
        ] {
            assert!(login_navigation(&url(value)), "{value}");
        }
        for value in [
            "http://login.gog.com/auth",
            "https://login.gog.com.evil.test/",
            "https://login.gog.com@evil.test/",
            "https://login.gog.com:444/",
            "https://embed.gog.com/account",
            "https://store.steampowered.com/",
            "tauri://localhost/",
            "file:///C:/private.txt",
        ] {
            assert!(!login_navigation(&url(value)), "{value}");
        }
    }

    #[test]
    fn the_code_comes_only_from_gogs_exact_done_address() {
        assert_eq!(
            redirect_code(&url(
                "https://embed.gog.com/on_login_success?origin=client&code=Ab9-_x.Z~"
            )),
            Some(Ok("Ab9-_x.Z~".into()))
        );
        // GOG's done address without a usable code.
        for value in [
            "https://embed.gog.com/on_login_success?origin=client",
            "https://embed.gog.com/on_login_success?origin=client&code=",
            "https://embed.gog.com/on_login_success?origin=client&code=a%20b",
            "https://embed.gog.com/on_login_success?origin=client&code=a%26b%3Dc",
        ] {
            assert_eq!(redirect_code(&url(value)), Some(Err(())), "{value}");
        }
        // Lookalikes are other pages.
        for value in [
            "http://embed.gog.com/on_login_success?code=abc",
            "https://embed.gog.com.evil.test/on_login_success?code=abc",
            "https://embed.gog.com@evil.test/on_login_success?code=abc",
            "https://embed.gog.com:8443/on_login_success?code=abc",
            "https://embed.gog.com/on_login_successX?code=abc",
            "https://www.gog.com/on_login_success?code=abc",
            "https://login.gog.com/auth?code=abc",
        ] {
            assert_eq!(redirect_code(&url(value)), None, "{value}");
        }
    }

    #[test]
    fn reads_gogs_token_answer() {
        let token: Token = serde_json::from_str(
            r#"{"expires_in":3600,"scope":"","token_type":"bearer","access_token":"a1","user_id":"60181324713465405","refresh_token":"r1","session_id":"s1"}"#,
        )
        .unwrap();
        assert_eq!(token.refresh_token.as_deref(), Some("r1"));
        assert_eq!(token.user().as_deref(), Some("60181324713465405"));
        let numeric: Token =
            serde_json::from_str(r#"{"access_token":"a","user_id":60181324713465405}"#).unwrap();
        assert_eq!(numeric.user().as_deref(), Some("60181324713465405"));
        let odd: Token = serde_json::from_str(r#"{"access_token":"a","user_id":"1/2"}"#).unwrap();
        assert_eq!(odd.user(), None);
    }

    #[test]
    fn only_gogs_refusal_ends_a_kept_sign_in() {
        // GOG's live answer to a refresh token it does not know.
        assert!(matches!(
            token_failure(
                400,
                r#"{"error":"invalid_grant","error_description":"Invalid refresh token, client_id:46899977096215655"}"#
            ),
            TokenFailure::Refused(message) if message.contains("sign in again")
        ));
        for status in [400, 401, 403, 404, 408, 429, 500, 503] {
            for body in ["{}", "not json", r#"{"error":"server_error"}"#] {
                assert_eq!(token_failure(status, body), TokenFailure::Unavailable);
            }
        }
        for status in [429, 500, 503] {
            assert_eq!(
                token_failure(status, r#"{"error":"invalid_grant"}"#),
                TokenFailure::Unavailable
            );
        }
    }

    #[test]
    fn parses_gogs_game_list_and_playtime_answers() {
        // The shape Minigalaxy reads from the owned-games list.
        let page: ProductsPage = serde_json::from_str(
            r#"{"page":1,"totalPages":2,"productCount":2,"products":[{"id":1213504814,"title":"Middle-earth™: Shadow of Mordor™ Game of the Year Edition","image":"//images.gog-statics.com/x","url":"/game/middleearth_shadow_of_mordor","worksOn":{"Windows":true},"isGame":true,"isMovie":false},{"id":1207658924,"title":"The Witcher: Enhanced Edition"}]}"#,
        )
        .unwrap();
        assert_eq!(page.total_pages, 2);
        assert_eq!(page.products.len(), 2);
        assert_eq!(product_id(&page.products[0]).as_deref(), Some("1213504814"));
        // Heroic's and Comet's field, in minutes.
        let playtime: PlaytimeAnswer =
            serde_json::from_str(r#"{"time_sum":125,"sessions":[]}"#).unwrap();
        assert_eq!(playtime.time_sum, 125);
        let user: UserData = serde_json::from_str(
            r#"{"username":"zesarex","email":"x@example.com","isLoggedIn":true}"#,
        )
        .unwrap();
        assert_eq!(user.username.as_deref(), Some("zesarex"));
    }

    fn product(id: Value, title: &str) -> Product {
        Product {
            id,
            title: title.into(),
            is_game: None,
        }
    }

    #[test]
    fn keeps_owned_games_with_gogs_minutes_as_seconds() {
        let products = vec![
            product(1213504814.into(), "Middle-earth™: Shadow of Mordor™ GOTY"),
            product("1207658924".into(), " The Witcher: Enhanced Edition "),
            product(1.into(), "Fallout Classic"),
            // Not a game, not an id, no title, a repeat.
            Product {
                is_game: Some(false),
                ..product(42.into(), "A movie")
            },
            product("x".into(), "Broken"),
            product(7.into(), "  "),
            product(1.into(), "Fallout Classic"),
        ];
        let minutes = HashMap::from([("1207658924".to_string(), 125), ("1".to_string(), 0)]);
        let library = build_library(&products, &minutes, false);
        assert_eq!(
            library.games,
            vec![
                AccountGame {
                    product_id: "1".into(),
                    title: "Fallout Classic".into(),
                    playtime_seconds: Some(0),
                },
                AccountGame {
                    product_id: "1207658924".into(),
                    title: "The Witcher: Enhanced Edition".into(),
                    playtime_seconds: Some(7_500),
                },
                AccountGame {
                    product_id: "1213504814".into(),
                    title: "Middle-earth™: Shadow of Mordor™ GOTY".into(),
                    // Its playtime answer could not be read.
                    playtime_seconds: None,
                },
            ]
        );
        assert!(library.incomplete);
        let all_read = HashMap::from([
            ("1207658924".to_string(), 125),
            ("1".to_string(), 0),
            ("1213504814".to_string(), 0),
        ]);
        assert!(!build_library(&products, &all_read, false).incomplete);
        assert!(build_library(&products, &all_read, true).incomplete);
    }

    #[test]
    fn the_web_ui_gets_ids_titles_and_playtime_only() {
        let library = build_library(
            &[product(1.into(), "Fallout Classic")],
            &HashMap::from([("1".to_string(), 3)]),
            false,
        );
        let json = serde_json::to_value(&library).unwrap();
        assert_eq!(
            json,
            serde_json::json!({
                "games": [{"productId": "1", "title": "Fallout Classic", "playtimeSeconds": 180}],
                "incomplete": false
            })
        );
    }

    fn token(refresh_token: Option<&str>) -> Token {
        Token {
            access_token: "access".into(),
            refresh_token: refresh_token.map(str::to_owned),
            user_id: "60181324713465405".into(),
        }
    }

    #[cfg(windows)]
    #[test]
    fn a_sign_in_is_kept_only_with_a_refresh_token_and_renewals_keep_the_name() {
        let (store, dir) = Store::for_test();
        assert!(keep(&store, &token(None), Some("zesarex".into()), None).is_err());
        assert!(keep(&store, &token(Some("")), None, None).is_err());
        assert_eq!(store.load(Service::Gog), None);

        keep(&store, &token(Some("r1")), Some("zesarex".into()), None).unwrap();
        let kept = store.load(Service::Gog).unwrap();
        assert_eq!(kept.secret, "r1");
        assert_eq!(kept.name.as_deref(), Some("zesarex"));
        // GOG answers every renewal with a new refresh token.
        keep(&store, &token(Some("r2")), None, Some(&kept)).unwrap();
        let renewed = store.load(Service::Gog).unwrap();
        assert_eq!(renewed.secret, "r2");
        assert_eq!(renewed.name.as_deref(), Some("zesarex"));
        // An answer without one keeps the last.
        keep(&store, &token(None), None, Some(&renewed)).unwrap();
        assert_eq!(store.load(Service::Gog).unwrap().secret, "r2");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn a_refused_renewal_deletes_the_kept_sign_in_and_an_outage_keeps_it() {
        let (store, dir) = Store::for_test();
        let client = http_client().unwrap();
        keep(&store, &token(Some("r1")), Some("zesarex".into()), None).unwrap();
        let previous = store.load(Service::Gog).unwrap();
        assert!(
            finish_authentication(&store, &client, Some(&previous), async {
                Err(TokenFailure::Unavailable)
            })
            .await
            .is_err()
        );
        assert_eq!(store.load(Service::Gog).unwrap().secret, "r1");
        assert!(
            finish_authentication(&store, &client, Some(&previous), async {
                Err(TokenFailure::Refused("Expired".into()))
            })
            .await
            .unwrap()
            .is_none()
        );
        assert_eq!(store.load(Service::Gog), None);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn cancelling_during_authentication_still_saves_the_new_token() {
        let (store, dir) = Store::for_test();
        let client = http_client().unwrap();
        keep(&store, &token(Some("old")), Some("zesarex".into()), None).unwrap();
        let previous = store.load(Service::Gog);
        let (cancel, mut cancelled) = oneshot::channel();
        let (ready, started) = oneshot::channel();
        let (respond, response) = oneshot::channel();
        let session = async {
            let authenticated = finish_authentication(&store, &client, previous.as_ref(), async {
                ready.send(()).unwrap();
                response.await.unwrap()
            })
            .await
            .unwrap()
            .unwrap();
            finish_account(&client, &authenticated, &mut cancelled, false, false).await
        };
        let leave_after_request_started = async {
            started.await.unwrap();
            cancel.send(()).unwrap();
            tokio::task::yield_now().await;
            respond.send(Ok(token(Some("new")))).ok().unwrap();
        };
        let (result, ()) = tokio::join!(session, leave_after_request_started);
        assert!(matches!(result, Err(error) if error == CANCELLED));
        let saved = store.load(Service::Gog).unwrap();
        assert_eq!(saved.secret, "new");
        assert_eq!(saved.name.as_deref(), Some("zesarex"));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[cfg(windows)]
    #[test]
    fn background_checks_save_the_new_token_and_keep_the_sign_in_on_failures() {
        let (store, dir) = Store::for_test();
        keep(&store, &token(Some("r1")), Some("zesarex".into()), None).unwrap();
        let previous = store.load(Service::Gog).unwrap();
        assert_eq!(
            finish_saved_check(&store, &previous, Err(TokenFailure::Unavailable)),
            LoginStatus::Unavailable
        );
        assert_eq!(
            finish_saved_check(&store, &previous, Err(TokenFailure::Refused("x".into()))),
            LoginStatus::NeedsSignIn
        );
        assert_eq!(store.load(Service::Gog).unwrap().secret, "r1");
        assert_eq!(
            finish_saved_check(&store, &previous, Ok(token(Some("r2")))),
            LoginStatus::Valid
        );
        let renewed = store.load(Service::Gog).unwrap();
        assert_eq!(renewed.secret, "r2");
        assert_eq!(renewed.name.as_deref(), Some("zesarex"));
        let _ = std::fs::remove_dir_all(dir);
    }
}
