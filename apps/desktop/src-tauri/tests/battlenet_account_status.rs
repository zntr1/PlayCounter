//! Hidden status checks with synthetic HTTPS responses and isolated cookies.
#![cfg(windows)]

include!("support/battlenet_modules.rs");
#[path = "../src/webview_args.rs"]
mod webview_args;

use battlenet_account::{build_silent_window, run_silent_session, AccountState, ExpectedProfile};
use kept_logins::{KeptLogin, Service, Store};
use login_status::LoginStatus;
use std::{
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc,
    },
    time::Duration,
};
use tauri::{Manager, WebviewUrl, WebviewWindow};
use tokio::sync::oneshot;
use webview2_com::{Microsoft::Web::WebView2::Win32::*, WebResourceRequestedEventHandler};
use windows_core::{w, Interface, HSTRING};

#[derive(Clone, Copy)]
enum Mode {
    Valid,
    Renew,
    Login,
    LoginUnavailable,
    LoginMaintenance,
    Challenge,
    Unavailable,
    Expired,
    Pending,
}

fn saved_login() -> KeptLogin {
    KeptLogin::new(
        serde_json::json!({
            "version": 1,
            "cookies": [{
                "name": "session-fixture", "value": "before", "domain": "account.battle.net",
                "path": "/", "expires": null, "http_only": true, "secure": true, "same_site": 1,
            }],
        })
        .to_string(),
        None,
    )
}

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

async fn install_fixture(window: &WebviewWindow, mode: Mode) -> Arc<AtomicUsize> {
    let navigations = Arc::new(AtomicUsize::new(0));
    let requests = navigations.clone();
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
                (Some("account.battle.net"), "/oauth2/authorization/account-settings") => {
                    requests.fetch_add(1, Ordering::SeqCst);
                    let location = match mode {
                        Mode::Login | Mode::LoginUnavailable | Mode::LoginMaintenance => "Location: https://eu.account.battle.net/login/en-us/\r\nCache-Control: no-store",
                        Mode::Challenge => "Location: https://eu.account.battle.net/challenge\r\nCache-Control: no-store",
                        _ => "Location: https://account.battle.net/overview\r\nCache-Control: no-store",
                    };
                    (302, location, "")
                }
                (Some("eu.account.battle.net"), "/login/en-us/") => match mode {
                    Mode::LoginUnavailable => (503, "Content-Type: text/html\r\nCache-Control: no-store", "<!doctype html><body>Service unavailable</body>"),
                    Mode::LoginMaintenance => (200, "Content-Type: text/html\r\nCache-Control: no-store", "<!doctype html><body>Maintenance<input type=password hidden><input type=email placeholder='Updates'></body>"),
                    _ => (200, "Content-Type: text/html\r\nCache-Control: no-store", "<!doctype html><body><input type=password>Login fixture</body>"),
                },
                (Some("eu.account.battle.net"), "/challenge") =>
                    (200, "Content-Type: text/html\r\nCache-Control: no-store", "<!doctype html><body>Temporary challenge</body>"),
                (Some("account.battle.net"), "/overview") =>
                    (200, "Content-Type: text/html\r\nCache-Control: no-store", if matches!(mode, Mode::Pending) {
                        "<!doctype html><script>window.fetch=()=>new Promise(()=>{});</script><body>Pending fixture</body>"
                    } else { "<!doctype html><body>Account fixture</body>" }),
                (Some("account.battle.net"), "/api/") => match mode {
                    Mode::Unavailable => (503, "Content-Type: application/json", "{}"),
                    Mode::Expired => (401, "Content-Type: application/json", "{\"authenticated\":false}"),
                    Mode::Renew if requests.load(Ordering::SeqCst) < 2 =>
                        (403, "Content-Type: application/json", "{\"challenge\":true}"),
                    _ => {
                        let mut header = windows_core::PWSTR::null();
                        let authenticated = request.Headers()?.GetHeader(w!("Cookie"), &mut header).is_ok()
                            && webview2_com::take_pwstr(header).split(';').any(|cookie| cookie.trim() == "session-fixture=before");
                        if authenticated {
                            let renewed = manager.CreateCookie(w!("session-fixture"), w!("after"), w!("account.battle.net"), w!("/"))?;
                            renewed.SetIsHttpOnly(true)?;
                            renewed.SetIsSecure(true)?;
                            renewed.SetSameSite(COREWEBVIEW2_COOKIE_SAME_SITE_KIND_LAX)?;
                            renewed.SetExpires(-1.0)?;
                            manager.AddOrUpdateCookie(&renewed)?;
                            (200, "Content-Type: application/json", "{\"authenticated\":true}")
                        } else {
                            (401, "Content-Type: application/json", "{\"authenticated\":false}")
                        }
                    }
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
    navigations
}

#[test]
#[ignore = "requires installed WebView2; synthetic HTTPS responses and isolated profile only"]
fn silent_checks_never_reveal_login_or_challenges_and_preserve_saved_cookies() {
    let mut context = tauri::generate_context!();
    context.config_mut().app.windows.clear();
    context.config_mut().identifier =
        format!("app.playcounter.status-fixture-{}", uuid::Uuid::new_v4());
    let (sender, receiver) = std::sync::mpsc::channel();
    let app = tauri::Builder::default()
        .any_thread()
        .manage(AccountState::default())
        .setup(move |app| {
            tauri::WebviewWindowBuilder::new(
                app,
                "main",
                WebviewUrl::External("about:blank".parse().unwrap()),
            )
            .visible(false)
            .focused(false)
            .build()?;
            let handle = app.handle().clone();
            let run = handle.clone();
            let check = tauri::async_runtime::spawn(async move {
                assert_eq!(
                    battlenet_account::check_saved_login(&run).await,
                    LoginStatus::SignedOut
                );
                let root = run.path().app_local_data_dir().unwrap();
                assert!(root
                    .to_string_lossy()
                    .contains("app.playcounter.status-fixture-"));
                for (index, (mode, expected)) in [
                    (Mode::Valid, LoginStatus::Valid),
                    (Mode::Renew, LoginStatus::Valid),
                    (Mode::Login, LoginStatus::NeedsSignIn),
                    (Mode::LoginUnavailable, LoginStatus::Unavailable),
                    (Mode::LoginMaintenance, LoginStatus::Unavailable),
                    (Mode::Challenge, LoginStatus::Unavailable),
                    (Mode::Unavailable, LoginStatus::Unavailable),
                    (Mode::Expired, LoginStatus::NeedsSignIn),
                ]
                .into_iter()
                .enumerate()
                {
                    let store = Store::of(&run).unwrap();
                    let before = saved_login();
                    store.save(Service::BattleNet, &before).unwrap();
                    let profile = root.join(format!("profile-{index}"));
                    let (window, pages, rejected) =
                        build_silent_window(&run, &format!("case-{index}"), profile.clone())
                            .unwrap();
                    let focused = Arc::new(AtomicBool::new(false));
                    let focus_event = focused.clone();
                    window.on_window_event(move |event| {
                        if matches!(event, tauri::WindowEvent::Focused(true)) {
                            focus_event.store(true, Ordering::SeqCst);
                        }
                    });
                    let navigations = install_fixture(&window, mode).await;
                    let inspect = window.clone();
                    let (_cancel, cancelled) = oneshot::channel();
                    let mut task = tauri::async_runtime::spawn(async move {
                        run_silent_session(
                            &window,
                            &store,
                            ExpectedProfile::Dedicated(profile),
                            &pages,
                            cancelled,
                            rejected,
                        )
                        .await
                    });
                    let actual = loop {
                        tokio::select! {
                            result = &mut task => break result.unwrap().unwrap(),
                            _ = tokio::time::sleep(Duration::from_millis(10)) => {
                                assert!(!inspect.is_visible().unwrap_or(false), "A silent check must never show its webview");
                            }
                        }
                    };
                    assert_eq!(actual, expected);
                    assert!(
                        !focused.load(Ordering::SeqCst),
                        "A silent check must never take focus"
                    );
                    let saved = Store::of(&run).unwrap().load(Service::BattleNet).unwrap();
                    if expected == LoginStatus::Valid {
                        let snapshot: serde_json::Value =
                            serde_json::from_str(&saved.secret).unwrap();
                        assert_eq!(
                            snapshot["cookies"][0]["value"], "after",
                            "Successful checks must save cookie rotation"
                        );
                    } else {
                        assert_eq!(
                            saved.secret, before.secret,
                            "Temporary errors and expiry do not erase saved cookies"
                        );
                    }
                    if matches!(mode, Mode::Renew | Mode::Expired) {
                        assert_eq!(
                            navigations.load(Ordering::SeqCst),
                            2,
                            "Only one OAuth retry is permitted"
                        );
                    }
                }

                let store = Store::of(&run).unwrap();
                store.save(Service::BattleNet, &saved_login()).unwrap();
                let profile = root.join("signout-profile");
                let (window, pages, rejected) =
                    build_silent_window(&run, "signout", profile.clone()).unwrap();
                let navigations = install_fixture(&window, Mode::Pending).await;
                let inspect = window.clone();
                let (cancel, cancelled) = oneshot::channel();
                let task = tauri::async_runtime::spawn(async move {
                    run_silent_session(
                        &window,
                        &store,
                        ExpectedProfile::Dedicated(profile),
                        &pages,
                        cancelled,
                        rejected,
                    )
                    .await
                });
                tokio::time::timeout(Duration::from_secs(5), async {
                    while navigations.load(Ordering::SeqCst) == 0 {
                        tokio::time::sleep(Duration::from_millis(10)).await;
                    }
                })
                .await
                .unwrap();
                assert!(!inspect.is_visible().unwrap());
                kept_logins::sign_out(&run, Service::BattleNet)
                    .await
                    .unwrap();
                cancel.send(()).unwrap();
                assert_eq!(task.await.unwrap().unwrap(), LoginStatus::SignedOut);
                assert!(Store::of(&run).unwrap().load(Service::BattleNet).is_none());
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
