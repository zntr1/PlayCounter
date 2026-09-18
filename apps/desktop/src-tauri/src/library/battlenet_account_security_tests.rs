//! Native Windows security check. Uses only synthetic cookies and about:blank;
//! never connects to an account website or touches the real application profile.
use super::*;
use webview2_com::{GetCookiesCompletedHandler, Microsoft::Web::WebView2::Win32::*};
use windows_core::{w, Interface};

async fn cookies(window: &WebviewWindow, seed: bool) -> u32 {
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
            if seed {
                let cookie = manager
                    .CreateCookie(
                        w!("fixture"),
                        w!("synthetic"),
                        w!("account.battle.net"),
                        w!("/"),
                    )
                    .unwrap();
                cookie.SetIsSecure(true).unwrap();
                cookie.SetIsHttpOnly(true).unwrap();
                manager.AddOrUpdateCookie(&cookie).unwrap();
            }
            let sender = Mutex::new(Some(sender));
            manager
                .GetCookies(
                    w!("https://account.battle.net/"),
                    &GetCookiesCompletedHandler::create(Box::new(move |result, list| {
                        result?;
                        let mut count = 0;
                        list.unwrap().Count(&mut count)?;
                        let _ = sender.lock().unwrap().take().unwrap().send(count);
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

async fn verify_settings_and_reader(window: &WebviewWindow) {
    let (sender, receiver) = oneshot::channel();
    window
        .with_webview(move |platform| unsafe {
            let settings = platform
                .controller()
                .CoreWebView2()
                .unwrap()
                .Settings()
                .unwrap();
            let mut enabled = Default::default();
            settings.IsWebMessageEnabled(&mut enabled).unwrap();
            assert!(!enabled.as_bool());
            settings.AreHostObjectsAllowed(&mut enabled).unwrap();
            assert!(!enabled.as_bool());
            settings.AreDevToolsEnabled(&mut enabled).unwrap();
            assert!(!enabled.as_bool());
            let settings4 = settings.cast::<ICoreWebView2Settings4>().unwrap();
            settings4.IsPasswordAutosaveEnabled(&mut enabled).unwrap();
            assert!(!enabled.as_bool());
            settings4.IsGeneralAutofillEnabled(&mut enabled).unwrap();
            assert!(!enabled.as_bool());
            let _ = sender.send(());
        })
        .unwrap();
    tokio::time::timeout(Duration::from_secs(5), receiver)
        .await
        .unwrap()
        .unwrap();
    let (sender, receiver) = oneshot::channel();
    let sender = Mutex::new(Some(sender));
    window
        .eval_with_callback("2 + 2", move |value| {
            let _ = sender.lock().unwrap().take().unwrap().send(value);
        })
        .unwrap();
    assert_eq!(
        tokio::time::timeout(Duration::from_secs(5), receiver)
            .await
            .unwrap()
            .unwrap(),
        "4"
    );
}

#[test]
#[ignore = "requires installed WebView2; runs an isolated native event loop"]
fn private_profile_enforces_security_settings_and_clears_only_its_own_cookies() {
    let mut context = tauri::generate_context!();
    context.config_mut().app.windows.clear();
    context.config_mut().identifier =
        format!("app.playcounter.security-test-{}", uuid::Uuid::new_v4());
    let directory = std::env::temp_dir().join(format!(
        "playcounter-security-test-{}",
        uuid::Uuid::new_v4()
    ));
    let (sender, receiver) = std::sync::mpsc::channel();
    let app = tauri::Builder::default()
        .any_thread()
        .setup(move |app| {
            let persistent = tauri::WebviewWindowBuilder::new(
                app,
                "security-persistent",
                WebviewUrl::External("about:blank".parse().unwrap()),
            )
            .visible(false)
            .data_directory(directory.clone())
            .build()?;
            let private = tauri::WebviewWindowBuilder::new(
                app,
                "security-private",
                WebviewUrl::External("about:blank".parse().unwrap()),
            )
            .visible(false)
            .data_directory(directory)
            .incognito(true)
            .build()?;
            let handle = app.handle().clone();
            let check = tauri::async_runtime::spawn(async move {
                assert!(secure_window(&persistent).await.is_err());
                assert_eq!(cookies(&persistent, true).await, 1);
                secure_window(&private).await.unwrap();
                verify_settings_and_reader(&private).await;
                assert_eq!(cookies(&private, false).await, 0);
                assert_eq!(cookies(&private, true).await, 1);
                clear_private_data(&private).await.unwrap();
                assert_eq!(cookies(&private, false).await, 0);
                assert_eq!(cookies(&persistent, false).await, 1);
                // A subsequent sign-in starts empty while the main profile survives.
                secure_window(&private).await.unwrap();
                assert_eq!(cookies(&private, false).await, 0);
                private.destroy().unwrap();
                persistent.destroy().unwrap();
            });
            tauri::async_runtime::spawn(async move {
                let result = tokio::time::timeout(Duration::from_secs(45), check).await;
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
