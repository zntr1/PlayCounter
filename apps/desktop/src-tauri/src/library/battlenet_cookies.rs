//! Native-only backup of Battle.net cookies for the DPAPI credential store.
//! WebView2 does not persist session cookies when its browser exits. Preserve
//! their session status and restore them before navigation instead of extending
//! any cookie's provider-issued expiry. No cookie data crosses the JS bridge.
use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::WebviewWindow;

const LOAD_ERROR: &str = "Could not open saved sign-ins.";
const SAVE_ERROR: &str = "Could not save the sign-in.";
const MAX_COOKIES: usize = 128;
const MAX_SNAPSHOT_BYTES: usize = 256 * 1024;
const MAX_VALUE_BYTES: usize = 16 * 1024;

// Match the login flow's Battle.net hosts exactly. Federated identity-provider
// cookies and unrelated Battle.net subdomains must never enter this store.
const COOKIE_DOMAINS: &[&str] = &[
    "battle.net",
    "account.battle.net",
    "oauth.battle.net",
    "eu.account.battle.net",
    "us.account.battle.net",
    "kr.account.battle.net",
    "eu.battle.net",
    "us.battle.net",
    "kr.battle.net",
    "tw.battle.net",
];

// Intentionally no Debug: these structures contain authentication secrets.
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Cookie {
    name: String,
    value: String,
    domain: String,
    path: String,
    /// None means a session cookie, restored with WebView2's expiry of -1.
    expires: Option<f64>,
    http_only: bool,
    secure: bool,
    same_site: i32,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Snapshot {
    version: u8,
    cookies: Vec<Cookie>,
}

fn now() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs_f64())
        .unwrap_or_default()
}

fn trusted_domain(domain: &str) -> bool {
    COOKIE_DOMAINS.contains(&domain.strip_prefix('.').unwrap_or(domain))
}

fn valid_text(value: &str, limit: usize) -> bool {
    value.len() <= limit && !value.chars().any(char::is_control)
}

impl Cookie {
    fn valid(&self) -> bool {
        trusted_domain(&self.domain)
            && !self.name.is_empty()
            && valid_text(&self.name, 256)
            && valid_text(&self.value, MAX_VALUE_BYTES)
            && self.path.starts_with('/')
            && valid_text(&self.path, 2048)
            && matches!(self.same_site, 0..=2)
            && self
                .expires
                .is_none_or(|value| value.is_finite() && value >= 0.0)
    }

    fn expired(&self, timestamp: f64) -> bool {
        self.expires.is_some_and(|expires| expires <= timestamp)
    }

    fn same_key(&self, other: &Self) -> bool {
        self.name == other.name && self.domain == other.domain && self.path == other.path
    }
}

fn encode(cookies: Vec<Cookie>, timestamp: f64) -> Result<String, String> {
    if cookies.len() > MAX_COOKIES || cookies.iter().any(|cookie| !cookie.valid()) {
        return Err(SAVE_ERROR.into());
    }
    let cookies: Vec<_> = cookies
        .into_iter()
        .filter(|cookie| !cookie.expired(timestamp))
        .collect();
    if cookies.is_empty() {
        return Err(SAVE_ERROR.into());
    }
    let encoded = serde_json::to_string(&Snapshot {
        version: 1,
        cookies,
    })
    .map_err(|_| SAVE_ERROR.to_owned())?;
    if encoded.len() > MAX_SNAPSHOT_BYTES {
        return Err(SAVE_ERROR.into());
    }
    Ok(encoded)
}

fn decode(saved: &str, timestamp: f64) -> Result<Vec<Cookie>, String> {
    // Earlier versions kept only a marker and relied on the browser profile.
    if saved.is_empty() {
        return Ok(Vec::new());
    }
    if saved.len() > MAX_SNAPSHOT_BYTES {
        return Err(LOAD_ERROR.into());
    }
    let snapshot: Snapshot = serde_json::from_str(saved).map_err(|_| LOAD_ERROR.to_owned())?;
    if snapshot.version != 1
        || snapshot.cookies.len() > MAX_COOKIES
        || snapshot.cookies.iter().any(|cookie| !cookie.valid())
    {
        return Err(LOAD_ERROR.into());
    }
    Ok(snapshot
        .cookies
        .into_iter()
        .filter(|cookie| !cookie.expired(timestamp))
        .collect())
}

fn missing_cookies(saved: Vec<Cookie>, current: &[Cookie], timestamp: f64) -> Vec<Cookie> {
    saved
        .into_iter()
        .filter(|cookie| !cookie.expired(timestamp))
        .filter(|cookie| !current.iter().any(|existing| existing.same_key(cookie)))
        .collect()
}

/// Capture only after the caller verified this dedicated profile and the
/// account's authenticated state. Save the returned string natively with DPAPI.
#[cfg(windows)]
pub(super) async fn capture(window: &WebviewWindow) -> Result<String, String> {
    encode(read_cookies(window).await?, now())
}

/// Restore into an already verified dedicated profile, before navigating it.
/// Cookies already present in that profile are newer than this backup and win.
#[cfg(windows)]
pub(super) async fn restore(window: &WebviewWindow, saved: &str) -> Result<(), String> {
    use tokio::sync::oneshot;
    use webview2_com::Microsoft::Web::WebView2::Win32::*;
    use windows_core::{Interface, HSTRING};

    let saved = decode(saved, now())?;
    if saved.is_empty() {
        return Ok(());
    }
    let current = read_cookies(window).await?;
    let missing = missing_cookies(saved, &current, now());
    if missing.is_empty() {
        return Ok(());
    }
    let (sender, receiver) = oneshot::channel();
    window
        .with_webview(move |platform| {
            let restore = || -> windows_core::Result<()> {
                unsafe {
                    let manager = platform
                        .controller()
                        .CoreWebView2()?
                        .cast::<ICoreWebView2_2>()?
                        .CookieManager()?;
                    for saved in missing {
                        if saved.expired(now()) {
                            continue;
                        }
                        let cookie = manager.CreateCookie(
                            &HSTRING::from(saved.name),
                            &HSTRING::from(saved.value),
                            &HSTRING::from(saved.domain),
                            &HSTRING::from(saved.path),
                        )?;
                        cookie.SetIsHttpOnly(saved.http_only)?;
                        cookie.SetIsSecure(saved.secure)?;
                        cookie.SetSameSite(COREWEBVIEW2_COOKIE_SAME_SITE_KIND(saved.same_site))?;
                        cookie.SetExpires(saved.expires.unwrap_or(-1.0))?;
                        manager.AddOrUpdateCookie(&cookie)?;
                    }
                    Ok(())
                }
            };
            let _ = sender.send(restore().is_ok());
        })
        .map_err(|_| LOAD_ERROR.to_owned())?;
    match tokio::time::timeout(std::time::Duration::from_secs(10), receiver).await {
        Ok(Ok(true)) => Ok(()),
        _ => Err(LOAD_ERROR.into()),
    }
}

#[cfg(windows)]
async fn read_cookies(window: &WebviewWindow) -> Result<Vec<Cookie>, String> {
    use std::sync::{Arc, Mutex};
    use tokio::sync::oneshot;
    use webview2_com::{GetCookiesCompletedHandler, Microsoft::Web::WebView2::Win32::*};
    use windows_core::{w, Interface};

    let (sender, receiver) = oneshot::channel();
    window
        .with_webview(move |platform| {
            let sender = Arc::new(Mutex::new(Some(sender)));
            let completed = sender.clone();
            let read = || -> windows_core::Result<()> {
                unsafe {
                    platform
                        .controller()
                        .CoreWebView2()?
                        .cast::<ICoreWebView2_2>()?
                        .CookieManager()?
                        .GetCookies(
                            w!(""),
                            &GetCookiesCompletedHandler::create(Box::new(move |result, list| {
                                let result = result
                                    .map_err(|_| ())
                                    .and_then(|_| list.ok_or(()))
                                    .and_then(|list| collect_cookies(&list).map_err(|_| ()));
                                if let Some(sender) =
                                    completed.lock().ok().and_then(|mut sender| sender.take())
                                {
                                    let _ = sender.send(result);
                                }
                                Ok(())
                            })),
                        )?;
                    Ok(())
                }
            };
            if read().is_err() {
                if let Some(sender) = sender.lock().ok().and_then(|mut sender| sender.take()) {
                    let _ = sender.send(Err(()));
                }
            }
        })
        .map_err(|_| LOAD_ERROR.to_owned())?;
    match tokio::time::timeout(std::time::Duration::from_secs(10), receiver).await {
        Ok(Ok(Ok(cookies))) => Ok(cookies),
        _ => Err(LOAD_ERROR.into()),
    }
}

#[cfg(windows)]
unsafe fn collect_cookies(
    list: &webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2CookieList,
) -> windows_core::Result<Vec<Cookie>> {
    use webview2_com::{take_pwstr, Microsoft::Web::WebView2::Win32::*};
    use windows_core::PWSTR;

    let invalid = || windows_core::Error::from_hresult(windows_core::HRESULT(0x80004005u32 as i32));
    let mut count = 0;
    list.Count(&mut count)?;
    if count > 4096 {
        return Err(invalid());
    }
    let mut cookies = Vec::new();
    for index in 0..count {
        let cookie = list.GetValueAtIndex(index)?;
        let mut domain = PWSTR::null();
        cookie.Domain(&mut domain)?;
        let domain = take_pwstr(domain).to_ascii_lowercase();
        if !trusted_domain(&domain) {
            continue;
        }
        let mut name = PWSTR::null();
        cookie.Name(&mut name)?;
        let name = take_pwstr(name);
        let mut value = PWSTR::null();
        cookie.Value(&mut value)?;
        let value = take_pwstr(value);
        let mut path = PWSTR::null();
        cookie.Path(&mut path)?;
        let path = take_pwstr(path);
        let mut session = Default::default();
        cookie.IsSession(&mut session)?;
        let expires = if session.as_bool() {
            None
        } else {
            let mut expires = 0.0;
            cookie.Expires(&mut expires)?;
            Some(expires)
        };
        let mut http_only = Default::default();
        cookie.IsHttpOnly(&mut http_only)?;
        let mut secure = Default::default();
        cookie.IsSecure(&mut secure)?;
        let mut same_site = COREWEBVIEW2_COOKIE_SAME_SITE_KIND::default();
        cookie.SameSite(&mut same_site)?;
        let cookie = Cookie {
            name,
            value,
            domain,
            path,
            expires,
            http_only: http_only.as_bool(),
            secure: secure.as_bool(),
            same_site: same_site.0,
        };
        if !cookie.valid() || cookies.len() >= MAX_COOKIES {
            return Err(invalid());
        }
        cookies.push(cookie);
    }
    Ok(cookies)
}

#[cfg(not(windows))]
pub(super) async fn capture(_: &WebviewWindow) -> Result<String, String> {
    Err(SAVE_ERROR.into())
}

#[cfg(not(windows))]
pub(super) async fn restore(_: &WebviewWindow, saved: &str) -> Result<(), String> {
    if saved.is_empty() {
        Ok(())
    } else {
        Err(LOAD_ERROR.into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn session_cookie() -> Cookie {
        Cookie {
            name: "synthetic-session".into(),
            value: "SYNTHETIC-SECRET".into(),
            domain: ".battle.net".into(),
            path: "/".into(),
            expires: None,
            http_only: true,
            secure: true,
            same_site: 1,
        }
    }

    #[test]
    fn session_status_and_security_attributes_survive_serialization() {
        let encoded = encode(vec![session_cookie()], 100.0).unwrap();
        let decoded = decode(&encoded, 10_000_000.0).unwrap();
        assert_eq!(decoded.len(), 1);
        assert_eq!(decoded[0].expires, None);
        assert_eq!(decoded[0].value, "SYNTHETIC-SECRET");
        assert!(decoded[0].http_only && decoded[0].secure);
        assert_eq!(decoded[0].same_site, 1);
        assert_eq!(decoded[0].domain, ".battle.net");
        assert_eq!(decoded[0].path, "/");
    }

    #[test]
    fn persistent_expiry_is_preserved_and_never_extended() {
        let mut cookie = session_cookie();
        cookie.expires = Some(500.0);
        let encoded = encode(vec![cookie], 100.0).unwrap();
        assert_eq!(decode(&encoded, 499.0).unwrap()[0].expires, Some(500.0));
        assert!(decode(&encoded, 500.0).unwrap().is_empty());
        assert!(encode(decode(&encoded, 499.0).unwrap(), 501.0).is_err());
    }

    #[test]
    fn only_exact_battle_net_cookie_domains_are_accepted() {
        for domain in COOKIE_DOMAINS {
            assert!(trusted_domain(domain));
            assert!(trusted_domain(&format!(".{domain}")));
        }
        for domain in [
            "battle.net.evil.test",
            ".evil.battle.net",
            "accounts.google.com",
            ".battle.net/",
            "..battle.net",
            "user@battle.net",
            "battle.net:443",
        ] {
            assert!(!trusted_domain(domain), "{domain}");
            let mut cookie = session_cookie();
            cookie.domain = domain.into();
            assert!(encode(vec![cookie], 100.0).is_err());
        }
    }

    #[test]
    fn newer_profile_cookies_win_and_unrelated_paths_are_not_overwritten() {
        let saved = session_cookie();
        let mut newer = saved.clone();
        newer.value = "NEW-SYNTHETIC-SECRET".into();
        assert!(missing_cookies(vec![saved.clone()], &[newer], 100.0).is_empty());
        let mut other_path = saved.clone();
        other_path.path = "/other".into();
        assert_eq!(missing_cookies(vec![saved], &[other_path], 100.0).len(), 1);
    }

    #[test]
    fn legacy_marker_is_accepted_but_invalid_or_oversized_backups_are_not() {
        assert!(decode("", 100.0).unwrap().is_empty());
        assert!(encode(Vec::new(), 100.0).is_err());
        assert!(decode("{}", 100.0).is_err());
        assert!(decode(r#"{"version":2,"cookies":[]}"#, 100.0).is_err());
        assert!(decode(&"x".repeat(MAX_SNAPSHOT_BYTES + 1), 100.0).is_err());
        assert!(encode(vec![session_cookie(); MAX_COOKIES + 1], 100.0).is_err());
        let mut cookie = session_cookie();
        cookie.value = "x".repeat(MAX_VALUE_BYTES + 1);
        assert!(encode(vec![cookie], 100.0).is_err());
        let mut cookie = session_cookie();
        cookie.expires = Some(f64::INFINITY);
        assert!(encode(vec![cookie], 100.0).is_err());
    }
}
