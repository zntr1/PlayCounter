//! Keeps the Microsoft sign-in of an Xbox import. The web UI still runs the
//! import against the PlayCounter server, but never sees the sign-in: it asks
//! this part for a claim hash, the server keeps the refresh token for the
//! holder of the claim secret, and this part claims and stores it. A kept
//! sign-in only ever goes back to the PlayCounter server it came from.
use super::kept_logins::{KeptLogin, Service, Store};
use serde::{Deserialize, Serialize};
use std::{
    sync::Mutex,
    time::{Duration, Instant},
};
use tauri::{AppHandle, WebviewWindow};

const PRODUCTION_ORIGIN: &str = "https://api.playcounter.app";
const CLAIM_LIFETIME: Duration = Duration::from_secs(15 * 60);
const MAX_OPEN_CLAIMS: usize = 8;

struct Claim {
    hash: String,
    secret: String,
    origin: String,
    created: Instant,
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

fn new_claim(origin: String) -> Option<Claim> {
    let mut secret = [0u8; 32];
    ring::rand::SecureRandom::fill(&ring::rand::SystemRandom::new(), &mut secret).ok()?;
    let secret = hex(&secret);
    Some(Claim {
        hash: sha256_hex(&secret),
        secret,
        origin,
        created: Instant::now(),
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
pub fn xbox_login_claim_hash(window: WebviewWindow, api_endpoint: String) -> Option<String> {
    if window.label() != "main" || !cfg!(windows) {
        return None;
    }
    let claim = new_claim(trusted_origin(&api_endpoint)?)?;
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

/// After a finished import: claims the sign-in and keeps it. `false` when
/// there was nothing to keep.
#[tauri::command]
pub async fn xbox_login_keep(
    app: AppHandle,
    window: WebviewWindow,
    attempt_id: String,
    claim_hash: String,
) -> bool {
    if window.label() != "main" || !valid_hex(&attempt_id, 48) || !valid_hex(&claim_hash, 64) {
        return false;
    }
    let Some(claim) = CLAIMS
        .lock()
        .ok()
        .and_then(|mut claims| take(&mut claims, &claim_hash))
    else {
        return false;
    };
    let Some(client) = client() else {
        return false;
    };
    let response = client
        .post(format!("{}/api/xbox/import/login", claim.origin))
        .json(&serde_json::json!({ "attemptId": attempt_id, "claim": claim.secret }))
        .send()
        .await;
    let Ok(response) = response else {
        return false;
    };
    if !response.status().is_success() {
        return false;
    }
    let Ok(login) = response.json::<ClaimedLogin>().await else {
        return false;
    };
    if !valid_token(&login.refresh_token) {
        return false;
    }
    let _guard = SYNCING.lock().await;
    let mut kept = KeptLogin::new(login.refresh_token, login.gamertag);
    kept.origin = Some(claim.origin);
    Store::of(&app)
        .and_then(|store| store.save(Service::Xbox, &kept))
        .is_ok()
}

/// The import options the web UI may pass on. Anything else is refused.
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SyncOptions {
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
    /// Nothing kept for this server, or Microsoft refused it: sign in.
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
        return SyncStart::SignedOut;
    };
    let _guard = SYNCING.lock().await;
    let Some(login) = store.load(Service::Xbox) else {
        return SyncStart::SignedOut;
    };
    // Kept for another server (a development switch): leave it alone.
    let Some(origin) =
        trusted_origin(&api_endpoint).filter(|origin| login.origin.as_ref() == Some(origin))
    else {
        return SyncStart::SignedOut;
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
        let _ = store.delete(Service::Xbox);
        return SyncStart::SignedOut;
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
    if !valid_hex(&answer.attempt_id, 48) {
        return SyncStart::Unavailable { http_status: None };
    }
    if valid_token(&answer.refresh_token) && answer.refresh_token != login.secret {
        let mut renewed = KeptLogin::new(answer.refresh_token, login.name.clone());
        renewed.origin = login.origin.clone();
        let _ = store.save(Service::Xbox, &renewed);
    }
    SyncStart::Started {
        attempt_id: answer.attempt_id,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
        let claim = new_claim(PRODUCTION_ORIGIN.into()).unwrap();
        assert!(valid_hex(&claim.secret, 64));
        assert_eq!(claim.hash, sha256_hex(&claim.secret));
        assert_ne!(
            claim.hash,
            new_claim(PRODUCTION_ORIGIN.into()).unwrap().hash
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
        let first = new_claim(PRODUCTION_ORIGIN.into()).unwrap();
        let first_hash = first.hash.clone();
        remember(&mut claims, first);
        for _ in 0..MAX_OPEN_CLAIMS {
            remember(&mut claims, new_claim(PRODUCTION_ORIGIN.into()).unwrap());
        }
        assert_eq!(claims.len(), MAX_OPEN_CLAIMS);
        assert!(take(&mut claims, &first_hash).is_none());
    }

    #[test]
    fn the_web_ui_can_pass_import_options_but_nothing_else() {
        let options: SyncOptions = serde_json::from_str(
            r#"{"includeAchievements":true,"achievementTitleIds":["42"],"language":"de-DE"}"#,
        )
        .unwrap();
        assert_eq!(
            serde_json::to_value(&options).unwrap(),
            serde_json::json!({"includeAchievements":true,"achievementTitleIds":["42"],"language":"de-DE"})
        );
        assert!(serde_json::from_str::<SyncOptions>(r#"{"refreshToken":"x"}"#).is_err());
        assert_eq!(
            serde_json::to_value(&SyncOptions {
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
}
