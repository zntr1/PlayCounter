//! Opt-in reset check using an isolated WebView profile and synthetic app data.
#![cfg(windows)]

#[allow(dead_code)]
#[path = "../src/ignored_processes.rs"]
mod ignored_processes;
#[path = "../src/reset.rs"]
mod reset;
#[allow(dead_code)]
#[path = "../src/session.rs"]
mod session;

mod notification_overlay {
    pub const MAIN_LABEL: &str = "main";
}

use std::{fs, sync::atomic::Ordering, time::Duration};
use tauri::{Manager, WebviewUrl, WebviewWindow};
use tauri_plugin_window_state::{AppHandleExt, StateFlags};

async fn evaluate(window: &WebviewWindow, script: &str) -> String {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let sender = std::sync::Mutex::new(Some(sender));
    window
        .eval_with_callback(script, move |result| {
            if let Some(sender) = sender.lock().unwrap().take() {
                let _ = sender.send(result);
            }
        })
        .unwrap();
    tokio::time::timeout(Duration::from_secs(5), receiver)
        .await
        .unwrap()
        .unwrap()
}

async fn wait_for_fixture(window: &WebviewWindow) {
    for _ in 0..100 {
        if evaluate(window, "document.body?.textContent === 'Reset fixture'").await == "true" {
            return;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    panic!("The isolated reset fixture did not load");
}

#[test]
#[ignore = "requires installed WebView2; erases only synthetic data in an isolated profile"]
fn native_reset_preserves_backups_and_reopens_with_a_new_identity() {
    let mut context = tauri::generate_context!();
    context.config_mut().app.windows.clear();
    context.config_mut().identifier =
        format!("app.playcounter.reset-test-{}", uuid::Uuid::new_v4());
    let profile = std::env::temp_dir().join(format!(
        "playcounter-reset-profile-{}",
        uuid::Uuid::new_v4()
    ));
    let (sender, receiver) = std::sync::mpsc::channel();
    let app = tauri::Builder::default()
        .any_thread()
        .manage(reset::ResetState::default())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri::plugin::Builder::<tauri::Wry>::new("reset-test-exit")
            .on_event(|app, event| {
                if matches!(event, tauri::RunEvent::Exit)
                    && app.state::<reset::ResetState>().0.load(Ordering::SeqCst)
                {
                    reset::clear_window_state(app).unwrap();
                }
            }).build())
        .register_uri_scheme_protocol("reset-fixture", |_, _| {
            tauri::http::Response::builder()
                .header("Content-Type", "text/html")
                .body(b"<!doctype html><body>Reset fixture</body>".to_vec()).unwrap()
        })
        .setup(move |app| {
            let window = tauri::WebviewWindowBuilder::new(app, "main", WebviewUrl::CustomProtocol("reset-fixture://localhost".parse().unwrap()))
                .visible(false).data_directory(profile).build()?;
            let handle = app.handle().clone();
            let checker = handle.clone();
            let check = tauri::async_runtime::spawn(async move {
                wait_for_fixture(&window).await;
                assert_eq!(evaluate(&window, "localStorage.setItem('playcounter:v1', 'synthetic history'); document.cookie = 'fixture=synthetic'; localStorage.getItem('playcounter:v1')").await, "\"synthetic history\"");
                let data = checker.path().app_data_dir().unwrap();
                let config = checker.path().app_config_dir().unwrap();
                let identity = session::install_uuid(checker.clone(), None).unwrap();
                ignored_processes::load(&checker).unwrap();
                fs::create_dir_all(data.join("covers")).unwrap();
                fs::create_dir_all(data.join("backups/automatic")).unwrap();
                fs::create_dir_all(data.join("custom-backups")).unwrap();
                fs::write(data.join("covers/1.png"), "synthetic cover").unwrap();
                let backups = [
                    (data.join("backups/playcounter-backup-123.json"), "safety backup"),
                    (data.join(format!("backups/automatic/playcounter-auto-123-{}.json", uuid::Uuid::new_v4())), "automatic backup"),
                    (data.join(format!("custom-backups/playcounter-auto-123-{}.json", uuid::Uuid::new_v4())), "custom-folder backup"),
                    (data.join("custom-backups/manual-export.json"), "manual export"),
                ];
                for (path, contents) in &backups {
                    fs::write(path, contents).unwrap();
                }
                checker.save_window_state(StateFlags::all()).unwrap();
                assert!(config.join(checker.filename()).exists());

                reset::reset_local_data(checker.clone(), window.clone()).await.unwrap();
                assert!(!data.join("covers").exists());
                for (path, contents) in &backups {
                    assert_eq!(fs::read_to_string(path).unwrap(), *contents);
                }
                assert!(!data.join("install-uuid.txt").exists());
                assert!(!ignored_processes::user_file_path(&checker).unwrap().exists());
                assert!(!config.join(checker.filename()).exists());
                assert_eq!(evaluate(&window, "localStorage.getItem('playcounter:v1')").await, "null");
                assert_eq!(evaluate(&window, "document.cookie").await, "\"\"");
                window.eval("location.reload()").unwrap();
                tokio::time::sleep(Duration::from_millis(300)).await;
                wait_for_fixture(&window).await;
                assert_eq!(evaluate(&window, "localStorage.length").await, "0");
                let fresh_identity = session::install_uuid(checker.clone(), None).unwrap();
                assert_ne!(fresh_identity, identity);
                assert_eq!(session::install_uuid(checker.clone(), None).unwrap(), fresh_identity);
                // A second reset remains safe, including after files were removed.
                reset::reset_local_data(checker, window).await.unwrap();
                for (path, contents) in &backups {
                    assert_eq!(fs::read_to_string(path).unwrap(), *contents);
                }
            });
            tauri::async_runtime::spawn(async move {
                let result = tokio::time::timeout(Duration::from_secs(45), check).await;
                let _ = sender.send(format!("{result:?}"));
                handle.exit(0);
            });
            Ok(())
        }).build(context).unwrap();
    let data = app.path().app_data_dir().unwrap();
    let config = app.path().app_config_dir().unwrap();
    let window_state = config.join(app.handle().filename());
    app.run_return(|_, _| {});
    assert_eq!(
        receiver.recv_timeout(Duration::from_secs(5)).unwrap(),
        "Ok(Ok(()))"
    );
    assert!(
        !window_state.exists(),
        "Window geometry was saved again during exit"
    );
    // These roots belong to this test's fresh, random app identifier only.
    if data.exists() {
        fs::remove_dir_all(&data).unwrap();
    }
    if config != data && config.exists() {
        fs::remove_dir_all(config).unwrap();
    }
}
