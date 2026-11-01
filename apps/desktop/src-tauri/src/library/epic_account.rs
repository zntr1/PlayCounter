//! Optional, temporary Epic Games sign-in for the account library and its
//! playtime. Epic has no public API for this. Like Playnite and Legendary, the
//! import signs in as the Epic Games Launcher client and reads the launcher's
//! library, catalog and playtime services, which can change without notice.
//!
//! The sign-in page runs in a hardened InPrivate webview. Only the one-time
//! authorization code leaves it. The refresh token is kept encrypted on this
//! PC (see `kept_logins`), so the next import needs no window; Sign out ends
//! the session at Epic. Only app names, titles and playtime reach the
//! frontend.
use super::battlenet_account::{
    clear_profile_data, secure_window, ExpectedProfile, Sessions, CANCELLED as SESSION_CANCELLED,
};
use super::kept_logins::{KeptLogin, Service, Store};
use super::login_status::LoginStatus;
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, HashMap},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tauri::{webview::NewWindowResponse, AppHandle, Manager, State, WebviewUrl, WebviewWindow};
use tokio::sync::{oneshot, Semaphore};

const CLIENT_ID: &str = "34a02cf8f4414e29b15921876da36f9a";
const CLIENT_SECRET: &str = "daafbccc737745039dffe53d94fc76cf";
const LOGIN_URL: &str = "https://www.epicgames.com/id/login?redirectUrl=https%3A%2F%2Fwww.epicgames.com%2Fid%2Fapi%2Fredirect%3FclientId%3D34a02cf8f4414e29b15921876da36f9a%26responseType%3Dcode";
const TOKEN_URL: &str =
    "https://account-public-service-prod03.ol.epicgames.com/account/api/oauth/token";
const KILL_URL: &str =
    "https://account-public-service-prod03.ol.epicgames.com/account/api/oauth/sessions/kill";
const LIBRARY_URL: &str = "https://library-service.live.use1a.on.epicgames.com/library/api/public";
const CATALOG_URL: &str =
    "https://catalog-public-service-prod06.ol.epicgames.com/catalog/api/shared/namespace";
const REDIRECT_URL: &str = "https://www.epicgames.com/id/api/redirect?clientId=34a02cf8f4414e29b15921876da36f9a&responseType=code";
// Field names and Epic's error code are returned for diagnosis; no values.
const READ_CODE: &str = r#"(() => {
  if (location.origin !== "https://www.epicgames.com" || location.pathname !== "/id/api/redirect") return null;
  try {
    const text = document.querySelector("pre")?.innerText ?? document.body.innerText;
    const body = JSON.parse(text);
    if (!body || typeof body !== "object") return null;
    return {
      code: typeof body.authorizationCode === "string" ? body.authorizationCode : null,
      fields: Object.keys(body).slice(0, 20).map((key) => String(key).slice(0, 40)),
      errorCode: typeof body.errorCode === "string" ? body.errorCode.slice(0, 200) : null,
    };
  } catch {
    return null;
  }
})()"#;
/// Right after login Epic can answer without a code; a reload usually has it.
const CODE_RELOADS: usize = 3;
const CANCELLED: &str = "Epic Games sign-in was cancelled.";
const MAX_LIBRARY_PAGES: usize = 50;
const MAX_GAMES: usize = 5_000;
const CATALOG_REQUESTS_IN_FLIGHT: usize = 6;
// Refresh tokens can rotate. Background validation, foreground imports and
// achievement reads must never redeem the same saved token concurrently.
pub(super) static AUTHENTICATING: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

#[derive(Default)]
pub struct EpicAccountState(Mutex<Sessions>);

pub(super) fn cancel_active(app: &AppHandle) {
    if let Some(state) = app.try_state::<EpicAccountState>() {
        if let Ok(mut sessions) = state.0.lock() {
            sessions.cancel_active();
        }
    }
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AccountGame {
    app_name: String,
    title: String,
    /// `None` when Epic's playtime service could not be read.
    playtime_seconds: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountLibrary {
    games: Vec<AccountGame>,
    incomplete: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CodeResult {
    code: Option<String>,
    #[serde(default)]
    fields: Vec<String>,
    #[serde(default)]
    error_code: Option<String>,
}

#[derive(Debug, PartialEq)]
enum CodePage {
    /// Not the redirect page yet, or it is still loading.
    Pending,
    Code(String),
    /// Epic answered, but without a code.
    Missing(String),
}

#[derive(Deserialize)]
pub(super) struct Token {
    pub(super) access_token: String,
    pub(super) account_id: String,
    #[serde(default)]
    refresh_token: Option<String>,
    #[serde(default, rename = "displayName")]
    display_name: Option<String>,
}

/// Why Epic gave no token.
#[derive(Debug, PartialEq)]
pub(super) enum TokenFailure {
    /// Epic confirmed that this credential expired or was revoked.
    Refused(String),
    /// Account action is required, but this does not revoke the saved login.
    ActionRequired(String),
    /// Epic did not answer properly. A kept sign-in stays.
    Unavailable,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LibraryPage {
    #[serde(default)]
    records: Vec<LibraryRecord>,
    #[serde(default)]
    response_metadata: Option<PageMetadata>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PageMetadata {
    next_cursor: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct LibraryRecord {
    /// Also the game's sandbox id for its achievements.
    #[serde(default)]
    pub(super) namespace: String,
    #[serde(default)]
    catalog_item_id: String,
    #[serde(default)]
    pub(super) app_name: String,
    #[serde(default)]
    sandbox_type: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PlaytimeItem {
    artifact_id: String,
    total_time: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CatalogItem {
    #[serde(default)]
    title: String,
    #[serde(default)]
    categories: Vec<CatalogCategory>,
    #[serde(default)]
    main_game_item: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
struct CatalogCategory {
    path: String,
}

fn login_navigation(url: &tauri::Url) -> bool {
    // Exact login hosts only. Social sign-in leaves Epic and comes back to it.
    const HOSTS: &[&str] = &[
        "www.epicgames.com",
        "epicgames.com",
        "accounts.epicgames.com",
        "accounts.google.com",
        "appleid.apple.com",
        "account.apple.com",
        "login.live.com",
        "account.live.com",
        "login.microsoftonline.com",
        "login.microsoft.com",
        "my.account.sony.com",
        "ca.account.sony.com",
        "accounts.nintendo.com",
        "steamcommunity.com",
        "store.steampowered.com",
        "www.facebook.com",
        "m.facebook.com",
        "identity.lego.com",
    ];
    url.scheme() == "https"
        && url.port_or_known_default() == Some(443)
        && url.username().is_empty()
        && url.password().is_none()
        && url.host_str().is_some_and(|host| HOSTS.contains(&host))
}

fn redirect_page(url: &tauri::Url) -> bool {
    url.scheme() == "https"
        && url.host_str() == Some("www.epicgames.com")
        && url.port_or_known_default() == Some(443)
        && url.username().is_empty()
        && url.password().is_none()
        && url.path() == "/id/api/redirect"
}

/// Epic blocks sign-in until the account accepts something on Epic's own
/// site, for example an updated privacy policy. Reloading cannot fix that.
fn corrective_action_message(error_code: Option<&str>) -> Option<String> {
    (error_code == Some("errors.com.epicgames.oauth.corrective_action_required")).then(|| {
        "Epic Games needs you to confirm something on your account first, such as its updated privacy policy. Sign in at epicgames.com or in the Epic Games Launcher, accept it, then try again.".into()
    })
}

fn decode_code(value: &str) -> Result<CodePage, String> {
    if value.len() > 10_000 {
        return Err("Epic Games returned an unexpected sign-in page.".into());
    }
    let result = match serde_json::from_str::<Option<CodeResult>>(value) {
        Ok(None) => return Ok(CodePage::Pending),
        Ok(Some(result)) => result,
        Err(_) => return Err("Epic Games returned an unexpected sign-in page.".into()),
    };
    match result.code {
        Some(code)
            if !code.is_empty()
                && code.len() <= 128
                && code.bytes().all(|byte| byte.is_ascii_alphanumeric()) =>
        {
            Ok(CodePage::Code(code))
        }
        Some(_) => Err("Epic Games returned an invalid sign-in code. Please sign in again.".into()),
        None => {
            if let Some(message) = corrective_action_message(result.error_code.as_deref()) {
                return Err(message);
            }
            let clean = |value: &str| -> String {
                value
                    .chars()
                    .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
                    .collect()
            };
            let fields: Vec<_> = result.fields.iter().map(|field| clean(field)).collect();
            let mut detail = format!("page fields: {}", fields.join(", "));
            if let Some(code) = result.error_code.as_deref().map(clean) {
                detail.push_str(&format!("; Epic error: {code}"));
            }
            Ok(CodePage::Missing(detail))
        }
    }
}

/// Keeps what PlayCounter can import: launchable games, not engines,
/// plugins, add-ons or private test builds.
fn is_game(record: &LibraryRecord, item: &CatalogItem) -> bool {
    let has = |path: &str| item.categories.iter().any(|category| category.path == path);
    record.namespace != "ue"
        && !record
            .sandbox_type
            .as_deref()
            .is_some_and(|value| value.eq_ignore_ascii_case("PRIVATE"))
        && super::epic::valid_id(&record.app_name)
        && has("applications")
        && !has("digitalextras")
        && !has("plugins")
        && item.main_game_item.is_none()
        && !item.title.trim().is_empty()
}

fn build_library(
    records: &[LibraryRecord],
    catalog: &HashMap<(String, String), CatalogItem>,
    playtime: Option<&[PlaytimeItem]>,
    mut incomplete: bool,
) -> AccountLibrary {
    let seconds: HashMap<&str, u64> = playtime
        .unwrap_or_default()
        .iter()
        .map(|item| (item.artifact_id.as_str(), item.total_time))
        .collect();
    let mut games = BTreeMap::new();
    for record in records {
        let Some(item) = catalog.get(&(record.namespace.clone(), record.catalog_item_id.clone()))
        else {
            // A missing catalog answer means the game could not be checked.
            incomplete = true;
            continue;
        };
        if !is_game(record, item) || games.contains_key(&record.app_name) {
            continue;
        }
        games.insert(
            record.app_name.clone(),
            AccountGame {
                app_name: record.app_name.clone(),
                title: item.title.trim().chars().take(256).collect(),
                // Epic lists only games it has recorded time for.
                playtime_seconds: playtime
                    .map(|_| seconds.get(record.app_name.as_str()).copied().unwrap_or(0)),
            },
        );
    }
    AccountLibrary {
        games: games.into_values().take(MAX_GAMES).collect(),
        incomplete: incomplete || playtime.is_none(),
    }
}

pub(super) fn http_client() -> Result<reqwest::Client, String> {
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
    reqwest::Client::builder()
        .user_agent("PlayCounter")
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|_| "Could not connect to Epic Games.".into())
}

/// `application/x-www-form-urlencoded` text for the pairs.
fn encode_pairs(pairs: &[(&str, &str)]) -> String {
    let mut url = tauri::Url::parse("https://localhost/").expect("fixed URL");
    url.query_pairs_mut().extend_pairs(pairs);
    url.query().unwrap_or_default().to_string()
}

fn with_query(base: &str, pairs: &[(&str, &str)]) -> Result<tauri::Url, String> {
    let mut url = tauri::Url::parse(base).map_err(|_| UNAVAILABLE)?;
    if !pairs.is_empty() {
        url.query_pairs_mut().extend_pairs(pairs);
    }
    Ok(url)
}

const UNAVAILABLE: &str =
    "Epic Games could not provide your game list. Try again, or scan installed games.";

async fn request_token(
    client: &reqwest::Client,
    pairs: &[(&str, &str)],
) -> Result<Token, TokenFailure> {
    let response = client
        .post(TOKEN_URL)
        .basic_auth(CLIENT_ID, Some(CLIENT_SECRET))
        .header("content-type", "application/x-www-form-urlencoded")
        .body(encode_pairs(pairs))
        .send()
        .await
        .map_err(|_| TokenFailure::Unavailable)?;
    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(token_failure(status.as_u16(), &body));
    }
    let token: Token = response
        .json()
        .await
        .map_err(|_| TokenFailure::Unavailable)?;
    if token.access_token.is_empty()
        || !token
            .account_id
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit())
        || token.account_id.is_empty()
    {
        return Err(TokenFailure::Unavailable);
    }
    Ok(token)
}

/// Only an explicit credential rejection ends a saved login. Proxy errors,
/// changed endpoints and other unexpected 4xx responses must not sign out.
fn token_failure(status: u16, body: &str) -> TokenFailure {
    if status >= 500 || status == 429 {
        return TokenFailure::Unavailable;
    }
    let error_code = serde_json::from_str::<serde_json::Value>(body)
        .ok()
        .and_then(|value| value["errorCode"].as_str().map(str::to_owned));
    if let Some(message) = corrective_action_message(error_code.as_deref()) {
        return TokenFailure::ActionRequired(message);
    }
    match error_code.as_deref() {
        Some("errors.com.epicgames.account.auth_token.invalid_refresh_token") => {
            TokenFailure::Refused(
                "Epic Games sign-in expired or could not be verified. Please sign in again.".into(),
            )
        }
        _ => TokenFailure::Unavailable,
    }
}

async fn exchange_code(client: &reqwest::Client, code: &str) -> Result<Token, TokenFailure> {
    request_token(
        client,
        &[
            ("grant_type", "authorization_code"),
            ("code", code),
            ("token_type", "eg1"),
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
            ("token_type", "eg1"),
        ],
    )
    .await
}

/// Persist before returning authentication success or starting game discovery.
/// OAuth permits an unchanged refresh token to be omitted during renewal.
fn keep(store: &Store, token: &Token, previous: Option<&KeptLogin>) -> Result<(), String> {
    let secret = token
        .refresh_token
        .as_deref()
        .or_else(|| previous.map(|login| login.secret.as_str()))
        .filter(|secret| !secret.is_empty() && secret.len() <= 8192)
        .ok_or("Epic Games did not provide a reusable sign-in. Please try again.")?;
    let name = token
        .display_name
        .clone()
        .or_else(|| previous.and_then(|login| login.name.clone()));
    store
        .save(Service::Epic, &KeptLogin::new(secret.to_owned(), name))
        .map_err(|_| "Could not securely save the Epic Games sign-in. Please try again.".into())
}

async fn end_session(client: &reqwest::Client, access_token: &str) {
    let _ = client
        .delete(format!("{KILL_URL}/{access_token}"))
        .bearer_auth(access_token)
        .send()
        .await;
}

/// Sign out: renews the kept sign-in once to end its session at Epic.
pub(super) async fn end_kept_session(refresh_token: &str) {
    let Ok(client) = http_client() else {
        return;
    };
    let _ = tokio::time::timeout(Duration::from_secs(10), async {
        let _guard = AUTHENTICATING.lock().await;
        if let Ok(token) = renew(&client, refresh_token).await {
            end_session(&client, &token.access_token).await;
        }
    })
    .await;
}

/// Check only the saved credential. No webview, library request or remote
/// account details are exposed to the application UI.
pub(super) async fn check_saved_login(app: &AppHandle) -> LoginStatus {
    if !cfg!(windows) {
        return LoginStatus::SignedOut;
    }
    let Ok(_guard) = AUTHENTICATING.try_lock() else {
        return LoginStatus::Busy;
    };
    if app.try_state::<EpicAccountState>().is_some_and(|state| {
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
    let previous = match store.try_load(Service::Epic) {
        Ok(Some(previous)) => previous,
        Ok(None) => return LoginStatus::SignedOut,
        Err(_) => return LoginStatus::Unavailable,
    };
    let Ok(client) = http_client() else {
        return LoginStatus::Unavailable;
    };
    let response = renew(&client, &previous.secret).await;
    if !store.is_current(Service::Epic) {
        if let Ok(token) = &response {
            // Explicit logout may have happened while Epic issued a rotated
            // token; end that response too rather than persisting it late.
            end_session(&client, &token.access_token).await;
        }
    }
    finish_saved_check(&store, &previous, response)
}

fn finish_saved_check(
    store: &Store,
    previous: &KeptLogin,
    response: Result<Token, TokenFailure>,
) -> LoginStatus {
    if !store.is_current(Service::Epic) {
        return LoginStatus::SignedOut;
    }
    match response {
        Ok(token) => {
            if keep(store, &token, Some(previous)).is_ok() {
                LoginStatus::Valid
            } else {
                LoginStatus::Unavailable
            }
        }
        // Preserve the saved record until the user reconnects or signs out;
        // background failure must remain distinguishable from no account.
        Err(TokenFailure::Refused(_) | TokenFailure::ActionRequired(_)) => LoginStatus::NeedsSignIn,
        Err(TokenFailure::Unavailable) => LoginStatus::Unavailable,
    }
}

async fn get_json<T: serde::de::DeserializeOwned>(
    client: &reqwest::Client,
    token: &Token,
    url: &str,
    query: &[(&str, &str)],
) -> Result<T, String> {
    let response = client
        .get(with_query(url, query)?)
        .bearer_auth(&token.access_token)
        .send()
        .await
        .map_err(|_| UNAVAILABLE)?;
    if !response.status().is_success() {
        return Err(UNAVAILABLE.into());
    }
    response.json().await.map_err(|_| UNAVAILABLE.into())
}

pub(super) async fn read_records(
    client: &reqwest::Client,
    token: &Token,
) -> Result<(Vec<LibraryRecord>, bool), String> {
    let url = format!("{LIBRARY_URL}/items");
    let mut records = Vec::new();
    let mut cursor: Option<String> = None;
    for _ in 0..MAX_LIBRARY_PAGES {
        let mut query = vec![("includeMetadata", "true"), ("platform", "Windows")];
        if let Some(cursor) = cursor.as_deref() {
            query.push(("cursor", cursor));
        }
        let page: LibraryPage = get_json(client, token, &url, &query).await?;
        records.extend(page.records);
        cursor = page
            .response_metadata
            .and_then(|metadata| metadata.next_cursor)
            .filter(|cursor| !cursor.is_empty());
        if cursor.is_none() {
            return Ok((records, false));
        }
    }
    // Stopped early: keep what was read and report the list as incomplete.
    Ok((records, true))
}

async fn read_catalog(
    client: &reqwest::Client,
    token: &Token,
    records: &[LibraryRecord],
) -> HashMap<(String, String), CatalogItem> {
    let mut by_namespace: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for record in records {
        if record.namespace == "ue"
            || !super::epic::valid_id(&record.namespace)
            || !super::epic::valid_id(&record.catalog_item_id)
        {
            continue;
        }
        let ids = by_namespace.entry(record.namespace.clone()).or_default();
        if !ids.contains(&record.catalog_item_id) {
            ids.push(record.catalog_item_id.clone());
        }
    }
    let limit = Arc::new(Semaphore::new(CATALOG_REQUESTS_IN_FLIGHT));
    let mut tasks = tokio::task::JoinSet::new();
    for (namespace, ids) in by_namespace {
        for chunk in ids.chunks(50) {
            let client = client.clone();
            let access_token = token.access_token.clone();
            let limit = limit.clone();
            let namespace = namespace.clone();
            let ids = chunk.to_vec();
            tasks.spawn(async move {
                let _permit = limit.acquire_owned().await.ok()?;
                let mut query = vec![
                    ("includeDLCDetails", "true"),
                    ("includeMainGameDetails", "true"),
                    ("country", "US"),
                    ("locale", "en-US"),
                ];
                query.extend(ids.iter().map(|id| ("id", id.as_str())));
                let url =
                    with_query(&format!("{CATALOG_URL}/{namespace}/bulk/items"), &query).ok()?;
                let response = client
                    .get(url)
                    .bearer_auth(access_token)
                    .send()
                    .await
                    .ok()?;
                if !response.status().is_success() {
                    return None;
                }
                let items: HashMap<String, CatalogItem> = response.json().await.ok()?;
                Some((namespace, items))
            });
        }
    }
    let mut catalog = HashMap::new();
    while let Some(result) = tasks.join_next().await {
        if let Ok(Some((namespace, items))) = result {
            for (id, item) in items {
                catalog.insert((namespace.clone(), id), item);
            }
        }
    }
    catalog
}

async fn read_account(client: &reqwest::Client, token: &Token) -> Result<AccountLibrary, String> {
    let (records, truncated) = read_records(client, token).await?;
    let playtime_url = format!("{LIBRARY_URL}/playtime/account/{}/all", token.account_id);
    let playtime = get_json::<Vec<PlaytimeItem>>(client, token, &playtime_url, &[])
        .await
        .ok();
    let catalog = read_catalog(client, token, &records).await;
    Ok(build_library(
        &records,
        &catalog,
        playtime.as_deref(),
        truncated,
    ))
}

/// Once a code exchange or refresh has started, finish it and save the token
/// even if the caller leaves the view. Dropping that HTTP request can lose a
/// one-time code or the replacement for an already rotated refresh token.
pub(super) async fn finish_authentication(
    store: &Store,
    client: &reqwest::Client,
    previous: Option<&KeptLogin>,
    request: impl std::future::Future<Output = Result<Token, TokenFailure>>,
) -> Result<Option<Token>, String> {
    let token = match request.await {
        Ok(token) => token,
        Err(TokenFailure::Refused(_)) if previous.is_some() => {
            store.delete(Service::Epic)?;
            return Ok(None);
        }
        Err(TokenFailure::Refused(message) | TokenFailure::ActionRequired(message)) => {
            return Err(message);
        }
        Err(TokenFailure::Unavailable) => return Err(UNAVAILABLE.into()),
    };
    if let Err(error) = keep(store, &token, previous) {
        if !store.is_current(Service::Epic) {
            // Explicit sign-out wins over a late token response. A disk error,
            // however, must not revoke an otherwise valid saved session.
            end_session(client, &token.access_token).await;
        }
        return Err(error);
    }
    Ok(Some(token))
}

/// Authentication is already durable. Only the optional game read is
/// cancellable; neither cancellation nor library errors remove the login.
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
                .unwrap_or_else(|_| Err("Epic Games took too long to answer. Please try again.".into()))
                .map(Some)
        } => result,
    }
}

/// One read without navigating or reloading. Also used during cancellation to
/// capture an authorization code that arrived at the same time as navigation.
async fn read_ready_code(window: &WebviewWindow) -> Result<CodePage, String> {
    if !redirect_page(&window.url().map_err(|_| CANCELLED)?) {
        return Ok(CodePage::Pending);
    }
    let (sender, receiver) = oneshot::channel();
    let sender = Mutex::new(Some(sender));
    window
        .eval_with_callback(READ_CODE, move |value| {
            if let Some(sender) = sender.lock().ok().and_then(|mut value| value.take()) {
                let _ = sender.send(value);
            }
        })
        .map_err(|_| "Could not read the Epic Games sign-in window.")?;
    let value = tokio::time::timeout(Duration::from_secs(5), receiver)
        .await
        .map_err(|_| "The Epic Games sign-in window stopped responding. Please try again.")?
        .map_err(|_| CANCELLED)?;
    decode_code(&value)
}

pub(super) async fn read_code_after_cancel(
    window: &WebviewWindow,
    store: &Store,
) -> Result<String, String> {
    let _ = window.hide();
    tokio::time::timeout(Duration::from_secs(2), async {
        let mut interval = tokio::time::interval(Duration::from_millis(50));
        loop {
            interval.tick().await;
            if !store.is_current(Service::Epic) {
                return Err(CANCELLED.into());
            }
            match read_ready_code(window).await? {
                CodePage::Code(code) if store.is_current(Service::Epic) => return Ok(code),
                // The redirect may still be loading when the user leaves. Wait
                // briefly for that existing page; never navigate or reload it.
                CodePage::Pending | CodePage::Missing(_) => {}
                CodePage::Code(_) => return Err(CANCELLED.into()),
            }
        }
    })
    .await
    .unwrap_or_else(|_| Err(CANCELLED.into()))
}

async fn read_code(window: &WebviewWindow) -> Result<String, String> {
    let mut interval = tokio::time::interval(Duration::from_millis(500));
    let mut reloads = 0;
    loop {
        interval.tick().await;
        match read_ready_code(window).await? {
            CodePage::Pending => {}
            CodePage::Code(code) => return Ok(code),
            CodePage::Missing(detail) if reloads >= CODE_RELOADS => {
                return Err(format!(
                    "Epic Games signed you in but did not hand over a sign-in code ({detail}). Please try again."
                ));
            }
            CodePage::Missing(_) => {
                reloads += 1;
                tokio::time::sleep(Duration::from_millis(1_500)).await;
                window
                    .navigate(REDIRECT_URL.parse().expect("fixed Epic Games URL"))
                    .map_err(|_| "Could not read the Epic Games sign-in window.")?;
                // Let the reload start before the next read.
                tokio::time::sleep(Duration::from_millis(1_000)).await;
            }
        }
    }
}

#[tauri::command]
pub async fn library_epic_account_games(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, EpicAccountState>,
    request_id: String,
    // "Epic Games sign-in" in the main window's language, for the window title.
    title: String,
) -> Result<AccountLibrary, String> {
    run_account_session(app, window, state, request_id, title, true)
        .await?
        .ok_or_else(|| UNAVAILABLE.into())
}

/// Account management connects immediately, without fetching the library.
#[tauri::command]
pub async fn library_epic_sign_in(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, EpicAccountState>,
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
    state: State<'_, EpicAccountState>,
    request_id: String,
    title: String,
    read_games: bool,
) -> Result<Option<AccountLibrary>, String> {
    if window.label() != "main" || !cfg!(windows) {
        return Err("Epic Games sign-in is available in the Windows desktop app.".into());
    }
    let id = uuid::Uuid::parse_str(&request_id)
        .map_err(|_| "Invalid Epic Games sign-in request.")?
        .to_string();
    let mut cancelled = state
        .0
        .lock()
        .map_err(|_| "Could not start Epic Games sign-in.")?
        .start(&id)
        .map_err(|error| {
            if error == SESSION_CANCELLED {
                CANCELLED.to_string()
            } else {
                "An Epic Games sign-in is already open. Finish or cancel it first.".to_string()
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
    // Refresh and persist without racing cancellation. The HTTP client bounds
    // this work to 30 seconds, and sign-out still invalidates the store.
    let authenticating = AUTHENTICATING.lock().await;
    let previous = match store.try_load(Service::Epic) {
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
    let sign_in = tauri::WebviewWindowBuilder::new(
        &app,
        format!("epic-sign-in-{id}"),
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
        Err(_) => Err("Could not open Epic Games sign-in. Please try again.".into()),
        Ok(sign_in) => {
            let close_app = app.clone();
            let close_id = id.clone();
            // Closing the window ourselves must not cancel the library read
            // that follows it.
            let closing = Arc::new(AtomicBool::new(false));
            let closing_event = closing.clone();
            sign_in.on_window_event(move |event| {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    // Keep the webview alive until the native cleanup completes.
                    api.prevent_close();
                }
                if !closing_event.load(Ordering::SeqCst)
                    && matches!(
                        event,
                        tauri::WindowEvent::CloseRequested { .. } | tauri::WindowEvent::Destroyed
                    )
                {
                    if let Ok(mut sessions) = close_app.state::<EpicAccountState>().0.lock() {
                        sessions.cancel(&close_id);
                    }
                }
            });
            let setup = secure_window(&sign_in, ExpectedProfile::Private, true).await;
            let session_ready = setup.is_ok();
            let code = tokio::select! {
                biased;
                _ = &mut cancelled => {
                    was_cancelled = true;
                    // Switching views immediately after a successful sign-in
                    // must still capture the code already on the redirect page.
                    read_code_after_cancel(&sign_in, &store).await
                },
                _ = rejected_navigation => Err("Epic Games tried to open an unsupported sign-in page. Update PlayCounter or use Find installed games.".into()),
                result = tokio::time::timeout(Duration::from_secs(600), async {
                    setup?;
                    sign_in.navigate(LOGIN_URL.parse().expect("fixed Epic Games URL"))
                        .map_err(|_| "Could not open Epic Games sign-in. Please try again.")?;
                    sign_in.show().map_err(|_| "Could not open Epic Games sign-in. Please try again.")?;
                    let _ = sign_in.set_focus();
                    read_code(&sign_in).await
                }) => {
                    result.unwrap_or_else(|_| Err("Epic Games sign-in timed out. Please try again.".into()))
                }
            };
            // Save authentication before cleanup or reading any games. The
            // private webview can be hidden now; tokens never reach the UI.
            closing.store(true, Ordering::SeqCst);
            let _ = sign_in.hide();
            let authentication = match code {
                Ok(code) if store.is_current(Service::Epic) => {
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
                // private profile. Never silently reuse an uncleared session.
                return Err(
                    "Could not clear the Epic Games sign-in session. Close PlayCounter before signing in again."
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
pub fn library_cancel_epic_account(
    window: WebviewWindow,
    state: State<'_, EpicAccountState>,
    request_id: String,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Epic Games sign-in must be cancelled from PlayCounter.".into());
    }
    let id = uuid::Uuid::parse_str(&request_id)
        .map_err(|_| "Invalid Epic Games sign-in request.")?
        .to_string();
    state
        .0
        .lock()
        .map_err(|_| "Could not cancel Epic Games sign-in.")?
        .cancel(&id);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_epic_login_hosts_and_the_exact_redirect_page_are_trusted() {
        for value in [
            LOGIN_URL,
            "https://login.live.com/oauth20_authorize.srf",
            "https://accounts.google.com/signin",
        ] {
            assert!(login_navigation(&value.parse().unwrap()));
        }
        for value in [
            "http://www.epicgames.com/id/login",
            "https://www.epicgames.com.evil.test/",
            "https://www.epicgames.com@evil.test/",
            "https://www.epicgames.com:444/",
            "https://store.epicgames.com/",
            "tauri://localhost/",
            "file:///C:/private.txt",
        ] {
            assert!(!login_navigation(&value.parse().unwrap()));
        }
        assert!(redirect_page(
            &"https://www.epicgames.com/id/api/redirect?clientId=x&responseType=code"
                .parse()
                .unwrap()
        ));
        for value in [
            "https://www.epicgames.com/id/login",
            "https://epicgames.com/id/api/redirect",
            "https://www.epicgames.com:444/id/api/redirect",
            "http://www.epicgames.com/id/api/redirect",
        ] {
            assert!(!redirect_page(&value.parse().unwrap()));
        }
    }

    #[test]
    fn accepts_only_a_plain_authorization_code() {
        assert_eq!(
            decode_code(r#"{"code":"0123abcDEF","fields":["authorizationCode"]}"#).unwrap(),
            CodePage::Code("0123abcDEF".to_string())
        );
        assert_eq!(decode_code("null").unwrap(), CodePage::Pending);
        for value in [r#"{"code":""}"#, r#"{"code":"a&b=c"}"#, "not json"] {
            assert!(decode_code(value).is_err());
        }
    }

    #[test]
    fn a_required_account_action_stops_at_once_with_a_clear_message() {
        let error = decode_code(
            r#"{"code":null,"fields":["errorCode","message","metadata","correlationId"],"errorCode":"errors.com.epicgames.oauth.corrective_action_required"}"#,
        )
        .unwrap_err();
        assert!(error.contains("privacy policy"));
        assert_eq!(
            corrective_action_message(Some("errors.com.epicgames.other")),
            None
        );
    }

    #[test]
    fn a_missing_code_reports_field_names_and_no_values() {
        let page = decode_code(
            r#"{"code":null,"fields":["warning","authorizationCode","sid","<b>x"],"errorCode":"errors.com.epicgames.x y"}"#,
        )
        .unwrap();
        assert_eq!(
            page,
            CodePage::Missing(
                "page fields: warning, authorizationCode, sid, bx; Epic error: errors.com.epicgames.xy"
                    .into()
            )
        );
    }

    fn record(namespace: &str, item: &str, app: &str) -> LibraryRecord {
        LibraryRecord {
            namespace: namespace.into(),
            catalog_item_id: item.into(),
            app_name: app.into(),
            sandbox_type: Some("PUBLIC".into()),
        }
    }

    fn item(title: &str, categories: &[&str], dlc: bool) -> CatalogItem {
        CatalogItem {
            title: title.into(),
            categories: categories
                .iter()
                .map(|path| CatalogCategory {
                    path: (*path).into(),
                })
                .collect(),
            main_game_item: dlc.then(|| serde_json::json!({"id": "main"})),
        }
    }

    #[test]
    fn keeps_games_with_their_playtime_and_drops_addons_engines_and_extras() {
        let records = vec![
            record("ns1", "a1", "Sugar"),
            record("ns2", "b1", "Hades"),
            record("ns2", "b2", "HadesSoundtrack"),
            record("ns3", "c1", "SomeDlc"),
            record("ue", "d1", "Marketplace"),
            record("ns4", "e1", "NoCatalog"),
            record("ns1", "a1", "Sugar"),
        ];
        let catalog = HashMap::from([
            (
                ("ns1".into(), "a1".into()),
                item("Rocket League®", &["games", "applications"], false),
            ),
            (
                ("ns2".into(), "b1".into()),
                item("Hades", &["games", "applications"], false),
            ),
            (
                ("ns2".into(), "b2".into()),
                item(
                    "Hades Soundtrack",
                    &["digitalextras", "applications"],
                    false,
                ),
            ),
            (
                ("ns3".into(), "c1".into()),
                item("Some DLC", &["addons", "applications"], true),
            ),
            (
                ("ue".into(), "d1".into()),
                item("Asset", &["applications"], false),
            ),
        ]);
        let playtime = vec![PlaytimeItem {
            artifact_id: "Sugar".into(),
            total_time: 7_200,
        }];
        let library = build_library(&records, &catalog, Some(&playtime), false);
        assert_eq!(
            library.games,
            vec![
                AccountGame {
                    app_name: "Hades".into(),
                    title: "Hades".into(),
                    playtime_seconds: Some(0),
                },
                AccountGame {
                    app_name: "Sugar".into(),
                    title: "Rocket League®".into(),
                    playtime_seconds: Some(7_200),
                },
            ]
        );
        // "NoCatalog" could not be checked.
        assert!(library.incomplete);

        let without_playtime = build_library(&records[..2], &catalog, None, false);
        assert!(without_playtime.incomplete);
        assert!(without_playtime
            .games
            .iter()
            .all(|game| game.playtime_seconds.is_none()));
    }

    #[test]
    fn parses_the_launcher_service_responses() {
        let page: LibraryPage = serde_json::from_str(
            r#"{"responseMetadata":{"nextCursor":"abc","stateToken":"x"},"records":[{"namespace":"fn","catalogItemId":"4fe7","appName":"Fortnite","productId":"p","sandboxType":"PUBLIC","recordType":"APPLICATION"}]}"#,
        )
        .unwrap();
        assert_eq!(page.records[0].app_name, "Fortnite");
        assert_eq!(
            page.response_metadata.unwrap().next_cursor.as_deref(),
            Some("abc")
        );
        let playtime: Vec<PlaytimeItem> =
            serde_json::from_str(r#"[{"accountId":"a","artifactId":"Fortnite","totalTime":3600}]"#)
                .unwrap();
        assert_eq!(playtime[0].total_time, 3600);
        let catalog: HashMap<String, CatalogItem> = serde_json::from_str(
            r#"{"4fe7":{"id":"4fe7","title":"Fortnite","categories":[{"path":"games"},{"path":"applications"}],"keyImages":[]}}"#,
        )
        .unwrap();
        assert_eq!(catalog["4fe7"].title, "Fortnite");
    }

    fn token(refresh_token: Option<&str>, display_name: Option<&str>) -> Token {
        Token {
            access_token: "eg1~access".into(),
            account_id: "abc123".into(),
            refresh_token: refresh_token.map(str::to_owned),
            display_name: display_name.map(str::to_owned),
        }
    }

    #[test]
    fn reads_the_refresh_token_and_display_name_from_the_token_answer() {
        let token: Token = serde_json::from_str(
            r#"{"access_token":"eg1~a","account_id":"0f12","refresh_token":"eg1~r","refresh_expires":1987200,"displayName":"Player One","client_id":"x"}"#,
        )
        .unwrap();
        assert_eq!(token.refresh_token.as_deref(), Some("eg1~r"));
        assert_eq!(token.display_name.as_deref(), Some("Player One"));
    }

    #[cfg(windows)]
    #[test]
    fn a_sign_in_is_kept_only_with_a_refresh_token() {
        let (store, dir) = Store::for_test();
        assert!(keep(&store, &token(None, Some("Player One")), None).is_err());
        assert!(keep(&store, &token(Some(""), None), None).is_err());
        assert_eq!(store.load(Service::Epic), None);

        keep(&store, &token(Some("eg1~r"), Some("Player One")), None).unwrap();
        let kept = store.load(Service::Epic).unwrap();
        assert_eq!(kept.secret, "eg1~r");
        assert_eq!(kept.name.as_deref(), Some("Player One"));
        // A renewal without a name keeps the old one.
        keep(&store, &token(Some("eg1~r2"), None), Some(&kept)).unwrap();
        assert_eq!(
            store.load(Service::Epic).unwrap().name.as_deref(),
            Some("Player One")
        );
        let renewed = store.load(Service::Epic).unwrap();
        keep(&store, &token(None, None), Some(&renewed)).unwrap();
        assert_eq!(store.load(Service::Epic).unwrap().secret, "eg1~r2");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn only_a_confirmed_credential_rejection_ends_the_sign_in() {
        for status in [400, 401, 403, 404, 408, 429, 500, 503] {
            for body in ["{}", "not json", r#"{"errorCode":"unknown_error"}"#] {
                assert_eq!(token_failure(status, body), TokenFailure::Unavailable);
            }
        }
        assert!(matches!(
            token_failure(400, r#"{"errorCode":"errors.com.epicgames.account.auth_token.invalid_refresh_token"}"#),
            TokenFailure::Refused(message) if message.contains("sign in again")
        ));
        assert!(matches!(
            token_failure(400, r#"{"errorCode":"errors.com.epicgames.oauth.corrective_action_required"}"#),
            TokenFailure::ActionRequired(message) if message.contains("confirm something")
        ));
        // Epic also uses this generic grant error for unsupported grant types,
        // so it does not prove that this user's refresh token is invalid.
        assert_eq!(
            token_failure(
                400,
                r#"{"errorCode":"errors.com.epicgames.common.oauth.invalid_grant"}"#
            ),
            TokenFailure::Unavailable
        );
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn cancelling_during_authentication_still_saves_the_new_or_rotated_token() {
        for existing in [false, true] {
            let (store, dir) = Store::for_test();
            let client = http_client().unwrap();
            if existing {
                keep(
                    &store,
                    &token(Some("old-refresh"), Some("Player One")),
                    None,
                )
                .unwrap();
            }
            let previous = store.load(Service::Epic);
            let (cancel, mut cancelled) = oneshot::channel();
            let (ready, started) = oneshot::channel();
            let (respond, response) = oneshot::channel();
            let session = async {
                let authenticated =
                    finish_authentication(&store, &client, previous.as_ref(), async {
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
                // The response arrives only after the UI has cancelled.
                tokio::task::yield_now().await;
                respond
                    .send(Ok(token(Some("new-refresh"), Some("Player One"))))
                    .ok()
                    .unwrap();
            };
            let (result, ()) = tokio::join!(session, leave_after_request_started);
            assert!(matches!(result, Err(error) if error == CANCELLED));
            let saved = store.load(Service::Epic).unwrap();
            assert_eq!(saved.secret, "new-refresh");
            assert_eq!(saved.name.as_deref(), Some("Player One"));
            let _ = std::fs::remove_dir_all(dir);
        }
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn temporary_refresh_errors_and_account_actions_preserve_the_saved_login() {
        let (store, dir) = Store::for_test();
        let client = http_client().unwrap();
        keep(&store, &token(Some("refresh"), None), None).unwrap();
        let previous = store.load(Service::Epic).unwrap();
        for failure in [
            TokenFailure::Unavailable,
            TokenFailure::ActionRequired("Confirm account".into()),
        ] {
            assert!(
                finish_authentication(&store, &client, Some(&previous), async { Err(failure) })
                    .await
                    .is_err()
            );
            assert_eq!(store.load(Service::Epic).unwrap().secret, "refresh");
        }
        assert!(
            finish_authentication(&store, &client, Some(&previous), async {
                Err(TokenFailure::Refused("Expired".into()))
            })
            .await
            .unwrap()
            .is_none()
        );
        assert_eq!(store.load(Service::Epic), None);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn connecting_succeeds_as_soon_as_authentication_is_saved() {
        let (store, dir) = Store::for_test();
        let client = http_client().unwrap();
        let (_cancel, mut cancelled) = oneshot::channel();
        let authenticated = finish_authentication(&store, &client, None, async {
            Ok(token(Some("refresh"), Some("Player One")))
        })
        .await
        .unwrap()
        .unwrap();
        // No library or network fixture exists: connecting cannot depend on it.
        assert!(
            finish_account(&client, &authenticated, &mut cancelled, false, false)
                .await
                .unwrap()
                .is_none()
        );
        assert_eq!(store.load(Service::Epic).unwrap().secret, "refresh");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn a_secure_store_write_error_does_not_claim_success_or_delete_the_previous_login() {
        let (store, dir) = Store::for_test();
        let client = http_client().unwrap();
        keep(&store, &token(Some("previous-refresh"), None), None).unwrap();
        let previous = store.load(Service::Epic).unwrap();
        // Block the atomic temporary-file write while preserving the old file.
        std::fs::create_dir(dir.join("epic.tmp")).unwrap();
        let result = finish_authentication(&store, &client, Some(&previous), async {
            Ok(token(Some("rotated-refresh"), None))
        })
        .await;
        assert!(matches!(result, Err(error) if error.contains("securely save")));
        assert_eq!(
            store.load(Service::Epic).unwrap().secret,
            "previous-refresh"
        );
        let _ = std::fs::remove_dir_all(dir);
    }

    #[cfg(windows)]
    #[test]
    fn background_checks_preserve_expired_and_temporarily_unavailable_accounts() {
        let (store, dir) = Store::for_test();
        keep(&store, &token(Some("refresh"), None), None).unwrap();
        let previous = store.load(Service::Epic).unwrap();
        for (failure, expected) in [
            (TokenFailure::Unavailable, LoginStatus::Unavailable),
            (
                TokenFailure::Refused("Expired".into()),
                LoginStatus::NeedsSignIn,
            ),
            (
                TokenFailure::ActionRequired("Confirm account".into()),
                LoginStatus::NeedsSignIn,
            ),
        ] {
            assert_eq!(
                finish_saved_check(&store, &previous, Err(failure)),
                expected
            );
            assert_eq!(store.load(Service::Epic).unwrap().secret, "refresh");
        }
        let _ = std::fs::remove_dir_all(dir);
    }

    #[cfg(windows)]
    #[test]
    fn background_checks_save_rotation_before_reporting_valid_and_report_disk_failures() {
        let (store, dir) = Store::for_test();
        keep(&store, &token(Some("previous"), Some("Player")), None).unwrap();
        let previous = store.load(Service::Epic).unwrap();
        assert_eq!(
            finish_saved_check(&store, &previous, Ok(token(Some("rotated"), None))),
            LoginStatus::Valid
        );
        let renewed = store.load(Service::Epic).unwrap();
        assert_eq!(renewed.secret, "rotated");
        assert_eq!(renewed.name.as_deref(), Some("Player"));
        std::fs::create_dir(dir.join("epic.tmp")).unwrap();
        assert_eq!(
            finish_saved_check(&store, &renewed, Ok(token(Some("unsaved"), None))),
            LoginStatus::Unavailable
        );
        assert_eq!(store.load(Service::Epic).unwrap().secret, "rotated");
        let _ = std::fs::remove_dir_all(dir);
    }
}
