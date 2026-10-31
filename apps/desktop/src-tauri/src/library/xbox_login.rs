//! Keeps the Microsoft sign-in of an Xbox import. The web UI still runs the
//! import against the PlayCounter server, but never sees the sign-in: it asks
//! this part for a claim hash, the server keeps the refresh token for the
//! holder of the claim secret, and this part claims and stores it. A kept
//! sign-in only ever goes back to the PlayCounter server it came from.
use super::kept_logins::{KeptLogin, Service, Store};
use super::login_status::LoginStatus;
use serde::{Deserialize, Serialize};
use std::{
    sync::Mutex,
    time::{Duration, Instant},
};
use tauri::{AppHandle, WebviewWindow};

const PRODUCTION_ORIGIN: &str = "https://api.playcounter.app";
const CLAIM_LIFETIME: Duration = Duration::from_secs(15 * 60);
const MAX_OPEN_CLAIMS: usize = 8;

#[derive(Clone, Copy)]
struct ClaimRetry {
    budget: Duration,
    delay: Duration,
}

const CLAIM_RETRY: ClaimRetry = ClaimRetry {
    // A browser callback already exchanging its Microsoft code may finish
    // after the user leaves the view. Give that exchange time to publish
    // its login, independently of the cancelled import.
    budget: Duration::from_secs(35),
    delay: Duration::from_secs(1),
};

struct Claim {
    hash: String,
    secret: String,
    origin: String,
    created: Instant,
    store: Store,
}

static CLAIMS: Mutex<Vec<Claim>> = Mutex::new(Vec::new());
/// Microsoft renews the token on every use; one sync at a time keeps the
/// newest one.
static SYNCING: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

/// The PlayCounter server a sign-in may be sent to: production, and a local
/// server in development builds only.
fn trusted_origin(endpoint: &str) -> Option<String> {
    let url = tauri::Url::parse(endpoint.trim_end_matches('/')).ok()?;
    if !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || !matches!(url.path(), "" | "/")
    {
        return None;
    }
    let origin = url.origin().ascii_serialization();
    let local = url.scheme() == "http"
        && matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
    (origin == PRODUCTION_ORIGIN || (cfg!(debug_assertions) && local)).then_some(origin)
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn sha256_hex(value: &str) -> String {
    hex(ring::digest::digest(&ring::digest::SHA256, value.as_bytes()).as_ref())
}

fn new_claim(origin: String, store: Store) -> Option<Claim> {
    let mut secret = [0u8; 32];
    ring::rand::SecureRandom::fill(&ring::rand::SystemRandom::new(), &mut secret).ok()?;
    let secret = hex(&secret);
    Some(Claim {
        hash: sha256_hex(&secret),
        secret,
        origin,
        created: Instant::now(),
        store,
    })
}

fn remember(claims: &mut Vec<Claim>, claim: Claim) {
    claims.retain(|open| open.created.elapsed() < CLAIM_LIFETIME);
    while claims.len() >= MAX_OPEN_CLAIMS {
        claims.remove(0);
    }
    claims.push(claim);
}

fn take(claims: &mut Vec<Claim>, hash: &str) -> Option<Claim> {
    let index = claims
        .iter()
        .position(|claim| claim.hash == hash && claim.created.elapsed() < CLAIM_LIFETIME)?;
    Some(claims.remove(index))
}

fn client() -> Option<reqwest::Client> {
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
    reqwest::Client::builder()
        .user_agent("PlayCounter")
        .timeout(Duration::from_secs(30))
        // A redirect must never carry a sign-in to another address.
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .ok()
}

fn valid_hex(value: &str, length: usize) -> bool {
    value.len() == length
        && value
            .bytes()
            .all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f'))
}

fn valid_token(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 8192
        && value.bytes().all(|byte| (0x21..=0x7e).contains(&byte))
}

/// A hash for the import's start request, or `None` when this PC keeps no
/// sign-ins or the server is not a PlayCounter server.
#[tauri::command]
pub fn xbox_login_claim_hash(
    app: AppHandle,
    window: WebviewWindow,
    api_endpoint: String,
) -> Option<String> {
    if window.label() != "main" || !cfg!(windows) {
        return None;
    }
    let claim = new_claim(trusted_origin(&api_endpoint)?, Store::of(&app).ok()?)?;
    let hash = claim.hash.clone();
    let mut claims = CLAIMS.lock().ok()?;
    remember(&mut claims, claim);
    Some(hash)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClaimedLogin {
    refresh_token: String,
    gamertag: Option<String>,
}

/// Claims a completed sign-in independently of the library import. A view
/// cancellation does not cancel this native command or its secure save.
#[tauri::command]
pub async fn xbox_login_keep(
    window: WebviewWindow,
    attempt_id: String,
    claim_hash: String,
) -> bool {
    if window.label() != "main" || !valid_hex(&attempt_id, 48) || !valid_hex(&claim_hash, 64) {
        return false;
    }
    keep_claim(&CLAIMS, &attempt_id, &claim_hash, CLAIM_RETRY).await
}

async fn keep_claim(
    open_claims: &Mutex<Vec<Claim>>,
    attempt_id: &str,
    claim_hash: &str,
    retry: ClaimRetry,
) -> bool {
    let Some(claim) = open_claims
        .lock()
        .ok()
        .and_then(|mut claims| take(&mut claims, claim_hash))
    else {
        return false;
    };
    let saved = save_claim(&claim, attempt_id, retry).await;
    // Taking the claim serializes duplicate invocations. A failed request
    // must not consume the only local copy of its secret: polling or a later
    // finalizer can retry it. Signing out invalidates the original Store.
    if !saved && claim.created.elapsed() < CLAIM_LIFETIME && claim.store.is_current(Service::Xbox) {
        if let Ok(mut claims) = open_claims.lock() {
            remember(&mut claims, claim);
        }
    }
    saved
}

fn retryable_claim_status(status: reqwest::StatusCode) -> bool {
    // The server intentionally uses the same 404 for a pending claim and
    // an unknown one, so no caller can inspect another attempt's state.
    matches!(status.as_u16(), 404 | 408 | 425 | 429) || status.is_server_error()
}

async fn save_claim(claim: &Claim, attempt_id: &str, retry: ClaimRetry) -> bool {
    let started = Instant::now();
    let Ok(_guard) = tokio::time::timeout(retry.budget, SYNCING.lock()).await else {
        return false;
    };
    let Some(client) = client() else {
        return false;
    };
    loop {
        if !claim.store.is_current(Service::Xbox) || claim.created.elapsed() >= CLAIM_LIFETIME {
            return false;
        }
        let Some(remaining) = retry.budget.checked_sub(started.elapsed()) else {
            return false;
        };
        let response = client
            .post(format!("{}/api/xbox/import/login", claim.origin))
            .timeout(remaining.min(Duration::from_secs(10)))
            .json(&serde_json::json!({ "attemptId": attempt_id, "claim": claim.secret }))
            .send()
            .await;
        if let Ok(response) = response {
            let status = response.status();
            if status.is_success() {
                if let Ok(login) = response.json::<ClaimedLogin>().await {
                    if !valid_token(&login.refresh_token) {
                        return false;
                    }
                    let mut kept = KeptLogin::new(login.refresh_token, login.gamertag);
                    kept.origin = Some(claim.origin.clone());
                    // No await between receiving a usable token and saving.
                    // Store::save also atomically checks sign-out generations.
                    return claim.store.save(Service::Xbox, &kept).is_ok();
                }
            } else if !retryable_claim_status(status) {
                return false;
            }
        }
        let Some(remaining) = retry.budget.checked_sub(started.elapsed()) else {
            return false;
        };
        tokio::time::sleep(retry.delay.min(remaining)).await;
    }
}

/// The import options the web UI may pass on. Anything else is refused.
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SyncOptions {
    #[serde(skip_serializing_if = "Option::is_none")]
    authentication_only: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    include_achievements: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    achievement_title_ids: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    language: Option<String>,
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(tag = "status")]
pub enum SyncStart {
    /// Poll the result as after a browser sign-in.
    #[serde(rename = "started")]
    Started {
        #[serde(rename = "attemptId")]
        attempt_id: String,
    },
    /// No saved sign-in, or Microsoft confirmed it expired: sign in.
    #[serde(rename = "signedOut")]
    SignedOut,
    #[serde(rename = "busy")]
    Busy {
        #[serde(rename = "retryAfterSeconds")]
        retry_after_seconds: u64,
    },
    #[serde(rename = "unavailable")]
    Unavailable {
        #[serde(rename = "httpStatus")]
        http_status: Option<u16>,
    },
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SyncAnswer {
    attempt_id: String,
    refresh_token: String,
}

#[derive(Deserialize)]
struct SyncError {
    error: String,
}

fn is_expired_login(status: reqwest::StatusCode, error: &str) -> bool {
    status == reqwest::StatusCode::UNAUTHORIZED && error == "login_expired"
}

/// Validate and renew an existing Microsoft session without browser UI or a
/// game import. The shared lock also protects foreground renewals and claims.
pub(super) async fn check_saved_login(app: &AppHandle, api_endpoint: &str) -> LoginStatus {
    if !cfg!(windows) {
        return LoginStatus::SignedOut;
    }
    let Ok(_guard) = SYNCING.try_lock() else {
        return LoginStatus::Busy;
    };
    let Ok(store) = Store::of(app) else {
        return LoginStatus::Unavailable;
    };
    let Some(client) = client() else {
        return LoginStatus::Unavailable;
    };
    check_saved_login_with_client(&store, api_endpoint, &client).await
}

async fn check_saved_login_with_client(
    store: &Store,
    api_endpoint: &str,
    client: &reqwest::Client,
) -> LoginStatus {
    let login = match store.try_load(Service::Xbox) {
        Ok(Some(login)) => login,
        Ok(None) => return LoginStatus::SignedOut,
        Err(_) => return LoginStatus::Unavailable,
    };
    let Some(origin) =
        trusted_origin(api_endpoint).filter(|origin| login.origin.as_ref() == Some(origin))
    else {
        // A development endpoint switch says nothing about the saved account.
        return LoginStatus::Unavailable;
    };
    let response = match client
        .post(format!("{origin}/api/xbox/import/sync"))
        .json(&serde_json::json!({
            "refreshToken": login.secret,
            "authenticationOnly": true,
        }))
        .send()
        .await
    {
        Ok(response) => response,
        Err(_) => return LoginStatus::Unavailable,
    };
    let status = response.status();
    if status == reqwest::StatusCode::UNAUTHORIZED {
        let expired = response
            .json::<SyncError>()
            .await
            .is_ok_and(|error| is_expired_login(status, &error.error));
        return if !store.is_current(Service::Xbox) {
            LoginStatus::SignedOut
        } else if expired {
            // Keep the record so the account screen can offer reauthentication.
            LoginStatus::NeedsSignIn
        } else {
            LoginStatus::Unavailable
        };
    }
    if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
        return LoginStatus::Busy;
    }
    if !status.is_success() {
        // In particular, an older server rejecting authenticationOnly must not
        // turn a background check into a full import or interactive sign-in.
        return LoginStatus::Unavailable;
    }
    let Ok(answer) = response.json::<SyncAnswer>().await else {
        return LoginStatus::Unavailable;
    };
    let valid_attempt = valid_hex(&answer.attempt_id, 48);
    let result = if !store.is_current(Service::Xbox) {
        LoginStatus::SignedOut
    } else if !valid_attempt || !valid_token(&answer.refresh_token) {
        LoginStatus::Unavailable
    } else {
        let mut renewed = KeptLogin::new(answer.refresh_token, login.name);
        renewed.origin = login.origin;
        if store.save(Service::Xbox, &renewed).is_ok() {
            LoginStatus::Valid
        } else {
            LoginStatus::Unavailable
        }
    };
    if valid_attempt {
        // /sync returns after renewing Microsoft authentication. We need no
        // ongoing Xbox title work, even if storing the result failed locally.
        let _ = client
            .post(format!("{origin}/api/xbox/import/cancel"))
            .timeout(Duration::from_secs(3))
            .json(&serde_json::json!({ "attemptId": answer.attempt_id }))
            .send()
            .await;
    }
    if store.is_current(Service::Xbox) {
        result
    } else {
        LoginStatus::SignedOut
    }
}

/// Starts an import with the kept sign-in, without a browser.
#[tauri::command]
pub async fn xbox_login_sync_start(
    app: AppHandle,
    window: WebviewWindow,
    api_endpoint: String,
    options: SyncOptions,
) -> SyncStart {
    if window.label() != "main" {
        return SyncStart::SignedOut;
    }
    let Ok(store) = Store::of(&app) else {
        return SyncStart::Unavailable { http_status: None };
    };
    let _guard = SYNCING.lock().await;
    let login = match store.try_load(Service::Xbox) {
        Ok(Some(login)) => login,
        Ok(None) => return SyncStart::SignedOut,
        Err(_) => return SyncStart::Unavailable { http_status: None },
    };
    // Kept for another server (a development switch): leave it alone.
    let Some(origin) =
        trusted_origin(&api_endpoint).filter(|origin| login.origin.as_ref() == Some(origin))
    else {
        // An unavailable/different server does not mean Microsoft rejected
        // the saved login. Keep it and let the caller retry this connection.
        return SyncStart::Unavailable { http_status: None };
    };
    let Some(client) = client() else {
        return SyncStart::Unavailable { http_status: None };
    };
    let mut body = serde_json::to_value(&options).unwrap_or_default();
    body["refreshToken"] = login.secret.clone().into();
    let response = match client
        .post(format!("{origin}/api/xbox/import/sync"))
        .json(&body)
        .send()
        .await
    {
        Ok(response) => response,
        Err(_) => return SyncStart::Unavailable { http_status: None },
    };
    let status = response.status();
    if status == reqwest::StatusCode::UNAUTHORIZED {
        if response
            .json::<SyncError>()
            .await
            .is_ok_and(|error| is_expired_login(status, &error.error))
        {
            let _ = store.delete(Service::Xbox);
            return SyncStart::SignedOut;
        }
        return SyncStart::Unavailable {
            http_status: Some(status.as_u16()),
        };
    }
    if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
        let retry_after_seconds = response
            .headers()
            .get(reqwest::header::RETRY_AFTER)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.trim().parse::<u64>().ok())
            .unwrap_or(5)
            .clamp(1, 60);
        return SyncStart::Busy {
            retry_after_seconds,
        };
    }
    if !status.is_success() {
        return SyncStart::Unavailable {
            http_status: Some(status.as_u16()),
        };
    }
    let Ok(answer) = response.json::<SyncAnswer>().await else {
        return SyncStart::Unavailable { http_status: None };
    };
    if !valid_hex(&answer.attempt_id, 48)
        || !valid_token(&answer.refresh_token)
        || !store.is_current(Service::Xbox)
    {
        return SyncStart::Unavailable { http_status: None };
    }
    if answer.refresh_token != login.secret {
        let mut renewed = KeptLogin::new(answer.refresh_token, login.name.clone());
        renewed.origin = login.origin.clone();
        if store.save(Service::Xbox, &renewed).is_err() {
            return SyncStart::Unavailable { http_status: None };
        }
    }
    SyncStart::Started {
        attempt_id: answer.attempt_id,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(windows)]
    fn check_server(
        responses: Vec<(u16, String)>,
    ) -> (String, std::thread::JoinHandle<Vec<serde_json::Value>>) {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        let server = std::thread::spawn(move || {
            let mut bodies = Vec::new();
            for (index, (status, body)) in responses.into_iter().enumerate() {
                let (mut stream, _) = listener.accept().unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_secs(5)))
                    .unwrap();
                let mut request = Vec::new();
                let mut chunk = [0u8; 4096];
                loop {
                    let count = stream.read(&mut chunk).unwrap();
                    assert_ne!(count, 0);
                    request.extend_from_slice(&chunk[..count]);
                    if let Some(end) = request.windows(4).position(|part| part == b"\r\n\r\n") {
                        let headers = String::from_utf8_lossy(&request[..end]);
                        let length = headers
                            .lines()
                            .find_map(|line| {
                                let (name, value) = line.split_once(':')?;
                                name.eq_ignore_ascii_case("content-length")
                                    .then(|| value.trim().parse::<usize>().unwrap())
                            })
                            .unwrap();
                        if request.len() >= end + 4 + length {
                            let path = if index == 0 { "sync" } else { "cancel" };
                            assert!(headers
                                .starts_with(&format!("POST /api/xbox/import/{path} HTTP/1.1")));
                            bodies.push(
                                serde_json::from_slice(&request[end + 4..end + 4 + length])
                                    .unwrap(),
                            );
                            break;
                        }
                    }
                }
                write!(stream, "HTTP/1.1 {status} Test\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).unwrap();
            }
            bodies
        });
        (origin, server)
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn background_check_saves_rotated_token_and_cancels_the_lightweight_attempt() {
        let attempt = "a".repeat(48);
        let (origin, server) = check_server(vec![
            (
                200,
                serde_json::json!({"attemptId": attempt, "refreshToken": "rotated"}).to_string(),
            ),
            (200, "{}".into()),
        ]);
        let (store, dir) = Store::for_test();
        let mut previous = KeptLogin::new("previous".into(), Some("Player".into()));
        previous.origin = Some(origin.clone());
        store.save(Service::Xbox, &previous).unwrap();
        assert_eq!(
            check_saved_login_with_client(&store, &origin, &client().unwrap()).await,
            LoginStatus::Valid
        );
        let saved = store.load(Service::Xbox).unwrap();
        assert_eq!(saved.secret, "rotated");
        assert_eq!(saved.name.as_deref(), Some("Player"));
        let bodies = server.join().unwrap();
        assert_eq!(
            bodies,
            vec![
                serde_json::json!({"refreshToken": "previous", "authenticationOnly": true}),
                serde_json::json!({"attemptId": attempt}),
            ]
        );
        let _ = std::fs::remove_dir_all(dir);
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn background_checks_distinguish_expiry_from_errors_without_deleting_credentials() {
        for (status, body, expected) in [
            (
                401,
                r#"{"error":"login_expired"}"#,
                LoginStatus::NeedsSignIn,
            ),
            (401, r#"{"error":"proxy_denied"}"#, LoginStatus::Unavailable),
            (400, r#"{"error":"bad_request"}"#, LoginStatus::Unavailable),
            (502, r#"{"error":"unavailable"}"#, LoginStatus::Unavailable),
            (429, r#"{"error":"busy"}"#, LoginStatus::Busy),
        ] {
            let (origin, server) = check_server(vec![(status, body.into())]);
            let (store, dir) = Store::for_test();
            let mut previous = KeptLogin::new("previous".into(), None);
            previous.origin = Some(origin.clone());
            store.save(Service::Xbox, &previous).unwrap();
            assert_eq!(
                check_saved_login_with_client(&store, &origin, &client().unwrap()).await,
                expected
            );
            assert_eq!(store.load(Service::Xbox).unwrap().secret, "previous");
            assert_eq!(server.join().unwrap().len(), 1);
            let _ = std::fs::remove_dir_all(dir);
        }
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn background_check_never_reports_valid_when_rotated_token_cannot_be_saved() {
        let (origin, server) = check_server(vec![
            (
                200,
                serde_json::json!({"attemptId": "a".repeat(48), "refreshToken": "rotated"})
                    .to_string(),
            ),
            (200, "{}".into()),
        ]);
        let (store, dir) = Store::for_test();
        let mut previous = KeptLogin::new("previous".into(), None);
        previous.origin = Some(origin.clone());
        store.save(Service::Xbox, &previous).unwrap();
        std::fs::create_dir(dir.join("xbox.tmp")).unwrap();
        assert_eq!(
            check_saved_login_with_client(&store, &origin, &client().unwrap()).await,
            LoginStatus::Unavailable
        );
        assert_eq!(store.load(Service::Xbox).unwrap().secret, "previous");
        assert_eq!(server.join().unwrap().len(), 2);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[cfg(windows)]
    fn claim_server(responses: Vec<(u16, &'static str)>) -> (String, std::thread::JoinHandle<()>) {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        let server = std::thread::spawn(move || {
            for (status, body) in responses {
                let (mut stream, _) = listener.accept().unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_secs(5)))
                    .unwrap();
                let mut request = Vec::new();
                let mut chunk = [0u8; 4096];
                loop {
                    let count = stream.read(&mut chunk).unwrap();
                    assert_ne!(count, 0);
                    request.extend_from_slice(&chunk[..count]);
                    if let Some(end) = request.windows(4).position(|part| part == b"\r\n\r\n") {
                        let headers = String::from_utf8_lossy(&request[..end]);
                        let length = headers
                            .lines()
                            .find_map(|line| {
                                let (name, value) = line.split_once(':')?;
                                name.eq_ignore_ascii_case("content-length")
                                    .then(|| value.trim().parse::<usize>().unwrap())
                            })
                            .unwrap();
                        if request.len() >= end + 4 + length {
                            assert!(headers.starts_with("POST /api/xbox/import/login HTTP/1.1"));
                            let value: serde_json::Value =
                                serde_json::from_slice(&request[end + 4..end + 4 + length])
                                    .unwrap();
                            assert!(valid_hex(value["claim"].as_str().unwrap(), 64));
                            assert!(valid_hex(value["attemptId"].as_str().unwrap(), 48));
                            break;
                        }
                    }
                }
                // A dropped response models the callback completing while
                // its first single-use claim response is lost in transit.
                if status != 0 {
                    write!(
                        stream,
                        "HTTP/1.1 {status} Test\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                        body.len()
                    )
                    .unwrap();
                }
            }
        });
        (origin, server)
    }

    #[cfg(windows)]
    fn fast_claim_retry() -> ClaimRetry {
        ClaimRetry {
            budget: Duration::from_secs(5),
            delay: Duration::from_millis(5),
        }
    }

    fn claim() -> Claim {
        new_claim(PRODUCTION_ORIGIN.into(), Store::for_test().0).unwrap()
    }

    #[test]
    fn a_sign_in_only_goes_to_the_playcounter_server() {
        assert_eq!(
            trusted_origin("https://api.playcounter.app").as_deref(),
            Some(PRODUCTION_ORIGIN)
        );
        assert_eq!(
            trusted_origin("https://api.playcounter.app/").as_deref(),
            Some(PRODUCTION_ORIGIN)
        );
        for endpoint in [
            "http://api.playcounter.app",
            "https://api.playcounter.app.evil.test",
            "https://evil.test/https://api.playcounter.app",
            "https://user@api.playcounter.app",
            "https://api.playcounter.app/api",
            "https://api.playcounter.app?x=1",
            "https://api.playcounter.app:444",
            "https://playcounter.app",
            "not a url",
        ] {
            assert_eq!(trusted_origin(endpoint), None, "{endpoint}");
        }
        // Local servers only in development builds.
        assert_eq!(
            trusted_origin("http://localhost:3003").is_some(),
            cfg!(debug_assertions)
        );
        assert_eq!(trusted_origin("http://localhost.evil.test:3003"), None);
    }

    #[test]
    fn a_claim_hash_belongs_to_one_secret_and_is_taken_once() {
        let claim = claim();
        assert!(valid_hex(&claim.secret, 64));
        assert_eq!(claim.hash, sha256_hex(&claim.secret));
        assert_ne!(
            claim.hash,
            new_claim(PRODUCTION_ORIGIN.into(), Store::for_test().0)
                .unwrap()
                .hash
        );

        let hash = claim.hash.clone();
        let mut claims = Vec::new();
        remember(&mut claims, claim);
        assert!(take(&mut claims, &"0".repeat(64)).is_none());
        assert_eq!(take(&mut claims, &hash).unwrap().origin, PRODUCTION_ORIGIN);
        assert!(take(&mut claims, &hash).is_none());
    }

    #[test]
    fn open_claims_stay_few() {
        let mut claims = Vec::new();
        let first = claim();
        let first_hash = first.hash.clone();
        remember(&mut claims, first);
        for _ in 0..MAX_OPEN_CLAIMS {
            remember(&mut claims, claim());
        }
        assert_eq!(claims.len(), MAX_OPEN_CLAIMS);
        assert!(take(&mut claims, &first_hash).is_none());
    }

    #[test]
    fn the_web_ui_can_pass_import_options_but_nothing_else() {
        let options: SyncOptions = serde_json::from_str(
            r#"{"authenticationOnly":true,"includeAchievements":true,"achievementTitleIds":["42"],"language":"de-DE"}"#,
        )
        .unwrap();
        assert_eq!(
            serde_json::to_value(&options).unwrap(),
            serde_json::json!({"authenticationOnly":true,"includeAchievements":true,"achievementTitleIds":["42"],"language":"de-DE"})
        );
        assert!(serde_json::from_str::<SyncOptions>(r#"{"refreshToken":"x"}"#).is_err());
        assert_eq!(
            serde_json::to_value(&SyncOptions {
                authentication_only: None,
                include_achievements: None,
                achievement_title_ids: None,
                language: None
            })
            .unwrap(),
            serde_json::json!({})
        );
    }

    #[test]
    fn sync_answers_carry_no_token() {
        let text = serde_json::to_string(&SyncStart::Started {
            attempt_id: "a".repeat(48),
        })
        .unwrap();
        assert_eq!(
            text,
            format!(r#"{{"status":"started","attemptId":"{}"}}"#, "a".repeat(48))
        );
        assert_eq!(
            serde_json::to_string(&SyncStart::SignedOut).unwrap(),
            r#"{"status":"signedOut"}"#
        );
        assert_eq!(
            serde_json::to_string(&SyncStart::Busy {
                retry_after_seconds: 5
            })
            .unwrap(),
            r#"{"status":"busy","retryAfterSeconds":5}"#
        );
    }

    #[test]
    fn tokens_must_look_like_tokens() {
        assert!(valid_token("M.C5_BAY.0.U.-Cq!*$refresh"));
        for bad in ["", "has space", "line\nbreak", "ü"] {
            assert!(!valid_token(bad), "{bad}");
        }
        assert!(!valid_token(&"x".repeat(8193)));
    }

    #[test]
    fn only_confirmed_expiry_invalidates_a_saved_login() {
        assert!(is_expired_login(
            reqwest::StatusCode::UNAUTHORIZED,
            "login_expired"
        ));
        assert!(!is_expired_login(
            reqwest::StatusCode::UNAUTHORIZED,
            "unavailable"
        ));
        assert!(!is_expired_login(
            reqwest::StatusCode::BAD_GATEWAY,
            "login_expired"
        ));
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn a_pending_callback_and_lost_response_still_save_the_login() {
        let (origin, server) = claim_server(vec![
            (404, r#"{"error":"Not Found"}"#),
            (503, r#"{"error":"unavailable"}"#),
            (0, ""),
            (200, r#"{"refreshToken":"synthetic-refresh-token"}"#),
        ]);
        let (store, dir) = Store::for_test();
        let claim = new_claim(origin.clone(), store).unwrap();
        assert!(save_claim(&claim, &"a".repeat(48), fast_claim_retry()).await);
        let kept = claim.store.load(Service::Xbox).unwrap();
        assert_eq!(kept.secret, "synthetic-refresh-token");
        assert_eq!(kept.origin.as_deref(), Some(origin.as_str()));
        assert_eq!(kept.name, None);
        server.join().unwrap();
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn an_unsaved_claim_can_be_retried_but_a_saved_claim_is_consumed() {
        let (origin, server) = claim_server(vec![
            (400, r#"{"error":"bad request"}"#),
            (
                200,
                r#"{"refreshToken":"synthetic-refresh-token","gamertag":"Example"}"#,
            ),
        ]);
        let (store, dir) = Store::for_test();
        let claim = new_claim(origin, store).unwrap();
        let hash = claim.hash.clone();
        let claims = Mutex::new(vec![claim]);
        let attempt = "a".repeat(48);
        assert!(!keep_claim(&claims, &attempt, &hash, fast_claim_retry()).await);
        assert_eq!(claims.lock().unwrap().len(), 1);
        assert!(keep_claim(&claims, &attempt, &hash, fast_claim_retry()).await);
        assert!(claims.lock().unwrap().is_empty());
        assert!(!keep_claim(&claims, &attempt, &hash, fast_claim_retry()).await);
        server.join().unwrap();
        std::fs::remove_dir_all(dir).unwrap();
    }
}
