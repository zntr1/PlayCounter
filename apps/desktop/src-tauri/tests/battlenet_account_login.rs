//! Opt-in live login smoke test. Opens the real production sign-in flow in an
//! isolated app profile; checks visible controls without entering credentials.
#![cfg(windows)]

#[allow(dead_code)]
#[path = "../src/library/battlenet_account.rs"]
mod battlenet_account;
#[path = "../src/webview_args.rs"]
mod webview_args;

use battlenet_account::{
    library_battlenet_account_games, library_cancel_battlenet_account, AccountState,
};
use std::{sync::Mutex, time::Duration};
use tauri::{Manager, WebviewUrl, WebviewWindow};
use tokio::sync::oneshot;

async fn login_form_is_visible(window: &WebviewWindow) -> bool {
    let (sender, receiver) = oneshot::channel();
    let sender = Mutex::new(Some(sender));
    window
        .eval_with_callback(
            r#"(() => {
      const visible = selector => {
        const element = document.querySelector(selector);
        if (!element) return false;
        const rect = element.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return false;
        const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        return hit === element || element.contains(hit);
      };
      // Battle.net currently asks for the account name before the password.
      return visible('input[name="accountName"]') && visible('button#submit[type="submit"]');
    })()"#,
            move |result| {
                if let Some(sender) = sender.lock().unwrap().take() {
                    let _ = sender.send(result);
                }
            },
        )
        .unwrap();
    matches!(tokio::time::timeout(Duration::from_secs(5), receiver).await, Ok(Ok(value)) if value == "true")
}

#[test]
#[ignore = "contacts the live Battle.net login site; no credentials are entered"]
fn live_login_form_loads_and_cancellation_allows_a_fresh_attempt() {
    let mut context = tauri::generate_context!();
    context.config_mut().app.windows.clear();
    context.config_mut().identifier =
        format!("app.playcounter.login-smoke-{}", uuid::Uuid::new_v4());
    let (sender, receiver) = std::sync::mpsc::channel();
    let app = tauri::Builder::default()
        .any_thread()
        .manage(AccountState::default())
        .setup(move |app| {
            let main = tauri::WebviewWindowBuilder::new(
                app,
                "main",
                WebviewUrl::External("about:blank".parse().unwrap()),
            )
            .visible(false)
            .build()?;
            let handle = app.handle().clone();
            let run_handle = handle.clone();
            let check = tauri::async_runtime::spawn(async move {
                for attempt_index in 0..2 {
                    let id = uuid::Uuid::new_v4().to_string();
                    let label = format!("battlenet-sign-in-{id}");
                    let auth_app = run_handle.clone();
                    let auth_main = main.clone();
                    let auth_id = id.clone();
                    let attempt = tauri::async_runtime::spawn(async move {
                        library_battlenet_account_games(
                            auth_app.clone(),
                            auth_main,
                            auth_app.state::<AccountState>(),
                            auth_id,
                        )
                        .await
                    });
                    let form = tokio::time::timeout(Duration::from_secs(25), async {
                        loop {
                            if let Some(window) = run_handle.get_webview_window(&label) {
                                if login_form_is_visible(&window).await {
                                    break;
                                }
                            }
                            tokio::time::sleep(Duration::from_millis(200)).await;
                        }
                    })
                    .await;
                    // Only log origin/path, never OAuth query strings or form values.
                    if let Some(window) = run_handle.get_webview_window(&label) {
                        let url = window.url().unwrap();
                        println!(
                            "Login page: {}{}; form visible: {}",
                            url.origin().ascii_serialization(),
                            url.path(),
                            form.is_ok()
                        );
                    }
                    if attempt_index == 1 && form.is_ok() {
                        // A denied top-level redirect must return an error and
                        // clean up promptly instead of leaving another blank window.
                        run_handle
                            .get_webview_window(&label)
                            .unwrap()
                            .navigate("https://blocked.example.invalid/".parse().unwrap())
                            .unwrap();
                    } else {
                        library_cancel_battlenet_account(
                            main.clone(),
                            run_handle.state::<AccountState>(),
                            id,
                        )
                        .unwrap();
                    }
                    let result = tokio::time::timeout(Duration::from_secs(15), attempt)
                        .await
                        .unwrap()
                        .unwrap();
                    assert!(result
                        .unwrap_err()
                        .contains(if attempt_index == 1 && form.is_ok() {
                            "unsupported sign-in page"
                        } else {
                            "cancelled"
                        }));
                    assert!(
                        form.is_ok(),
                        "The production sign-in window did not render the login form"
                    );
                    tokio::time::timeout(Duration::from_secs(5), async {
                        while run_handle.get_webview_window(&label).is_some() {
                            tokio::time::sleep(Duration::from_millis(20)).await;
                        }
                    })
                    .await
                    .unwrap();
                }
                main.destroy().unwrap();
            });
            tauri::async_runtime::spawn(async move {
                let result = tokio::time::timeout(Duration::from_secs(90), check).await;
                let _ = sender.send(format!("{result:?}"));
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
