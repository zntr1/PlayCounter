use std::{
    fs,
    io::ErrorKind,
    path::Path,
    sync::atomic::{AtomicBool, Ordering},
};
use tauri::{Manager, WebviewWindow};
use tauri_plugin_window_state::AppHandleExt;

#[derive(Default)]
pub(crate) struct ResetState(pub AtomicBool);

/// Only fixed, app-owned paths are recursively removed. Never delete the
/// WebView's live profile directory or any backup directory.
fn remove_owned_entry(root: &Path, path: &Path) -> Result<(), String> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.to_string()),
    };
    let root = root.canonicalize().map_err(|error| error.to_string())?;
    let resolved = path.canonicalize().map_err(|error| error.to_string())?;
    if resolved == root || !resolved.starts_with(&root) {
        return Err("A PlayCounter data path points outside its app folder.".into());
    }
    let result = if metadata.is_dir() {
        fs::remove_dir_all(path)
    } else {
        fs::remove_file(path)
    };
    result.map_err(|error| error.to_string())
}

pub(crate) fn clear_window_state(app: &tauri::AppHandle) -> Result<(), String> {
    let config = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?;
    remove_owned_entry(&config, &config.join(app.filename()))
}

#[tauri::command]
pub async fn reset_local_data(app: tauri::AppHandle, window: WebviewWindow) -> Result<(), String> {
    if window.label() != super::notification_overlay::MAIN_LABEL {
        return Err("Reset is only available in the main PlayCounter window.".into());
    }
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let data = handle
            .path()
            .app_data_dir()
            .map_err(|error| error.to_string())?;
        let config = handle
            .path()
            .app_config_dir()
            .map_err(|error| error.to_string())?;
        remove_owned_entry(&data, &data.join("covers"))?;
        remove_owned_entry(&config, &super::ignored_processes::user_file_path(&handle)?)?;
        super::session::reset_install_uuid(&handle)?;
        clear_window_state(&handle)
    })
    .await
    .map_err(|error| error.to_string())??;
    clear_browsing_data(&window).await?;
    // The window-state plugin saves on exit. Clear its file again after that
    // save, so relaunching cannot restore the old geometry.
    app.state::<ResetState>().0.store(true, Ordering::SeqCst);
    Ok(())
}

#[cfg(windows)]
async fn clear_browsing_data(window: &WebviewWindow) -> Result<(), String> {
    use std::sync::{Arc, Mutex};
    use webview2_com::{ClearBrowsingDataCompletedHandler, Microsoft::Web::WebView2::Win32::*};
    use windows_core::Interface;

    // Tauri's convenience method schedules this operation. Wait for WebView2's
    // completion callback before restarting, otherwise old storage can survive.
    let (sender, receiver) = tokio::sync::oneshot::channel();
    window
        .with_webview(move |platform| {
            let sender = Arc::new(Mutex::new(Some(sender)));
            let completed = sender.clone();
            let clear = || -> windows_core::Result<()> {
                unsafe {
                    platform
                        .controller()
                        .CoreWebView2()?
                        .cast::<ICoreWebView2_13>()?
                        .Profile()?
                        .cast::<ICoreWebView2Profile2>()?
                        .ClearBrowsingDataAll(&ClearBrowsingDataCompletedHandler::create(Box::new(
                            move |result| {
                                if let Some(sender) =
                                    completed.lock().ok().and_then(|mut value| value.take())
                                {
                                    let _ = sender.send(result.map_err(|error| error.to_string()));
                                }
                                Ok(())
                            },
                        )))
                }
            };
            if let Err(error) = clear() {
                if let Some(sender) = sender.lock().ok().and_then(|mut value| value.take()) {
                    let _ = sender.send(Err(error.to_string()));
                }
            }
        })
        .map_err(|error| error.to_string())?;
    receiver.await.map_err(|error| error.to_string())?
}

#[cfg(not(windows))]
async fn clear_browsing_data(window: &WebviewWindow) -> Result<(), String> {
    window
        .clear_all_browsing_data()
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn erases_owned_data_and_allows_retry_without_touching_other_files() {
        let root = std::env::temp_dir().join(format!("playcounter-reset-{}", uuid::Uuid::new_v4()));
        let covers = root.join("covers");
        fs::create_dir_all(covers.join("nested")).unwrap();
        fs::write(covers.join("nested/cover.png"), "image").unwrap();
        fs::write(root.join("manual-export.json"), "keep").unwrap();
        remove_owned_entry(&root, &covers).unwrap();
        remove_owned_entry(&root, &covers).unwrap();
        assert!(!covers.exists());
        assert!(root.join("manual-export.json").exists());
        assert!(remove_owned_entry(&root, &root).is_err());
        let outside = root.with_extension("outside");
        fs::write(&outside, "keep").unwrap();
        assert!(remove_owned_entry(&root, &outside).is_err());
        assert!(outside.exists());
        fs::remove_file(outside).unwrap();
        fs::remove_dir_all(root).unwrap();
    }
}
