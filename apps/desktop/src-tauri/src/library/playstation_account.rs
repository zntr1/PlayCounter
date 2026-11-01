//! Optional PlayStation sign-in for the account's PS4 and PS5 games, the
//! playtime Sony recorded, and the game running on the console right now.
//! Sony has no public API for this. Like psn-api, PSNAWP and Home Assistant,
//! the import signs in as the PlayStation App and reads Sony's own services,
//! which can change without notice.
//!
//! The sign-in page runs in a hardened InPrivate webview. When the player is
//! done, Sony opens the PlayStation App's address with a one-time code; that
//! navigation is stopped and opens nothing. Sony's session cookie (`npsso`) is
//! then read from that window's own cookie store, natively. Sony's refresh
//! token ends a fixed ~10 days after it was made and renewing it doesn't
//! extend that (Home Assistant, Oct 2026), so the session cookie is kept too
//! and makes a new one 3 days before. Both are kept encrypted on this PC (see
//! `kept_logins`). Only concept ids, titles, playtime, the running game and
//! the online id for "Signed in as" reach the frontend.
use super::battlenet_account::{
    clear_profile_data, secure_window, ExpectedProfile, Sessions, CANCELLED as SESSION_CANCELLED,
};
use super::kept_logins::{KeptLogin, Service, Store};
use super::login_status::LoginStatus;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{webview::NewWindowResponse, AppHandle, Manager, State, WebviewUrl, WebviewWindow};
use tokio::sync::oneshot;

// The PlayStation App's public id, as in psn-api, PSNAWP and Home Assistant.
const CLIENT_ID: &str = "09515159-7237-4370-9b40-3806e67c0891";
const BASIC_AUTH: &str =
    "Basic MDk1MTUxNTktNzIzNy00MzcwLTliNDAtMzgwNmU2N2MwODkxOnVjUGprYTV0bnRCMktxc1A=";
const SCOPE: &str = "psn:mobile.v2.core psn:clientapp";
const REDIRECT_URI: &str = "com.scee.psxandroid.scecompcall://redirect";
const REDIRECT_SCHEME: &str = "com.scee.psxandroid.scecompcall";
const AUTH_USER_AGENT: &str = "com.sony.snei.np.android.sso.share.oauth.versa.USER_AGENT";
const AUTHORIZE_URL: &str = "https://ca.account.sony.com/api/authz/v3/oauth/authorize";
const TOKEN_URL: &str = "https://ca.account.sony.com/api/authz/v3/oauth/token";
/// The session cookie belongs to Sony's sign-in host.
const SESSION_COOKIE_URL: &str = "https://ca.account.sony.com/";
const ACCOUNT_URL: &str = "https://dms.api.playstation.com/api/v1/devices/accounts/me";
const PROFILE_URL: &str = "https://m.np.playstation.com/api/userProfile/v1/internal/users";
const PRESENCE_URL: &str = "https://m.np.playstation.com/api/userProfile/v2/internal/users";
const GAMES_URL: &str = "https://m.np.playstation.com/api/gamelist/v2/users/me/titles";
const CANCELLED: &str = "PlayStation sign-in was cancelled.";
const UNAVAILABLE: &str = "PlayStation could not provide your game list. Try again later.";
const REFUSED: &str = "PlayStation sign-in expired or could not be verified. Please sign in again.";
const PAGE_SIZE: u32 = 100;
const MAX_PAGES: u32 = 100;
const MAX_GAMES: usize = 5_000;
/// A new refresh token is made from the session cookie this long before the
/// old one ends (Home Assistant does the same).
const RENEW_BEFORE_SECS: u64 = 3 * 24 * 60 * 60;
// Refresh tokens change on every use. Background reads, imports and sign-ins
// must never redeem the same saved token at the same time.
static AUTHENTICATING: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

#[derive(Default)]
pub struct PlayStationAccountState {
    sessions: Mutex<Sessions>,
    /// The current access token (about an hour), in memory only.
    access: Mutex<Option<CachedAccess>>,
}

struct CachedAccess {
    saved_at: u64,
    token: String,
    account_id: String,
    until: Instant,
}

pub(super) fn cancel_active(app: &AppHandle) {
    if let Some(state) = app.try_state::<PlayStationAccountState>() {
        if let Ok(mut sessions) = state.sessions.lock() {
            sessions.cancel_active();
        }
        forget_access(&state);
    }
}

fn forget_access(state: &PlayStationAccountState) {
    if let Ok(mut access) = state.access.lock() {
        *access = None;
    }
}

/// One game: every copy (PS4 and PS5) of one PlayStation Store concept.
#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AccountGame {
    concept_id: String,
    title: String,
    /// The sum of its copies. `None` when Sony gave no readable playtime.
    playtime_seconds: Option<u64>,
    /// Sony's ISO time, e.g. "2026-10-30T21:25:28.987Z".
    last_played_at: Option<String>,
    /// "PS5" and/or "PS4".
    platforms: Vec<&'static str>,
    /// Sony's ids of its copies (PPSA01521_00), to recognise it running.
    title_ids: Vec<String>,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AccountLibrary {
    games: Vec<AccountGame>,
    incomplete: bool,
}

/// A background read with the kept sign-in only. Never opens a window.
#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SavedRead<T> {
    status: LoginStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    value: Option<T>,
    /// Sony answered 429: wait before asking again.
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

/// The PS4 or PS5 game running now, as Sony's presence names it.
#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LiveGame {
    title_id: String,
    name: String,
    platform: &'static str,
    icon_url: Option<String>,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Presence {
    online: bool,
    /// `None` when nothing runs, or only something PlayCounter ignores
    /// (an app, a PC game, the mobile app).
    game: Option<LiveGame>,
}

#[derive(Debug, Deserialize)]
struct TokenAnswer {
    access_token: String,
    #[serde(default)]
    expires_in: Option<u64>,
    #[serde(default)]
    refresh_token: Option<String>,
    #[serde(default)]
    refresh_token_expires_in: Option<u64>,
}

/// What `KeptLogin::secret` holds for PlayStation. Intentionally no Debug.
#[derive(Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Record {
    version: u8,
    /// Sony's session cookie (about two months). Absent when the window
    /// sign-in could not read it: the refresh token then works until it ends.
    #[serde(default)]
    npsso: Option<String>,
    refresh_token: String,
    /// Unix seconds.
    refresh_ends_at: u64,
    account_id: String,
}

impl Record {
    fn decode(secret: &str) -> Option<Self> {
        let record: Record = serde_json::from_str(secret).ok()?;
        (record.version == 1
            && valid_secret(&record.refresh_token)
            && record.npsso.as_deref().is_none_or(valid_npsso)
            && valid_account_id(&record.account_id))
        .then_some(record)
    }
}

/// Why Sony gave no token.
#[derive(Debug, PartialEq)]
enum TokenFailure {
    /// Sony confirmed that this sign-in expired or was revoked.
    Refused,
    /// Sony did not answer properly. A kept sign-in stays.
    Unavailable,
}

#[derive(Debug, PartialEq)]
enum Renewal {
    Refresh,
    FromSession,
    SignIn,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PlayedPage {
    #[serde(default)]
    titles: Vec<PlayedTitle>,
    #[serde(default)]
    next_offset: Option<u64>,
    #[serde(default)]
    total_item_count: Option<u64>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PlayedTitle {
    #[serde(default)]
    title_id: String,
    #[serde(default)]
    name: String,
    #[serde(default)]
    localized_name: Option<String>,
    #[serde(default)]
    category: String,
    #[serde(default)]
    concept: Option<Concept>,
    #[serde(default)]
    play_duration: Option<String>,
    #[serde(default)]
    last_played_date_time: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Concept {
    #[serde(default)]
    id: Value,
    #[serde(default)]
    title_ids: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PresenceAnswer {
    #[serde(default)]
    basic_presence: Option<BasicPresence>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BasicPresence {
    #[serde(default)]
    primary_platform_info: Option<PlatformInfo>,
    #[serde(default)]
    game_title_info_list: Vec<GameTitleInfo>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PlatformInfo {
    #[serde(default)]
    online_status: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GameTitleInfo {
    #[serde(default)]
    np_title_id: Option<String>,
    #[serde(default)]
    title_name: Option<String>,
    #[serde(default)]
    format: Option<String>,
    #[serde(default)]
    launch_platform: Option<String>,
    #[serde(default)]
    concept_icon_url: Option<String>,
    #[serde(default)]
    np_title_icon_url: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AccountAnswer {
    #[serde(default)]
    account_id: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProfileAnswer {
    #[serde(default)]
    online_id: Option<String>,
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs())
        .unwrap_or_default()
}

/// Cookie- and form-safe token text.
fn valid_secret(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 8192
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~'))
}

/// Sony's session cookie: 64 letters and digits today; a little room for more.
fn valid_npsso(value: &str) -> bool {
    (32..=512).contains(&value.len()) && value.bytes().all(|byte| byte.is_ascii_alphanumeric())
}

fn valid_account_id(value: &str) -> bool {
    (1..=32).contains(&value.len()) && value.bytes().all(|byte| byte.is_ascii_digit())
}

/// PlayStation Store concept ids, the server's external id.
pub(super) fn valid_concept_id(value: &str) -> bool {
    (1..=10).contains(&value.len())
        && !value.starts_with('0')
        && value.bytes().all(|byte| byte.is_ascii_digit())
}

/// One copy of a game: `PPSA01521_00` (PS5) or `CUSA00419_00` (PS4).
pub(super) fn valid_title_id(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 12
        && bytes[..4].iter().all(u8::is_ascii_uppercase)
        && bytes[4..9].iter().all(u8::is_ascii_digit)
        && bytes[9] == b'_'
        && bytes[10..].iter().all(u8::is_ascii_digit)
}

/// The pasted session cookie: the bare code or Sony's whole
/// `{"npsso":"…"}` answer. Anything else is refused.
fn clean_pasted_npsso(value: &str) -> Option<String> {
    let value = value.trim();
    let code = if value.starts_with('{') {
        let parsed: Value = serde_json::from_str(value).ok()?;
        parsed.get("npsso")?.as_str()?.trim().to_owned()
    } else {
        value.to_owned()
    };
    valid_npsso(&code).then_some(code)
}

fn id_text(value: &Value) -> Option<String> {
    match value {
        Value::String(text) => Some(text.trim().to_owned()),
        Value::Number(number) => Some(number.to_string()),
        _ => None,
    }
}

/// Sony's played time, e.g. `PT228H56M33S`. Hours can pass 24 (hours are the
/// biggest unit Sony sends); a day part is read too in case it comes. Missing
/// or odd text is unknown, never 0.
fn parse_play_duration(value: &str) -> Option<u64> {
    let rest = value.trim().strip_prefix('P')?;
    let (days, time) = match rest.split_once('T') {
        Some((days, time)) => (days, time),
        None => (rest, ""),
    };
    let mut seconds: u64 = 0;
    let mut any = false;
    if !days.is_empty() {
        let count: u64 = days.strip_suffix('D')?.parse().ok()?;
        seconds = seconds.checked_add(count.checked_mul(86_400)?)?;
        any = true;
    }
    let mut number = String::new();
    let mut seen = String::new();
    for character in time.chars() {
        if character.is_ascii_digit() || character == '.' {
            number.push(character);
            continue;
        }
        let unit = match character {
            'H' => 3_600,
            'M' => 60,
            'S' => 1,
            _ => return None,
        };
        // Each unit once, in order.
        if number.is_empty() || seen.contains(character) || !"HMS".contains(character) {
            return None;
        }
        if let Some(last) = seen.chars().last() {
            if "HMS".find(last)? >= "HMS".find(character)? {
                return None;
            }
        }
        seen.push(character);
        let amount = if character == 'S' {
            number
                .parse::<f64>()
                .ok()
                .filter(|value| value.is_finite() && *value >= 0.0)? as u64
        } else {
            number.parse::<u64>().ok()?
        };
        seconds = seconds.checked_add(amount.checked_mul(unit)?)?;
        number.clear();
        any = true;
    }
    (number.is_empty() && any).then_some(seconds)
}

/// A short ISO time from Sony, passed on as text.
fn valid_timestamp(value: &str) -> bool {
    (10..=40).contains(&value.len())
        && value.as_bytes()[..4].iter().all(u8::is_ascii_digit)
        && value.bytes().all(|byte| {
            byte.is_ascii_digit() || matches!(byte, b'-' | b':' | b'.' | b'T' | b'Z' | b'+')
        })
}

fn platform_of(category: &str) -> Option<&'static str> {
    match category {
        "ps5_native_game" => Some("PS5"),
        "ps4_game" => Some("PS4"),
        // PC copies are this PC's own and its launcher's; "unknown" until seen.
        _ => None,
    }
}

fn build_library(titles: &[PlayedTitle], truncated: bool) -> AccountLibrary {
    #[derive(Default)]
    struct Game {
        title: String,
        seconds: Option<u64>,
        last_played_at: Option<String>,
        platforms: BTreeSet<&'static str>,
        title_ids: BTreeSet<String>,
        order: usize,
    }
    let mut games: BTreeMap<String, Game> = BTreeMap::new();
    for (order, row) in titles.iter().enumerate() {
        let Some(platform) = platform_of(&row.category) else {
            continue;
        };
        let Some(concept) = row.concept.as_ref() else {
            continue;
        };
        let Some(concept_id) = id_text(&concept.id).filter(|id| valid_concept_id(id)) else {
            continue;
        };
        let name = [Some(row.name.as_str()), row.localized_name.as_deref()]
            .into_iter()
            .flatten()
            .map(str::trim)
            .find(|name| !name.is_empty())
            .map(|name| name.chars().take(256).collect::<String>());
        let game = games.entry(concept_id).or_insert_with(|| Game {
            order,
            ..Game::default()
        });
        // Sony lists the most recently played copy first.
        if game.title.is_empty() {
            if let Some(name) = name {
                game.title = name;
            }
        }
        if let Some(seconds) = row.play_duration.as_deref().and_then(parse_play_duration) {
            game.seconds = Some(game.seconds.unwrap_or(0).saturating_add(seconds));
        }
        if let Some(at) = row
            .last_played_date_time
            .as_deref()
            .map(str::trim)
            .filter(|at| valid_timestamp(at))
        {
            if game.last_played_at.as_deref().is_none_or(|last| at > last) {
                game.last_played_at = Some(at.to_owned());
            }
        }
        game.platforms.insert(platform);
        for id in std::iter::once(&row.title_id).chain(concept.title_ids.iter()) {
            if valid_title_id(id) && game.title_ids.len() < 32 {
                game.title_ids.insert(id.clone());
            }
        }
    }
    let mut ordered: Vec<(String, Game)> = games
        .into_iter()
        .filter(|(_, game)| !game.title.is_empty())
        .collect();
    let incomplete = truncated || ordered.len() > MAX_GAMES;
    ordered.sort_by_key(|(_, game)| game.order);
    AccountLibrary {
        games: ordered
            .into_iter()
            .take(MAX_GAMES)
            .map(|(concept_id, game)| AccountGame {
                concept_id,
                title: game.title,
                playtime_seconds: game.seconds,
                last_played_at: game.last_played_at,
                // PS5 first.
                platforms: game.platforms.into_iter().rev().collect(),
                title_ids: game.title_ids.into_iter().collect(),
            })
            .collect(),
        incomplete,
    }
}

/// Sony's own image hosts only: the UI loads this address.
fn image_url(value: Option<&str>) -> Option<String> {
    let url = tauri::Url::parse(value?.trim()).ok()?;
    let host = url.host_str()?.to_ascii_lowercase();
    (url.scheme() == "https"
        && url.username().is_empty()
        && url.password().is_none()
        && url.port().is_none()
        && (host.ends_with(".playstation.com") || host.ends_with(".playstation.net"))
        && url.as_str().len() <= 1024)
        .then(|| url.to_string())
}

fn live_platform(value: Option<&str>) -> Option<&'static str> {
    match value?.to_ascii_lowercase().as_str() {
        "ps5" => Some("PS5"),
        "ps4" => Some("PS4"),
        _ => None,
    }
}

fn build_presence(answer: PresenceAnswer) -> Presence {
    let presence = answer.basic_presence.unwrap_or_default();
    let online = presence
        .primary_platform_info
        .as_ref()
        .and_then(|info| info.online_status.as_deref())
        .is_some_and(|status| status.eq_ignore_ascii_case("online"));
    let game = presence
        .game_title_info_list
        .into_iter()
        .find_map(|game| {
            let platform = live_platform(game.launch_platform.as_deref())
                .or(live_platform(game.format.as_deref()))?;
            let title_id = game
                .np_title_id
                .as_deref()
                .map(str::trim)
                .filter(|id| valid_title_id(id))?;
            let name: String = game
                .title_name
                .as_deref()?
                .trim()
                .chars()
                .take(256)
                .collect();
            (!name.is_empty()).then(|| LiveGame {
                title_id: title_id.to_owned(),
                name,
                platform,
                icon_url: image_url(game.concept_icon_url.as_deref())
                    .or_else(|| image_url(game.np_title_icon_url.as_deref())),
            })
        })
        .filter(|_| online);
    Presence { online, game }
}

/// Only Sony's explicit refusal ends a kept sign-in. Outages, proxies and
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

/// Sony's answer to "make a code from this session cookie": a redirect to
/// the PlayStation App's address with `code=`, or one without it when the
/// cookie is no longer valid (`error=login_required`).
fn code_from_redirect(status: u16, location: Option<&str>) -> Result<String, TokenFailure> {
    if !(300..400).contains(&status) {
        return Err(TokenFailure::Unavailable);
    }
    let location = location.ok_or(TokenFailure::Unavailable)?;
    let url = tauri::Url::parse(location).map_err(|_| TokenFailure::Unavailable)?;
    if let Some(code) = done_code(&url) {
        return code.map_err(|_| TokenFailure::Unavailable);
    }
    // Sony sends the browser back to its sign-in page.
    if url.host_str() == Some("my.account.sony.com")
        || url
            .query_pairs()
            .any(|(key, value)| key == "error" && value == "login_required")
    {
        Err(TokenFailure::Refused)
    } else {
        Err(TokenFailure::Unavailable)
    }
}

fn renewal(record: &Record, now: u64) -> Renewal {
    if record.refresh_ends_at > now.saturating_add(RENEW_BEFORE_SECS) {
        Renewal::Refresh
    } else if record.npsso.is_some() {
        Renewal::FromSession
    } else if record.refresh_ends_at > now {
        // Without a session cookie, the refresh token works until it ends.
        Renewal::Refresh
    } else {
        Renewal::SignIn
    }
}

pub(super) fn secure_https(url: &tauri::Url) -> bool {
    url.scheme() == "https"
        && url.port_or_known_default() == Some(443)
        && url.username().is_empty()
        && url.password().is_none()
}

/// Sony's sign-in pages. Exact hosts only.
fn login_navigation(url: &tauri::Url) -> bool {
    const HOSTS: &[&str] = &[
        "ca.account.sony.com",
        "my.account.sony.com",
        "account.sony.com",
        "id.sonyentertainmentnetwork.com",
        "account.sonyentertainmentnetwork.com",
        "auth.api.sonyentertainmentnetwork.com",
    ];
    secure_https(url) && url.host_str().is_some_and(|host| HOSTS.contains(&host))
}

/// The PlayStation App's "done" address carries the one-time code. `None`:
/// another address.
fn done_code(url: &tauri::Url) -> Option<Result<String, ()>> {
    if url.scheme() != REDIRECT_SCHEME
        || url.host_str() != Some("redirect")
        || !matches!(url.path(), "" | "/")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
    {
        return None;
    }
    let code = url
        .query_pairs()
        .find(|(key, _)| key == "code")
        .map(|(_, value)| value.into_owned());
    Some(
        code.filter(|code| code.len() <= 4096 && valid_secret(code))
            .ok_or(()),
    )
}

fn authorize_pairs(cid: &str) -> [(&'static str, String); 18] {
    // Parameters as PSNAWP 3.0.3 sends them (copied by Home Assistant).
    [
        ("access_type", "offline".into()),
        ("cid", cid.into()),
        ("client_id", CLIENT_ID.into()),
        ("device_base_font_size", "10".into()),
        ("device_profile", "mobile".into()),
        ("elements_visibility", "no_aclink".into()),
        ("enable_scheme_error_code", "true".into()),
        ("no_captcha", "true".into()),
        ("PlatformPrivacyWs1", "minimal".into()),
        ("redirect_uri", REDIRECT_URI.into()),
        ("response_type", "code".into()),
        ("scope", SCOPE.into()),
        ("service_entity", "urn:service-entity:psn".into()),
        ("service_logo", "ps".into()),
        ("smcid", "psapp:signin".into()),
        ("support_scheme", "sneiprls".into()),
        ("turnOnTrustedBrowser", "true".into()),
        ("ui", "pr".into()),
    ]
}

/// The same address signs in (in the window) and makes a code from a session
/// cookie (without one Sony shows its sign-in page instead).
fn authorize_url(cid: &str) -> tauri::Url {
    let mut url = tauri::Url::parse(AUTHORIZE_URL).expect("fixed Sony URL");
    {
        let mut query = url.query_pairs_mut();
        for (key, value) in authorize_pairs(cid) {
            query.append_pair(key, &value);
        }
    }
    url
}

fn encode_pairs(pairs: &[(&str, &str)]) -> String {
    let mut url = tauri::Url::parse("https://localhost/").expect("fixed URL");
    url.query_pairs_mut().extend_pairs(pairs);
    url.query().unwrap_or_default().to_string()
}

/// Debug builds only: how a Sony service answered. Never a token, id or name.
fn debug_answer(step: &str, detail: impl std::fmt::Display) {
    #[cfg(debug_assertions)]
    eprintln!("[playstation] {step}: {detail}");
    #[cfg(not(debug_assertions))]
    let _ = (step, detail.to_string());
}

fn http_client() -> Result<reqwest::Client, String> {
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
    reqwest::Client::builder()
        .user_agent("PlayCounter")
        .timeout(Duration::from_secs(30))
        // Sony's code comes in a redirect; a token never follows one.
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "Could not connect to PlayStation.".into())
}

async fn request_token(
    client: &reqwest::Client,
    pairs: &[(&str, &str)],
) -> Result<TokenAnswer, TokenFailure> {
    let cid = uuid::Uuid::new_v4().to_string();
    let mut body = vec![("cid", cid.as_str())];
    body.extend_from_slice(pairs);
    body.extend_from_slice(&[("scope", SCOPE), ("token_format", "jwt")]);
    let response = client
        .post(TOKEN_URL)
        .header("authorization", BASIC_AUTH)
        .header("content-type", "application/x-www-form-urlencoded")
        .header("user-agent", AUTH_USER_AGENT)
        .header("x-psn-correlation-id", &cid)
        .body(encode_pairs(&body))
        .send()
        .await
        .map_err(|_| TokenFailure::Unavailable)?;
    let status = response.status();
    if !status.is_success() {
        debug_answer("token", status);
        let body = response.text().await.unwrap_or_default();
        return Err(token_failure(status.as_u16(), &body));
    }
    let token: TokenAnswer = response
        .json()
        .await
        .map_err(|_| TokenFailure::Unavailable)?;
    if !valid_secret(&token.access_token) {
        debug_answer("token", "answer without a token");
        return Err(TokenFailure::Unavailable);
    }
    Ok(token)
}

async fn token_from_code(
    client: &reqwest::Client,
    code: &str,
) -> Result<TokenAnswer, TokenFailure> {
    request_token(
        client,
        &[
            ("code", code),
            ("grant_type", "authorization_code"),
            ("redirect_uri", REDIRECT_URI),
        ],
    )
    .await
}

async fn renew(client: &reqwest::Client, refresh_token: &str) -> Result<TokenAnswer, TokenFailure> {
    request_token(
        client,
        &[
            ("refresh_token", refresh_token),
            ("grant_type", "refresh_token"),
        ],
    )
    .await
}

async fn code_from_session(client: &reqwest::Client, npsso: &str) -> Result<String, TokenFailure> {
    let cid = uuid::Uuid::new_v4().to_string();
    let response = client
        .get(authorize_url(&cid))
        .header("cookie", format!("npsso={npsso}"))
        .header("x-requested-with", "com.scee.psxandroid")
        .send()
        .await
        .map_err(|_| TokenFailure::Unavailable)?;
    let status = response.status().as_u16();
    let location = response
        .headers()
        .get("location")
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned);
    let code = code_from_redirect(status, location.as_deref());
    if code.is_err() {
        debug_answer("session", status);
    }
    code
}

async fn token_from_session(
    client: &reqwest::Client,
    npsso: &str,
) -> Result<TokenAnswer, TokenFailure> {
    let code = code_from_session(client, npsso).await?;
    token_from_code(client, &code).await
}

async fn get_json<T: DeserializeOwned>(
    client: &reqwest::Client,
    access_token: &str,
    url: tauri::Url,
    step: &str,
) -> Result<T, u16> {
    let response = client
        .get(url)
        .bearer_auth(access_token)
        .header("accept-language", "en-US")
        .send()
        .await
        .map_err(|_| 0u16)?;
    let status = response.status();
    if !status.is_success() {
        debug_answer(step, status);
        return Err(status.as_u16());
    }
    response.json().await.map_err(|_| 0u16)
}

async fn read_account_id(client: &reqwest::Client, access_token: &str) -> Result<String, String> {
    let url = tauri::Url::parse(ACCOUNT_URL).expect("fixed Sony URL");
    let answer: AccountAnswer = get_json(client, access_token, url, "account")
        .await
        .map_err(|_| UNAVAILABLE.to_string())?;
    id_text(&answer.account_id)
        .filter(|id| valid_account_id(id))
        .ok_or_else(|| UNAVAILABLE.to_string())
}

/// The online id for "Signed in as". Never the e-mail or the account id.
async fn read_online_id(
    client: &reqwest::Client,
    access_token: &str,
    account_id: &str,
) -> Option<String> {
    let url = tauri::Url::parse(&format!("{PROFILE_URL}/{account_id}/profiles")).ok()?;
    let answer: ProfileAnswer = get_json(client, access_token, url, "profile").await.ok()?;
    answer
        .online_id
        .map(|name| name.trim().to_owned())
        .filter(|name| !name.is_empty())
}

/// Save before returning success or reading any games. A renewal may leave
/// out an unchanged refresh token or end.
fn keep(
    store: &Store,
    token: &TokenAnswer,
    npsso: Option<String>,
    account_id: String,
    name: Option<String>,
    previous: Option<(&KeptLogin, &Record)>,
    now: u64,
) -> Result<Record, String> {
    let refresh_token = token
        .refresh_token
        .clone()
        .or_else(|| previous.map(|(_, record)| record.refresh_token.clone()))
        .filter(|token| valid_secret(token))
        .ok_or("PlayStation did not provide a reusable sign-in. Please try again.")?;
    let refresh_ends_at = match (token.refresh_token_expires_in, previous) {
        (Some(seconds), _) => now.saturating_add(seconds),
        (None, Some((_, record))) if token.refresh_token.is_none() => record.refresh_ends_at,
        // Sony's ~10 days, when it says nothing.
        (None, _) => now.saturating_add(10 * 24 * 60 * 60),
    };
    let record = Record {
        version: 1,
        npsso: npsso
            .filter(|value| valid_npsso(value))
            .or_else(|| previous.and_then(|(_, record)| record.npsso.clone())),
        refresh_token,
        refresh_ends_at,
        account_id,
    };
    let secret = serde_json::to_string(&record)
        .map_err(|_| "Could not securely save the PlayStation sign-in. Please try again.")?;
    let name = name.or_else(|| previous.and_then(|(login, _)| login.name.clone()));
    store
        .save(Service::PlayStation, &KeptLogin::new(secret, name))
        .map_err(|_| "Could not securely save the PlayStation sign-in. Please try again.")?;
    Ok(record)
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

/// An access token from the kept sign-in, renewed as needed. Never a window.
async fn kept_access(
    store: &Store,
    client: &reqwest::Client,
    state: &PlayStationAccountState,
    force: bool,
) -> Result<(String, String), AccessFailure> {
    let previous = match store.try_load(Service::PlayStation) {
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
    let _guard = AUTHENTICATING.lock().await;
    // Another caller may have renewed while this one waited.
    let previous = match store.try_load(Service::PlayStation) {
        Ok(Some(previous)) => previous,
        Ok(None) => return Err(AccessFailure::SignedOut),
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
    let now = now_secs();
    let mut answer = match renewal(&record, now) {
        Renewal::Refresh => renew(client, &record.refresh_token).await,
        Renewal::FromSession => Err(TokenFailure::Refused),
        Renewal::SignIn => return Err(AccessFailure::NeedsSignIn),
    };
    // A refused or ending refresh token: a new one from the session cookie.
    if matches!(answer, Err(TokenFailure::Refused)) {
        if let Some(npsso) = record.npsso.as_deref() {
            answer = token_from_session(client, npsso).await;
        }
    }
    let token = match answer {
        Ok(token) => token,
        Err(TokenFailure::Refused) => return Err(AccessFailure::NeedsSignIn),
        Err(TokenFailure::Unavailable) => return Err(AccessFailure::Unavailable),
    };
    if !store.is_current(Service::PlayStation) {
        return Err(AccessFailure::SignedOut);
    }
    // A token from the session cookie starts a new 10-day refresh token.
    let kept = keep(
        store,
        &token,
        None,
        record.account_id.clone(),
        None,
        Some((&previous, &record)),
        now,
    )
    .map_err(|_| AccessFailure::Unavailable)?;
    let saved_at = store
        .load(Service::PlayStation)
        .map(|login| login.saved_at)
        .unwrap_or_default();
    let lifetime = token.expires_in.unwrap_or(3_600).clamp(60, 24 * 3_600);
    if let Ok(mut access) = state.access.lock() {
        *access = Some(CachedAccess {
            saved_at,
            token: token.access_token.clone(),
            account_id: kept.account_id.clone(),
            // A minute early, so a request never carries an expiring token.
            until: Instant::now() + Duration::from_secs(lifetime.saturating_sub(60)),
        });
    }
    Ok((token.access_token, kept.account_id))
}

/// A first sign-in: the code from the window or from the pasted cookie.
async fn finish_sign_in(
    store: &Store,
    client: &reqwest::Client,
    state: &PlayStationAccountState,
    token: Result<TokenAnswer, TokenFailure>,
    npsso: Option<String>,
) -> Result<(String, String), String> {
    let token = match token {
        Ok(token) => token,
        Err(TokenFailure::Refused) => return Err(REFUSED.into()),
        Err(TokenFailure::Unavailable) => return Err(UNAVAILABLE.into()),
    };
    let account_id = read_account_id(client, &token.access_token).await?;
    let name = read_online_id(client, &token.access_token, &account_id).await;
    let _guard = AUTHENTICATING.lock().await;
    keep(
        store,
        &token,
        npsso,
        account_id.clone(),
        name,
        None,
        now_secs(),
    )?;
    forget_access(state);
    Ok((token.access_token, account_id))
}

async fn read_played(client: &reqwest::Client, access_token: &str) -> Result<AccountLibrary, u16> {
    let mut titles = Vec::new();
    let mut offset: u64 = 0;
    for page in 0..MAX_PAGES {
        let mut url = tauri::Url::parse(GAMES_URL).expect("fixed Sony URL");
        url.query_pairs_mut()
            .append_pair("categories", "ps4_game,ps5_native_game")
            .append_pair("limit", &PAGE_SIZE.to_string())
            .append_pair("offset", &offset.to_string());
        let answer: PlayedPage = get_json(client, access_token, url, "games").await?;
        if page == 0 {
            debug_answer(
                "games",
                format!("{} titles", answer.total_item_count.unwrap_or(0)),
            );
        }
        let count = answer.titles.len() as u64;
        titles.extend(answer.titles);
        let next = answer.next_offset.filter(|next| *next > offset);
        match next {
            Some(next) if count > 0 => offset = next,
            _ => return Ok(build_library(&titles, false)),
        }
    }
    Ok(build_library(&titles, true))
}

async fn read_presence(
    client: &reqwest::Client,
    access_token: &str,
    account_id: &str,
) -> Result<Presence, u16> {
    let mut url = tauri::Url::parse(&format!("{PRESENCE_URL}/{account_id}/basicPresences"))
        .map_err(|_| 0u16)?;
    url.query_pairs_mut()
        .append_pair("type", "primary")
        .append_pair("platforms", "PS4,PS5,MOBILE_APP,PSPC")
        .append_pair("withOwnGameTitleInfo", "true");
    let answer: PresenceAnswer = get_json(client, access_token, url, "presence").await?;
    Ok(build_presence(answer))
}

/// A read with the kept sign-in. A refused token renews once, then the
/// sign-in is reported as needed; 429 asks the caller to wait.
async fn saved_read<T, F, Fut>(app: &AppHandle, read: F) -> SavedRead<T>
where
    F: Fn(reqwest::Client, String, String) -> Fut,
    Fut: std::future::Future<Output = Result<T, u16>>,
{
    if !cfg!(windows) {
        return SavedRead::status(LoginStatus::SignedOut);
    }
    let Some(state) = app.try_state::<PlayStationAccountState>() else {
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
    let Some(state) = app.try_state::<PlayStationAccountState>() else {
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

/// The account's PS4 and PS5 games with the kept sign-in. Background only.
#[tauri::command]
pub async fn library_playstation_saved_games(
    app: AppHandle,
    window: WebviewWindow,
) -> Result<SavedRead<AccountLibrary>, String> {
    if window.label() != "main" {
        return Err("PlayStation games are read from PlayCounter.".into());
    }
    Ok(saved_read(&app, |client, token, _| async move {
        tokio::time::timeout(Duration::from_secs(300), read_played(&client, &token))
            .await
            .unwrap_or(Err(0))
    })
    .await)
}

/// What runs on the console now, with the kept sign-in. Background only.
#[tauri::command]
pub async fn library_playstation_presence(
    app: AppHandle,
    window: WebviewWindow,
) -> Result<SavedRead<Presence>, String> {
    if window.label() != "main" {
        return Err("PlayStation status is read from PlayCounter.".into());
    }
    Ok(saved_read(&app, |client, token, account_id| async move {
        read_presence(&client, &token, &account_id).await
    })
    .await)
}

#[tauri::command]
pub async fn library_playstation_account_games(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, PlayStationAccountState>,
    request_id: String,
    // "PlayStation sign-in" in the main window's language, for the title.
    title: String,
) -> Result<AccountLibrary, String> {
    run_account_session(app, window, state, request_id, title, true)
        .await?
        .ok_or_else(|| UNAVAILABLE.into())
}

/// Account management connects at once, without reading the games.
#[tauri::command]
pub async fn library_playstation_sign_in(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, PlayStationAccountState>,
    request_id: String,
    title: String,
) -> Result<(), String> {
    run_account_session(app, window, state, request_id, title, false)
        .await
        .map(|_| ())
}

/// "Sign in with a code instead": the session cookie copied from Sony's page.
#[tauri::command]
pub async fn library_playstation_sign_in_with_code(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, PlayStationAccountState>,
    code: String,
) -> Result<(), String> {
    if window.label() != "main" || !cfg!(windows) {
        return Err("PlayStation sign-in is available in the Windows desktop app.".into());
    }
    let npsso = clean_pasted_npsso(&code).ok_or(
        "That is not a PlayStation sign-in code. Copy the whole line from Sony's page and try again.",
    )?;
    let store = Store::of(&app)?;
    let client = http_client()?;
    let token = token_from_session(&client, &npsso).await;
    let token = match token {
        Err(TokenFailure::Refused) => {
            return Err(
                "PlayStation did not accept this code. Sign in at playstation.com again and copy a new one."
                    .into(),
            )
        }
        other => other,
    };
    finish_sign_in(&store, &client, &state, token, Some(npsso))
        .await
        .map(|_| ())
}

async fn finish_account(
    client: &reqwest::Client,
    access_token: &str,
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
            match tokio::time::timeout(Duration::from_secs(300), read_played(client, access_token)).await {
                Ok(Ok(library)) => Ok(Some(library)),
                Ok(Err(429)) => Err("PlayStation is busy. Please try again in a few minutes.".to_string()),
                Ok(Err(_)) => Err(UNAVAILABLE.to_string()),
                Err(_) => Err("PlayStation took too long to answer. Please try again.".to_string()),
            }
        } => result,
    }
}

async fn run_account_session(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, PlayStationAccountState>,
    request_id: String,
    title: String,
    read_games: bool,
) -> Result<Option<AccountLibrary>, String> {
    if window.label() != "main" || !cfg!(windows) {
        return Err("PlayStation sign-in is available in the Windows desktop app.".into());
    }
    let id = uuid::Uuid::parse_str(&request_id)
        .map_err(|_| "Invalid PlayStation sign-in request.")?
        .to_string();
    let mut cancelled = state
        .sessions
        .lock()
        .map_err(|_| "Could not start PlayStation sign-in.")?
        .start(&id)
        .map_err(|error| {
            if error == SESSION_CANCELLED {
                CANCELLED.to_string()
            } else {
                "A PlayStation sign-in is already open. Finish or cancel it first.".to_string()
            }
        })?;
    let finish = |state: &PlayStationAccountState| {
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
        Ok((token, _)) => {
            let result = finish_account(&client, &token, &mut cancelled, false, read_games).await;
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
    let (navigation_rejected, rejected_navigation) = oneshot::channel();
    let navigation_rejected = Mutex::new(Some(navigation_rejected));
    let (code_sent, mut code_received) = oneshot::channel::<Result<String, ()>>();
    let code_sent = Mutex::new(Some(code_sent));
    let sign_in = tauri::WebviewWindowBuilder::new(
        &app,
        format!("playstation-sign-in-{id}"),
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
        if let Some(code) = done_code(url) {
            if let Some(sender) = code_sent.lock().ok().and_then(|mut value| value.take()) {
                let _ = sender.send(code);
            }
            // The PlayStation App's address never opens anything.
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
        Err(_) => Err("Could not open PlayStation sign-in. Please try again.".into()),
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
                        close_app.state::<PlayStationAccountState>().sessions.lock()
                    {
                        sessions.cancel(&close_id);
                    }
                }
            });
            let setup = secure_window(&sign_in, ExpectedProfile::Private, true).await;
            let session_ready = setup.is_ok();
            let cid = uuid::Uuid::new_v4().to_string();
            let code: Result<String, String> = tokio::select! {
                biased;
                _ = &mut cancelled => {
                    was_cancelled = true;
                    Err(CANCELLED.into())
                },
                _ = rejected_navigation => Err("PlayStation tried to open an unsupported sign-in page. Use Sign in with a code instead.".into()),
                result = tokio::time::timeout(Duration::from_secs(600), async {
                    setup?;
                    sign_in.navigate(authorize_url(&cid))
                        .map_err(|_| "Could not open PlayStation sign-in. Please try again.")?;
                    sign_in.show().map_err(|_| "Could not open PlayStation sign-in. Please try again.")?;
                    let _ = sign_in.set_focus();
                    match (&mut code_received).await {
                        Ok(Ok(code)) => Ok(code),
                        Ok(Err(())) => Err("PlayStation returned an invalid sign-in code. Please sign in again.".to_string()),
                        Err(_) => Err(CANCELLED.to_string()),
                    }
                }) => {
                    result.unwrap_or_else(|_| Err("PlayStation sign-in timed out. Please try again.".into()))
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
            // Sony's session cookie, read natively before the profile is
            // cleared. Without it the sign-in still works for ten days.
            let npsso = if code.is_ok() && session_ready {
                read_session_cookie(&sign_in).await
            } else {
                None
            };
            if code.is_ok() && npsso.is_none() {
                debug_answer("session cookie", "not found");
            }
            // Save the sign-in before cleaning up or reading any games.
            closing.store(true, Ordering::SeqCst);
            let _ = sign_in.hide();
            let authentication = match code {
                Ok(code) if store.is_current(Service::PlayStation) => {
                    let token = token_from_code(&client, &code).await;
                    finish_sign_in(&store, &client, &state, token, npsso).await
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
                    "Could not clear the PlayStation sign-in session. Close PlayCounter before signing in again."
                        .into(),
                );
            }
            authentication
        }
    };
    let result = match authentication {
        Err(error) => Err(error),
        Ok((token, _)) => {
            finish_account(&client, &token, &mut cancelled, was_cancelled, read_games).await
        }
    };
    finish(&state);
    result
}

#[tauri::command]
pub fn library_cancel_playstation_account(
    window: WebviewWindow,
    state: State<'_, PlayStationAccountState>,
    request_id: String,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("PlayStation sign-in must be cancelled from PlayCounter.".into());
    }
    let id = uuid::Uuid::parse_str(&request_id)
        .map_err(|_| "Invalid PlayStation sign-in request.")?
        .to_string();
    state
        .sessions
        .lock()
        .map_err(|_| "Could not cancel PlayStation sign-in.")?
        .cancel(&id);
    Ok(())
}

/// Sony's session cookie from the sign-in window, read natively. It never
/// crosses into any web page or the web UI.
#[cfg(windows)]
async fn read_session_cookie(window: &WebviewWindow) -> Option<String> {
    use webview2_com::{
        take_pwstr, GetCookiesCompletedHandler, Microsoft::Web::WebView2::Win32::*,
    };
    use windows_core::{Interface, HSTRING, PWSTR};

    let (sender, receiver) = oneshot::channel::<Option<String>>();
    let sender = Arc::new(Mutex::new(Some(sender)));
    window
        .with_webview(move |platform| {
            let completed = sender.clone();
            let read = || -> windows_core::Result<()> {
                unsafe {
                    platform
                        .controller()
                        .CoreWebView2()?
                        .cast::<ICoreWebView2_2>()?
                        .CookieManager()?
                        .GetCookies(
                            &HSTRING::from(SESSION_COOKIE_URL),
                            &GetCookiesCompletedHandler::create(Box::new(move |result, list| {
                                let mut found = None;
                                if let (Ok(()), Some(list)) = (result, list) {
                                    let mut count = 0;
                                    if list.Count(&mut count).is_ok() && count <= 4096 {
                                        for index in 0..count {
                                            let Ok(cookie) = list.GetValueAtIndex(index) else {
                                                continue;
                                            };
                                            let mut name = PWSTR::null();
                                            if cookie.Name(&mut name).is_err() {
                                                continue;
                                            }
                                            // Other cookies may hold JSON;
                                            // only this one is read.
                                            if take_pwstr(name) != "npsso" {
                                                continue;
                                            }
                                            let mut value = PWSTR::null();
                                            if cookie.Value(&mut value).is_ok() {
                                                found = Some(take_pwstr(value));
                                            }
                                            break;
                                        }
                                    }
                                }
                                if let Some(sender) =
                                    completed.lock().ok().and_then(|mut sender| sender.take())
                                {
                                    let _ = sender.send(found);
                                }
                                Ok(())
                            })),
                        )?;
                    Ok(())
                }
            };
            if read().is_err() {
                if let Some(sender) = sender.lock().ok().and_then(|mut sender| sender.take()) {
                    let _ = sender.send(None);
                }
            }
        })
        .ok()?;
    let value = match tokio::time::timeout(Duration::from_secs(10), receiver).await {
        Ok(Ok(value)) => value,
        _ => None,
    }?;
    valid_npsso(&value).then_some(value)
}

#[cfg(not(windows))]
async fn read_session_cookie(_: &WebviewWindow) -> Option<String> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(value: &str) -> tauri::Url {
        value.parse().unwrap()
    }

    const NPSSO: &str = "Xu3Hq0WlLXaQi4c8T5ZYnMBq3AzPjKX0xDmmTGekVe1bnpeHwiaE2GNY9PJY0TEK";

    #[test]
    fn only_sonys_sign_in_pages_are_trusted() {
        for value in [
            "https://ca.account.sony.com/api/authz/v3/oauth/authorize?client_id=x",
            // Where Sony sends a browser without a session (checked live 2026-11-01).
            "https://my.account.sony.com/sonyacct/signin/?error=login_required&error_code=4165",
            "https://id.sonyentertainmentnetwork.com/signin/",
        ] {
            assert!(login_navigation(&url(value)), "{value}");
        }
        for value in [
            "http://my.account.sony.com/sonyacct/signin/",
            "https://my.account.sony.com.evil.test/",
            "https://my.account.sony.com@evil.test/",
            "https://my.account.sony.com:444/",
            "https://store.playstation.com/",
            "https://evil.test/?https://my.account.sony.com",
            "tauri://localhost/",
            "file:///C:/private.txt",
        ] {
            assert!(!login_navigation(&url(value)), "{value}");
        }
    }

    #[test]
    fn the_code_comes_only_from_the_playstation_apps_exact_address() {
        assert_eq!(
            done_code(&url(
                "com.scee.psxandroid.scecompcall://redirect/?code=v3.AbC9-_x.Z~&cid=1"
            )),
            Some(Ok("v3.AbC9-_x.Z~".into()))
        );
        assert_eq!(
            done_code(&url(
                "com.scee.psxandroid.scecompcall://redirect?code=v3.abc"
            )),
            Some(Ok("v3.abc".into()))
        );
        for value in [
            "com.scee.psxandroid.scecompcall://redirect/?error=access_denied",
            "com.scee.psxandroid.scecompcall://redirect/?code=",
            "com.scee.psxandroid.scecompcall://redirect/?code=a%20b",
            "com.scee.psxandroid.scecompcall://redirect/?code=a%26b%3Dc",
        ] {
            assert_eq!(done_code(&url(value)), Some(Err(())), "{value}");
        }
        for value in [
            "com.scee.psxandroid.scecompcall://evil/?code=abc",
            "com.scee.psxandroid.scecompcall://redirect.evil/?code=abc",
            "com.scee.psxandroid.scecompcall://redirect/other?code=abc",
            "com.scee.psxandroid.scecompcall://user@redirect/?code=abc",
            "com.scee.psxandroid.scecompcallx://redirect/?code=abc",
            "https://redirect/?code=abc",
            "https://ca.account.sony.com/?code=abc",
        ] {
            assert_eq!(done_code(&url(value)), None, "{value}");
        }
    }

    #[test]
    fn a_session_cookie_code_is_read_from_sonys_redirect() {
        assert_eq!(
            code_from_redirect(
                302,
                Some("com.scee.psxandroid.scecompcall://redirect/?code=v3.abc&cid=1")
            ),
            Ok("v3.abc".into())
        );
        // Sony's live answer without a valid session cookie.
        assert_eq!(
            code_from_redirect(
                302,
                Some("https://my.account.sony.com/sonyacct/signin/?access_type=offline&error=login_required&error_code=4165&no_captcha=true")
            ),
            Err(TokenFailure::Refused)
        );
        for (status, location) in [
            (200, None),
            (302, None),
            (
                500,
                Some("com.scee.psxandroid.scecompcall://redirect/?code=x"),
            ),
            (302, Some("https://example.test/elsewhere")),
            (302, Some("not a url")),
        ] {
            assert_eq!(
                code_from_redirect(status, location),
                Err(TokenFailure::Unavailable),
                "{status} {location:?}"
            );
        }
    }

    #[test]
    fn only_sonys_refusal_ends_a_kept_sign_in() {
        for body in [
            r#"{"error":"invalid_grant","error_description":"Invalid login","error_code":20}"#,
            // Sony's live answer to a refresh token it doesn't know (2026-11-01).
            r#"{"error":"invalid_request","error_description":"Invalid request","error_code":4150}"#,
        ] {
            assert_eq!(token_failure(400, body), TokenFailure::Refused, "{body}");
        }
        for status in [400, 401, 403, 404, 408, 429, 500, 503] {
            for body in ["{}", "not json", r#"{"error":"server_error"}"#] {
                assert_eq!(token_failure(status, body), TokenFailure::Unavailable);
            }
        }
        for status in [403, 429, 500, 503] {
            assert_eq!(
                token_failure(status, r#"{"error":"invalid_grant"}"#),
                TokenFailure::Unavailable
            );
        }
    }

    #[test]
    fn the_pasted_code_is_the_bare_cookie_or_sonys_whole_answer() {
        assert_eq!(clean_pasted_npsso(NPSSO).as_deref(), Some(NPSSO));
        assert_eq!(
            clean_pasted_npsso(&format!("  {NPSSO}\n")).as_deref(),
            Some(NPSSO)
        );
        assert_eq!(
            clean_pasted_npsso(&format!(r#"{{"npsso":"{NPSSO}"}}"#)).as_deref(),
            Some(NPSSO)
        );
        for value in [
            "",
            "short",
            r#"{"npsso":null}"#,
            r#"{"error":"invalid_grant","error_description":"Invalid login","error_code":20}"#,
            &format!("{NPSSO}; other=1"),
            &format!("npsso={NPSSO}"),
            &format!("{NPSSO} {NPSSO}"),
        ] {
            assert_eq!(clean_pasted_npsso(value), None, "{value}");
        }
    }

    #[test]
    fn reads_sonys_played_time() {
        assert_eq!(parse_play_duration("PT228H56M33S"), Some(824_193));
        assert_eq!(parse_play_duration("PT300H"), Some(1_080_000));
        assert_eq!(parse_play_duration("PT45M"), Some(2_700));
        assert_eq!(parse_play_duration("PT59S"), Some(59));
        assert_eq!(parse_play_duration("PT0S"), Some(0));
        assert_eq!(parse_play_duration("PT1M2.9S"), Some(62));
        assert_eq!(parse_play_duration("P1DT2H"), Some(93_600));
        for value in [
            "", "PT", "P", "228H", "PT5X", "PTH", "PT1S2M", "PT1H1H", "PT-1H", "PT1.5H", "PT1H2",
        ] {
            assert_eq!(parse_play_duration(value), None, "{value}");
        }
    }

    fn row(
        category: &str,
        concept: Value,
        title_id: &str,
        name: &str,
        duration: Option<&str>,
    ) -> PlayedTitle {
        PlayedTitle {
            title_id: title_id.into(),
            name: name.into(),
            category: category.into(),
            concept: Some(Concept {
                id: concept,
                title_ids: vec![],
            }),
            play_duration: duration.map(str::to_owned),
            ..PlayedTitle::default()
        }
    }

    #[test]
    fn one_game_per_concept_with_the_sum_of_its_copies() {
        let titles = vec![
            PlayedTitle {
                last_played_date_time: Some("2026-10-30T21:25:28.987Z".into()),
                ..row(
                    "ps5_native_game",
                    10000333.into(),
                    "PPSA04609_00",
                    "ELDEN RING",
                    Some("PT10H"),
                )
            },
            PlayedTitle {
                last_played_date_time: Some("2024-01-02T10:00:00.000Z".into()),
                ..row(
                    "ps4_game",
                    "10000333".into(),
                    "CUSA18638_00",
                    "ELDEN RING PS4",
                    Some("PT2H30M"),
                )
            },
            row(
                "ps5_native_game",
                10002684.into(),
                "PPSA11110_00",
                " Astro Bot ",
                Some("PT0S"),
            ),
            // Unknown playtime stays unknown.
            row(
                "ps4_game",
                200520.into(),
                "CUSA00207_00",
                "Bloodborne",
                Some("odd"),
            ),
            // Skipped: a PC copy, an unknown category, no concept id, no name.
            row(
                "pspc_game",
                10000333.into(),
                "PPSA04609_00",
                "ELDEN RING PC",
                Some("PT99H"),
            ),
            row(
                "unknown",
                228748.into(),
                "CUSA07669_00",
                "Fortnite",
                Some("PT5H"),
            ),
            row(
                "ps5_native_game",
                0.into(),
                "PPSA00000_00",
                "No concept",
                Some("PT1H"),
            ),
            row(
                "ps5_native_game",
                Value::Null,
                "PPSA00001_00",
                "Null concept",
                Some("PT1H"),
            ),
            row(
                "ps5_native_game",
                42.into(),
                "PPSA00002_00",
                "  ",
                Some("PT1H"),
            ),
        ];
        let library = build_library(&titles, false);
        assert_eq!(
            library.games,
            vec![
                AccountGame {
                    concept_id: "10000333".into(),
                    title: "ELDEN RING".into(),
                    playtime_seconds: Some(45_000),
                    last_played_at: Some("2026-10-30T21:25:28.987Z".into()),
                    platforms: vec!["PS5", "PS4"],
                    title_ids: vec!["CUSA18638_00".into(), "PPSA04609_00".into()],
                },
                AccountGame {
                    concept_id: "10002684".into(),
                    title: "Astro Bot".into(),
                    playtime_seconds: Some(0),
                    last_played_at: None,
                    platforms: vec!["PS5"],
                    title_ids: vec!["PPSA11110_00".into()],
                },
                AccountGame {
                    concept_id: "200520".into(),
                    title: "Bloodborne".into(),
                    playtime_seconds: None,
                    last_played_at: None,
                    platforms: vec!["PS4"],
                    title_ids: vec!["CUSA00207_00".into()],
                },
            ]
        );
        assert!(!library.incomplete);
        assert!(build_library(&titles, true).incomplete);
    }

    #[test]
    fn parses_sonys_played_list_page() {
        // The shape psn-api documents for gamelist/v2 (sample values).
        let page: PlayedPage = serde_json::from_str(
            r#"{"titles":[{"titleId":"CUSA01433_00","name":"Rocket League®","localizedName":"Rocket League®","imageUrl":"https://image.api.playstation.com/x.png","category":"ps4_game","service":"none_purchased","playCount":312,"concept":{"id":203715,"titleIds":["CUSA01433_00","CUSA01163_00"],"name":"Rocket League®","media":{},"genres":[]},"media":{},"firstPlayedDateTime":"2015-07-08T01:16:21.320Z","lastPlayedDateTime":"2026-10-21T19:56:03.780Z","playDuration":"PT228H56M33S"}],"nextOffset":1,"previousOffset":0,"totalItemCount":2}"#,
        )
        .unwrap();
        assert_eq!(page.next_offset, Some(1));
        let library = build_library(&page.titles, false);
        assert_eq!(
            library.games,
            vec![AccountGame {
                concept_id: "203715".into(),
                title: "Rocket League®".into(),
                playtime_seconds: Some(824_193),
                last_played_at: Some("2026-10-21T19:56:03.780Z".into()),
                platforms: vec!["PS4"],
                title_ids: vec!["CUSA01163_00".into(), "CUSA01433_00".into()],
            }]
        );
    }

    #[test]
    fn the_web_ui_gets_concept_ids_titles_playtime_and_title_ids_only() {
        let library = build_library(
            &[row(
                "ps5_native_game",
                10002684.into(),
                "PPSA11110_00",
                "Astro Bot",
                Some("PT3M"),
            )],
            false,
        );
        assert_eq!(
            serde_json::to_value(&library).unwrap(),
            serde_json::json!({
                "games": [{
                    "conceptId": "10002684",
                    "title": "Astro Bot",
                    "playtimeSeconds": 180,
                    "lastPlayedAt": null,
                    "platforms": ["PS5"],
                    "titleIds": ["PPSA11110_00"]
                }],
                "incomplete": false
            })
        );
    }

    #[test]
    fn presence_names_only_a_ps4_or_ps5_game_that_runs() {
        // psn-api's documented presence answer.
        let playing: PresenceAnswer = serde_json::from_str(
            r#"{"basicPresence":{"availability":"availableToPlay","primaryPlatformInfo":{"onlineStatus":"online","platform":"PS5","lastOnlineDate":"2023-06-03T21:25:28.987Z"},"gameTitleInfoList":[{"npTitleId":"PPSA01521_00","titleName":"Horizon Forbidden West","format":"PS5","launchPlatform":"PS5","conceptIconUrl":"https://image.api.playstation.com/vulcan/ap/rnd/202010/2915/kifM3lnke5lExwRd96mIDojQ.png"}]}}"#,
        )
        .unwrap();
        assert_eq!(
            build_presence(playing),
            Presence {
                online: true,
                game: Some(LiveGame {
                    title_id: "PPSA01521_00".into(),
                    name: "Horizon Forbidden West".into(),
                    platform: "PS5",
                    icon_url: Some("https://image.api.playstation.com/vulcan/ap/rnd/202010/2915/kifM3lnke5lExwRd96mIDojQ.png".into()),
                }),
            }
        );
        let ps4: PresenceAnswer = serde_json::from_str(
            r#"{"basicPresence":{"primaryPlatformInfo":{"onlineStatus":"online","platform":"ps4"},"gameTitleInfoList":[{"npTitleId":"CUSA00207_00","titleName":"Bloodborne","format":"ps4","launchPlatform":"ps4","conceptIconUrl":"https://evil.test/x.png"}]}}"#,
        )
        .unwrap();
        assert_eq!(
            build_presence(ps4).game,
            Some(LiveGame {
                title_id: "CUSA00207_00".into(),
                name: "Bloodborne".into(),
                platform: "PS4",
                // Not one of Sony's image hosts.
                icon_url: None,
            })
        );
        for answer in [
            // Online without a game, offline with a stale game, a PC game,
            // the mobile app, a broken title id.
            r#"{"basicPresence":{"primaryPlatformInfo":{"onlineStatus":"online","platform":"PS5"}}}"#,
            r#"{"basicPresence":{"primaryPlatformInfo":{"onlineStatus":"offline","platform":"PS5"},"gameTitleInfoList":[{"npTitleId":"PPSA01521_00","titleName":"Horizon","format":"PS5","launchPlatform":"PS5"}]}}"#,
            r#"{"basicPresence":{"primaryPlatformInfo":{"onlineStatus":"online","platform":"PSPC"},"gameTitleInfoList":[{"npTitleId":"PPSA01521_00","titleName":"Horizon","format":"PSPC","launchPlatform":"PSPC"}]}}"#,
            r#"{"basicPresence":{"primaryPlatformInfo":{"onlineStatus":"online","platform":"MOBILE_APP"},"gameTitleInfoList":[{"npTitleId":"PPSA01521_00","titleName":"Horizon","format":"MOBILE_APP"}]}}"#,
            r#"{"basicPresence":{"primaryPlatformInfo":{"onlineStatus":"online","platform":"PS5"},"gameTitleInfoList":[{"npTitleId":"../../x","titleName":"Horizon","format":"PS5","launchPlatform":"PS5"}]}}"#,
            r#"{}"#,
        ] {
            let presence = build_presence(serde_json::from_str(answer).unwrap());
            assert_eq!(presence.game, None, "{answer}");
        }
    }

    fn record(npsso: Option<&str>, refresh_ends_at: u64) -> Record {
        Record {
            version: 1,
            npsso: npsso.map(str::to_owned),
            refresh_token: "r1".into(),
            refresh_ends_at,
            account_id: "1234567890123456789".into(),
        }
    }

    #[test]
    fn a_new_refresh_token_comes_from_the_session_cookie_three_days_before_the_end() {
        let now = 1_000_000;
        let day = 24 * 60 * 60;
        assert_eq!(
            renewal(&record(Some(NPSSO), now + 4 * day), now),
            Renewal::Refresh
        );
        assert_eq!(
            renewal(&record(Some(NPSSO), now + 3 * day), now),
            Renewal::FromSession
        );
        assert_eq!(
            renewal(&record(Some(NPSSO), now - 1), now),
            Renewal::FromSession
        );
        // Without a session cookie the refresh token works to its end.
        assert_eq!(renewal(&record(None, now + day), now), Renewal::Refresh);
        assert_eq!(renewal(&record(None, now), now), Renewal::SignIn);
    }

    #[test]
    fn a_kept_record_is_read_back_only_when_whole_and_valid() {
        let good = record(Some(NPSSO), 5);
        let text = serde_json::to_string(&good).unwrap();
        assert!(Record::decode(&text) == Some(good));
        for text in [
            "",
            "r1",
            r#"{"version":2,"refreshToken":"r1","refreshEndsAt":5,"accountId":"1"}"#,
            r#"{"version":1,"refreshToken":"","refreshEndsAt":5,"accountId":"1"}"#,
            r#"{"version":1,"refreshToken":"r1","refreshEndsAt":5,"accountId":"x"}"#,
            r#"{"version":1,"npsso":"short","refreshToken":"r1","refreshEndsAt":5,"accountId":"1"}"#,
            r#"{"version":1,"refreshToken":"r1","refreshEndsAt":5,"accountId":"1","extra":true}"#,
        ] {
            assert!(Record::decode(text).is_none(), "{text}");
        }
    }

    fn token(refresh: Option<&str>, ends_in: Option<u64>) -> TokenAnswer {
        TokenAnswer {
            access_token: "access".into(),
            expires_in: Some(3_599),
            refresh_token: refresh.map(str::to_owned),
            refresh_token_expires_in: ends_in,
        }
    }

    #[cfg(windows)]
    #[test]
    fn the_sign_in_is_kept_with_the_session_cookie_and_renewals_keep_it() {
        let (store, dir) = Store::for_test();
        let now = 1_000;
        assert!(keep(
            &store,
            &token(None, None),
            Some(NPSSO.into()),
            "1".into(),
            None,
            None,
            now
        )
        .is_err());
        assert_eq!(store.load(Service::PlayStation), None);

        let first = keep(
            &store,
            &token(Some("r1"), Some(863_999)),
            Some(NPSSO.into()),
            "1".into(),
            Some("zesarex".into()),
            None,
            now,
        )
        .unwrap();
        assert_eq!(first.refresh_ends_at, now + 863_999);
        let kept = store.load(Service::PlayStation).unwrap();
        assert_eq!(kept.name.as_deref(), Some("zesarex"));
        assert!(Record::decode(&kept.secret) == Some(first.clone()));
        // A renewal: a new refresh token, the same end, the cookie and name stay.
        let renewed = keep(
            &store,
            &token(Some("r2"), Some(863_000)),
            None,
            "1".into(),
            None,
            Some((&kept, &first)),
            now + 999,
        )
        .unwrap();
        assert_eq!(renewed.refresh_token, "r2");
        assert_eq!(renewed.npsso.as_deref(), Some(NPSSO));
        assert_eq!(renewed.refresh_ends_at, now + 999 + 863_000);
        assert_eq!(
            store.load(Service::PlayStation).unwrap().name.as_deref(),
            Some("zesarex")
        );
        // An answer without a refresh token keeps the last one and its end.
        let kept = store.load(Service::PlayStation).unwrap();
        let same = keep(
            &store,
            &token(None, None),
            None,
            "1".into(),
            None,
            Some((&kept, &renewed)),
            now + 2_000,
        )
        .unwrap();
        assert_eq!(same.refresh_token, "r2");
        assert_eq!(same.refresh_ends_at, renewed.refresh_ends_at);
        // The web UI's summary never holds the record.
        let summary = serde_json::to_string(&store.list().unwrap()).unwrap();
        assert!(
            !summary.contains(NPSSO) && !summary.contains("r2"),
            "{summary}"
        );
        let _ = std::fs::remove_dir_all(dir);
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn without_a_kept_sign_in_nothing_is_asked_of_sony() {
        let (store, dir) = Store::for_test();
        let client = http_client().unwrap();
        let state = PlayStationAccountState::default();
        assert_eq!(
            kept_access(&store, &client, &state, false).await,
            Err(AccessFailure::SignedOut)
        );
        // An unreadable record asks for a new sign-in instead of failing.
        store
            .save(
                Service::PlayStation,
                &KeptLogin::new("not a record".into(), None),
            )
            .unwrap();
        assert_eq!(
            kept_access(&store, &client, &state, false).await,
            Err(AccessFailure::NeedsSignIn)
        );
        // A record whose refresh token ended, without a session cookie.
        let ended = serde_json::to_string(&record(None, 1)).unwrap();
        store
            .save(Service::PlayStation, &KeptLogin::new(ended, None))
            .unwrap();
        assert_eq!(
            kept_access(&store, &client, &state, false).await,
            Err(AccessFailure::NeedsSignIn)
        );
        let _ = std::fs::remove_dir_all(dir);
    }
}
