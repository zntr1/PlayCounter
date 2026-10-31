//! Actual WebView2 redirect capture with synthetic responses only.
#![cfg(windows)]

#[allow(dead_code)]
#[path = "../src/library/battlenet_account.rs"]
mod battlenet_account;
#[allow(dead_code)]
#[path = "../src/library/battlenet_cookies.rs"]
mod battlenet_cookies;
#[allow(dead_code)]
#[path = "../src/library/epic_account.rs"]
mod epic_account;
#[allow(dead_code)]
#[path = "../src/library/kept_logins.rs"]
mod kept_logins;
#[path = "../src/webview_args.rs"]
mod webview_args;

// The account module's game-ID check is unrelated to this fixture. Include its
// small dependency here without bringing in installation scanning or launching.
mod epic {
    pub fn valid_id(value: &str) -> bool {
        !value.is_empty()
            && value.len() <= 64
            && value.as_bytes()[0].is_ascii_alphanumeric()
            && value
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
    }
}

use battlenet_account::{clear_profile_data, secure_window, ExpectedProfile};
use epic_account::{read_code_after_cancel, EpicAccountState};
use kept_logins::{KeptLogin, Service, Store};
use std::{sync::Mutex, time::Duration};
use tauri::{webview::PageLoadEvent, WebviewUrl};
use tokio::sync::oneshot;
use webview2_com::{Microsoft::Web::WebView2::Win32::*, WebResourceRequestedEventHandler};
use windows_core::{w, Interface, HSTRING};

const REDIRECT_URL: &str = "https://www.epicgames.com/id/api/redirect?clientId=34a02cf8f4414e29b15921876da36f9a&responseType=code";

#[test]
#[ignore = "requires installed WebView2; synthetic HTTPS responses and isolated profile only"]
fn leaving_after_the_redirect_loads_captures_the_code_but_explicit_signout_discards_it() {
    let mut context = tauri::generate_context!();
    context.config_mut().app.windows.clear();
    context.config_mut().identifier =
        format!("app.playcounter.epic-fixture-{}", uuid::Uuid::new_v4());
    let (send_result, results) = std::sync::mpsc::channel();
    let app = tauri::Builder::default()
        .any_thread()
        .manage(EpicAccountState::default())
        .setup(move |app| {
            tauri::WebviewWindowBuilder::new(
                app,
                "main",
                WebviewUrl::External("about:blank".parse().unwrap()),
            )
            .visible(false)
            .additional_browser_args(crate::webview_args::WEBVIEW_BROWSER_ARGS)
            .build()?;
            let handle = app.handle().clone();
            let run = handle.clone();
            let check = tauri::async_runtime::spawn(async move {
                let store = Store::of(&run).unwrap();
                assert!(store.dir().to_string_lossy().contains("app.playcounter.epic-fixture-"));
                let (loaded, page_loaded) = oneshot::channel();
                let loaded = Mutex::new(Some(loaded));
                let window = tauri::WebviewWindowBuilder::new(
                    &run,
                    "epic-redirect-fixture",
                    WebviewUrl::External("about:blank".parse().unwrap()),
                )
                .visible(false)
                .incognito(true)
                .additional_browser_args(crate::webview_args::WEBVIEW_BROWSER_ARGS)
                .on_page_load(move |_, event| {
                    if event.event() == PageLoadEvent::Finished && event.url().as_str() == REDIRECT_URL {
                        if let Some(loaded) = loaded.lock().unwrap().take() {
                            loaded.send(()).unwrap();
                        }
                    }
                })
                .build().unwrap();
                let (ready, interception_ready) = oneshot::channel();
                window.with_webview(move |platform| unsafe {
                    let view = platform.controller().CoreWebView2().unwrap();
                    let environment = platform.environment();
                    view.AddWebResourceRequestedFilter(w!("*"), COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL).unwrap();
                    let mut registration = 0;
                    view.add_WebResourceRequested(&WebResourceRequestedEventHandler::create(Box::new(move |_, args| {
                        let args = args.unwrap();
                        let request = args.Request()?;
                        let mut uri = windows_core::PWSTR::null();
                        request.Uri(&mut uri)?;
                        let url = webview2_com::take_pwstr(uri);
                        let (status, body) = if url == REDIRECT_URL {
                            // Cancellation happens while this redirect has not
                            // supplied its code yet. A one-shot read loses it.
                            (200, "<!doctype html><pre>Loading</pre>")
                        } else {
                            (404, "Fixture blocked network request")
                        };
                        let stream = windows::Win32::UI::Shell::SHCreateMemStream(Some(body.as_bytes())).unwrap();
                        let reason = HSTRING::from("Fixture");
                        let headers = HSTRING::from("Content-Type: text/html\r\nCache-Control: no-store");
                        let mut raw = std::ptr::null_mut();
                        (environment.vtable().CreateWebResourceResponse)(
                            environment.as_raw(), windows::core::Interface::as_raw(&stream), status,
                            windows_core::PCWSTR(reason.as_ptr()), windows_core::PCWSTR(headers.as_ptr()), &mut raw,
                        ).ok()?;
                        args.SetResponse(&ICoreWebView2WebResourceResponse::from_raw(raw))?;
                        Ok(())
                    })), &mut registration).unwrap();
                    ready.send(()).unwrap();
                }).unwrap();
                interception_ready.await.unwrap();
                secure_window(&window, ExpectedProfile::Private, true).await.unwrap();
                window.navigate(REDIRECT_URL.parse().unwrap()).unwrap();
                // Cancel while the redirect DOM is still pending and before
                // the normal 500ms code polling loop has even started.
                tokio::time::timeout(Duration::from_secs(10), page_loaded).await.unwrap().unwrap();
                let capture = read_code_after_cancel(&window, &store);
                tokio::pin!(capture);
                tokio::select! {
                    result = &mut capture => panic!("Cancelled redirect must wait for its pending code: {result:?}"),
                    _ = tokio::time::sleep(Duration::from_millis(150)) => {}
                }
                window.eval("document.querySelector('pre').textContent = JSON.stringify({ authorizationCode: 'SyntheticEpicCode123' });").unwrap();
                assert_eq!(capture.await.unwrap(), "SyntheticEpicCode123");
                // No saved token yet, so this real sign-out performs no remote
                // revocation. Its generation must block this pending login.
                kept_logins::sign_out(&run, Service::Epic).await.unwrap();
                assert!(read_code_after_cancel(&window, &store).await.is_err());
                assert!(store.save(Service::Epic, &KeptLogin::new("synthetic-late-refresh".into(), None)).is_err());
                assert!(Store::of(&run).unwrap().load(Service::Epic).is_none());
                clear_profile_data(&window, ExpectedProfile::Private).await.unwrap();
                window.destroy().unwrap();
            });
            tauri::async_runtime::spawn(async move {
                let result = tokio::time::timeout(Duration::from_secs(30), check).await;
                send_result.send(format!("{result:?}")).unwrap();
                handle.exit(0);
            });
            Ok(())
        })
        .build(context).unwrap();
    app.run_return(|_, _| {});
    assert_eq!(
        results.recv_timeout(Duration::from_secs(5)).unwrap(),
        "Ok(Ok(()))"
    );
}
