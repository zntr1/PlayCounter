//! Native renewal checks using synthetic HTTPS responses and isolated profiles.
//! Every web request is intercepted; no credentials or real account data are used.
#![cfg(windows)]

include!("support/battlenet_modules.rs");
#[path = "../src/webview_args.rs"]
mod webview_args;

use battlenet_account::{interactive_login_page, read_library, secure_window, ExpectedProfile};
use std::{
    sync::{
        atomic::{AtomicU64, AtomicUsize, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tauri::{webview::PageLoadEvent, WebviewUrl, WebviewWindow};
use tokio::sync::oneshot;
use webview2_com::{
    GetCookiesCompletedHandler, Microsoft::Web::WebView2::Win32::*,
    WebResourceRequestedEventHandler,
};
use windows_core::{w, Interface, HSTRING};

const AUTH: &str = "https://account.battle.net/oauth2/authorization/account-settings";

unsafe fn response(
    environment: &ICoreWebView2Environment,
    status: i32,
    headers: &str,
    body: &str,
) -> windows_core::Result<ICoreWebView2WebResourceResponse> {
    // The app's windows crate and WebView2 use different windows-core versions.
    // IStream's COM ABI is identical; pass it across that version boundary via
    // the native vtable while the owning stream remains alive.
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

async fn install_fixture(window: &WebviewWindow, recover: bool) -> Arc<AtomicUsize> {
    let navigations = Arc::new(AtomicUsize::new(0));
    let attempts = navigations.clone();
    let (sender, receiver) = oneshot::channel();
    window.with_webview(move |platform| unsafe {
        let view = platform.controller().CoreWebView2().unwrap();
        let environment = platform.environment();
        view.AddWebResourceRequestedFilter(w!("*"), COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL).unwrap();
        let mut token = 0;
        view.add_WebResourceRequested(
            &WebResourceRequestedEventHandler::create(Box::new(move |_, args| {
                let args = args.unwrap();
                let request = args.Request()?;
                let mut uri = windows_core::PWSTR::null();
                request.Uri(&mut uri)?;
                let url = tauri::Url::parse(&webview2_com::take_pwstr(uri)).unwrap();
                let (status, headers, body) = match (url.host_str(), url.path()) {
                    (Some("account.battle.net"), "/oauth2/authorization/account-settings") => {
                        attempts.fetch_add(1, Ordering::SeqCst);
                        (302, "Location: https://account.battle.net/overview\r\nCache-Control: no-store", "")
                    }
                    (Some("account.battle.net"), "/overview") =>
                        (200, "Content-Type: text/html\r\nCache-Control: no-store", "<!doctype html><title>Account fixture</title><body>Account fixture</body>"),
                    (Some("account.battle.net"), "/api/") =>
                        (200, "Content-Type: application/json\r\nCache-Control: no-store", "{\"authenticated\":true}"),
                    (Some("account.battle.net"), "/api/games-and-subs") if recover && attempts.load(Ordering::SeqCst) >= 2 =>
                        (200, "Content-Type: application/json\r\nCache-Control: no-store", "{\"gameAccounts\":[{\"titleId\":17459,\"localizedGameName\":\"Diablo III\"}]}"),
                    (Some("account.battle.net"), "/api/games-and-subs") =>
                        (403, "Content-Type: application/json\r\nCache-Control: no-store", "{\"error\":\"temporary challenge\"}"),
                    (Some("account.battle.net"), "/api/classic-games") =>
                        (200, "Content-Type: application/json\r\nCache-Control: no-store", "{\"classicGames\":[]}"),
                    _ => (404, "Content-Type: text/plain", "Fixture blocked request"),
                };
                args.SetResponse(&response(&environment, status, headers, body)?)?;
                Ok(())
            })),
            &mut token,
        ).unwrap();
        let manager = view.cast::<ICoreWebView2_2>().unwrap().CookieManager().unwrap();
        let cookie = manager.CreateCookie(w!("login-fixture"), w!("synthetic"), w!("account.battle.net"), w!("/")).unwrap();
        cookie.SetIsSecure(true).unwrap();
        cookie.SetIsHttpOnly(true).unwrap();
        manager.AddOrUpdateCookie(&cookie).unwrap();
        sender.send(()).unwrap();
    }).unwrap();
    tokio::time::timeout(Duration::from_secs(5), receiver)
        .await
        .unwrap()
        .unwrap();
    navigations
}

async fn cookie_count(window: &WebviewWindow) -> u32 {
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
                        result?;
                        let mut count = 0;
                        list.unwrap().Count(&mut count)?;
                        sender.lock().unwrap().take().unwrap().send(count).unwrap();
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
}

#[test]
#[ignore = "requires installed WebView2; isolated synthetic HTTPS responses only"]
fn renews_once_without_revealing_redirects_or_erasing_cookies() {
    let mut context = tauri::generate_context!();
    context.config_mut().app.windows.clear();
    context.config_mut().identifier =
        format!("app.playcounter.renewal-fixture-{}", uuid::Uuid::new_v4());
    let directory = std::env::temp_dir().join(format!(
        "playcounter-renewal-fixture-{}",
        uuid::Uuid::new_v4()
    ));
    let (sender, receiver) = std::sync::mpsc::channel();
    let app = tauri::Builder::default()
        .any_thread()
        .setup(move |app| {
            let mut scenarios = Vec::new();
            for recover in [true, false] {
                let profile = directory.join(if recover { "recover" } else { "fail" });
                let completed = Arc::new(AtomicU64::new(0));
                let pages = completed.clone();
                let window = tauri::WebviewWindowBuilder::new(
                    app,
                    if recover { "recover" } else { "fail" },
                    WebviewUrl::External("about:blank".parse().unwrap()),
                )
                .visible(false)
                .data_directory(profile.clone())
                .on_page_load(move |window, payload| {
                    if payload.event() == PageLoadEvent::Finished {
                        if payload.url().as_str() == "https://account.battle.net/overview" {
                            pages.fetch_add(1, Ordering::SeqCst);
                        }
                        if interactive_login_page(payload.url()) {
                            window.show().unwrap();
                        }
                    }
                })
                .build()?;
                scenarios.push((window, profile, completed, recover));
            }
            let handle = app.handle().clone();
            let check = tauri::async_runtime::spawn(async move {
                for (window, profile, completed, recover) in scenarios {
                    secure_window(&window, ExpectedProfile::Dedicated(profile), true)
                        .await
                        .unwrap();
                    let attempts = install_fixture(&window, recover).await;
                    window.navigate(AUTH.parse().unwrap()).unwrap();
                    let result = tokio::time::timeout(
                        Duration::from_secs(25),
                        read_library(&window, &completed),
                    )
                    .await
                    .unwrap();
                    assert_eq!(
                        attempts.load(Ordering::SeqCst),
                        2,
                        "Exactly one renewal must follow the original authorization"
                    );
                    if recover {
                        let result = serde_json::to_value(result.unwrap()).unwrap();
                        assert_eq!(result["games"][0]["name"], "Diablo III");
                    } else {
                        assert!(result
                            .unwrap_err()
                            .contains("could not provide your game list"));
                    }
                    assert!(
                        !window.is_visible().unwrap(),
                        "Ordinary redirects and API reads must stay hidden"
                    );
                    assert_eq!(
                        cookie_count(&window).await,
                        1,
                        "Renewal failures must preserve the saved login cookie"
                    );
                    window.destroy().unwrap();
                }
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
