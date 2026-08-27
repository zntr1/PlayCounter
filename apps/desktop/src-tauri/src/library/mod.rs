pub mod steam;
mod vdf;

use crate::launch::{LaunchError, LaunchErrorKind};

#[tauri::command]
pub async fn library_detect_providers() -> Result<Vec<steam::ProviderStatus>, String> {
    tauri::async_runtime::spawn_blocking(|| vec![steam::detect()])
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn library_list_accounts(provider: String) -> Result<Vec<steam::LocalAccount>, String> {
    require_steam(&provider)?;
    tauri::async_runtime::spawn_blocking(steam::accounts)
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn library_scan(provider: String, account_id: u32) -> Result<steam::ScanResult, String> {
    require_steam(&provider)?;
    tauri::async_runtime::spawn_blocking(move || steam::scan(account_id))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn library_inspect_executable(
    provider: String,
    install_path: String,
    executable_path: String,
) -> Result<steam::ScannedExecutable, String> {
    require_steam(&provider)?;
    tauri::async_runtime::spawn_blocking(move || {
        steam::executable_from_path(&install_path, &executable_path)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn library_launch_app(
    provider: String,
    external_id: String,
    mode: String,
) -> Result<(), LaunchError> {
    if provider != "steam" {
        return Err(LaunchError::new(
            LaunchErrorKind::Unsupported,
            "This game library provider is not supported.",
        ));
    }
    tauri::async_runtime::spawn_blocking(move || steam::launch_app(&external_id, &mode))
        .await
        .map_err(|error| LaunchError::new(LaunchErrorKind::SpawnFailed, error.to_string()))?
}

fn require_steam(provider: &str) -> Result<(), String> {
    if provider == "steam" {
        Ok(())
    } else {
        Err("This game library provider is not supported.".to_string())
    }
}
