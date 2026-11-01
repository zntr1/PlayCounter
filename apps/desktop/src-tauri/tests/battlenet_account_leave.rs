//! Native regression for leaving the accounts view after authentication.
//! Uses isolated profiles and synthetic HTTPS responses only.
#![cfg(windows)]

include!("support/battlenet_modules.rs");
#[path = "../src/webview_args.rs"]
mod webview_args;

use battlenet_account::{clear_profile_data, run_account_session, AccountState, ExpectedProfile};
use kept_logins::{KeptLogin, Service, Store};
use std::{
    path::Path,
    sync::{
        atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tauri::{webview::PageLoadEvent, AppHandle, Manager, WebviewUrl, WebviewWindow};
use tokio::sync::oneshot;
use webview2_com::{
    GetCookiesCompletedHandler, Microsoft::Web::WebView2::Win32::*,
    WebResourceRequestedEventHandler,
};
use windows_core::{w, Interface, HSTRING};

unsafe fn response(
    environment: &ICoreWebView2Environment,
    status: i32,
    headers: &str,
    body: &str,
) -> windows_core::Result<ICoreWebView2WebResourceResponse> {
    let stream = windows::Win32::UI::Shell::SHCreateMemStream(Some(body.as_bytes())).unwrap();
    let reason = HSTRING::from("Fixture");
    let headers = HSTRING::from(headers);
    let mut raw = std::ptr::null_mut();
    (environment.vtable().CreateWebResourceResponse)(
        environment.as_raw(),
        windows::core::Interface::as_raw(&stream),
        status,
        windows_core::PCWSTR(reason.as_ptr()),
        windows_core::PCWSTR(headers.as_ptr()),
        &mut raw,
    )
    .ok()?;
    Ok(ICoreWebView2WebResourceResponse::from_raw(raw))
}

async fn fixture_window(
    app: &AppHandle,
    label: &str,
    profile: &Path,
    seed_cookie: bool,
) -> (WebviewWindow, Arc<AtomicU64>, Arc<AtomicUsize>) {
    let completed = Arc::new(AtomicU64::new(0));
    let pages = completed.clone();
    let window = tauri::WebviewWindowBuilder::new(
        app,
        label,
        WebviewUrl::External("about:blank".parse().unwrap()),
    )
    .visible(false)
    .additional_browser_args(webview_args::WEBVIEW_BROWSER_ARGS)
    .data_directory(profile.to_path_buf())
    .on_page_load(move |_, event| {
        if event.event() == PageLoadEvent::Finished
            && event.url().as_str() == "https://account.battle.net/overview"
        {
            pages.fetch_add(1, Ordering::SeqCst);
        }
    })
    .build()
    .unwrap();
    let game_reads = Arc::new(AtomicUsize::new(0));
    let reads = game_reads.clone();
    let (sender, receiver) = oneshot::channel();
    window.with_webview(move |platform| unsafe {
        let view = platform.controller().CoreWebView2().unwrap();
        let manager = view.cast::<ICoreWebView2_2>().unwrap().CookieManager().unwrap();
        let environment = platform.environment();
        view.AddWebResourceRequestedFilter(w!("*"), COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL).unwrap();
        let mut token = 0;
        view.add_WebResourceRequested(&WebResourceRequestedEventHandler::create(Box::new(move |_, args| {
            let args = args.unwrap();
            let request = args.Request()?;
            let mut uri = windows_core::PWSTR::null();
            request.Uri(&mut uri)?;
            let url = tauri::Url::parse(&webview2_com::take_pwstr(uri)).unwrap();
            let (status, headers, body) = match (url.host_str(), url.path()) {
                (Some("account.battle.net"), "/oauth2/authorization/account-settings") => (302, "Location: https://account.battle.net/overview\r\nCache-Control: no-store", ""),
                (Some("account.battle.net"), "/overview") => {
                    if seed_cookie {
                        let cookie = manager.CreateCookie(w!("saved-login-fixture"), w!("synthetic"), w!("account.battle.net"), w!("/"))?;
                        cookie.SetIsSecure(true)?;
                        cookie.SetIsHttpOnly(true)?;
                        cookie.SetSameSite(COREWEBVIEW2_COOKIE_SAME_SITE_KIND_LAX)?;
                        cookie.SetExpires(-1.0)?;
                        let mut session = Default::default();
                        cookie.IsSession(&mut session)?;
                        assert!(session.as_bool(), "The regression must use a session-only cookie");
                        manager.AddOrUpdateCookie(&cookie)?;
                    }
                    // Hold the library read indefinitely, while allowing the
                    // independent authentication request to finish normally.
                    (200, "Content-Type: text/html\r\nCache-Control: no-store", r#"<!doctype html><script>
                    const nativeFetch = window.fetch.bind(window);
                    window.fetch = (url, options) => {
                      if (url === '/api/games-and-subs') {
                        void nativeFetch('/fixture/library-start');
                        return new Promise(() => {});
                      }
                      return nativeFetch(url, options);
                    };
                    </script><body>Authenticated fixture</body>"#)
                },
                (Some("account.battle.net"), "/api/") => {
                    // Authentication must depend on an actual browser cookie.
                    // Returning true unconditionally would let an empty marker
                    // pass this test after all session cookies were lost.
                    let mut raw = windows_core::PWSTR::null();
                    let authenticated = request.Headers()?.GetHeader(w!("Cookie"), &mut raw).is_ok()
                        && webview2_com::take_pwstr(raw).split(';').any(|cookie| cookie.trim() == "saved-login-fixture=synthetic");
                    if authenticated {
                        (200, "Content-Type: application/json\r\nCache-Control: no-store", "{\"authenticated\":true}")
                    } else {
                        (401, "Content-Type: application/json\r\nCache-Control: no-store", "{\"authenticated\":false}")
                    }
                },
                (Some("account.battle.net"), "/api/classic-games") => (200, "Content-Type: application/json", "{\"classicGames\":[]}"),
                (Some("account.battle.net"), "/fixture/library-start") => {
                    reads.fetch_add(1, Ordering::SeqCst);
                    (200, "Content-Type: text/plain", "Library request started")
                },
                _ => (404, "Content-Type: text/plain", "Fixture blocked request"),
            };
            args.SetResponse(&response(&environment, status, headers, body)?)?;
            Ok(())
        })), &mut token).unwrap();
        sender.send(()).unwrap();
    }).unwrap();
    tokio::time::timeout(Duration::from_secs(5), receiver)
        .await
        .unwrap()
        .unwrap();
    (window, completed, game_reads)
}

#[derive(Debug, PartialEq)]
struct CookieFlags {
    session: bool,
    http_only: bool,
    secure: bool,
    same_site: i32,
}

async fn cookie_flags(window: &WebviewWindow) -> Vec<CookieFlags> {
    let (sender, receiver) = oneshot::channel();
    window
        .with_webview(move |platform| unsafe {
            let manager = platform
                .controller()
                .CoreWebView2()
                .unwrap()
                .cast::<ICoreWebView2_2>()
                .unwrap()
                .CookieManager()
                .unwrap();
            let sender = Mutex::new(Some(sender));
            manager
                .GetCookies(
                    w!("https://account.battle.net/"),
                    &GetCookiesCompletedHandler::create(Box::new(move |result, list| {
                        let value = result
                            .and_then(|_| {
                                let mut count = 0;
                                let list = list.unwrap();
                                list.Count(&mut count)?;
                                let mut flags = Vec::new();
                                for index in 0..count {
                                    let cookie = list.GetValueAtIndex(index)?;
                                    let (mut session, mut http_only, mut secure) =
                                        Default::default();
                                    let mut same_site = COREWEBVIEW2_COOKIE_SAME_SITE_KIND_NONE;
                                    cookie.IsSession(&mut session)?;
                                    cookie.IsHttpOnly(&mut http_only)?;
                                    cookie.IsSecure(&mut secure)?;
                                    cookie.SameSite(&mut same_site)?;
                                    flags.push(CookieFlags {
                                        session: session.as_bool(),
                                        http_only: http_only.as_bool(),
                                        secure: secure.as_bool(),
                                        same_site: same_site.0,
                                    });
                                }
                                Ok(flags)
                            })
                            .map_err(|error| format!("{error:?}"));
                        sender.lock().unwrap().take().unwrap().send(value).unwrap();
                        Ok(())
                    })),
                )
                .unwrap();
        })
        .unwrap();
    tokio::time::timeout(Duration::from_secs(5), receiver)
        .await
        .unwrap()
        .unwrap()
        .unwrap()
}

#[test]
#[ignore = "requires installed WebView2; synthetic HTTPS responses and isolated profile only"]
fn switching_views_after_authentication_preserves_login_and_sign_out_still_clears_it() {
    let mut context = tauri::generate_context!();
    context.config_mut().app.windows.clear();
    context.config_mut().identifier =
        format!("app.playcounter.leave-fixture-{}", uuid::Uuid::new_v4());
    let (sender, receiver) = std::sync::mpsc::channel();
    let app = tauri::Builder::default()
        .any_thread()
        .manage(AccountState::default())
        .setup(move |app| {
            // The real app keeps its main window alive when an account popup
            // closes. Preserve that lifetime here while reopening the profile.
            tauri::WebviewWindowBuilder::new(
                app,
                "main",
                WebviewUrl::External("about:blank".parse().unwrap()),
            )
            .visible(false)
            .build()?;
            let handle = app.handle().clone();
            let run = handle.clone();
            let check = tauri::async_runtime::spawn(async move {
                let profile = run
                    .path()
                    .app_local_data_dir()
                    .unwrap()
                    .join("battlenet-profile");
                assert!(profile
                    .to_string_lossy()
                    .contains("app.playcounter.leave-fixture-"));
                let store = Store::of(&run).unwrap();
                assert!(store.load(Service::BattleNet).is_none());
                // Leave immediately when the authenticated page finishes,
                // before the next native polling tick observes authentication.
                let (window, completed, reads) =
                    fixture_window(&run, "fast-view-change", &profile, true).await;
                let finished = completed.clone();
                let (cancel, cancelled) = oneshot::channel();
                let (_reject, rejected) = oneshot::channel();
                let expected = ExpectedProfile::Dedicated(profile.clone());
                let task = tauri::async_runtime::spawn(async move {
                    run_account_session(&window, &store, expected, false, &completed, cancelled, rejected, true, &AtomicBool::new(true)).await
                });
                tokio::time::timeout(Duration::from_secs(10), async {
                    while finished.load(Ordering::SeqCst) == 0 { tokio::time::sleep(Duration::from_millis(1)).await; }
                }).await.unwrap();
                assert!(Store::of(&run).unwrap().load(Service::BattleNet).is_none(), "Fixture must cancel before the normal poll saves authentication");
                cancel.send(()).unwrap();
                assert!(tokio::time::timeout(Duration::from_secs(8), task).await.unwrap().unwrap().unwrap_err().contains("cancelled"));
                assert!(!Store::of(&run).unwrap().load(Service::BattleNet).unwrap().secret.is_empty(), "The bounded final check must save the session cookie, not only a connection marker");
                assert_eq!(reads.load(Ordering::SeqCst), 0);
                kept_logins::sign_out(&run, Service::BattleNet).await.unwrap();

                let store = Store::of(&run).unwrap();
                let (window, completed, reads) =
                    fixture_window(&run, "first-login", &profile, true).await;
                let (cancel, cancelled) = oneshot::channel();
                let (_reject, rejected) = oneshot::channel();
                let expected = ExpectedProfile::Dedicated(profile.clone());
                let task = tauri::async_runtime::spawn(async move {
                    run_account_session(
                        &window,
                        &store,
                        expected,
                        false,
                        &completed,
                        cancelled,
                        rejected,
                        false,
                        &AtomicBool::new(true),
                    )
                    .await
                });
                tokio::time::timeout(Duration::from_secs(15), async {
                    while reads.load(Ordering::SeqCst) == 0 {
                        tokio::time::sleep(Duration::from_millis(10)).await;
                    }
                })
                .await
                .unwrap();
                let saved = Store::of(&run).unwrap();
                let saved_secret = saved.load(Service::BattleNet).unwrap().secret;
                assert!(!saved_secret.is_empty(), "Authentication cookies must be saved before the unfinished library read");
                let snapshot: serde_json::Value = serde_json::from_str(&saved_secret).unwrap();
                assert!(snapshot["cookies"][0]["expires"].is_null(), "Saving must not extend a session cookie into a persistent browser cookie");
                assert_eq!(snapshot["cookies"][0]["secure"], true);
                assert_eq!(snapshot["cookies"][0]["http_only"], true);
                let encrypted = std::fs::read(saved.dir().join("battlenet.bin")).unwrap();
                assert!(!encrypted.windows(b"synthetic".len()).any(|bytes| bytes == b"synthetic"), "Cookie values must remain encrypted on disk");
                cancel.send(()).unwrap();
                assert!(tokio::time::timeout(Duration::from_secs(8), task)
                    .await
                    .unwrap()
                    .unwrap()
                    .unwrap_err()
                    .contains("cancelled"));
                assert!(
                    Store::of(&run).unwrap().load(Service::BattleNet).is_some(),
                    "Leaving the view must preserve the newly saved login"
                );

                // A marker alone must fail after the browser loses its session.
                // This control makes the previous implementation's defect
                // explicit instead of relying only on cookie-count assertions.
                let store = Store::of(&run).unwrap();
                let saved_login = store.load(Service::BattleNet).unwrap();
                store.save(Service::BattleNet, &KeptLogin::new(String::new(), None)).unwrap();
                let (window, completed, _) =
                    fixture_window(&run, "legacy-marker-without-session", &profile, false).await;
                clear_profile_data(&window, ExpectedProfile::Dedicated(profile.clone())).await.unwrap();
                let (_cancel, cancelled) = oneshot::channel();
                let (_reject, rejected) = oneshot::channel();
                let missing_session = tokio::time::timeout(
                    Duration::from_secs(10),
                    run_account_session(
                        &window,
                        &store,
                        ExpectedProfile::Dedicated(profile.clone()),
                        true,
                        &completed,
                        cancelled,
                        rejected,
                        true,
                        &AtomicBool::new(true),
                    ),
                ).await.unwrap();
                assert!(missing_session.unwrap_err().contains("expired"), "A connection marker is not proof of authentication");
                store.save(Service::BattleNet, &saved_login).unwrap();

                // Reopen after the original controller was destroyed. Clear
                // only this isolated profile to deterministically model the
                // session cookies lost when its browser process exits. The
                // encrypted native store must be sufficient to restore them.
                let (window, completed, reads) =
                    fixture_window(&run, "return-to-accounts", &profile, false).await;
                clear_profile_data(&window, ExpectedProfile::Dedicated(profile.clone())).await.unwrap();
                assert_eq!(
                    cookie_flags(&window).await.len(),
                    0,
                    "The reopened browser must start without the fixture session cookie"
                );
                let store = Store::of(&run).unwrap();
                let (_cancel, cancelled) = oneshot::channel();
                let (_reject, rejected) = oneshot::channel();
                tokio::time::timeout(
                    Duration::from_secs(10),
                    run_account_session(
                        &window,
                        &store,
                        ExpectedProfile::Dedicated(profile.clone()),
                        true,
                        &completed,
                        cancelled,
                        rejected,
                        true,
                        &AtomicBool::new(true),
                    ),
                )
                .await
                .unwrap()
                .unwrap();
                assert_eq!(
                    reads.load(Ordering::SeqCst),
                    0,
                    "Connecting an account must not start a library read"
                );

                // Explicit sign-out wins even when an authenticated import is active.
                let (window, completed, reads) =
                    fixture_window(&run, "explicit-sign-out", &profile, false).await;
                let inspect = window.clone();
                let store = Store::of(&run).unwrap();
                let (cancel, cancelled) = oneshot::channel();
                let (_reject, rejected) = oneshot::channel();
                let expected = ExpectedProfile::Dedicated(profile.clone());
                let task = tauri::async_runtime::spawn(async move {
                    run_account_session(
                        &window,
                        &store,
                        expected,
                        true,
                        &completed,
                        cancelled,
                        rejected,
                        false,
                        &AtomicBool::new(true),
                    )
                    .await
                });
                tokio::time::timeout(Duration::from_secs(15), async {
                    while reads.load(Ordering::SeqCst) == 0 {
                        tokio::time::sleep(Duration::from_millis(10)).await;
                    }
                })
                .await
                .unwrap();
                assert_eq!(cookie_flags(&inspect).await, vec![CookieFlags {
                    session: true,
                    http_only: true,
                    secure: true,
                    same_site: COREWEBVIEW2_COOKIE_SAME_SITE_KIND_LAX.0,
                }], "Restoring authentication must preserve session expiry and cookie security attributes");
                kept_logins::sign_out(&run, Service::BattleNet)
                    .await
                    .unwrap();
                cancel.send(()).unwrap();
                assert!(tokio::time::timeout(Duration::from_secs(8), task)
                    .await
                    .unwrap()
                    .unwrap()
                    .is_err());
                assert!(Store::of(&run).unwrap().load(Service::BattleNet).is_none());
                let (window, _, _) = fixture_window(&run, "after-sign-out", &profile, false).await;
                assert_eq!(
                    cookie_flags(&window).await.len(),
                    0,
                    "Explicit sign-out must clear cookies despite earlier authentication"
                );
                window.destroy().unwrap();
            });
            tauri::async_runtime::spawn(async move {
                let result = tokio::time::timeout(Duration::from_secs(60), check).await;
                sender.send(format!("{result:?}")).unwrap();
                handle.exit(0);
            });
            Ok(())
        })
        .build(context)
        .unwrap();
    app.run_return(|_, _| {});
    assert_eq!(
        receiver.recv_timeout(Duration::from_secs(5)).unwrap(),
        "Ok(Ok(()))"
    );
}
