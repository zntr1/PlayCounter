//! Optional Nintendo Account sign-in for the play history Nintendo keeps:
//! every Switch and Switch 2 game the account played (and 3DS / Wii U games
//! up to February 2020) with its total playtime. Nintendo has no public API
//! for this. Like nintendo-go and Ludex, the import signs in as Nintendo's
//! own Nintendo Store app and reads that app's play history, which can change
//! without notice (docs/nintendo-import-plan.md).
//!
//! The sign-in page runs in a hardened InPrivate webview. When the player
//! picks their account ("Select this person"), Nintendo opens the app's
//! address with a one-time code; that navigation is stopped and opens
//! nothing. With the PKCE verifier made here, the code becomes Nintendo's
//! session token (two years), kept encrypted on this PC (see `kept_logins`).
//! It makes a 15-minute access token for each read. "Sign in with a link"
//! does the same with the link the player copies from Nintendo's page in the
//! browser. Only title ids, titles, playtime, last played dates, the
//! nickname for "Signed in as" and a key made from the account id (to keep
//! each account's hours apart) reach the frontend.
use super::battlenet_account::{
    clear_profile_data, secure_window, ExpectedProfile, Sessions, CANCELLED as SESSION_CANCELLED,
};
use super::kept_logins::{KeptLogin, Service, Store};
use super::login_status::LoginStatus;
use super::scan_account::ScanAccount;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::BTreeMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tauri::{webview::NewWindowResponse, AppHandle, Manager, State, WebviewUrl, WebviewWindow};
use tokio::sync::oneshot;

// The Nintendo Store app's public id, as nintendo-go and Ludex send it.
const CLIENT_ID: &str = "5c38e31cd085304b";
const REDIRECT_URI: &str = "npf5c38e31cd085304b://auth";
const REDIRECT_SCHEME: &str = "npf5c38e31cd085304b";
const SCOPE: &str = "openid user user.mii user.email user.links[].id";
const AUTHORIZE_URL: &str = "https://accounts.nintendo.com/connect/1.0.0/authorize";
const SESSION_TOKEN_URL: &str = "https://accounts.nintendo.com/connect/1.0.0/api/session_token";
const TOKEN_URL: &str = "https://accounts.nintendo.com/connect/1.0.0/api/token";
const TOKEN_GRANT: &str = "urn:ietf:params:oauth:grant-type:jwt-bearer-session-token";
const USER_URL: &str = "https://api.accounts.nintendo.com/2.0.0/users/me";
const HISTORY_URL: &str = "https://app-api.znej.nintendo.com/api/v2.0/users/me/play_histories";
/// The Nintendo Store app's own User-Agent (answered 200 on 2026-11-14).
const APP_USER_AGENT: &str = "com.nintendo.znej/3.0.3 (iOS/26.0.1)";
/// Nintendo answers 400 without a locale. English titles match IGDB best.
const LOCALE: &str = "en-GB";
const CANCELLED: &str = "Nintendo sign-in was cancelled.";
const UNAVAILABLE: &str = "Nintendo could not provide your play history. Try again later.";
const REFUSED: &str = "Nintendo sign-in expired or could not be verified. Please sign in again.";
const NOT_SAVED: &str = "Could not securely save the Nintendo sign-in. Please try again.";
const NOT_OPENED: &str = "Could not open Nintendo sign-in. Please try again.";
/// Nintendo's one-time code is valid for 10 minutes (checked 2026-11-14).
const LINK_VALID_FOR: Duration = Duration::from_secs(600);
const MAX_GAMES: usize = 5_000;

#[derive(Default)]
pub struct NintendoAccountState {
    sessions: Mutex<Sessions>,
    /// The current access token (15 minutes), in memory only.
    access: Mutex<Option<CachedAccess>>,
    /// "Sign in with a link": the one sign-in opened in the browser.
    link: Mutex<Option<PendingLink>>,
}

struct CachedAccess {
    saved_at: u64,
    token: String,
    account_id: Option<String>,
    until: Instant,
}

struct PendingLink {
    pkce: Pkce,
    until: Instant,
}

pub(super) fn cancel_active(app: &AppHandle) {
    if let Some(state) = app.try_state::<NintendoAccountState>() {
        if let Ok(mut sessions) = state.sessions.lock() {
            sessions.cancel_active();
        }
        if let Ok(mut link) = state.link.lock() {
            *link = None;
        }
        forget_access(&state);
    }
}

fn forget_access(state: &NintendoAccountState) {
    if let Ok(mut access) = state.access.lock() {
        *access = None;
    }
}

/// One game of the play history. Rows of one title id (a game played on a
/// Switch and a Switch 2) are added up.
#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AccountGame {
    /// Nintendo's title id, lowercase: "0100000000010000".
    title_id: String,
    /// Nintendo's name, often in capitals: "SUPER MARIO ODYSSEY". May be
    /// empty.
    title: String,
    /// Nintendo's whole minutes as seconds. `None` without a readable total.
    playtime_seconds: Option<u64>,
    /// Nintendo's ISO time, e.g. "2018-11-24T03:13:27Z".
    last_played_at: Option<String>,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AccountLibrary {
    games: Vec<AccountGame>,
    /// The account read, by its key: the id never leaves Rust.
    #[serde(skip_serializing_if = "Option::is_none")]
    account: Option<ScanAccount>,
}

fn of_account(games: Vec<AccountGame>, account_id: Option<&str>) -> AccountLibrary {
    AccountLibrary {
        games,
        account: account_id.map(|id| ScanAccount::new("nintendo", id, None)),
    }
}

/// A background read with the kept sign-in only. Never opens a window.
#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SavedRead<T> {
    status: LoginStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    value: Option<T>,
    /// Nintendo answered 429: wait before asking again.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    rate_limited: bool,
}

impl<T> SavedRead<T> {
    fn ok(value: T) -> Self {
        Self {
            status: LoginStatus::Valid,
            value: Some(value),
            rate_limited: false,
        }
    }

    fn status(status: LoginStatus) -> Self {
        Self {
            status,
            value: None,
            rate_limited: false,
        }
    }
}

/// What `KeptLogin::secret` holds for Nintendo. Intentionally no Debug.
#[derive(Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Record {
    version: u8,
    /// Nintendo's session token (two years). It never changes on use.
    session_token: String,
    /// The Nintendo Account id, for the account key. Absent when Nintendo's
    /// tokens named none.
    #[serde(default)]
    account_id: Option<String>,
}

impl Record {
    fn decode(secret: &str) -> Option<Self> {
        let record: Record = serde_json::from_str(secret).ok()?;
        (record.version == 1
            && valid_secret(&record.session_token)
            && record.account_id.as_deref().is_none_or(valid_account_id))
        .then_some(record)
    }
}

/// PKCE for one sign-in: the verifier stays here, Nintendo gets its hash.
struct Pkce {
    verifier: String,
    challenge: String,
    state: String,
}

impl Pkce {
    fn new() -> Option<Self> {
        let verifier = random_text(32)?;
        let challenge = URL_SAFE_NO_PAD.encode(ring::digest::digest(
            &ring::digest::SHA256,
            verifier.as_bytes(),
        ));
        Some(Self {
            verifier,
            challenge,
            state: random_text(36)?,
        })
    }
}

fn random_text(bytes: usize) -> Option<String> {
    let mut buffer = vec![0u8; bytes];
    ring::rand::SecureRandom::fill(&ring::rand::SystemRandom::new(), &mut buffer).ok()?;
    Some(URL_SAFE_NO_PAD.encode(buffer))
}

/// Why Nintendo gave no token.
#[derive(Debug, PartialEq)]
enum TokenFailure {
    /// Nintendo confirmed that this sign-in expired or was ended.
    Refused,
    /// Nintendo did not answer properly. A kept sign-in stays.
    Unavailable,
}

#[derive(Debug, PartialEq)]
enum AccessFailure {
    SignedOut,
    NeedsSignIn,
    Unavailable,
}

impl AccessFailure {
    fn status(&self) -> LoginStatus {
        match self {
            AccessFailure::SignedOut => LoginStatus::SignedOut,
            AccessFailure::NeedsSignIn => LoginStatus::NeedsSignIn,
            AccessFailure::Unavailable => LoginStatus::Unavailable,
        }
    }
}

#[derive(Debug, Deserialize)]
struct SessionTokenAnswer {
    #[serde(default)]
    session_token: String,
}

#[derive(Debug, Deserialize)]
struct TokenAnswer {
    #[serde(default)]
    access_token: String,
    #[serde(default)]
    expires_in: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct UserAnswer {
    #[serde(default)]
    nickname: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HistoryAnswer {
    #[serde(default)]
    play_histories: Vec<HistoryRow>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HistoryRow {
    #[serde(default)]
    title_id: String,
    #[serde(default)]
    title_name: Option<String>,
    #[serde(default)]
    last_played_at: Option<String>,
    #[serde(default)]
    total_played_minutes: Option<Value>,
}

/// JWT-safe token text.
fn valid_secret(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 8192
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~'))
}

fn valid_account_id(value: &str) -> bool {
    (1..=64).contains(&value.len()) && value.bytes().all(|byte| byte.is_ascii_alphanumeric())
}

/// Nintendo title ids: 16 hex characters ("0100000000010000"), kept
/// lowercase as Nintendo sends most of them.
pub(super) fn title_id_of(value: &str) -> Option<String> {
    (value.len() == 16 && value.bytes().all(|byte| byte.is_ascii_hexdigit()))
        .then(|| value.to_ascii_lowercase())
}

/// A short ISO time from Nintendo, passed on as text.
fn valid_timestamp(value: &str) -> bool {
    (10..=40).contains(&value.len())
        && value.as_bytes()[..4].iter().all(u8::is_ascii_digit)
        && value.bytes().all(|byte| {
            byte.is_ascii_digit() || matches!(byte, b'-' | b':' | b'.' | b'T' | b'Z' | b'+')
        })
}

fn clean_title(value: &str) -> String {
    value
        .chars()
        .filter(|character| !character.is_control())
        .collect::<String>()
        .trim()
        .chars()
        .take(200)
        .collect()
}

/// The account id inside one of Nintendo's tokens (its `sub`). Read only to
/// make the account key; the token itself is checked by Nintendo.
fn account_id_of(token: &str) -> Option<String> {
    let payload = token.split('.').nth(1)?;
    let bytes = URL_SAFE_NO_PAD.decode(payload.trim_end_matches('=')).ok()?;
    let claims: Value = serde_json::from_slice(&bytes).ok()?;
    claims["sub"]
        .as_str()
        .map(str::to_owned)
        .filter(|id| valid_account_id(id))
}

/// Every row with a title id becomes one game; rows of one title id add up.
fn build_library(rows: Vec<HistoryRow>) -> Vec<AccountGame> {
    let mut games: BTreeMap<String, AccountGame> = BTreeMap::new();
    for row in rows {
        let Some(title_id) = title_id_of(&row.title_id) else {
            continue;
        };
        let title = row
            .title_name
            .as_deref()
            .map(clean_title)
            .unwrap_or_default();
        let seconds = row
            .total_played_minutes
            .as_ref()
            .and_then(Value::as_u64)
            .map(|minutes| minutes.saturating_mul(60));
        let last_played_at = row.last_played_at.filter(|value| valid_timestamp(value));
        if let Some(game) = games.get_mut(&title_id) {
            game.playtime_seconds = match (game.playtime_seconds, seconds) {
                (Some(total), Some(more)) => Some(total.saturating_add(more)),
                (total, more) => total.or(more),
            };
            // Same-form ISO times sort as text.
            if last_played_at > game.last_played_at {
                game.last_played_at = last_played_at;
            }
            if game.title.is_empty() {
                game.title = title;
            }
            continue;
        }
        if games.len() >= MAX_GAMES {
            continue;
        }
        games.insert(
            title_id.clone(),
            AccountGame {
                title_id,
                title,
                playtime_seconds: seconds,
                last_played_at,
            },
        );
    }
    games.into_values().collect()
}

/// Only Nintendo's explicit refusal ends a kept sign-in. Outages, proxies and
/// changed endpoints must not sign the player out.
fn token_failure(status: u16, body: &str) -> TokenFailure {
    let error = serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|value| value["error"].as_str().map(str::to_owned));
    if matches!(status, 400 | 401)
        && matches!(
            error.as_deref(),
            Some("invalid_grant" | "invalid_token" | "invalid_request")
        )
    {
        TokenFailure::Refused
    } else {
        TokenFailure::Unavailable
    }
}

pub(super) fn secure_https(url: &tauri::Url) -> bool {
    url.scheme() == "https"
        && url.port_or_known_default() == Some(443)
        && url.username().is_empty()
        && url.password().is_none()
}

/// Nintendo's sign-in pages. Exact hosts only.
fn login_navigation(url: &tauri::Url) -> bool {
    secure_https(url) && url.host_str() == Some("accounts.nintendo.com")
}

/// The Nintendo Store app's "done" address,
/// `npf5c38e31cd085304b://auth#session_token_code=…&state=…`: the code and
/// the state it came back with. `None`: another address.
fn done_link(url: &tauri::Url) -> Option<Result<(String, String), ()>> {
    if url.scheme() != REDIRECT_SCHEME
        || url.host_str() != Some("auth")
        || !matches!(url.path(), "" | "/")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
    {
        return None;
    }
    // The code comes after `#`, as form pairs.
    let pairs = tauri::Url::parse(&format!(
        "https://localhost/?{}",
        url.fragment().unwrap_or_default()
    ))
    .ok()?;
    let value = |name: &str| {
        pairs
            .query_pairs()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value.into_owned())
            .filter(|value| value.len() <= 4096 && valid_secret(value))
    };
    Some(value("session_token_code").zip(value("state")).ok_or(()))
}

/// "Sign in with a link": the done address somewhere in what was pasted.
fn pasted_link(text: &str) -> Option<Result<(String, String), ()>> {
    let start = text.find(REDIRECT_URI)?;
    let link = text[start..]
        .split(|character: char| character.is_whitespace() || matches!(character, '"' | '\''))
        .next()?;
    done_link(&tauri::Url::parse(link).ok()?)
}

fn authorize_url(pkce: &Pkce) -> tauri::Url {
    let mut url = tauri::Url::parse(AUTHORIZE_URL).expect("fixed Nintendo URL");
    url.query_pairs_mut()
        .append_pair("client_id", CLIENT_ID)
        .append_pair("redirect_uri", REDIRECT_URI)
        .append_pair("response_type", "session_token_code")
        .append_pair("scope", SCOPE)
        .append_pair("session_token_code_challenge", &pkce.challenge)
        .append_pair("session_token_code_challenge_method", "S256")
        .append_pair("state", &pkce.state)
        .append_pair("theme", "login_form");
    url
}

/// Debug builds only: how a Nintendo service answered. Never a token, id or
/// name.
fn debug_answer(step: &str, detail: impl std::fmt::Display) {
    #[cfg(debug_assertions)]
    eprintln!("[nintendo] {step}: {detail}");
    #[cfg(not(debug_assertions))]
    let _ = (step, detail.to_string());
}

fn http_client() -> Result<reqwest::Client, String> {
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
    reqwest::Client::builder()
        .user_agent(APP_USER_AGENT)
        .timeout(Duration::from_secs(30))
        // A token never follows a redirect.
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "Could not connect to Nintendo.".into())
}

fn encode_pairs(pairs: &[(&str, &str)]) -> String {
    let mut url = tauri::Url::parse("https://localhost/").expect("fixed URL");
    url.query_pairs_mut().extend_pairs(pairs);
    url.query().unwrap_or_default().to_string()
}

/// The one-time code from the sign-in becomes Nintendo's session token.
async fn session_token_from_code(
    client: &reqwest::Client,
    code: &str,
    verifier: &str,
) -> Result<String, TokenFailure> {
    let response = client
        .post(SESSION_TOKEN_URL)
        .header("accept", "application/json")
        .header("content-type", "application/x-www-form-urlencoded")
        .body(encode_pairs(&[
            ("client_id", CLIENT_ID),
            ("session_token_code", code),
            ("session_token_code_verifier", verifier),
        ]))
        .send()
        .await
        .map_err(|_| TokenFailure::Unavailable)?;
    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    if !status.is_success() {
        debug_answer("session token", status);
        return Err(token_failure(status.as_u16(), &body));
    }
    let answer: SessionTokenAnswer =
        serde_json::from_str(&body).map_err(|_| TokenFailure::Unavailable)?;
    if !valid_secret(&answer.session_token) {
        debug_answer("session token", "answer without a token");
        return Err(TokenFailure::Unavailable);
    }
    Ok(answer.session_token)
}

/// A 15-minute access token from the session token.
async fn access_token(
    client: &reqwest::Client,
    session_token: &str,
) -> Result<TokenAnswer, TokenFailure> {
    let response = client
        .post(TOKEN_URL)
        .header("accept", "application/json")
        .json(&serde_json::json!({
            "client_id": CLIENT_ID,
            "session_token": session_token,
            "grant_type": TOKEN_GRANT,
        }))
        .send()
        .await
        .map_err(|_| TokenFailure::Unavailable)?;
    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    if !status.is_success() {
        debug_answer("token", status);
        return Err(token_failure(status.as_u16(), &body));
    }
    let token: TokenAnswer = serde_json::from_str(&body).map_err(|_| TokenFailure::Unavailable)?;
    if !valid_secret(&token.access_token) {
        debug_answer("token", "answer without a token");
        return Err(TokenFailure::Unavailable);
    }
    Ok(token)
}

/// The nickname for "Signed in as". Never the e-mail or the account id.
async fn read_nickname(client: &reqwest::Client, access_token: &str) -> Option<String> {
    let response = client
        .get(USER_URL)
        .bearer_auth(access_token)
        .header("accept", "application/json")
        .send()
        .await
        .ok()?;
    if !response.status().is_success() {
        debug_answer("user", response.status());
        return None;
    }
    let answer: UserAnswer = response.json().await.ok()?;
    answer
        .nickname
        .map(|name| clean_title(&name))
        .filter(|name| !name.is_empty())
}

async fn read_history(
    client: &reqwest::Client,
    access_token: &str,
) -> Result<Vec<AccountGame>, u16> {
    let response = client
        .get(HISTORY_URL)
        .bearer_auth(access_token)
        .header("accept", "application/json")
        .header("gentry-locale", LOCALE)
        .send()
        .await
        .map_err(|_| 0u16)?;
    let status = response.status();
    if !status.is_success() {
        debug_answer("history", status);
        return Err(status.as_u16());
    }
    let answer: HistoryAnswer = response.json().await.map_err(|_| 0u16)?;
    let games = build_library(answer.play_histories);
    debug_answer("history", format!("{} titles", games.len()));
    Ok(games)
}

/// Save before returning success or reading any games.
fn keep(
    store: &Store,
    session_token: String,
    account_id: Option<String>,
    name: Option<String>,
) -> Result<(), String> {
    let record = Record {
        version: 1,
        session_token,
        account_id,
    };
    let secret = serde_json::to_string(&record).map_err(|_| NOT_SAVED)?;
    store
        .save(Service::Nintendo, &KeptLogin::new(secret, name))
        .map_err(|_| NOT_SAVED)?;
    Ok(())
}

/// An access token from the kept sign-in. Never a window.
async fn kept_access(
    store: &Store,
    client: &reqwest::Client,
    state: &NintendoAccountState,
    force: bool,
) -> Result<(String, Option<String>), AccessFailure> {
    let previous = match store.try_load(Service::Nintendo) {
        Ok(Some(previous)) => previous,
        Ok(None) => {
            forget_access(state);
            return Err(AccessFailure::SignedOut);
        }
        Err(_) => return Err(AccessFailure::Unavailable),
    };
    if !force {
        if let Ok(access) = state.access.lock() {
            if let Some(cached) = access.as_ref() {
                if cached.saved_at == previous.saved_at && Instant::now() < cached.until {
                    return Ok((cached.token.clone(), cached.account_id.clone()));
                }
            }
        }
    }
    let Some(record) = Record::decode(&previous.secret) else {
        // An unreadable record is a sign-in to make again, never a crash.
        return Err(AccessFailure::NeedsSignIn);
    };
    let token = match access_token(client, &record.session_token).await {
        Ok(token) => token,
        Err(TokenFailure::Refused) => return Err(AccessFailure::NeedsSignIn),
        Err(TokenFailure::Unavailable) => return Err(AccessFailure::Unavailable),
    };
    if !store.is_current(Service::Nintendo) {
        return Err(AccessFailure::SignedOut);
    }
    let lifetime = token.expires_in.unwrap_or(900).clamp(60, 24 * 3_600);
    if let Ok(mut access) = state.access.lock() {
        *access = Some(CachedAccess {
            saved_at: previous.saved_at,
            token: token.access_token.clone(),
            account_id: record.account_id.clone(),
            // A minute early, so a request never carries an expiring token.
            until: Instant::now() + Duration::from_secs(lifetime.saturating_sub(60)),
        });
    }
    Ok((token.access_token, record.account_id))
}

/// A first sign-in: the session token from the window or the pasted link.
async fn finish_sign_in(
    store: &Store,
    client: &reqwest::Client,
    state: &NintendoAccountState,
    session_token: Result<String, TokenFailure>,
) -> Result<(String, Option<String>), String> {
    let session_token = match session_token {
        Ok(token) => token,
        Err(TokenFailure::Refused) => return Err(REFUSED.into()),
        Err(TokenFailure::Unavailable) => return Err(UNAVAILABLE.into()),
    };
    let token = match access_token(client, &session_token).await {
        Ok(token) => token,
        Err(TokenFailure::Refused) => return Err(REFUSED.into()),
        Err(TokenFailure::Unavailable) => return Err(UNAVAILABLE.into()),
    };
    let account_id = account_id_of(&token.access_token).or_else(|| account_id_of(&session_token));
    let name = read_nickname(client, &token.access_token).await;
    keep(store, session_token, account_id.clone(), name)?;
    forget_access(state);
    Ok((token.access_token, account_id))
}

/// A read with the kept sign-in. A refused token renews once, then the
/// sign-in is reported as needed; 429 asks the caller to wait.
async fn saved_read<T, F, Fut>(app: &AppHandle, read: F) -> SavedRead<T>
where
    F: Fn(reqwest::Client, String, Option<String>) -> Fut,
    Fut: std::future::Future<Output = Result<T, u16>>,
{
    if !cfg!(windows) {
        return SavedRead::status(LoginStatus::SignedOut);
    }
    let Some(state) = app.try_state::<NintendoAccountState>() else {
        return SavedRead::status(LoginStatus::Unavailable);
    };
    if state
        .sessions
        .lock()
        .map(|sessions| sessions.is_active())
        .unwrap_or(true)
    {
        return SavedRead::status(LoginStatus::Busy);
    }
    let (Ok(store), Ok(client)) = (Store::of(app), http_client()) else {
        return SavedRead::status(LoginStatus::Unavailable);
    };
    for force in [false, true] {
        let (token, account_id) = match kept_access(&store, &client, &state, force).await {
            Ok(access) => access,
            Err(failure) => return SavedRead::status(failure.status()),
        };
        match read(client.clone(), token, account_id).await {
            Ok(value) => return SavedRead::ok(value),
            Err(401) if !force => {
                forget_access(&state);
                continue;
            }
            Err(429) => {
                return SavedRead {
                    rate_limited: true,
                    ..SavedRead::status(LoginStatus::Unavailable)
                }
            }
            Err(_) => return SavedRead::status(LoginStatus::Unavailable),
        }
    }
    SavedRead::status(LoginStatus::Unavailable)
}

/// Check only the saved sign-in. No window, game list or account details.
pub(super) async fn check_saved_login(app: &AppHandle) -> LoginStatus {
    if !cfg!(windows) {
        return LoginStatus::SignedOut;
    }
    let Some(state) = app.try_state::<NintendoAccountState>() else {
        return LoginStatus::Unavailable;
    };
    if state
        .sessions
        .lock()
        .map(|sessions| sessions.is_active())
        .unwrap_or(true)
    {
        return LoginStatus::Busy;
    }
    let (Ok(store), Ok(client)) = (Store::of(app), http_client()) else {
        return LoginStatus::Unavailable;
    };
    match kept_access(&store, &client, &state, false).await {
        Ok(_) => LoginStatus::Valid,
        Err(failure) => failure.status(),
    }
}

/// The account's play history with the kept sign-in. Background only.
#[tauri::command]
pub async fn library_nintendo_saved_games(
    app: AppHandle,
    window: WebviewWindow,
) -> Result<SavedRead<AccountLibrary>, String> {
    if window.label() != "main" {
        return Err("Nintendo games are read from PlayCounter.".into());
    }
    Ok(saved_read(&app, |client, token, account_id| async move {
        tokio::time::timeout(Duration::from_secs(120), read_history(&client, &token))
            .await
            .unwrap_or(Err(0))
            .map(|games| of_account(games, account_id.as_deref()))
    })
    .await)
}

#[tauri::command]
pub async fn library_nintendo_account_games(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, NintendoAccountState>,
    request_id: String,
    // "Nintendo sign-in" in the main window's language, for the title.
    title: String,
) -> Result<AccountLibrary, String> {
    run_account_session(app, window, state, request_id, title, true)
        .await?
        .ok_or_else(|| UNAVAILABLE.into())
}

/// Account management connects at once, without reading the games.
#[tauri::command]
pub async fn library_nintendo_sign_in(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, NintendoAccountState>,
    request_id: String,
    title: String,
) -> Result<(), String> {
    run_account_session(app, window, state, request_id, title, false)
        .await
        .map(|_| ())
}

/// "Sign in with a link", step one: Nintendo's sign-in in the browser. The
/// address is made here, so the page can only ever be Nintendo's.
#[tauri::command]
pub fn library_nintendo_open_sign_in_link(
    window: WebviewWindow,
    state: State<'_, NintendoAccountState>,
) -> Result<(), String> {
    if window.label() != "main" || !cfg!(windows) {
        return Err("Nintendo sign-in is available in the Windows desktop app.".into());
    }
    let pkce = Pkce::new().ok_or("Could not start Nintendo sign-in.")?;
    let url = authorize_url(&pkce);
    *state
        .link
        .lock()
        .map_err(|_| "Could not start Nintendo sign-in.")? = Some(PendingLink {
        pkce,
        until: Instant::now() + LINK_VALID_FOR,
    });
    crate::shell_open::open_url(url.as_str()).map_err(|_| NOT_OPENED.to_string())
}

/// "Sign in with a link", step two: the link copied from Nintendo's page.
/// Only a link of the sign-in opened in step one is taken.
#[tauri::command]
pub async fn library_nintendo_sign_in_with_link(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, NintendoAccountState>,
    link: String,
) -> Result<(), String> {
    if window.label() != "main" || !cfg!(windows) {
        return Err("Nintendo sign-in is available in the Windows desktop app.".into());
    }
    let Some(Ok((code, link_state))) = pasted_link(&link) else {
        return Err(
            "That is not a Nintendo sign-in link. Right-click Select this person, copy the link and try again."
                .into(),
        );
    };
    let verifier = {
        let mut pending = state
            .link
            .lock()
            .map_err(|_| "Could not start Nintendo sign-in.")?;
        match pending.as_ref() {
            Some(open) if open.pkce.state == link_state && Instant::now() < open.until => {
                pending.take().map(|open| open.pkce.verifier)
            }
            _ => None,
        }
    }
    .ok_or(
        "This link belongs to another sign-in. Open Nintendo's sign-in from PlayCounter again and copy the new link.",
    )?;
    let store = Store::of(&app)?;
    let client = http_client()?;
    let session_token = match session_token_from_code(&client, &code, &verifier).await {
        Err(TokenFailure::Refused) => {
            return Err(
                "Nintendo did not accept this link. Open Nintendo's sign-in from PlayCounter again and copy a new link."
                    .into(),
            )
        }
        other => other,
    };
    finish_sign_in(&store, &client, &state, session_token)
        .await
        .map(|_| ())
}

async fn finish_account(
    client: &reqwest::Client,
    access_token: &str,
    account_id: Option<&str>,
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
            match tokio::time::timeout(Duration::from_secs(120), read_history(client, access_token)).await {
                Ok(Ok(games)) => Ok(Some(of_account(games, account_id))),
                Ok(Err(429)) => Err("Nintendo is busy. Please try again in a few minutes.".to_string()),
                Ok(Err(_)) => Err(UNAVAILABLE.to_string()),
                Err(_) => Err("Nintendo took too long to answer. Please try again.".to_string()),
            }
        } => result,
    }
}

async fn run_account_session(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, NintendoAccountState>,
    request_id: String,
    title: String,
    read_games: bool,
) -> Result<Option<AccountLibrary>, String> {
    if window.label() != "main" || !cfg!(windows) {
        return Err("Nintendo sign-in is available in the Windows desktop app.".into());
    }
    let id = uuid::Uuid::parse_str(&request_id)
        .map_err(|_| "Invalid Nintendo sign-in request.")?
        .to_string();
    let mut cancelled = state
        .sessions
        .lock()
        .map_err(|_| "Could not start Nintendo sign-in.")?
        .start(&id)
        .map_err(|error| {
            if error == SESSION_CANCELLED {
                CANCELLED.to_string()
            } else {
                "A Nintendo sign-in is already open. Finish or cancel it first.".to_string()
            }
        })?;
    let finish = |state: &NintendoAccountState| {
        if let Ok(mut sessions) = state.sessions.lock() {
            sessions.finish(&id);
        }
    };
    let (store, client) = match Store::of(&app).and_then(|store| Ok((store, http_client()?))) {
        Ok(ready) => ready,
        Err(error) => {
            finish(&state);
            return Err(error);
        }
    };
    match kept_access(&store, &client, &state, false).await {
        Ok((token, account_id)) => {
            let result = finish_account(
                &client,
                &token,
                account_id.as_deref(),
                &mut cancelled,
                false,
                read_games,
            )
            .await;
            finish(&state);
            return result;
        }
        Err(AccessFailure::Unavailable) => {
            finish(&state);
            return Err(UNAVAILABLE.into());
        }
        // A refused sign-in is made again in the window.
        Err(AccessFailure::NeedsSignIn | AccessFailure::SignedOut) => {}
    }
    if !matches!(
        cancelled.try_recv(),
        Err(oneshot::error::TryRecvError::Empty)
    ) {
        finish(&state);
        return Err(CANCELLED.into());
    }
    let Some(pkce) = Pkce::new() else {
        finish(&state);
        return Err("Could not start Nintendo sign-in.".into());
    };
    let (navigation_rejected, rejected_navigation) = oneshot::channel();
    let navigation_rejected = Mutex::new(Some(navigation_rejected));
    let (code_sent, mut code_received) = oneshot::channel::<Result<(String, String), ()>>();
    let code_sent = Mutex::new(Some(code_sent));
    let sign_in = tauri::WebviewWindowBuilder::new(
        &app,
        format!("nintendo-sign-in-{id}"),
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
        if let Some(code) = done_link(url) {
            if let Some(sender) = code_sent.lock().ok().and_then(|mut value| value.take()) {
                let _ = sender.send(code);
            }
            // The Nintendo Store app's address never opens anything.
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
        Err(_) => Err(NOT_OPENED.into()),
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
                    if let Ok(mut sessions) =
                        close_app.state::<NintendoAccountState>().sessions.lock()
                    {
                        sessions.cancel(&close_id);
                    }
                }
            });
            let setup = secure_window(&sign_in, ExpectedProfile::Private, true).await;
            let session_ready = setup.is_ok();
            let code: Result<(String, String), String> = tokio::select! {
                biased;
                _ = &mut cancelled => {
                    was_cancelled = true;
                    Err(CANCELLED.into())
                },
                _ = rejected_navigation => Err("Nintendo tried to open an unsupported sign-in page. Use Sign in with a link instead.".into()),
                result = tokio::time::timeout(LINK_VALID_FOR, async {
                    setup?;
                    sign_in.navigate(authorize_url(&pkce)).map_err(|_| NOT_OPENED)?;
                    sign_in.show().map_err(|_| NOT_OPENED)?;
                    let _ = sign_in.set_focus();
                    match (&mut code_received).await {
                        Ok(Ok(code)) => Ok(code),
                        Ok(Err(())) => Err("Nintendo returned an invalid sign-in link. Please sign in again.".to_string()),
                        Err(_) => Err(CANCELLED.to_string()),
                    }
                }) => {
                    result.unwrap_or_else(|_| Err("Nintendo sign-in timed out. Please try again.".into()))
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
                Ok((code, returned_state)) if returned_state == pkce.state => {
                    if store.is_current(Service::Nintendo) {
                        let session_token =
                            session_token_from_code(&client, &code, &pkce.verifier).await;
                        finish_sign_in(&store, &client, &state, session_token).await
                    } else {
                        Err(CANCELLED.into())
                    }
                }
                Ok(_) => {
                    Err("Nintendo returned an invalid sign-in link. Please sign in again.".into())
                }
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
                    "Could not clear the Nintendo sign-in session. Close PlayCounter before signing in again."
                        .into(),
                );
            }
            authentication
        }
    };
    let result = match authentication {
        Err(error) => Err(error),
        Ok((token, account_id)) => {
            finish_account(
                &client,
                &token,
                account_id.as_deref(),
                &mut cancelled,
                was_cancelled,
                read_games,
            )
            .await
        }
    };
    finish(&state);
    result
}

#[tauri::command]
pub fn library_cancel_nintendo_account(
    window: WebviewWindow,
    state: State<'_, NintendoAccountState>,
    request_id: String,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Nintendo sign-in must be cancelled from PlayCounter.".into());
    }
    let id = uuid::Uuid::parse_str(&request_id)
        .map_err(|_| "Invalid Nintendo sign-in request.")?
        .to_string();
    state
        .sessions
        .lock()
        .map_err(|_| "Could not cancel Nintendo sign-in.")?
        .cancel(&id);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(value: &str) -> tauri::Url {
        value.parse().unwrap()
    }

    // Nintendo's answer for Phil's account on 2026-11-14 (read-only probe).
    const HISTORY: &str = r#"{
      "playHistories": [
        {
          "titleId": "010040600c5ce000",
          "titleName": "TETRIS 99",
          "platform": "HAC",
          "imageUrl": "https://atum-img-lp1.cdn.nintendo.net/i/c/cde92b3b1abd4477b3f5c6638060ee1c_512",
          "lastUpdatedAt": "2020-01-12T00:00:00Z",
          "firstPlayedAt": "2019-10-18T01:04:08Z",
          "lastPlayedAt": "2019-12-03T22:20:33Z",
          "totalPlayedDays": 2,
          "totalPlayedMinutes": 16
        },
        {
          "titleId": "0100000000010000",
          "titleName": "SUPER MARIO ODYSSEY",
          "platform": "HAC",
          "imageUrl": "https://atum-img-lp1.cdn.nintendo.net/i/c/18cb70d5f222477dad42381284178786_512",
          "lastUpdatedAt": "2018-11-25T00:00:00Z",
          "firstPlayedAt": "2017-11-11T13:16:31Z",
          "lastPlayedAt": "2018-11-24T03:13:27Z",
          "totalPlayedDays": 8,
          "totalPlayedMinutes": 397
        }
      ],
      "hiddenTitleList": [],
      "recentPlayHistories": [
        {
          "playedDate": "2019-12-03T00:00:00Z",
          "dailyPlayHistories": [
            {
              "titleId": "010040600c5ce000",
              "titleName": "TETRIS 99",
              "platform": "HAC",
              "imageUrl": "https://atum-img-lp1.cdn.nintendo.net/i/c/cde92b3b1abd4477b3f5c6638060ee1c_512",
              "totalPlayedMinutes": 7
            }
          ]
        }
      ]
    }"#;

    fn rows(json: &str) -> Vec<HistoryRow> {
        serde_json::from_str::<HistoryAnswer>(json)
            .unwrap()
            .play_histories
    }

    fn game(title_id: &str, title: &str, seconds: Option<u64>, last: Option<&str>) -> AccountGame {
        AccountGame {
            title_id: title_id.into(),
            title: title.into(),
            playtime_seconds: seconds,
            last_played_at: last.map(str::to_owned),
        }
    }

    #[test]
    fn every_play_history_row_becomes_a_game_with_its_minutes_as_seconds() {
        assert_eq!(
            build_library(rows(HISTORY)),
            vec![
                game(
                    "0100000000010000",
                    "SUPER MARIO ODYSSEY",
                    Some(397 * 60),
                    Some("2018-11-24T03:13:27Z")
                ),
                game(
                    "010040600c5ce000",
                    "TETRIS 99",
                    Some(16 * 60),
                    Some("2019-12-03T22:20:33Z")
                ),
            ]
        );
    }

    #[test]
    fn two_rows_of_one_title_id_add_up_into_one_game() {
        // A game played on a Switch and on a Switch 2 is two rows.
        let library = build_library(rows(
            r#"{"playHistories": [
              {"titleId": "0100000000010000", "titleName": "SUPER MARIO ODYSSEY", "platform": "HAC",
               "lastPlayedAt": "2018-11-24T03:13:27Z", "totalPlayedMinutes": 397},
              {"titleId": "0100000000010000", "titleName": "SUPER MARIO ODYSSEY", "platform": "BEE",
               "lastPlayedAt": "2026-06-10T19:00:00Z", "totalPlayedMinutes": 60}
            ]}"#,
        ));
        assert_eq!(
            library,
            vec![game(
                "0100000000010000",
                "SUPER MARIO ODYSSEY",
                Some(457 * 60),
                Some("2026-06-10T19:00:00Z")
            )]
        );
    }

    #[test]
    fn rows_without_a_title_id_or_a_readable_total_are_kept_apart_or_left_out() {
        let library = build_library(rows(
            r#"{"playHistories": [
              {"titleId": "", "titleName": "NO ID", "totalPlayedMinutes": 5},
              {"titleId": "0100000000010000x", "titleName": "TOO LONG", "totalPlayedMinutes": 5},
              {"titleId": "01000000000100G0", "titleName": "NOT HEX", "totalPlayedMinutes": 5},
              {"titleId": "0100ABCD00010000", "titleName": "  Upper\u0007 Case  ",
               "lastPlayedAt": "yesterday", "totalPlayedMinutes": "a lot"}
            ]}"#,
        ));
        assert_eq!(
            library,
            vec![game("0100abcd00010000", "Upper Case", None, None)]
        );
    }

    #[test]
    fn the_done_link_gives_the_code_and_the_state_it_came_back_with() {
        // The link as copied from "Select this person" (2026-11-14), shortened.
        assert_eq!(
            done_link(&url(
                "npf5c38e31cd085304b://auth#session_token_code=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.sig-_~&state=Ab3_-x&session_state=f00"
            )),
            Some(Ok((
                "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.sig-_~".into(),
                "Ab3_-x".into()
            )))
        );
        for value in [
            "npf5c38e31cd085304b://auth#state=Ab3",
            "npf5c38e31cd085304b://auth#session_token_code=&state=Ab3",
            "npf5c38e31cd085304b://auth#session_token_code=abc",
            "npf5c38e31cd085304b://auth#session_token_code=a%20b&state=Ab3",
            "npf5c38e31cd085304b://auth#error=access_denied&state=Ab3",
            "npf5c38e31cd085304b://auth",
        ] {
            assert_eq!(done_link(&url(value)), Some(Err(())), "{value}");
        }
        for value in [
            "npf5c38e31cd085304b://evil#session_token_code=abc&state=x",
            "npf5c38e31cd085304b://auth.evil#session_token_code=abc&state=x",
            "npf5c38e31cd085304b://auth/other#session_token_code=abc&state=x",
            "npf5c38e31cd085304b://user@auth#session_token_code=abc&state=x",
            "npf71b963c1b7b6d119://auth#session_token_code=abc&state=x",
            "https://auth/#session_token_code=abc&state=x",
            "https://accounts.nintendo.com/#session_token_code=abc&state=x",
        ] {
            assert_eq!(done_link(&url(value)), None, "{value}");
        }
    }

    #[test]
    fn a_pasted_link_is_found_in_what_was_copied() {
        let code = Some(Ok(("abc.def".to_string(), "Xy_1".to_string())));
        assert_eq!(
            pasted_link("npf5c38e31cd085304b://auth#session_token_code=abc.def&state=Xy_1"),
            code
        );
        assert_eq!(
            pasted_link(
                "  \"npf5c38e31cd085304b://auth#session_token_code=abc.def&state=Xy_1&session_state=z\"\n"
            ),
            code
        );
        assert_eq!(
            pasted_link("https://accounts.nintendo.com/connect/1.0.0/authorize?state=Xy_1"),
            None
        );
        assert_eq!(pasted_link(""), None);
        assert_eq!(
            pasted_link("npf5c38e31cd085304b://auth#state=Xy_1"),
            Some(Err(()))
        );
    }

    #[test]
    fn only_nintendos_sign_in_pages_are_trusted() {
        for value in [
            "https://accounts.nintendo.com/connect/1.0.0/authorize?client_id=5c38e31cd085304b",
            "https://accounts.nintendo.com/login?post_login_redirect_uri=x",
        ] {
            assert!(login_navigation(&url(value)), "{value}");
        }
        for value in [
            "http://accounts.nintendo.com/login",
            "https://accounts.nintendo.com.evil.test/",
            "https://accounts.nintendo.com@evil.test/",
            "https://accounts.nintendo.com:444/",
            "https://www.nintendo.com/",
            "https://evil.test/?https://accounts.nintendo.com",
            "tauri://localhost/",
            "file:///C:/private.txt",
        ] {
            assert!(!login_navigation(&url(value)), "{value}");
        }
    }

    #[test]
    fn only_nintendos_refusal_ends_a_kept_sign_in() {
        // An ended or expired session token (nintendo-go, Ludex).
        assert_eq!(
            token_failure(
                400,
                r#"{"error":"invalid_grant","error_description":"The provided grant is invalid."}"#
            ),
            TokenFailure::Refused
        );
        assert_eq!(
            token_failure(400, r#"{"error":"invalid_request"}"#),
            TokenFailure::Refused
        );
        assert_eq!(
            token_failure(401, r#"{"error":"invalid_token"}"#),
            TokenFailure::Refused
        );
        for (status, body) in [
            (500, r#"{"error":"invalid_grant"}"#),
            (400, "<html>Bad Gateway</html>"),
            (400, r#"{"error":"temporarily_unavailable"}"#),
            (503, ""),
            (429, r#"{"error":"invalid_grant"}"#),
        ] {
            assert_eq!(
                token_failure(status, body),
                TokenFailure::Unavailable,
                "{status} {body}"
            );
        }
    }

    #[test]
    fn the_sign_in_address_carries_the_hash_of_the_verifier_and_the_state() {
        let pkce = Pkce::new().unwrap();
        let address = authorize_url(&pkce);
        let pairs: BTreeMap<String, String> = address.query_pairs().into_owned().collect();
        assert_eq!(address.host_str(), Some("accounts.nintendo.com"));
        assert_eq!(pairs["client_id"], CLIENT_ID);
        assert_eq!(pairs["redirect_uri"], REDIRECT_URI);
        assert_eq!(pairs["response_type"], "session_token_code");
        assert_eq!(pairs["scope"], SCOPE);
        assert_eq!(pairs["session_token_code_challenge_method"], "S256");
        assert_eq!(pairs["state"], pkce.state);
        assert_eq!(
            pairs["session_token_code_challenge"],
            URL_SAFE_NO_PAD.encode(ring::digest::digest(
                &ring::digest::SHA256,
                pkce.verifier.as_bytes()
            ))
        );
        assert!(!address.as_str().contains(&pkce.verifier));
        assert_ne!(Pkce::new().unwrap().state, pkce.state);
    }

    #[test]
    fn the_account_key_comes_from_the_tokens_account_id() {
        let claims = URL_SAFE_NO_PAD.encode(br#"{"sub":"a1b2c3d4e5f60718","typ":"token"}"#);
        assert_eq!(
            account_id_of(&format!("eyJhbGciOiJSUzI1NiJ9.{claims}.c2ln")),
            Some("a1b2c3d4e5f60718".into())
        );
        let odd = URL_SAFE_NO_PAD.encode(br#"{"sub":"a/b"}"#);
        assert_eq!(account_id_of(&format!("x.{odd}.y")), None);
        assert_eq!(account_id_of("not a token"), None);
        let library = of_account(Vec::new(), Some("a1b2c3d4e5f60718"));
        assert_eq!(
            library.account,
            Some(ScanAccount::new("nintendo", "a1b2c3d4e5f60718", None))
        );
        assert_eq!(of_account(Vec::new(), None).account, None);
    }

    #[test]
    fn a_kept_record_is_read_only_when_it_is_whole() {
        let record = Record {
            version: 1,
            session_token: "eyJ.abc.def".into(),
            account_id: Some("a1b2c3d4e5f60718".into()),
        };
        let secret = serde_json::to_string(&record).unwrap();
        assert!(Record::decode(&secret) == Some(record));
        for secret in [
            r#"{"version":2,"sessionToken":"eyJ.abc","accountId":null}"#,
            r#"{"version":1,"sessionToken":"","accountId":null}"#,
            r#"{"version":1,"sessionToken":"a b","accountId":null}"#,
            r#"{"version":1,"sessionToken":"eyJ.abc","accountId":"a/b"}"#,
            r#"{"version":1,"sessionToken":"eyJ.abc","extra":1}"#,
            "not json",
        ] {
            assert!(Record::decode(secret).is_none(), "{secret}");
        }
    }
}
